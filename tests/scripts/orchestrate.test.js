import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { fakeGh, issue, pull } from '../helpers/fake-gh.js';
import { parseSnapshotHeader } from '../../scripts/ticket.mjs';
import { cleanGitEnv } from '../helpers/git-env.js';
import * as orchestrateModule from '../../scripts/orchestrate.mjs';
import {
  ENVELOPE_FILE, HANDBACK_DIR, MAY_HAND_BACK, ROLE_ARTIFACTS, REVIEW_CAP, REVIEW_DIR, RUN_FILE, SHELL_METACHARACTERS, WRITE_SURFACE,
  Halt, checkTestCommand, docScopes, documentHash, extractTasks, findAgent, forwardGate, isValidRun, nextStep, parseVerdict, recordHandback, taskScope,
} from '../../scripts/orchestrate.mjs';
import { CANDIDATE_PAIRS, DEFAULT_PAIR } from '../../scripts/doc-locations.mjs';

const SEC_NONE = '; security: threshold high, dependency scan not covered for no lockfile';
const START_USAGE = 'orchestrate: usage: orchestrate.mjs start <ITEM> [--auto] [--ticket <N|issue URL>] [--audit-rounds <0-5>] [--security-threshold <low|moderate|high|critical>] [--no-dependency-audit]';
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = join(REPO_ROOT, 'scripts/orchestrate.mjs');
const ROLES = ['spec', 'plan', 'code', 'audit', 'qa', 'security'];
const PLAN = 'docs/plans/demo.md';
const SPEC = 'docs/specs/demo-design.md';
// Every root gets a test script with no lockfile, so start records `npm test` (FEAT-012 D6).
const PKG = '{"scripts":{"test":"vitest run"}}';

let root, home, script;
beforeEach(() => {
  script = SCRIPT;
  root = realpathSync(mkdtempSync(join(tmpdir(), 'cc-orch-root-')));
  home = realpathSync(mkdtempSync(join(tmpdir(), 'cc-orch-home-')));
  mkdirSync(join(root, '.claude', 'memory'), { recursive: true });
  writeFileSync(join(root, 'package.json'), PKG);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

// Through the CLI's real contract: verb on argv, hand-back on stdin, this session's id in env.
function orch(args, { input = '', sid = 'sess-1' } = {}) {
  const env = { ...cleanGitEnv(), HOME: home, USERPROFILE: home };
  delete env.CLAUDE_CODE_SESSION_ID;
  if (sid !== null) env.CLAUDE_CODE_SESSION_ID = sid;
  const r = spawnSync(process.execPath, [script, ...args], { cwd: root, env, input, encoding: 'utf8', timeout: 30000 });
  if (r.error) throw new Error(`orchestrate spawn failed: ${r.error.message}`);
  return { status: r.status, out: r.stdout.trim(), err: r.stderr.trim() };
}
// The fixture-repository helper of the security tests: identity and signing pinned, GIT_* scrubbed (BUG-053).
function fixtureGit(...args) {
  return spawnSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args],
    { cwd: root, env: cleanGitEnv(), encoding: 'utf8' });
}
const fixtureCommit = () => { fixtureGit('add', '-A'); fixtureGit('commit', '-qm', 'base'); };
const runFile = () => JSON.parse(readFileSync(join(root, RUN_FILE), 'utf8'));
const runFileText = (text) => writeFileSync(join(root, RUN_FILE), text);
const envelopeText = () => readFileSync(join(root, ENVELOPE_FILE), 'utf8');
const envelope = () => JSON.parse(envelopeText());
// Raw-byte sha256: the hash approve takes for a spec, and for a plan with no box ticked (FEAT-056).
const sha = (rel) => createHash('sha256').update(readFileSync(join(root, rel))).digest('hex');
// The spec fixture is written at approval, after start, so FEAT-047 discovery at start never sees it.
function approveArgs(kind) {
  const rel = kind === 'spec' ? SPEC : PLAN;
  if (kind === 'spec' && !existsSync(join(root, rel))) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), '# Demo spec\n');
  }
  return ['approve', kind, rel, sha(rel)];
}
// approve refuses while the role's review loop is open or never ran (FEAT-058); a recorded skip closes it.
const skipLoop = (kind) => orch(['review', kind, '--close', 'skipped:fixture']);

// The shipped default-model values (FEAT-053); read only by a run whose CLAUDE.md opts in.
const FIXTURE_MODELS = { spec: 'opus', plan: 'opus', code: 'sonnet', audit: 'opus', security: 'opus', qa: 'haiku', 'define-review': 'opus' };
function agents(roles = ROLES, dir = join(root, '.claude', 'agents')) {
  mkdirSync(dir, { recursive: true });
  for (const r of roles) writeFileSync(join(dir, `${r}.md`), `---\nname: ${r}\ndescription: fixture\n${FIXTURE_MODELS[r] ? `default-model: ${FIXTURE_MODELS[r]}\n` : ''}---\nfixture\n`);
}
function plan(body) {
  mkdirSync(dirname(join(root, PLAN)), { recursive: true });
  writeFileSync(join(root, PLAN), body);
}
const task = (n, files) => `### Task ${n}: thing ${n}\n\n**Files:**\n${files.map((f) => `- Modify: \`${f}\``).join('\n')}\n\n- [ ] **Step 1: do it**\n`;
const TWO_TASKS = `# Demo Plan\n\n${task(1, ['src/a.js:10-20', 'tests/a.test.js'])}\n${task(2, ['src/b.js'])}\n## Test List\n`;
const handbackLine = (role, gate, extra = {}) => 'SNAP_HANDBACK ' + JSON.stringify({
  v: extra.v ?? 3, sys: { ph: 'impl', c: '0000000', s: 'FEAT-011', role, tk: 'X', ...extra.sys },
  ops: { n: [], f: [], gate }, mem: { d: [], x: [] }, pr: '',
});
const say = (role, gate) => `Done.\nObservation: fine.\n${role === 'audit' ? 'VERDICT: APPROVE\n' : ''}${handbackLine(role, gate)}\n`;
const auditReport = (verdict, findings = []) => ['Done.', ...findings, ...(verdict === null ? [] : [verdict]), handbackLine('audit', 'build_executed'), ''].join('\n');

const SCANS_NONE = 'SCANS: dependency=not-covered secrets=ran scripts=ran';
const securityReport = (findings = [], scans = SCANS_NONE, verdict = 'VERDICT: APPROVE', owner = null) => ['Done.',
  ...(owner ? ['PRE-EXISTING (owner only):', ...owner, 'END PRE-EXISTING'] : []), ...findings, scans, ...(verdict === null ? [] : [verdict]),
  handbackLine('security', 'build_executed', { v: 4, sys: { ph: 'rev' } }), ''].join('\n');
const securityPass = (report = securityReport()) => {
  expect(orch(['install', 'security']).status).toBe(0);
  return orch(['handback', 'security'], { input: report });
};
const OWNER_FILE = '.conductor/security-pre-existing.txt';
// Two fixture runs always differ in their timestamps and in the base commit's object name (a different tree).
const norm = (s) => s.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '<at>').replace(/\b[0-9a-f]{40}\b/g, '<object>');

// The seat re-runs the base commit's scanner, so a run that reaches it needs the installed layout
// committed, as a host project carries it: scripts/ at .claude/scripts/ (FEAT-034 plan decisions).
function installedRepo() {
  cpSync(join(REPO_ROOT, 'scripts'), join(root, '.claude', 'scripts'), { recursive: true });
  fixtureGit('init', '-q');
  fixtureCommit();
  script = join(root, '.claude', 'scripts', 'orchestrate.mjs');
}

// Drives a fresh run to the point where `role` is next, recording each step on the way.
function driveTo(role, { start = [], planText = TWO_TASKS, seat = ['security', 'qa'].includes(role), prep = () => {} } = {}) {
  agents();
  plan(planText);
  if (seat) installedRepo();
  prep();
  const steps = [
    ['spec', () => { orch(['install', 'spec']); orch(['handback', 'spec'], { input: say('spec', 'boundary_routed') }); skipLoop('spec'); orch(approveArgs('spec')); }],
    ['plan', () => { orch(['install', 'plan']); orch(['handback', 'plan'], { input: say('plan', 'boundary_routed') }); skipLoop('plan'); orch(approveArgs('plan')); }],
    ['code', () => { for (let i = 0; i < 2; i++) { orch(['install', 'code']); orch(['handback', 'code'], { input: say('code', 'build_executed') }); } }],
    ['audit', () => { orch(['install', 'audit']); orch(['handback', 'audit'], { input: say('audit', 'build_executed') }); }],
    ['security', () => { orch(['install', 'security']); orch(['handback', 'security'], { input: securityReport() }); }],
  ];
  expect(orch(['start', 'FEAT-011', ...start]).status).toBe(0);
  for (const [name, step] of steps) { if (name === role) return; step(); }
}

const blank = { gate: 'boundary_routed', approvals: { spec: null, plan: null }, tasks: { ids: [], done: 0 }, handbacks: [] };
const hb = (...roles) => roles.map((role) => ({ role }));

describe('router [FEAT-011 AC7]', () => {
  it.each([
    ['a fresh run dispatches spec', blank, { role: 'spec' }],
    ['a spec hand-back waits for spec approval', { ...blank, handbacks: hb('spec') }, { await: 'spec' }],
    ['an approved spec dispatches plan', { ...blank, handbacks: hb('spec'), approvals: { spec: {}, plan: null } }, { role: 'plan' }],
    ['a plan hand-back waits for plan approval', { ...blank, handbacks: hb('spec', 'plan'), approvals: { spec: {}, plan: null } }, { await: 'plan' }],
    ['an approved plan dispatches code for its first task', { ...blank, handbacks: hb('spec', 'plan'), approvals: { spec: {}, plan: {} }, tasks: { ids: ['Task 1', 'Task 2'], done: 0 } }, { role: 'code', task: 'Task 1' }],
    ['the last code hand-back dispatches audit', { ...blank, handbacks: hb('spec', 'plan'), approvals: { spec: {}, plan: {} }, tasks: { ids: ['Task 1', 'Task 2'], done: 2 } }, { role: 'audit' }],
    ['an audit hand-back dispatches qa', { ...blank, handbacks: hb('spec', 'plan', 'audit'), approvals: { spec: {}, plan: {} }, tasks: { ids: ['Task 1'], done: 1 } }, { role: 'qa' }],
    ['a qa hand-back ends the run', { ...blank, handbacks: hb('spec', 'plan', 'audit', 'qa'), approvals: { spec: {}, plan: {} }, tasks: { ids: ['Task 1'], done: 1 } }, { end: true }],
  ])('%s', (_, run, expected) => {
    expect(nextStep(run)).toEqual(expected);
  });

  it('may hand back exactly the gates the band table names', () => {
    expect(MAY_HAND_BACK).toEqual({
      spec: ['boundary_routed'], plan: ['boundary_routed'], code: ['build_executed'],
      audit: ['build_executed'], qa: ['verify_pass'], security: ['build_executed'],
    });
  });

  it('gives each role the reviewed tool kind and scope (D5)', () => {
    expect(ROLE_ARTIFACTS).toEqual({
      spec: { tk: 'RW', scope: null },
      plan: { tk: 'RW', scope: null },
      code: { tk: 'RW', scope: null },
      audit: { tk: 'R', scope: null },
      qa: { tk: 'X', scope: null },
      security: { tk: 'X', scope: null },
    });
  });

  const at = (gate, done = 0) => ({ gate, tasks: { ids: ['Task 1', 'Task 2'], done } });
  it.each([
    ['spec re-issues boundary_routed inside Define', at('boundary_routed'), 'spec', 'boundary_routed', 'boundary_routed'],
    ['plan re-issues boundary_routed inside Define', at('boundary_routed'), 'plan', 'boundary_routed', 'boundary_routed'],
    ['a non-final code task re-issues define_approved', at('define_approved', 0), 'code', 'build_executed', 'define_approved'],
    ['the final code task forwards build_executed', at('define_approved', 1), 'code', 'build_executed', 'build_executed'],
    ['audit re-issues build_executed inside Verify', at('build_executed', 2), 'audit', 'build_executed', 'build_executed'],
    ['qa forwards verify_pass and ends the band', at('build_executed', 2), 'qa', 'verify_pass', 'verify_pass'],
  ])('D6: %s', (_, run, role, handed, expected) => {
    expect(forwardGate(run, role, handed)).toBe(expected);
  });

  it('writes define_approved only through approve plan, and only once', () => {
    driveTo('plan');
    orch(['install', 'plan']);
    orch(['handback', 'plan'], { input: say('plan', 'boundary_routed') });
    expect(runFile().gate).toBe('boundary_routed');
    skipLoop('plan');
    expect(orch(approveArgs('plan')).status).toBe(0);
    expect(runFile().gate).toBe('define_approved');
    const again = orch(approveArgs('plan'));
    expect(again.status).toBe(2);
    expect(again.err).toBe('orchestrate: approve plan: the next step is install code');
  });

  it('approving the spec records the approval and writes no gate', () => {
    driveTo('spec');
    orch(['install', 'spec']);
    orch(['handback', 'spec'], { input: say('spec', 'boundary_routed') });
    skipLoop('spec');
    expect(orch(approveArgs('spec')).status).toBe(0);
    const run = runFile();
    expect(run.gate).toBe('boundary_routed');
    expect(run.approvals.spec.by).toEqual(expect.any(String));
    expect(run.approvals.plan).toBeNull();
  });

  it('runs start to verify_pass on a two-task plan, each envelope passing --to its role', () => {
    driveTo('qa');
    expect(orch(['install', 'qa']).status).toBe(0);
    expect(envelope().sys).toMatchObject({ role: 'qa', tk: 'X' });
    expect(envelope().ops.gate).toBe('build_executed');
    expect(orch(['handback', 'qa'], { input: say('qa', 'verify_pass') }).status).toBe(0);
    const run = runFile();
    expect(run.gate).toBe('verify_pass');
    expect(run.handbacks.map((h) => h.task ? `${h.role}:${h.task}` : h.role))
      .toEqual(['spec', 'plan', 'code:Task 1', 'code:Task 2', 'audit', 'security', 'qa']);
    expect(nextStep(run)).toEqual({ end: true });
  });
});

describe('scope [FEAT-011 AC8]', () => {
  it('extracts the Files block of each task, strips line suffixes and adds the plan file', () => {
    const tasks = extractTasks(TWO_TASKS);
    expect(tasks.map((t) => t.id)).toEqual(['Task 1', 'Task 2']);
    expect(taskScope(tasks[0], PLAN)).toEqual(['src/a.js', 'tests/a.test.js', PLAN]);
    expect(taskScope(tasks[1], PLAN)).toEqual(['src/b.js', PLAN]);
  });

  it('halts with ORCH_EMPTY_SCOPE on a task that declares no files', () => {
    expect(() => taskScope(extractTasks('### Task 1: nothing\n\n- [ ] **Step 1**\n')[0], PLAN)).toThrow('ORCH_EMPTY_SCOPE');
  });

  it('halts with ORCH_EMPTY_SCOPE on a plan with zero tasks, writing no gate', () => {
    driveTo('plan');
    plan('# Plan\n\nNo tasks here.\n');
    orch(['install', 'plan']);
    orch(['handback', 'plan'], { input: say('plan', 'boundary_routed') });
    skipLoop('plan');
    const r = orch(approveArgs('plan'));
    expect(r.status).toBe(1);
    expect(r.err).toMatch(/^ORCH_EMPTY_SCOPE: /);
    expect(runFile().gate).toBe('boundary_routed');
    expect(runFile().halt.code).toBe('ORCH_EMPTY_SCOPE');
  });

  it.each([[19, 'passes'], [20, 'halts']])('a task with %i files plus the plan file %s at the cap of 20', (n, outcome) => {
    const files = Array.from({ length: n }, (_, i) => `src/f${i}.js`);
    const call = () => taskScope({ id: 'Task 1', files }, PLAN);
    if (outcome === 'passes') expect(call()).toHaveLength(20);
    else expect(call).toThrow('ORCH_SCOPE_OVER_CAP: Task 1 needs 21 scope entries; the cap is 20');
  });

  it('halts on a scope path past the 300-character element cap rather than truncating it', () => {
    expect(() => taskScope({ id: 'Task 1', files: ['src/' + 'x'.repeat(300)] }, PLAN)).toThrow(/^ORCH_SCOPE_OVER_CAP: Task 1 has a 304-character path/);
  });

  it('[#128] measures a backslash path as the validator does, so it halts here by name', () => {
    const path = 'src' + String.fromCharCode(92) + 'x'.repeat(296); // 300 characters, 301 escaped
    expect(() => taskScope({ id: 'Task 1', files: [path] }, PLAN)).toThrow('ORCH_SCOPE_OVER_CAP: Task 1 has a 301-character path; the cap is 300');
  });

  it('installs a code envelope holding RW and exactly the task scope', () => {
    driveTo('code');
    expect(orch(['install', 'code']).status).toBe(0);
    expect(envelope().sys).toMatchObject({ role: 'code', tk: 'RW', ph: 'impl' });
    expect(envelope().ops).toMatchObject({ scope: ['src/a.js', 'tests/a.test.js', PLAN], gate: 'define_approved' });
  });
});

describe('run file [FEAT-011 AC9]', () => {
  it('start records boundary_routed in step mode by default, and auto with --auto', () => {
    expect(orch(['start', 'FEAT-011']).status).toBe(0);
    expect(runFile()).toMatchObject({ v: 1, session_id: 'sess-1', item: 'FEAT-011', mode: 'step', band: 'boundary', gate: 'boundary_routed', halt: null, test_command: 'npm test' });
    orch(['end']);
    orch(['start', 'FEAT-011', '--auto']);
    expect(runFile().mode).toBe('auto');
  });

  it('refuses to start without CLAUDE_CODE_SESSION_ID (ORCH_NO_SESSION_ID)', () => {
    const r = orch(['start', 'FEAT-011'], { sid: '' });
    expect(r.status).toBe(1);
    expect(r.err).toMatch(/^ORCH_NO_SESSION_ID: /);
    expect(existsSync(join(root, RUN_FILE))).toBe(false);
  });

  it('refuses a second start in the same session (ORCH_RUN_ACTIVE), leaving the run untouched', () => {
    orch(['start', 'FEAT-011']);
    const before = readFileSync(join(root, RUN_FILE), 'utf8');
    const r = orch(['start', 'FEAT-012']);
    expect(r.status).toBe(1);
    expect(r.err).toBe('ORCH_RUN_ACTIVE: run FEAT-011 is live in this session; end it first');
    expect(readFileSync(join(root, RUN_FILE), 'utf8')).toBe(before);
  });

  it('replaces the stale run of another session and reports what it replaced', () => {
    orch(['start', 'FEAT-011'], { sid: 'old-session' });
    const { started } = runFile();
    writeFileSync(join(root, ENVELOPE_FILE), '{"stale":true}\n');
    mkdirSync(join(root, HANDBACK_DIR), { recursive: true });
    writeFileSync(join(root, HANDBACK_DIR, 'spec.txt'), 'stale\n');
    const r = orch(['start', 'FEAT-012']);
    expect(r.status).toBe(0);
    expect(r.out).toBe(`replaced the stale run FEAT-011 started ${started}; docs: specs docs/specs, plans docs/plans (default); test command: npm test; audit rounds: 2${SEC_NONE}`);
    expect(runFile()).toMatchObject({ item: 'FEAT-012', session_id: 'sess-1' });
    expect(existsSync(join(root, ENVELOPE_FILE))).toBe(false);
    expect(existsSync(join(root, HANDBACK_DIR))).toBe(false);
  });

  it('writes the run file atomically, leaving no temp file behind', () => {
    orch(['start', 'FEAT-011']);
    expect(readdirSync(join(root, '.claude', 'memory'))).toEqual(['orchestrator-run.json']);
  });

  it('end removes the run file, the envelope and the hand-back files, printing the run it removed', () => {
    driveTo('spec');
    orch(['install', 'spec']);
    mkdirSync(join(root, HANDBACK_DIR), { recursive: true });
    writeFileSync(join(root, HANDBACK_DIR, 'spec.txt'), say('spec', 'boundary_routed'));
    const r = orch(['end']);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.out).item).toBe('FEAT-011');
    expect(existsSync(join(root, RUN_FILE))).toBe(false);
    expect(existsSync(join(root, ENVELOPE_FILE))).toBe(false);
    expect(existsSync(join(root, HANDBACK_DIR))).toBe(false);
  });

  it('halts with ORCH_RUN_INVALID on an unreadable run file, which cannot record its own halt', () => {
    runFileText('{not json');
    const r = orch(['install', 'spec']);
    expect(r.status).toBe(1);
    expect(r.err).toBe(`ORCH_RUN_INVALID: ${join(root, RUN_FILE)} is unreadable or not a v1 run file; clear it with: node ${relative(root, SCRIPT).split('\\').join('/')} end`);
    expect(readFileSync(join(root, RUN_FILE), 'utf8')).toBe('{not json');
    expect(orch(['end']).status).toBe(0);
  });

  it('halts with ORCH_AGENT_MISSING against an empty agents directory', () => {
    mkdirSync(join(root, '.claude', 'agents'));
    orch(['start', 'FEAT-011']);
    const r = orch(['install', 'spec']);
    expect(r.status).toBe(1);
    expect(r.err).toBe('ORCH_AGENT_MISSING: no agent definition named spec in .claude/agents/ or ~/.claude/agents/');
    expect(runFile().halt.code).toBe('ORCH_AGENT_MISSING');
  });

  it('finds an agent definition in ~/.claude/agents/ by its name field', () => {
    agents(['spec'], join(home, '.claude', 'agents'));
    expect(findAgent('spec', root, home)).toBe(join(home, '.claude', 'agents', 'spec.md'));
    expect(findAgent('plan', root, home)).toBeNull();
  });

  it('refuses every verb but resume and end once a run has halted (D12, FEAT-055)', () => {
    orch(['start', 'FEAT-011']);
    orch(['install', 'spec']);
    agents();
    const r = orch(['install', 'spec']);
    expect(r.status).toBe(2);
    expect(r.err).toBe('orchestrate: run FEAT-011 halted with ORCH_AGENT_MISSING; recover with resume, or end then start (D12, FEAT-055)');
    expect(orch(['end']).status).toBe(0);
  });

  it('refuses to drive a run from another session', () => {
    driveTo('spec');
    const r = orch(['install', 'spec'], { sid: 'other-session' });
    expect(r.status).toBe(2);
    expect(r.err).toBe('orchestrate: run FEAT-011 belongs to another session; end it, or start to replace it');
  });

  it('refuses to install a role that is not next, writing nothing', () => {
    driveTo('spec');
    const r = orch(['install', 'plan']);
    expect(r.status).toBe(2);
    expect(r.err).toBe('orchestrate: install plan: the next step is install spec');
    expect(existsSync(join(root, ENVELOPE_FILE))).toBe(false);
  });

  it('install --check prints the envelope it would install and writes nothing', () => {
    driveTo('spec');
    const r = orch(['install', 'spec', '--check']);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.out).sys).toMatchObject({ role: 'spec', tk: 'RW' });
    expect(existsSync(join(root, ENVELOPE_FILE))).toBe(false);
    expect(runFile().role).toBeNull();
  });
});

