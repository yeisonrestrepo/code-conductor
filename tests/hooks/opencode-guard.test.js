import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CORPUS, DIALECT } from '../fixtures/guard3-corpus.js';

// FEAT-048 slice 1 (#97): the OpenCode plugin is an adapter around the shipped
// pre-tool-use.mjs, never a copy of it. Every assertion below drives the plugin the way
// OpenCode does, tool.execute.before(input, output), against the real guard.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TEMPLATE = join(REPO_ROOT, 'project-template');
const PLUGIN = join(TEMPLATE, '.opencode', 'plugin', 'conductor-guard.js');
const GUARD = join(TEMPLATE, '.claude', 'hooks', 'pre-tool-use.mjs');

let plugin, project, bare;

// A project laid out the way `code-conductor --project --opencode` leaves it.
function scaffold() {
  const dir = mkdtempSync(join(tmpdir(), 'cc-opencode-'));
  mkdirSync(join(dir, '.claude', 'hooks'), { recursive: true });
  mkdirSync(join(dir, '.claude', 'memory'), { recursive: true });
  copyFileSync(GUARD, join(dir, '.claude', 'hooks', 'pre-tool-use.mjs'));
  return dir;
}

async function hookFor(directory) {
  const hooks = await plugin.ConductorGuard({ directory, worktree: directory });
  return hooks['tool.execute.before'];
}

// Resolves to the block reason, or '' when the call is let through.
async function call(directory, tool, args) {
  const before = await hookFor(directory);
  try {
    await before({ tool, sessionID: 'ses_test', callID: 'call_test' }, { args });
    return '';
  } catch (e) {
    return e.message;
  }
}

function setAllowlist(entries) {
  const file = join(project, '.claude', 'memory', 'bash-scan-allowlist.txt');
  writeFileSync(file, entries && entries.length ? entries.join('\n') + '\n' : '', 'utf8');
}

beforeAll(async () => {
  plugin = await import(pathToFileURL(PLUGIN).href);
  project = scaffold();
  bare = mkdtempSync(join(tmpdir(), 'cc-opencode-bare-'));
});
afterAll(() => {
  rmSync(project, { recursive: true, force: true });
  rmSync(bare, { recursive: true, force: true });
});

describe('OpenCode plugin: module shape', () => {
  // OpenCode calls every function a plugin module exports as a plugin.
  it('exports the plugin and nothing else', () => {
    expect(Object.keys(plugin)).toEqual(['ConductorGuard']);
  });
  it('registers only tool.execute.before', async () => {
    const hooks = await plugin.ConductorGuard({ directory: project, worktree: project });
    expect(Object.keys(hooks)).toEqual(['tool.execute.before']);
  });
});

describe('OpenCode plugin: Guard 3 corpus through bash', () => {
  const rows = [...CORPUS, ...DIALECT].filter((r) => (r.toolName ?? 'Bash') === 'Bash');
  it.each(rows.map((r) => [r.label, r]))('%s', async (_label, row) => {
    setAllowlist(row.allowlist);
    const reason = await call(project, 'bash', { command: row.command, description: 'probe' });
    if (row.verdict === 'deny') expect(reason).toMatch(/BASH SCAN BLOCKED/);
    else expect(reason).toBe('');
  });
});

describe('OpenCode plugin: read, write and edit', () => {
  it('blocks a read under node_modules (Guard 4)', async () => {
    const reason = await call(project, 'read', { filePath: join(project, 'node_modules', 'x', 'index.js') });
    expect(reason).toMatch(/^Guard 4:/);
  });
  it('blocks an unbounded read of a long file and allows it with a limit (Guard 1)', async () => {
    const file = join(project, 'long.txt');
    writeFileSync(file, 'line\n'.repeat(400));
    expect(await call(project, 'read', { filePath: file })).not.toBe('');
    expect(await call(project, 'read', { filePath: file, offset: 0, limit: 50 })).toBe('');
  });
  it('blocks a write over an existing file, since OpenCode has no ask (Guard 2)', async () => {
    const file = join(project, 'exists.txt');
    writeFileSync(file, 'old\n');
    const reason = await call(project, 'write', { filePath: file, content: 'new\n' });
    expect(reason).toMatch(/FILE ALREADY EXISTS/);
    expect(await call(project, 'write', { filePath: join(project, 'fresh.txt'), content: 'x' })).toBe('');
  });
  it('lets an edit through', async () => {
    const file = join(project, 'exists.txt');
    expect(await call(project, 'edit', { filePath: file, oldString: 'old', newString: 'new' })).toBe('');
  });
});

describe('OpenCode plugin: same decision as the Claude Code hook', () => {
  it('blocks with the reason the hook itself returns', async () => {
    const command = 'cat src/*.js';
    setAllowlist([]);
    const r = spawnSync(process.execPath, [GUARD], {
      cwd: project,
      input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
      env: { ...process.env, CLAUDE_PROJECT_DIR: project },
    });
    const expected = JSON.parse(r.stdout.toString()).hookSpecificOutput.permissionDecisionReason;
    expect(await call(project, 'bash', { command })).toBe(expected);
  });
});

describe('OpenCode plugin: when the guard cannot run', () => {
  it('blocks a guarded call with a reason naming the missing guard', async () => {
    const reason = await call(bare, 'bash', { command: 'git status' });
    expect(reason).toMatch(/code-conductor guard could not run/);
    expect(reason).toContain(join('.claude', 'hooks', 'pre-tool-use.mjs'));
  });
  it('never spawns the guard for a tool it does not map', async () => {
    expect(await call(bare, 'glob', { pattern: '**/*.js' })).toBe('');
    expect(await call(bare, 'webfetch', { url: 'https://example.com' })).toBe('');
  });
});
