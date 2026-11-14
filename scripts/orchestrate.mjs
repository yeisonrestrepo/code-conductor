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
// FEAT-054: the delegated review's kinds and the outcomes a run records; delegate, its parser and isValidRun read these.
export const DELEGATE_KINDS = ['spec', 'plan', 'build'];
export const DELEGATED_VERDICTS = ['APPROVE', 'RETURN', 'ESCALATE', 'UNPARSED'];
// Where /cc-orchestrate writes each delegated review report; cleared with the run like the hand-backs.
export const DELEGATE_DIR = '.conductor/delegate';
// FEAT-057: fix rounds per run, fixed at start so the orchestrator's prompt cannot change the cap.
export const AUDIT_ROUNDS_DEFAULT = 2;
const AUDIT_ROUNDS_MAX = 5;
const SNAP_STORE_MAX_BYTES = 64 * 1024;
const isAuditRounds = (n) => Number.isInteger(n) && n >= 0 && n <= AUDIT_ROUNDS_MAX;
// FEAT-053: the Agent tool's model aliases plus inherit; the one list start, the profiles and isValidRun are checked against.
export const MODEL_ALIASES = ['opus', 'sonnet', 'haiku', 'inherit'];
export const MODEL_ROLES = ['spec', 'plan', 'code', 'audit', 'security', 'qa', 'define-review'];
const ESCALATION_MODEL = 'opus';
const ROLE_MODELS_PREFIX = '- Role models:';
const ROLE_MODELS_LINE = /^- Role models: (.+)$/;
const isModel = (m) => MODEL_ALIASES.includes(m);
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

// A halt stops the run and is recorded in it (D12); resume clears it from the last gate whose record still validates (FEAT-055). A refusal is a misuse of the CLI:
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

// FEAT-053: a hand-edited model would let the run file, not the project, choose what a dispatch runs on.
function isModelRecord(run) {
  const m = run.models;
  const keys = isPlainObject(m) ? Object.keys(m).sort().join() : null;
  if (m !== undefined && (keys !== [...MODEL_ROLES].sort().join() || !MODEL_ROLES.every((r) => isModel(m[r])))) return false;
  if (run.dispatch_model !== undefined && !isModel(run.dispatch_model)) return false;
  return run.handbacks.every((h) => !isPlainObject(h?.fix) || h.fix.model === undefined || isModel(h.fix.model));
}

// FEAT-054: only start writes unattended, always with auto and a security seat; a hand edit that breaks either is not a run.
function isUnattendedRecord(run) {
  if (run.unattended !== undefined && (run.unattended !== true || run.mode !== 'auto' || !isPlainObject(run.security))) return false;
  const d = run.delegated;
  if (d === undefined) return true;
  return isPlainObject(d) && Object.entries(d).every(([k, v]) => DELEGATE_KINDS.includes(k) && isPlainObject(v) && DELEGATED_VERDICTS.includes(v.verdict));
}

// FEAT-057: a present audit_rounds that is not 0-5 would let a hand-edited run buy fix rounds without limit.
// FEAT-053: and models, dispatch_model and fix.model hold only the allow-list.
// FEAT-054: and unattended and delegated hold only what start and delegate write.
export function isValidRun(run) {
  return isPlainObject(run) && run.v === 1 && typeof run.session_id === 'string' && run.session_id !== ''
    && typeof run.item === 'string' && GATES.includes(run.gate) && isPlainObject(run.approvals)
    && Array.isArray(run.handbacks) && Array.isArray(run.tasks?.ids) && Number.isInteger(run.tasks?.done)
    && (run.audit_rounds === undefined || isAuditRounds(run.audit_rounds))
    && (run.security === undefined || isSecurity(run.security))
    && isModelRecord(run) && isUnattendedRecord(run);
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

// Every verb but start, resume and end drives a run that must exist, be this session's, and not be halted.
function liveRun(root, sessionId) {
  const run = readRun(root);
  if (!run) throw new Refusal(`no run file at ${join(root, RUN_FILE)}; start one first`);
  if (run.session_id !== sessionId) {
    throw new Refusal(`run ${run.item} belongs to another session; end it, or start to replace it`);
  }
  if (run.halt) throw new Refusal(`run ${run.item} halted with ${run.halt.code}; recover with resume, or end then start (D12, FEAT-055)`);
  return run;
}

const handedBack = (run, role) => run.handbacks.some((h) => h.role === role);

// FEAT-057: a fix is due exactly when the last hand-back is an audit the script granted one.
const fixDue = (run) => { const last = run.handbacks.at(-1); return last?.role === 'audit' && isPlainObject(last.fix) ? last.fix : null; };

// FEAT-054: an unattended run puts the delegated build review between the approving seat and qa (D7).
function afterSeat(run) {
  if (run.unattended !== true) return { role: 'qa' };
  const verdict = run.delegated?.build?.verdict;
  if (verdict === undefined) return { await: 'build' };
  return verdict === 'APPROVE' ? { role: 'qa' } : { end: true };
}

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
  if (last === 'audit') return isPlainObject(run.security) ? { role: 'security' } : afterSeat(run);
  // Only an approving verdict routes to qa (FEAT-059); a blocked or failed seat never does, and the halt already names end (FEAT-034).
  if (last === 'security') return run.handbacks.at(-1).security?.verdict === 'APPROVE' ? afterSeat(run) : { end: true };
  if (last === 'qa') return { end: true };
  return { role: 'audit' };
}

// FEAT-054: the build step is the delegated review's, so no refusal line ever tells the orchestrator to approve the build.
const describeStep = (s) => (s.role ? `install ${s.role}` : s.await === 'build' ? 'delegate build' : s.await ? `approve ${s.await}` : 'end');

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

const modelsInvalid = (reason) => new Halt('ORCH_ROLE_MODELS_INVALID', reason);

// FEAT-053: the one CLAUDE.md opt-in line, or null; a prefix without a value halts rather than inheriting silently.
function roleModelsValue(root) {
  let text = '';
  try { text = readFileSync(join(root, 'CLAUDE.md'), 'utf8').replace(/\r\n/g, '\n'); } catch { return null; }
  const lines = text.split('\n').filter((l) => l.startsWith(ROLE_MODELS_PREFIX));
  if (lines.length === 0) return null;
  if (lines.length > 1) throw modelsInvalid(`CLAUDE.md has ${lines.length} "${ROLE_MODELS_PREFIX}" lines; keep one`);
  const m = ROLE_MODELS_LINE.exec(lines[0]);
  if (!m) throw modelsInvalid(`"${lines[0]}" has no value; write default or <role>=<model> tokens`);
  return m[1];
}