describe('every handoff is a validated envelope [FEAT-011 AC1, AC2]', () => {
  // A known envelope on disk, so "unchanged" is a byte comparison rather than an absence.
  function dispatched(role) {
    driveTo(role);
    orch(['install', role]);
    return envelopeText();
  }
  function expectHalt(r, code, before) {
    expect(r.status).toBe(1);
    expect(r.err.startsWith(`${code}: `)).toBe(true);
    expect(runFile().halt.code).toBe(code);
    expect(envelopeText()).toBe(before);
  }

  it('[AC1] install writes no envelope that fails snap-validate --to', () => {
    driveTo('spec');
    writeFileSync(join(root, RUN_FILE), JSON.stringify({ ...runFile(), gate: 'build_executed' }));
    const r = orch(['install', 'spec']);
    expect(r.status).toBe(1);
    expect(existsSync(join(root, ENVELOPE_FILE))).toBe(false);
  });

  it('[AC1] handback records nothing that fails snap-validate', () => {
    const before = dispatched('spec');
    const r = orch(['handback', 'spec'], { input: 'SNAP_HANDBACK {"v":3}\n' });
    expect(r.status).toBe(1);
    expect(runFile().handbacks).toEqual([]);
    expect(envelopeText()).toBe(before);
  });

  it.each([['no', ''], ['two', `${handbackLine('spec', 'boundary_routed')}\n${handbackLine('spec', 'boundary_routed')}\n`]])(
    '[AC2] ORCH_HANDBACK_MISSING on %s SNAP_HANDBACK lines', (_, input) => {
      const before = dispatched('spec');
      expectHalt(orch(['handback', 'spec'], { input }), 'ORCH_HANDBACK_MISSING', before);
    });

  it('[AC2] ORCH_HANDBACK_INVALID quotes the validator verbatim', () => {
    const before = dispatched('spec');
    const r = orch(['handback', 'spec'], { input: 'SNAP_HANDBACK {not json}\n' });
    expectHalt(r, 'ORCH_HANDBACK_INVALID', before);
    expect(r.err).toBe('ORCH_HANDBACK_INVALID: SNAP_ERROR: malformed JSON');
  });

  it('[AC2] ORCH_HANDBACK_INVALID on a valid envelope that is not v3', () => {
    const before = dispatched('spec');
    const v1 = 'SNAP_HANDBACK {"v":1,"sys":{"ph":"spec","c":"0000000","s":"FEAT-011"},"ops":{"n":[],"f":[]},"mem":{"d":[],"x":[]}}\n';
    const r = orch(['handback', 'spec'], { input: v1 });
    expectHalt(r, 'ORCH_HANDBACK_INVALID', before);
    expect(r.err).toBe('ORCH_HANDBACK_INVALID: a hand-back must be a v3 or v4 envelope, got v1');
  });

  it('[AC2] ORCH_HANDBACK_ROLE_MISMATCH when the hand-back names another role', () => {
    const before = dispatched('spec');
    expectHalt(orch(['handback', 'spec'], { input: say('plan', 'boundary_routed') }), 'ORCH_HANDBACK_ROLE_MISMATCH', before);
  });

  it('[AC2] ORCH_GATE_UNEARNED when spec claims define_approved, and plan is not dispatched', () => {
    const before = dispatched('spec');
    const r = orch(['handback', 'spec'], { input: say('spec', 'define_approved') });
    expectHalt(r, 'ORCH_GATE_UNEARNED', before);
    expect(r.err).toBe('ORCH_GATE_UNEARNED: spec may hand back boundary_routed, not define_approved');
    expect(orch(['install', 'plan']).status).toBe(2);
  });

  it('[AC2] ORCH_HANDBACK_CONFLICT on a second report for one position, keeping the first', () => {
    const before = dispatched('spec');
    orch(['handback', 'spec'], { input: say('spec', 'boundary_routed') });
    const first = runFile().handbacks;
    const r = orch(['handback', 'spec'], { input: say('spec', 'boundary_routed') });
    expectHalt(r, 'ORCH_HANDBACK_CONFLICT', before);
    expect(r.err).toBe('ORCH_HANDBACK_CONFLICT: spec already handed back for this position; a second report is not routed');
    expect(runFile().handbacks).toEqual(first);
  });

  it('[AC2] SNAP_GATE_MISMATCH halts install as the backstop behind the router', () => {
    const before = dispatched('spec');
    orch(['handback', 'spec'], { input: say('spec', 'boundary_routed') });
    skipLoop('spec');
    orch(approveArgs('spec'));
    writeFileSync(join(root, RUN_FILE), JSON.stringify({ ...runFile(), gate: 'define_approved' }));
    const r = orch(['install', 'plan']);
    expectHalt(r, 'SNAP_GATE_MISMATCH', before);
    expect(r.err).toBe('SNAP_GATE_MISMATCH: SNAP_ERROR: SNAP_GATE_MISMATCH: plan expects boundary_routed, got define_approved');
  });
});

describe('write surface [FEAT-011 AC4]', () => {
  it('declares exactly the four entries the spec enumerates', () => {
    expect(WRITE_SURFACE).toEqual([
      '.claude/memory/orchestrator-run.json',
      '.claude/memory/band-envelope.json',
      '.claude/memory/session-snapshot.json',
      '.conductor/**',
    ]);
  });
});

describe('test command [FEAT-012 AC8, AC9]', () => {
  const start = () => orch(['start', 'FEAT-012']);
  const files = (map) => {
    for (const [rel, text] of Object.entries(map)) {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), text);
    }
  };
  const unresolved = (reason) => {
    const r = start();
    expect(r.status).toBe(1);
    expect(r.err).toBe(`ORCH_TEST_COMMAND_UNRESOLVED: ${reason}`);
    expect(existsSync(join(root, RUN_FILE))).toBe(false);
  };
  const NO_SCRIPT = 'package.json has no scripts.test; add a test script, the run does not guess a runner';

  it.each([
    ['package-lock.json', 'npm test', '; security: threshold high, dependency scan npm audit --json'],
    ['pnpm-lock.yaml', 'pnpm test', '; security: threshold high, dependency scan pnpm audit --json'],
    ['yarn.lock', 'yarn test', '; security: threshold high, dependency scan not covered for yarn'],
    ['bun.lockb', 'bun run test', '; security: threshold high, dependency scan not covered for bun'],
  ])('[AC8] records the package manager invocation for %s', (lock, expected, suffix) => {
    files({ [lock]: '' });
    const r = start();
    expect(r.status).toBe(0);
    expect(r.out).toBe(`run FEAT-012 started; docs: specs docs/specs, plans docs/plans (default); test command: ${expected}; audit rounds: 2${suffix}`);
    expect(runFile().test_command).toBe(expected);
  });

  it('[AC8] records npm test with no lockfile, the stated default', () => {
    expect(start().out).toBe('run FEAT-012 started; docs: specs docs/specs, plans docs/plans (default); test command: npm test; audit rounds: 2' + SEC_NONE);
    expect(runFile().test_command).toBe('npm test');
  });

  // Discriminator: detect-stack offers jest here, and the run must not take it.
  it('[AC8] halts on a package.json without scripts.test, though detect-stack offers a runner', () => {
    files({ 'package.json': '{"dependencies":{"react":"18.0.0"}}' });
    const detected = spawnSync(process.execPath, [join(REPO_ROOT, 'scripts/detect-stack.mjs'), root], { encoding: 'utf8' });
    expect(JSON.parse(detected.stdout).test).toBe('jest');
    unresolved(NO_SCRIPT);
  });

  it.each([['a blank', '{"scripts":{"test":"  "}}'], ['a non-string', '{"scripts":{"test":true}}']])(
    '[AC8] reads %s scripts.test as no test script', (_, pkg) => {
      files({ 'package.json': pkg });
      unresolved(NO_SCRIPT);
    });

  it('[AC8] halts on a package.json that does not parse', () => {
    files({ 'package.json': '{not json' });
    unresolved(`${join(root, 'package.json')} does not parse, so its test script cannot be read`);
  });

  it('[AC8] records detect-stack\'s value for a stack with no package.json', () => {
    rmSync(join(root, 'package.json'));
    files({ 'go.mod': 'module example.com/demo\n\ngo 1.22\n' });
    expect(start().status).toBe(0);
    expect(runFile().test_command).toBe('go test ./...');
  });

  it('[AC8] halts when nothing names a test command', () => {
    rmSync(join(root, 'package.json'));
    unresolved(`detect-stack names no test command for ${root}`);
  });

  // A root with no package.json takes detect-stack's value as-is, and a workspace's script
  // reaches it verbatim: the one path by which a chaining command can resolve.
  it('[AC9] halts ORCH_TEST_COMMAND_UNSAFE on a resolved command that chains, recording nothing', () => {
    rmSync(join(root, 'package.json'));
    files({
      'pnpm-workspace.yaml': "packages:\n  - 'apps/*'\n",
      'apps/web/package.json': '{"dependencies":{"@angular/core":"17.0.0"},"scripts":{"test":"ng test && echo done"}}',
    });
    const r = start();
    expect(r.status).toBe(1);
    expect(r.err).toBe('ORCH_TEST_COMMAND_UNSAFE: "ng test && echo done" contains "&", which Guard 7 denies; nothing was recorded');
    expect(existsSync(join(root, RUN_FILE))).toBe(false);
  });

  it.each(SHELL_METACHARACTERS)('[D7] checkTestCommand halts on %j', (m) => {
    expect(() => checkTestCommand(`go test ${m} x`)).toThrow(/^ORCH_TEST_COMMAND_UNSAFE: /);
  });

  it('[D7] declares exactly the spec\'s metacharacter set', () => {
    expect(SHELL_METACHARACTERS).toEqual([';', '&', '|', '`', '$(', '<', '>', '\n', '\r']);
  });

  it('a start halt leaves a stale run of another session as it was', () => {
    orch(['start', 'FEAT-011'], { sid: 'old-session' });
    const before = readFileSync(join(root, RUN_FILE), 'utf8');
    writeFileSync(join(root, ENVELOPE_FILE), '{"stale":true}\n');
    files({ 'package.json': '{}' });
    const r = start();
    expect(r.status).toBe(1);
    expect(r.err).toBe(`ORCH_TEST_COMMAND_UNRESOLVED: ${NO_SCRIPT}`);
    expect(readFileSync(join(root, RUN_FILE), 'utf8')).toBe(before);
    expect(existsSync(join(root, ENVELOPE_FILE))).toBe(true);
  });

  // D9: the field is additive, so v stays 1 and a 1.36.0 run file still routes. Guard 7 is
  // what refuses a shell to a run that records no command (R3).
  it('[D9] still validates a run file that records no test_command', () => {
    expect(isValidRun({ v: 1, session_id: 's', item: 'FEAT-011', gate: 'boundary_routed', approvals: {}, handbacks: [], tasks: { ids: [], done: 0 } })).toBe(true);
  });
});

describe('ticket intake [FEAT-031 AC1-AC5, AC12]', () => {
  const REPO = 'acme/widgets';
  const SNAP = '.conductor/ticket/FEAT-031.md';
  const TICKET_SCRIPT = join(REPO_ROOT, 'scripts/ticket.mjs');
  const sha = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
  let gh;
  afterEach(() => { gh?.cleanup(); gh = undefined; });

  // orch() with the fake gh first on PATH; every other contract is orch()'s own.
  function orchGh(args, sid = 'sess-1') {
    const env = gh.env({ ...cleanGitEnv(), HOME: home, USERPROFILE: home, CLAUDE_CODE_SESSION_ID: sid });
    const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: root, env, encoding: 'utf8', timeout: 30000 });
    if (r.error) throw new Error(`orchestrate spawn failed: ${r.error.message}`);
    return { status: r.status, out: r.stdout.trim(), err: r.stderr.trim() };
  }
  const withIssues = (...list) => fakeGh({ issues: Object.fromEntries(list.map((i) => [`${REPO}#${i.number}`, i])) });
  const snapText = () => readFileSync(join(root, SNAP), 'utf8');

  it('an unbound start records no ticket key, writes no snapshot and runs no gh [AC1]', () => {
    gh = withIssues(issue(REPO, 5));
    expect(orchGh(['start', 'FEAT-031']).status).toBe(0);
    expect('ticket' in runFile()).toBe(false);
    expect(existsSync(join(root, '.conductor'))).toBe(false);
    expect(gh.calls()).toEqual([]);
  });

  it('a bound start fetches once and writes the B2 snapshot and a matching ticket key [AC2]', () => {
    const iss = issue(REPO, 5, { title: 'Add widgets' });
    gh = withIssues(iss);
    const r = orchGh(['start', 'FEAT-031', '--ticket', '5']);
    const hash = sha(iss.body);
    expect(r.out).toBe(`run FEAT-031 started; ticket ${REPO}#5 "Add widgets"; snapshot ${SNAP} sha256 ${hash}; docs: specs docs/specs, plans docs/plans (default); test command: npm test; audit rounds: 2${SEC_NONE}`);
    expect(gh.calls()).toEqual([['api', 'repos/{owner}/{repo}/issues/5']]);
    const url = `https://github.com/${REPO}/issues/5`;
    expect(runFile().ticket).toEqual({ repo: REPO, number: 5, url, sha256: hash, snapshot: SNAP });
    expect(parseSnapshotHeader(snapText(), 'FEAT-031')).toMatchObject({ repo: REPO, number: 5, url, sha256: hash });
  });

  it.each([
    ['TICKET_FLAG_INVALID', `https://github.com/${REPO}/pull/5`, []],
    ['TICKET_UNREACHABLE', '404', []],
    ['TICKET_NOT_ISSUE', '7', [pull(REPO, 7)]],
    ['TICKET_CLOSED', '8', [issue(REPO, 8, { state: 'closed' })]],
    ['TICKET_BODY_OVER_CAP', '9', [issue(REPO, 9, { body: String.fromCodePoint(0x20ac).repeat(21846) })]],
    ['TICKET_BODY_EMPTY', '10', [issue(REPO, 10, { body: null })]],
  ])('halts %s writing nothing, and leaves a stale run byte-unchanged [AC3]', (code, ref, list) => {
    gh = withIssues(...list);
    orchGh(['start', 'FEAT-011'], 'old-session');
    writeFileSync(join(root, ENVELOPE_FILE), '{"stale":true}\n');
    const before = readFileSync(join(root, RUN_FILE), 'utf8');
    const r = orchGh(['start', 'FEAT-031', '--ticket', ref]);
    expect(r.status).toBe(1);
    expect(r.err.startsWith(`${code}: `)).toBe(true);
    expect(readFileSync(join(root, RUN_FILE), 'utf8')).toBe(before);
    expect(existsSync(join(root, ENVELOPE_FILE))).toBe(true);
    expect(existsSync(join(root, SNAP))).toBe(false);
  });

  it('a --ticket with no value halts TICKET_FLAG_INVALID', () => {
    gh = withIssues();
    const r = orchGh(['start', 'FEAT-031', '--ticket']);
    expect(r.status).toBe(1);
    expect(r.err).toMatch(/^TICKET_FLAG_INVALID: /);
  });

  it('only the spec envelope carries p.ticket, identity only [AC4]', () => {
    gh = withIssues(issue(REPO, 5));
    agents();
    plan(TWO_TASKS);
    expect(orchGh(['start', 'FEAT-011', '--ticket', '5']).status).toBe(0);
    const { repo, number, url, sha256 } = runFile().ticket;
    const pOf = (role) => JSON.parse(orch(['install', role, '--check']).out).mem.p;
    expect(pOf('spec')).toEqual({ ticket: { repo, number, url, sha256 } });
    const seen = [];
    const pass = (role, gate, ...after) => { seen.push(pOf(role)); orch(['install', role]); orch(['handback', role], { input: say(role, gate) }); for (const a of after) orch(a); };
    pass('spec', 'boundary_routed', ['review', 'spec', '--close', 'skipped:fixture'], approveArgs('spec'));
    pass('plan', 'boundary_routed', ['review', 'plan', '--close', 'skipped:fixture'], approveArgs('plan'));
    pass('code', 'build_executed');
    pass('code', 'build_executed');
    pass('audit', 'build_executed');
    // FEAT-034: the role after audit is security; its envelope is read with --check, no hand-back needed.
    seen.push(pOf('security'));
    expect(seen.slice(1)).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });

  it('prints the title on the start line reduced: one line, no ESC, 120 characters at most [AC5]', () => {
    gh = withIssues(issue(REPO, 5, { title: `Fix\nthe \x1b[31mbug ${'x'.repeat(200)}` }));
    const r = orchGh(['start', 'FEAT-031', '--ticket', '5']);
    expect(r.out.split('\n')).toHaveLength(1);
    expect(r.out).not.toContain('\x1b');
    const title = r.out.match(/ticket acme\/widgets#5 "([^"]*)"/)[1];
    expect(title.startsWith('Fix the [31mbug x')).toBe(true);
    expect(title).toHaveLength(120);
  });

  it('keeps the binding across end and an unbound restart, and writeback targets it [AC12]', () => {
    gh = withIssues(issue(REPO, 123));
    orchGh(['start', 'FEAT-031', '--ticket', '123']);
    const bound = snapText();
    orch(['end']);
    expect(orchGh(['start', 'FEAT-031']).status).toBe(0);
    expect(snapText()).toBe(bound);
    const wb = spawnSync(process.execPath, [TICKET_SCRIPT, 'writeback', 'FEAT-031', '--version', '1.38.0', '--pr', '64'], { cwd: root, env: gh.env(cleanGitEnv()), encoding: 'utf8' });
    expect(wb.stdout).toMatch(/^posted to acme\/widgets#123 /);
  });

  it.each([[['--bogus']], [['--auto', '--auto']], [['--ticket', '5', '--ticket', '6']]])('refuses start FEAT-031 %j with exit 2, running no gh', (extra) => {
    gh = withIssues(issue(REPO, 5), issue(REPO, 6));
    const r = orchGh(['start', 'FEAT-031', ...extra]);
    expect(r.status).toBe(2);
    expect(r.err).toBe(START_USAGE);
    expect(existsSync(join(root, RUN_FILE))).toBe(false);
    expect(gh.calls()).toEqual([]);
  });

  it('takes --ticket and --auto in either order', () => {
    gh = withIssues(issue(REPO, 5));
    expect(orchGh(['start', 'FEAT-031', '--ticket', '5', '--auto']).status).toBe(0);
    expect(runFile()).toMatchObject({ mode: 'auto', ticket: { number: 5 } });
  });

  it('halts ORCH_RUN_ACTIVE before intake fetches anything', () => {
    gh = withIssues(issue(REPO, 5));
    orchGh(['start', 'FEAT-011']);
    const r = orchGh(['start', 'FEAT-031', '--ticket', '5']);
    expect(r.err).toMatch(/^ORCH_RUN_ACTIVE: /);
    expect(gh.calls()).toEqual([]);
  });

  it('resolves the test command before intake fetches anything', () => {
    gh = withIssues(issue(REPO, 5));
    writeFileSync(join(root, 'package.json'), '{"scripts":{}}');
    const r = orchGh(['start', 'FEAT-031', '--ticket', '5']);
    expect(r.err).toMatch(/^ORCH_TEST_COMMAND_UNRESOLVED: /);
    expect(gh.calls()).toEqual([]);
  });
});

// Drives a fresh run into the await window after `role`'s hand-back, where the loop runs (FEAT-041).
function awaiting(role) {
  driveTo(role);
  orch(['install', role]);
  orch(['handback', role], { input: say(role, 'boundary_routed') });
}
const loop = (role) => runFile().review?.[role];
const USAGE = 'orchestrate: usage: orchestrate.mjs review <spec|plan> --round <doc> | --record | --close skipped:<reason>';
const ROW = '- [AC] acceptance criterion 2 is not addressed (absent)';
const docOf = (role) => (role === 'spec' ? SPEC : PLAN);
function putDoc(role, text) {
  if (role === 'plan') return plan(text);
  mkdirSync(dirname(join(root, SPEC)), { recursive: true });
  writeFileSync(join(root, SPEC), text);
}
const reviewPath = (role, n) => `${REVIEW_DIR}/${role}-${n}.md`;
// Writes a review file the way the orchestrator does and returns the sha256 of its raw bytes.
function writeReview(role, n, verdict, rows = []) {
  mkdirSync(join(root, REVIEW_DIR), { recursive: true });
  writeFileSync(join(root, reviewPath(role, n)), ['Review.', ...rows, 'Notes: none.', `REVIEW ${role} round ${n}: ${verdict}`, ''].join('\n'));
  return sha(reviewPath(role, n));
}
// Drives `role` into the await window with its document on disk, then opens round 1.
function openFirst(role, text = role === 'spec' ? '# Demo spec\n' : TWO_TASKS) {
  awaiting(role);
  putDoc(role, text);
  return orch(['review', role, '--round', docOf(role)]);
}
// One OPEN record for round n, then a revision that writes `text`, then the next --round.
function reviseTo(role, n, text) {
  writeReview(role, n, 'OPEN 1', [ROW]);
  expect(orch(['review', role, '--record']).status).toBe(0);
  putDoc(role, text);
  return orch(['review', role, '--round', docOf(role)]);
}
const runText = () => readFileSync(join(root, RUN_FILE), 'utf8');

