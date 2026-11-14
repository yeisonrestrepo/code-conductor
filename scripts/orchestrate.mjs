#!/usr/bin/env node
// scripts/orchestrate.mjs
// The band router (FEAT-011). It builds, validates and installs SNAP v3 envelopes and
// records a run's position in a host-owned run file. It never edits a tracked file, and
// it is the only writer of the run file. Zero dependencies, node: builtins only.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { GATES, ROLE_BAND, V3_CAPS, elementLength, expectedGate } from './snap-contract.mjs';
// Imported, not spawned: ticket.mjs holds the four import-safety conditions (FEAT-031 B1.7, T2).
import { TicketHalt, intake, writeSnapshot } from './ticket.mjs';
import { DocLocationError, resolveDocLocations } from './doc-locations.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

export const RUN_FILE = '.claude/memory/orchestrator-run.json';
export const ENVELOPE_FILE = '.claude/memory/band-envelope.json';
// The orchestrator's whole write surface (D4). Guard 6 carries a copy pinned to this one.
export const WRITE_SURFACE = [RUN_FILE, ENVELOPE_FILE, '.claude/memory/session-snapshot.json', '.conductor/**'];
// Where /cc-orchestrate writes each agent's final message for `handback` to read: inside
// the surface, and cleared with the run so file names never collide across runs.
export const HANDBACK_DIR = '.conductor/handback';
// FEAT-059 C5, C7: owner-only; outside the hand-back directory so it outlives end.
const OWNER_FILE = '.conductor/security-pre-existing.txt';
// FEAT-041: the Define review loop's reports, cleared with the run like the hand-backs.
export const REVIEW_DIR = '.conductor/review';
// Three reviewer passes, so at most two revisions, each re-reviewed (FEAT-041 (d)).
export const REVIEW_CAP = 3;
// FEAT-057: fix rounds per run, fixed at start so the orchestrator's prompt cannot change the cap.
export const AUDIT_ROUNDS_DEFAULT = 2;
const AUDIT_ROUNDS_MAX = 5;
const isAuditRounds = (n) => Number.isInteger(n) && n >= 0 && n <= AUDIT_ROUNDS_MAX;
// Every outcome a closed loop can carry; only the skip is the orchestrator's to record (FEAT-058).
const REVIEW_OUTCOME = /^(clean|cap|unchanged|skipped:[a-z][a-z0-9-]{0,39})$/;
const SKIP_OUTCOME = /^skipped:[a-z][a-z0-9-]{0,39}$/;
const REVIEW_ROW = /^- \[(AC|FMT|CR)\]/;
const REVIEW_USAGE = 'usage: orchestrate.mjs review <spec|plan> --round <doc> | --record | --close skipped:<reason>';

// D5: the reviewed role-artifact table. Code's scope comes from its plan task instead.
// Spec and plan scopes come from run.docs, pinned at start, so no folder is named here (FEAT-047).
export const ROLE_ARTIFACTS = {
  spec: { tk: 'RW', scope: null },
  plan: { tk: 'RW', scope: null },
  code: { tk: 'RW', scope: null },
  audit: { tk: 'R', scope: null },
  qa: { tk: 'X', scope: null },
  security: { tk: 'X', scope: null },
};
// The router table's "may hand back" column.
export const MAY_HAND_BACK = {
  spec: ['boundary_routed'], plan: ['boundary_routed'], code: ['build_executed'],
  audit: ['build_executed'], qa: ['verify_pass'], security: ['build_executed'],
};
const PHASE = { spec: 'spec', plan: 'plan', code: 'impl', audit: 'rev', qa: 'rev', security: 'rev' };
// Guard 7's chaining set (FEAT-012 D7). The hook carries a copy pinned to this one (D10).
export const SHELL_METACHARACTERS = [';', '&', '|', '`', '$(', '<', '>', '\n', '\r'];
// D6: each package manager's invocation of the owner's `test` script. `bun test` would run
// Bun's own test runner and ignore the script, so bun goes through `run`.
export const PM_TEST_COMMAND = { npm: 'npm test', pnpm: 'pnpm test', yarn: 'yarn test', bun: 'bun run test' };
// FEAT-034 C7: only npm and pnpm ship an audit with a stable --json; every other case is not covered, never guessed.
export const PM_AUDIT_COMMAND = { npm: 'npm audit --json', pnpm: 'pnpm audit --json' };
export const SECURITY_LEVELS = ['low', 'moderate', 'high', 'critical'];
const SECURITY_THRESHOLD_DEFAULT = 'high';
const DEPENDENCY_STATES = ['audit', 'not-covered', 'disabled'];
const OBJECT_NAME = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
export const SECURITY_NOT_CONFIGURED = 'not-configured (run predates FEAT-034)';

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

// FEAT-034 C13: an absent key is a run from before the seat; a present one that is malformed is a hand edit.
function isSecurity(s) {
  if (!isPlainObject(s) || !SECURITY_LEVELS.includes(s.threshold) || !DEPENDENCY_STATES.includes(s.dependency)) return false;
  const hasAudit = typeof s.audit_command === 'string' && s.audit_command !== '';
  if (s.audit_command !== null && !hasAudit) return false;
  if (hasAudit !== (s.dependency === 'audit')) return false;
  if (s.base !== null && !OBJECT_NAME.test(s.base ?? '')) return false;
  // FEAT-059 C16: a scan command without the threshold suffix was written by FEAT-034, whose entries carry no verdict.
  return typeof s.scan_command === 'string' && s.scan_command.endsWith(` ${s.threshold}`);
}

