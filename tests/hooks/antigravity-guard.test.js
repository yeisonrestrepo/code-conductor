import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CORPUS, DIALECT } from '../fixtures/guard3-corpus.js';
import { runCommand, readFile, writeFile, editFile } from '../fixtures/antigravity-payloads.js';

// FEAT-048 slice 2 (#97): the Antigravity adapter wraps the shipped pre-tool-use.mjs.
// Every call runs it the way agy does: `node hooks/conductor-guard.mjs` from <project>/.agents
// with the PreToolUse payload on stdin.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TEMPLATE = join(REPO_ROOT, 'project-template');
const ADAPTER = join(TEMPLATE, '.agents', 'hooks', 'conductor-guard.mjs');
const GUARD = join(TEMPLATE, '.claude', 'hooks', 'pre-tool-use.mjs');

let project;
const made = [];

// A project laid out the way `code-conductor --project --antigravity` leaves it.
function scaffold() {
  const dir = mkdtempSync(join(tmpdir(), 'cc-agy-'));
  made.push(dir);
  mkdirSync(join(dir, '.claude', 'hooks'), { recursive: true });
  mkdirSync(join(dir, '.claude', 'memory'), { recursive: true });
  mkdirSync(join(dir, '.agents', 'hooks'), { recursive: true });
  copyFileSync(GUARD, join(dir, '.claude', 'hooks', 'pre-tool-use.mjs'));
  copyFileSync(ADAPTER, join(dir, '.agents', 'hooks', 'conductor-guard.mjs'));
  return dir;
}

// Returns the deny reason, '' on allow; fails the test on any other output shape.
function hook(dir, event) {
  const input = typeof event === 'string' ? event : JSON.stringify(event);
  const res = spawnSync(process.execPath, ['hooks/conductor-guard.mjs'], { cwd: join(dir, '.agents'), input, encoding: 'utf8', timeout: 60000 });
  expect(res.status).toBe(0);
  const out = res.stdout.trim();
  if (!out) return '';
  const reply = JSON.parse(out);
  expect(reply.decision).toBe('deny');
  return reply.reason;
}

beforeAll(() => {
  project = scaffold();
});
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

describe('Antigravity adapter: Guard 3 corpus through run_command', () => {
  const rows = [...CORPUS, ...DIALECT].filter((r) => (r.toolName ?? 'Bash') === 'Bash');
  it.each(rows.map((r) => [r.label, r]))('%s', (_label, row) => {
    const file = join(project, '.claude', 'memory', 'bash-scan-allowlist.txt');
    writeFileSync(file, row.allowlist && row.allowlist.length ? row.allowlist.join('\n') + '\n' : '', 'utf8');
    const reason = hook(project, runCommand(project, { CommandLine: row.command }));
    if (row.verdict === 'deny') expect(reason).toMatch(/BASH SCAN BLOCKED/);
    else expect(reason).toBe('');
  });
});

describe('Antigravity adapter: recorded calls', () => {
  it('lets echo through with no output', () => {
    expect(hook(project, runCommand(project, { CommandLine: 'echo probe-ok' }))).toBe('');
  });
  it('blocks an unbounded read of a long file and allows a line range (Guard 1)', () => {
    writeFileSync(join(project, 'big.txt'), 'line\n'.repeat(400));
    expect(hook(project, readFile(project, 'big.txt'))).toMatch(/Guard 1/);
    expect(hook(project, readFile(project, 'big.txt', { StartLine: 10, EndLine: 20 }))).toBe('');
  });
  it('passes a recorded read_file carrying toolSummary to the guard (BUG-093)', () => {
    writeFileSync(join(project, 'big.txt'), 'line\n'.repeat(400));
    expect(hook(project, readFile(project, 'big.txt', { toolSummary: 'read a file' }))).toMatch(/Guard 1/);
    expect(hook(project, readFile(project, 'big.txt', { StartLine: 10, EndLine: 20, toolSummary: 'read a file' }))).toBe('');
  });
  it('blocks a read under node_modules (Guard 4)', () => {
    expect(hook(project, readFile(project, join('node_modules', 'x', 'index.js')))).toMatch(/^Guard 4:/);
  });
  it('lets a new-file write and an edit through', () => {
    expect(hook(project, writeFile(project, 'fresh.txt'))).toBe('');
    writeFileSync(join(project, 'note.txt'), 'hello\n');
    expect(hook(project, editFile(project, 'note.txt'))).toBe('');
  });
});