// An explicit token wins over default whatever the order, so the parse only collects.
function parseRoleModels(value) {
  const explicit = {};
  let defaults = false;
  for (const token of value.split(',').map((t) => t.trim())) {
    if (token === '') throw modelsInvalid(`empty token in "${ROLE_MODELS_PREFIX} ${value}"`);
    if (token === 'default') {
      if (defaults) throw modelsInvalid('"default" appears twice');
      defaults = true;
      continue;
    }
    const parts = token.split('=');
    if (parts.length !== 2) throw modelsInvalid(`token "${token}" is neither default nor <role>=<model>`);
    const [role, model] = parts;
    if (!MODEL_ROLES.includes(role)) throw modelsInvalid(`unknown role "${role}" in "${token}"; the roles are ${MODEL_ROLES.join(', ')}`);
    if (!isModel(model)) throw modelsInvalid(`model "${model}" in "${token}" is not one of ${MODEL_ALIASES.join(', ')}`);
    if (role in explicit) throw modelsInvalid(`role "${role}" is set twice`);
    explicit[role] = model;
  }
  return { defaults, explicit };
}

// The shipped default sits under a key Claude Code does not read; no profile, or no key, inherits.
function profileDefault(role, root) {
  const path = findAgent(role, root);
  if (!path) return 'inherit';
  const front = readFileSync(path, 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const value = front?.[1].match(/^default-model:[ \t]*(\S*)[ \t]*\r?$/m)?.[1];
  if (value === undefined) return 'inherit';
  if (!isModel(value)) throw modelsInvalid(`${path} sets default-model: ${value}, not one of ${MODEL_ALIASES.join(', ')}`);
  return value;
}

// Fixed at start, like audit_rounds; null keeps a run without the line exactly as it was before FEAT-053.
function resolveRoleModels(root) {
  const value = roleModelsValue(root);
  if (value === null) return null;
  const { defaults, explicit } = parseRoleModels(value);
  return Object.fromEntries(MODEL_ROLES.map((r) => [r, explicit[r] ?? (defaults ? profileDefault(r, root) : 'inherit')]));
}

const shareNote = (m) => (m.audit === m.code && m.code !== 'inherit' ? `; note: audit and code share ${m.code}` : '');
const modelsNote = (m) => (m ? `; role models: ${MODEL_ROLES.map((r) => `${r}=${m[r]}`).join(', ')}${shareNote(m)}` : '');

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
  const base = headObject(root);
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

const headCommit = (root) => {
  const head = gitValue(root, ['rev-parse', 'HEAD'], '0000000').toLowerCase();
  return /^[0-9a-f]{7,40}$/.test(head) ? head : '0000000';
};

// A full object name or null: what an approval and the security seat anchor to (FEAT-055, FEAT-034).
const headObject = (root) => { const head = gitValue(root, ['rev-parse', 'HEAD'], ''); return OBJECT_NAME.test(head) ? head : null; };

// A fix step's files come from the record, re-checked against the plan because the run file is writable.
function codeScope(root, run, step) {
  if (step.fix !== undefined) { const { files } = fixDue(run); return fixScope(root, run, Array.isArray(files) ? files : [], step.fix); }
  const task = extractTasks(readDoc(root, run.plan, `cannot read ${run.plan}`).toString('utf8')).find((t) => t.id === step.task);
  return taskScope(task ?? { id: step.task, files: [] }, run.plan);
}

function envelopeFields(run, root, step) {
  const { tk, scope } = ROLE_ARTIFACTS[step.role];
  const fields = {
    ph: PHASE[step.role], c: headCommit(root), s: run.item,
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
// FEAT-055: returned, not thrown, so resume refuses with the same text where install halts.
function approvedDocHalt(root, run, kind) {
  const { path, sha256 } = run.approvals[kind] ?? {};
  if (typeof path !== 'string' || typeof sha256 !== 'string') {
    return new Halt('ORCH_APPROVAL_UNHASHED', `run ${run.item} records an approval without a document hash (started before FEAT-056); run end, then start`);
  }
  const now = currentHash(root, kind, path);
  if (now === sha256) return null;
  return new Halt('ORCH_APPROVED_DOC_CHANGED', `${kind} ${path} was approved at sha256 ${sha256} and ${now ? `now hashes ${now}` : 'can no longer be read'}`);
}

function checkApprovedDocs(root, run) {
  for (const kind of ['spec', 'plan']) {
    const failure = approvedDocHalt(root, run, kind);
    if (failure) throw failure;
  }
}

const fixNote = (run) => { const f = fixDue(run); return `fix round ${f.round} of ${run.audit_rounds ?? 0}: review ${f.review} sha256 ${f.sha256}`; };

// FEAT-053: what the script says this dispatch runs on, never the orchestrator's choice; null in a run without models.
function dispatchModel(run, step) {
  if (!isPlainObject(run.models)) return null;
  return step.fix === undefined ? run.models[step.role] : fixDue(run).model ?? run.models.code;
}

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
  const model = dispatchModel(run, step);
  const out = built.out.trim() + (step.fix === undefined ? '' : `\n${fixNote(run)}`) + (model ? `\nmodel: ${model}` : '');
  if (check) return out;
  writeAtomic(join(root, ENVELOPE_FILE), built.out);
  saveRun(root, { ...run, band: ROLE_BAND[role], role, ...(model ? { dispatch_model: model } : {}) });
  return out;
}

// FEAT-060: the second line behind the halt; verify_pass is forwarded only over an approving audit.
// FEAT-057: the last audit, since an earlier RETURN stays in the record forever.
// FEAT-054: and, in an unattended run, over an approving delegated build review.
function withholdUnlessApproved(run) {
  const verdict = run.handbacks.findLast((h) => h.role === 'audit')?.verdict;
  if (verdict !== 'APPROVE') throw new Halt('ORCH_GATE_WITHHELD', `qa may not forward verify_pass: the audit verdict is ${verdict ?? 'absent'}`);
  if (!isPlainObject(run.security)) return;
  const seatVerdict = run.handbacks.findLast((h) => h.role === 'security')?.security?.verdict;
  if (seatVerdict !== 'APPROVE') throw new Halt('ORCH_GATE_WITHHELD', `qa may not forward verify_pass: the security verdict is ${seatVerdict ?? 'absent'}`);
  if (run.unattended !== true) return;
  const delegated = run.delegated?.build?.verdict;
  if (delegated !== 'APPROVE') throw new Halt('ORCH_GATE_WITHHELD', `qa may not forward verify_pass: the delegated build verdict is ${delegated ?? 'absent'}`);
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

// FEAT-053: an entry carries the model install recorded, read from the run file and never from the report.
export function recordHandback(run, role, gate, verdict, extra = {}) {
  if (role === 'qa' && gate === 'verify_pass') withholdUnlessApproved(run);
  const fields = entryFields(run, role);
  const model = isPlainObject(run.models) && isModel(run.dispatch_model) ? { model: run.dispatch_model } : {};
  const entry = { role, gate, at: new Date().toISOString(), ...fields, ...(verdict ? { verdict } : {}), ...model, ...extra };
  const tasks = role === 'code' && !('fix' in fields) ? { ...run.tasks, done: run.tasks.done + 1 } : run.tasks;
  return { ...run, role: null, gate: forwardGate(run, role, gate), tasks, handbacks: [...run.handbacks, entry] };
}

// FEAT-055: the validated text is returned too, so resume can validate the same bytes again.
function parseHandback(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith('SNAP_HANDBACK '));
  if (lines.length !== 1) throw new Halt('ORCH_HANDBACK_MISSING', `expected exactly one SNAP_HANDBACK line, found ${lines.length}`);
  const json = lines[0].slice('SNAP_HANDBACK '.length).trim();
  // The SNAP is stored in the run file, which the hooks stop reading past their envelope cap (Guard 6 would go from deny to warn).
  if (Buffer.byteLength(json) > SNAP_STORE_MAX_BYTES) {
    throw new Halt('ORCH_HANDBACK_INVALID', `the hand-back SNAP is larger than ${SNAP_STORE_MAX_BYTES} bytes`);
  }
  const error = validate(json + '\n');
  if (error) throw new Halt('ORCH_HANDBACK_INVALID', error);
  const env = JSON.parse(json);
  if (env.v !== 3 && env.v !== 4) throw new Halt('ORCH_HANDBACK_INVALID', `a hand-back must be a v3 or v4 envelope, got v${env.v}`);
  return { env, snap: json };
}

function auditStop({ verdict, blockers }, round, cap) {
  const report = `${HANDBACK_DIR}/audit-${round}.txt`;
  if (verdict === 'RETURN') return new Halt('ORCH_AUDIT_RETURN', `audit returned the change with ${blockers} blocker/major finding(s) at round ${round}; the cap of ${cap} fix round(s) is spent; see ${report}`);
  return new Halt('ORCH_AUDIT_ESCALATE', `audit escalated a decision only the owner takes; see ${report}`);
}

// FEAT-053: a plan task the audit returns a second time goes to the most capable model, and the record names the trigger.
function fixModel(root, run, paths) {
  if (!isPlainObject(run.models)) return { fields: {}, note: '' };
  const tasks = extractTasks(readDoc(root, run.plan, `cannot read ${run.plan}`).toString('utf8'))
    .filter((t) => t.files.some((f) => paths.includes(f))).map((t) => t.id);
  const earlier = new Set(run.handbacks.slice(0, -1).flatMap((h) => (h.role === 'audit' && Array.isArray(h.fix?.tasks) ? h.fix.tasks : [])));
  const escalated = tasks.filter((id) => earlier.has(id));
  if (escalated.length === 0) return { fields: { tasks, model: run.models.code }, note: `; model ${run.models.code}` };
  return {
    fields: { tasks, model: ESCALATION_MODEL, escalated },
    note: `; model ${ESCALATION_MODEL} (escalated: ${escalated.join(', ')} returned twice)`,
  };
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
  const { fields, note } = fixModel(root, run, verdict.paths);
  saveRun(root, { ...run, handbacks: [...run.handbacks.slice(0, -1), { ...entry, fix: { ...fix, ...fields } }] });
  return `audit round ${entry.round}: RETURN with ${verdict.blockers} blocker/major finding(s); fix round ${fix.round} of ${cap}: review ${fix.review} sha256 ${fix.sha256}; scope ${scope.join(', ')}${note}`;
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

// FEAT-054: the audit's verdict contract without the SNAP_HANDBACK anchor; the REVIEWED line binds the verdict to one hash.
// The allowed values are the owner's constants, the same lists delegate and isValidRun read.
const REPORT_VERDICTS = DELEGATED_VERDICTS.filter((v) => v !== 'UNPARSED');
const REPORT_VERDICT_TEXT = `VERDICT: ${REPORT_VERDICTS.join(' | ')}`;
export function parseDelegatedReport(text, label, sha256) {
  if (!DELEGATE_KINDS.includes(label.split(' ')[0])) throw new Error(`parseDelegatedReport: ${label} is not a delegated kind`);
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const candidates = lines.filter((l) => VERDICT_CANDIDATE.test(l));
  if (candidates.length === 0) throw new Halt('ORCH_VERDICT_MISSING', `the delegated review report has no ${REPORT_VERDICT_TEXT} line`);
  if (candidates.length > 1) throw new Halt('ORCH_VERDICT_INVALID', `expected exactly one VERDICT line, found ${candidates.length}`);
  // Never quoted: the reason lands in the run file, which names the report, never its text.
  const verdict = candidates[0].startsWith('VERDICT: ') ? candidates[0].slice('VERDICT: '.length) : '';
  if (!REPORT_VERDICTS.includes(verdict)) throw new Halt('ORCH_VERDICT_INVALID', `the VERDICT line is not ${REPORT_VERDICT_TEXT}`);
  if (lines.at(-1) !== candidates[0]) throw new Halt('ORCH_VERDICT_INVALID', 'the VERDICT line must be the last non-blank line');
  const reviewed = `REVIEWED ${label} sha256 ${sha256}`;
  if (lines.at(-2) !== reviewed) throw new Halt('ORCH_VERDICT_INVALID', `the line before the VERDICT line must be ${reviewed}`);
  return checkConsistent(verdict, severeFindings(lines).length, []);
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
  const { env, snap } = parseHandback(text);
  if (env.sys.role !== role) throw new Halt('ORCH_HANDBACK_ROLE_MISMATCH', `dispatched ${role}, the hand-back names ${env.sys.role}`);
  if (!MAY_HAND_BACK[role].includes(env.ops.gate)) {
    throw new Halt('ORCH_GATE_UNEARNED', `${role} may hand back ${MAY_HAND_BACK[role].join('|')}, not ${env.ops.gate}`);
  }
  if (role === 'security') return securityHandback(root, run, env.ops.gate, text);
  const verdict = role === 'audit' ? parseVerdict(text) : null;
  const recorded = recordHandback(run, role, env.ops.gate, verdict?.verdict, { snap });
  saveRun(root, recorded);
  // Saved first, so the halt cli records lands on top of the audit entry (FEAT-060, FEAT-057).
  if (verdict && verdict.verdict !== 'APPROVE') return auditFix(root, recorded, verdict, bytes);
  const note = recorded.handbacks.at(-1).security === SECURITY_NOT_CONFIGURED ? `; security=${SECURITY_NOT_CONFIGURED}` : '';
  return `${role} handed back ${env.ops.gate}${note}`;
}

// Two human approvals, one gate write (A4): only an approved plan writes define_approved.
// FEAT-055: and HEAD at that moment, so resume can tell whether history still holds it.
// FEAT-056: each approval binds the bytes the owner was shown; a stale hash writes nothing.
function approve(root, sessionId, what, rel, shown) {
  const run = liveRun(root, sessionId);
  const step = nextStep(run);
  if (step.await !== what) throw new Refusal(`approve ${what}: the next step is ${describeStep(step)}`);
  // FEAT-054: reachable only at the delegated build step, which is delegate's, never the owner's verb.
  if (!RECORD_KINDS.includes(what)) throw new Refusal(APPROVE_USAGE);
  if (!SHA256_HEX.test(shown ?? '')) throw new Refusal(APPROVE_USAGE);
  const content = readDoc(root, rel, APPROVE_USAGE);
  checkLoopClosed(run, what);
  const sha256 = documentHash(what, content);
  if (sha256 !== shown.toLowerCase()) {
    throw new Refusal(`ORCH_DOC_HASH_STALE: ${what} ${rel} hashes ${sha256}, not the ${shown} that was shown; show the document again`);
  }
  const approval = { at: new Date().toISOString(), by: gitValue(root, ['config', 'user.name'], 'unknown'), path: rel, sha256, commit: headObject(root) };
  if (what === 'plan') return approvePlan(root, run, content.toString('utf8'), approval);
  saveRun(root, { ...run, approvals: { ...run.approvals, spec: approval } });
  return `spec approved: sha256 ${sha256}`;
}

function approvePlan(root, run, text, approval, head = 'plan approved') {
  const tasks = extractTasks(text);
  if (tasks.length === 0) throw new Halt('ORCH_EMPTY_SCOPE', `${approval.path} holds no "### Task N" section`);
  for (const t of tasks) taskScope(t, approval.path);
  saveRun(root, {
    ...run, gate: 'define_approved', plan: approval.path, tasks: { ids: tasks.map((t) => t.id), done: 0 },
    approvals: { ...run.approvals, plan: approval },
  });
  return `${head}: define_approved, ${tasks.length} task(s); sha256 ${approval.sha256}`;
}

// FEAT-058: a skip stays possible but is never silent, so approve waits for a recorded outcome.
function checkLoopClosed(run, what) {
  const loop = isPlainObject(run.review) ? run.review[what] : undefined;
  if (isPlainObject(loop) && REVIEW_OUTCOME.test(loop.outcome ?? '')) return;
  const state = isPlainObject(loop) && Number.isInteger(loop.round) ? `open at round ${loop.round}` : 'not run';
  throw new Refusal(`ORCH_REVIEW_OPEN: review ${what} is ${state}; close it before the approval`);
}

const DELEGATE_USAGE = `usage: orchestrate.mjs delegate <spec|plan> ${DOC_PATH} <sha256> | delegate build | delegate <spec|plan|build> --check`;
const DELEGATED_BASIS = 'approved by delegated review';
const delegatePath = (kind) => `${DELEGATE_DIR}/${kind}.md`;

function parseDelegateArgs([kind, ...rest]) {
  if (!DELEGATE_KINDS.includes(kind)) throw new Refusal(DELEGATE_USAGE);
  if (rest.length === 1 && rest[0] === '--check') return { kind, check: true };
  if (kind === 'build' && rest.length === 0) return { kind };
  if (kind !== 'build' && rest.length === 2 && SHA256_HEX.test(rest[1])) return { kind, rel: rest[0], shown: rest[1] };
  throw new Refusal(DELEGATE_USAGE);
}

// FEAT-054: only the value start recorded opens this verb, at its own step, once per kind (D3, D4).
function delegatedRun(root, sessionId, kind) {
  const run = liveRun(root, sessionId);
  if (run.unattended !== true) throw new Refusal(`ORCH_NOT_UNATTENDED: run ${run.item} was not started with --unattended; only an owner message approves`);
  const step = nextStep(run);
  if (step.await !== kind) throw new Refusal(`delegate ${kind}: the next step is ${describeStep(step)}`);
  const earlier = run.delegated?.[kind];
  if (earlier) throw new Refusal(`ORCH_DELEGATED_ONCE: delegated review ${kind} already returned ${earlier.verdict}; only the owner approves now`);
  return run;
}

const snapFiles = (entry) => { try { const f = JSON.parse(entry?.snap).ops.f; return Array.isArray(f) ? f.map(String) : []; } catch { return []; } };

// The document the Define role named in its hand-back, inside its pinned folder: the brief's, never the orchestrator's pick.
function handedBackDoc(run, kind) {
  const folder = String(run.docs?.scopes?.[kind]?.[0] ?? '').replace(/\*\*$/, '');
  const docs = snapFiles(run.handbacks.findLast((h) => h.role === kind)).filter((f) => /:[CM]$/.test(f)).map((f) => f.slice(0, -2))
    .filter((p) => folder !== '' && p.startsWith(folder) && p.endsWith('.md'));
  if (docs.length !== 1) throw new Refusal(`delegate ${kind}: the ${kind} hand-back names ${docs.length} document(s) under ${folder}; show the approval and wait for the owner`);
  return docs[0];
}

const sourceNote = (run) => (isPlainObject(run.ticket) ? `ticket snapshot ${run.ticket.snapshot}` : `backlog entry for ${run.item}`);
const securityLine = ({ verdict, threshold, counts: c, scans: s }) => `VERDICT: ${verdict}; threshold ${threshold}; findings critical=${c.critical} high=${c.high} moderate=${c.moderate} low=${c.low}; scans dependency=${s.dependency} secrets=${s.secrets} scripts=${s.scripts}`;

function buildValues(run) {
  const { spec, plan } = run.approvals;
  const files = [...new Set(run.handbacks.filter((h) => h.role === 'code').flatMap((h) => snapFiles(h).map((f) => f.replace(/:[CMD]$/, ''))))];
  const seat = run.handbacks.findLast((h) => h.role === 'security')?.security;
  return `spec ${spec.path} sha256 ${spec.sha256}; plan ${plan.path} sha256 ${plan.sha256}; files ${files.length ? files.join(', ') : 'none'}; security ${seat ? securityLine(seat) : SECURITY_NOT_CONFIGURED}`;
}

// D8: the script prints what the brief carries, so the orchestrator copies values and never reads them from its own context.
function delegateCheck(root, run, kind) {
  const model = modelSegment(run, 'define-review');
  if (kind === 'build') return `delegate build: ${buildValues(run)}${model}`;
  const doc = handedBackDoc(run, kind);
  const sha256 = documentHash(kind, readDoc(root, doc, DELEGATE_USAGE));
  const { spec } = run.approvals;
  const source = kind === 'spec' ? sourceNote(run) : `the approved spec ${spec.path} sha256 ${spec.sha256} and ${sourceNote(run)}`;
  return `delegate ${kind}: ${doc} sha256 ${sha256}; source ${source}${model}`;
}

const delegatedEntry = (verdict, bytes, reason) => ({
  verdict, at: new Date().toISOString(), review_sha256: createHash('sha256').update(bytes).digest('hex'), ...(reason ? { reason } : {}),
});
const readReport = (root, kind) => { try { return readFileSync(join(root, delegatePath(kind))); } catch { return null; } };
const inSurface = (p) => WRITE_SURFACE.some((s) => (s.endsWith('/**') ? p === s.slice(0, -3) || p.startsWith(s.slice(0, -2)) : p === s));

// Owner decision (FEAT-054): a plan whose task would write the run's own record never passes on a delegated verdict.
function surfaceTask(planText) {
  for (const t of extractTasks(planText)) {
    const path = t.files.find(inSurface);
    if (path !== undefined) return `task ${t.id} declares ${path} inside the orchestrator write surface`;
  }
  return null;
}

// A garbled report is a failed delegation, never an approval, and it spends the one attempt (D4).
function defineOutcome(text, kind, sha256, content) {
  let verdict;
  try { ({ verdict } = parseDelegatedReport(text, kind, sha256)); } catch (e) {
    if (e instanceof Halt) return { verdict: 'UNPARSED', reason: e.message };
    throw e;
  }
  const reason = verdict === 'APPROVE' && kind === 'plan' ? surfaceTask(content.toString('utf8')) : null;
  return reason ? { verdict: 'ESCALATE', reason } : { verdict };
}

const ownerRequired = (kind, { verdict, reason }) => `owner approval required: delegated review ${kind} returned ${verdict}${reason ? ` (${reason})` : ''}; see ${delegatePath(kind)}`;

// approve's own checks, in its order, then the report: an APPROVE records the reviewer as approver (D5 on anything else).
function delegateDefine(root, run, { kind, rel, shown }) {
  const content = readDoc(root, rel, DELEGATE_USAGE);
  checkLoopClosed(run, kind);
  const sha256 = documentHash(kind, content);
  if (sha256 !== shown.toLowerCase()) throw new Refusal(`ORCH_DOC_HASH_STALE: ${kind} ${rel} hashes ${sha256}, not the ${shown} that was shown; show the document again`);
  const expected = handedBackDoc(run, kind);
  if (rel !== expected) throw new Refusal(`delegate ${kind}: ${rel} is not the document the ${kind} hand-back names (${expected})`);
  const bytes = readReport(root, kind);
  if (!bytes) throw new Refusal(`delegate ${kind}: cannot read ${delegatePath(kind)}`);
  const outcome = defineOutcome(bytes.toString('utf8'), kind, sha256, content);
  const entry = delegatedEntry(outcome.verdict, bytes, outcome.reason);
  const recorded = { ...run, delegated: { ...run.delegated, [kind]: entry } };
  if (outcome.verdict !== 'APPROVE') { saveRun(root, recorded); return ownerRequired(kind, outcome); }
  const approval = { at: entry.at, by: 'define-review', basis: DELEGATED_BASIS, path: rel, sha256, commit: headObject(root), review_sha256: entry.review_sha256 };
  if (kind === 'plan') return approvePlan(root, recorded, content.toString('utf8'), approval, 'plan approved by delegated review');
  saveRun(root, { ...recorded, approvals: { ...run.approvals, spec: approval } });
  return `spec approved by delegated review: sha256 ${sha256}`;
}

// FEAT-054: the audit and security contract (D6): RETURN and ESCALATE halt, and a halt names the report, never a finding.
function delegateBuild(root, run) {
  const path = delegatePath('build');
  const bytes = readReport(root, 'build');
  if (!bytes) throw new Halt('ORCH_VERDICT_MISSING', `cannot read ${path}`);
  let verdict;
  try { ({ verdict } = parseDelegatedReport(bytes.toString('utf8'), 'build plan', run.approvals.plan.sha256)); } catch (e) {
    throw e instanceof Halt ? new Halt(e.code, `${e.reason}; see ${path}`) : e;
  }
  // Saved first, so the halt cli records lands on top of the outcome, as handback audit's does.
  saveRun(root, { ...run, delegated: { ...run.delegated, build: delegatedEntry(verdict, bytes) } });
  if (verdict === 'RETURN') throw new Halt('ORCH_DELEGATED_RETURN', `the delegated build review returned the change; see ${path}`);
  if (verdict === 'ESCALATE') throw new Halt('ORCH_DELEGATED_ESCALATE', `the delegated build review escalated a decision only the owner takes; see ${path}`);
  return `build approved by delegated review: plan sha256 ${run.approvals.plan.sha256}; next: install qa`;
}

// FEAT-054: the delegated review's verb; approve stays the owner's, byte for byte (D3).
function delegate(root, sessionId, args) {
  const parsed = parseDelegateArgs(args);
  const run = delegatedRun(root, sessionId, parsed.kind);
  if (parsed.check) return delegateCheck(root, run, parsed.kind);
  return parsed.kind === 'build' ? delegateBuild(root, run) : delegateDefine(root, run, parsed);
}

const RESUME_USAGE = 'usage: orchestrate.mjs resume';
const RESTART = 'recover with end, then start';
const RECORD_KINDS = ['spec', 'plan'];

// FEAT-055: every failure is a refusal, so a failed resume leaves the halt it was asked to clear as it was.
function haltedRun(root, sessionId, args) {
  if (args.length > 0) throw new Refusal(RESUME_USAGE);
  let run = null;
  try { run = readRun(root); } catch { /* an invalid run file is judged below */ }
  if (!run) throw new Refusal(`ORCH_RESUME_NO_RUN: no valid run file at ${join(root, RUN_FILE)}`);
  if (!run.halt) throw new Refusal(`ORCH_RESUME_NOT_HALTED: run ${run.item} is not halted; continue with ${describeStep(nextStep(run))}`);
  if (!sessionId) throw new Refusal('ORCH_NO_SESSION_ID: CLAUDE_CODE_SESSION_ID is absent or empty, so Guard 6 could never bind this run');
  if (!run.approvals.spec) throw new Refusal(`ORCH_RESUME_NO_GATE: run ${run.item} records no spec approval, so no gate is left to resume from; ${RESTART}`);
  return run;
}

// 0: HEAD descends from commit; 1: it does not; anything else: git cannot answer. A non-hex name never reaches git as an option.
function ancestry(root, commit) {
  if (typeof commit !== 'string' || !/^[0-9a-f]{7,64}$/.test(commit)) return null;
  return spawnSync('git', ['merge-base', '--is-ancestor', commit, 'HEAD'], { cwd: root, encoding: 'utf8' }).status;
}

const unanchored = (kind, reason) => new Refusal(`ORCH_RESUME_UNANCHORED: the ${kind} approval ${reason}; ${RESTART}`);

// An approval is the owner's act, which the run cannot redo, so a failing one refuses the whole resume.
function checkApproval(root, run, kind) {
  const failure = approvedDocHalt(root, run, kind);
  if (failure?.code === 'ORCH_APPROVAL_UNHASHED') throw new Refusal(failure.message);
  const { commit } = run.approvals[kind];
  if (commit === undefined) throw unanchored(kind, 'records no commit (approved before FEAT-055)');
  if (commit === null) throw unanchored(kind, 'records a null commit (approved outside a git repository or before its first commit)');
  if (failure) throw new Refusal(`${failure.message}; ${RESTART}`);
  const answer = ancestry(root, commit);
  if (answer === 1) {
    throw new Refusal(`ORCH_RESUME_HISTORY_REWRITTEN: HEAD ${gitValue(root, ['rev-parse', 'HEAD'], 'unknown')} does not descend from the ${kind} approval's commit ${commit}; ${RESTART}`);
  }
  if (answer !== 0) throw unanchored(kind, `commit ${String(commit)} cannot be checked against HEAD`);
}

// The conflict's last entry is ambiguous, except a spec or plan entry whose approval already stands.
function candidateEntries(run) {
  const last = run.handbacks.at(-1);
  if (run.halt.code !== 'ORCH_HANDBACK_CONFLICT' || !last) return run.handbacks;
  return RECORD_KINDS.includes(last.role) && run.approvals[last.role] ? run.handbacks : run.handbacks.slice(0, -1);
}

// A task entry still describes the repository: its position, its SNAP and its commit all hold.
function taskEntryHolds(root, entry, taskId) {
  if (entry.task !== taskId || typeof entry.snap !== 'string' || validate(`${entry.snap}\n`) !== '') return false;
  let env = null;
  try { env = JSON.parse(entry.snap); } catch { return false; }
  return env?.sys?.role === 'code' && ancestry(root, env.sys.c) === 0;
}

// Each approved document's entry, then Build's task entries up to the first that fails; Verify is always redone.
function keptEntries(root, run) {
  const entries = candidateEntries(run);
  const approved = RECORD_KINDS.filter((k) => run.approvals[k]).map((k) => entries.find((h) => h.role === k)).filter(Boolean);
  if (!run.approvals.plan) return { kept: approved, tasks: 0 };
  const tasks = entries.filter((h) => h.role === 'code' && !('fix' in h));
  let n = 0;
  while (n < tasks.length && n < run.tasks.ids.length && taskEntryHolds(root, tasks[n], run.tasks.ids[n])) n += 1;
  return { kept: [...approved, ...tasks.slice(0, n)], tasks: n };
}

// Only approvePlan writes define_approved, and only the last task's hand-back forwards build_executed.
const resumedGate = (run, tasks) => (!run.approvals.plan ? 'boundary_routed' : tasks < run.tasks.ids.length ? 'define_approved' : 'build_executed');

// A dropped document's loop is cleared with it, so the redone document gets a fresh review loop.
const resumedReview = (run, kept) => (isPlainObject(run.review)
  ? Object.fromEntries(Object.entries(run.review).filter(([k]) => kept.some((h) => h.role === k))) : run.review);

function nextLine(run) {
  const step = nextStep(run);
  return step.task ? `${describeStep(step)} (task ${run.tasks.done + 1} of ${run.tasks.ids.length})` : describeStep(step);
}

// FEAT-054: the Define outcomes stay, so a resumed run cannot re-delegate; the build verdict is a Verify record and is redone.
const keptDelegation = (run) => (isPlainObject(run.delegated)
  ? { delegated: Object.fromEntries(Object.entries(run.delegated).filter(([k]) => k !== 'build')) } : {});

// FEAT-055: back to the last gate whose record still validates; every record after it is dropped and redone.
function resume(root, sessionId, args) {
  const run = haltedRun(root, sessionId, args);
  const approvals = RECORD_KINDS.filter((k) => run.approvals[k]);
  for (const kind of approvals) checkApproval(root, run, kind);
  const { kept, tasks } = keptEntries(root, run);
  const records = kept.length + approvals.length;
  const dropped = run.handbacks.length - kept.length;
  const { code, reason, at } = run.halt;
  const resumes = [...(Array.isArray(run.resumes) ? run.resumes : []), { at: new Date().toISOString(), halt: { code, reason, at }, kept: records, dropped }];
  const next = {
    ...run, session_id: sessionId, role: null, halt: null, gate: resumedGate(run, tasks),
    handbacks: kept, tasks: { ...run.tasks, done: tasks }, review: resumedReview(run, kept), resumes,
    ...keptDelegation(run),
  };
  // Computed before the write: resume records no halt, so a throw after saveRun would leave a changed run behind a failed exit.
  const line = `run ${run.item} resumed after ${code} from ${next.gate}: kept ${records} record(s), dropped ${dropped}; next: ${nextLine(next)}`;
  saveRun(root, next);
  // The halted agent's envelope; the hand-back and review files stay for the owner and are overwritten on re-dispatch.
  rmSync(join(root, ENVELOPE_FILE), { force: true });
  // FEAT-054: the dropped build verdict's report goes with it, so the redone review never reads it.
  rmSync(join(root, DELEGATE_DIR, 'build.md'), { force: true });
  return line;
}

const reviewWellFormed = (flag, arg, extra) => extra === undefined
  && (flag === '--round' ? arg !== undefined : flag === '--record' ? arg === undefined : flag === '--close' && SKIP_OUTCOME.test(arg ?? ''));

// FEAT-041 (e), reworked by FEAT-058: the loop revises through files, and its outcomes come
// from the script's own reads of the review file and the document, never from the orchestrator's word.
// FEAT-053: the two lines that trigger a dispatch name its model; a closing line triggers none.
const modelSegment = (run, role) => (isPlainObject(run.models) ? `; model ${run.models[role]}` : '');

function review(root, sessionId, [role, flag, arg, extra]) {
  const run = liveRun(root, sessionId);
  if (!reviewWellFormed(flag, arg, extra)) throw new Refusal(REVIEW_USAGE);
  const step = nextStep(run);
  if (step.await !== role) throw new Refusal(`review ${role}: the next step is ${describeStep(step)}`);
  // FEAT-054: only spec and plan have a loop; the build step is reachable only in an unattended run.
  if (!RECORD_KINDS.includes(role)) throw new Refusal(REVIEW_USAGE);
  const loops = isPlainObject(run.review) ? run.review : {};
  const loop = isPlainObject(loops[role]) && Number.isInteger(loops[role].round) ? loops[role] : { round: 0, outcome: null };
  if (loop.outcome) throw new Refusal(`review ${role}: the loop closed ${loop.outcome}; a closed loop does not reopen`);
  const { next, say } = flag === '--round' ? openRound(root, role, loop, arg, modelSegment(run, 'define-review'))
    : flag === '--record' ? recordRound(root, role, loop, modelSegment(run, role))
      : { next: closedLoop(loop, arg), say: `review ${role} closed ${arg} at round ${loop.round}` };
  saveRun(root, { ...run, review: { ...loops, [role]: next } });
  if (next.outcome) clearReviewDir(root);
  return say;
}

// Only the outcome stays once the loop closes (FEAT-058 E2); a skip before any round has no hash.
const closedLoop = (loop, outcome) => ({ round: loop.round, outcome, sha256: loop.sha256 ?? null });
const clearReviewDir = (root) => rmSync(join(root, REVIEW_DIR), { recursive: true, force: true });

function openRound(root, role, loop, rel, model) {
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
  return { next: { round, outcome: null, sha256, doc: rel, await: 'review' }, say: `review ${role} round ${round} of ${REVIEW_CAP}: ${rel} sha256 ${sha256}${model}` };
}

function recordRound(root, role, loop, model) {
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
    say: `review ${role} round ${loop.round}: OPEN ${verdict.open}; revise ${loop.doc} sha256 ${loop.sha256} from ${path} sha256 ${reviewSha}${model}`,
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

const START_USAGE = 'usage: orchestrate.mjs start <ITEM> [--auto] [--ticket <N|issue URL>] [--audit-rounds <0-5>] [--security-threshold <low|moderate|high|critical>] [--no-dependency-audit] [--unattended]';

// The item first, then --auto, --ticket <ref>, --audit-rounds <0-5>, --security-threshold <level> and
// --no-dependency-audit and --unattended in any order, each at
// most once. A --ticket with no value reaches intake as '' and halts there (FEAT-031 B1.1).
function parseStartArgs(args) {
  const [item, ...rest] = args;
  const opts = { item, auto: false, ticket: undefined, auditRounds: undefined, threshold: undefined, dependencyAudit: true, unattended: false };
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--auto' && !opts.auto) opts.auto = true;
    else if (rest[i] === '--ticket' && opts.ticket === undefined) opts.ticket = rest[++i] ?? '';
    else if (rest[i] === '--audit-rounds' && opts.auditRounds === undefined && /^[0-5]$/.test(rest[i + 1] ?? '')) opts.auditRounds = Number(rest[++i]);
    else if (rest[i] === '--security-threshold' && opts.threshold === undefined && SECURITY_LEVELS.includes(rest[i + 1])) opts.threshold = rest[++i];
    else if (rest[i] === '--no-dependency-audit' && opts.dependencyAudit) opts.dependencyAudit = false;
    else if (rest[i] === '--unattended' && !opts.unattended) opts.unattended = true;
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
  const { item, auto, ticket, auditRounds, threshold, dependencyAudit, unattended } = parseStartArgs(args);
  if (!sessionId) throw new Halt('ORCH_NO_SESSION_ID', 'CLAUDE_CODE_SESSION_ID is absent or empty, so Guard 6 could never bind this run');
  const old = readRun(root);
  if (old && old.session_id === sessionId) throw new Halt('ORCH_RUN_ACTIVE', `run ${old.item} is live in this session; end it first`);
  // Resolved before a stale run is cleared, so a halt here leaves everything as it was.
  let detected;
  const stack = () => (detected ??= detectStack(root));
  const testCommand = checkTestCommand(resolveTestCommand(root, stack));
  const docs = resolveDocs(root, item);
  const models = resolveRoleModels(root);
  const security = resolveSecurity(root, stack(), { threshold, dependencyAudit });
  const bound = ticket === undefined ? null : ticketIntake(root, item, ticket);
  if (old) clearRunFiles(root);
  // C7: a previous run's owner file must not be read as this run's; end keeps it for the closing report.
  // FEAT-054: and no earlier delegated report is read as this run's (plan decision 9).
  rmSync(join(root, OWNER_FILE), { force: true });
  rmSync(join(root, DELEGATE_DIR), { recursive: true, force: true });
  if (bound) writeSnapshot(root, bound.path, bound.text);
  saveRun(root, {
    v: 1, session_id: sessionId, item, mode: auto || unattended ? 'auto' : 'step', started: new Date().toISOString(),
    band: 'boundary', role: null, gate: 'boundary_routed', approvals: { spec: null, plan: null },
    plan: null, tasks: { ids: [], done: 0 }, handbacks: [], halt: null, test_command: testCommand, audit_rounds: auditRounds, security, docs,
    ...(unattended ? { unattended: true } : {}),
    ...(models ? { models } : {}),
    ...(bound ? { ticket: { ...bound.binding, snapshot: bound.path } } : {}),
  });
  const begun = old ? `replaced the stale run ${old.item} started ${old.started}` : `run ${item} started`;
  return `${begun}; ${bound ? ticketNote(bound) : ''}${docsNote(docs)}test command: ${testCommand}; audit rounds: ${auditRounds}${securityNote(security, root, stack())}${modelsNote(models)}${unattended ? UNATTENDED_NOTE : ''}`;
}

const UNATTENDED_NOTE = '; unattended: delegated review at spec, plan and build';

function clearRunFiles(root) {
  rmSync(join(root, ENVELOPE_FILE), { force: true });
  rmSync(join(root, HANDBACK_DIR), { recursive: true, force: true });
  rmSync(join(root, REVIEW_DIR), { recursive: true, force: true });
  rmSync(join(root, DELEGATE_DIR), { recursive: true, force: true });
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

// FEAT-061: a phase command dispatches its role outside a run. With a run file present, even a foreign or broken one, the verb writes nothing: the envelope path is the run's.
const ENVELOPE_ROLES = ['spec', 'plan', 'audit', 'qa'];
const ENVELOPE_USAGE = 'usage: orchestrate.mjs envelope <spec|plan|audit|qa> [--item <label>] | --clear';
const LABEL = /^[a-zA-Z0-9._-]+$/; // The sys.s pattern snap-validate enforces.

function parseEnvelopeArgs(args) {
  if (args.length === 1 && args[0] === '--clear') return { clear: true };
  const [role, flag, label] = args;
  if (!ENVELOPE_ROLES.includes(role)) throw new Refusal(ENVELOPE_USAGE);
  if (args.length === 1) return { role, label: 'adhoc' };
  if (args.length === 3 && flag === '--item' && LABEL.test(label)) return { role, label };
  throw new Refusal(ENVELOPE_USAGE);
}

// Read without throwing: an unreadable run file is another owner's to clear, never this verb's halt.
function runState(root, sessionId) {
  const path = join(root, RUN_FILE);
  if (!existsSync(path)) return { state: 'N' };
  let run = null;
  try { run = JSON.parse(readFileSync(path, 'utf8')); } catch { /* judged below */ }
  if (isValidRun(run) && sessionId && run.session_id === sessionId) return { state: 'L', run, path };
  return { state: 'O', path };
}

function withRunFile(root, role, st) {
  const live = st.state === 'L';
  if (role === 'audit') {
    const who = live ? `live run ${st.run.item}` : `a run file at ${st.path} belongs to another session or is unreadable`;
    return `not-installed: ${who}; audit has no write tool and no shell, so it needs no envelope`;
  }
  if (role === 'qa' && live) {
    const command = st.run.test_command;
    if (typeof command !== 'string' || command === '') {
      throw new Refusal(`envelope qa: run ${st.run.item} records no test command, so Guard 7 grants qa no shell; end it, then start`);
    }
    return `not-installed: live run ${st.run.item}; qa runs ${command}`;
  }
  if (live) {
    throw new Refusal(`envelope ${role}: run ${st.run.item} is live in this session and its Define band writes this document; continue with /cc-orchestrate, or end the run`);
  }
  throw new Refusal(`envelope ${role}: a run file at ${st.path} belongs to another session or is unreadable; clear it with: node ${scriptRef(root)} end`);
}

function adhocFields(root, role, label) {
  const fields = {
    ph: PHASE[role], c: headCommit(root), s: label, n: [], f: [], d: [], x: [], role, tk: ROLE_ARTIFACTS[role].tk, gate: expectedGate(role),
  };
  if (role === 'spec' || role === 'plan') fields.scope = resolveDocs(root, label).scopes[role];
  if (role === 'qa') fields.p = { test_command: checkTestCommand(resolveTestCommand(root)) };
  return fields;
}

function installAdhoc(root, role, label) {
  if (!findAgent(role, root)) {
    throw new Halt('ORCH_AGENT_MISSING', `no agent definition named ${role} in .claude/agents/ or ~/.claude/agents/`);
  }
  const built = runScript('snap-build.mjs', [], JSON.stringify(adhocFields(root, role, label)));
  if (built.status !== 0) throw new Halt('SNAP_ERROR', built.err);
  const error = validate(built.out, role);
  if (error) throw new Halt('SNAP_ERROR', error);
  writeAtomic(join(root, ENVELOPE_FILE), built.out);
  return `installed: ${role} envelope at ${ENVELOPE_FILE}\n${built.out.trim()}`;
}

function clearAdhoc(root, st) {
  if (st.state !== 'N') throw new Refusal(`envelope --clear: a run file exists at ${st.path}; the envelope belongs to that run`);
  const path = join(root, ENVELOPE_FILE);
  if (!existsSync(path)) return 'no envelope';
  rmSync(path, { force: true });
  return 'cleared';
}

function envelopeVerb(root, sessionId, args) {
  const parsed = parseEnvelopeArgs(args);
  const st = runState(root, sessionId);
  if (parsed.clear) return clearAdhoc(root, st);
  if (st.state !== 'N') return withRunFile(root, parsed.role, st);
  // Every failure is a Refusal, so no halt is ever recorded in a run this verb does not own.
  try { return installAdhoc(root, parsed.role, parsed.label); } catch (e) {
    throw e instanceof Halt ? new Refusal(e.message) : e;
  }
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
    delegate: () => delegate(root, sid, argv.slice(1)),
    resume: () => resume(root, sid, argv.slice(1)),
    envelope: () => envelopeVerb(root, sid, argv.slice(1)),
    end: () => end(root),
  };
  try {
    if (!verbs[verb]) throw new Refusal('usage: orchestrate.mjs start|install|handback|approve|hash|review|delegate|resume|envelope|end');
    process.stdout.write((await verbs[verb]()) + '\n');
    return 0;
  } catch (e) {
    if (e instanceof Refusal) { process.stderr.write(`orchestrate: ${e.message}\n`); return 2; }
    if (!(e instanceof Halt)) throw e;
    // resume never records a halt: one thrown by a helper it reuses must not overwrite the halt it was resuming (FEAT-055).
    if (!['start', 'envelope', 'resume'].includes(verb)) recordHalt(root, e);
    process.stderr.write(`${e.code}: ${e.reason}\n`);
    return 1;
  }
}

const invoked = process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;
if (invoked) process.exitCode = await cli(process.argv.slice(2), process.env);
