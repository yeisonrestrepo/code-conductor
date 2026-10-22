import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deployProject } from '../../lib/installer/deploy.mjs';
import { mergeFlowStatusLine, FLOW_STATUS_COMMAND } from '../../lib/installer/settings.mjs';

// FEAT-044 T-007: the flow status line script and /cc-flow, spawned against seeded files.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = join(ROOT, 'project-template/.claude/flow-status.mjs');
const HOOK = join(ROOT, 'project-template/.claude/hooks/pre-tool-use.mjs');
const { LANES, TAIL_BYTES, readTail } = await import(pathToFileURL(SCRIPT).href);

let work, events;
beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'cc-flow-status-'));
  mkdirSync(join(work, '.claude'));
  events = join(work, '.claude', '.flow-events.jsonl');
});
afterEach(() => rmSync(work, { recursive: true, force: true }));

const ev = (fields) => ({ ts: 1760364151000, tool: 'Bash', verdict: 'allow', guard: null, code: null, target: 'git', agent: null, passed: [7, 3], ...fields });
const seed = (list) => writeFileSync(events, list.map((e) => `${JSON.stringify(e)}\n`).join(''));
const allows = (n) => Array.from({ length: n }, () => ev({}));
const denies = (n) => Array.from({ length: n }, () => ev({ verdict: 'deny', guard: 3, code: 'P9', passed: [7] }));

function run(args = [], { stdin = JSON.stringify({ workspace: { current_dir: work } }), env = {}, cwd = work } = {}) {
  const base = { ...process.env, ...env };
  if (!('CC_FLOW_OFF' in env)) delete base.CC_FLOW_OFF;
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { input: stdin, cwd, env: base, encoding: 'utf8', timeout: 15000 });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe('the D2 state table (AC3)', () => {
  it('no event file prints an empty line', () => {
    expect(run()).toEqual({ status: 0, stdout: '\n', stderr: '' });
  });

  it('last event a deny', () => {
    seed([...allows(9), ...denies(3)]);
    expect(run()).toMatchObject({ status: 0, stdout: '⛔ G3 P9 · 12 calls · 3 deny\n' });
  });

  it('last event an ask', () => {
    seed([...allows(11), ev({ tool: 'Write', verdict: 'ask', guard: 2, passed: [5, 6] })]);
    expect(run()).toMatchObject({ status: 0, stdout: '? G2 · 12 calls · 1 ask\n' });
  });

  it('last event an allow', () => {
    seed([...denies(3), ...allows(9)]);
    expect(run()).toMatchObject({ status: 0, stdout: '✓ 12 calls · 3 deny\n' });
  });

  it('an unreadable tail', () => {
    writeFileSync(events, `${JSON.stringify(ev({}))}\n{"ts":1,"tool":"Ba`);
    expect(run()).toMatchObject({ status: 0, stdout: 'flow: unreadable, retrying\n' });
  });

  it('counts only the current session when Claude Code passes its elapsed time', () => {
    const now = Date.now();
    seed([...denies(5).map((e) => ({ ...e, ts: now - 3600000 })), ...allows(2).map((e) => ({ ...e, ts: now }))]);
    const stdin = JSON.stringify({ workspace: { current_dir: work }, cost: { total_duration_ms: 60000 } });
    expect(run([], { stdin }).stdout).toBe('✓ 2 calls · 0 deny\n');
  });

  it('falls back to the process directory when stdin carries none', () => {
    seed(denies(1));
    expect(run([], { stdin: '' }).stdout).toBe('⛔ G3 P9 · 1 calls · 1 deny\n');
  });

  it('CC_FLOW_OFF blanks the line', () => {
    seed(denies(1));
    expect(run([], { env: { CC_FLOW_OFF: '1' } })).toMatchObject({ status: 0, stdout: '\n' });
  });
});

describe('failure stays silent', () => {
  it('a thrown error (event path is a directory) prints nothing and exits 0', () => {
    mkdirSync(events);
    expect(run()).toEqual({ status: 0, stdout: '', stderr: '' });
  });

  it('garbage on stdin still exits 0', () => {
    expect(run([], { stdin: '{not json' }).status).toBe(0);
  });

  it('a control character in a code cannot break the line', () => {
    seed([ev({ verdict: 'deny', guard: 3, code: 'P9\nRM' })]);
    expect(run().stdout).toBe('⛔ G3 P9 RM · 1 calls · 1 deny\n');
  });
});

