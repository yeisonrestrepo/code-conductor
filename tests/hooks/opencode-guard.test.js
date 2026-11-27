import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

// OpenCode's client.session.get, as measured on 1.19.6: a task subagent's session carries
// its agent's name and its parent's id; a primary session carries no parentID.
const SESSIONS = {
  ses_test: { id: 'ses_test', agent: 'build' },
  ses_root: { id: 'ses_root', agent: 'build' },
  ses_audit: { id: 'ses_audit', agent: 'conductor-audit', parentID: 'ses_root' },
  ses_code: { id: 'ses_code', agent: 'conductor-code', parentID: 'ses_root' },
  ses_general: { id: 'ses_general', agent: 'general', parentID: 'ses_root' },
  ses_deep: { id: 'ses_deep', agent: 'conductor-qa', parentID: 'ses_general' },
  ses_noagent: { id: 'ses_noagent', parentID: 'ses_root' },
  ses_primary_code: { id: 'ses_primary_code', agent: 'conductor-code' },
};
function fakeClient(lookups = []) {
  return {
    session: {
      get: async ({ path: { id } }) => {
        lookups.push(id);
        return SESSIONS[id] ? { data: SESSIONS[id] } : { error: { name: 'NotFoundError' } };
      },
    },
  };
}

async function hookFor(directory, client = fakeClient()) {
  const hooks = await plugin.ConductorGuard({ directory, worktree: directory, client });
  return hooks['tool.execute.before'];
}

// Resolves to the block reason, or '' when the call is let through.
async function callWith(before, tool, args, sessionID = 'ses_test') {
  try {
    await before({ tool, sessionID, callID: 'call_test' }, { args });
    return '';
  } catch (e) {
    return e.message;
  }
}
async function call(directory, tool, args, { sessionID, client } = {}) {
  return callWith(await hookFor(directory, client), tool, args, sessionID);
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
});

