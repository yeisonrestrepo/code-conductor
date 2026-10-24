import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// FEAT-044 T-004: the flow event emitter in the PreToolUse hook. Every case spawns the
// shipped hook against a temporary project, the way Claude Code does.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HOOK = join(REPO_ROOT, 'project-template/.claude/hooks/pre-tool-use.mjs');
const LOOP = 'for f in *; do cat "$f"; done';

// A caller's own switches must not decide these cases: CLAUDE_PROJECT_DIR roots Guard 3's
// allowlist (BUG-061), and an inherited CC_FLOW_OFF would silence every assertion.
function hookEnv(extra) {
  const env = { ...process.env, ...extra };
  for (const k of ['CLAUDE_PROJECT_DIR', 'CC_GUARD3_WARN', 'CC_HOOK_ALLOW', 'CC_HOOK_DEBUG']) if (!(k in extra)) delete env[k];
  if (!('CC_FLOW_OFF' in extra)) delete env.CC_FLOW_OFF;
  return env;
}

function fire(payload, extra = {}) {
  const input = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const r = spawnSync(process.execPath, [HOOK], { input, env: hookEnv(extra), encoding: 'utf8', timeout: 15000 });
  if (r.error) throw r.error;
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function fireAsync(payload) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [HOOK], { env: hookEnv({}) });
    child.on('close', done);
    child.stdin.end(JSON.stringify(payload));
  });
}

let work, cwd, events;
beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'cc-flow-'));
  cwd = join(work, 'proj');
  mkdirSync(join(cwd, '.claude'), { recursive: true });
  events = join(cwd, '.claude', '.flow-events.jsonl');
});
afterEach(() => rmSync(work, { recursive: true, force: true }));

const call = (tool, input, extra = {}) => ({ tool_name: tool, tool_input: input, cwd, ...extra });
const bash = (command, extra) => call('Bash', { command }, extra);
const lines = () => readFileSync(events, 'utf8').split('\n').filter(Boolean);
const read = () => lines().map((l) => JSON.parse(l));
const last = () => read().at(-1);
// 5000 seeded lines of 41 bytes are about 200 KiB, past the 160 KiB cap.
const seed = (n, line = '{"ts":1,"tool":"Read","verdict":"allow"}') => writeFileSync(events, `${line}\n`.repeat(n));

function writeRun(extra = {}) {
  mkdirSync(join(cwd, '.claude', 'memory'), { recursive: true });
  const run = { item: 'FEAT-044', session_id: 'S1', started: 'now', ...extra };
  writeFileSync(join(cwd, '.claude', 'memory', 'orchestrator-run.json'), JSON.stringify(run));
}

describe('one event per routed call (AC1)', () => {
  it.each([
    ['Read', { file_path: 'small.txt' }, [4, 1]],
    ['Write', { file_path: 'new.txt', content: 'x' }, [5, 6, 2]],
    ['Edit', { file_path: 'a.txt', old_string: 'a', new_string: 'b' }, [5, 6]],
    ['Bash', { command: 'git status' }, [7, 3]],
    ['Agent', { subagent_type: 'Explore', prompt: 'x' }, [6]],
  ])('records an allow on the %s lane with the D5 fields', (tool, input, passed) => {
    fire(call(tool, input));
    const ev = last();
    expect(Object.keys(ev).sort()).toEqual(['agent', 'code', 'guard', 'passed', 'target', 'tool', 'ts', 'verdict']);
    expect(ev).toMatchObject({ tool, verdict: 'allow', guard: null, code: null, agent: null, passed });
    expect(typeof ev.ts).toBe('number');
    expect(lines()).toHaveLength(1);
  });

  it('records a file target relative to the payload cwd', () => {
    fire(call('Edit', { file_path: join(cwd, 'src', 'a.js'), old_string: 'a', new_string: 'b' }));
    expect(last().target).toBe('src/a.js');
  });

  it('records the agent type as an Agent call target', () => {
    fire(call('Agent', { subagent_type: 'Explore', prompt: 'x' }));
    expect(last().target).toBe('Explore');
  });

  it('writes nothing for a tool with no dispatch entry', () => {
    fire(call('NotebookEdit', {}));
    expect(existsSync(events)).toBe(false);
  });
});