describe('the tail read', () => {
  it('a 1 MiB file is read through its last 32 KiB only', () => {
    const line = `${JSON.stringify(ev({}))}\n`;
    writeFileSync(events, line.repeat(Math.ceil((1024 * 1024) / line.length)));
    const text = readTail(events);
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(TAIL_BYTES);
    const shown = Number(run().stdout.match(/(\d+) calls/)[1]);
    expect(shown).toBeLessThanOrEqual(Math.floor(TAIL_BYTES / line.length));
  });

  it('drops the partial first line of a tail, so a large file is not reported unreadable', () => {
    writeFileSync(events, `${JSON.stringify(ev({ target: 'x'.repeat(40000) }))}\n${JSON.stringify(ev({}))}\n`);
    expect(run().stdout).toBe('✓ 1 calls · 0 deny\n');
  });
});

describe('/cc-flow --detail', () => {
  it('prints every D3 lane and at most 20 events', () => {
    seed([...allows(30), ...denies(5)]);
    const out = run(['--detail']);
    expect(out.status).toBe(0);
    for (const lane of LANES) expect(out.stdout).toMatch(new RegExp(`^${lane.name} `, 'm'));
    expect(out.stdout).toMatch(/^Bash\s+35 calls {2}G7 35 pass 0 deny · G3 30 pass 5 deny$/m);
    expect(out.stdout).toContain('Newest 20 events:');
    expect(out.stdout.split('\n').filter((l) => /^\d\d:\d\d:\d\d {2}/.test(l))).toHaveLength(20);
  });

  it('with no event file prints the idle lanes and says so', () => {
    const out = run(['--detail'], { stdin: '' });
    expect(out.stdout).toContain('no events yet');
    expect(out.stdout).toMatch(/^Read\s+0 calls/m);
  });

  it('prints a target holding a quote and a newline on one escaped row', () => {
    seed([ev({ tool: 'Agent', target: 'a"b\nc', passed: [6] })]);
    expect(run(['--detail']).stdout).toContain('"a\\"b\\nc"');
  });

  it('says the log is off under CC_FLOW_OFF', () => {
    expect(run(['--detail'], { env: { CC_FLOW_OFF: '1' } }).stdout).toBe('flow log is off (CC_FLOW_OFF is set)\n');
  });
});

describe('drift between the hook and the lanes (AC4)', () => {
  const hookText = readFileSync(HOOK, 'utf8');
  const table = hookText.match(/const GUARD_NUMBER = new Map\(\[([\s\S]*?)\]\);/)[1];
  const numbered = new Map([...table.matchAll(/\[(guard\w+), (\d+)\]/g)].map((m) => [m[1], Number(m[2])]));

  it('the set of guard numbers in the hook equals the set in the lane table', () => {
    const lanes = new Set(LANES.flatMap((l) => l.guards));
    expect([...new Set(numbered.values())].sort()).toEqual([...lanes].sort());
  });

  // The dispatch is built by a literal and by unshift() lines; every guard either names
  // must carry a number, or its events would record guard null on a deny.
  it('every guard the hook dispatches has a number', () => {
    const block = hookText.slice(hookText.indexOf('const DISPATCH = {'), hookText.indexOf('// ── Flow events'));
    const dispatched = new Set([...block.matchAll(/\b(guard\d\w+)\b/g)].map((m) => m[1]));
    expect(dispatched.size).toBeGreaterThanOrEqual(7);
    expect([...dispatched].filter((name) => !numbered.has(name))).toEqual([]);
  });
});