describe('review loop over review files [FEAT-058]', () => {
  it('R1 refuses --round outside the await window, writing nothing', () => {
    driveTo('spec');
    const before = runText();
    expect(orch(['review', 'spec', '--round', SPEC])).toMatchObject({ status: 2, err: 'orchestrate: review spec: the next step is install spec' });
    expect(runText()).toBe(before);
  });

  it('R2 opens round 1 on the document, recording its hash, its path and the reviewer pass', () => {
    expect(openFirst('spec')).toMatchObject({ status: 0, out: `review spec round 1 of 3: ${SPEC} sha256 ${sha(SPEC)}` });
    expect(loop('spec')).toEqual({ round: 1, outcome: null, sha256: sha(SPEC), doc: SPEC, await: 'review' });
  });

  it('R3 refuses --round while the reviewer pass is unrecorded, writing nothing', () => {
    openFirst('spec');
    const before = runText();
    expect(orch(['review', 'spec', '--round', SPEC])).toMatchObject({ status: 2, err: 'orchestrate: review spec: round 1 awaits its review record' });
    expect(runText()).toBe(before);
  });

  it('R4 refuses --record unless a reviewer pass is open', () => {
    awaiting('spec');
    expect(orch(['review', 'spec', '--record'])).toMatchObject({ status: 2, err: 'orchestrate: review spec --record: no reviewer pass is open' });
    putDoc('spec', '# Demo spec\n');
    orch(['review', 'spec', '--round', SPEC]);
    writeReview('spec', 1, 'OPEN 1', [ROW]);
    expect(orch(['review', 'spec', '--record']).status).toBe(0);
    expect(orch(['review', 'spec', '--record'])).toMatchObject({ status: 2, err: 'orchestrate: review spec --record: no reviewer pass is open' });
  });

  it('[E2] R5 --record on CLEAN closes clean, keeps only the outcome and removes .conductor/review', () => {
    openFirst('spec');
    writeReview('spec', 1, 'CLEAN');
    expect(orch(['review', 'spec', '--record'])).toMatchObject({ status: 0, out: 'review spec closed clean at round 1' });
    expect(loop('spec')).toEqual({ round: 1, outcome: 'clean', sha256: sha(SPEC) });
    expect(existsSync(join(root, REVIEW_DIR))).toBe(false);
  });

  it('[E1] R6 --record on OPEN below the cap prints the document and review paths with their hashes', () => {
    openFirst('spec');
    const h1 = sha(SPEC);
    const r1 = writeReview('spec', 1, 'OPEN 2', [ROW, '- [CR] the boundary case is not addressed (absent)']);
    expect(orch(['review', 'spec', '--record'])).toMatchObject({
      status: 0, out: `review spec round 1: OPEN 2; revise ${SPEC} sha256 ${h1} from .conductor/review/spec-1.md sha256 ${r1}`,
    });
    expect(loop('spec')).toEqual({ round: 1, outcome: null, sha256: h1, doc: SPEC, await: 'revision' });
    expect(existsSync(join(root, reviewPath('spec', 1)))).toBe(true);
  });

  it('[E2][E3] R7 a revision that leaves the spec unchanged closes the loop unchanged at the next round, exit 0', () => {
    openFirst('spec');
    const h1 = sha(SPEC);
    expect(reviseTo('spec', 1, '# Demo spec\n')).toMatchObject({ status: 0, out: `review spec closed unchanged at round 2: ${SPEC} still hashes ${h1}` });
    expect(loop('spec')).toEqual({ round: 2, outcome: 'unchanged', sha256: h1 });
    expect(existsSync(join(root, REVIEW_DIR))).toBe(false);
    expect(runFile().halt).toBeNull();
  });

  it('[E3] R8 a plan revision that only ticks checkboxes is unchanged', () => {
    openFirst('plan');
    const h1 = documentHash('plan', TWO_TASKS);
    const ticked = TWO_TASKS.replaceAll('- [ ] **Step 1', '- [X] **Step 1');
    expect(reviseTo('plan', 1, ticked).out).toBe(`review plan closed unchanged at round 2: ${PLAN} still hashes ${h1}`);
    expect(loop('plan')).toEqual({ round: 2, outcome: 'unchanged', sha256: h1 });
  });

  it('[E3] R9 a changed document opens the next round and records its new hash', () => {
    openFirst('spec');
    expect(reviseTo('spec', 1, '# Demo spec, revised\n')).toMatchObject({ status: 0, out: `review spec round 2 of 3: ${SPEC} sha256 ${sha(SPEC)}` });
    expect(loop('spec')).toEqual({ round: 2, outcome: null, sha256: sha(SPEC), doc: SPEC, await: 'review' });
  });

  it('[E2] R10 an OPEN record at round 3 closes cap, prints the rows and removes .conductor/review', () => {
    openFirst('spec');
    reviseTo('spec', 1, '# Demo spec, revision 1\n');
    reviseTo('spec', 2, '# Demo spec, revision 2\n');
    writeReview('spec', 3, 'OPEN 1', [ROW]);
    expect(orch(['review', 'spec', '--record'])).toMatchObject({ status: 0, out: `review spec closed cap at round 3\n${ROW}` });
    expect(loop('spec')).toEqual({ round: 3, outcome: 'cap', sha256: sha(SPEC) });
    expect(existsSync(join(root, REVIEW_DIR))).toBe(false);
  });

  it.each([
    ['a missing file', null],
    ['a bad last line', ['Review.', 'REVIEW spec round 1: DONE']],
    ['a verdict that is not the last non-blank line', ['REVIEW spec round 1: CLEAN', 'trailing prose']],
    ['the wrong role', ['REVIEW plan round 1: CLEAN']],
    ['the wrong round', ['REVIEW spec round 2: CLEAN']],
    ['OPEN with fewer rows than k', [ROW, 'REVIEW spec round 1: OPEN 2']],
    ['CLEAN with a row line', [ROW, 'REVIEW spec round 1: CLEAN']],
    ['OPEN 0', ['REVIEW spec round 1: OPEN 0']],
  ])('R11 --record refuses ORCH_REVIEW_UNPARSED on %s, writing nothing', (_name, lines) => {
    openFirst('spec');
    if (lines) {
      mkdirSync(join(root, REVIEW_DIR), { recursive: true });
      writeFileSync(join(root, reviewPath('spec', 1)), lines.join('\n') + '\n');
    }
    const before = runText();
    const r = orch(['review', 'spec', '--record']);
    expect(r.status).toBe(2);
    expect(r.err.startsWith('orchestrate: ORCH_REVIEW_UNPARSED: .conductor/review/spec-1.md ')).toBe(true);
    expect(runText()).toBe(before);
  });

  it('R12 --record refuses ORCH_REVIEW_DOC_MOVED when the document changed during the pass, writing nothing', () => {
    openFirst('spec');
    const h1 = sha(SPEC);
    putDoc('spec', '# Demo spec, edited mid-review\n');
    writeReview('spec', 1, 'CLEAN');
    const before = runText();
    expect(orch(['review', 'spec', '--record'])).toMatchObject({
      status: 2, err: `orchestrate: ORCH_REVIEW_DOC_MOVED: ${SPEC} no longer hashes ${h1}; the review describes a document that is gone`,
    });
    expect(runText()).toBe(before);
  });

  it('[E2] R13 --close skipped:<reason> removes .conductor/review at round 0 and at an open round', () => {
    awaiting('spec');
    writeReview('spec', 1, 'CLEAN');
    expect(orch(['review', 'spec', '--close', 'skipped:dispatch'])).toMatchObject({ status: 0, out: 'review spec closed skipped:dispatch at round 0' });
    expect(loop('spec')).toEqual({ round: 0, outcome: 'skipped:dispatch', sha256: null });
    expect(existsSync(join(root, REVIEW_DIR))).toBe(false);
    expect(orch(approveArgs('spec')).status).toBe(0);
    orch(['install', 'plan']);
    orch(['handback', 'plan'], { input: say('plan', 'boundary_routed') });
    orch(['review', 'plan', '--round', PLAN]);
    writeReview('plan', 1, 'OPEN 1', [ROW]);
    expect(orch(['review', 'plan', '--close', 'skipped:blocked']).out).toBe('review plan closed skipped:blocked at round 1');
    expect(loop('plan')).toEqual({ round: 1, outcome: 'skipped:blocked', sha256: sha(PLAN) });
    expect(existsSync(join(root, REVIEW_DIR))).toBe(false);
  });

  it.each(['clean', 'cap', 'unchanged', 'skipped:', 'skipped:Denied', 'skipped:a b', `skipped:${'a'.repeat(41)}`, 'done'])('R14 --close %j refuses with the usage line, writing nothing', (outcome) => {
    awaiting('spec');
    expect(orch(['review', 'spec', '--close', outcome])).toMatchObject({ status: 2, err: USAGE });
    expect(loop('spec')).toBeUndefined();
  });

  it('R15 refuses a malformed call with the usage line', () => {
    awaiting('spec');
    const calls = [['spec'], ['spec', '--open'], ['spec', '--round'], ['spec', '--round', SPEC, 'x'], ['spec', '--record', 'x'], ['spec', '--close'], ['spec', '--close', 'skipped:verb', 'x']];
    for (const args of calls) expect(orch(['review', ...args])).toMatchObject({ status: 2, err: USAGE });
    expect(loop('spec')).toBeUndefined();
  });

  it('R16 a closed loop refuses every form', () => {
    awaiting('spec');
    putDoc('spec', '# Demo spec\n');
    orch(['review', 'spec', '--close', 'skipped:verb']);
    for (const args of [['--round', SPEC], ['--record'], ['--close', 'skipped:verb']]) {
      expect(orch(['review', 'spec', ...args])).toMatchObject({ status: 2, err: 'orchestrate: review spec: the loop closed skipped:verb; a closed loop does not reopen' });
    }
  });

  it('R17 refuses a fourth round with ORCH_REVIEW_CAP, a refusal that sets no halt', () => {
    awaiting('spec');
    putDoc('spec', '# Demo spec\n');
    const seeded = { round: 3, outcome: null, sha256: 'a'.repeat(64), doc: SPEC, await: 'revision' };
    runFileText(JSON.stringify({ ...runFile(), review: { spec: seeded } }));
    expect(orch(['review', 'spec', '--round', SPEC])).toMatchObject({
      status: 2, err: 'orchestrate: ORCH_REVIEW_CAP: review spec has run 3 rounds; close it with --close skipped:<reason>',
    });
    expect(runFile().halt).toBeNull();
    expect(loop('spec')).toEqual(seeded);
  });

  it.each([
    ['an absolute path', () => join(root, SPEC), USAGE],
    ['a path with ..', () => '../demo-design.md', USAGE],
    ['a missing file', () => 'docs/none.md', 'orchestrate: cannot read docs/none.md'],
  ])('R18 --round refuses %s, writing nothing', (_name, rel, err) => {
    awaiting('spec');
    putDoc('spec', '# Demo spec\n');
    expect(orch(['review', 'spec', '--round', rel()])).toMatchObject({ status: 2, err });
    expect(loop('spec')).toBeUndefined();
  });

  it('R19 runs a separate loop for plan in its own window, and refuses spec there', () => {
    openFirst('plan');
    expect(orch(['review', 'spec', '--round', SPEC])).toMatchObject({ status: 2, err: 'orchestrate: review spec: the next step is approve plan' });
    expect(Object.keys(runFile().review)).toEqual(['spec', 'plan']);
    expect(loop('plan')).toMatchObject({ round: 1, outcome: null, await: 'review' });
  });

  it('R20 a loop opened before FEAT-058 refuses --record and closes as an explicit skip', () => {
    awaiting('spec');
    runFileText(JSON.stringify({ ...runFile(), review: { spec: { round: 1, outcome: null } } }));
    expect(orch(['review', 'spec', '--record'])).toMatchObject({ status: 2, err: 'orchestrate: review spec --record: no reviewer pass is open' });
    expect(orch(['review', 'spec', '--close', 'skipped:verb']).status).toBe(0);
    expect(loop('spec')).toEqual({ round: 1, outcome: 'skipped:verb', sha256: null });
    expect(orch(approveArgs('spec')).status).toBe(0);
  });

  it('M1 the main path: OPEN, a revision, CLEAN, then the approval of the revised hash', () => {
    openFirst('spec');
    expect(reviseTo('spec', 1, '# Demo spec, revised\n').out).toBe(`review spec round 2 of 3: ${SPEC} sha256 ${sha(SPEC)}`);
    writeReview('spec', 2, 'CLEAN');
    expect(orch(['review', 'spec', '--record']).out).toBe('review spec closed clean at round 2');
    expect(orch(['approve', 'spec', SPEC, sha(SPEC)])).toMatchObject({ status: 0, out: `spec approved: sha256 ${sha(SPEC)}` });
    expect(loop('spec')).toEqual({ round: 2, outcome: 'clean', sha256: sha(SPEC) });
    expect(existsSync(join(root, REVIEW_DIR))).toBe(false);
  });

  it.each(['spec', 'plan'])('P1 approve %s refuses ORCH_REVIEW_OPEN when the loop never ran, writing nothing', (kind) => {
    awaiting(kind);
    const args = approveArgs(kind);
    const before = runText();
    expect(orch(args)).toMatchObject({ status: 2, err: `orchestrate: ORCH_REVIEW_OPEN: review ${kind} is not run; close it before the approval` });
    expect(runText()).toBe(before);
  });

  it.each(['spec', 'plan'])('P2 approve %s refuses ORCH_REVIEW_OPEN while the loop is open, writing nothing', (kind) => {
    openFirst(kind);
    const args = approveArgs(kind);
    const before = runText();
    expect(orch(args)).toMatchObject({ status: 2, err: `orchestrate: ORCH_REVIEW_OPEN: review ${kind} is open at round 1; close it before the approval` });
    expect(runText()).toBe(before);
  });

  it.each(['clean', 'unchanged', 'skipped:owner'])('P3 approve spec passes once the loop closed %s', (outcome) => {
    openFirst('spec');
    if (outcome === 'clean') { writeReview('spec', 1, 'CLEAN'); orch(['review', 'spec', '--record']); }
    if (outcome === 'unchanged') reviseTo('spec', 1, '# Demo spec\n');
    if (outcome === 'skipped:owner') orch(['review', 'spec', '--close', outcome]);
    expect(loop('spec').outcome).toBe(outcome);
    expect(orch(approveArgs('spec')).status).toBe(0);
  });

  it('isValidRun accepts a run with and without review, unchanged', () => {
    const run = { v: 1, session_id: 's', item: 'FEAT-041', ...blank };
    expect(isValidRun(run)).toBe(true);
    expect(isValidRun({ ...run, review: { spec: { round: 1, outcome: 'clean', sha256: 'a'.repeat(64) } } })).toBe(true);
    expect(isValidRun({ ...run, review: { spec: { round: 1, outcome: null, sha256: 'a'.repeat(64), doc: SPEC, await: 'review' } } })).toBe(true);
  });

  it('[E2] end prints the review record and removes .conductor/review', () => {
    openFirst('spec');
    writeReview('spec', 1, 'CLEAN');
    expect(JSON.parse(orch(['end']).out).review).toEqual({ spec: { round: 1, outcome: null, sha256: sha(SPEC), doc: SPEC, await: 'review' } });
    expect(existsSync(join(root, REVIEW_DIR))).toBe(false);
  });

  it('a start over a stale run clears .conductor/review', () => {
    orch(['start', 'FEAT-011'], { sid: 'old-session' });
    mkdirSync(join(root, REVIEW_DIR), { recursive: true });
    writeFileSync(join(root, reviewPath('spec', 1)), 'stale\n');
    expect(orch(['start', 'FEAT-012']).status).toBe(0);
    expect(existsSync(join(root, REVIEW_DIR))).toBe(false);
  });

  it('refuses on a halted run, writing nothing', () => {
    awaiting('spec');
    putDoc('spec', '# Demo spec\n');
    runFileText(JSON.stringify({ ...runFile(), halt: { code: 'SNAP_ERROR', reason: 'x', at: 'y' } }));
    const r = orch(['review', 'spec', '--round', SPEC]);
    expect(r.status).toBe(2);
    expect(r.err).toContain('halted with SNAP_ERROR');
    expect(loop('spec')).toBeUndefined();
  });

  it('[RF2] starts fresh over a corrupt review field instead of crashing', () => {
    awaiting('spec');
    putDoc('spec', '# Demo spec\n');
    const opened = `review spec round 1 of 3: ${SPEC} sha256 ${sha(SPEC)}`;
    runFileText(JSON.stringify({ ...runFile(), review: 'corrupt' }));
    expect(orch(['review', 'spec', '--round', SPEC]).out).toBe(opened);
    runFileText(JSON.stringify({ ...runFile(), review: { spec: { round: 'two', outcome: null } } }));
    expect(orch(['review', 'spec', '--round', SPEC]).out).toBe(opened);
    expect(loop('spec')).toEqual({ round: 1, outcome: null, sha256: sha(SPEC), doc: SPEC, await: 'review' });
  });

  it('[FEAT-061, FEAT-055] names review, resume and envelope in the usage line', () => {
    expect(orch(['nope']).err).toBe('orchestrate: usage: orchestrate.mjs start|install|handback|approve|hash|review|resume|envelope|end');
  });
});

describe('doc locations [FEAT-047]', () => {
  const put = (rel, text = '# x\n') => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  };
  const scopeOf = (role) => {
    const r = orch(['install', role, '--check']);
    expect(r.status).toBe(0);
    return JSON.parse(r.out).ops.scope;
  };
  // Spec through approval without plan(), so no other candidate pair exists at start.
  const approveSpec = () => {
    expect(orch(['install', 'spec']).status).toBe(0);
    expect(orch(['handback', 'spec'], { input: say('spec', 'boundary_routed') }).status).toBe(0);
    expect(skipLoop('spec').status).toBe(0);
    expect(orch(approveArgs('spec')).status).toBe(0);
  };
  const recorded = (specs, plans) => put('CLAUDE.md', `# P\n\n${specs ? `- Specs: ${specs}\n` : ''}${plans ? `- Plans: ${plans}\n` : ''}`);
  const halts = (code) => {
    const r = orch(['start', 'FEAT-012']);
    expect(r.status).toBe(1);
    expect(r.err.startsWith(`${code}: `)).toBe(true);
    return r;
  };

  it('[AC4] names no literal spec or plan folder', () => {
    expect(ROLE_ARTIFACTS.spec.scope).toBeNull();
    expect(ROLE_ARTIFACTS.plan.scope).toBeNull();
    expect(readFileSync(SCRIPT, 'utf8')).not.toContain('docs/superpowers');
  });

  it('pins the discovered pair at start and derives both envelope scopes from it', () => {
    agents();
    put('.claude/specs/a.md');
    expect(orch(['start', 'FEAT-011']).status).toBe(0);
    expect(runFile().docs).toEqual({
      specs: '.claude/specs', plans: '.claude/plans', group: null, source: 'discovered',
      scopes: { spec: ['.claude/specs/**'], plan: ['.claude/plans/**'] },
    });
    expect(scopeOf('spec')).toEqual(['.claude/specs/**']);
    approveSpec();
    expect(scopeOf('plan')).toEqual(['.claude/plans/**']);
  });

  it('[AC7] groups both scopes under the backlog group', () => {
    agents();
    put('.claude/specs/a.md');
    put('.claude/plans/b.md');
    put('BACKLOG.md', '# Backlog\n\n## Pillar 3: X\n\n### [ ] `[FEAT-011]` y\n');
    const r = orch(['start', 'FEAT-011']);
    expect(r.status).toBe(0);
    expect(runFile().docs).toEqual({
      specs: '.claude/specs', plans: '.claude/plans', group: 'pillar-3', source: 'discovered',
      scopes: { spec: ['.claude/specs/pillar-3/**'], plan: ['.claude/plans/pillar-3/**'] },
    });
    expect(r.out.endsWith('docs: specs .claude/specs, plans .claude/plans (discovered); group pillar-3; test command: npm test; audit rounds: 2' + SEC_NONE)).toBe(true);
    expect(scopeOf('spec')).toEqual(['.claude/specs/pillar-3/**']);
    approveSpec();
    expect(scopeOf('plan')).toEqual(['.claude/plans/pillar-3/**']);
  });

  it('[AC10] never writes CLAUDE.md and keeps the write surface', () => {
    const calls = /(writeFileSync|writeAtomic|appendFileSync|renameSync|rmSync)\(/;
    for (const line of readFileSync(SCRIPT, 'utf8').split(/\r?\n/)) {
      expect(line).not.toMatch(/(writeFileSync|writeAtomic|appendFileSync|renameSync|rmSync)\([^)]*CLAUDE\.md/);
      if (line.includes('CLAUDE.md')) expect(line).not.toMatch(calls);
    }
    expect(WRITE_SURFACE).toEqual(['.claude/memory/orchestrator-run.json', '.claude/memory/band-envelope.json', '.claude/memory/session-snapshot.json', '.conductor/**']);
  });

  it('[AC6] keeps the pair pinned at start when CLAUDE.md changes mid-run', () => {
    agents();
    expect(orch(['start', 'FEAT-011']).status).toBe(0);
    const before = runFile().docs;
    recorded('other/specs', 'other/plans');
    expect(scopeOf('spec')).toEqual(['docs/specs/**']);
    expect(runFile().docs).toEqual(before);
  });

  it('[AC6] a recorded pair wins over a busier discovered one at start', () => {
    recorded('rec/specs', 'rec/plans');
    put('docs/superpowers/specs/a.md');
    put('docs/superpowers/specs/b.md');
    expect(orch(['start', 'FEAT-011']).status).toBe(0);
    expect(runFile().docs).toMatchObject({ specs: 'rec/specs', plans: 'rec/plans', source: 'claude-md' });
  });

  it.each([
    ['half-recorded', ['rec/specs', null]],
    ['an invalid value', ['../x', 'rec/plans']],
    ['an overlapping pair', ['docs/a', 'docs/a/b']],
  ])('[AC9] halts start on %s and records no run', (_, [specs, plans]) => {
    recorded(specs, plans);
    halts('ORCH_DOC_LOCATION_INVALID');
    expect(existsSync(join(root, RUN_FILE))).toBe(false);
  });

  it('[AC9] halts start on a recorded enforcement folder and records no run (review #120)', () => {
    recorded('.claude/hooks', 'rec/plans');
    const r = halts('ORCH_DOC_LOCATION_INVALID');
    expect(r.err).toContain('`- Specs: .claude/hooks`');
    expect(r.err).toContain('reserved `.claude/hooks`');
    expect(existsSync(join(root, RUN_FILE))).toBe(false);
  });

  it('[AC9] leaves a stale run in place when start halts on the doc location', () => {
    expect(orch(['start', 'FEAT-011'], { sid: 'old-session' }).status).toBe(0);
    recorded('rec/specs', null);
    halts('ORCH_DOC_LOCATION_INVALID');
    expect(runFile().item).toBe('FEAT-011');
  });

  it('[AC9] docScopes halts over the element cap, and every known pair fits the longest group', () => {
    let thrown;
    try { docScopes({ specs: 'a'.repeat(300), plans: 'p', group: null }); } catch (e) { thrown = e; }
    expect(thrown).toBeInstanceOf(Halt);
    expect(thrown.code).toBe('ORCH_SCOPE_OVER_CAP');
    for (const pair of [...CANDIDATE_PAIRS, DEFAULT_PAIR]) {
      expect(() => docScopes({ ...pair, group: 'x'.repeat(47) })).not.toThrow();
    }
  });

  // snap-build truncates an over-long element to the cap (snap-build.mjs normArray), so the
  // validator never sees it; this pins only that the router itself does not re-check.
  it('[AC9] install does not re-check the cap', () => {
    agents();
    expect(orch(['start', 'FEAT-011']).status).toBe(0);
    const run = runFile();
    runFileText(JSON.stringify({ ...run, docs: { ...run.docs, scopes: { ...run.docs.scopes, spec: ['x'.repeat(301)] } } }));
    const r = orch(['install', 'spec', '--check']);
    expect(r.err).not.toContain('ORCH_SCOPE_OVER_CAP');
  });

  it('halts install on a run started before FEAT-047, and end still clears it', () => {
    agents();
    expect(orch(['start', 'FEAT-011']).status).toBe(0);
    const { docs, ...old } = runFile();
    expect(docs).toBeDefined();
    runFileText(JSON.stringify(old));
    expect(isValidRun(old)).toBe(true);
    const r = orch(['install', 'spec']);
    expect(r.status).toBe(1);
    expect(r.err).toMatch(/^ORCH_DOC_LOCATION_UNRESOLVED: .*\bend\b.*\bstart\b/);
    expect(orch(['end']).status).toBe(0);
    expect(existsSync(join(root, RUN_FILE))).toBe(false);
  });
});