// FEAT-057: a present audit_rounds that is not 0-5 would let a hand-edited run buy fix rounds without limit.
export function isValidRun(run) {
  return isPlainObject(run) && run.v === 1 && typeof run.session_id === 'string' && run.session_id !== ''
    && typeof run.item === 'string' && GATES.includes(run.gate) && isPlainObject(run.approvals)
    && Array.isArray(run.handbacks) && Array.isArray(run.tasks?.ids) && Number.isInteger(run.tasks?.done)
    && (run.audit_rounds === undefined || isAuditRounds(run.audit_rounds))
    && (run.security === undefined || isSecurity(run.security));
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

// FEAT-057: a fix is due exactly when the last hand-back is an audit the script granted one.
const fixDue = (run) => { const last = run.handbacks.at(-1); return last?.role === 'audit' && isPlainObject(last.fix) ? last.fix : null; };

// The band sequence, read off the run's record.
export function nextStep(run) {
  if (!handedBack(run, 'spec')) return { role: 'spec' };
  if (!run.approvals.spec) return { await: 'spec' };
  if (!handedBack(run, 'plan')) return { role: 'plan' };
  if (!run.approvals.plan) return { await: 'plan' };
  if (run.tasks.done < run.tasks.ids.length) return { role: 'code', task: run.tasks.ids[run.tasks.done] };
  const fix = fixDue(run);
  if (fix) return { role: 'code', fix: fix.round };
  const last = run.handbacks.at(-1)?.role;
  if (last === 'audit') return { role: isPlainObject(run.security) ? 'security' : 'qa' };
  // Only an approving verdict routes to qa (FEAT-059); a blocked or failed seat never does, and the halt already names end (FEAT-034).
  if (last === 'security') return run.handbacks.at(-1).security?.verdict === 'APPROVE' ? { role: 'qa' } : { end: true };
  if (last === 'qa') return { end: true };
  return { role: 'audit' };
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
  const long = scope.find((p) => elementLength(p) > elemCap);
  if (long) throw new Halt('ORCH_SCOPE_OVER_CAP', `${task.id} has a ${elementLength(long)}-character path; the cap is ${elemCap}`);
  return scope;
}

// FEAT-057: the audit text is not owner-approved, so it may name only files the approved plan's tasks
// declare, never the approved documents themselves (owner decision, 2026-11-13).
function fixScope(root, run, files, round) {
  const planned = new Set(extractTasks(readDoc(root, run.plan, `cannot read ${run.plan}`).toString('utf8')).flatMap((t) => t.files));
  const approved = [run.plan, run.approvals.spec?.path];
  const outside = files.find((p) => typeof p !== 'string' || !planned.has(p) || approved.includes(p));
  if (outside !== undefined) throw new Halt('ORCH_FIX_SCOPE_UNAPPROVED', `${outside} is not a file the approved plan declares; the fix scope stays inside the plan`);
  return taskScope({ id: `fix round ${round}`, files }, run.plan);
}

// FEAT-047: one glob per role, checked against the element cap once, at start.
export function docScopes({ specs, plans, group }) {
  const elemCap = V3_CAPS['ops.scope'][1];
  const scopes = {};
  for (const [role, dir] of [['spec', specs], ['plan', plans]]) {
    const glob = `${dir}${group ? `/${group}` : ''}/**`;
    if (glob.length > elemCap) {
      throw new Halt('ORCH_SCOPE_OVER_CAP', `${role} scope is ${glob.length} characters; the cap is ${elemCap}; shorten the folder`);
    }
    scopes[role] = [glob];
  }
  return scopes;
}

// The resolver's halts keep its code and become the router's own start halts.
function resolveDocs(root, item) {
  try {
    const docs = resolveDocLocations(root, item);
    return { ...docs, scopes: docScopes(docs) };
  } catch (e) {
    if (e instanceof DocLocationError) throw new Halt(e.code, e.reason);
    throw e;
  }
}

const docsNote = (d) => `docs: specs ${d.specs}, plans ${d.plans} (${d.source})${d.group ? `; group ${d.group}` : ''}; `;

const DOC_PATH = '<path relative to the run root>';
const APPROVE_USAGE = `usage: orchestrate.mjs approve <spec|plan> ${DOC_PATH} <sha256>`;
const HASH_USAGE = `usage: orchestrate.mjs hash <spec|plan> ${DOC_PATH}`;
const SHA256_HEX = /^[0-9a-f]{64}$/i;
// FEAT-056: progress ticks are not text changes, so only a list item's leading box reads as [ ].
const PLAN_CHECKBOX = /^(\s*(?:[-*+]|\d+[.)])\s+)\[[ xX>!]\](?=\s|$)/;

// One definition for hash, approve and the Build check. Applied per line, so \s never spans two lines.
export function documentHash(kind, content) {
  const text = kind === 'plan' ? String(content).split('\n').map((l) => l.replace(PLAN_CHECKBOX, '$1[ ]')).join('\n') : content;
  return createHash('sha256').update(text).digest('hex');
}

// Raw bytes, so a spec hashes exactly as sha256sum does.
function readDoc(root, rel, usage) {
  if (!rel || isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) throw new Refusal(usage);
  try { return readFileSync(join(root, rel)); } catch { throw new Refusal(`cannot read ${rel}`); }
}