describe('a deny records the deciding guard, its own code and the guards before it (AC1)', () => {
  it('Guard 1', () => {
    writeFileSync(join(cwd, 'big.txt'), 'x\n'.repeat(200));
    fire(call('Read', { file_path: join(cwd, 'big.txt') }));
    expect(last()).toMatchObject({ verdict: 'deny', guard: 1, code: 'LARGE_FILE_READ', passed: [4] });
  });

  it('Guard 2 asks, and the event says ask', () => {
    writeFileSync(join(cwd, 'exists.txt'), 'x\n');
    fire(call('Write', { file_path: join(cwd, 'exists.txt'), content: 'y' }));
    expect(last()).toMatchObject({ verdict: 'ask', guard: 2, code: 'FILE_EXISTS', passed: [5, 6] });
  });

  it('Guard 3', () => {
    fire(bash(LOOP));
    expect(last()).toMatchObject({ verdict: 'deny', guard: 3, code: 'P9', passed: [7], target: 'for' });
  });

  it('Guard 3 under CC_GUARD3_WARN records an ask', () => {
    fire(bash(LOOP), { CC_GUARD3_WARN: '1' });
    expect(last()).toMatchObject({ verdict: 'ask', guard: 3, code: 'P9' });
  });

  it('Guard 4', () => {
    fire(call('Read', { file_path: 'node_modules/x/index.js' }));
    expect(last()).toMatchObject({ verdict: 'deny', guard: 4, code: 'NODE_MODULES', passed: [] });
  });

  it('Guard 5', () => {
    mkdirSync(join(cwd, '.claude', 'memory'), { recursive: true });
    writeFileSync(join(cwd, '.claude', 'memory', 'band-envelope.json'), 'not json');
    fire(call('Write', { file_path: 'x.js', content: 'x' }, { agent_type: 'code' }));
    expect(last()).toMatchObject({ verdict: 'deny', guard: 5, code: 'BAND_ENVELOPE_INVALID', passed: [], agent: 'code' });
  });

  it('Guard 6', () => {
    writeRun();
    fire(call('Write', { file_path: 'src/x.js', content: 'x' }, { session_id: 'S1' }));
    expect(last()).toMatchObject({ verdict: 'deny', guard: 6, code: 'ORCH_WRITE_DENIED', passed: [5] });
  });

  it('Guard 7', () => {
    fire(bash('git status', { agent_type: 'audit' }));
    expect(last()).toMatchObject({ verdict: 'deny', guard: 7, code: 'ROLE_SHELL_DENIED', passed: [], agent: 'audit' });
  });

  it('a top-level call records agent null', () => {
    fire(bash('git status'));
    expect(last().agent).toBeNull();
  });
});

