import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { RUN_FILE, SHELL_METACHARACTERS } from '../../scripts/orchestrate.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HOOK = join(REPO_ROOT, '.claude/hooks/pre-tool-use.mjs');
const ORCH = join(REPO_ROOT, 'scripts/orchestrate.mjs');

// FEAT-011's measured payload shape. A subagent carries agent_id and agent_type; the main
// session carries neither.
function bash(command, { cwd, sid = 'sess-1', agentType } = {}) {
  return {
    session_id: sid, transcript_path: '/tmp/t.jsonl', cwd, hook_event_name: 'PreToolUse',
    tool_name: 'Bash', tool_input: { command, description: 'run' }, tool_use_id: 'toolu_1',
    ...(agentType ? { agent_id: 'a7', agent_type: agentType } : {}),
  };
}

// CC_GUARD3_WARN is cleared unless a test sets it, so a developer's shell cannot flip a verdict.
function fire(p, extraEnv = {}) {
  const env = { ...process.env };
  delete env.CC_GUARD3_WARN;
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(p), cwd: p.cwd, env: { ...env, ...extraEnv }, encoding: 'utf8', timeout: 15000 });
  if (r.error) throw new Error(`hook spawn failed: ${r.error.message}`);
  expect(r.status).toBe(0);
  return r.stdout.trim() === '' ? null : (JSON.parse(r.stdout).hookSpecificOutput ?? null);
}