describe('shipped surfaces (AC7)', () => {
  it('ship no .html file and no http(s) URL in the script or the command', () => {
    const htmlFiles = (dir) => readdirSync(dir, { recursive: true }).filter((f) => String(f).endsWith('.html'));
    expect(htmlFiles(join(ROOT, 'project-template'))).toEqual([]);
    for (const rel of ['project-template/.claude/flow-status.mjs', 'project-template/.claude/commands/cc-flow.md']) {
      expect(readFileSync(join(ROOT, rel), 'utf8')).not.toMatch(/https?:\/\//);
    }
  });
});

// AC5, through the real asset tree into temporary directories. The installer is never run
// against this repository.
describe('--project deploys the flow status line (AC5)', () => {
  let proj, home, said;
  const CANONICAL = { type: 'command', command: FLOW_STATUS_COMMAND };
  const projectSettings = () => join(proj, '.claude', 'settings.json');
  const userSettings = () => join(home, '.claude', 'settings.json');
  const deploy = () => deployProject(ROOT, proj, { warn: () => {}, report: (m) => said.push(m), home });
  const writeJson = (path, obj) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, `${JSON.stringify(obj, null, 2)}\n`); };

  beforeEach(() => {
    proj = join(work, 'proj');
    home = join(work, 'home');
    mkdirSync(proj);
    mkdirSync(home);
    said = [];
  });

  it('deploys flow-status.mjs and commands/cc-flow.md', () => {
    deploy();
    expect(existsSync(join(proj, '.claude', 'flow-status.mjs'))).toBe(true);
    expect(existsSync(join(proj, '.claude', 'commands', 'cc-flow.md'))).toBe(true);
  });

  it('adds the entry when no statusLine exists anywhere, and a second run is byte-identical and silent', () => {
    deploy();
    const first = readFileSync(projectSettings(), 'utf8');
    expect(JSON.parse(first).statusLine).toEqual(CANONICAL);
    expect(JSON.parse(first).hooks.PreToolUse).toBeDefined();
    expect(said.filter((m) => m.includes('flow status line'))).toHaveLength(1);
    said = [];
    deploy();
    expect(readFileSync(projectSettings(), 'utf8')).toBe(first);
    expect(said.filter((m) => m.includes('flow status line'))).toEqual([]);
  });

  it('replaces an owned entry whose command is stale', () => {
    deploy();
    const obj = JSON.parse(readFileSync(projectSettings(), 'utf8'));
    obj.statusLine = { type: 'command', command: 'node ./old/flow-status.mjs --legacy' };
    writeJson(projectSettings(), obj);
    deploy();
    expect(JSON.parse(readFileSync(projectSettings(), 'utf8')).statusLine).toEqual(CANONICAL);
    expect(said.filter((m) => m.includes('updated the flow status line'))).toHaveLength(1);
  });

  it('leaves a host statusLine in the project settings byte-identical and prints one skip line', () => {
    deploy();
    const obj = JSON.parse(readFileSync(projectSettings(), 'utf8'));
    obj.statusLine = { type: 'command', command: 'starship prompt' };
    writeJson(projectSettings(), obj);
    const before = readFileSync(projectSettings(), 'utf8');
    said = [];
    deploy();
    expect(readFileSync(projectSettings(), 'utf8')).toBe(before);
    expect(said.filter((m) => m.includes('flow status line was skipped'))).toHaveLength(1);
  });

  it('leaves both files byte-identical when the user settings hold a statusLine', () => {
    writeJson(userSettings(), { statusLine: { type: 'command', command: 'my-line' } });
    const user = readFileSync(userSettings(), 'utf8');
    // Two runs first: a CRLF checkout's template is written verbatim on the fresh run and
    // re-serialized by the hooks merge on the next, which is not this rule's write.
    deploy();
    deploy();
    const project = readFileSync(projectSettings(), 'utf8');
    expect(JSON.parse(project).statusLine).toBeUndefined();
    deploy();
    expect(readFileSync(userSettings(), 'utf8')).toBe(user);
    expect(readFileSync(projectSettings(), 'utf8')).toBe(project);
    expect(said.filter((m) => m.includes('flow status line was skipped'))).toHaveLength(3);
  });

  it('backs up a malformed project settings.json and leaves it untouched', () => {
    mkdirSync(join(proj, '.claude'), { recursive: true });
    writeFileSync(projectSettings(), '{ not json');
    expect(mergeFlowStatusLine(projectSettings(), userSettings())).toBe('malformed-skipped');
    expect(readFileSync(projectSettings(), 'utf8')).toBe('{ not json');
    const backups = readdirSync(join(proj, '.claude')).filter((n) => n.startsWith('settings.json.malformed-backup.'));
    expect(backups.map((n) => readFileSync(join(proj, '.claude', n), 'utf8'))).toEqual(['{ not json']);
  });

  it('treats an unreadable user settings.json as holding a statusLine', () => {
    writeJson(projectSettings(), {});
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(userSettings(), '{ not json');
    expect(mergeFlowStatusLine(projectSettings(), userSettings())).toBe('host-skipped');
    expect(readFileSync(projectSettings(), 'utf8')).toBe('{}\n');
  });
});
