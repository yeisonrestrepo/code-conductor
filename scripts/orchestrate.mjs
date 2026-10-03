#!/usr/bin/env node
// scripts/orchestrate.mjs
// The band router (FEAT-011). It builds, validates and installs SNAP v3 envelopes and
// records a run's position in a host-owned run file. It never edits a tracked file, and
// it is the only writer of the run file. Zero dependencies, node: builtins only.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { GATES, ROLE_BAND, V3_CAPS } from './snap-contract.mjs';
// Imported, not spawned: ticket.mjs holds the four import-safety conditions (FEAT-031 B1.7, T2).
import { TicketHalt, intake, writeSnapshot } from './ticket.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

export const RUN_FILE = '.claude/memory/orchestrator-run.json';
export const ENVELOPE_FILE = '.claude/memory/band-envelope.json';
// The orchestrator's whole write surface (D4). Guard 6 carries a copy pinned to this one.
export const WRITE_SURFACE = [RUN_FILE, ENVELOPE_FILE, '.claude/memory/session-snapshot.json', '.conductor/**'];
// Where /cc-orchestrate writes each agent's final message for `handback` to read: inside
// the surface, and cleared with the run so file names never collide across runs.
export const HANDBACK_DIR = '.conductor/handback';

// D5: the reviewed role-artifact table. Code's scope comes from its plan task instead.
export const ROLE_ARTIFACTS = {
  spec: { tk: 'RW', scope: ['docs/superpowers/specs/**'] },
  plan: { tk: 'RW', scope: ['docs/superpowers/plans/**'] },
  code: { tk: 'RW', scope: null },
  audit: { tk: 'R', scope: null },
  qa: { tk: 'X', scope: null },
};
// The router table's "may hand back" column.
export const MAY_HAND_BACK = {
  spec: ['boundary_routed'], plan: ['boundary_routed'], code: ['build_executed'],
  audit: ['build_executed'], qa: ['verify_pass'],
};
const PHASE = { spec: 'spec', plan: 'plan', code: 'impl', audit: 'rev', qa: 'rev' };
// Guard 7's chaining set (FEAT-012 D7). The hook carries a copy pinned to this one (D10).
export const SHELL_METACHARACTERS = [';', '&', '|', '`', '$(', '<', '>', '\n', '\r'];
// D6: each package manager's invocation of the owner's `test` script. `bun test` would run
// Bun's own test runner and ignore the script, so bun goes through `run`.
export const PM_TEST_COMMAND = { npm: 'npm test', pnpm: 'pnpm test', yarn: 'yarn test', bun: 'bun run test' };

// A halt stops the run and is recorded in it (D12). A refusal is a misuse of the CLI:
// nothing is written and nothing is recorded.
export class Halt extends Error {
  constructor(code, reason) { super(`${code}: ${reason}`); this.code = code; this.reason = reason; }
}
export class Refusal extends Error {}

const isPlainObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// The run root is the nearest ancestor of cwd holding the run file, the walk Guard 6
// makes; before a run exists, it is the nearest one holding .claude/.
export function findRunRoot(start) {
  for (const marker of [RUN_FILE, '.claude']) {
    for (let dir = resolve(start); ; dir = dirname(dir)) {
      if (existsSync(join(dir, marker))) return dir;
      if (dirname(dir) === dir) break;
    }
  }
  return resolve(start);
}