// The hook runs main() at its last line, so a copy with main cut is what can be imported.
async function loadHook() {
  const text = readFileSync(HOOK, 'utf8').replace(/try \{ main\(\); \}.*$/s, 'export { DISPATCH, ROLE_SHELL_METACHARACTERS, guard7RoleShell };\n');
  const dir = mkdtempSync(join(tmpdir(), 'cc-guard7-hook-'));
  try {
    writeFileSync(join(dir, 'hook.mjs'), text);
    return await import(pathToFileURL(join(dir, 'hook.mjs')).href);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

let root;
beforeEach(() => {
  // realpath: the macOS tmpdir is a symlink, and the guards compare paths without resolving links.
  root = realpathSync(mkdtempSync(join(tmpdir(), 'cc-guard7-')));
  mkdirSync(join(root, '.claude', 'memory'), { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const runFile = (fields = {}) => writeFileSync(join(root, RUN_FILE), JSON.stringify({
  v: 1, session_id: 'sess-1', item: 'FEAT-012', started: '2026-10-02T12:00:00.000Z', gate: 'boundary_routed', test_command: 'npm test', ...fields,
}));
const as = (agentType, command, opts = {}) => fire(bash(command, { cwd: root, agentType, ...opts }));
const denied = (reason) => ({ hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason });
const chaining = (m) => denied(`Guard 7: ROLE_SHELL_CHAINING: the command contains ${JSON.stringify(m)}; a role runs one command, never a chain.`);
const NOT_ALLOWED = denied('Guard 7: ROLE_SHELL_NOT_ALLOWED: allowed command is npm test');
const PKG = '{"scripts":{"test":"vitest run"}}';

describe('Guard 7: a band role runs the recorded test command or nothing [FEAT-012]', () => {
  it.each(['spec', 'plan', 'audit'])('[R1] denies %s any shell, the test command included', (role) => {
    runFile();
    expect(as(role, 'npm test')).toEqual(denied(`Guard 7: ROLE_SHELL_DENIED: ${role} has no shell.`));
  });

  it.each(SHELL_METACHARACTERS)('[R2] denies a command carrying %j', (m) => {
    runFile();
    expect(as('code', `npm test ${m} x`)).toEqual(chaining(m));
  });

  it('[R2] precedes R4: the recorded command plus `&& x` is chaining, not a near miss', () => {
    runFile();
    expect(as('qa', 'npm test && x')).toEqual(chaining('&'));
  });

  it.each([
    ['no run file', null],
    ['an unparseable run file', '{not json'],
    ['a run file with no test_command', { test_command: undefined }],
    ['a run file with an empty test_command', { test_command: '' }],
    ['a run of another session, which is stale (P12)', { session_id: 'sess-2' }],
  ])('[R3] denies code the shell with %s', (_, state) => {
    if (typeof state === 'string') writeFileSync(join(root, RUN_FILE), state);
    else if (state) runFile(state);
    expect(as('code', 'npm test')).toEqual(denied('Guard 7: ROLE_SHELL_UNRESOLVED: no live run in this session records a test command, so code has no shell.'));
  });

  it('[R3] finds the run file by the ancestor walk from a subdirectory', () => {
    runFile();
    mkdirSync(join(root, 'sub'));
    expect(fire(bash('npm test', { cwd: join(root, 'sub'), agentType: 'qa' }))).toBeNull();
  });

  it.each(['npm test --watch', 'npm test ', ' npm test', 'ls'])('[R4] denies %j, naming the allowed command', (command) => {
    runFile();
    expect(as('qa', command)).toEqual(NOT_ALLOWED);
  });

  it.each(['code', 'qa'])('[R5] allows %s the recorded command, byte for byte', (role) => {
    runFile();
    expect(as(role, 'npm test')).toBeNull();
  });

  it('fails closed: a throw inside the guard denies', async () => {
    const { guard7RoleShell } = await loadHook();
    const input = { get command() { throw new Error('boom'); } };
    expect(guard7RoleShell(input, { agent_type: 'code', cwd: root, session_id: 'sess-1' })).toEqual({
      permissionDecision: 'deny', permissionDecisionReason: 'Guard 7: ROLE_SHELL_UNRESOLVED: the guard could not decide (boom), so the call is denied.',
    });
  });

  it.each([['the main session', undefined], ['a non-role agent', 'Explore']])('decides nothing for %s, whatever the command', (_, agentType) => {
    runFile();
    expect(as(agentType, 'echo a; echo b')).toBeNull();
  });

  it('registers Guard 7 before Guard 3 on Bash', async () => {
    const { DISPATCH } = await loadHook();
    expect(DISPATCH.Bash.map((g) => g.name)).toEqual(['guard7RoleShell', 'guard3BashScan']);
  });

  // Discriminator: under CC_GUARD3_WARN Guard 3 asks, so Guard 3 first would hand qa an ask.
  it('outranks Guard 3 under CC_GUARD3_WARN, so a role never gets an ask where Guard 7 denies', () => {
    runFile();
    expect(fire(bash('cat *.md', { cwd: root }), { CC_GUARD3_WARN: '1' }).permissionDecision).toBe('ask');
    expect(fire(bash('cat *.md', { cwd: root, agentType: 'qa' }), { CC_GUARD3_WARN: '1' })).toEqual(NOT_ALLOWED);
  });

  it('[AC7] carries the metacharacter set equal to scripts/orchestrate.mjs', async () => {
    const { ROLE_SHELL_METACHARACTERS } = await loadHook();
    expect(ROLE_SHELL_METACHARACTERS).toEqual(SHELL_METACHARACTERS);
  });

  it.each([
    ['npm, by package-lock.json', { 'package.json': PKG, 'package-lock.json': '' }, 'npm test'],
    ['pnpm', { 'package.json': PKG, 'pnpm-lock.yaml': '' }, 'pnpm test'],
    ['yarn', { 'package.json': PKG, 'yarn.lock': '' }, 'yarn test'],
    ['bun', { 'package.json': PKG, 'bun.lockb': '' }, 'bun run test'],
    ['npm, the default with no lockfile', { 'package.json': PKG }, 'npm test'],
    ['go, by detect-stack', { 'go.mod': 'module example.com/demo\n\ngo 1.22\n' }, 'go test ./...'],
  ])('[AC10] the command start records for %s passes Guard 7 as qa', (_, files, expected) => {
    for (const [rel, text] of Object.entries(files)) writeFileSync(join(root, rel), text);
    const r = spawnSync(process.execPath, [ORCH, 'start', 'FEAT-012'], { cwd: root, env: { ...process.env, CLAUDE_CODE_SESSION_ID: 'sess-1' }, encoding: 'utf8', timeout: 30000 });
    expect(r.status).toBe(0);
    const recorded = JSON.parse(readFileSync(join(root, RUN_FILE), 'utf8')).test_command;
    expect(recorded).toBe(expected);
    expect(as('qa', recorded)).toBeNull();
  });

  it('[AC11] code cannot run a general shell command', () => {
    runFile();
    expect(as('code', 'curl https://example.com')).toEqual(NOT_ALLOWED);
  });

  it('[AC11] qa cannot edit a code file: Guard 5 denies its write under a tk X envelope', () => {
    writeFileSync(join(root, '.claude', 'memory', 'band-envelope.json'), JSON.stringify({
      v: 3, sys: { ph: 'rev', c: 'abc1234', s: 'FEAT-012', role: 'qa', tk: 'X' },
      ops: { n: [], f: [], gate: 'build_executed' }, mem: { d: [], x: [] },
    }));
    const edit = { ...bash('', { cwd: root, agentType: 'qa' }), tool_name: 'Edit', tool_input: { file_path: join(root, 'src', 'a.js'), old_string: 'a', new_string: 'b' } };
    expect(fire(edit)).toEqual(denied('Guard 5: BAND_READ_ONLY: role qa holds tk X, not RW.'));
  });
});