describe('audit verdict [FEAT-060]', () => {
  const minor = ['- [minor] src/a.js:3 — a nit', '- [minor] src/b.js:4 — another nit'];
  const severe = ['- [blocker] src/a.js:10 — breaks AC1', '- [major] src/b.js:2 — misses an edge'];
  const noCode = (code) => (text) => { try { parseVerdict(text); } catch (e) { return e.code === code; } return false; };

  it.each([
    ['APPROVE with no findings', auditReport('VERDICT: APPROVE'), 'APPROVE', 0, []],
    ['APPROVE with only minor findings', auditReport('VERDICT: APPROVE', minor), 'APPROVE', 0, []],
    ['RETURN with a blocker and a major', auditReport('VERDICT: RETURN', severe), 'RETURN', 2, ['src/a.js', 'src/b.js']],
    ['ESCALATE with no findings', auditReport('VERDICT: ESCALATE'), 'ESCALATE', 0, []],
    ['ESCALATE with a major finding', auditReport('VERDICT: ESCALATE', ['- [major] src/a.js:1 — needs a new dependency']), 'ESCALATE', 1, ['src/a.js']],
    ['a CRLF report', auditReport('VERDICT: APPROVE').replace(/\n/g, '\r\n'), 'APPROVE', 0, []],
    ['blank lines between the verdict and SNAP_HANDBACK', ['Done.', 'VERDICT: APPROVE', '', '', handbackLine('audit', 'build_executed'), ''].join('\n'), 'APPROVE', 0, []],
    ['prose that names the verdict mid-line', auditReport('VERDICT: APPROVE', ['The verdict depends on the plan.']), 'APPROVE', 0, []],
  ])('parseVerdict accepts %s', (_name, text, verdict, blockers, paths) => {
    expect(parseVerdict(text)).toEqual({ verdict, blockers, paths });
  });

  const between = ['Done.', 'VERDICT: RETURN', '- [blocker] src/a.js:10 — x', handbackLine('audit', 'build_executed'), ''].join('\n');
  const after = ['Done.', handbackLine('audit', 'build_executed'), 'VERDICT: APPROVE', ''].join('\n');
  it.each([
    ['no verdict line', auditReport(null), 'ORCH_VERDICT_MISSING'],
    ['only prose naming the verdict mid-line', auditReport(null, ['The verdict depends on the plan.']), 'ORCH_VERDICT_MISSING'],
    ['two VERDICT lines', auditReport('VERDICT: APPROVE', ['VERDICT: APPROVE']), 'ORCH_VERDICT_INVALID', 'found 2'],
    ['Verdict: approve', auditReport('Verdict: approve'), 'ORCH_VERDICT_INVALID'],
    ['VERDICT:APPROVE with a trailing space', auditReport('VERDICT:APPROVE '), 'ORCH_VERDICT_INVALID'],
    ['VERDICT: APPROVED', auditReport('VERDICT: APPROVED'), 'ORCH_VERDICT_INVALID'],
    ['the template copied', auditReport('VERDICT: APPROVE | RETURN | ESCALATE'), 'ORCH_VERDICT_INVALID'],
    ['a finding line between the verdict and SNAP_HANDBACK', between, 'ORCH_VERDICT_INVALID', 'immediately precede'],
    ['the verdict after SNAP_HANDBACK', after, 'ORCH_VERDICT_INVALID', 'immediately precede'],
    ['APPROVE with a blocker', auditReport('VERDICT: APPROVE', ['- [blocker] src/a.js:1 — x']), 'ORCH_VERDICT_INCONSISTENT'],
    ['APPROVE with a major', auditReport('VERDICT: APPROVE', ['- [major] src/a.js:1 — x']), 'ORCH_VERDICT_INCONSISTENT'],
    ['RETURN with only minor findings', auditReport('VERDICT: RETURN', minor), 'ORCH_VERDICT_INCONSISTENT'],
    ['RETURN with no findings', auditReport('VERDICT: RETURN'), 'ORCH_VERDICT_INCONSISTENT'],
    ['RETURN whose only blocker carries no file:line', auditReport('VERDICT: RETURN', ['- [blocker] the whole design — x']), 'ORCH_VERDICT_INCONSISTENT'],
  ])('parseVerdict halts %s with %s', (_name, text, code, fragment) => {
    expect(noCode(code)(text)).toBe(true);
    if (fragment) expect(() => parseVerdict(text)).toThrow(fragment);
  });

  it('parseVerdict quotes a malformed line capped at 120 characters', () => {
    const line = `VERDICT: ${'X'.repeat(300)}`;
    let halt;
    try { parseVerdict(auditReport(line)); } catch (e) { halt = e; }
    expect(halt).toBeInstanceOf(Halt);
    expect(halt.reason).toContain(JSON.stringify(line.slice(0, 120)));
    expect(halt.reason).not.toContain(line.slice(0, 121));
  });

  it('[FEAT-059] parseVerdict names the role in ORCH_VERDICT_MISSING and keeps the audit text by default', () => {
    expect(() => parseVerdict(auditReport(null))).toThrow('ORCH_VERDICT_MISSING: the audit report has no VERDICT: APPROVE | RETURN | ESCALATE line');
    expect(() => parseVerdict(auditReport(null), 'security')).toThrow('ORCH_VERDICT_MISSING: the security report has no VERDICT: APPROVE | RETURN | ESCALATE line');
  });

  it('APPROVE with minor findings records the verdict and lets qa forward verify_pass', () => {
    driveTo('audit', { seat: true });
    expect(orch(['install', 'audit']).status).toBe(0);
    expect(orch(['handback', 'audit'], { input: auditReport('VERDICT: APPROVE', ['- [minor] src/a.js:3 — nit']) }).status).toBe(0);
    expect(runFile().handbacks.at(-1)).toMatchObject({ role: 'audit', verdict: 'APPROVE' });
    expect(securityPass().status).toBe(0);
    expect(orch(['install', 'qa']).status).toBe(0);
    expect(orch(['handback', 'qa'], { input: say('qa', 'verify_pass') }).status).toBe(0);
    expect(runFile().gate).toBe('verify_pass');
  });

  it.each([
    ['VERDICT: RETURN', ['- [blocker] src/a.js:10 — breaks AC1'], 'ORCH_AUDIT_RETURN', ['--audit-rounds', '0']],
    ['VERDICT: ESCALATE', [], 'ORCH_AUDIT_ESCALATE', []],
  ])('a valid %s halts %s after recording the audit entry, and install qa is refused', (line, findings, code, start) => {
    driveTo('audit', { start });
    orch(['install', 'audit']);
    const r = orch(['handback', 'audit'], { input: auditReport(line, findings) });
    expect(r.status).toBe(1);
    expect(r.err).toMatch(new RegExp(`^${code}: `));
    expect(r.err).toContain('.conductor/handback/audit-1.txt');
    expect(runFile().handbacks.at(-1)).toMatchObject({ role: 'audit', verdict: line.slice('VERDICT: '.length) });
    expect(runFile().halt.code).toBe(code);
    expect(orch(['install', 'qa']).status).toBe(2);
  });

  it.each([
    ['ORCH_VERDICT_MISSING', auditReport(null)],
    ['ORCH_VERDICT_INVALID', auditReport('VERDICT: approved')],
    ['ORCH_VERDICT_INVALID', auditReport('VERDICT: APPROVE', ['VERDICT: APPROVE'])],
    ['ORCH_VERDICT_INVALID', ['Done.', 'VERDICT: RETURN', '- [blocker] src/a.js:10 — x', handbackLine('audit', 'build_executed'), ''].join('\n')],
    ['ORCH_VERDICT_INCONSISTENT', auditReport('VERDICT: APPROVE', ['- [major] src/a.js:1 — x'])],
  ])('handback audit halts %s through the CLI, recording no audit entry', (code, input) => {
    driveTo('audit');
    orch(['install', 'audit']);
    const r = orch(['handback', 'audit'], { input });
    expect(r.status).toBe(1);
    expect(r.err.startsWith(code)).toBe(true);
    expect(runFile().halt.code).toBe(code);
    expect(runFile().handbacks.some((h) => h.role === 'audit')).toBe(false);
  });

  it('the existing hand-back checks run first: a wrong gate with no verdict halts ORCH_GATE_UNEARNED', () => {
    driveTo('audit');
    orch(['install', 'audit']);
    const r = orch(['handback', 'audit'], { input: `Done.\n${handbackLine('audit', 'verify_pass')}\n` });
    expect(r.status).toBe(1);
    expect(r.err).toContain('ORCH_GATE_UNEARNED');
  });

  const withAudit = (verdict) => ({ ...blank, gate: 'build_executed', handbacks: [{ role: 'audit', ...(verdict ? { verdict } : {}) }] });
  it.each(['RETURN', 'ESCALATE', undefined])('recordHandback refuses qa verify_pass after an audit verdict of %s', (v) => {
    expect(() => recordHandback(withAudit(v), 'qa', 'verify_pass')).toThrow('ORCH_GATE_WITHHELD');
  });

  it('recordHandback forwards qa verify_pass after APPROVE', () => {
    expect(recordHandback(withAudit('APPROVE'), 'qa', 'verify_pass').gate).toBe('verify_pass');
  });

  it('recordHandback writes a verdict on the entry only when given one', () => {
    const run = { ...blank, gate: 'build_executed' };
    expect(recordHandback(run, 'audit', 'build_executed', 'RETURN').handbacks.at(-1).verdict).toBe('RETURN');
    expect(recordHandback(run, 'audit', 'build_executed').handbacks.at(-1)).not.toHaveProperty('verdict');
  });

  it('isValidRun accepts audit entries with and without a verdict', () => {
    driveTo('qa');
    const run = runFile();
    expect(isValidRun(run)).toBe(true);
    delete run.handbacks.find((h) => h.role === 'audit').verdict;
    expect(isValidRun(run)).toBe(true);
  });
});

