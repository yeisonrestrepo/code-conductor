import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ENVELOPE_FILE, HANDBACK_DIR, MAY_HAND_BACK, ROLE_ARTIFACTS, RUN_FILE, WRITE_SURFACE,
  extractTasks, findAgent, forwardGate, nextStep, taskScope,
} from '../../scripts/orchestrate.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = join(REPO_ROOT, 'scripts/orchestrate.mjs');
const ROLES = ['spec', 'plan', 'code', 'audit', 'qa'];
const PLAN = 'docs/superpowers/plans/demo.md';

let root, home;
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'cc-orch-root-')));
  home = realpathSync(mkdtempSync(join(tmpdir(), 'cc-orch-home-')));
  mkdirSync(join(root, '.claude', 'memory'), { recursive: true });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

// Through the CLI's real contract: verb on argv, hand-back on stdin, this session's id in env.
function orch(args, { input = '', sid = 'sess-1' } = {}) {
  const env = { ...process.env, HOME: home, USERPROFILE: home };
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

function agents(roles = ROLES, dir = join(root, '.claude', 'agents')) {
  mkdirSync(dir, { recursive: true });
  for (const r of roles) writeFileSync(join(dir, `${r}.md`), `---\nname: ${r}\ndescription: fixture\n---\nfixture\n`);
}
function plan(body) {
  mkdirSync(join(root, 'docs', 'superpowers', 'plans'), { recursive: true });
  writeFileSync(join(root, PLAN), body);
}
const task = (n, files) => `### Task ${n}: thing ${n}\n\n**Files:**\n${files.map((f) => `- Modify: \`${f}\``).join('\n')}\n\n- [ ] **Step 1: do it**\n`;
const TWO_TASKS = `# Demo Plan\n\n${task(1, ['src/a.js:10-20', 'tests/a.test.js'])}\n${task(2, ['src/b.js'])}\n## Test List\n`;
const handbackLine = (role, gate, extra = {}) => 'SNAP_HANDBACK ' + JSON.stringify({
  v: 3, sys: { ph: 'impl', c: '0000000', s: 'FEAT-011', role, tk: 'X', ...extra.sys },
  ops: { n: [], f: [], gate }, mem: { d: [], x: [] }, pr: '',
});
const say = (role, gate) => `Done.\nObservation: fine.\n${handbackLine(role, gate)}\n`;

// Drives a fresh run to the point where `role` is next, recording each step on the way.
function driveTo(role) {
  agents();
  plan(TWO_TASKS);
  const steps = [
    ['spec', () => { orch(['install', 'spec']); orch(['handback', 'spec'], { input: say('spec', 'boundary_routed') }); orch(['approve', 'spec']); }],
    ['plan', () => { orch(['install', 'plan']); orch(['handback', 'plan'], { input: say('plan', 'boundary_routed') }); orch(['approve', 'plan', PLAN]); }],
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
      spec: { tk: 'RW', scope: ['docs/superpowers/specs/**'] },
      plan: { tk: 'RW', scope: ['docs/superpowers/plans/**'] },
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
    expect(orch(['approve', 'plan', PLAN]).status).toBe(0);
    expect(runFile().gate).toBe('define_approved');
    const again = orch(['approve', 'plan', PLAN]);
    expect(again.status).toBe(2);
    expect(again.err).toBe('orchestrate: approve plan: the next step is install code');
  });

  it('approving the spec records the approval and writes no gate', () => {
    driveTo('spec');
    orch(['install', 'spec']);
    orch(['handback', 'spec'], { input: say('spec', 'boundary_routed') });
    expect(orch(['approve', 'spec']).status).toBe(0);
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
    const r = orch(['approve', 'plan', PLAN]);
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
    expect(runFile()).toMatchObject({ v: 1, session_id: 'sess-1', item: 'FEAT-011', mode: 'step', band: 'boundary', gate: 'boundary_routed', halt: null });
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
    expect(r.out).toBe(`replaced the stale run FEAT-011 started ${started}`);
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
    expect(r.err).toBe(`ORCH_RUN_INVALID: ${join(root, RUN_FILE)} is unreadable or not a v1 run file; clear it with: node ${relative(root, SCRIPT)} end`);
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
    orch(['approve', 'spec']);
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
