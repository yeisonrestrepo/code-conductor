import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { fakeGh, issue, pull } from '../helpers/fake-gh.js';
import { parseSnapshotHeader } from '../../scripts/ticket.mjs';
import { cleanGitEnv } from '../helpers/git-env.js';
import {
  ENVELOPE_FILE, HANDBACK_DIR, MAY_HAND_BACK, ROLE_ARTIFACTS, REVIEW_CAP, REVIEW_DIR, RUN_FILE, SHELL_METACHARACTERS, WRITE_SURFACE,
  Halt, checkTestCommand, docScopes, documentHash, extractTasks, findAgent, forwardGate, isValidRun, nextStep, parseVerdict, recordHandback, taskScope,
} from '../../scripts/orchestrate.mjs';
import { CANDIDATE_PAIRS, DEFAULT_PAIR } from '../../scripts/doc-locations.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = join(REPO_ROOT, 'scripts/orchestrate.mjs');
const ROLES = ['spec', 'plan', 'code', 'audit', 'qa'];
const PLAN = 'docs/plans/demo.md';
const SPEC = 'docs/specs/demo-design.md';
// Every root gets a test script with no lockfile, so start records `npm test` (FEAT-012 D6).
const PKG = '{"scripts":{"test":"vitest run"}}';

let root, home;
beforeEach(() => {
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
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: root, env, input, encoding: 'utf8', timeout: 30000 });
  if (r.error) throw new Error(`orchestrate spawn failed: ${r.error.message}`);
  return { status: r.status, out: r.stdout.trim(), err: r.stderr.trim() };
}
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

function agents(roles = ROLES, dir = join(root, '.claude', 'agents')) {
  mkdirSync(dir, { recursive: true });
  for (const r of roles) writeFileSync(join(dir, `${r}.md`), `---\nname: ${r}\ndescription: fixture\n---\nfixture\n`);
}
function plan(body) {
  mkdirSync(dirname(join(root, PLAN)), { recursive: true });
  writeFileSync(join(root, PLAN), body);
}
const task = (n, files) => `### Task ${n}: thing ${n}\n\n**Files:**\n${files.map((f) => `- Modify: \`${f}\``).join('\n')}\n\n- [ ] **Step 1: do it**\n`;
const TWO_TASKS = `# Demo Plan\n\n${task(1, ['src/a.js:10-20', 'tests/a.test.js'])}\n${task(2, ['src/b.js'])}\n## Test List\n`;
const handbackLine = (role, gate, extra = {}) => 'SNAP_HANDBACK ' + JSON.stringify({
  v: 3, sys: { ph: 'impl', c: '0000000', s: 'FEAT-011', role, tk: 'X', ...extra.sys },
  ops: { n: [], f: [], gate }, mem: { d: [], x: [] }, pr: '',
});
const say = (role, gate) => `Done.\nObservation: fine.\n${role === 'audit' ? 'VERDICT: APPROVE\n' : ''}${handbackLine(role, gate)}\n`;
const auditReport = (verdict, findings = []) => ['Done.', ...findings, ...(verdict === null ? [] : [verdict]), handbackLine('audit', 'build_executed'), ''].join('\n');