describe('document hash [FEAT-056]', () => {
  const UNTICKED = '# P\n\n### Task 1: a\n\n**Files:**\n- Modify: `src/a.js`\n\n- [ ] [S-1] step one\n  - [ ] [S-1-A] nested\n1. [ ] ordered\n* [ ] star\n+ [ ] plus\n';
  const tick = (text, box) => text.replaceAll('[ ]', box);
  const put = (rel, text) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text); };
  const edited = () => TWO_TASKS.replace('thing 1', 'thing one');
  const tickPlan = (box) => plan(TWO_TASKS.replaceAll('- [ ] **Step 1', `- ${box} **Step 1`));
  const runText = () => readFileSync(join(root, RUN_FILE), 'utf8');
  const raw = (text) => createHash('sha256').update(text).digest('hex');
  const HASH_USAGE = 'orchestrate: usage: orchestrate.mjs hash <spec|plan> <path relative to the run root>';
  const APPROVE_USAGE = 'orchestrate: usage: orchestrate.mjs approve <spec|plan> <path relative to the run root> <sha256>';

  it('D1 hashes a spec over its raw bytes', () => {
    const bytes = Buffer.from([0x23, 0x20, 0xff, 0xfe, 0x0a]);
    expect(documentHash('spec', bytes)).toBe(raw(bytes));
  });

  it.each(['[>]', '[X]', '[x]', '[!]'])('D2 a plan box ticked to %s keeps the plan hash', (box) => {
    expect(documentHash('plan', tick(UNTICKED, box))).toBe(documentHash('plan', UNTICKED));
  });

  it('D3 an unticked plan hashes to its raw sha256, and ticks on CRLF lines are normalized', () => {
    expect(documentHash('plan', UNTICKED)).toBe(raw(UNTICKED));
    const crlf = UNTICKED.replaceAll('\n', '\r\n');
    expect(documentHash('plan', tick(UNTICKED, '[X]').replaceAll('\n', '\r\n'))).toBe(documentHash('plan', crlf));
    expect(documentHash('plan', crlf)).not.toBe(documentHash('plan', UNTICKED));
  });

  it.each([
    ['one character of a task line changes', UNTICKED, UNTICKED.replace('step one', 'step One')],
    ['a box in prose is ticked', 'See [ ] here.\n', 'See [x] here.\n'],
    ['a box in a table cell is ticked', '| a | [ ] |\n', '| a | [x] |\n'],
    ['a box after list-item text is ticked', '- item [ ] done\n', '- item [x] done\n'],
  ])('D4 the plan hash changes when %s', (_name, before, after) => {
    expect(documentHash('plan', after)).not.toBe(documentHash('plan', before));
  });

  it('H1 hash spec prints the sha256sum of the raw bytes with no run file, and writes nothing', () => {
    put(SPEC, '# Spec\r\né\n');
    expect(orch(['hash', 'spec', SPEC])).toEqual({ status: 0, out: `${sha(SPEC)}  ${SPEC}`, err: '' });
    expect(existsSync(join(root, RUN_FILE))).toBe(false);
  });

  it('H2 hash plan prints the normalized hash in a live run and leaves the run file byte-identical', () => {
    awaiting('plan');
    tickPlan('[X]');
    const before = runText();
    const r = orch(['hash', 'plan', PLAN]);
    expect(r.status).toBe(0);
    expect(r.out).toBe(`${documentHash('plan', TWO_TASKS)}  ${PLAN}`);
    expect(runText()).toBe(before);
  });

  it.each([
    ['no path', () => ['hash', 'spec'], HASH_USAGE],
    ['an absolute path', () => ['hash', 'spec', join(root, SPEC)], HASH_USAGE],
    ['a path with ..', () => ['hash', 'spec', '../x.md'], HASH_USAGE],
    ['an unknown kind', () => ['hash', 'ticket', SPEC], HASH_USAGE],
    ['a missing file', () => ['hash', 'spec', 'docs/none.md'], 'orchestrate: cannot read docs/none.md'],
  ])('H3 hash refuses %s with exit 2', (_name, args, err) => {
    put(SPEC, '# Spec\n');
    expect(orch(args())).toMatchObject({ status: 2, err });
  });

  it.each(['spec', 'plan'])('A1 approve %s against a stale hash refuses ORCH_DOC_HASH_STALE and writes nothing', (kind) => {
    awaiting(kind);
    skipLoop(kind);
    const [, , rel, shown] = approveArgs(kind);
    if (kind === 'spec') put(SPEC, '# Demo spec, revised\n'); else plan(edited());
    const before = runText();
    const r = orch(['approve', kind, rel, shown]);
    expect(r.status).toBe(2);
    expect(r.err).toBe(`orchestrate: ORCH_DOC_HASH_STALE: ${kind} ${rel} hashes ${sha(rel)}, not the ${shown} that was shown; show the document again`);
    expect(runText()).toBe(before);
  });

  it.each([
    ['no path and no hash', () => ['approve', 'spec']],
    ['no hash', () => ['approve', 'spec', SPEC]],
    ['a hash that is not 64 hex characters', () => ['approve', 'spec', SPEC, 'abc123']],
    ['an absolute path', () => ['approve', 'spec', join(root, SPEC), sha(SPEC)]],
    ['a path with ..', () => ['approve', 'spec', '../demo-design.md', sha(SPEC)]],
  ])('A2 approve refuses %s with the usage line and writes nothing', (_name, args) => {
    awaiting('spec');
    put(SPEC, '# Demo spec\n');
    const before = runText();
    expect(orch(args())).toMatchObject({ status: 2, err: APPROVE_USAGE });
    expect(runText()).toBe(before);
  });

  it('A3 both approvals record exactly at, by, path, commit and a lower-case sha256, from an upper-case argument [FEAT-055]', () => {
    awaiting('spec');
    skipLoop('spec');
    const specSha = approveArgs('spec')[3];
    expect(orch(['approve', 'spec', SPEC, specSha.toUpperCase()])).toMatchObject({ status: 0, out: `spec approved: sha256 ${specSha}` });
    orch(['install', 'plan']);
    orch(['handback', 'plan'], { input: say('plan', 'boundary_routed') });
    skipLoop('plan');
    expect(orch(approveArgs('plan')).out).toBe(`plan approved: define_approved, 2 task(s); sha256 ${sha(PLAN)}`);
    for (const [a, rel] of [[runFile().approvals.spec, SPEC], [runFile().approvals.plan, PLAN]]) {
      expect(Object.keys(a).sort()).toEqual(['at', 'by', 'commit', 'path', 'sha256']);
      expect(a).toMatchObject({ path: rel, sha256: sha(rel), by: expect.any(String) });
      expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('A4 a plan whose boxes were ticked between hash and approve still approves', () => {
    awaiting('plan');
    skipLoop('plan');
    const shown = sha(PLAN);
    tickPlan('[X]');
    expect(orch(['approve', 'plan', PLAN, shown]).status).toBe(0);
    expect(runFile().approvals.plan.sha256).toBe(shown);
  });

  it('B1 ticking boxes after approval keeps every later install passing', () => {
    driveTo('code', { seat: true });
    for (const box of ['[>]', '[X]']) {
      expect(orch(['install', 'code']).status).toBe(0);
      tickPlan(box);
      expect(orch(['handback', 'code'], { input: say('code', 'build_executed') }).status).toBe(0);
    }
    tickPlan('[x]');
    expect(orch(['install', 'audit']).status).toBe(0);
    expect(orch(['handback', 'audit'], { input: say('audit', 'build_executed') }).status).toBe(0);
    expect(securityPass().status).toBe(0);
    tickPlan('[!]');
    expect(orch(['install', 'qa']).status).toBe(0);
    expect(runFile().halt).toBeNull();
  });

  it.each(['code', 'audit', 'security', 'qa'])('B2 a plan line edited after approval halts install %s with ORCH_APPROVED_DOC_CHANGED', (role) => {
    driveTo(role);
    const recorded = runFile().approvals.plan.sha256;
    plan(edited());
    const r = orch(['install', role]);
    expect(r.status).toBe(1);
    expect(r.err).toBe(`ORCH_APPROVED_DOC_CHANGED: plan ${PLAN} was approved at sha256 ${recorded} and now hashes ${sha(PLAN)}`);
    expect(runFile().halt.code).toBe('ORCH_APPROVED_DOC_CHANGED');
  });

  it('B3 a spec edited after approval halts the next install after define_approved', () => {
    driveTo('code');
    const recorded = runFile().approvals.spec.sha256;
    put(SPEC, '# Demo spec, edited after approval\n');
    const r = orch(['install', 'code']);
    expect(r.status).toBe(1);
    expect(r.err).toBe(`ORCH_APPROVED_DOC_CHANGED: spec ${SPEC} was approved at sha256 ${recorded} and now hashes ${sha(SPEC)}`);
    expect(runFile().halt.code).toBe('ORCH_APPROVED_DOC_CHANGED');
  });

  it('B4 install --check halts the same way and leaves the envelope as it was', () => {
    driveTo('code');
    const before = envelopeText();
    plan(edited());
    const r = orch(['install', 'code', '--check']);
    expect(r.status).toBe(1);
    expect(r.err).toMatch(/^ORCH_APPROVED_DOC_CHANGED: plan /);
    expect(envelopeText()).toBe(before);
  });

  it('B5 an approved plan that can no longer be read halts with ORCH_APPROVED_DOC_CHANGED', () => {
    driveTo('code');
    const recorded = runFile().approvals.plan.sha256;
    rmSync(join(root, PLAN));
    const r = orch(['install', 'code']);
    expect(r.status).toBe(1);
    expect(r.err).toBe(`ORCH_APPROVED_DOC_CHANGED: plan ${PLAN} was approved at sha256 ${recorded} and can no longer be read`);
  });

  it('B6 approvals without a hash halt the first install after define_approved with ORCH_APPROVAL_UNHASHED', () => {
    driveTo('code');
    const run = runFile();
    const old = { at: run.approvals.spec.at, by: run.approvals.spec.by };
    runFileText(JSON.stringify({ ...run, approvals: { spec: old, plan: old } }));
    const r = orch(['install', 'code']);
    expect(r.status).toBe(1);
    expect(r.err).toBe('ORCH_APPROVAL_UNHASHED: run FEAT-011 records an approval without a document hash (started before FEAT-056); run end, then start');
    expect(runFile().halt.code).toBe('ORCH_APPROVAL_UNHASHED');
  });
});

describe('Build and Verify review loop [FEAT-057]', () => {
  const returned = (...findings) => auditReport('VERDICT: RETURN', findings);
  const VALID_RUN = { v: 1, session_id: 's', item: 'FEAT-011', gate: 'boundary_routed', approvals: { spec: null, plan: null }, handbacks: [], tasks: { ids: [], done: 0 } };

  it('start records audit_rounds 2 by default and prints it', () => {
    const r = orch(['start', 'FEAT-011']);
    expect(r.status).toBe(0);
    expect(r.out).toContain('; audit rounds: 2; security: ');
    expect(runFile().audit_rounds).toBe(2);
  });

  it.each([
    [['--audit-rounds', '0'], 0],
    [['--auto', '--audit-rounds', '5'], 5],
    [['--audit-rounds', '3', '--auto'], 3],
  ])('start %j records audit_rounds %i', (flags, n) => {
    const r = orch(['start', 'FEAT-011', ...flags]);
    expect(r.status).toBe(0);
    expect(runFile().audit_rounds).toBe(n);
    expect(r.out).toContain(`; audit rounds: ${n}; security: `);
  });

  it.each([
    [['--audit-rounds']],
    [['--audit-rounds', '6']],
    [['--audit-rounds', '-1']],
    [['--audit-rounds', '02']],
    [['--audit-rounds', 'x']],
    [['--audit-rounds', '1', '--audit-rounds', '1']],
  ])('start FEAT-011 %j refuses with the usage line and writes nothing', (flags) => {
    const r = orch(['start', 'FEAT-011', ...flags]);
    expect(r.status).toBe(2);
    expect(r.err).toBe(START_USAGE);
    expect(existsSync(join(root, RUN_FILE))).toBe(false);
  });

  it('isValidRun accepts a run without audit_rounds and with each value from 0 to 5', () => {
    expect(isValidRun(VALID_RUN)).toBe(true);
    for (let n = 0; n <= 5; n++) expect(isValidRun({ ...VALID_RUN, audit_rounds: n })).toBe(true);
  });

  it.each(['2', 'abc', 6, -1, 1.5, null])('isValidRun rejects audit_rounds %j', (v) => {
    expect(isValidRun({ ...VALID_RUN, audit_rounds: v })).toBe(false);
  });

  it('handback audit on a run file edited to audit_rounds "abc" halts ORCH_RUN_INVALID and grants no fix, and end still clears it', () => {
    driveTo('audit');
    orch(['install', 'audit']);
    runFileText(JSON.stringify({ ...runFile(), audit_rounds: 'abc' }));
    const r = orch(['handback', 'audit'], { input: returned('- [blocker] src/a.js:10 — breaks AC1') });
    expect(r.status).toBe(1);
    expect(r.err).toMatch(/^ORCH_RUN_INVALID: /);
    const run = runFile();
    expect(run.handbacks.some((h) => h.role === 'audit')).toBe(false);
    expect(JSON.stringify(run)).not.toContain('"fix"');
    expect(orch(['end']).status).toBe(0);
    expect(existsSync(join(root, RUN_FILE))).toBe(false);
  });

  const shaOf = (text) => createHash('sha256').update(text).digest('hex');
  const done1 = { ...blank, gate: 'build_executed', approvals: { spec: {}, plan: {} }, tasks: { ids: ['Task 1'], done: 1 } };
  const granted = { role: 'audit', verdict: 'RETURN', round: 1, fix: { round: 1, files: ['src/a.js'], review: '.conductor/handback/audit-1.txt', sha256: 'a'.repeat(64) } };
  const pass = (input) => { orch(['install', 'audit']); return orch(['handback', 'audit'], { input }); };
  const fixPass = () => { orch(['install', 'code']); return orch(['handback', 'code'], { input: say('code', 'build_executed') }); };
  const BLOCKER_A = '- [blocker] src/a.js:10 — breaks AC1';

  it.each([
    ['a fix hand-back dispatches audit', [granted, { role: 'code', fix: 1 }], { role: 'audit' }],
    ['an audit carrying a fix dispatches code for that fix', [granted], { role: 'code', fix: 1 }],
    ['an APPROVE after a fix dispatches qa', [granted, { role: 'code', fix: 1 }, { role: 'audit', verdict: 'APPROVE', round: 2 }], { role: 'qa' }],
    ['an audit entry from before FEAT-060 dispatches qa', [{ role: 'audit' }], { role: 'qa' }],
    ['a qa hand-back after a fix round ends the run', [granted, { role: 'code', fix: 1 }, { role: 'audit', verdict: 'APPROVE', round: 2 }, { role: 'qa' }], { end: true }],
  ])('nextStep: %s', (_name, extra, expected) => {
    expect(nextStep({ ...done1, handbacks: [...hb('spec', 'plan', 'code'), ...extra] })).toEqual(expected);
  });

  it('recordHandback numbers each audit entry by its round', () => {
    const next = recordHandback({ ...done1, handbacks: [granted, { role: 'code', fix: 1 }] }, 'audit', 'build_executed', 'APPROVE');
    expect(next.handbacks.at(-1)).toMatchObject({ role: 'audit', round: 2, verdict: 'APPROVE' });
  });

  it('a fix hand-back records its fix round, no task, and leaves tasks.done', () => {
    const next = recordHandback({ ...done1, handbacks: [granted] }, 'code', 'build_executed');
    expect(next.handbacks.at(-1)).toMatchObject({ role: 'code', gate: 'build_executed', fix: 1 });
    expect(next.handbacks.at(-1)).not.toHaveProperty('task');
    expect(next.tasks.done).toBe(1);
    expect(next.gate).toBe('build_executed');
  });

  it('recordHandback forwards verify_pass after RETURN, a fix and APPROVE', () => {
    const handbacks = [granted, { role: 'code', fix: 1 }, { role: 'audit', verdict: 'APPROVE', round: 2 }];
    expect(recordHandback({ ...done1, handbacks }, 'qa', 'verify_pass').gate).toBe('verify_pass');
  });

  it('recordHandback withholds verify_pass when the last audit entry is not APPROVE', () => {
    const handbacks = [{ role: 'audit', verdict: 'APPROVE', round: 1 }, { role: 'code', fix: 1 }, { role: 'audit', verdict: 'RETURN', round: 2 }];
    expect(() => recordHandback({ ...done1, handbacks }, 'qa', 'verify_pass')).toThrow(expect.objectContaining({ code: 'ORCH_GATE_WITHHELD' }));
  });

  const SELF_PLAN = `# Demo Plan\n\n${task(1, ['src/a.js'])}\n${task(2, ['src/b.js', PLAN, SPEC])}\n## Test List\n`;

  it('[E1] a returned audit dispatches a fix scoped to the blocker and major files plus the plan', () => {
    driveTo('audit');
    const input = returned(BLOCKER_A, '- [major] src/b.js:2 — misses an edge', '- [major] src/a.js:30 — same file again', '- [minor] tests/a.test.js:1 — nit', '- [minor] src/outside.js:1 — nit outside the plan');
    const h = shaOf(input);
    const review = '.conductor/handback/audit-1.txt';
    const r = pass(input);
    expect(r.status).toBe(0);
    expect(r.out).toBe(`audit round 1: RETURN with 3 blocker/major finding(s); fix round 1 of 2: review ${review} sha256 ${h}; scope src/a.js, src/b.js, ${PLAN}`);
    expect(runFile().handbacks.at(-1)).toMatchObject({ role: 'audit', gate: 'build_executed', verdict: 'RETURN', round: 1, fix: { round: 1, files: ['src/a.js', 'src/b.js'], review, sha256: h } });
    for (const role of ['audit', 'qa']) {
      const wrong = orch(['install', role, '--check']);
      expect(wrong.status).toBe(2);
      expect(wrong.err).toContain('the next step is install code');
    }
    const check = orch(['install', 'code', '--check']);
    expect(check.status).toBe(0);
    const [json, note] = check.out.split('\n');
    expect(JSON.parse(json).ops.scope).toEqual(['src/a.js', 'src/b.js', PLAN]);
    expect(JSON.parse(json).ops.gate).toBe('define_approved');
    expect(note).toBe(`fix round 1 of 2: review ${review} sha256 ${h}`);
    const installed = orch(['install', 'code']);
    expect(installed.status).toBe(0);
    expect(installed.out.split('\n')).toEqual([json, note]);
    expect(envelope().ops.scope).toEqual(['src/a.js', 'src/b.js', PLAN]);
    expect(orch(['handback', 'code'], { input: say('code', 'build_executed') }).status).toBe(0);
    expect(runFile().tasks.done).toBe(2);
    expect(runFile().handbacks.at(-1)).toMatchObject({ role: 'code', fix: 1 });
    expect(runFile().handbacks.at(-1)).not.toHaveProperty('task');
    expect(runFile().gate).toBe('build_executed');
    const after = orch(['install', 'code', '--check']);
    expect(after.status).toBe(2);
    expect(after.err).toContain('the next step is install audit');
  });

  it.each([
    ['a file outside the plan', TWO_TASKS, 'src/c.js'],
    ['a different spelling of a plan file', TWO_TASKS, 'src/../src/a.js'],
    ['the approved plan', SELF_PLAN, PLAN],
    ['the approved spec', SELF_PLAN, SPEC],
  ])('[E1] a RETURN naming %s halts ORCH_FIX_SCOPE_UNAPPROVED with the audit entry recorded', (_name, planText, path) => {
    driveTo('audit', { planText });
    const r = pass(returned(BLOCKER_A, `- [major] ${path}:4 — x`));
    expect(r.status).toBe(1);
    expect(r.err).toBe(`ORCH_FIX_SCOPE_UNAPPROVED: ${path} is not a file the approved plan declares; the fix scope stays inside the plan`);
    expect(runFile().handbacks.at(-1)).toMatchObject({ role: 'audit', verdict: 'RETURN', round: 1 });
    expect(runFile().handbacks.at(-1)).not.toHaveProperty('fix');
    expect(runFile().halt.code).toBe('ORCH_FIX_SCOPE_UNAPPROVED');
  });

  it.each(['./src/a.js:10', 'src/a.js:10:5'])('a blocker written as %s enters the fix scope as src/a.js', (ref) => {
    driveTo('audit');
    expect(pass(returned(`- [blocker] ${ref} — x`)).status).toBe(0);
    expect(runFile().handbacks.at(-1).fix.files).toEqual(['src/a.js']);
  });

  it('a fix scope over the scope cap halts ORCH_SCOPE_OVER_CAP with the audit entry recorded', () => {
    const files = (p) => Array.from({ length: 10 }, (_, i) => `src/${p}${i}.js`);
    driveTo('audit', { planText: `# Demo Plan\n\n${task(1, files('f'))}\n${task(2, files('g'))}\n## Test List\n` });
    const r = pass(returned(...[...files('f'), ...files('g')].map((f) => `- [major] ${f}:1 — x`)));
    expect(r.status).toBe(1);
    expect(r.err).toBe('ORCH_SCOPE_OVER_CAP: fix round 1 needs 21 scope entries; the cap is 20');
    expect(runFile().handbacks.at(-1)).toMatchObject({ role: 'audit', verdict: 'RETURN', round: 1 });
    expect(runFile().handbacks.at(-1)).not.toHaveProperty('fix');
  });

  it('an approved plan changed before the fix is derived halts ORCH_APPROVED_DOC_CHANGED with the audit entry recorded', () => {
    driveTo('audit');
    orch(['install', 'audit']);
    plan(TWO_TASKS.replace('thing 1', 'thing one'));
    const r = orch(['handback', 'audit'], { input: returned(BLOCKER_A) });
    expect(r.status).toBe(1);
    expect(r.err).toMatch(/^ORCH_APPROVED_DOC_CHANGED: plan /);
    expect(runFile().handbacks.at(-1)).toMatchObject({ role: 'audit', verdict: 'RETURN', round: 1 });
    expect(runFile().handbacks.at(-1)).not.toHaveProperty('fix');
  });

  it.each(['audit', 'code'])('a second report for the same %s position halts ORCH_HANDBACK_CONFLICT', (role) => {
    driveTo('audit');
    expect(pass(returned(BLOCKER_A)).status).toBe(0);
    if (role === 'code') expect(fixPass().status).toBe(0);
    const r = orch(['handback', role], { input: role === 'audit' ? returned(BLOCKER_A) : say('code', 'build_executed') });
    expect(r.status).toBe(1);
    expect(r.err.startsWith('ORCH_HANDBACK_CONFLICT: ')).toBe(true);
  });

  it.each([
    [[], 3, 2],
    [['--audit-rounds', '0'], 1, 0],
    [['--audit-rounds', '1'], 2, 1],
  ])('[E2] with %j the RETURN at audit round %i halts ORCH_AUDIT_RETURN at the cap of %i', (start, n, cap) => {
    driveTo('audit', { start });
    for (let i = 1; i < n; i++) {
      expect(pass(returned(BLOCKER_A)).status).toBe(0);
      expect(fixPass().status).toBe(0);
    }
    const r = pass(returned(BLOCKER_A));
    expect(r.status).toBe(1);
    expect(r.err).toBe(`ORCH_AUDIT_RETURN: audit returned the change with 1 blocker/major finding(s) at round ${n}; the cap of ${cap} fix round(s) is spent; see .conductor/handback/audit-${n}.txt`);
    const run = runFile();
    expect(run.handbacks.at(-1)).toMatchObject({ role: 'audit', verdict: 'RETURN', round: n });
    expect(run.handbacks.at(-1)).not.toHaveProperty('fix');
    expect(run.handbacks.filter((h) => h.role === 'audit')).toHaveLength(n);
    expect(run.handbacks.filter((h) => h.role === 'code' && 'fix' in h)).toHaveLength(cap);
    expect(run.halt.code).toBe('ORCH_AUDIT_RETURN');
  });

  it('[E2] ESCALATE after a fix round halts ORCH_AUDIT_ESCALATE', () => {
    driveTo('audit');
    expect(pass(returned(BLOCKER_A)).status).toBe(0);
    expect(fixPass().status).toBe(0);
    const r = pass(auditReport('VERDICT: ESCALATE'));
    expect(r.status).toBe(1);
    expect(r.err).toBe('ORCH_AUDIT_ESCALATE: audit escalated a decision only the owner takes; see .conductor/handback/audit-2.txt');
    expect(runFile().handbacks.at(-1)).toMatchObject({ role: 'audit', verdict: 'ESCALATE', round: 2 });
  });

  it('a run file without audit_rounds halts on its first RETURN, as before FEAT-057', () => {
    driveTo('audit');
    const old = runFile();
    delete old.audit_rounds;
    runFileText(JSON.stringify(old));
    const r = pass(returned(BLOCKER_A));
    expect(r.status).toBe(1);
    expect(r.err).toContain('at round 1; the cap of 0 fix round(s) is spent');
  });

  it('[E3] RETURN, a fix and APPROVE: the record lists each round\'s verdict, qa forwards verify_pass and end prints the rounds', () => {
    driveTo('audit', { seat: true });
    expect(pass(returned(BLOCKER_A)).status).toBe(0);
    expect(fixPass().status).toBe(0);
    const approved = pass(say('audit', 'build_executed'));
    expect(approved.status).toBe(0);
    expect(approved.out).toBe('audit handed back build_executed');
    const audits = (run) => run.handbacks.filter((h) => h.role === 'audit').map(({ round, verdict, fix }) => ({ round, verdict, fix: Boolean(fix) }));
    const expected = [{ round: 1, verdict: 'RETURN', fix: true }, { round: 2, verdict: 'APPROVE', fix: false }];
    expect(audits(runFile())).toEqual(expected);
    expect(securityPass().status).toBe(0);
    expect(orch(['install', 'qa']).status).toBe(0);
    expect(orch(['handback', 'qa'], { input: say('qa', 'verify_pass') }).status).toBe(0);
    expect(runFile().gate).toBe('verify_pass');
    expect(audits(JSON.parse(orch(['end']).out))).toEqual(expected);
  });
});

describe('security seat at start [FEAT-034]', () => {
  const scanRel = () => relative(root, join(REPO_ROOT, 'scripts/security-scan.mjs')).split('\\').join('/');
  const lock = (name) => writeFileSync(join(root, name), '');

  it('S1 start records threshold high, the not-covered dependency scan, no base outside git, and the scan command with base none and the threshold', () => {
    expect(orch(['start', 'FEAT-011']).status).toBe(0);
    expect(runFile().security).toEqual({ threshold: 'high', dependency: 'not-covered', base: null, audit_command: null, scan_command: `node ${scanRel()} none high` });
  });

  it.each([
    ['package-lock.json', 'audit', 'npm audit --json'],
    ['pnpm-lock.yaml', 'audit', 'pnpm audit --json'],
    ['yarn.lock', 'not-covered', null],
    ['bun.lockb', 'not-covered', null],
  ])('[D1] %s records dependency %s and audit_command %j', (name, dependency, command) => {
    lock(name);
    expect(orch(['start', 'FEAT-011']).status).toBe(0);
    expect(runFile().security).toMatchObject({ dependency, audit_command: command });
  });

  it('[D1] a non-JS stack records not-covered and says not covered for this stack', () => {
    rmSync(join(root, 'package.json'));
    writeFileSync(join(root, 'go.mod'), 'module x\n');
    const r = orch(['start', 'FEAT-011']);
    expect(r.status).toBe(0);
    expect(r.out).toContain('test command: go test ./...');
    expect(r.out.endsWith('; security: threshold high, dependency scan not covered for this stack')).toBe(true);
    expect(runFile().security.dependency).toBe('not-covered');
  });

  it('[D1] --no-dependency-audit on an npm fixture records disabled with no audit command, and says so', () => {
    lock('package-lock.json');
    const r = orch(['start', 'FEAT-011', '--no-dependency-audit']);
    expect(r.status).toBe(0);
    expect(r.out.endsWith('; security: threshold high, dependency scan disabled (--no-dependency-audit)')).toBe(true);
    expect(runFile().security).toMatchObject({ dependency: 'disabled', audit_command: null });
  });

  it.each(['low', 'moderate', 'high', 'critical'])('start --security-threshold %s records it and prints it', (level) => {
    const r = orch(['start', 'FEAT-011', '--security-threshold', level]);
    expect(r.status).toBe(0);
    expect(runFile().security.threshold).toBe(level);
    expect(runFile().security.scan_command.endsWith(` ${level}`)).toBe(true);
    expect(r.out).toContain(`; security: threshold ${level}, `);
  });

  it.each([
    [['--security-threshold']],
    [['--security-threshold', 'urgent']],
    [['--security-threshold', 'high', '--security-threshold', 'high']],
    [['--no-dependency-audit', '--no-dependency-audit']],
    [['--no-dependency-audit=yes']],
  ])('start FEAT-011 %j refuses with the usage line and writes nothing', (flags) => {
    const r = orch(['start', 'FEAT-011', ...flags]);
    expect(r.status).toBe(2);
    expect(r.err).toBe(START_USAGE);
    expect(existsSync(join(root, RUN_FILE))).toBe(false);
  });

  it('S7 in a git work tree the base is HEAD and the scan command carries it', () => {
    fixtureGit('init', '-q');
    fixtureCommit();
    const base = fixtureGit('rev-parse', 'HEAD').stdout.trim();
    expect(orch(['start', 'FEAT-011']).status).toBe(0);
    expect(runFile().security.base).toBe(base);
    expect(runFile().security.scan_command).toBe(`node ${scanRel()} ${base} high`);
  });

  const VALID = { v: 1, session_id: 's', item: 'FEAT-011', gate: 'boundary_routed', approvals: { spec: null, plan: null }, handbacks: [], tasks: { ids: [], done: 0 } };
  const SEC = { threshold: 'high', dependency: 'audit', base: 'a'.repeat(40), audit_command: 'npm audit --json', scan_command: `node s.mjs ${'a'.repeat(40)} high` };

  it('I1 isValidRun accepts a run without security and a run with a valid security object', () => {
    expect(isValidRun(VALID)).toBe(true);
    expect(isValidRun({ ...VALID, security: SEC })).toBe(true);
  });

  it.each([
    ['a string', 'yes'],
    ['null', null],
    ['an unknown threshold', { ...SEC, threshold: 'urgent' }],
    ['an unknown dependency state', { ...SEC, dependency: 'maybe' }],
    ['dependency audit without a command', { ...SEC, audit_command: null }],
    ['a command with dependency not-covered', { ...SEC, dependency: 'not-covered' }],
    ['a malformed base', { ...SEC, base: 'xyz' }],
    ['an empty scan command', { ...SEC, scan_command: '' }],
    ['a FEAT-034 scan command without the threshold suffix', { ...SEC, scan_command: `node s.mjs ${'a'.repeat(40)}` }],
    ['a suffix that is not the threshold', { ...SEC, scan_command: `node s.mjs ${'a'.repeat(40)} critical` }],
  ])('I2 isValidRun rejects security %s', (_, security) => {
    expect(isValidRun({ ...VALID, security })).toBe(false);
  });

  it('I3 a run file edited to an invalid security object halts ORCH_RUN_INVALID through the CLI', () => {
    driveTo('audit');
    runFileText(JSON.stringify({ ...runFile(), security: { ...SEC, threshold: 'urgent' } }));
    const r = orch(['install', 'audit']);
    expect(r.status).toBe(1);
    expect(r.err).toMatch(/^ORCH_RUN_INVALID: /);
  });

  it.each(SHELL_METACHARACTERS)('U1 checkSecurityCommand halts ORCH_SECURITY_COMMAND_UNSAFE on %j', (m) => {
    expect(() => orchestrateModule.checkSecurityCommand(`node a.mjs ${m} x`)).toThrow(/ORCH_SECURITY_COMMAND_UNSAFE|unsafe/i);
  });
});

describe('security seat [FEAT-034]', () => {
  const lockfile = () => writeFileSync(join(root, 'package-lock.json'), '{}');
  const AWS = 'AKIA' + 'Q'.repeat(16);
  const DEP_HIGH = '- [blocker] package-lock.json:1 — high dependency: left-pad@<1.3.0; prototype pollution';
  const SCANS_RAN = 'SCANS: dependency=ran secrets=ran scripts=ran';
  const SEC = { threshold: 'high', dependency: 'audit', base: null, audit_command: 'npm audit --json', scan_command: 'node s.mjs none high' };
  const base3 = { ...blank, gate: 'build_executed', approvals: { spec: {}, plan: {} }, tasks: { ids: ['Task 1'], done: 1 } };
  const audited = [...hb('spec', 'plan', 'code'), { role: 'audit', verdict: 'APPROVE', round: 1 }];
  const withSec = (...extra) => ({ ...base3, security: SEC, handbacks: [...audited, ...extra] });
  const lastEntry = () => runFile().handbacks.at(-1);
  const aws = (path = 'src/config.js') => `- [blocker] ${path}:1 — critical secret: AWS access key id; value withheld`;
  const writeSecret = () => { mkdirSync(join(root, 'src'), { recursive: true }); writeFileSync(join(root, 'src/config.js'), `const k = '${AWS}';\n`); };

  it.each([
    ['after the last audit a run with a security object dispatches security', withSec().handbacks, SEC, { role: 'security' }],
    ['an unblocked security entry dispatches qa', withSec({ role: 'security', security: { verdict: 'APPROVE', blocked: false } }).handbacks, SEC, { role: 'qa' }],
    ['a qa entry after security ends the run', withSec({ role: 'security', security: { verdict: 'APPROVE', blocked: false } }, { role: 'qa' }).handbacks, SEC, { end: true }],
    ['an ESCALATE entry ends the run', withSec({ role: 'security', security: { verdict: 'ESCALATE', blocked: true } }).handbacks, SEC, { end: true }],
    ['a FEAT-034 entry without a verdict ends the run', withSec({ role: 'security', security: { blocked: false } }).handbacks, SEC, { end: true }],
    ['a granted fix still dispatches code, not security', [...hb('spec', 'plan', 'code'), { role: 'audit', verdict: 'RETURN', round: 1, fix: { round: 1, files: ['src/a.js'], review: 'r', sha256: 'a'.repeat(64) } }], SEC, { role: 'code', fix: 1 }],
  ])('N1 %s', (_, handbacks, security, expected) => {
    expect(nextStep({ ...base3, security, handbacks })).toEqual(expected);
  });

  it.each([
    ['absent', 'no security entry', []],
    ['RETURN', 'a RETURN entry', [{ role: 'security', security: { verdict: 'RETURN', blocked: true } }]],
    ['absent', 'a FEAT-034 entry without a verdict', [{ role: 'security', security: { blocked: false } }]],
  ])('R1 recordHandback refuses qa verify_pass ORCH_GATE_WITHHELD on %s (%s)', (state, _, extra) => {
    expect(() => recordHandback(withSec(...extra), 'qa', 'verify_pass')).toThrow(`ORCH_GATE_WITHHELD: qa may not forward verify_pass: the security verdict is ${state}`);
  });

  it('R2 recordHandback forwards qa verify_pass over an unblocked security entry', () => {
    expect(recordHandback(withSec({ role: 'security', security: { verdict: 'APPROVE', blocked: false } }), 'qa', 'verify_pass').gate).toBe('verify_pass');
  });

  it('R3 [C13] recordHandback on a run without security forwards verify_pass over the audit alone and records not-configured on the qa entry', () => {
    const run = { ...base3, handbacks: audited };
    const next = recordHandback(run, 'qa', 'verify_pass');
    expect(next.gate).toBe('verify_pass');
    expect(next.handbacks.at(-1).security).toBe('not-configured (run predates FEAT-034)');
  });

  const findings = [DEP_HIGH, '- [minor] a.js:3 — low secret: generic secret assignment; value withheld'];
  const withScans = (scans, lines = [], verdict = 'VERDICT: RETURN') => ['Done.', ...lines, scans, verdict, handbackLine('security', 'build_executed', { v: 4 }), ''].join('\n');

  it('P1 parseSecurityReport returns the findings and the scans', () => {
    const got = orchestrateModule.parseSecurityReport(withScans(SCANS_RAN, findings), SEC);
    expect(got.scans).toEqual({ dependency: 'ran', secrets: 'ran', scripts: 'ran' });
    expect(got.verdict).toBe('RETURN');
    expect(got.findings).toEqual([
      { part: 'public', n: 2, line: findings[0], severity: 'blocker', location: 'package-lock.json:1', level: 'high', source: 'dependency' },
      { part: 'public', n: 3, line: findings[1], severity: 'minor', location: 'a.js:3', level: 'low', source: 'secret' },
    ]);
  });

  const NOT_COVERED = 'SCANS: dependency=not-covered secrets=ran scripts=ran';
  it.each([
    ['with no SCANS line', 'ORCH_SECURITY_REPORT_MISSING', ['Done.', 'VERDICT: APPROVE', handbackLine('security', 'build_executed', { v: 4 })].join('\n'), SEC],
    ['with two SCANS lines', 'ORCH_SECURITY_REPORT_INVALID', ['Done.', SCANS_RAN, SCANS_RAN, 'VERDICT: APPROVE', handbackLine('security', 'build_executed', { v: 4 })].join('\n'), SEC],
    ['with a lowercase scans line', 'ORCH_SECURITY_REPORT_INVALID', withScans(SCANS_RAN.replace('SCANS', 'scans'), [], 'VERDICT: APPROVE'), SEC],
    ['with prose between the SCANS and VERDICT lines', 'ORCH_SECURITY_REPORT_INVALID', ['Done.', SCANS_RAN, 'trailing text', 'VERDICT: APPROVE', handbackLine('security', 'build_executed', { v: 4 })].join('\n'), SEC],
    ['with an unknown severity', 'ORCH_SECURITY_REPORT_INVALID', withScans(SCANS_RAN, ['- [urgent] a.js:1 — low secret: x'], 'VERDICT: APPROVE'), SEC],
    ['with an unknown source', 'ORCH_SECURITY_REPORT_INVALID', withScans(SCANS_RAN, ['- [minor] a:1 — low license: x'], 'VERDICT: APPROVE'), SEC],
    ['when the run is audit and the report says not-covered', 'ORCH_SECURITY_REPORT_INVALID', withScans(NOT_COVERED, [], 'VERDICT: APPROVE'), SEC],
    ['when the run is not-covered and the report says ran', 'ORCH_SECURITY_REPORT_INVALID', withScans(SCANS_RAN, [], 'VERDICT: APPROVE'), { ...SEC, dependency: 'not-covered', audit_command: null }],
    ['when the run is disabled and the report says not-covered', 'ORCH_SECURITY_REPORT_INVALID', withScans(NOT_COVERED, [], 'VERDICT: APPROVE'), { ...SEC, dependency: 'disabled', audit_command: null }],
    ['with a dependency finding under dependency=not-covered', 'ORCH_SECURITY_REPORT_INVALID', withScans(NOT_COVERED, [DEP_HIGH]), { ...SEC, dependency: 'not-covered', audit_command: null }],
  ])('P2 parseSecurityReport halts %s: %s', (_, code, text, security) => {
    expect(() => orchestrateModule.parseSecurityReport(text, security)).toThrow(new RegExp(`^${code}: `));
  });

  it('E2a [E2] a finding at the threshold halts ORCH_SECURITY_BLOCKED quoting it; the entry records blocked and nothing routes to qa', () => {
    lockfile();
    driveTo('security');
    const r = securityPass(securityReport([DEP_HIGH], SCANS_RAN, 'VERDICT: RETURN'));
    expect(r.status).toBe(1);
    expect(r.err).toBe(`ORCH_SECURITY_BLOCKED: security found 1 finding(s) at or above high; first: ${DEP_HIGH}`);
    expect(lastEntry().security).toEqual({ scans: { dependency: 'ran', secrets: 'ran', scripts: 'ran' }, counts: { critical: 0, high: 1, moderate: 0, low: 0 }, threshold: 'high', verdict: 'RETURN', blocked: true });
    expect(nextStep(runFile())).toEqual({ end: true });
    expect(orch(['install', 'qa', '--check']).status).toBe(2);
    expect(() => recordHandback(runFile(), 'qa', 'verify_pass')).toThrow('ORCH_GATE_WITHHELD');
  });

  it('E2b [E2] findings below the threshold are counted, blocked is false, qa forwards verify_pass, and end prints the entry', () => {
    lockfile();
    driveTo('security');
    const r = securityPass(securityReport(['- [minor] package-lock.json:1 — moderate dependency: a@<2; x', '- [minor] package-lock.json:1 — low dependency: b@<3; y'], SCANS_RAN));
    expect(r.status).toBe(0);
    expect(r.out).toBe('security handed back build_executed; VERDICT: APPROVE; 2 finding(s) below high recorded; dependency=ran; pre-existing findings, if any, are in .conductor/security-pre-existing.txt (owner only)');
    expect(Object.keys(lastEntry())).toEqual(['role', 'gate', 'at', 'security']);
    expect(lastEntry().security).toMatchObject({ counts: { critical: 0, high: 0, moderate: 1, low: 1 }, verdict: 'APPROVE', blocked: false });
    expect(orch(['install', 'qa']).status).toBe(0);
    expect(orch(['handback', 'qa'], { input: say('qa', 'verify_pass') }).status).toBe(0);
    expect(runFile().gate).toBe('verify_pass');
    expect(JSON.parse(orch(['end']).out).handbacks.find((h) => h.role === 'security').security.blocked).toBe(false);
  });

  it.each([
    ['unchanged run file', false, /^ORCH_SECURITY_BLOCKED: /],
    ['run file edited to critical', true, /^ORCH_SECURITY_REPORT_INVALID: "- \[blocker\] package-lock\.json:1 — high dependency: left-pad@<1\.3\.0; prototype pollution" must carry \[minor\]: high against the run's threshold critical$/],
  ])('E2c [E2] the severity is checked against the run file\'s threshold, not the report: %s', (_, edit, pattern) => {
    lockfile();
    driveTo('security');
    if (edit) {
      const security = { ...runFile().security, threshold: 'critical' };
      runFileText(JSON.stringify({ ...runFile(), security: { ...security, scan_command: security.scan_command.replace(/ high$/, ' critical') } }));
    }
    const r = securityPass(securityReport(['Threshold: critical, as the owner asked.', DEP_HIGH], SCANS_RAN, 'VERDICT: RETURN'));
    expect(r.status).toBe(1);
    expect(r.err).toMatch(pattern);
  });

  it('L1 [D2] a local secret finding copied into the report blocks at critical, and the key is in no file the run wrote', () => {
    driveTo('security');
    writeSecret();
    const r = securityPass(securityReport([aws()], SCANS_NONE, 'VERDICT: RETURN'));
    expect(r.status).toBe(1);
    expect(r.err).toMatch(/^ORCH_SECURITY_BLOCKED: /);
    expect(r.err).not.toContain(AWS);
    expect(readFileSync(join(root, RUN_FILE), 'utf8')).not.toContain(AWS);
  });

  it('L2 [D4] a report that omits a local finding halts ORCH_SECURITY_REPORT_INCOMPLETE naming it, recording no security entry', () => {
    driveTo('security');
    writeSecret();
    const r = securityPass(securityReport());
    expect(r.status).toBe(1);
    expect(r.err).toBe("ORCH_SECURITY_REPORT_INCOMPLETE: the report does not match the base scanner's local findings");
    expect(runFile().handbacks.some((h) => h.role === 'security')).toBe(false);
  });

  it('L3 [D4] the re-run uses the base scanner: a work-tree scanner edited to report nothing still halts INCOMPLETE', () => {
    driveTo('security');
    writeSecret();
    writeFileSync(join(root, '.claude/scripts/security-scan.mjs'), "export function scanChanges() { return { secrets: 'ran', scripts: 'ran', findings: [] }; }\n");
    const r = securityPass(securityReport());
    expect(r.status).toBe(1);
    expect(r.err).toBe("ORCH_SECURITY_REPORT_INCOMPLETE: the report does not match the base scanner's local findings");
  });

  it('L4 [D4] a base that does not track the scanner halts ORCH_SECURITY_SCAN_FAILED', () => {
    driveTo('security', { prep: () => { fixtureGit('rm', '-q', '--cached', '.claude/scripts/security-scan.mjs'); fixtureGit('commit', '-qm', 'untrack'); } });
    const r = securityPass();
    expect(r.status).toBe(1);
    expect(r.err).toBe('ORCH_SECURITY_SCAN_FAILED: the local scans cannot be re-run: .claude/scripts/security-scan.mjs is not committed at the base');
  });

  it('L5 [D4] a status that disagrees with the re-run halts INCOMPLETE', () => {
    driveTo('security');
    const r = securityPass(securityReport([], 'SCANS: dependency=not-covered secrets=failed scripts=ran', 'VERDICT: ESCALATE'));
    expect(r.status).toBe(1);
    expect(r.err).toBe('ORCH_SECURITY_REPORT_INCOMPLETE: the report says secrets=failed; the local re-run says ran');
  });

  it('F1 [C12] a failed dependency scan halts ORCH_SECURITY_SCAN_FAILED after recording a blocked entry', () => {
    lockfile();
    driveTo('security');
    const r = securityPass(securityReport([], 'SCANS: dependency=failed secrets=ran scripts=ran', 'VERDICT: ESCALATE'));
    expect(r.status).toBe(1);
    expect(r.err).toBe('ORCH_SECURITY_SCAN_FAILED: the dependency scan did not complete; scans clean is the Verify exit, see .conductor/handback/security.txt');
    expect(lastEntry().security.blocked).toBe(true);
    expect(lastEntry().security.verdict).toBe('ESCALATE');
  });

  it('F2 [C12] a run with no base commit halts ORCH_SECURITY_SCAN_FAILED at the re-run', () => {
    driveTo('security', { seat: false });
    const r = securityPass();
    expect(r.status).toBe(1);
    expect(r.err).toBe('ORCH_SECURITY_SCAN_FAILED: the local scans cannot be re-run: the run recorded no base commit');
  });

  it.each([['not-covered', false], ['disabled', true]])('Q1 [Q2] a %s run prints dependency=%s on the handback line and records it', (state, disabled) => {
    if (disabled) lockfile();
    driveTo('security', { start: disabled ? ['--no-dependency-audit'] : [] });
    const r = securityPass(securityReport([], `SCANS: dependency=${state} secrets=ran scripts=ran`));
    expect(r.status).toBe(0);
    expect(r.out).toBe(`security handed back build_executed; VERDICT: APPROVE; 0 finding(s) below high recorded; dependency=${state}; pre-existing findings, if any, are in .conductor/security-pre-existing.txt (owner only)`);
    expect(lastEntry().security.scans.dependency).toBe(state);
  });

  it('C1 [C13] a run file without security skips the seat: qa forwards verify_pass, records not-configured and prints it', () => {
    driveTo('audit');
    const { security: _, ...without } = runFile();
    runFileText(JSON.stringify(without));
    orch(['install', 'audit']);
    expect(orch(['handback', 'audit'], { input: say('audit', 'build_executed') }).status).toBe(0);
    expect(orch(['install', 'qa']).status).toBe(0);
    const r = orch(['handback', 'qa'], { input: say('qa', 'verify_pass') });
    expect(r.out).toBe('qa handed back verify_pass; security=not-configured (run predates FEAT-034)');
    expect(lastEntry().security).toBe('not-configured (run predates FEAT-034)');
  });

  it('V1 [C14] install security installs a v4 envelope: ph rev, tk X, gate build_executed, no scope', () => {
    driveTo('security');
    expect(orch(['install', 'security']).status).toBe(0);
    expect(envelope()).toMatchObject({ v: 4, sys: { ph: 'rev', role: 'security', tk: 'X' }, ops: { gate: 'build_executed' } });
    expect(envelope().ops.scope).toBeUndefined();
  });

  it('V2 a v3 hand-back naming security halts ORCH_HANDBACK_INVALID', () => {
    driveTo('security');
    orch(['install', 'security']);
    const text = ['Done.', SCANS_NONE, handbackLine('security', 'build_executed'), ''].join('\n');
    const r = orch(['handback', 'security'], { input: text });
    expect(r.status).toBe(1);
    expect(r.err).toMatch(/^ORCH_HANDBACK_INVALID: /);
  });

  it('V3 install security halts ORCH_AGENT_MISSING without a security agent definition', () => {
    driveTo('security');
    rmSync(join(root, '.claude/agents/security.md'));
    const r = orch(['install', 'security']);
    expect(r.status).toBe(1);
    expect(r.err).toMatch(/^ORCH_AGENT_MISSING: /);
  });
});

describe('security verdict contract [FEAT-059]', () => {
  const SEC = { threshold: 'high', dependency: 'not-covered', base: null, audit_command: null, scan_command: 'node s.mjs none high' };
  const at = (n) => `.conductor/handback/security.txt:${n}`;
  const lastEntry = () => runFile().handbacks.at(-1);
  const AWS = 'AKIA' + 'Q'.repeat(16);
  const aws = (path = 'src/config.js') => `- [blocker] ${path}:1 — critical secret: AWS access key id; value withheld`;
  const oldKey = () => { mkdirSync(join(root, 'old'), { recursive: true }); writeFileSync(join(root, 'old/config.js'), `const k = '${AWS}';\n`); };
  const SEC_HB = handbackLine('security', 'build_executed', { v: 4, sys: { ph: 'rev' } });
  const OPEN = 'PRE-EXISTING (owner only):';
  const CLOSE = 'END PRE-EXISTING';
  const MOD = '- [blocker] a.js:1 — moderate secret: generic secret assignment; value withheld';
  const FORM = '- [<blocker|minor>] <path>:<line> — <critical|high|moderate|low> <dependency|secret|script>: <text>';
  const rawReport = (...lines) => ['Done.', ...lines, SEC_HB, ''].join('\n');
  const verdictCase = (role, verdictLines, findings, trailing) => ['Done.', ...findings, ...(role === 'security' ? [SCANS_NONE] : []), ...verdictLines,
    handbackLine(role, 'build_executed', role === 'security' ? { v: 4, sys: { ph: 'rev' } } : {}), ...trailing, ''].join('\n');

  it.each([
    ['with no verdict line', [], [], [], 'ORCH_VERDICT_MISSING'],
    ['with two verdict lines', ['VERDICT: APPROVE', 'VERDICT: APPROVE'], [], [], 'ORCH_VERDICT_INVALID'],
    ['with a lowercase verdict', ['Verdict: approve'], [], [], 'ORCH_VERDICT_INVALID'],
    ['with an unknown verdict word', ['VERDICT: APPROVED'], [], [], 'ORCH_VERDICT_INVALID'],
    ['with the verdict after the hand-back', [], [], ['VERDICT: APPROVE'], 'ORCH_VERDICT_INVALID'],
    ['with APPROVE over a blocker', ['VERDICT: APPROVE'], [aws('src/a.js')], [], 'ORCH_VERDICT_INCONSISTENT'],
    ['with RETURN and no blocker', ['VERDICT: RETURN'], [], [], 'ORCH_VERDICT_INCONSISTENT'],
  ])('V1 [V1] the shared parser halts %s with the same code for audit and security', (_, verdictLines, findings, trailing, code) => {
    driveTo('audit', { seat: true });
    expect(orch(['install', 'audit']).status).toBe(0);
    const audit = orch(['handback', 'audit'], { input: verdictCase('audit', verdictLines, findings, trailing) });
    rmSync(root, { recursive: true, force: true });
    root = realpathSync(mkdtempSync(join(tmpdir(), 'cc-orch-root-')));
    mkdirSync(join(root, '.claude', 'memory'), { recursive: true });
    writeFileSync(join(root, 'package.json'), PKG);
    script = SCRIPT;
    driveTo('security');
    const security = securityPass(verdictCase('security', verdictLines, findings, trailing));
    expect(audit.status).toBe(1);
    expect(security.status).toBe(1);
    expect(audit.err.startsWith(code)).toBe(true);
    expect(security.err.startsWith(code)).toBe(true);
    expect(security.err).toBe(audit.err.replace('the audit report', 'the security report'));
  });

  it('V1 [V1] parseSecurityReport calls the exported parseVerdict and orchestrate.mjs holds one verdict regex', () => {
    const src = readFileSync(SCRIPT, 'utf8');
    const from = src.indexOf('export function parseSecurityReport(');
    const body = src.slice(from, src.indexOf('\n}\n', from));
    expect(body).toContain('parseVerdict(');
    expect(body).not.toContain('VERDICT');
    expect(src.match(/\/\^VERDICT: /g)).toHaveLength(1);
  });

  it('parseSecurityReport returns the verdict, the scans and each finding with its part and its line number', () => {
    const got = orchestrateModule.parseSecurityReport(securityReport([aws('src/b.js')], SCANS_NONE, 'VERDICT: RETURN', [aws('src/a.js')]), SEC);
    expect(got.verdict).toBe('RETURN');
    expect(got.scans).toEqual({ dependency: 'not-covered', secrets: 'ran', scripts: 'ran' });
    expect(got.findings).toEqual([
      { part: 'public', n: 5, line: aws('src/b.js'), severity: 'blocker', location: 'src/b.js:1', level: 'critical', source: 'secret' },
      { part: 'owner', n: 3, line: aws('src/a.js'), severity: 'blocker', location: 'src/a.js:1', level: 'critical', source: 'secret' },
    ]);
  });

  it.each([
    ['a blocker for a below-threshold level', securityReport([MOD], SCANS_NONE, 'VERDICT: RETURN'), `ORCH_SECURITY_REPORT_INVALID: ${JSON.stringify(MOD)} must carry [minor]: moderate against the run's threshold high`],
    ['a minor for a critical level', securityReport(['- [minor] a.js:1 — critical secret: AWS access key id; value withheld']),
      `ORCH_SECURITY_REPORT_INVALID: ${JSON.stringify('- [minor] a.js:1 — critical secret: AWS access key id; value withheld')} must carry [blocker]: critical against the run's threshold high`],
    ['a major, which security never writes', securityReport(['- [major] a.js:1 — high secret: x'], SCANS_NONE, 'VERDICT: RETURN'),
      `ORCH_SECURITY_REPORT_INVALID: ${JSON.stringify('- [major] a.js:1 — high secret: x')} must carry [blocker]: high against the run's threshold high`],
    ['a finding without path:line', securityReport(['- [minor] the whole design — low secret: x']),
      `ORCH_SECURITY_REPORT_INVALID: ${JSON.stringify('- [minor] the whole design — low secret: x')} is not a security finding line: ${FORM}`],
    ['a failed scan with APPROVE', securityReport([], 'SCANS: dependency=not-covered secrets=failed scripts=ran'),
      'ORCH_VERDICT_INCONSISTENT: VERDICT: APPROVE with the secrets scan failed; a failed scan requires VERDICT: ESCALATE'],
    ['a blocker finding placed after SNAP_HANDBACK under APPROVE', ['Done.', SCANS_NONE, 'VERDICT: APPROVE', SEC_HB, aws(), ''].join('\n'),
      `ORCH_SECURITY_REPORT_INVALID: the finding line at ${at(5)} comes after SNAP_HANDBACK`],
    ['APPROVE with a public blocker finding', rawReport(aws(), SCANS_NONE, 'VERDICT: APPROVE'), 'ORCH_VERDICT_INCONSISTENT: VERDICT: APPROVE with 1 blocker/major finding(s)'],
    ['a near-miss owner marker', rawReport('Pre-existing:', aws(), CLOSE, SCANS_NONE, 'VERDICT: APPROVE'), `ORCH_SECURITY_REPORT_INVALID: the owner-only marker at ${at(2)} is malformed`],
    ['an unclosed block', rawReport(OPEN, aws(), SCANS_NONE, 'VERDICT: APPROVE'), `ORCH_SECURITY_REPORT_INVALID: the owner-only block at ${at(2)} is repeated, unclosed or misplaced`],
    ['a repeated block', rawReport(OPEN, aws(), CLOSE, OPEN, aws(), CLOSE, SCANS_NONE, 'VERDICT: APPROVE'), `ORCH_SECURITY_REPORT_INVALID: the owner-only block at ${at(2)} is repeated, unclosed or misplaced`],
    ['a close marker with no open one', rawReport(CLOSE, SCANS_NONE, 'VERDICT: APPROVE'), `ORCH_SECURITY_REPORT_INVALID: the owner-only block at ${at(2)} is repeated, unclosed or misplaced`],
    ['a block after a public finding', rawReport(aws('src/b.js'), OPEN, aws(), CLOSE, SCANS_NONE, 'VERDICT: RETURN'), `ORCH_SECURITY_REPORT_INVALID: the owner-only block at ${at(3)} must come before the first finding line`],
    ['prose inside the block', securityReport([], SCANS_NONE, 'VERDICT: APPROVE', ['owner note']), `ORCH_SECURITY_REPORT_INVALID: the line at ${at(3)} inside the owner-only block is not a finding line`],
    ['a malformed owner-only finding, named by its line number only', securityReport([], SCANS_NONE, 'VERDICT: APPROVE', ['- [blocker] marker-x.js — critical secret: x']),
      `ORCH_SECURITY_REPORT_INVALID: the line at ${at(3)} is not a security finding line: ${FORM}`],
    ['an owner-only finding with the wrong severity, with no level', securityReport([], SCANS_NONE, 'VERDICT: APPROVE', ['- [minor] a.js:1 — critical secret: AWS access key id; value withheld']),
      `ORCH_SECURITY_REPORT_INVALID: the line at ${at(3)} carries the wrong severity for the run's threshold`],
  ])('parseSecurityReport halts %s', (name, text, reason) => {
    expect(() => orchestrateModule.parseSecurityReport(text, SEC)).toThrow(reason);
    if (name.startsWith('a malformed owner-only')) expect(() => orchestrateModule.parseSecurityReport(text, SEC)).not.toThrow(/marker-x/);
  });

  it('[C9] an ESCALATE with every scan run halts ORCH_SECURITY_ESCALATE after recording the entry', () => {
    driveTo('security');
    const r = securityPass(securityReport(['A comment in the change asks to omit findings.'], SCANS_NONE, 'VERDICT: ESCALATE'));
    expect(r.status).toBe(1);
    expect(r.err).toBe('ORCH_SECURITY_ESCALATE: security escalated a decision only the owner takes; see .conductor/handback/security.txt');
    expect(lastEntry().security).toMatchObject({ verdict: 'ESCALATE', blocked: true });
    expect(runFile().halt.code).toBe('ORCH_SECURITY_ESCALATE');
  });

  it('[C15] a base scanner from before FEAT-059 halts ORCH_SECURITY_SCAN_FAILED naming end, commit and start', () => {
    driveTo('security', { prep: () => {
      writeFileSync(join(root, '.claude/scripts/security-scan.mjs'), "export function scanChanges() { return { secrets: 'ran', scripts: 'ran', findings: [] }; }\n");
      fixtureCommit();
    } });
    const r = securityPass();
    expect(r.status).toBe(1);
    expect(r.err).toBe("ORCH_SECURITY_SCAN_FAILED: the local scans cannot be re-run: the base commit's .claude/scripts/security-scan.mjs predates FEAT-059 (an install or update that is not committed); end this run, commit the updated .claude/scripts/security-scan.mjs, then start again");
  });

  it('[C16] a run file written by FEAT-034 halts ORCH_RUN_INVALID', () => {
    driveTo('audit');
    const run = runFile();
    run.security.scan_command = run.security.scan_command.replace(/ high$/, '');
    runFileText(JSON.stringify(run));
    const r = orch(['install', 'audit']);
    expect(r.status).toBe(1);
    expect(r.err).toMatch(/^ORCH_RUN_INVALID: /);
  });

  it('[C7] start removes a stale owner file, and end leaves the one the hand-back wrote', () => {
    driveTo('qa');
    expect(readFileSync(join(root, OWNER_FILE), 'utf8')).toBe('none\n');
    writeFileSync(join(root, OWNER_FILE), 'stale\n');
    orch(['end']);
    expect(readFileSync(join(root, OWNER_FILE), 'utf8')).toBe('stale\n');
    expect(orch(['start', 'FEAT-011']).status).toBe(0);
    expect(existsSync(join(root, OWNER_FILE))).toBe(false);
  });

  it.each([['with an owner-only block', true], ['without one', false]])('[C7] the hand-back writes the owner file %s', (_, moved) => {
    oldKey();
    driveTo('security');
    if (moved) {
      mkdirSync(join(root, 'src'), { recursive: true });
      renameSync(join(root, 'old/config.js'), join(root, 'src/config.js'));
    }
    const r = securityPass(securityReport([], SCANS_NONE, 'VERDICT: APPROVE', moved ? [aws()] : null));
    expect(r.status).toBe(0);
    expect(readFileSync(join(root, OWNER_FILE), 'utf8')).toBe(moved ? `${aws()}\n` : 'none\n');
  });
});

describe('pre-existing findings never reach the public part [FEAT-059]', () => {
  const AWS = 'AKIA' + 'Q'.repeat(16);
  const aws = (path = 'src/config.js') => `- [blocker] ${path}:1 — critical secret: AWS access key id; value withheld`;
  const oldKey = () => { mkdirSync(join(root, 'old'), { recursive: true }); writeFileSync(join(root, 'old/config.js'), `const k = '${AWS}';\n`); };
  const writeSecret = () => { mkdirSync(join(root, 'src'), { recursive: true }); writeFileSync(join(root, 'src/config.js'), `const k = '${AWS}';\n`); };
  const moveKey = () => { mkdirSync(join(root, 'src'), { recursive: true }); renameSync(join(root, 'old/config.js'), join(root, 'src/config.js')); };
  const MARK = 'zz-marker-pkg';
  const SCANS_DEP = 'SCANS: dependency=ran secrets=ran scripts=ran';
  const npmLock = (version) => JSON.stringify({ name: 'x', lockfileVersion: 3, packages: { '': { name: 'x' }, ...(version === null ? {} : { [`node_modules/${MARK}`]: { version } }) } }, null, 2) + '\n';
  const writeLock = (version) => writeFileSync(join(root, 'package-lock.json'), npmLock(version));
  const lockLine = () => readFileSync(join(root, 'package-lock.json'), 'utf8').split('\n').findIndex((l) => l.includes(`"node_modules/${MARK}": {`)) + 1;
  const depLine = () => `- [blocker] package-lock.json:${lockLine()} — critical dependency: ${MARK}@<2.0.0; marker advisory`;

  // A fresh fixture per run: the P1 tests compare two runs that differ only in what the base held.
  function run({ base = () => {}, change = () => {}, report }) {
    rmSync(root, { recursive: true, force: true });
    root = realpathSync(mkdtempSync(join(tmpdir(), 'cc-orch-root-')));
    mkdirSync(join(root, '.claude', 'memory'), { recursive: true });
    writeFileSync(join(root, 'package.json'), PKG);
    script = SCRIPT;
    base();
    driveTo('security');
    change();
    const marker = existsSync(join(root, 'package-lock.json')) && lockLine() > 0 ? `package-lock.json:${lockLine()}` : null;
    const r = securityPass(report());
    return {
      status: r.status, out: r.out, err: r.err, marker,
      runText: readFileSync(join(root, RUN_FILE), 'utf8'),
      owner: existsSync(join(root, OWNER_FILE)) ? readFileSync(join(root, OWNER_FILE), 'utf8') : null,
      end: orch(['end']).out,
    };
  }
  const fixtures = {
    dependency: {
      scans: SCANS_DEP,
      without: { base: () => writeLock(null) },
      withIt: { base: () => writeLock('1.0.0') },
      line: depLine,
      markers: (r) => [MARK, 'marker advisory', r.marker],
    },
    secret: {
      scans: SCANS_NONE,
      without: {},
      withIt: { base: oldKey, change: moveKey },
      line: () => aws(),
      markers: () => ['AWS', 'src/config.js:1'],
    },
  };

  it.each(['dependency', 'secret'])('[P1] a pre-existing %s finding changes no public byte', (kind) => {
    const fx = fixtures[kind];
    const without = run({ ...fx.without, report: () => securityReport([], fx.scans) });
    let line;
    const withIt = run({
      ...fx.withIt,
      report: () => { line = fx.line(); return securityReport([], fx.scans, 'VERDICT: APPROVE', [line]); },
    });
    expect(without.status).toBe(0);
    expect(withIt.status).toBe(0);
    expect(withIt.out).toBe(without.out);
    expect(withIt.err).toBe(without.err);
    expect(norm(withIt.runText)).toBe(norm(without.runText));
    expect(norm(withIt.end)).toBe(norm(without.end));
    for (const marker of fx.markers(withIt).filter(Boolean)) {
      for (const text of [withIt.out, withIt.err, withIt.runText, withIt.end]) expect(text).not.toContain(marker);
    }
    expect(withIt.owner).toBe(`${line}\n`);
    expect(without.owner).toBe('none\n');
  });

  const wrongPart = {
    dependency: {
      scans: SCANS_DEP,
      a: { base: () => writeLock('1.0.0') },
      b: { base: () => writeLock('1.0.0'), change: () => writeLock('1.0.1') },
      line: depLine,
      reason: 'ORCH_SECURITY_REPORT_INVALID: the dependency finding at .conductor/handback/security.txt:<n> is filed in the wrong part',
    },
    secret: {
      scans: SCANS_NONE,
      a: { base: oldKey, change: moveKey },
      b: { change: writeSecret },
      line: () => aws(),
      reason: 'ORCH_SECURITY_REPORT_INCOMPLETE: the local finding at .conductor/handback/security.txt:<n> is filed in the wrong part',
    },
  };

  it.each(['dependency', 'secret'])('[P1] a %s finding filed in the wrong part halts with the same reason in both directions', (kind) => {
    const fx = wrongPart[kind];
    const a = run({ ...fx.a, report: () => securityReport([fx.line()], fx.scans, 'VERDICT: RETURN') });
    const b = run({ ...fx.b, report: () => securityReport([], fx.scans, 'VERDICT: APPROVE', [fx.line()]) });
    const same = (e) => e.replace(/security\.txt:\d+/, 'security.txt:<n>');
    expect(a.status).toBe(1);
    expect(b.status).toBe(1);
    expect(same(a.err)).toBe(same(b.err));
    expect(same(a.err)).toBe(fx.reason);
    for (const text of [a.err, b.err, a.runText, b.runText]) {
      for (const marker of [MARK, 'marker advisory', 'AWS', 'src/config.js:1']) expect(text).not.toContain(marker);
    }
  });

  it('[P1] a pre-existing secret copied into the public part as well halts without quoting it', () => {
    const r = run({ base: oldKey, change: moveKey, report: () => securityReport([aws()], SCANS_NONE, 'VERDICT: RETURN', [aws()]) });
    expect(r.status).toBe(1);
    expect(r.err).toMatch(/^ORCH_SECURITY_REPORT_INCOMPLETE: the local finding at \.conductor\/handback\/security\.txt:\d+ is filed in the wrong part$/);
    for (const text of [r.err, r.runText]) {
      for (const marker of ['AWS', 'src/config.js:1']) expect(text).not.toContain(marker);
    }
  });

  describe('a new private key under a PEM header the base already holds', () => {
    const HEADER = '-----BEGIN ' + 'RSA ' + 'PRIVATE KEY-----';
    const KEY_LINE = '- [blocker] keys/new.pem:1 — critical secret: private key block; value withheld';
    const pemAtBase = () => { mkdirSync(join(root, 'docs'), { recursive: true }); writeFileSync(join(root, 'docs/example.pem'), `${HEADER}\nexample\n`); };
    const newKey = () => { mkdirSync(join(root, 'keys'), { recursive: true }); writeFileSync(join(root, 'keys/new.pem'), `${HEADER}\n${'M'.repeat(64)}\n`); };

    it('[P1] filed as pre-existing with APPROVE, it halts instead of approving', () => {
      const r = run({ base: pemAtBase, change: newKey, report: () => securityReport([], SCANS_NONE, 'VERDICT: APPROVE', [KEY_LINE]) });
      expect(r.status).toBe(1);
      expect(r.err).toMatch(/^ORCH_SECURITY_REPORT_INCOMPLETE: the local finding at \.conductor\/handback\/security\.txt:\d+ is filed in the wrong part$/);
    });

    it('[E2] filed as introduced, it halts ORCH_SECURITY_BLOCKED', () => {
      const r = run({ base: pemAtBase, change: newKey, report: () => securityReport([KEY_LINE], SCANS_NONE, 'VERDICT: RETURN') });
      expect(r.status).toBe(1);
      expect(r.err).toBe(`ORCH_SECURITY_BLOCKED: security found 1 finding(s) at or above high; first: ${KEY_LINE}`);
    });
  });

  it('[E2] a line holding a value the base tracks and a new key of another pattern is introduced: it halts ORCH_SECURITY_BLOCKED', () => {
    const gh = 'gh' + 'p_' + 'b'.repeat(36);
    const mixed = () => { mkdirSync(join(root, 'src'), { recursive: true }); writeFileSync(join(root, 'src/config.js'), `const k = '${AWS}', t = '${gh}';\n`); };
    const r = run({ base: oldKey, change: mixed, report: () => securityReport([aws()], SCANS_NONE, 'VERDICT: RETURN') });
    expect(r.status).toBe(1);
    expect(r.err).toBe(`ORCH_SECURITY_BLOCKED: security found 1 finding(s) at or above high; first: ${aws()}`);
  });

  it('[P1] a report that omits a pre-existing local line and one that omits an introduced one halt with the same reason', () => {
    const a = run({ base: oldKey, change: moveKey, report: () => securityReport() });
    const b = run({ change: writeSecret, report: () => securityReport() });
    const reason = "ORCH_SECURITY_REPORT_INCOMPLETE: the report does not match the base scanner's local findings";
    expect(a.status).toBe(1);
    expect(b.status).toBe(1);
    expect(a.err).toBe(reason);
    expect(b.err).toBe(reason);
  });

  it.each([
    ['outside the run\'s lockfile', '- [minor] yarn.lock:1 — low dependency: a@<1; x'],
    ['on a line the lockfile lacks', '- [minor] package-lock.json:999 — low dependency: a@<1; x'],
  ])('[S3] a dependency finding %s halts with its line number only', (_, line) => {
    writeFileSync(join(root, 'package-lock.json'), '{}');
    driveTo('security');
    const r = securityPass(securityReport([line], SCANS_DEP));
    expect(r.status).toBe(1);
    expect(r.err).toBe("ORCH_SECURITY_REPORT_INVALID: the dependency finding at .conductor/handback/security.txt:2 does not name a line of the run's lockfile");
  });
});

describe('envelope verb outside a run [FEAT-061]', () => {
  const ENV_USAGE = 'orchestrate: usage: orchestrate.mjs envelope <spec|plan|audit|qa> [--item <label>] | --clear';
  const INSTALLED = (role) => `installed: ${role} envelope at ${ENVELOPE_FILE}`;
  const validates = (role) => spawnSync(process.execPath, [join(REPO_ROOT, 'scripts/snap-validate.mjs'), join(root, ENVELOPE_FILE), '--to', role], { encoding: 'utf8' }).status;
  const walk = (dir) => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)])) : []);

  // Bytes and mtime of every file the run owns, so "never alters a live run's file" is measured, not assumed.
  function surface() {
    const files = [join(root, RUN_FILE), join(root, ENVELOPE_FILE), ...walk(join(root, '.conductor'))].sort();
    return files.filter((f) => existsSync(f)).map((f) => [relative(root, f), readFileSync(f).toString('base64'), statSync(f).mtimeMs]);
  }
  function setState(state) {
    agents();
    if (state === 'unparseable') {
      writeFileSync(join(root, RUN_FILE), '{not json');
      writeFileSync(join(root, ENVELOPE_FILE), '{"v":3}');
    } else {
      expect(orch(['start', 'FEAT-011']).status).toBe(0);
      expect(orch(['install', 'spec']).status).toBe(0);
    }
    mkdirSync(join(root, '.conductor', 'handback'), { recursive: true });
    writeFileSync(join(root, '.conductor', 'handback', 'keep.txt'), 'keep\n');
    return state === 'foreign' ? 'sess-2' : 'sess-1';
  }

  it.each(['spec', 'plan'])('[AC1] %s in state N installs an RW envelope whose scope is the one start pins', (role) => {
    agents();
    const r = orch(['envelope', role, '--item', 'FEAT-011']);
    expect(r.status).toBe(0);
    expect(r.out.split('\n')[0]).toBe(INSTALLED(role));
    expect(validates(role)).toBe(0);
    expect(envelope().sys).toMatchObject({ tk: 'RW', s: 'FEAT-011' });
    expect(existsSync(join(root, RUN_FILE))).toBe(false);
    const { scope } = envelope().ops;
    expect(orch(['start', 'FEAT-011']).status).toBe(0);
    expect(runFile().docs.scopes[role]).toEqual(scope);
  });

  it('[AC1] audit in state N installs an R envelope with no scope, labelled adhoc', () => {
    agents();
    const r = orch(['envelope', 'audit']);
    expect(r.status).toBe(0);
    expect(r.out.split('\n')[0]).toBe(INSTALLED('audit'));
    expect(validates('audit')).toBe(0);
    expect(envelope().sys.tk).toBe('R');
    expect(envelope().sys.s).toBe('adhoc');
    expect(envelope().ops.gate).toBe('build_executed');
    expect(envelope().ops.scope).toBeUndefined();
    expect(existsSync(join(root, RUN_FILE))).toBe(false);
  });

  it('[AC1] qa in state N installs an X envelope carrying the resolved test command', () => {
    agents();
    expect(orch(['envelope', 'qa']).status).toBe(0);
    expect(validates('qa')).toBe(0);
    expect(envelope().sys.tk).toBe('X');
    expect(envelope().mem.p).toEqual({ test_command: 'npm test' });
    expect(existsSync(join(root, RUN_FILE))).toBe(false);
  });

  it('[AC1] qa in state N is refused when no test command resolves, and writes nothing', () => {
    agents();
    writeFileSync(join(root, 'package.json'), '{"scripts":{}}');
    const r = orch(['envelope', 'qa']);
    expect(r.status).toBe(2);
    expect(r.err.startsWith('orchestrate: ORCH_TEST_COMMAND_UNRESOLVED: ')).toBe(true);
    expect(existsSync(join(root, ENVELOPE_FILE))).toBe(false);
    expect(existsSync(join(root, RUN_FILE))).toBe(false);
  });

  it('[AC1] state N is refused with ORCH_AGENT_MISSING when the role has no agent definition', () => {
    const r = orch(['envelope', 'audit']);
    expect(r.status).toBe(2);
    expect(r.err).toBe('orchestrate: ORCH_AGENT_MISSING: no agent definition named audit in .claude/agents/ or ~/.claude/agents/');
    expect(existsSync(join(root, ENVELOPE_FILE))).toBe(false);
  });

  it('[AC1] state N overwrites a leftover envelope', () => {
    agents();
    writeFileSync(join(root, ENVELOPE_FILE), '{"left":"over"}');
    expect(orch(['envelope', 'audit']).status).toBe(0);
    expect(envelope().sys.role).toBe('audit');
  });

  it('[AC1] --clear in state N removes the envelope, then is a no-op that exits 0', () => {
    agents();
    orch(['envelope', 'qa']);
    expect(orch(['envelope', '--clear'])).toEqual({ status: 0, out: 'cleared', err: '' });
    expect(existsSync(join(root, ENVELOPE_FILE))).toBe(false);
    expect(orch(['envelope', '--clear'])).toEqual({ status: 0, out: 'no envelope', err: '' });
  });

  it.each([[['code']], [['security']], [['nope']], [[]], [['spec', '--item', 'a b']], [['spec', '--item', '../x']], [['spec', '--item']], [['audit', '--label', 'x']], [['qa', '--item', 'x', 'extra']]])(
    '[AC1] envelope %j is refused with the usage line and writes nothing', (args) => {
      agents();
      const r = orch(['envelope', ...args]);
      expect(r.status).toBe(2);
      expect(r.err).toBe(ENV_USAGE);
      expect(existsSync(join(root, ENVELOPE_FILE))).toBe(false);
      expect(existsSync(join(root, RUN_FILE))).toBe(false);
    });

  const LIVE = 'is live in this session';
  const OTHER = 'belongs to another session or is unreadable; clear it with: node ';
  const ROWS = ['L', 'foreign', 'unparseable'].flatMap((state) => {
    const refuse = state === 'L' ? LIVE : OTHER;
    return [
      [state, ['spec'], 2, refuse],
      [state, ['plan'], 2, refuse],
      [state, ['audit'], 0, state === 'L' ? 'not-installed: live run FEAT-011; audit has no write tool' : 'not-installed: a run file at '],
      state === 'L' ? [state, ['qa'], 0, 'not-installed: live run FEAT-011; qa runs npm test'] : [state, ['qa'], 2, OTHER],
      [state, ['--clear'], 2, 'envelope --clear: a run file exists at '],
    ];
  });
  it.each(ROWS)('[AC1] %s: envelope %j leaves every run file as it was', (state, args, status, text) => {
    const sid = setState(state);
    const before = surface();
    const r = orch(['envelope', ...args], { sid });
    expect(r.status).toBe(status);
    expect(status === 0 ? r.out : r.err).toContain(text);
    expect(surface()).toEqual(before);
    if (state !== 'unparseable') expect(runFile().halt).toBeNull();
  });

  it('[AC1] qa in a live run with no recorded test command is refused', () => {
    setState('L');
    runFileText(JSON.stringify({ ...runFile(), test_command: undefined }));
    const r = orch(['envelope', 'qa']);
    expect(r.status).toBe(2);
    expect(r.err).toContain('records no test command, so Guard 7 grants qa no shell');
    expect(runFile().halt).toBeNull();
  });
});