function writeAtomic(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

const scriptRef = (root) => relative(root, join(HERE, 'orchestrate.mjs')).split('\\').join('/');

export function isValidRun(run) {
  return isPlainObject(run) && run.v === 1 && typeof run.session_id === 'string' && run.session_id !== ''
    && typeof run.item === 'string' && GATES.includes(run.gate) && isPlainObject(run.approvals)
    && Array.isArray(run.handbacks) && Array.isArray(run.tasks?.ids) && Number.isInteger(run.tasks?.done);
}

function readRun(root) {
  const path = join(root, RUN_FILE);
  if (!existsSync(path)) return null;
  let run = null;
  try { run = JSON.parse(readFileSync(path, 'utf8')); } catch { /* judged below */ }
  if (!isValidRun(run)) {
    throw new Halt('ORCH_RUN_INVALID', `${path} is unreadable or not a v1 run file; clear it with: node ${scriptRef(root)} end`);
  }
  return run;
}

const saveRun = (root, run) => writeAtomic(join(root, RUN_FILE), JSON.stringify(run, null, 2) + '\n');

// Every verb but start and end drives a run that must exist, be this session's, and not be halted.
function liveRun(root, sessionId) {
  const run = readRun(root);
  if (!run) throw new Refusal(`no run file at ${join(root, RUN_FILE)}; start one first`);
  if (run.session_id !== sessionId) {
    throw new Refusal(`run ${run.item} belongs to another session; end it, or start to replace it`);
  }
  if (run.halt) throw new Refusal(`run ${run.item} halted with ${run.halt.code}; recover with end, then start (D12)`);
  return run;
}

const handedBack = (run, role) => run.handbacks.some((h) => h.role === role);

// The band sequence, read off the run's record.
export function nextStep(run) {
  if (!handedBack(run, 'spec')) return { role: 'spec' };
  if (!run.approvals.spec) return { await: 'spec' };
  if (!handedBack(run, 'plan')) return { role: 'plan' };
  if (!run.approvals.plan) return { await: 'plan' };
  if (run.tasks.done < run.tasks.ids.length) return { role: 'code', task: run.tasks.ids[run.tasks.done] };
  if (!handedBack(run, 'audit')) return { role: 'audit' };
  if (!handedBack(run, 'qa')) return { role: 'qa' };
  return { end: true };
}

const describeStep = (s) => (s.role ? `install ${s.role}` : s.await ? `approve ${s.await}` : 'end');

// D6: a gate crosses only a band boundary; inside a band the entry gate is re-issued.
export function forwardGate(run, role, gate) {
  if (role === 'code') return run.tasks.done + 1 === run.tasks.ids.length ? gate : run.gate;
  if (role === 'qa') return gate;
  return run.gate;
}

// writing-plans tasks: `### Task N` opens one; its **Files:** block lists the paths.
export function extractTasks(planText) {
  const tasks = [];
  let current = null;
  let inFiles = false;
  for (const line of planText.split(/\r?\n/)) {
    const head = line.match(/^### (Task \d+)\b/);
    if (head) { current = { id: head[1], files: [] }; tasks.push(current); inFiles = false; continue; }
    if (/^#{1,3} /.test(line)) { current = null; continue; }
    if (!current) continue;
    if (line.trim() === '**Files:**') { inFiles = true; continue; }
    const entry = inFiles && line.match(/^\s*- (?:Create|Modify|Test): (.*)$/);
    if (!entry) { inFiles = false; continue; }
    for (const m of entry[1].matchAll(/`([^`]+)`/g)) current.files.push(m[1].replace(/:\d+(-\d+)?$/, '').replace(/^\.\//, ''));
  }
  return tasks;
}

// D9: an empty scope is a plan defect, never a read-only fallback; scopes are never truncated.
export function taskScope(task, planRel) {
  if (task.files.length === 0) throw new Halt('ORCH_EMPTY_SCOPE', `${task.id} declares no files`);
  const scope = [...new Set([...task.files, planRel])];
  const [cap, elemCap] = V3_CAPS['ops.scope'];
  if (scope.length > cap) throw new Halt('ORCH_SCOPE_OVER_CAP', `${task.id} needs ${scope.length} scope entries; the cap is ${cap}`);
  const long = scope.find((p) => p.length > elemCap);
  if (long) throw new Halt('ORCH_SCOPE_OVER_CAP', `${task.id} has a ${long.length}-character path; the cap is ${elemCap}`);
  return scope;
}

function readPlan(root, planRel) {
  if (!planRel || isAbsolute(planRel) || planRel.split(/[\\/]/).includes('..')) {
    throw new Refusal('usage: orchestrate.mjs approve plan <plan path relative to the run root>');
  }
  try { return readFileSync(join(root, planRel), 'utf8'); } catch { throw new Refusal(`cannot read ${planRel}`); }
}

// ORCH_AGENT_MISSING's search. Plugin-provided agents are not searched, a stated limit.
export function findAgent(role, root, home = homedir()) {
  for (const dir of [join(root, '.claude', 'agents'), join(home, '.claude', 'agents')]) {
    let names = [];
    try { names = readdirSync(dir).filter((n) => n.endsWith('.md')); } catch { continue; }
    for (const n of names) {
      const front = readFileSync(join(dir, n), 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (front && new RegExp(`^name:[ \\t]*${role}[ \\t]*$`, 'm').test(front[1])) return join(dir, n);
    }
  }
  return null;
}

function runScript(name, args, input = '') {
  const r = spawnSync(process.execPath, [join(HERE, name), ...args], { input, encoding: 'utf8' });
  return { status: r.status, out: r.stdout, err: (r.stderr || '').trim() };
}

// detect-stack installs process-wide error handlers when imported, so it is spawned. It prints
// {} on any failure, which answers nothing either way.
function detectStack(root) {
  let out = null;
  try { out = JSON.parse(runScript('detect-stack.mjs', [root]).out); } catch { /* judged below */ }
  if (isPlainObject(out) && Object.keys(out).length > 0) return out;
  throw new Halt('ORCH_TEST_COMMAND_UNRESOLVED', `detect-stack returned no result for ${root}`);
}

// Only a non-blank string is the owner's test script.
function hasTestScript(pkgPath) {
  let pkg;
  try { pkg = JSON.parse(readFileSync(pkgPath, 'utf8').replace(/^\uFEFF/, '')); } catch {
    throw new Halt('ORCH_TEST_COMMAND_UNRESOLVED', `${pkgPath} does not parse, so its test script cannot be read`);
  }
  const script = pkg?.scripts?.test;
  return typeof script === 'string' && script.trim() !== '';
}

// D6: the one command code and qa may run, resolved before anything is recorded. The script
// is checked before detect-stack runs, because a non-string script makes detect-stack fail
// whole and the halt would then name the wrong cause.
export function resolveTestCommand(root) {
  const pkgPath = join(root, 'package.json');
  if (existsSync(pkgPath)) {
    if (!hasTestScript(pkgPath)) {
      throw new Halt('ORCH_TEST_COMMAND_UNRESOLVED', 'package.json has no scripts.test; add a test script, the run does not guess a runner');
    }
    return PM_TEST_COMMAND[detectStack(root).packageManager] ?? PM_TEST_COMMAND.npm;
  }
  const { test } = detectStack(root);
  if (typeof test === 'string' && test.trim() !== '') return test;
  throw new Halt('ORCH_TEST_COMMAND_UNRESOLVED', `detect-stack names no test command for ${root}`);
}

// D7: no command is recorded that Guard 7 would not pass.
export function checkTestCommand(command) {
  const found = SHELL_METACHARACTERS.find((m) => command.includes(m));
  if (found === undefined) return command;
  throw new Halt('ORCH_TEST_COMMAND_UNSAFE', `${JSON.stringify(command)} contains ${JSON.stringify(found)}, which Guard 7 denies; nothing was recorded`);
}

// The validator reads a file, so the candidate goes through a private temp dir. Returns
// the validator's error text, or '' when it passes.
function validate(text, role) {
  const dir = mkdtempSync(join(tmpdir(), 'cc-orch-'));
  try {
    writeFileSync(join(dir, 'snap.json'), text);
    const r = runScript('snap-validate.mjs', [join(dir, 'snap.json'), ...(role ? ['--to', role] : [])]);
    return r.status === 0 ? '' : r.err || `snap-validate exited ${r.status}`;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

function gitValue(root, args, fallback) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return (r.status === 0 && r.stdout.trim()) || fallback;
}

function envelopeFields(run, root, step) {
  const head = gitValue(root, ['rev-parse', 'HEAD'], '0000000').toLowerCase();
  const { tk, scope } = ROLE_ARTIFACTS[step.role];
  const fields = {
    ph: PHASE[step.role], c: /^[0-9a-f]{7,40}$/.test(head) ? head : '0000000', s: run.item,
    n: [], f: [], d: [], x: [], role: step.role, tk, gate: run.gate,
  };
  if (step.role === 'code') {
    const task = extractTasks(readPlan(root, run.plan)).find((t) => t.id === step.task);
    fields.scope = taskScope(task ?? { id: step.task, files: [] }, run.plan);
  } else if (scope) fields.scope = scope;
  // Ruling 2: ticket identity rides the spec envelope only, never its content.
  if (step.role === 'spec' && run.ticket) {
    const { repo, number, url, sha256 } = run.ticket;
    fields.p = { ticket: { repo, number, url, sha256 } };
  }
  return fields;
}

// Builds and validates the next envelope with --to; installs it unless only checking.
function install(root, sessionId, role, check) {
  const run = liveRun(root, sessionId);
  const step = nextStep(run);
  if (step.role !== role) throw new Refusal(`install ${role}: the next step is ${describeStep(step)}`);
  if (!findAgent(role, root)) {
    throw new Halt('ORCH_AGENT_MISSING', `no agent definition named ${role} in .claude/agents/ or ~/.claude/agents/`);
  }
  const built = runScript('snap-build.mjs', [], JSON.stringify(envelopeFields(run, root, step)));
  if (built.status !== 0) throw new Halt('SNAP_ERROR', built.err);
  const error = validate(built.out, role);
  if (error) throw new Halt(error.includes('SNAP_GATE_MISMATCH') ? 'SNAP_GATE_MISMATCH' : 'SNAP_ERROR', error);
  if (check) return built.out.trim();
  writeAtomic(join(root, ENVELOPE_FILE), built.out);
  saveRun(root, { ...run, band: ROLE_BAND[role], role });
  return built.out.trim();
}

export function recordHandback(run, role, gate) {
  const entry = { role, gate, at: new Date().toISOString(), ...(role === 'code' ? { task: run.tasks.ids[run.tasks.done] } : {}) };
  const tasks = role === 'code' ? { ...run.tasks, done: run.tasks.done + 1 } : run.tasks;
  return { ...run, role: null, gate: forwardGate(run, role, gate), tasks, handbacks: [...run.handbacks, entry] };
}

function parseHandback(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith('SNAP_HANDBACK '));
  if (lines.length !== 1) throw new Halt('ORCH_HANDBACK_MISSING', `expected exactly one SNAP_HANDBACK line, found ${lines.length}`);
  const json = lines[0].slice('SNAP_HANDBACK '.length).trim();
  const error = validate(json + '\n');
  if (error) throw new Halt('ORCH_HANDBACK_INVALID', error);
  const env = JSON.parse(json);
  if (env.v !== 3) throw new Halt('ORCH_HANDBACK_INVALID', `a hand-back must be a v3 envelope, got v${env.v}`);
  return env;
}

function handback(root, sessionId, role, text) {
  const run = liveRun(root, sessionId);
  // The binary refuses a second SubagentHandback, yet an agent can still report again (V1, F4).
  if (!run.role && run.handbacks.at(-1)?.role === role) {
    throw new Halt('ORCH_HANDBACK_CONFLICT', `${role} already handed back for this position; a second report is not routed`);
  }
  if (!run.role || run.role !== role) throw new Refusal(`handback ${role}: the dispatched role is ${run.role ?? 'none'}`);
  const env = parseHandback(text);
  if (env.sys.role !== role) throw new Halt('ORCH_HANDBACK_ROLE_MISMATCH', `dispatched ${role}, the hand-back names ${env.sys.role}`);
  if (!MAY_HAND_BACK[role].includes(env.ops.gate)) {
    throw new Halt('ORCH_GATE_UNEARNED', `${role} may hand back ${MAY_HAND_BACK[role].join('|')}, not ${env.ops.gate}`);
  }
  saveRun(root, recordHandback(run, role, env.ops.gate));
  return `${role} handed back ${env.ops.gate}`;
}

// Two human approvals, one gate write (A4): only an approved plan writes define_approved.
function approve(root, sessionId, what, planRel) {
  const run = liveRun(root, sessionId);
  const step = nextStep(run);
  if (step.await !== what) throw new Refusal(`approve ${what}: the next step is ${describeStep(step)}`);
  const approval = { at: new Date().toISOString(), by: gitValue(root, ['config', 'user.name'], 'unknown') };
  if (what === 'spec') {
    saveRun(root, { ...run, approvals: { ...run.approvals, spec: approval } });
    return 'spec approved';
  }
  const tasks = extractTasks(readPlan(root, planRel));
  if (tasks.length === 0) throw new Halt('ORCH_EMPTY_SCOPE', `${planRel} holds no "### Task N" section`);
  for (const t of tasks) taskScope(t, planRel);
  saveRun(root, {
    ...run, gate: 'define_approved', plan: planRel, tasks: { ids: tasks.map((t) => t.id), done: 0 },
    approvals: { ...run.approvals, plan: approval },
  });
  return `plan approved: define_approved, ${tasks.length} task(s)`;
}

const START_USAGE = 'usage: orchestrate.mjs start <ITEM> [--auto] [--ticket <N|issue URL>]';

// The item first, then --auto and --ticket <ref> in either order, each at most once. A
// --ticket with no value reaches intake as '' and halts there (FEAT-031 B1.1).
function parseStartArgs(args) {
  const [item, ...rest] = args;
  const opts = { item, auto: false, ticket: undefined };
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--auto' && !opts.auto) opts.auto = true;
    else if (rest[i] === '--ticket' && opts.ticket === undefined) opts.ticket = rest[++i] ?? '';
    else throw new Refusal(START_USAGE);
  }
  if (!/^[A-Z]+-\d{3,}$/.test(item ?? '')) throw new Refusal(START_USAGE);
  return opts;
}

// Intake's halts keep ticket.mjs's codes and become the router's own start halts.
function ticketIntake(root, item, ref) {
  try { return intake(root, item, ref); } catch (e) {
    if (e instanceof TicketHalt) throw new Halt(e.code, e.reason);
    throw e;
  }
}

const ticketNote = (t) => `ticket ${t.binding.repo}#${t.binding.number} "${t.title}"; snapshot ${t.path} sha256 ${t.binding.sha256}; `;

function start(root, sessionId, args) {
  const { item, auto, ticket } = parseStartArgs(args);
  if (!sessionId) throw new Halt('ORCH_NO_SESSION_ID', 'CLAUDE_CODE_SESSION_ID is absent or empty, so Guard 6 could never bind this run');
  const old = readRun(root);
  if (old && old.session_id === sessionId) throw new Halt('ORCH_RUN_ACTIVE', `run ${old.item} is live in this session; end it first`);
  // Resolved before a stale run is cleared, so a halt here leaves everything as it was.
  const testCommand = checkTestCommand(resolveTestCommand(root));
  const bound = ticket === undefined ? null : ticketIntake(root, item, ticket);
  if (old) clearRunFiles(root);
  if (bound) writeSnapshot(root, bound.path, bound.text);
  saveRun(root, {
    v: 1, session_id: sessionId, item, mode: auto ? 'auto' : 'step', started: new Date().toISOString(),
    band: 'boundary', role: null, gate: 'boundary_routed', approvals: { spec: null, plan: null },
    plan: null, tasks: { ids: [], done: 0 }, handbacks: [], halt: null, test_command: testCommand,
    ...(bound ? { ticket: { ...bound.binding, snapshot: bound.path } } : {}),
  });
  const begun = old ? `replaced the stale run ${old.item} started ${old.started}` : `run ${item} started`;
  return `${begun}; ${bound ? ticketNote(bound) : ''}test command: ${testCommand}`;
}

function clearRunFiles(root) {
  rmSync(join(root, ENVELOPE_FILE), { force: true });
  rmSync(join(root, HANDBACK_DIR), { recursive: true, force: true });
}

// Prints the run it removes, so the closing report reads the record rather than memory.
function end(root) {
  const path = join(root, RUN_FILE);
  const text = existsSync(path) ? readFileSync(path, 'utf8').trim() : 'no run file';
  rmSync(path, { force: true });
  clearRunFiles(root);
  return text;
}

function recordHalt(root, halt) {
  try {
    const run = readRun(root);
    if (run && !run.halt) saveRun(root, { ...run, halt: { code: halt.code, reason: halt.reason, at: new Date().toISOString() } });
  } catch { /* an unreadable run file cannot carry its own halt */ }
}

export function cli(argv, env, cwd = process.cwd()) {
  const [verb, a, b] = argv;
  const root = findRunRoot(cwd);
  const sid = env.CLAUDE_CODE_SESSION_ID;
  const verbs = {
    start: () => start(root, sid, argv.slice(1)),
    install: () => install(root, sid, a, b === '--check'),
    handback: () => handback(root, sid, a, readFileSync(0, 'utf8')),
    approve: () => approve(root, sid, a, b),
    end: () => end(root),
  };
  try {
    if (!verbs[verb]) throw new Refusal('usage: orchestrate.mjs start|install|handback|approve|end');
    process.stdout.write(verbs[verb]() + '\n');
    return 0;
  } catch (e) {
    if (e instanceof Refusal) { process.stderr.write(`orchestrate: ${e.message}\n`); return 2; }
    if (!(e instanceof Halt)) throw e;
    if (verb !== 'start') recordHalt(root, e);
    process.stderr.write(`${e.code}: ${e.reason}\n`);
    return 1;
  }
}

const invoked = process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;
if (invoked) process.exitCode = cli(process.argv.slice(2), process.env);