describe('Antigravity adapter: fails closed', () => {
  it('blocks an unknown tool, naming it', () => {
    const event = { cwd: project, hookEventName: 'PreToolUse', toolCall: { name: 'browser_open', args: {} } };
    expect(hook(project, event)).toBe('code-conductor guard does not cover the Antigravity tool "browser_open"; it is blocked until the guard maps it');
  });
  it('blocks run_command with an argument it does not know, naming it', () => {
    expect(hook(project, runCommand(project, { CommandLine: 'echo hi', Cwd: 'sub' }))).toMatch(/"Cwd"/);
  });
  it('blocks read_file with an argument it does not know, naming it (BUG-093)', () => {
    writeFileSync(join(project, 'small.txt'), 'hello\n');
    const reason = hook(project, readFile(project, 'small.txt', { Paths: [join(project, 'small.txt')] }));
    expect(reason).toBe('code-conductor guard blocked the Antigravity tool "read_file": argument "Paths" not covered by the guard');
  });
  it('blocks write_file with an argument it does not know, naming it (BUG-093)', () => {
    const args = { Path: join(project, 'fresh-append.txt'), Content: 'hello\n', toolSummary: 'write a file', Append: true };
    const event = { cwd: project, hookEventName: 'PreToolUse', toolCall: { name: 'write_file', args } };
    expect(hook(project, event)).toBe('code-conductor guard blocked the Antigravity tool "write_file": argument "Append" not covered by the guard');
  });
  it('blocks edit_file with an argument it does not know, naming it (BUG-093)', () => {
    writeFileSync(join(project, 'note-edit.txt'), 'hello\n');
    const args = { Path: join(project, 'note-edit.txt'), Target: 'hello', Replacement: 'bye', toolSummary: 'edit a file', AllowMultiple: true };
    const event = { cwd: project, hookEventName: 'PreToolUse', toolCall: { name: 'edit_file', args } };
    expect(hook(project, event)).toBe('code-conductor guard blocked the Antigravity tool "edit_file": argument "AllowMultiple" not covered by the guard');
  });
  it('names every unknown argument, sorted, with the plural wording (BUG-093)', () => {
    writeFileSync(join(project, 'note-edit.txt'), 'hello\n');
    const args = { Path: join(project, 'note-edit.txt'), Target: 'hello', Replacement: 'bye', toolSummary: 'edit a file', Paths: ['x'], AllowMultiple: true };
    const event = { cwd: project, hookEventName: 'PreToolUse', toolCall: { name: 'edit_file', args } };
    expect(hook(project, event)).toBe('code-conductor guard blocked the Antigravity tool "edit_file": arguments "AllowMultiple", "Paths" not covered by the guard');
  });
  it('blocks run_command whose CommandLine is not a string', () => {
    expect(hook(project, runCommand(project, { CommandLine: 5 }))).toMatch(/"CommandLine"/);
  });
  it('blocks a payload with no toolCall', () => {
    expect(hook(project, { cwd: project, hookEventName: 'PreToolUse' })).toMatch(/no toolCall/);
  });
  it('blocks stdin that is not JSON', () => {
    expect(hook(project, 'not json')).toMatch(/could not read/);
  });
  it('blocks when the guard file is missing, naming its path', () => {
    const dir = scaffold();
    rmSync(join(dir, '.claude', 'hooks', 'pre-tool-use.mjs'));
    expect(hook(dir, runCommand(dir, { CommandLine: 'echo hi' }))).toMatch(/could not run .*pre-tool-use\.mjs/);
  });
  it('blocks when the guard prints something that is not JSON', () => {
    const dir = scaffold();
    writeFileSync(join(dir, '.claude', 'hooks', 'pre-tool-use.mjs'), "process.stdout.write('not json');\n");
    expect(hook(dir, runCommand(dir, { CommandLine: 'echo hi' }))).toMatch(/output was not JSON/);
  });
});