describe('resume verb [FEAT-055]', () => {
  const THREE_TASKS = `# Demo Plan\n\n${task(1, ['src/a.js'])}\n${task(2, ['src/b.js'])}\n${task(3, ['src/c.js'])}\n## Test List\n`;
  const gitRoot = () => { fixtureGit('init', '-q'); fixtureCommit(); };
  const head = () => fixtureGit('rev-parse', 'HEAD').stdout.trim();
  const snapOf = (line) => line.slice('SNAP_HANDBACK '.length);
  const anchoredSay = (c) => `Done.\nObservation: fine.\n${handbackLine('code', 'build_executed', { sys: { c } })}\n`;
  // A task hand-back as the contract asks: sys.c is the c of the envelope the agent was dispatched with.
  const codePass = () => { expect(orch(['install', 'code']).status).toBe(0); return orch(['handback', 'code'], { input: anchoredSay(envelope().sys.c) }); };
  function built(done, { planText = THREE_TASKS, start = [] } = {}) {
    driveTo('code', { planText, start, prep: gitRoot });
    for (let i = 0; i < done; i++) expect(codePass().status).toBe(0);
  }
  // A halt with role null that lands on no entry; the agents come back so the resumed run can dispatch.
  const haltAgentMissing = () => {
    rmSync(join(root, '.claude', 'agents', 'code.md'));
    expect(orch(['install', 'code']).err).toMatch(/^ORCH_AGENT_MISSING: /);
    agents();
  };
  const haltInvalid = () => expect(orch(['handback', 'code'], { input: 'Done.\nSNAP_HANDBACK {"v":3}\n' }).err).toMatch(/^ORCH_HANDBACK_INVALID: /);
  const editRun = (edit) => { const run = runFile(); edit(run); runFileText(JSON.stringify(run, null, 2) + '\n'); };
  // A real commit object that HEAD no longer descends from.
  const droppedCommit = () => { fixtureGit('commit', '-q', '--allow-empty', '-m', 'dropped'); const c = head(); fixtureGit('reset', '-q', 'HEAD~1'); return c; };
  const runBytes = () => (existsSync(join(root, RUN_FILE)) ? readFileSync(join(root, RUN_FILE), 'utf8') : null);
  const resumed = (code, gate, kept, dropped, next) => `run FEAT-011 resumed after ${code} from ${gate}: kept ${kept} record(s), dropped ${dropped}; next: ${next}`;
  const roles = () => runFile().handbacks.map((h) => (h.task ? `${h.role}:${h.task}` : h.role));

  it('RS1 approve records HEAD as each approval\'s commit in a git repository', () => {
    driveTo('code', { prep: gitRoot });
    expect(head()).toMatch(/^[0-9a-f]{40}$/);
    expect(runFile().approvals.spec.commit).toBe(head());
    expect(runFile().approvals.plan.commit).toBe(head());
  });

  it('RS2 approve records a null commit outside a git repository', () => {
    driveTo('code');
    expect(runFile().approvals.spec.commit).toBeNull();
    expect(runFile().approvals.plan.commit).toBeNull();
  });

  it('RS3 handback stores the validated SNAP line verbatim as snap', () => {
    driveTo('code');
    expect(runFile().handbacks[0].snap).toBe(snapOf(handbackLine('spec', 'boundary_routed')));
    expect(runFile().handbacks[1].snap).toBe(snapOf(handbackLine('plan', 'boundary_routed')));
    orch(['install', 'code']);
    orch(['handback', 'code'], { input: say('code', 'build_executed') });
    expect(runFile().handbacks[2].snap).toBe(snapOf(handbackLine('code', 'build_executed')));
  });

  it('RS3b an oversized but otherwise valid SNAP halts and is not written into the run file', () => {
    driveTo('code');
    orch(['install', 'code']);
    const big = handbackLine('code', 'build_executed').replace('"pr":""', `"pr":"${'x'.repeat(70 * 1024)}"`);
    expect(big).toContain('xxxx');
    const r = orch(['handback', 'code'], { input: `Done.\n${big}\n` });
    expect(r.err).toMatch(/^ORCH_HANDBACK_INVALID: .*larger than 65536 bytes/);
    const run = runFile();
    expect(run.handbacks.some((h) => h.role === 'code' && h.snap)).toBe(false);
    expect(Buffer.byteLength(JSON.stringify(run))).toBeLessThan(64 * 1024);
  });

  // Entry acceptance criteria.
  it('RS4[AC1] a conflict on task 2 of 3 keeps both approvals and re-dispatches task 2', () => {
    built(2);
    expect(orch(['handback', 'code'], { input: anchoredSay(head()) }).err).toMatch(/^ORCH_HANDBACK_CONFLICT: /);
    const approvals = JSON.stringify(runFile().approvals);
    const r = orch(['resume']);
    expect(r).toEqual({ status: 0, out: resumed('ORCH_HANDBACK_CONFLICT', 'define_approved', 5, 1, 'install code (task 2 of 3)'), err: '' });
    expect(JSON.stringify(runFile().approvals)).toBe(approvals);
    expect(runFile()).toMatchObject({ halt: null, role: null, gate: 'define_approved', tasks: { done: 1 } });
    expect(roles()).toEqual(['spec', 'plan', 'code:Task 1']);
    expect(JSON.parse(orch(['install', 'code', '--check']).out).ops.scope).toEqual(['src/b.js', PLAN]);
  });

  it('RS5 [AC1] a halt with code dispatched on task 2 keeps both approvals and re-dispatches task 2', () => {
    built(1);
    expect(orch(['install', 'code']).status).toBe(0);
    haltInvalid();
    expect(runFile().role).toBe('code');
    expect(orch(['resume']).out).toBe(resumed('ORCH_HANDBACK_INVALID', 'define_approved', 5, 0, 'install code (task 2 of 3)'));
    expect(runFile()).toMatchObject({ halt: null, role: null, tasks: { done: 1 } });
    expect(JSON.parse(orch(['install', 'code', '--check']).out).ops.scope).toEqual(['src/b.js', PLAN]);
  });

  it.each([
    ['spec', 'install plan', 'boundary_routed', 2],
    ['plan', 'install code (task 1 of 2)', 'define_approved', 4],
  ])('RS6 [AC1] a conflict on the approved %s keeps its entry and continues with %s', (kind, next, gate, kept) => {
    driveTo(kind === 'spec' ? 'plan' : 'code', { prep: gitRoot });
    expect(orch(['handback', kind], { input: say(kind, 'boundary_routed') }).err).toMatch(/^ORCH_HANDBACK_CONFLICT: /);
    const approvals = JSON.stringify(runFile().approvals);
    expect(orch(['resume']).out).toBe(resumed('ORCH_HANDBACK_CONFLICT', gate, kept, 0, next));
    expect(runFile().gate).toBe(gate);
    expect(roles().at(-1)).toBe(kind);
    expect(JSON.stringify(runFile().approvals)).toBe(approvals);
    expect(orch(['install', kind === 'spec' ? 'plan' : 'code', '--check']).status).toBe(0);
  });

  it.each([
    ['spec', () => writeFileSync(join(root, SPEC), '# Demo spec, revised\n')],
    ['plan', () => plan(THREE_TASKS.replace('thing 2', 'thing two'))],
  ])('RS7 [AC2] an edited approved %s refuses ORCH_APPROVED_DOC_CHANGED and writes nothing', (kind, edit) => {
    built(1);
    haltAgentMissing();
    edit();
    const before = runBytes();
    const env = envelopeText();
    const r = orch(['resume']);
    expect(r.status).toBe(2);
    expect(r.err).toMatch(new RegExp(`^orchestrate: ORCH_APPROVED_DOC_CHANGED: ${kind} `));
    expect(r.err.endsWith('; recover with end, then start')).toBe(true);
    expect(runBytes()).toBe(before);
    expect(envelopeText()).toBe(env);
  });

  it('RS8 [AC2] a ticked plan checkbox is not a change: the resume succeeds', () => {
    built(1);
    haltAgentMissing();
    plan(THREE_TASKS.replace('- [ ] **Step 1', '- [X] **Step 1'));
    expect(orch(['resume']).status).toBe(0);
    expect(runFile().halt).toBeNull();
  });

  it('RS9 [AC3] start in the run\'s own session still refuses ORCH_RUN_ACTIVE on a halted run', () => {
    built(1);
    haltAgentMissing();
    const before = runBytes();
    expect(orch(['start', 'FEAT-011'])).toMatchObject({ status: 1, err: 'ORCH_RUN_ACTIVE: run FEAT-011 is live in this session; end it first' });
    expect(runBytes()).toBe(before);
  });

  it('RS10 [AC3] end on a resumed and re-halted run prints the record and removes every run file', () => {
    built(1);
    haltAgentMissing();
    expect(orch(['resume']).status).toBe(0);
    expect(orch(['install', 'code']).status).toBe(0);
    haltInvalid();
    mkdirSync(join(root, HANDBACK_DIR), { recursive: true });
    writeFileSync(join(root, HANDBACK_DIR, 'code-2.txt'), 'x');
    mkdirSync(join(root, REVIEW_DIR), { recursive: true });
    writeFileSync(join(root, REVIEW_DIR, 'spec-1.md'), 'x');
    const r = orch(['end']);
    expect(r.status).toBe(0);
    const record = JSON.parse(r.out);
    expect(record).toMatchObject({ item: 'FEAT-011', halt: { code: 'ORCH_HANDBACK_INVALID' } });
    expect(record.resumes).toHaveLength(1);
    expect(record.resumes[0].halt.code).toBe('ORCH_AGENT_MISSING');
    for (const f of [RUN_FILE, ENVELOPE_FILE, HANDBACK_DIR, REVIEW_DIR]) expect(existsSync(join(root, f))).toBe(false);
  });

  // Issue #185's validation.
  it.each([
    ['a corrupted snap on task 2', 3, (h) => { h.snap = '{"v":3}'; }, 1, 5, 1, 'install code (task 2 of 3)'],
    ['a corrupted snap on task 1', 2, (h) => { h.snap = '{"v":3}'; }, 0, 4, 2, 'install code (task 1 of 3)'],
    ['a task entry with no snap (written before FEAT-055)', 3, (h) => { delete h.snap; }, 1, 5, 1, 'install code (task 2 of 3)'],
  ])('RS11 [AC4] %s cuts the sequence there', (_, index, edit, done, kept, dropped, next) => {
    built(2);
    haltAgentMissing();
    editRun((run) => edit(run.handbacks[index]));
    expect(orch(['resume']).out).toBe(resumed('ORCH_AGENT_MISSING', 'define_approved', kept, dropped, next));
    expect(runFile().tasks.done).toBe(done);
    expect(runFile().resumes[0]).toMatchObject({ kept, dropped });
  });

  it('RS12 [AC5] a task entry whose sys.c HEAD does not descend from is cut', () => {
    built(0);
    expect(orch(['install', 'code']).status).toBe(0);
    const c = droppedCommit();
    expect(orch(['handback', 'code'], { input: anchoredSay(c) }).status).toBe(0);
    haltAgentMissing();
    expect(orch(['resume']).out).toBe(resumed('ORCH_AGENT_MISSING', 'define_approved', 4, 1, 'install code (task 1 of 3)'));
    expect(runFile().tasks.done).toBe(0);
  });

  it('RS13 [AC5] a task entry whose sys.c is the c of the envelope install code wrote is kept', () => {
    built(0);
    expect(orch(['install', 'code']).status).toBe(0);
    const c = envelope().sys.c;
    expect(c).toBe(head());
    expect(orch(['handback', 'code'], { input: anchoredSay(c) }).status).toBe(0);
    haltAgentMissing();
    expect(orch(['resume']).status).toBe(0);
    expect(runFile().tasks.done).toBe(1);
    expect(JSON.parse(runFile().handbacks[2].snap).sys.c).toBe(c);
  });

  it('RS14 [AC5] HEAD reset to before the plan approval\'s commit refuses ORCH_RESUME_HISTORY_REWRITTEN', () => {
    driveTo('plan', { prep: gitRoot });
    const base = head();
    fixtureGit('commit', '-q', '--allow-empty', '-m', 'later');
    const later = head();
    orch(['install', 'plan']);
    orch(['handback', 'plan'], { input: say('plan', 'boundary_routed') });
    skipLoop('plan');
    expect(orch(approveArgs('plan')).status).toBe(0);
    expect(runFile().approvals.plan.commit).toBe(later);
    haltAgentMissing();
    fixtureGit('reset', '-q', 'HEAD~1');
    const before = runBytes();
    const env = envelopeText();
    expect(orch(['resume'])).toMatchObject({
      status: 2,
      err: `orchestrate: ORCH_RESUME_HISTORY_REWRITTEN: HEAD ${base} does not descend from the plan approval's commit ${later}; recover with end, then start`,
    });
    expect(runBytes()).toBe(before);
    expect(envelopeText()).toBe(env);
  });

  // Anything after the gate is redone.
  it('RS15 [AC6] a Verify halt keeps every task, drops every audit and fix entry, and redoes Verify', () => {
    built(2, { planText: TWO_TASKS, start: ['--audit-rounds', '1'] });
    const returned = auditReport('VERDICT: RETURN', ['- [blocker] src/a.js:10 — breaks AC1']);
    orch(['install', 'audit']);
    expect(orch(['handback', 'audit'], { input: returned }).status).toBe(0);
    orch(['install', 'code']);
    expect(orch(['handback', 'code'], { input: say('code', 'build_executed') }).status).toBe(0);
    orch(['install', 'audit']);
    expect(orch(['handback', 'audit'], { input: returned }).err).toMatch(/^ORCH_AUDIT_RETURN: /);
    expect(orch(['resume']).out).toBe(resumed('ORCH_AUDIT_RETURN', 'build_executed', 6, 3, 'install audit'));
    expect(runFile()).toMatchObject({ gate: 'build_executed', tasks: { done: 2 } });
    expect(roles()).toEqual(['spec', 'plan', 'code:Task 1', 'code:Task 2']);
    expect(orch(['install', 'audit', '--check']).status).toBe(0);
  });

  it('RS16 [AC6] a Define halt after the spec approval drops the plan entry and its loop and redoes the plan', () => {
    driveTo('plan', { prep: gitRoot });
    plan('# Plan\n\nNo tasks here.\n');
    orch(['install', 'plan']);
    orch(['handback', 'plan'], { input: say('plan', 'boundary_routed') });
    skipLoop('plan');
    expect(orch(approveArgs('plan')).err).toMatch(/^ORCH_EMPTY_SCOPE: /);
    expect(orch(['resume']).out).toBe(resumed('ORCH_EMPTY_SCOPE', 'boundary_routed', 2, 1, 'install plan'));
    expect(runFile()).toMatchObject({ gate: 'boundary_routed', approvals: { plan: null } });
    expect(roles()).toEqual(['spec']);
    expect(Object.keys(runFile().review)).toEqual(['spec']);
    expect(orch(['install', 'plan', '--check']).status).toBe(0);
  });

  // Refusals write nothing.
  it.each([
    ['an argument after resume', () => {}, ['resume', 'now'], 'sess-1', 'orchestrate: usage: orchestrate.mjs resume'],
    ['ORCH_RESUME_NO_RUN with no run file', () => rmSync(join(root, RUN_FILE)), ['resume'], 'sess-1', 'orchestrate: ORCH_RESUME_NO_RUN: '],
    ['ORCH_RESUME_NO_RUN with an invalid run file', () => runFileText('{"v":1}\n'), ['resume'], 'sess-1', 'orchestrate: ORCH_RESUME_NO_RUN: '],
    ['ORCH_RESUME_NOT_HALTED', () => editRun((r) => { r.halt = null; }), ['resume'], 'sess-1',
      'orchestrate: ORCH_RESUME_NOT_HALTED: run FEAT-011 is not halted; continue with install code'],
    ['ORCH_NO_SESSION_ID with no id', () => {}, ['resume'], null, 'orchestrate: ORCH_NO_SESSION_ID: '],
    ['ORCH_NO_SESSION_ID with an empty id', () => {}, ['resume'], '', 'orchestrate: ORCH_NO_SESSION_ID: '],
    ['ORCH_RESUME_NO_GATE', () => editRun((r) => { r.approvals = { spec: null, plan: null }; }), ['resume'], 'sess-1', 'orchestrate: ORCH_RESUME_NO_GATE: '],
    ['ORCH_APPROVAL_UNHASHED', () => editRun((r) => { delete r.approvals.spec.sha256; }), ['resume'], 'sess-1', 'orchestrate: ORCH_APPROVAL_UNHASHED: '],
    ['ORCH_RESUME_UNANCHORED with no commit', () => editRun((r) => { delete r.approvals.plan.commit; }), ['resume'], 'sess-1',
      'orchestrate: ORCH_RESUME_UNANCHORED: the plan approval records no commit'],
    ['ORCH_RESUME_UNANCHORED with a null commit', () => editRun((r) => { r.approvals.spec.commit = null; }), ['resume'], 'sess-1',
      'orchestrate: ORCH_RESUME_UNANCHORED: the spec approval records a null commit'],
    ['ORCH_RESUME_UNANCHORED when git cannot answer', () => editRun((r) => { r.approvals.plan.commit = 'f'.repeat(40); }), ['resume'], 'sess-1',
      'orchestrate: ORCH_RESUME_UNANCHORED: the plan approval commit '],
    ['ORCH_APPROVED_DOC_CHANGED', () => writeFileSync(join(root, SPEC), '# Changed\n'), ['resume'], 'sess-1', 'orchestrate: ORCH_APPROVED_DOC_CHANGED: spec '],
    ['ORCH_RESUME_HISTORY_REWRITTEN', () => { const c = droppedCommit(); editRun((r) => { r.approvals.plan.commit = c; }); }, ['resume'], 'sess-1',
      'orchestrate: ORCH_RESUME_HISTORY_REWRITTEN: '],
  ])('RS17 [AC7] %s refuses with exit 2 and writes nothing', (_, setup, args, sid, prefix) => {
    built(1);
    haltAgentMissing();
    setup();
    const before = runBytes();
    const env = envelopeText();
    const r = orch(args, { sid });
    expect(r.status).toBe(2);
    expect(r.err.startsWith(prefix)).toBe(true);
    expect(runBytes()).toBe(before);
    expect(envelopeText()).toBe(env);
  });

  // The record.
  it('RS18 [AC8] a resume records itself, binds the caller\'s session and removes the envelope', () => {
    built(1);
    haltAgentMissing();
    const halt = runFile().halt;
    expect(orch(['resume'], { sid: 'sess-2' }).out).toBe(resumed('ORCH_AGENT_MISSING', 'define_approved', 5, 0, 'install code (task 2 of 3)'));
    expect(runFile().session_id).toBe('sess-2');
    expect(runFile().resumes).toEqual([{ at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/), halt, kept: 5, dropped: 0 }]);
    expect(existsSync(join(root, ENVELOPE_FILE))).toBe(false);
    expect(orch(['install', 'code', '--check'], { sid: 'sess-2' }).status).toBe(0);
    expect(orch(['install', 'code', '--check']).err).toBe('orchestrate: run FEAT-011 belongs to another session; end it, or start to replace it');
  });

  it('RS19 [AC8] a second halt after a resume is resumed again and appends its own entry', () => {
    built(1);
    haltAgentMissing();
    expect(orch(['resume']).status).toBe(0);
    expect(orch(['install', 'code']).status).toBe(0);
    haltInvalid();
    expect(orch(['resume']).status).toBe(0);
    expect(runFile().resumes.map((x) => x.halt.code)).toEqual(['ORCH_AGENT_MISSING', 'ORCH_HANDBACK_INVALID']);
  });

  it('RS20 [AC8] isValidRun accepts a run file with or without the new fields', () => {
    const base = { v: 1, session_id: 's', item: 'FEAT-011', gate: 'boundary_routed', approvals: { spec: null, plan: null }, handbacks: [], tasks: { ids: [], done: 0 } };
    expect(isValidRun(base)).toBe(true);
    expect(isValidRun({
      ...base,
      resumes: [{ at: 'x', halt: { code: 'C', reason: 'r', at: 'x' }, kept: 2, dropped: 0 }],
      handbacks: [{ role: 'spec', gate: 'boundary_routed', at: 'x', snap: '{}' }],
      approvals: { spec: { at: 'x', by: 'b', path: SPEC, sha256: 'a'.repeat(64), commit: null }, plan: null },
    })).toBe(true);
  });
});