// Read-only and run-free: prints the exact value approve checks, so the hash shown is the script's own.
function hashDoc(root, kind, rel) {
  if (kind !== 'spec' && kind !== 'plan') throw new Refusal(HASH_USAGE);
  return `${documentHash(kind, readDoc(root, rel, HASH_USAGE))}  ${rel}`;
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
// is checked before detect-stack runs, because detect-stack drops a non-string script and may
// offer its own default runner, which the run must not take in place of the owner's script.
export function resolveTestCommand(root, detect = () => detectStack(root)) {
  const pkgPath = join(root, 'package.json');
  if (existsSync(pkgPath)) {
    if (!hasTestScript(pkgPath)) {
      throw new Halt('ORCH_TEST_COMMAND_UNRESOLVED', 'package.json has no scripts.test; add a test script, the run does not guess a runner');
    }
    return PM_TEST_COMMAND[detect().packageManager] ?? PM_TEST_COMMAND.npm;
  }
  const { test } = detect();
  if (typeof test === 'string' && test.trim() !== '') return test;
  throw new Halt('ORCH_TEST_COMMAND_UNRESOLVED', `detect-stack names no test command for ${root}`);
}

// D7: no command is recorded that Guard 7 would not pass.
function checkShellCommand(command, code) {
  const found = SHELL_METACHARACTERS.find((m) => command.includes(m));
  if (found === undefined) return command;
  throw new Halt(code, `${JSON.stringify(command)} contains ${JSON.stringify(found)}, which Guard 7 denies; nothing was recorded`);
}
export const checkTestCommand = (command) => checkShellCommand(command, 'ORCH_TEST_COMMAND_UNSAFE');
export const checkSecurityCommand = (command) => checkShellCommand(command, 'ORCH_SECURITY_COMMAND_UNSAFE');

const scanRef = (root) => relative(root, join(HERE, 'security-scan.mjs')).split('\\').join('/');

// FEAT-034: what the security seat will run, fixed at start so Guard 7 and the router read one record.
function resolveSecurity(root, stack, { threshold, dependencyAudit }) {
  const head = gitValue(root, ['rev-parse', 'HEAD'], '');
  const base = OBJECT_NAME.test(head) ? head : null;
  const auditCommand = dependencyAudit ? PM_AUDIT_COMMAND[stack.packageManager] ?? null : null;
  const dependency = !dependencyAudit ? 'disabled' : auditCommand ? 'audit' : 'not-covered';
  // C14: the scanner writes complete lines, severity included; 'none' keeps a fixed arity outside git (plan decisions).
  const scanCommand = `node ${scanRef(root)} ${base ?? 'none'} ${threshold}`;
  if (auditCommand) checkSecurityCommand(auditCommand);
  checkSecurityCommand(scanCommand);
  return { threshold, dependency, base, audit_command: auditCommand, scan_command: scanCommand };
}

function securityNote(s, root, stack) {
  const scan = s.audit_command
    ?? (s.dependency === 'disabled' ? 'disabled (--no-dependency-audit)'
      : `not covered for ${stack.packageManager ?? (existsSync(join(root, 'package.json')) ? 'no lockfile' : 'this stack')}`);
  return `; security: threshold ${s.threshold}, dependency scan ${scan}`;
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

// A fix step's files come from the record, re-checked against the plan because the run file is writable.
function codeScope(root, run, step) {
  if (step.fix !== undefined) { const { files } = fixDue(run); return fixScope(root, run, Array.isArray(files) ? files : [], step.fix); }
  const task = extractTasks(readDoc(root, run.plan, `cannot read ${run.plan}`).toString('utf8')).find((t) => t.id === step.task);
  return taskScope(task ?? { id: step.task, files: [] }, run.plan);
}

function envelopeFields(run, root, step) {
  const head = gitValue(root, ['rev-parse', 'HEAD'], '0000000').toLowerCase();
  const { tk, scope } = ROLE_ARTIFACTS[step.role];
  const fields = {
    ph: PHASE[step.role], c: /^[0-9a-f]{7,40}$/.test(head) ? head : '0000000', s: run.item,
    // A fix re-enters Build, so it carries Build's entry gate, the one --to code checks (D6).
    n: [], f: [], d: [], x: [], role: step.role, tk, gate: step.fix === undefined ? run.gate : expectedGate('code'),
  };
  if (step.role === 'code') fields.scope = codeScope(root, run, step);
  else if (step.role === 'spec' || step.role === 'plan') {
    // Read as pinned, never re-checked: the cap was enforced once, at start.
    if (!isPlainObject(run.docs?.scopes) || !Array.isArray(run.docs.scopes[step.role])) {
      throw new Halt('ORCH_DOC_LOCATION_UNRESOLVED', `run ${run.item} records no docs location (started before FEAT-047); run end, then start`);
    }
    fields.scope = run.docs.scopes[step.role];
  } else if (scope) fields.scope = scope;
  // Ruling 2: ticket identity rides the spec envelope only, never its content.
  if (step.role === 'spec' && run.ticket) {
    const { repo, number, url, sha256 } = run.ticket;
    fields.p = { ticket: { repo, number, url, sha256 } };
  }
  return fields;
}

const currentHash = (root, kind, rel) => { try { return documentHash(kind, readFileSync(join(root, rel))); } catch { return null; } };

// FEAT-056: after define_approved, a changed spec or plan means the run would execute text nobody approved.
function checkApprovedDocs(root, run) {
  for (const kind of ['spec', 'plan']) {
    const { path, sha256 } = run.approvals[kind] ?? {};
    if (typeof path !== 'string' || typeof sha256 !== 'string') {
      throw new Halt('ORCH_APPROVAL_UNHASHED', `run ${run.item} records an approval without a document hash (started before FEAT-056); run end, then start`);
    }
    const now = currentHash(root, kind, path);
    if (now === sha256) continue;
    throw new Halt('ORCH_APPROVED_DOC_CHANGED', `${kind} ${path} was approved at sha256 ${sha256} and ${now ? `now hashes ${now}` : 'can no longer be read'}`);
  }
}

const fixNote = (run) => { const f = fixDue(run); return `fix round ${f.round} of ${run.audit_rounds ?? 0}: review ${f.review} sha256 ${f.sha256}`; };

// Builds and validates the next envelope with --to; installs it unless only checking.
function install(root, sessionId, role, check) {
  const run = liveRun(root, sessionId);
  const step = nextStep(run);
  if (step.role !== role) throw new Refusal(`install ${role}: the next step is ${describeStep(step)}`);
  if (run.approvals.plan) checkApprovedDocs(root, run);
  if (!findAgent(role, root)) {
    throw new Halt('ORCH_AGENT_MISSING', `no agent definition named ${role} in .claude/agents/ or ~/.claude/agents/`);
  }
  const built = runScript('snap-build.mjs', [], JSON.stringify(envelopeFields(run, root, step)));
  if (built.status !== 0) throw new Halt('SNAP_ERROR', built.err);
  const error = validate(built.out, role);
  if (error) throw new Halt(error.includes('SNAP_GATE_MISMATCH') ? 'SNAP_GATE_MISMATCH' : 'SNAP_ERROR', error);
  const out = built.out.trim() + (step.fix === undefined ? '' : `\n${fixNote(run)}`);
  if (check) return out;
  writeAtomic(join(root, ENVELOPE_FILE), built.out);
  saveRun(root, { ...run, band: ROLE_BAND[role], role });
  return out;
}

// FEAT-060: the second line behind the halt; verify_pass is forwarded only over an approving audit.
// FEAT-057: the last audit, since an earlier RETURN stays in the record forever.
function withholdUnlessApproved(run) {
  const verdict = run.handbacks.findLast((h) => h.role === 'audit')?.verdict;
  if (verdict !== 'APPROVE') throw new Halt('ORCH_GATE_WITHHELD', `qa may not forward verify_pass: the audit verdict is ${verdict ?? 'absent'}`);
  if (!isPlainObject(run.security)) return;
  const seatVerdict = run.handbacks.findLast((h) => h.role === 'security')?.security?.verdict;
  if (seatVerdict !== 'APPROVE') throw new Halt('ORCH_GATE_WITHHELD', `qa may not forward verify_pass: the security verdict is ${seatVerdict ?? 'absent'}`);
}

// FEAT-057: a fix re-enters Build with no task, so it never advances tasks.done; audits carry their round.
function entryFields(run, role) {
  const fix = role === 'code' ? fixDue(run) : null;
  if (fix) return { fix: fix.round };
  if (role === 'code') return { task: run.tasks.ids[run.tasks.done] };
  if (role === 'audit') return { round: run.handbacks.filter((h) => h.role === 'audit').length + 1 };
  // FEAT-034 C13: a run from before the seat records that the qa gate was not covered by it.
  if (role === 'qa' && !isPlainObject(run.security)) return { security: SECURITY_NOT_CONFIGURED };
  return {};
}

export function recordHandback(run, role, gate, verdict, extra = {}) {
  if (role === 'qa' && gate === 'verify_pass') withholdUnlessApproved(run);
  const fields = entryFields(run, role);
  const entry = { role, gate, at: new Date().toISOString(), ...fields, ...(verdict ? { verdict } : {}), ...extra };
  const tasks = role === 'code' && !('fix' in fields) ? { ...run.tasks, done: run.tasks.done + 1 } : run.tasks;
  return { ...run, role: null, gate: forwardGate(run, role, gate), tasks, handbacks: [...run.handbacks, entry] };
}

function parseHandback(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith('SNAP_HANDBACK '));
  if (lines.length !== 1) throw new Halt('ORCH_HANDBACK_MISSING', `expected exactly one SNAP_HANDBACK line, found ${lines.length}`);
  const json = lines[0].slice('SNAP_HANDBACK '.length).trim();
  const error = validate(json + '\n');
  if (error) throw new Halt('ORCH_HANDBACK_INVALID', error);
  const env = JSON.parse(json);
  if (env.v !== 3 && env.v !== 4) throw new Halt('ORCH_HANDBACK_INVALID', `a hand-back must be a v3 or v4 envelope, got v${env.v}`);
  return env;
}

function auditStop({ verdict, blockers }, round, cap) {
  const report = `${HANDBACK_DIR}/audit-${round}.txt`;
  if (verdict === 'RETURN') return new Halt('ORCH_AUDIT_RETURN', `audit returned the change with ${blockers} blocker/major finding(s) at round ${round}; the cap of ${cap} fix round(s) is spent; see ${report}`);
  return new Halt('ORCH_AUDIT_ESCALATE', `audit escalated a decision only the owner takes; see ${report}`);
}

// FEAT-057: the cap is read from the run file, never from the orchestrator, so its prompt cannot buy a round (E2).
// Every halt here lands on top of the audit entry handback already saved.
function auditFix(root, run, verdict, bytes) {
  const entry = run.handbacks.at(-1);
  const cap = run.audit_rounds ?? 0;
  const used = run.handbacks.filter((h) => h.role === 'audit' && isPlainObject(h.fix)).length;
  if (verdict.verdict === 'ESCALATE' || used >= cap) throw auditStop(verdict, entry.round, cap);
  checkApprovedDocs(root, run);
  const fix = { round: used + 1, files: verdict.paths, review: `${HANDBACK_DIR}/audit-${entry.round}.txt`, sha256: createHash('sha256').update(bytes).digest('hex') };
  const scope = fixScope(root, run, fix.files, fix.round);
  saveRun(root, { ...run, handbacks: [...run.handbacks.slice(0, -1), { ...entry, fix }] });
  return `audit round ${entry.round}: RETURN with ${verdict.blockers} blocker/major finding(s); fix round ${fix.round} of ${cap}: review ${fix.review} sha256 ${fix.sha256}; scope ${scope.join(', ')}`;
}

// FEAT-060: a candidate is wider than the valid form, so a near-miss halts by name instead of passing unseen.
const VERDICT_CANDIDATE = /^verdict\s*:/i;
const VERDICT_LINE = /^VERDICT: (APPROVE|RETURN|ESCALATE)$/;
const FINDING_LINE = /^- \[(blocker|major|minor)\] (\S+:\d+) /;
const QUOTE_CAP = 120;

const severeFindings = (lines) => lines.map((l) => FINDING_LINE.exec(l)).filter((m) => m && m[1] !== 'minor');
// FEAT-057: extractTasks' normalization, widened to every trailing :line or :line:col group.
const findingPath = (field) => field.replace(/(:\d+)+$/, '').replace(/^\.\//, '');

// ESCALATE carries no count rule: its cause can be an owner decision with no code defect.
function checkConsistent(verdict, blockers, paths) {
  if ((verdict === 'APPROVE' && blockers > 0) || (verdict === 'RETURN' && blockers === 0)) {
    throw new Halt('ORCH_VERDICT_INCONSISTENT', `VERDICT: ${verdict} with ${blockers} blocker/major finding(s)`);
  }
  return { verdict, blockers, paths };
}

// FEAT-059 C10: one parser for both Verify roles; the role only names the report in the missing-line reason.
export function parseVerdict(text, role = 'audit') {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const candidates = lines.filter((l) => VERDICT_CANDIDATE.test(l));
  if (candidates.length === 0) throw new Halt('ORCH_VERDICT_MISSING', `the ${role} report has no VERDICT: APPROVE | RETURN | ESCALATE line`);
  if (candidates.length > 1) throw new Halt('ORCH_VERDICT_INVALID', `expected exactly one VERDICT line, found ${candidates.length}`);
  const match = VERDICT_LINE.exec(candidates[0]);
  if (!match) throw new Halt('ORCH_VERDICT_INVALID', `${JSON.stringify(candidates[0].slice(0, QUOTE_CAP))} is not VERDICT: APPROVE | RETURN | ESCALATE`);
  const at = lines.findIndex((l) => l.startsWith('SNAP_HANDBACK '));
  const report = lines.slice(0, Math.max(at, 0)).filter(Boolean);
  if (at === -1 || report.at(-1) !== candidates[0]) throw new Halt('ORCH_VERDICT_INVALID', 'the VERDICT line must immediately precede SNAP_HANDBACK');
  const severe = severeFindings(report);
  return checkConsistent(match[1], severe.length, [...new Set(severe.map((m) => findingPath(m[2])))]);
}

// FEAT-034: the security report. The orchestrator copies what the agent wrote; the script reads it.
// FEAT-059: it ends in the audit's verdict line, and findings the change did not introduce sit in an owner-only block.
const SCANS_CANDIDATE = /^scans\s*:/i;
const SCANS_LINE = /^SCANS: dependency=(ran|not-covered|disabled|failed) secrets=(ran|failed) scripts=(ran|failed)$/;
const SECURITY_FINDING = /^- \[(blocker|major|minor)\] (\S+:\d+) — (critical|high|moderate|low) (dependency|secret|script): \S/;
const FINDING_FORM = '- [<blocker|minor>] <path>:<line> — <critical|high|moderate|low> <dependency|secret|script>: <text>';
const SECURITY_CANDIDATE = /^- \[/;
const OWNER_OPEN = 'PRE-EXISTING (owner only):';
const OWNER_CLOSE = 'END PRE-EXISTING';
const REPORT_FILE = `${HANDBACK_DIR}/security.txt`;
const reportAt = (n) => `${REPORT_FILE}:${n}`;
const quote = (line) => JSON.stringify(line.slice(0, QUOTE_CAP));
const invalid = (reason) => new Halt('ORCH_SECURITY_REPORT_INVALID', reason);
// C1: recomputed here from the run file, never read from the report.
const severityFor = (level, threshold) => (SECURITY_LEVELS.indexOf(level) >= SECURITY_LEVELS.indexOf(threshold) ? 'blocker' : 'minor');

function checkDependency(scans, findings, security) {
  const wanted = security.dependency === 'audit' ? ['ran', 'failed'] : [security.dependency];
  if (!wanted.includes(scans.dependency)) throw invalid(`the report says dependency=${scans.dependency}, but the run records dependency ${security.dependency}`);
  if (findings.some((f) => f.source === 'dependency') && scans.dependency !== 'ran') {
    throw invalid(`the report lists a dependency finding, but the dependency scan reports ${scans.dependency}`);
  }
}

function scansLine(lines) {
  const candidates = lines.filter((l) => SCANS_CANDIDATE.test(l));
  if (candidates.length === 0) throw new Halt('ORCH_SECURITY_REPORT_MISSING', 'the security report has no SCANS: line');
  if (candidates.length > 1) throw invalid(`expected exactly one SCANS line, found ${candidates.length}`);
  const match = SCANS_LINE.exec(candidates[0]);
  if (!match) throw invalid(`${quote(candidates[0])} is not SCANS: dependency=<ran|not-covered|disabled|failed> secrets=<ran|failed> scripts=<ran|failed>`);
  const at = lines.findIndex((l) => l.startsWith('SNAP_HANDBACK '));
  const before = lines.slice(0, Math.max(at, 0)).filter(Boolean);
  // C11: parseVerdict has already placed the verdict last, so the SCANS line sits just before it.
  if (at === -1 || before.at(-2) !== candidates[0]) throw invalid('the SCANS line must immediately precede the VERDICT line');
  return { dependency: match[1], secrets: match[2], scripts: match[3] };
}

// C12: wide candidates, so a near-miss marker halts by name instead of letting an owner line fall into the public part.
function ownerMarkers(lines) {
  const candidates = lines.map(({ line, n }, index) => ({ line, n, index }))
    .filter(({ line }) => /^(end )?pre-existing/i.test(line));
  if (candidates.length === 0) return null;
  const odd = candidates.find(({ line }) => line !== OWNER_OPEN && line !== OWNER_CLOSE);
  if (odd) throw invalid(`the owner-only marker at ${reportAt(odd.n)} is malformed`);
  const [open, close] = candidates;
  if (candidates.length !== 2 || open.line !== OWNER_OPEN || close.line !== OWNER_CLOSE) {
    throw invalid(`the owner-only block at ${reportAt(candidates[0].n)} is repeated, unclosed or misplaced`);
  }
  return { open: open.index, close: close.index };
}

export function splitReport(text) {
  const lines = text.split(/\r?\n/).map((l, i) => ({ line: l.trim(), n: i + 1 }));
  const marks = ownerMarkers(lines);
  if (!marks) return { publicLines: lines, owner: [] };
  const early = lines.slice(0, marks.open).findIndex(({ line }) => SECURITY_CANDIDATE.test(line));
  if (early !== -1) throw invalid(`the owner-only block at ${reportAt(marks.open + 1)} must come before the first finding line`);
  const inside = lines.slice(marks.open + 1, marks.close).filter(({ line }) => line !== '');
  const prose = inside.find(({ line }) => !SECURITY_CANDIDATE.test(line));
  if (prose) throw invalid(`the line at ${reportAt(prose.n)} inside the owner-only block is not a finding line`);
  return { publicLines: [...lines.slice(0, marks.open), ...lines.slice(marks.close + 1)], owner: inside };
}

function securityFinding({ line, n }, part, threshold) {
  const m = SECURITY_FINDING.exec(line);
  const name = part === 'public' ? quote(line) : `the line at ${reportAt(n)}`;
  if (!m) throw invalid(`${name} is not a security finding line: ${FINDING_FORM}`);
  const [, bracket, location, level, source] = m;
  const expected = severityFor(level, threshold);
  if (bracket !== expected) {
    throw invalid(part === 'public'
      ? `${quote(line)} must carry [${expected}]: ${level} against the run's threshold ${threshold}`
      : `the line at ${reportAt(n)} carries the wrong severity for the run's threshold`);
  }
  return { part, n, line, severity: bracket, location, level, source };
}

// C8: a failed scan can hide findings, so only ESCALATE may follow one.
function checkFailedEscalates(scans, verdict) {
  const failed = ['dependency', 'secrets', 'scripts'].find((k) => scans[k] === 'failed');
  if (failed && verdict !== 'ESCALATE') {
    throw new Halt('ORCH_VERDICT_INCONSISTENT', `VERDICT: ${verdict} with the ${failed} scan failed; a failed scan requires VERDICT: ESCALATE`);
  }
}

export function parseSecurityReport(text, security) {
  const { publicLines, owner } = splitReport(text);
  const { verdict } = parseVerdict(publicLines.map((x) => x.line).join('\n'), 'security');
  const scans = scansLine(publicLines.map((x) => x.line));
  // Defense in depth: the verdict check reads only the lines before SNAP_HANDBACK, so nothing may follow it.
  const handbackAt = publicLines.findIndex((x) => x.line.startsWith('SNAP_HANDBACK '));
  const late = publicLines.slice(handbackAt + 1).find((x) => SECURITY_CANDIDATE.test(x.line));
  if (late) throw invalid(`the finding line at ${reportAt(late.n)} comes after SNAP_HANDBACK`);
  const findings = [
    ...publicLines.filter((x) => SECURITY_CANDIDATE.test(x.line)).map((x) => securityFinding(x, 'public', security.threshold)),
    ...owner.map((x) => securityFinding(x, 'owner', security.threshold)),
  ];
  checkDependency(scans, findings, security);
  checkConsistent(verdict, findings.filter((f) => f.part === 'public' && f.severity === 'blocker').length, []);
  checkFailedEscalates(scans, verdict);
  return { verdict, scans, findings };
}

const scanFailed = (reason) => new Halt('ORCH_SECURITY_SCAN_FAILED', `the local scans cannot be re-run: ${reason}`);

// The diff under scan can change the work-tree scanner, so the re-run loads the base commit's copy (C17).
async function baseScan(root, security) {
  if (security.base === null) throw scanFailed('the run recorded no base commit');
  const path = security.scan_command.replace(/^node /, '').replace(/ \S+ \S+$/, '');
  const shown = spawnSync('git', ['show', `${security.base}:./${path}`], { cwd: root });
  if (shown.status !== 0) throw scanFailed(`${path} is not committed at the base`);
  const dir = mkdtempSync(join(tmpdir(), 'cc-security-base-'));
  try {
    const file = join(dir, 'security-scan.mjs');
    writeFileSync(file, shown.stdout);
    const scanner = await import(pathToFileURL(file).href);
    // C15: the normal upgrade path of a 1.48.0 project until its update is committed.
    if (scanner.SCAN_CONTRACT !== 2) throw scanFailed(`the base commit's ${path} predates FEAT-059 (an install or update that is not committed); end this run, commit the updated ${path}, then start again`);
    return scanner.scanChanges(root, security.base, security.threshold);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const DEPENDENCY_PACKAGE = /— (?:critical|high|moderate|low) dependency: ((?:@[^@\s/]+\/)?[^@\s]+)@/;

function lineCount(root, rel) {
  const file = join(root, rel);
  if (!existsSync(file)) return 0;
  const text = readFileSync(file, 'utf8');
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
}

// C3-C4, C13: the reason names neither the direction nor the package.
function checkOrigin(root, findings, local) {
  const changed = local.changed === 'all' || local.changed === 'failed' ? 'all' : local.changed;
  for (const f of findings.filter((x) => x.source === 'dependency')) {
    const path = f.location.replace(/:\d+$/, '');
    const n = Number(f.location.slice(path.length + 1));
    if (path !== local.lockfile || n < 1 || n > lineCount(root, path)) {
      throw invalid(`the dependency finding at ${reportAt(f.n)} does not name a line of the run's lockfile`);
    }
    const pkg = DEPENDENCY_PACKAGE.exec(f.line)?.[1];
    const preExisting = Boolean(pkg) && changed !== 'all' && !changed.includes(pkg);
    if ((f.part === 'owner') !== preExisting) throw invalid(`the dependency finding at ${reportAt(f.n)} is filed in the wrong part`);
  }
}

function checkComplete(report, local) {
  for (const scan of ['secrets', 'scripts']) {
    if (report.scans[scan] !== local[scan]) throw new Halt('ORCH_SECURITY_REPORT_INCOMPLETE', `the report says ${scan}=${report.scans[scan]}; the local re-run says ${local[scan]}`);
  }
  const reported = report.findings.filter((f) => f.source !== 'dependency');
  const partOf = (line) => reported.filter((f) => f.line === line);
  for (const [lines, part] of [[local.introduced, 'public'], [local.preExisting, 'owner']]) {
    for (const line of lines) {
      const found = partOf(line);
      if (found.some((f) => f.part === part)) continue;
      if (found.length > 0) throw new Halt('ORCH_SECURITY_REPORT_INCOMPLETE', `the local finding at ${reportAt(found[0].n)} is filed in the wrong part`);
      throw new Halt('ORCH_SECURITY_REPORT_INCOMPLETE', "the report does not match the base scanner's local findings");
    }
  }
  // An owner-only line copied into the public part would leak a pre-existing finding.
  for (const line of local.preExisting) {
    const leaked = reported.find((f) => f.line === line && f.part === 'public');
    if (leaked) throw new Halt('ORCH_SECURITY_REPORT_INCOMPLETE', `the local finding at ${reportAt(leaked.n)} is filed in the wrong part`);
  }
}

function securitySummary(report, threshold) {
  const publicFindings = report.findings.filter((f) => f.part === 'public');
  const counts = { critical: 0, high: 0, moderate: 0, low: 0 };
  for (const f of publicFindings) counts[f.level] += 1;
  const failed = ['dependency', 'secrets', 'scripts'].find((k) => report.scans[k] === 'failed');
  const blocking = publicFindings.filter((f) => f.severity === 'blocker');
  // C6: nothing from the owner-only block reaches the run file.
  const entry = { scans: report.scans, counts, threshold, verdict: report.verdict, blocked: report.verdict !== 'APPROVE' };
  return { entry, failed, blocking, total: publicFindings.length };
}

function securityStop({ entry, failed, blocking }, threshold) {
  if (entry.verdict === 'APPROVE' && blocking.length === 0) return null;
  if (entry.verdict !== 'ESCALATE') return new Halt('ORCH_SECURITY_BLOCKED', `security found ${blocking.length} finding(s) at or above ${threshold}; first: ${blocking[0].line.slice(0, QUOTE_CAP)}`);
  if (failed) return new Halt('ORCH_SECURITY_SCAN_FAILED', `the ${failed} scan did not complete; scans clean is the Verify exit, see ${REPORT_FILE}`);
  return new Halt('ORCH_SECURITY_ESCALATE', `security escalated a decision only the owner takes; see ${REPORT_FILE}`);
}

const ownerText = (report) => {
  const lines = report.findings.filter((f) => f.part === 'owner').map((f) => f.line);
  return `${lines.length ? lines.join('\n') : 'none'}\n`;
};

async function securityHandback(root, run, gate, text) {
  const report = parseSecurityReport(text, run.security);
  const local = await baseScan(root, run.security);
  checkOrigin(root, report.findings, local);
  checkComplete(report, local);
  writeAtomic(join(root, OWNER_FILE), ownerText(report));
  const { threshold } = run.security;
  const summary = securitySummary(report, threshold);
  // Saved first, so the halt cli records lands on top of the entry.
  saveRun(root, recordHandback(run, 'security', gate, null, { security: summary.entry }));
  const stop = securityStop(summary, threshold);
  if (stop) throw stop;
  // C6: the success text is fixed whatever the owner-only block held.
  return `security handed back ${gate}; VERDICT: APPROVE; ${summary.total} finding(s) below ${threshold} recorded; dependency=${report.scans.dependency}; pre-existing findings, if any, are in ${OWNER_FILE} (owner only)`;
}

async function handback(root, sessionId, role, bytes) {
  const text = bytes.toString('utf8');
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
  if (role === 'security') return securityHandback(root, run, env.ops.gate, text);
  const verdict = role === 'audit' ? parseVerdict(text) : null;
  const recorded = recordHandback(run, role, env.ops.gate, verdict?.verdict);
  saveRun(root, recorded);
  // Saved first, so the halt cli records lands on top of the audit entry (FEAT-060, FEAT-057).
  if (verdict && verdict.verdict !== 'APPROVE') return auditFix(root, recorded, verdict, bytes);
  const note = recorded.handbacks.at(-1).security === SECURITY_NOT_CONFIGURED ? `; security=${SECURITY_NOT_CONFIGURED}` : '';
  return `${role} handed back ${env.ops.gate}${note}`;
}

// Two human approvals, one gate write (A4): only an approved plan writes define_approved.
// FEAT-056: each approval binds the bytes the owner was shown; a stale hash writes nothing.
function approve(root, sessionId, what, rel, shown) {
  const run = liveRun(root, sessionId);
  const step = nextStep(run);
  if (step.await !== what) throw new Refusal(`approve ${what}: the next step is ${describeStep(step)}`);
  if (!SHA256_HEX.test(shown ?? '')) throw new Refusal(APPROVE_USAGE);
  const content = readDoc(root, rel, APPROVE_USAGE);
  checkLoopClosed(run, what);
  const sha256 = documentHash(what, content);
  if (sha256 !== shown.toLowerCase()) {
    throw new Refusal(`ORCH_DOC_HASH_STALE: ${what} ${rel} hashes ${sha256}, not the ${shown} that was shown; show the document again`);
  }
  const approval = { at: new Date().toISOString(), by: gitValue(root, ['config', 'user.name'], 'unknown'), path: rel, sha256 };
  if (what === 'plan') return approvePlan(root, run, content.toString('utf8'), approval);
  saveRun(root, { ...run, approvals: { ...run.approvals, spec: approval } });
  return `spec approved: sha256 ${sha256}`;
}

function approvePlan(root, run, text, approval) {
  const tasks = extractTasks(text);
  if (tasks.length === 0) throw new Halt('ORCH_EMPTY_SCOPE', `${approval.path} holds no "### Task N" section`);
  for (const t of tasks) taskScope(t, approval.path);
  saveRun(root, {
    ...run, gate: 'define_approved', plan: approval.path, tasks: { ids: tasks.map((t) => t.id), done: 0 },
    approvals: { ...run.approvals, plan: approval },
  });
  return `plan approved: define_approved, ${tasks.length} task(s); sha256 ${approval.sha256}`;
}

// FEAT-058: a skip stays possible but is never silent, so approve waits for a recorded outcome.
function checkLoopClosed(run, what) {
  const loop = isPlainObject(run.review) ? run.review[what] : undefined;
  if (isPlainObject(loop) && REVIEW_OUTCOME.test(loop.outcome ?? '')) return;
  const state = isPlainObject(loop) && Number.isInteger(loop.round) ? `open at round ${loop.round}` : 'not run';
  throw new Refusal(`ORCH_REVIEW_OPEN: review ${what} is ${state}; close it before the approval`);
}

const reviewWellFormed = (flag, arg, extra) => extra === undefined
  && (flag === '--round' ? arg !== undefined : flag === '--record' ? arg === undefined : flag === '--close' && SKIP_OUTCOME.test(arg ?? ''));

// FEAT-041 (e), reworked by FEAT-058: the loop revises through files, and its outcomes come
// from the script's own reads of the review file and the document, never from the orchestrator's word.
function review(root, sessionId, [role, flag, arg, extra]) {
  const run = liveRun(root, sessionId);
  if (!reviewWellFormed(flag, arg, extra)) throw new Refusal(REVIEW_USAGE);
  const step = nextStep(run);
  if (step.await !== role) throw new Refusal(`review ${role}: the next step is ${describeStep(step)}`);
  const loops = isPlainObject(run.review) ? run.review : {};
  const loop = isPlainObject(loops[role]) && Number.isInteger(loops[role].round) ? loops[role] : { round: 0, outcome: null };
  if (loop.outcome) throw new Refusal(`review ${role}: the loop closed ${loop.outcome}; a closed loop does not reopen`);
  const { next, say } = flag === '--round' ? openRound(root, role, loop, arg)
    : flag === '--record' ? recordRound(root, role, loop)
      : { next: closedLoop(loop, arg), say: `review ${role} closed ${arg} at round ${loop.round}` };
  saveRun(root, { ...run, review: { ...loops, [role]: next } });
  if (next.outcome) clearReviewDir(root);
  return say;
}

// Only the outcome stays once the loop closes (FEAT-058 E2); a skip before any round has no hash.
const closedLoop = (loop, outcome) => ({ round: loop.round, outcome, sha256: loop.sha256 ?? null });
const clearReviewDir = (root) => rmSync(join(root, REVIEW_DIR), { recursive: true, force: true });

function openRound(root, role, loop, rel) {
  if (loop.round > 0 && loop.await !== 'revision') throw new Refusal(`review ${role}: round ${loop.round} awaits its review record`);
  if (loop.round >= REVIEW_CAP) {
    throw new Refusal(`ORCH_REVIEW_CAP: review ${role} has run ${REVIEW_CAP} rounds; close it with --close skipped:<reason>`);
  }
  const sha256 = documentHash(role, readDoc(root, rel, REVIEW_USAGE));
  const round = loop.round + 1;
  // E3: a revision that leaves the hash as it was is a failed round, recorded rather than retried.
  if (loop.round > 0 && sha256 === loop.sha256) {
    return { next: closedLoop({ ...loop, round }, 'unchanged'), say: `review ${role} closed unchanged at round ${round}: ${rel} still hashes ${sha256}` };
  }
  return { next: { round, outcome: null, sha256, doc: rel, await: 'review' }, say: `review ${role} round ${round} of ${REVIEW_CAP}: ${rel} sha256 ${sha256}` };
}

function recordRound(root, role, loop) {
  if (loop.await !== 'review') throw new Refusal(`review ${role} --record: no reviewer pass is open`);
  const path = `${REVIEW_DIR}/${role}-${loop.round}.md`;
  let bytes = null;
  try { bytes = readFileSync(join(root, path)); } catch { /* judged as unparsed below */ }
  const verdict = bytes && parseReview(bytes.toString('utf8'), role, loop.round);
  if (!verdict) throw new Refusal(`ORCH_REVIEW_UNPARSED: ${path} does not end in REVIEW ${role} round ${loop.round}: CLEAN or OPEN <k> with <k> row lines`);
  if (currentHash(root, role, loop.doc) !== loop.sha256) {
    throw new Refusal(`ORCH_REVIEW_DOC_MOVED: ${loop.doc} no longer hashes ${loop.sha256}; the review describes a document that is gone`);
  }
  if (verdict.open === 0) return { next: closedLoop(loop, 'clean'), say: `review ${role} closed clean at round ${loop.round}` };
  // The rows are printed at the cap because the file they came from is deleted with the loop.
  if (loop.round >= REVIEW_CAP) return { next: closedLoop(loop, 'cap'), say: [`review ${role} closed cap at round ${loop.round}`, ...verdict.rows].join('\n') };
  const reviewSha = createHash('sha256').update(bytes).digest('hex');
  return {
    next: { ...loop, await: 'revision' },
    say: `review ${role} round ${loop.round}: OPEN ${verdict.open}; revise ${loop.doc} sha256 ${loop.sha256} from ${path} sha256 ${reviewSha}`,
  };
}

// The verdict is the last non-blank line, exactly, and its count must agree with the row lines.
function parseReview(text, role, round) {
  const lines = text.split('\n').map((l) => l.replace(/\r$/, ''));
  const last = lines.filter((l) => l.trim() !== '').at(-1) ?? '';
  const m = new RegExp(`^REVIEW ${role} round ${round}: (?:(CLEAN)|OPEN ([1-9]\\d*))$`).exec(last);
  if (!m) return null;
  const rows = lines.filter((l) => REVIEW_ROW.test(l));
  const open = m[1] ? 0 : Number(m[2]);
  return rows.length === open ? { open, rows } : null;
}

const START_USAGE = 'usage: orchestrate.mjs start <ITEM> [--auto] [--ticket <N|issue URL>] [--audit-rounds <0-5>] [--security-threshold <low|moderate|high|critical>] [--no-dependency-audit]';

// The item first, then --auto, --ticket <ref>, --audit-rounds <0-5>, --security-threshold <level> and
// --no-dependency-audit in any order, each at
// most once. A --ticket with no value reaches intake as '' and halts there (FEAT-031 B1.1).
function parseStartArgs(args) {
  const [item, ...rest] = args;
  const opts = { item, auto: false, ticket: undefined, auditRounds: undefined, threshold: undefined, dependencyAudit: true };
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--auto' && !opts.auto) opts.auto = true;
    else if (rest[i] === '--ticket' && opts.ticket === undefined) opts.ticket = rest[++i] ?? '';
    else if (rest[i] === '--audit-rounds' && opts.auditRounds === undefined && /^[0-5]$/.test(rest[i + 1] ?? '')) opts.auditRounds = Number(rest[++i]);
    else if (rest[i] === '--security-threshold' && opts.threshold === undefined && SECURITY_LEVELS.includes(rest[i + 1])) opts.threshold = rest[++i];
    else if (rest[i] === '--no-dependency-audit' && opts.dependencyAudit) opts.dependencyAudit = false;
    else throw new Refusal(START_USAGE);
  }
  if (!/^[A-Z]+-\d{3,}$/.test(item ?? '')) throw new Refusal(START_USAGE);
  opts.auditRounds ??= AUDIT_ROUNDS_DEFAULT;
  opts.threshold ??= SECURITY_THRESHOLD_DEFAULT;
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
  const { item, auto, ticket, auditRounds, threshold, dependencyAudit } = parseStartArgs(args);
  if (!sessionId) throw new Halt('ORCH_NO_SESSION_ID', 'CLAUDE_CODE_SESSION_ID is absent or empty, so Guard 6 could never bind this run');
  const old = readRun(root);
  if (old && old.session_id === sessionId) throw new Halt('ORCH_RUN_ACTIVE', `run ${old.item} is live in this session; end it first`);
  // Resolved before a stale run is cleared, so a halt here leaves everything as it was.
  let detected;
  const stack = () => (detected ??= detectStack(root));
  const testCommand = checkTestCommand(resolveTestCommand(root, stack));
  const docs = resolveDocs(root, item);
  const security = resolveSecurity(root, stack(), { threshold, dependencyAudit });
  const bound = ticket === undefined ? null : ticketIntake(root, item, ticket);
  if (old) clearRunFiles(root);
  // C7: a previous run's owner file must not be read as this run's; end keeps it for the closing report.
  rmSync(join(root, OWNER_FILE), { force: true });
  if (bound) writeSnapshot(root, bound.path, bound.text);
  saveRun(root, {
    v: 1, session_id: sessionId, item, mode: auto ? 'auto' : 'step', started: new Date().toISOString(),
    band: 'boundary', role: null, gate: 'boundary_routed', approvals: { spec: null, plan: null },
    plan: null, tasks: { ids: [], done: 0 }, handbacks: [], halt: null, test_command: testCommand, audit_rounds: auditRounds, security, docs,
    ...(bound ? { ticket: { ...bound.binding, snapshot: bound.path } } : {}),
  });
  const begun = old ? `replaced the stale run ${old.item} started ${old.started}` : `run ${item} started`;
  return `${begun}; ${bound ? ticketNote(bound) : ''}${docsNote(docs)}test command: ${testCommand}; audit rounds: ${auditRounds}${securityNote(security, root, stack())}`;
}

function clearRunFiles(root) {
  rmSync(join(root, ENVELOPE_FILE), { force: true });
  rmSync(join(root, HANDBACK_DIR), { recursive: true, force: true });
  rmSync(join(root, REVIEW_DIR), { recursive: true, force: true });
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

export async function cli(argv, env, cwd = process.cwd()) {
  const [verb, a, b, c] = argv;
  const root = findRunRoot(cwd);
  const sid = env.CLAUDE_CODE_SESSION_ID;
  const verbs = {
    start: () => start(root, sid, argv.slice(1)),
    install: () => install(root, sid, a, b === '--check'),
    handback: () => handback(root, sid, a, readFileSync(0)),
    approve: () => approve(root, sid, a, b, c),
    hash: () => hashDoc(root, a, b),
    review: () => review(root, sid, argv.slice(1)),
    end: () => end(root),
  };
  try {
    if (!verbs[verb]) throw new Refusal('usage: orchestrate.mjs start|install|handback|approve|hash|review|end');
    process.stdout.write((await verbs[verb]()) + '\n');
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
if (invoked) process.exitCode = await cli(process.argv.slice(2), process.env);