describe('fail-open (AC2)', () => {
  it.each([
    ['an allow', () => bash('git status')],
    ['a deny', () => bash(LOOP)],
    ['an ask', () => { writeFileSync(join(cwd, 'e.txt'), 'x'); return call('Write', { file_path: join(cwd, 'e.txt'), content: 'y' }); }],
  ])('on %s, an unwritable event path leaves stdout, stderr and exit code identical to CC_FLOW_OFF', (_, make) => {
    const payload = make();
    mkdirSync(events);
    const on = fire(payload);
    const off = fire(payload, { CC_FLOW_OFF: '1' });
    expect(on).toEqual(off);
  });

  it('CC_FLOW_OFF creates no file', () => {
    fire(bash('git status'), { CC_FLOW_OFF: '1' });
    expect(readdirSync(join(cwd, '.claude'))).toEqual([]);
  });

  it.each(['0', 'true'])('CC_FLOW_OFF=%s still records, because only 1 turns the log off', (value) => {
    fire(bash('git status'), { CC_FLOW_OFF: value });
    expect(last().target).toBe('git');
  });

  it('no .claude/ directory creates no file and no directory', () => {
    const bare = join(work, 'bare');
    mkdirSync(bare);
    fire({ tool_name: 'Bash', tool_input: { command: 'git status' }, cwd: bare });
    expect(readdirSync(bare)).toEqual([]);
  });

  it('an unparseable payload still fails closed and writes no event', () => {
    const r = fire('{not json');
    expect(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
    expect(existsSync(events)).toBe(false);
  });

  it('the decision output carries no flow field', () => {
    const r = fire(bash(LOOP));
    expect(Object.keys(JSON.parse(r.stdout).hookSpecificOutput).sort()).toEqual(['hookEventName', 'permissionDecision', 'permissionDecisionReason']);
  });
});

describe('rotation under the lock (AC6)', () => {
  it('a file past 160 KiB holds 251 parseable lines after one call, and no lock remains', () => {
    seed(5000);
    fire(bash('git status'));
    expect(lines()).toHaveLength(251);
    expect(read().at(-1).tool).toBe('Bash');
    expect(readdirSync(join(cwd, '.claude'))).toEqual(['.flow-events.jsonl']);
  });

  it('breaks a lock older than 10 s and rotates', () => {
    seed(5000);
    const lock = join(cwd, '.claude', '.flow-events.lock');
    writeFileSync(lock, '');
    const old = new Date(Date.now() - 60000);
    utimesSync(lock, old, old);
    fire(bash('git status'));
    expect(lines()).toHaveLength(251);
    expect(existsSync(lock)).toBe(false);
  });

  it('skips rotation under a fresh lock and still appends', () => {
    seed(5000);
    writeFileSync(join(cwd, '.claude', '.flow-events.lock'), '');
    fire(bash('git status'));
    expect(lines()).toHaveLength(5001);
    expect(last().tool).toBe('Bash');
  });

  it('fences a torn tail: the next event is its own line and parses', () => {
    writeFileSync(events, '{"ts":1,"tool":"Read","verdict":"allow"}\n{"ts":1,"tool":"Ba');
    fire(bash('git status'));
    expect(lines()).toEqual(['{"ts":1,"tool":"Read","verdict":"allow"}', '{"ts":1,"tool":"Ba', lines().at(-1)]);
    expect(JSON.parse(lines().at(-1)).tool).toBe('Bash');
  });

  it('drops a fenced torn line at the next rotation', () => {
    writeFileSync(events, `${'{"ts":1,"tool":"Read","verdict":"allow"}\n'.repeat(5000)}{"ts":1,"tool":"Ba`);
    fire(bash('git status'));
    expect(lines()).toHaveLength(251);
    expect(read().at(-1).tool).toBe('Bash');
  });

  it('writes no line ending for a later event to fuse onto: each event leads with its newline', () => {
    fire(bash('git status'));
    fire(bash('git log'));
    expect(readFileSync(events, 'utf8')).toMatch(/^\n\{[^\n]*\}\n\{[^\n]*\}$/);
  });

  it('64 parallel hook calls past the cap leave every line parseable and nothing stranded', async () => {
    seed(5000);
    await Promise.all(Array.from({ length: 64 }, () => fireAsync(bash('git status'))));
    for (const l of lines()) expect(() => JSON.parse(l)).not.toThrow();
    expect(lines().length).toBeLessThan(5000);
    expect(readdirSync(join(cwd, '.claude'))).toEqual(['.flow-events.jsonl']);
  }, 60000);
});

describe('what a target may hold (AC9)', () => {
  it.each([
    ['TOKEN=sk-PROBE-123 curl -H "Authorization: Bearer sk-PROBE-456" x', 'curl'],
    ['A=1 B=2 git push', 'git'],
  ])('%s records only the command word', (command, target) => {
    fire(bash(command));
    expect(last().target).toBe(target);
    const text = readFileSync(events, 'utf8');
    expect(text).not.toContain('sk-PROBE');
    expect(text).not.toContain('Bearer');
    expect(text).not.toContain('push');
  });

  // A quoted value holding a space split as plain words left a fragment as the target:
  // `PASSWORD='hunter two' psql` recorded `two'` (review of PR #89).
  it.each([
    ["PASSWORD='hunter PROBE' psql -c x", 'psql'],
    ['TOKEN="sk-abc PROBE" curl x', 'curl'],
    ["A=1 KEY=$'PROBE one' git push", 'git'],
    ['K="$(get PROBE)" curl x', 'curl'],
    ['"/my dir/PROBE tool" run', '"/my dir/PROBE tool"'],
    ['a\\ PROBE run', 'a\\ PROBE'],
  ])('%s records the whole command word and no value fragment', (command, target) => {
    fire(bash(command));
    expect(last().target).toBe(target);
    if (!target.includes('PROBE')) expect(readFileSync(events, 'utf8')).not.toContain('PROBE');
  });

  it.each([
    ['an unquoted substitution', 'K=$(get PROBE) curl x'],
    ['a backtick substitution', 'K=`get PROBE` curl x'],
    ['a braced expansion', 'K=${V:- PROBE} curl x'],
    ['an unclosed quote', "PASSWORD='hunter PROBE psql"],
  ])('%s records an empty target', (_, command) => {
    fire(bash(command));
    expect(last().target).toBe('');
    expect(readFileSync(events, 'utf8')).not.toContain('PROBE');
  });

  it('a target holding a quote and a newline is one line that parses back to the same string', () => {
    const nasty = 'a"b\nc</x>';
    fire(call('Agent', { subagent_type: nasty, prompt: 'x' }));
    expect(lines()).toHaveLength(1);
    expect(last().target).toBe(nasty);
  });

  it('caps the target at 200 characters', () => {
    fire(bash('x'.repeat(5000)));
    expect(last().target).toHaveLength(200);
  });
});

describe('Guard 4 covers the event file (AC10)', () => {
  it.each([
    '.claude/.flow-events.jsonl', '.claude\\.flow-events.jsonl', '.claude/.flow-events.jsonl.tmp',
  ])('denies Read of %s', (file_path) => {
    const r = fire(call('Read', { file_path }));
    const out = JSON.parse(r.stdout).hookSpecificOutput;
    expect(out.permissionDecision).toBe('deny');
    expect(out.permissionDecisionReason).toMatch(/Guard 4/);
  });

  it('denies an absolute path to it', () => {
    const r = fire(call('Read', { file_path: events }));
    expect(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
  });

  it('allows a file that merely shares the prefix', () => {
    const r = fire(call('Read', { file_path: 'docs/.flow-events.jsonl.md' }));
    expect(r.stdout).toBe('');
  });
});