// FEAT-053 helpers, shared by the three role-model describes below.
const DEFAULT_SEGMENT = 'spec=opus, plan=opus, code=sonnet, audit=opus, security=opus, qa=haiku, define-review=opus';
const DEFAULT_MAP = { spec: 'opus', plan: 'opus', code: 'sonnet', audit: 'opus', security: 'opus', qa: 'haiku', 'define-review': 'opus' };
const claudeMd = (text) => writeFileSync(join(root, 'CLAUDE.md'), `# P\n\n${text}`);
const roleModels = (value) => claudeMd(`- Role models: ${value}\n`);
// A driveTo prep: the reviewer's profile and the opt-in line, written before start reads them.
const configured = (value = 'default') => () => { agents(['define-review']); roleModels(value); };
const startConfigured = (value = 'default', sid = 'sess-1') => { agents(); configured(value)(); return orch(['start', 'FEAT-011'], { sid }); };
const lastLine = (out) => out.split('\n').at(-1);
const RUN_OK = { v: 1, session_id: 's', item: 'FEAT-011', gate: 'boundary_routed', approvals: { spec: null, plan: null }, handbacks: [], tasks: { ids: [], done: 0 } };

describe('role models at start [FEAT-053]', () => {
  const { 'define-review': _reviewer, ...six } = DEFAULT_MAP;
  const modelsFile = (models) => runFileText(JSON.stringify({ ...runFile(), models }));

  it('S1 default records the shipped defaults and ends the start line with the role models segment', () => {
    const r = startConfigured();
    expect(r.status).toBe(0);
    expect(r.out.endsWith(`${SEC_NONE}; role models: ${DEFAULT_SEGMENT}`)).toBe(true);
    expect(runFile().models).toEqual(DEFAULT_MAP);
  });

  it.each(['default, qa=sonnet', 'qa=sonnet, default', '  default ,qa=sonnet  '])('S2 a role=model token overrides default whatever its order: %j', (value) => {
    expect(startConfigured(value).status).toBe(0);
    expect(runFile().models).toEqual({ ...DEFAULT_MAP, qa: 'sonnet' });
  });

  it('S3 a partial configuration leaves every other role inherit', () => {
    const r = startConfigured('code=sonnet');
    expect(r.out.endsWith('; role models: spec=inherit, plan=inherit, code=sonnet, audit=inherit, security=inherit, qa=inherit, define-review=inherit')).toBe(true);
    expect(r.out).not.toContain('; note:');
  });

  it('S4 default resolves a home profile without default-model: to inherit', () => {
    agents();
    rmSync(join(root, '.claude', 'agents', 'qa.md'));
    mkdirSync(join(home, '.claude', 'agents'), { recursive: true });
    writeFileSync(join(home, '.claude', 'agents', 'qa.md'), '---\nname: qa\ndescription: home\n---\nhome\n');
    configured()();
    const r = orch(['start', 'FEAT-011']);
    expect(r.status).toBe(0);
    expect(runFile().models.qa).toBe('inherit');
    expect(r.out).toContain('qa=inherit');
  });

  it.each([
    ['audit=sonnet, code=sonnet', '; note: audit and code share sonnet'],
    ['audit=inherit, code=inherit', ''],
  ])('S5 %j notes a shared model only for a non-inherit alias', (value, note) => {
    const r = startConfigured(value);
    expect(r.status).toBe(0);
    expect(r.out.endsWith(note || 'define-review=inherit')).toBe(true);
    if (note === '') expect(r.out).not.toContain('; note:');
  });

  it.each([
    ['an unknown role', '- Role models: default, coder=opus\n', 'unknown role "coder" in "coder=opus"; the roles are spec, plan, code, audit, security, qa, define-review'],
    ['a model outside the allow-list', '- Role models: qa=gpt\n', 'model "gpt" in "qa=gpt" is not one of opus, sonnet, haiku, inherit'],
    ['a role set twice', '- Role models: qa=opus, qa=haiku\n', 'role "qa" is set twice'],
    ['an empty token', '- Role models: default,,qa=opus\n', 'empty token in "- Role models: default,,qa=opus"'],
    ['default twice', '- Role models: default, default\n', '"default" appears twice'],
    ['a bare role', '- Role models: qa\n', 'token "qa" is neither default nor <role>=<model>'],
    ['two lines', '- Role models: default\n- Role models: qa=haiku\n', 'CLAUDE.md has 2 "- Role models:" lines; keep one'],
    ['a line with no value', '- Role models:\n', '"- Role models:" has no value; write default or <role>=<model> tokens'],
  ])('S6 %s halts ORCH_ROLE_MODELS_INVALID and writes no run file', (_name, claudeText, reason) => {
    agents();
    agents(['define-review']);
    claudeMd(claudeText);
    const r = orch(['start', 'FEAT-011']);
    expect(r.status).toBe(1);
    expect(r.err).toBe(`ORCH_ROLE_MODELS_INVALID: ${reason}`);
    expect(existsSync(join(root, RUN_FILE))).toBe(false);
  });

  it('S7 default with a profile default-model outside the allow-list halts naming the path and the value', () => {
    agents();
    writeFileSync(join(root, '.claude', 'agents', 'qa.md'), '---\nname: qa\ndescription: fixture\ndefault-model: gpt\n---\nfixture\n');
    configured()();
    const r = orch(['start', 'FEAT-011']);
    expect(r.status).toBe(1);
    expect(r.err).toBe(`ORCH_ROLE_MODELS_INVALID: ${join(root, '.claude', 'agents', 'qa.md')} sets default-model: gpt, not one of opus, sonnet, haiku, inherit`);
    expect(existsSync(join(root, RUN_FILE))).toBe(false);
  });

  it('S8 a malformed line leaves another session\'s run file as it was', () => {
    agents();
    expect(orch(['start', 'FEAT-011'], { sid: 'sess-0' }).status).toBe(0);
    const before = readFileSync(join(root, RUN_FILE), 'utf8');
    roleModels('qa=gpt');
    const r = orch(['start', 'FEAT-012']);
    expect(r.status).toBe(1);
    expect(r.err.startsWith('ORCH_ROLE_MODELS_INVALID')).toBe(true);
    expect(readFileSync(join(root, RUN_FILE), 'utf8')).toBe(before);
  });

  it.each([['no CLAUDE.md', null], ['a CLAUDE.md without the line', '- Specs: docs/specs\n- Plans: docs/plans\n']])('S9 with %s start records no models and prints no role models segment', (_name, text) => {
    agents();
    if (text !== null) claudeMd(text);
    const r = orch(['start', 'FEAT-011']);
    expect(r.status).toBe(0);
    expect(r.out).not.toContain('role models');
    expect(runFile()).not.toHaveProperty('models');
    expect(runFile()).not.toHaveProperty('dispatch_model');
  });

  it('S10 isValidRun accepts a run without models and with a valid models, dispatch_model and fix.model', () => {
    expect(isValidRun(RUN_OK)).toBe(true);
    expect(isValidRun({ ...RUN_OK, models: DEFAULT_MAP, dispatch_model: 'inherit', handbacks: [{ role: 'audit', fix: { round: 1, model: 'opus' } }] })).toBe(true);
  });

  it.each([
    ['models without define-review', { ...RUN_OK, models: six }],
    ['models with an extra role', { ...RUN_OK, models: { ...DEFAULT_MAP, review: 'opus' } }],
    ['a models value outside the allow-list', { ...RUN_OK, models: { ...DEFAULT_MAP, qa: 'gpt' } }],
    ['models as an array', { ...RUN_OK, models: [] }],
    ['a dispatch_model outside the allow-list', { ...RUN_OK, dispatch_model: 'gpt' }],
    ['a fix.model outside the allow-list', { ...RUN_OK, handbacks: [{ role: 'audit', fix: { round: 1, model: 'gpt' } }] }],
  ])('S11 isValidRun rejects %s', (_name, run) => {
    expect(isValidRun(run)).toBe(false);
  });

  it('S12 a run file edited to models.qa gpt halts ORCH_RUN_INVALID', () => {
    expect(startConfigured().status).toBe(0);
    modelsFile({ ...DEFAULT_MAP, qa: 'gpt' });
    const r = orch(['install', 'spec', '--check']);
    expect(r.status).toBe(1);
    expect(r.err).toMatch(/^ORCH_RUN_INVALID: /);
  });

  it('S13 the allow-list and the role set are exported constants', () => {
    expect(orchestrateModule.MODEL_ALIASES).toEqual(['opus', 'sonnet', 'haiku', 'inherit']);
    expect(orchestrateModule.MODEL_ROLES).toEqual(['spec', 'plan', 'code', 'audit', 'security', 'qa', 'define-review']);
  });
});