// Drives a fresh run to the point where `role` is next, recording each step on the way.
function driveTo(role) {
  agents();
  plan(TWO_TASKS);
  const steps = [
    ['spec', () => { orch(['install', 'spec']); orch(['handback', 'spec'], { input: say('spec', 'boundary_routed') }); orch(approveArgs('spec')); }],
    ['plan', () => { orch(['install', 'plan']); orch(['handback', 'plan'], { input: say('plan', 'boundary_routed') }); orch(approveArgs('plan')); }],
    ['code', () => { for (let i = 0; i < 2; i++) { orch(['install', 'code']); orch(['handback', 'code'], { input: say('code', 'build_executed') }); } }],
    ['audit', () => { orch(['install', 'audit']); orch(['handback', 'audit'], { input: say('audit', 'build_executed') }); }],
  ];
  expect(orch(['start', 'FEAT-011']).status).toBe(0);
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
      audit: ['build_executed'], qa: ['verify_pass'],
    });
  });

  it('gives each role the reviewed tool kind and scope (D5)', () => {
    expect(ROLE_ARTIFACTS).toEqual({
      spec: { tk: 'RW', scope: null },
      plan: { tk: 'RW', scope: null },
      code: { tk: 'RW', scope: null },
      audit: { tk: 'R', scope: null },
      qa: { tk: 'X', scope: null },
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
      .toEqual(['spec', 'plan', 'code:Task 1', 'code:Task 2', 'audit', 'qa']);
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
    expect(r.out).toBe(`replaced the stale run FEAT-011 started ${started}; docs: specs docs/specs, plans docs/plans (default); test command: npm test`);
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

  it('refuses every verb but end once a run has halted (D12)', () => {
    orch(['start', 'FEAT-011']);
    orch(['install', 'spec']);
    agents();
    const r = orch(['install', 'spec']);
    expect(r.status).toBe(2);
    expect(r.err).toBe('orchestrate: run FEAT-011 halted with ORCH_AGENT_MISSING; recover with end, then start (D12)');
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
    expect(r.err).toBe('ORCH_HANDBACK_INVALID: a hand-back must be a v3 envelope, got v1');
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
    ['package-lock.json', 'npm test'],
    ['pnpm-lock.yaml', 'pnpm test'],
    ['yarn.lock', 'yarn test'],
    ['bun.lockb', 'bun run test'],
  ])('[AC8] records the package manager invocation for %s', (lock, expected) => {
    files({ [lock]: '' });
    const r = start();
    expect(r.status).toBe(0);
    expect(r.out).toBe(`run FEAT-012 started; docs: specs docs/specs, plans docs/plans (default); test command: ${expected}`);
    expect(runFile().test_command).toBe(expected);
  });

  it('[AC8] records npm test with no lockfile, the stated default', () => {
    expect(start().out).toBe('run FEAT-012 started; docs: specs docs/specs, plans docs/plans (default); test command: npm test');
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
    expect(r.out).toBe(`run FEAT-031 started; ticket ${REPO}#5 "Add widgets"; snapshot ${SNAP} sha256 ${hash}; docs: specs docs/specs, plans docs/plans (default); test command: npm test`);
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
    pass('spec', 'boundary_routed', approveArgs('spec'));
    pass('plan', 'boundary_routed', approveArgs('plan'));
    pass('code', 'build_executed');
    pass('code', 'build_executed');
    pass('audit', 'build_executed');
    seen.push(pOf('qa'));
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
    expect(r.err).toBe('orchestrate: usage: orchestrate.mjs start <ITEM> [--auto] [--ticket <N|issue URL>]');
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
const USAGE = 'orchestrate: usage: orchestrate.mjs review <spec|plan> --round | --close <clean|cap|skipped:<reason>>';

describe('review loop round counter [FEAT-041 AC2-AC4]', () => {
  it('refuses --round outside the await window, writing nothing', () => {
    driveTo('spec');
    const before = readFileSync(join(root, RUN_FILE), 'utf8');
    expect(orch(['review', 'spec', '--round'])).toMatchObject({ status: 2, err: 'orchestrate: review spec: the next step is install spec' });
    expect(readFileSync(join(root, RUN_FILE), 'utf8')).toBe(before);
  });

  it('opens round 1 after the spec hand-back and records it', () => {
    awaiting('spec');
    expect(orch(['review', 'spec', '--round'])).toMatchObject({ status: 0, out: 'review spec round 1 of 3' });
    expect(loop('spec')).toEqual({ round: 1, outcome: null });
  });

  it('refuses a fourth round with ORCH_REVIEW_CAP, a refusal that sets no halt', () => {
    awaiting('spec');
    for (let n = 1; n <= REVIEW_CAP; n++) expect(orch(['review', 'spec', '--round']).out).toBe(`review spec round ${n} of 3`);
    expect(orch(['review', 'spec', '--round'])).toMatchObject({ status: 2, err: 'orchestrate: ORCH_REVIEW_CAP: review spec has run 3 rounds; close it with --close cap' });
    expect(runFile().halt).toBeNull();
    expect(loop('spec')).toEqual({ round: 3, outcome: null });
  });

  it('closes clean, and a closed loop refuses --round and a second --close', () => {
    awaiting('spec');
    orch(['review', 'spec', '--round']);
    expect(orch(['review', 'spec', '--close', 'clean'])).toMatchObject({ status: 0, out: 'review spec closed clean at round 1' });
    for (const args of [['--round'], ['--close', 'cap']]) {
      expect(orch(['review', 'spec', ...args])).toMatchObject({ status: 2, err: 'orchestrate: review spec: the loop closed clean; a closed loop does not reopen' });
    }
    expect(loop('spec')).toEqual({ round: 1, outcome: 'clean' });
  });

  it('accepts cap only at round 3', () => {
    awaiting('spec');
    orch(['review', 'spec', '--round']);
    expect(orch(['review', 'spec', '--close', 'cap'])).toMatchObject({ status: 2, err: 'orchestrate: review spec: cap needs round 3; the loop is at round 1' });
    orch(['review', 'spec', '--round']);
    orch(['review', 'spec', '--round']);
    expect(orch(['review', 'spec', '--close', 'cap'])).toMatchObject({ status: 0, out: 'review spec closed cap at round 3' });
  });

  it('refuses clean before any pass, and accepts a skip at round 0', () => {
    awaiting('spec');
    expect(orch(['review', 'spec', '--close', 'clean'])).toMatchObject({ status: 2, err: 'orchestrate: review spec: clean needs a reviewer pass; none has run' });
    expect(orch(['review', 'spec', '--close', 'skipped:verb'])).toMatchObject({ status: 0, out: 'review spec closed skipped:verb at round 0' });
    expect(loop('spec')).toEqual({ round: 0, outcome: 'skipped:verb' });
  });

  it.each(['skipped:', 'skipped:Denied', 'skipped:a b', `skipped:${'a'.repeat(41)}`, 'done'])('refuses the outcome %j, writing nothing', (outcome) => {
    awaiting('spec');
    expect(orch(['review', 'spec', '--close', outcome])).toMatchObject({ status: 2, err: USAGE });
    expect(loop('spec')).toBeUndefined();
  });

  it('refuses a malformed call with the usage line', () => {
    awaiting('spec');
    for (const args of [['spec'], ['spec', '--open'], ['spec', '--round', 'x'], ['spec', '--close'], ['spec', '--close', 'clean', 'x']]) {
      expect(orch(['review', ...args])).toMatchObject({ status: 2, err: USAGE });
    }
    expect(loop('spec')).toBeUndefined();
  });

  it('runs a separate loop for plan in its own window, and refuses spec there', () => {
    awaiting('plan');
    expect(orch(['review', 'plan', '--round']).out).toBe('review plan round 1 of 3');
    expect(orch(['review', 'spec', '--round'])).toMatchObject({ status: 2, err: 'orchestrate: review spec: the next step is approve plan' });
    expect(runFile().review).toEqual({ plan: { round: 1, outcome: null } });
  });

  it('[AC4] approve ignores an open loop and keeps its record', () => {
    awaiting('spec');
    orch(['review', 'spec', '--round']);
    expect(orch(approveArgs('spec')).status).toBe(0);
    expect(runFile()).toMatchObject({ approvals: { spec: { by: expect.any(String) } }, review: { spec: { round: 1, outcome: null } } });
  });

  it('[AC4] isValidRun accepts a run with and without review', () => {
    const run = { v: 1, session_id: 's', item: 'FEAT-041', ...blank };
    expect(isValidRun(run)).toBe(true);
    expect(isValidRun({ ...run, review: { spec: { round: 1, outcome: 'clean' } } })).toBe(true);
  });

  it('[AC4] end prints the review record and removes .conductor/review', () => {
    awaiting('spec');
    orch(['review', 'spec', '--round']);
    mkdirSync(join(root, REVIEW_DIR), { recursive: true });
    writeFileSync(join(root, REVIEW_DIR, 'spec-1-review.txt'), 'REVIEW spec round 1: CLEAN\n');
    expect(JSON.parse(orch(['end']).out).review).toEqual({ spec: { round: 1, outcome: null } });
    expect(existsSync(join(root, REVIEW_DIR))).toBe(false);
  });

  it('a start over a stale run clears .conductor/review', () => {
    orch(['start', 'FEAT-011'], { sid: 'old-session' });
    mkdirSync(join(root, REVIEW_DIR), { recursive: true });
    writeFileSync(join(root, REVIEW_DIR, 'spec-1-review.txt'), 'stale\n');
    expect(orch(['start', 'FEAT-012']).status).toBe(0);
    expect(existsSync(join(root, REVIEW_DIR))).toBe(false);
  });

  it('refuses on a halted run, writing nothing', () => {
    awaiting('spec');
    runFileText(JSON.stringify({ ...runFile(), halt: { code: 'SNAP_ERROR', reason: 'x', at: 'y' } }));
    const r = orch(['review', 'spec', '--round']);
    expect(r.status).toBe(2);
    expect(r.err).toContain('halted with SNAP_ERROR');
    expect(loop('spec')).toBeUndefined();
  });

  it('[RF2] starts fresh over a corrupt review field instead of crashing', () => {
    awaiting('spec');
    runFileText(JSON.stringify({ ...runFile(), review: 'corrupt' }));
    expect(orch(['review', 'spec', '--round']).out).toBe('review spec round 1 of 3');
    runFileText(JSON.stringify({ ...runFile(), review: { spec: { round: 'two', outcome: null } } }));
    expect(orch(['review', 'spec', '--round']).out).toBe('review spec round 1 of 3');
    expect(runFile().review).toEqual({ spec: { round: 1, outcome: null } });
  });

  it('names review in the usage line', () => {
    expect(orch(['nope']).err).toBe('orchestrate: usage: orchestrate.mjs start|install|handback|approve|hash|review|end');
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
    expect(r.out.endsWith('docs: specs .claude/specs, plans .claude/plans (discovered); group pillar-3; test command: npm test')).toBe(true);
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
    ['APPROVE with no findings', auditReport('VERDICT: APPROVE'), 'APPROVE', 0],
    ['APPROVE with only minor findings', auditReport('VERDICT: APPROVE', minor), 'APPROVE', 0],
    ['RETURN with a blocker and a major', auditReport('VERDICT: RETURN', severe), 'RETURN', 2],
    ['ESCALATE with no findings', auditReport('VERDICT: ESCALATE'), 'ESCALATE', 0],
    ['ESCALATE with a major finding', auditReport('VERDICT: ESCALATE', ['- [major] src/a.js:1 — needs a new dependency']), 'ESCALATE', 1],
    ['a CRLF report', auditReport('VERDICT: APPROVE').replace(/\n/g, '\r\n'), 'APPROVE', 0],
    ['blank lines between the verdict and SNAP_HANDBACK', ['Done.', 'VERDICT: APPROVE', '', '', handbackLine('audit', 'build_executed'), ''].join('\n'), 'APPROVE', 0],
    ['prose that names the verdict mid-line', auditReport('VERDICT: APPROVE', ['The verdict depends on the plan.']), 'APPROVE', 0],
  ])('parseVerdict accepts %s', (_name, text, verdict, blockers) => {
    expect(parseVerdict(text)).toEqual({ verdict, blockers });
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

  it('APPROVE with minor findings records the verdict and lets qa forward verify_pass', () => {
    driveTo('audit');
    expect(orch(['install', 'audit']).status).toBe(0);
    expect(orch(['handback', 'audit'], { input: auditReport('VERDICT: APPROVE', ['- [minor] src/a.js:3 — nit']) }).status).toBe(0);
    expect(runFile().handbacks.at(-1)).toMatchObject({ role: 'audit', verdict: 'APPROVE' });
    expect(orch(['install', 'qa']).status).toBe(0);
    expect(orch(['handback', 'qa'], { input: say('qa', 'verify_pass') }).status).toBe(0);
    expect(runFile().gate).toBe('verify_pass');
  });

  it.each([
    ['VERDICT: RETURN', ['- [blocker] src/a.js:10 — breaks AC1'], 'ORCH_AUDIT_RETURN'],
    ['VERDICT: ESCALATE', [], 'ORCH_AUDIT_ESCALATE'],
  ])('a valid %s halts %s after recording the audit entry, and install qa is refused', (line, findings, code) => {
    driveTo('audit');
    orch(['install', 'audit']);
    const r = orch(['handback', 'audit'], { input: auditReport(line, findings) });
    expect(r.status).toBe(1);
    expect(r.err).toMatch(new RegExp(`^${code}: `));
    expect(r.err).toContain('.conductor/handback/audit.txt');
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

  it('A3 both approvals record exactly at, by, path and a lower-case sha256, from an upper-case argument', () => {
    awaiting('spec');
    const specSha = approveArgs('spec')[3];
    expect(orch(['approve', 'spec', SPEC, specSha.toUpperCase()])).toMatchObject({ status: 0, out: `spec approved: sha256 ${specSha}` });
    orch(['install', 'plan']);
    orch(['handback', 'plan'], { input: say('plan', 'boundary_routed') });
    expect(orch(approveArgs('plan')).out).toBe(`plan approved: define_approved, 2 task(s); sha256 ${sha(PLAN)}`);
    for (const [a, rel] of [[runFile().approvals.spec, SPEC], [runFile().approvals.plan, PLAN]]) {
      expect(Object.keys(a).sort()).toEqual(['at', 'by', 'path', 'sha256']);
      expect(a).toMatchObject({ path: rel, sha256: sha(rel), by: expect.any(String) });
      expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('A4 a plan whose boxes were ticked between hash and approve still approves', () => {
    awaiting('plan');
    const shown = sha(PLAN);
    tickPlan('[X]');
    expect(orch(['approve', 'plan', PLAN, shown]).status).toBe(0);
    expect(runFile().approvals.plan.sha256).toBe(shown);
  });

  it('B1 ticking boxes after approval keeps every later install passing', () => {
    driveTo('code');
    for (const box of ['[>]', '[X]']) {
      expect(orch(['install', 'code']).status).toBe(0);
      tickPlan(box);
      expect(orch(['handback', 'code'], { input: say('code', 'build_executed') }).status).toBe(0);
    }
    tickPlan('[x]');
    expect(orch(['install', 'audit']).status).toBe(0);
    expect(orch(['handback', 'audit'], { input: say('audit', 'build_executed') }).status).toBe(0);
    tickPlan('[!]');
    expect(orch(['install', 'qa']).status).toBe(0);
    expect(runFile().halt).toBeNull();
  });

  it.each(['code', 'audit', 'qa'])('B2 a plan line edited after approval halts install %s with ORCH_APPROVED_DOC_CHANGED', (role) => {
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