// Pre-1.44.0 hardening: the plugin fails closed. A stub guard stands in for
// pre-tool-use.mjs where the test needs to count or steer guard calls; it records each
// payload it receives and denies any file_path ending in denied.txt.
const STUB = `import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const p = JSON.parse(readFileSync(0, 'utf8'));
appendFileSync(join(process.env.CLAUDE_PROJECT_DIR, 'payloads.jsonl'), JSON.stringify(p) + '\\n');
const f = (p.tool_input && p.tool_input.file_path) || '';
const out = f.endsWith('denied.txt')
  ? { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'STUB DENY ' + f } }
  : {};
process.stdout.write(JSON.stringify(out));
`;
const stubs = [];
function stubProject() {
  const dir = mkdtempSync(join(tmpdir(), 'cc-opencode-stub-'));
  mkdirSync(join(dir, '.claude', 'hooks'), { recursive: true });
  writeFileSync(join(dir, '.claude', 'hooks', 'pre-tool-use.mjs'), STUB);
  writeFileSync(join(dir, 'payloads.jsonl'), '');
  stubs.push(dir);
  return dir;
}
const payloads = (dir) => readFileSync(join(dir, 'payloads.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const patch = (...body) => ['*** Begin Patch', ...body, '*** End Patch'].join('\n');
afterAll(() => { for (const d of stubs) rmSync(d, { recursive: true, force: true }); });

const UNCOVERED = /code-conductor guard does not cover the OpenCode tool/;
const NOT_RUN = /code-conductor guard could not run/;

// FEAT-048 slice 6: measured on 1.19.6, tool.execute.before fires for a task subagent's own
// calls, so task is sent to the guard as Agent and every call carries its session's agent.
const IDENTIFY = /code-conductor guard could not identify the OpenCode session's agent/;

describe('OpenCode plugin: task is sent to the guard as Agent (AC3)', () => {
  it('maps a task from the primary session, without the conductor- prefix and with no agent_type', async () => {
    const dir = stubProject();
    expect(await call(dir, 'task', { description: 'd', prompt: 'review it', subagent_type: 'conductor-audit' })).toBe('');
    const [p] = payloads(dir);
    expect(p).toMatchObject({ tool_name: 'Agent', session_id: 'ses_test', tool_input: { subagent_type: 'audit', description: 'd', prompt: 'review it' } });
    expect(p).not.toHaveProperty('agent_type');
    expect(payloads(dir)).toHaveLength(1);
  });
  it('keeps the name of an agent that is not code-conductor\'s', async () => {
    const dir = stubProject();
    await call(dir, 'task', { description: 'd', prompt: 'p', subagent_type: 'general' });
    expect(payloads(dir)[0].tool_input.subagent_type).toBe('general');
  });
  it('carries the calling subagent as agent_type and the root session as session_id', async () => {
    const dir = stubProject();
    await call(dir, 'task', { description: 'd', prompt: 'p', subagent_type: 'general' }, { sessionID: 'ses_code' });
    expect(payloads(dir)[0]).toMatchObject({ agent_type: 'code', session_id: 'ses_root' });
  });
  it('walks every parent to the root session', async () => {
    const dir = stubProject();
    await call(dir, 'write', { filePath: join(dir, 'a.txt'), content: 'x' }, { sessionID: 'ses_deep' });
    expect(payloads(dir)[0]).toMatchObject({ agent_type: 'qa', session_id: 'ses_root' });
  });
});

describe('OpenCode plugin: task arguments the guard cannot attribute or see (AC4)', () => {
  const cases = [
    ['task_id, which resumes a session under another agent', { description: 'd', prompt: 'p', subagent_type: 'conductor-code', task_id: 'ses_root' }, /task_id/],
    ['an @path in the prompt, which OpenCode attaches without a tool call', { description: 'd', prompt: 'read @node_modules/x/index.js', subagent_type: 'general' }, /@ reference/],
    ['a dot-led @path', { description: 'd', prompt: 'see @.env', subagent_type: 'general' }, /@ reference/],
    ['no subagent_type', { description: 'd', prompt: 'p' }, /subagent_type/],
    ['an empty prompt', { description: 'd', prompt: '', subagent_type: 'general' }, /prompt/],
  ];
  it.each(cases)('blocks %s without spawning the guard', async (_label, args, why) => {
    const dir = stubProject();
    const reason = await call(dir, 'task', args);
    expect(reason).toMatch(/code-conductor guard blocked "task"/);
    expect(reason).toMatch(why);
    expect(payloads(dir)).toEqual([]);
  });
  it('lets an e-mail-like or code-span @ through', async () => {
    const dir = stubProject();
    expect(await call(dir, 'task', { description: 'd', prompt: 'mail a@b about `@keep`', subagent_type: 'general' })).toBe('');
  });
});

describe('OpenCode plugin: calls are attributed to their session\'s agent', () => {
  it('sends a subagent\'s write with its role as agent_type', async () => {
    const dir = stubProject();
    await call(dir, 'write', { filePath: join(dir, 'a.txt'), content: 'x' }, { sessionID: 'ses_audit' });
    expect(payloads(dir)[0]).toMatchObject({ tool_name: 'Write', agent_type: 'audit', session_id: 'ses_root' });
  });
  it('treats a primary session running a conductor agent as that role', async () => {
    const dir = stubProject();
    await call(dir, 'write', { filePath: join(dir, 'a.txt'), content: 'x' }, { sessionID: 'ses_primary_code' });
    expect(payloads(dir)[0]).toMatchObject({ agent_type: 'code', session_id: 'ses_primary_code' });
  });
  it('looks a subagent session up once, and its primary root on every call', async () => {
    const lookups = [];
    const before = await hookFor(stubProject(), fakeClient(lookups));
    for (let i = 0; i < 3; i++) await callWith(before, 'bash', { command: 'git status' }, 'ses_code');
    expect(lookups.sort()).toEqual(['ses_code', 'ses_root', 'ses_root', 'ses_root']);
  });
  it('sees a primary session\'s agent change on the next call', async () => {
    const sessions = { ses_p: { id: 'ses_p', agent: 'build' } };
    const client = { session: { get: async ({ path: { id } }) => ({ data: sessions[id] }) } };
    const dir = stubProject();
    const before = await hookFor(dir, client);
    const write = { filePath: join(dir, 'a.txt'), content: 'x' };
    await callWith(before, 'write', write, 'ses_p');
    sessions.ses_p = { id: 'ses_p', agent: 'conductor-code' };
    await callWith(before, 'write', write, 'ses_p');
    const [first, second] = payloads(dir);
    expect(first).not.toHaveProperty('agent_type');
    expect(second).toMatchObject({ agent_type: 'code' });
  });
});

describe('OpenCode plugin: band role shells through the real guard (AC5)', () => {
  it('denies audit any shell (Guard 7)', async () => {
    expect(await call(project, 'bash', { command: 'git status' }, { sessionID: 'ses_audit' })).toMatch(/Guard 7: ROLE_SHELL_DENIED/);
  });
  it('denies code a shell when no run records its test command (Guard 7)', async () => {
    expect(await call(project, 'bash', { command: 'git status' }, { sessionID: 'ses_code' })).toMatch(/Guard 7: ROLE_SHELL_UNRESOLVED/);
  });
  it('lets the primary session run the same command', async () => {
    setAllowlist([]);
    expect(await call(project, 'bash', { command: 'git status' })).toBe('');
  });
});

describe('OpenCode plugin: fails closed when the session cannot be identified (AC6)', () => {
  const throwing = { session: { get: async () => { throw new Error('offline'); } } };
  const empty = { session: { get: async () => ({}) } };
  it.each([
    ['an unknown session', { sessionID: 'ses_missing' }],
    ['a subagent session with no agent', { sessionID: 'ses_noagent' }],
    ['a lookup that throws', { client: throwing }],
    ['a lookup with no data', { client: empty }],
    ['no client', { client: null }],
  ])('blocks a mapped call for %s without spawning the guard', async (_label, opts) => {
    const dir = stubProject();
    expect(await call(dir, 'bash', { command: 'git status' }, opts)).toMatch(IDENTIFY);
    expect(payloads(dir)).toEqual([]);
  });
  it('still lets read-only tools through with no client', async () => {
    expect(await call(bare, 'grep', { pattern: 'x' }, { client: null })).toBe('');
  });
  it('does not cache a failed lookup', async () => {
    let fail = true;
    const flaky = { session: { get: async ({ path: { id } }) => (fail ? {} : { data: SESSIONS[id] }) } };
    const dir = stubProject();
    const before = await hookFor(dir, flaky);
    expect(await callWith(before, 'bash', { command: 'git status' })).toMatch(IDENTIFY);
    fail = false;
    expect(await callWith(before, 'bash', { command: 'git status' })).toBe('');
  });
});

describe('OpenCode plugin: fails closed on what it cannot inspect', () => {
  it('blocks batch and unknown tools without spawning the guard (AC4)', async () => {
    for (const tool of ['batch', 'some_mcp_tool', 'shell', 'subagent', 'execute']) {
      const reason = await call(bare, tool, {});
      expect(reason).toMatch(UNCOVERED);
      expect(reason).toContain(`"${tool}"`);
      expect(reason).not.toMatch(NOT_RUN);
    }
  });
  it('lets read-only tools through without spawning the guard (AC5)', async () => {
    for (const tool of ['glob', 'grep', 'list', 'lsp', 'todoread', 'todowrite', 'webfetch', 'websearch', 'codesearch', 'question', 'skill', 'invalid']) {
      expect(await call(bare, tool, { pattern: '**/*.js', url: 'https://example.com' })).toBe('');
    }
  });
});

describe('OpenCode plugin: argument checks (AC6)', () => {
  const cases = [
    ['write with path instead of filePath', 'write', { path: 'a.txt', content: 'x' }, /filePath/],
    ['bash without command', 'bash', { description: 'x' }, /command/],
    ['read with a non-string filePath', 'read', { filePath: 7 }, /filePath/],
    ['multiedit with no edits', 'multiedit', { filePath: 'a.txt', edits: [] }, /edits/],
    ['multiedit with an entry missing newString', 'multiedit', { filePath: 'a.txt', edits: [{ oldString: 'a' }] }, /newString/],
    ['apply_patch without patchText', 'apply_patch', {}, /patchText/],
    ['apply_patch with a non-string patchText', 'apply_patch', { patchText: ['x'] }, /patchText/],
  ];
  it.each(cases)('blocks %s before the guard runs', async (_label, tool, args, arg) => {
    const dir = stubProject();
    const reason = await call(dir, tool, args);
    expect(reason).toMatch(arg);
    expect(reason).toContain(`"${tool}"`);
    expect(payloads(dir)).toEqual([]);
  });
});

describe('OpenCode plugin: bash arguments outside the known set (BUG-071)', () => {
  const REASON_TAIL = 'not supported; the guard checks a command as if it runs in the project directory, so drop the argument and put any cd in the command, where the guard sees it';

  it.each(['workdir', 'cwd', 'directory'])('blocks bash with a %s argument before the guard runs (AC1)', async (k) => {
    const dir = stubProject();
    const reason = await call(dir, 'bash', { command: 'git status', [k]: '/tmp' });
    expect(reason).toBe(`code-conductor guard blocked "bash": argument "${k}" is ${REASON_TAIL}`);
    expect(reason).not.toMatch(NOT_RUN);
    expect(payloads(dir)).toEqual([]);
  });

  it('blocks bash with any other argument outside command, description and timeout (AC2)', async () => {
    const dir = stubProject();
    const reason = await call(dir, 'bash', { command: 'ls', env: { X: '1' } });
    expect(reason).toBe(`code-conductor guard blocked "bash": argument "env" is ${REASON_TAIL}`);
    expect(payloads(dir)).toEqual([]);
  });

  it('names every unknown argument, sorted, in one reason (AC2)', async () => {
    const dir = stubProject();
    const reason = await call(dir, 'bash', { command: 'ls', workdir: '/tmp', cwd: '/x' });
    expect(reason).toBe(`code-conductor guard blocked "bash": arguments "cwd", "workdir" are ${REASON_TAIL}`);
    expect(payloads(dir)).toEqual([]);
  });

  it('sends a call with command, description and timeout to the guard as Bash { command } (AC3)', async () => {
    const dir = stubProject();
    expect(await call(dir, 'bash', { command: 'git status', description: 'd', timeout: 1000 })).toBe('');
    const seen = payloads(dir);
    expect(seen).toHaveLength(1);
    expect(seen[0].tool_name).toBe('Bash');
    expect(seen[0].tool_input).toEqual({ command: 'git status' });
  });

  it('treats an unknown argument whose value is undefined as absent (AC4)', async () => {
    const dir = stubProject();
    expect(await call(dir, 'bash', { command: 'git status', workdir: undefined })).toBe('');
    const seen = payloads(dir);
    expect(seen).toHaveLength(1);
    expect(seen[0].tool_input).toEqual({ command: 'git status' });
  });
});

describe('OpenCode plugin: multiedit (AC2)', () => {
  it('runs the guard once per entry and passes on an allowed path', async () => {
    const dir = stubProject();
    const file = join(dir, 'ok.txt');
    expect(await call(dir, 'multiedit', { filePath: file, edits: [{ oldString: 'a', newString: 'b' }, { oldString: 'c', newString: 'd' }] })).toBe('');
    const seen = payloads(dir);
    expect(seen).toHaveLength(2);
    expect(seen.map((p) => p.tool_name)).toEqual(['Edit', 'Edit']);
    expect(seen[1].tool_input).toMatchObject({ file_path: file, old_string: 'c', new_string: 'd' });
  });
  it('blocks with the guard reason on a denied path', async () => {
    const dir = stubProject();
    const file = join(dir, 'denied.txt');
    expect(await call(dir, 'multiedit', { filePath: file, edits: [{ oldString: 'a', newString: 'b' }] })).toBe(`STUB DENY ${file}`);
  });
});

describe('OpenCode plugin: patch tool (AC1, AC7, AC8, AC8b)', () => {
  it.each(['apply_patch', 'patch'])('blocks %s adding an existing file with the same reason as write (AC1, Guard 2)', async (tool) => {
    const file = join(project, 'patched.txt');
    writeFileSync(file, 'old\n');
    const viaWrite = await call(project, 'write', { filePath: file, content: 'new\n' });
    expect(viaWrite).toMatch(/FILE ALREADY EXISTS/);
    expect(await call(project, tool, { patchText: patch('*** Add File: patched.txt', '+new') })).toBe(viaWrite);
  });
  it('blocks a move onto an existing file with Guard 2 for the target (AC8b)', async () => {
    const target = join(project, 'moved-onto.txt');
    writeFileSync(target, 'old\n');
    const reason = await call(project, 'apply_patch', { patchText: patch('*** Update File: fresh-src.txt', '*** Move to: moved-onto.txt', '@@', '-a', '+b') });
    expect(reason).toMatch(/FILE ALREADY EXISTS/);
    expect(reason).toContain('moved-onto.txt');
  });
  it('blocks a Move to that does not follow an Update File section', async () => {
    const dir = stubProject();
    expect(await call(dir, 'apply_patch', { patchText: patch('*** Add File: a.txt', '+x', '*** Move to: b.txt') })).toMatch(/Move to/);
    expect(payloads(dir)).toEqual([]);
  });
  it('checks every file of a multi-file patch, resolving paths against the project', async () => {
    const dir = stubProject();
    expect(await call(dir, 'apply_patch', { patchText: patch('*** Update File: a.txt', '@@', '-x', '+y', '*** Update File: sub/b.txt', '@@', '-x', '+y') })).toBe('');
    const seen = payloads(dir);
    expect(seen).toHaveLength(2);
    expect(seen.map((p) => p.tool_input.file_path)).toEqual([join(dir, 'a.txt'), join(dir, 'sub', 'b.txt')]);
    expect(seen[0].tool_input).toMatchObject({ old_string: 'x', new_string: 'y' });
  });
  it('blocks the whole patch when one file is denied', async () => {
    const dir = stubProject();
    const reason = await call(dir, 'apply_patch', { patchText: patch('*** Update File: a.txt', '@@', '-x', '+y', '*** Update File: denied.txt', '@@', '-x', '+y') });
    expect(reason).toBe(`STUB DENY ${join(dir, 'denied.txt')}`);
  });
  const grammar = [
    ['an indented marker', patch('*** Update File: a.txt', '+y', '  *** Add File: denied.txt', '+x')],
    ['a marker without its space', patch('*** Add File:a.txt', '+x')],
    ['an unknown marker', patch('*** Copy File: a.txt')],
    ['no file marker', patch('+x')],
    ['an empty marker path', patch('*** Add File: ', '+x')],
    ['a marker path with leading whitespace', patch('*** Add File:  a.txt', '+x')],
    ['a marker path with trailing whitespace', patch('*** Add File: a.txt ', '+x')],
  ];
  it.each(grammar)('blocks a patch with %s before the guard runs (AC7)', async (_label, text) => {
    const dir = stubProject();
    expect(await call(dir, 'apply_patch', { patchText: text })).not.toBe('');
    expect(payloads(dir)).toEqual([]);
  });
  it('reads a CRLF patch like its LF form (AC7)', async () => {
    const lf = patch('*** Add File: denied.txt', '+x');
    const a = stubProject();
    const b = stubProject();
    const viaLf = await call(a, 'apply_patch', { patchText: lf });
    expect(await call(b, 'apply_patch', { patchText: lf.replace(/\n/g, '\r\n') })).toBe(viaLf.replace(a, b));
  });
  const outside = [['../x'], ['..\\x'], ['/etc/x'], ['C:\\x'], ['sub\\x'], ['.']];
  it.each(outside)('blocks the marker path %s before the guard runs (AC8)', async (p) => {
    const dir = stubProject();
    expect(await call(dir, 'apply_patch', { patchText: patch(`*** Add File: ${p}`, '+x') })).not.toBe('');
    expect(payloads(dir)).toEqual([]);
  });
});