describe('role models at dispatch [FEAT-053]', () => {
  it('D1 install --check prints model: last and writes nothing; install records dispatch_model; handback copies it into the entry', () => {
    driveTo('spec', { prep: configured() });
    const before = readFileSync(join(root, RUN_FILE), 'utf8');
    const check = orch(['install', 'spec', '--check']);
    expect(check.status).toBe(0);
    expect(lastLine(check.out)).toBe('model: opus');
    expect(JSON.parse(check.out.split('\n')[0]).sys.role).toBe('spec');
    expect(readFileSync(join(root, RUN_FILE), 'utf8')).toBe(before);
    const installed = orch(['install', 'spec']);
    expect(installed.out).toBe(check.out);
    expect(runFile().dispatch_model).toBe('opus');
    const back = orch(['handback', 'spec'], { input: say('spec', 'boundary_routed') });
    expect(back.status).toBe(0);
    expect(back.out).toBe('spec handed back boundary_routed');
    expect(runFile().handbacks[0].model).toBe('opus');
  });

  it('D2 every role dispatches on its configured model and each entry records it', () => {
    driveTo('security', { prep: configured() });
    expect(runFile().handbacks.map((h) => h.model)).toEqual(['opus', 'opus', 'sonnet', 'sonnet', 'opus']);
    expect(lastLine(orch(['install', 'security', '--check']).out)).toBe('model: opus');
    expect(securityPass().status).toBe(0);
    expect(runFile().handbacks.at(-1).model).toBe('opus');
    expect(lastLine(orch(['install', 'qa', '--check']).out)).toBe('model: haiku');
    orch(['install', 'qa']);
    expect(orch(['handback', 'qa'], { input: say('qa', 'verify_pass') }).status).toBe(0);
    expect(runFile().handbacks.at(-1).model).toBe('haiku');
  });

  it('D3 a role=model token overrides default at dispatch', () => {
    driveTo('code', { prep: configured('default, code=haiku') });
    expect(lastLine(orch(['install', 'code', '--check']).out)).toBe('model: haiku');
  });

  it('D4 an uncovered role prints model: inherit, and the run records inherit', () => {
    driveTo('spec', { prep: configured('code=sonnet') });
    expect(lastLine(orch(['install', 'spec', '--check']).out)).toBe('model: inherit');
    orch(['install', 'spec']);
    expect(runFile().dispatch_model).toBe('inherit');
    orch(['handback', 'spec'], { input: say('spec', 'boundary_routed') });
    expect(runFile().handbacks[0].model).toBe('inherit');
  });

  it('D5 review --round names the define-review model and the OPEN line the author\'s model', () => {
    driveTo('spec', { prep: configured('default, spec=sonnet') });
    orch(['install', 'spec']);
    orch(['handback', 'spec'], { input: say('spec', 'boundary_routed') });
    putDoc('spec', '# Demo spec\n');
    expect(orch(['review', 'spec', '--round', SPEC]).out).toBe(`review spec round 1 of 3: ${SPEC} sha256 ${sha(SPEC)}; model opus`);
    const r1 = writeReview('spec', 1, 'OPEN 1', [ROW]);
    expect(orch(['review', 'spec', '--record']).out).toBe(`review spec round 1: OPEN 1; revise ${SPEC} sha256 ${sha(SPEC)} from ${reviewPath('spec', 1)} sha256 ${r1}; model sonnet`);
  });

  it('D6 without the line no install, handback or review output carries model text and no record holds a model', () => {
    driveTo('spec');
    expect(orch(['install', 'spec', '--check']).out).not.toContain('model');
    orch(['install', 'spec']);
    expect(orch(['handback', 'spec'], { input: say('spec', 'boundary_routed') }).out).toBe('spec handed back boundary_routed');
    putDoc('spec', '# Demo spec\n');
    expect(orch(['review', 'spec', '--round', SPEC]).out).toBe(`review spec round 1 of 3: ${SPEC} sha256 ${sha(SPEC)}`);
    expect(runFile()).not.toHaveProperty('models');
    expect(runFile()).not.toHaveProperty('dispatch_model');
    expect(runFile().handbacks[0]).not.toHaveProperty('model');
  });
});

describe('escalation on repeated returns [FEAT-053]', () => {
  const returned = (...findings) => auditReport('VERDICT: RETURN', findings);
  const pass = (input) => { orch(['install', 'audit']); return orch(['handback', 'audit'], { input }); };
  const fixPass = () => { orch(['install', 'code']); return orch(['handback', 'code'], { input: say('code', 'build_executed') }); };
  const BLOCKER_A = '- [blocker] src/a.js:10 — breaks AC1';
  const MAJOR_B = '- [major] src/b.js:2 — misses an edge';
  const lastFix = () => runFile().handbacks.at(-1).fix;
  const ESCALATED = '; model opus (escalated: Task 1 returned twice)';

  it.each([['default', 'sonnet'], ['code=sonnet', 'sonnet'], ['default, code=opus', 'opus']])('E1 with %j a second return of Task 1 dispatches its fix on opus and records why', (value, first) => {
    driveTo('audit', { prep: configured(value) });
    const r1 = pass(returned(BLOCKER_A));
    expect(r1.status).toBe(0);
    expect(r1.out.endsWith(`; model ${first}`)).toBe(true);
    expect(lastFix()).toMatchObject({ round: 1, tasks: ['Task 1'], model: first });
    expect(lastFix()).not.toHaveProperty('escalated');
    expect(lastLine(orch(['install', 'code', '--check']).out)).toBe(`model: ${first}`);
    const f1 = fixPass();
    expect(f1.status).toBe(0);
    expect(runFile().handbacks.at(-1).model).toBe(first);
    const r2 = pass(returned(BLOCKER_A));
    expect(r2.status).toBe(0);
    expect(r2.out.endsWith(ESCALATED)).toBe(true);
    expect(lastFix()).toEqual({ round: 2, files: ['src/a.js'], review: '.conductor/handback/audit-2.txt', sha256: expect.any(String), tasks: ['Task 1'], model: 'opus', escalated: ['Task 1'] });
    expect(lastLine(orch(['install', 'code', '--check']).out)).toBe('model: opus');
    expect(fixPass().status).toBe(0);
    expect(runFile().handbacks.at(-1).model).toBe('opus');
    expect(runFile().dispatch_model).toBe('opus');
  });

  it('E2 a second return naming only new tasks keeps the code model', () => {
    driveTo('audit', { prep: configured() });
    pass(returned(BLOCKER_A));
    fixPass();
    const r = pass(returned(MAJOR_B));
    expect(r.out.endsWith('; model sonnet')).toBe(true);
    expect(lastFix()).toMatchObject({ round: 2, tasks: ['Task 2'], model: 'sonnet' });
    expect(lastFix()).not.toHaveProperty('escalated');
    expect(lastLine(orch(['install', 'code', '--check']).out)).toBe('model: sonnet');
  });

  it('E3 a path listed by two tasks returns both, and a later return of either escalates only the shared one', () => {
    driveTo('audit', { prep: configured(), planText: `# Demo Plan\n\n${task(1, ['src/a.js'])}\n${task(2, ['src/a.js', 'src/b.js'])}\n## Test List\n` });
    pass(returned(BLOCKER_A));
    expect(lastFix().tasks).toEqual(['Task 1', 'Task 2']);
    fixPass();
    const r = pass(returned(MAJOR_B));
    expect(lastFix()).toMatchObject({ tasks: ['Task 2'], model: 'opus', escalated: ['Task 2'] });
    expect(r.out.endsWith('; model opus (escalated: Task 2 returned twice)')).toBe(true);
  });

  it('E4 a hand-edited fix.model halts the next verb ORCH_RUN_INVALID', () => {
    driveTo('audit', { prep: configured() });
    pass(returned(BLOCKER_A));
    const run = runFile();
    run.handbacks.at(-1).fix.model = 'gpt';
    runFileText(JSON.stringify(run));
    const r = orch(['install', 'code', '--check']);
    expect(r.status).toBe(1);
    expect(r.err).toMatch(/^ORCH_RUN_INVALID: /);
  });

  it('E5 at --audit-rounds 1 a second return of the same task halts ORCH_AUDIT_RETURN and records no fix', () => {
    driveTo('audit', { start: ['--audit-rounds', '1'], prep: configured() });
    expect(pass(returned(BLOCKER_A)).status).toBe(0);
    expect(lastFix()).toMatchObject({ tasks: ['Task 1'], model: 'sonnet' });
    fixPass();
    const r = pass(returned(BLOCKER_A));
    expect(r.status).toBe(1);
    expect(r.err.startsWith('ORCH_AUDIT_RETURN: ')).toBe(true);
    expect(runFile().handbacks.at(-1)).toMatchObject({ role: 'audit', verdict: 'RETURN', round: 2 });
    expect(runFile().handbacks.at(-1)).not.toHaveProperty('fix');
    expect(runFile().halt.code).toBe('ORCH_AUDIT_RETURN');
  });

  it('E6 without the line two returns of the same task record no model, tasks or escalated', () => {
    driveTo('audit');
    const r1 = pass(returned(BLOCKER_A));
    fixPass();
    const r2 = pass(returned(BLOCKER_A));
    for (const r of [r1, r2]) {
      expect(r.status).toBe(0);
      expect(r.out).not.toContain('; model');
    }
    for (const h of runFile().handbacks.filter((e) => e.role === 'audit' && e.fix)) expect(Object.keys(h.fix).sort()).toEqual(['files', 'review', 'round', 'sha256']);
    expect(orch(['install', 'code', '--check']).out.split('\n')).toHaveLength(2);
    const text = JSON.stringify(runFile());
    for (const key of ['"model"', '"models"', '"dispatch_model"']) expect(text).not.toContain(key);
  });

  it('E7 resume keeps the recorded models', () => {
    driveTo('code', { prep: () => { configured()(); fixtureGit('init', '-q'); fixtureCommit(); } });
    const { models } = runFile();
    rmSync(join(root, '.claude', 'agents', 'code.md'));
    expect(orch(['install', 'code']).err).toMatch(/^ORCH_AGENT_MISSING: /);
    agents();
    expect(orch(['resume']).status).toBe(0);
    expect(runFile().models).toEqual(models);
    expect(runFile().halt).toBeNull();
    expect(lastLine(orch(['install', 'code', '--check']).out)).toBe('model: sonnet');
  });
});
