import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { digestTree } from './file-digests.mjs';
import { writeAtomic } from './file-merge.mjs';
import { formatTimeout } from './plugins.mjs';

// FEAT-037: the one place the pins live. Third-party skills run with the agent's permissions,
// so each is fixed to an exact npm version or a full commit; a re-pin is a reviewed change here.
export const IMPECCABLE_PACKAGE = 'impeccable@4.11.1';
export const SKILLS_CLI = 'skills@1.9.0';
export const SKILLS_CLI_NODE_FLOOR = '22.20.0';
export const FRONTEND_TIMEOUT_MS = 120000;
export const CHOICE_FILE = join('.claude', 'frontend-skills.json');
export const FRONTEND_SKILLS = Object.freeze([
  Object.freeze({ name: 'impeccable', source: 'impeccable', pin: IMPECCABLE_PACKAGE, via: 'impeccable' }),
  Object.freeze({ name: 'emil-design-eng', source: 'emilkowalski/skill', pin: '64eb3deb9a5fbfa041faf783e0bc3fd635872e9c', via: 'skills' }),
  Object.freeze({ name: 'design-taste-frontend', source: 'Leonxlnx/taste-skill', pin: '952435f63acece7d2fcb4b4d3c1786c1c43603e0', via: 'skills' }),
]);

const INSTALLED_STATES = ['installed', 'already installed', 'installed without its design hook'];
const NO_HOOK = 'no hook entry for .claude/skills/impeccable in .claude/settings*.json';

// --copy stays on every platform: it makes the lock entry restore as a copy, never as a symlink.
export function installArgs(skill) {
  if (skill.via === 'impeccable') return ['--yes', IMPECCABLE_PACKAGE, 'install', '-y', '--providers=claude', '--scope=project'];
  return ['--yes', SKILLS_CLI, 'add', `${skill.source}@${skill.pin}`, '--skill', skill.name, '-a', 'claude-code', '--copy', '-y'];
}
export const commandLine = (skill) => `npx ${installArgs(skill).join(' ')}`;

export const DISCLOSURE = [
  'This project looks like frontend work. code-conductor can install three third-party design skills into .claude/skills/:',
  `  - impeccable (npm ${IMPECCABLE_PACKAGE}), the lead design skill, with its design hook`,
  `  - emil-design-eng (emilkowalski/skill at ${FRONTEND_SKILLS[1].pin}, through ${SKILLS_CLI})`,
  `  - design-taste-frontend (Leonxlnx/taste-skill at ${FRONTEND_SKILLS[2].pin}, through ${SKILLS_CLI})`,
  "They are third-party code and run with the agent's permissions.",
  "Impeccable adds a Claude Code command hook that runs on the agent's edits even when you deny the model's own commands, and the hook can download Impeccable's engine binary (checksum-verified) on first use.",
  "The Impeccable skill fetches visual directions from impeccable.style when a new design starts, and its skill content is signed by the vendor and not pinned to a commit: the npm version pins the launcher, the engine and the signing key, not the bundle bytes.",
].join('\n') + '\n';
export const CONSENT_PROMPT = 'Install the frontend design skills? [Y/n] ';

// An empty line now means Yes, so end of input must be told apart from it: null is an
// unreadable answer, and an unreadable answer is not consent.
export function readAnswerLine(fd = 0, read = readSync) {
  const byte = Buffer.alloc(1);
  let line = '';
  while (line.length < 256) {
    if (read(fd, byte, 0, 1, null) !== 1) return null;
    const ch = byte.toString('latin1');
    if (ch === '\n') return line;
    line += ch;
  }
  return line;
}
const askOnTerminal = (question) => { process.stdout.write(question); return readAnswerLine(); };
export const acceptsAnswer = (answer) => typeof answer === 'string' && /^(|y|yes)$/i.test(answer.trim());

export const isOfferedType = (type) => type === 'frontend' || type === 'fullstack';

// The detector runs as a child process: importing it would register process-wide handlers that
// exit 0, and run() must stay synchronous. It prints {} on its own failures.
export function classifyWithDetector(assetRoot, cwd, { spawn = spawnSync, timeoutMs = 30000 } = {}) {
  const script = join(assetRoot, 'scripts', 'detect-stack.mjs');
  const result = spawn(process.execPath, [script, cwd], { encoding: 'utf8', timeout: timeoutMs, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.error) return { error: result.error.code ?? result.error.message };
  if (result.status !== 0) return { error: `detector exit ${result.status}` };
  let parsed;
  try { parsed = JSON.parse(result.stdout); } catch { return { error: 'detector output is not JSON' }; }
  if (typeof parsed?.projectType !== 'string') return { error: 'detector gave no project type' };
  return { type: parsed.projectType };
}

// ---- the project's own files: the prior record, the lock and the settings (all read-only here)

export function readChoice(cwd) {
  try { return JSON.parse(readFileSync(join(cwd, CHOICE_FILE), 'utf8')); } catch { return null; }
}

export function readLock(cwd) {
  let text;
  try { text = readFileSync(join(cwd, 'skills-lock.json'), 'utf8'); } catch (e) {
    return { state: e.code === 'ENOENT' ? 'missing' : 'unreadable' };
  }
  try {
    const skills = JSON.parse(text)?.skills;
    return typeof skills === 'object' && skills !== null ? { state: 'ok', skills } : { state: 'unreadable' };
  } catch { return { state: 'unreadable' }; }
}

const commandsOf = (settings) => Object.values(settings?.hooks ?? {}).flat()
  .flatMap((entry) => (Array.isArray(entry?.hooks) ? entry.hooks : []))
  .map((hook) => hook?.command).filter((command) => typeof command === 'string');

// Any event in either file: the event is the CLI's choice, the path is what ties the hook to us.
export function hasImpeccableHook(cwd) {
  return ['settings.json', 'settings.local.json'].some((file) => {
    try {
      const settings = JSON.parse(readFileSync(join(cwd, '.claude', file), 'utf8'));
      return commandsOf(settings).some((c) => c.replaceAll('\\', '/').includes('.claude/skills/impeccable/'));
    } catch { return false; }
  });
}

const skillFile = (cwd, name) => join(cwd, '.claude', 'skills', name, 'SKILL.md');
const priorEntry = (prior, name) => (Array.isArray(prior?.skills) ? prior.skills.find((s) => s?.name === name) : undefined);

function surveyImpeccable(cwd, prior) {
  const entry = priorEntry(prior, 'impeccable');
  if (entry?.pin === IMPECCABLE_PACKAGE && entry.files && typeof entry.files === 'object' && INSTALLED_STATES.includes(entry.status)) {
    return { state: 'already installed', files: entry.files };
  }
  return { state: 'present at a different revision', detail: entry?.pin && entry.pin !== IMPECCABLE_PACKAGE ? entry.pin : 'unlocked' };
}

function surveyLocked(cwd, skill) {
  const lock = readLock(cwd);
  const commit = lock.state === 'ok' ? lock.skills[skill.name]?.commit : undefined;
  if (commit === skill.pin) return { state: 'already installed' };
  return { state: 'present at a different revision', detail: typeof commit === 'string' ? commit : 'unlocked' };
}

function surveySkill(cwd, skill, prior) {
  if (!existsSync(skillFile(cwd, skill.name))) return { state: 'absent' };
  return skill.via === 'impeccable' ? surveyImpeccable(cwd, prior) : surveyLocked(cwd, skill);
}

function verifySkill(cwd, skill) {
  if (!existsSync(skillFile(cwd, skill.name))) return { problem: `no .claude/skills/${skill.name}/SKILL.md` };
  if (skill.via === 'impeccable') return {};
  const lock = readLock(cwd);
  if (lock.state === 'unreadable') return { problem: 'skills-lock.json unreadable' };
  const commit = lock.skills?.[skill.name]?.commit;
  if (commit === undefined) return { problem: `no skills-lock.json entry for ${skill.name}` };
  if (commit !== skill.pin) return { problem: `skills-lock.json commit for ${skill.name} is ${commit}, expected ${skill.pin}` };
  return {};
}

// ---- the spawn

function removeQuietly(dir) {
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* a leftover temp dir is harmless */ }
}

// Files, not pipes, as in plugins.mjs: a grandchild holding an inherited pipe would keep
// spawnSync alive past the timeout. The command string holds only constants.
function spawnSkill(skill, { cwd, spawn, timeoutMs, env, platform }) {
  const dir = mkdtempSync(join(tmpdir(), 'cc-frontend-'));
  const fds = [];
  try {
    fds.push(openSync(join(dir, 'out'), 'w'), openSync(join(dir, 'err'), 'w'));
    const childEnv = { ...env, DISABLE_TELEMETRY: '1', DO_NOT_TRACK: '1' };
    if (platform === 'win32') childEnv.NoDefaultCurrentDirectoryInExePath = '1';
    const options = { cwd, env: childEnv, timeout: timeoutMs, windowsHide: true, stdio: ['ignore', fds[0], fds[1]] };
    const result = platform === 'win32' ? spawn(commandLine(skill), { ...options, shell: true }) : spawn('npx', installArgs(skill), options);
    return { ...result, stderrText: readFileSync(join(dir, 'err'), 'utf8') };
  } finally {
    for (const fd of fds) closeSync(fd);
    removeQuietly(dir);
  }
}

// Returns the reason the install did not happen, or null on exit 0.
function failureReason(result, { timeoutMs, platform }) {
  const notFound = result.error?.code === 'ENOENT' || (platform === 'win32' && (result.status === 9009 || /is not recognized/i.test(result.stderrText ?? '')));
  if (notFound) return 'npx not found on PATH';
  if (result.error?.code === 'ETIMEDOUT' || result.signal === 'SIGTERM') return `timed out after ${formatTimeout(timeoutMs)}`;
  if (result.error) return `unexpected error: ${result.error.message}`;
  if (result.signal) return `signal ${result.signal}`;
  return result.status === 0 ? null : `exit ${result.status}`;
}

const nodeBelowFloor = (version) => {
  const parse = (v) => v.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const [have, need] = [parse(version), parse(SKILLS_CLI_NODE_FLOOR)];
  for (let i = 0; i < 3; i++) if (have[i] !== need[i]) return have[i] < need[i];
  return false;
};

// ---- consent

function consent({ withFrontendSkills, isInteractive, ask, prior }) {
  if (withFrontendSkills) return { accepted: true, reason: null };
  if (!isInteractive) return { accepted: false, choice: 'skipped', reason: 'non-interactive run' };
  if (prior?.choice === 'declined') return { accepted: false, choice: 'declined', reason: 'declined on an earlier run' };
  let answer;
  try { answer = ask(DISCLOSURE + CONSENT_PROMPT); } catch { answer = null; }
  return acceptsAnswer(answer) ? { accepted: true, reason: null } : { accepted: false, choice: 'declined', reason: 'declined' };
}

// ---- one skill's outcome: a status, the report line and, for Impeccable, its file digests

const manual = (skill) => `to install it yourself: ${commandLine(skill)}`;
const line = (skill, text) => `frontend design skill ${skill.name}: ${text}`;

function impeccableFiles(cwd) {
  try { return digestTree(join(cwd, '.claude', 'skills', 'impeccable')); } catch { return {}; }
}

function installOne(skill, ctx) {
  if (skill.via === 'skills' && nodeBelowFloor(ctx.nodeVersion)) {
    return { status: 'not installed', stderr: line(skill, `not installed (needs Node >= 22.20, found ${ctx.nodeVersion}); ${manual(skill)}`) };
  }
  const failure = failureReason(spawnSkill(skill, ctx), ctx);
  if (failure) return { status: 'not installed', stderr: line(skill, `not installed (${failure}); ${manual(skill)}`) };
  const { problem } = verifySkill(ctx.cwd, skill);
  if (problem) return { status: 'not verified', stderr: line(skill, `not verified (${problem})`) };
  if (skill.via !== 'impeccable') return { status: 'installed', stdout: line(skill, `installed (${skill.pin})`) };
  const files = impeccableFiles(ctx.cwd);
  if (hasImpeccableHook(ctx.cwd)) return { status: 'installed', files, stdout: line(skill, `installed (${skill.pin})`) };
  return { status: 'installed without its design hook', files, stderr: line(skill, `installed without its design hook (${NO_HOOK})`) };
}

function surveyedOutcome(skill, found) {
  if (found.state === 'already installed') return { status: found.state, files: found.files, stdout: line(skill, 'already installed') };
  return { status: found.state, stderr: line(skill, `present at a different revision (${found.detail}); not changed`) };
}

function declinedLines(skills, reason) {
  const summary = `frontend design skills not installed (${reason}; pass --with-frontend-skills to install them)`;
  if (reason === 'declined on an earlier run') return [summary];
  return [summary, ...skills.map((s) => `to install ${s.name} yourself: ${commandLine(s)}`)];
}

// ---- the record

function recordEntry(skill, outcome) {
  const entry = { name: skill.name, source: skill.source, pin: skill.pin, status: outcome.status };
  if (skill.via === 'impeccable' && outcome.files) entry.files = outcome.files;
  return entry;
}

function writeRecord(cwd, { choice, reason, outcomes }) {
  const body = { choice, reason, cli: SKILLS_CLI, skills: FRONTEND_SKILLS.map((skill, i) => recordEntry(skill, outcomes[i])) };
  try {
    mkdirSync(join(cwd, '.claude'), { recursive: true });
    writeAtomic(join(cwd, CHOICE_FILE), `${JSON.stringify(body, null, 2)}\n`);
    return null;
  } catch (e) {
    return `could not record the frontend skills choice (${e.code ?? e.message})`;
  }
}

function collect(outcomes, extra = []) {
  const stdout = outcomes.map((o) => o.stdout).filter(Boolean);
  const stderr = [...outcomes.map((o) => o.stderr).filter(Boolean), ...extra];
  return { stdout, stderr };
}

function offer(options) {
  const { cwd, withFrontendSkills, isInteractive, ask } = options;
  const prior = readChoice(cwd);
  const surveyed = FRONTEND_SKILLS.map((skill) => surveySkill(cwd, skill, prior));
  const present = surveyed.map((found, i) => (found.state === 'absent' ? null : surveyedOutcome(FRONTEND_SKILLS[i], found)));
  if (!present.includes(null)) {
    const recordError = writeRecord(cwd, { choice: prior?.choice ?? 'skipped', reason: 'nothing to install', outcomes: present });
    return collect(present, recordError ? [recordError] : []);
  }
  const decision = consent({ withFrontendSkills, isInteractive, ask, prior });
  if (!decision.accepted) {
    const absent = FRONTEND_SKILLS.filter((_, i) => present[i] === null);
    const outcomes = present.map((o) => o ?? { status: 'not installed' });
    const recordError = writeRecord(cwd, { choice: decision.choice, reason: decision.reason, outcomes });
    const shown = collect(present.filter(Boolean));
    return { stdout: shown.stdout, stderr: [...shown.stderr, ...declinedLines(absent, decision.reason), ...(recordError ? [recordError] : [])] };
  }
  const outcomes = FRONTEND_SKILLS.map((skill, i) => present[i] ?? installOne(skill, options));
  const recordError = writeRecord(cwd, { choice: 'accepted', reason: null, outcomes });
  return collect(outcomes, recordError ? [recordError] : []);
}

// Never throws: every outcome is lines for bin to print, and the install itself never fails.
export function offerFrontendSkills({ cwd, withFrontendSkills = false, isInteractive = false, ask = askOnTerminal, spawn = spawnSync, timeoutMs = FRONTEND_TIMEOUT_MS, env = process.env, platform = process.platform, nodeVersion = process.versions.node } = {}) {
  try {
    return offer({ cwd, withFrontendSkills, isInteractive, ask, spawn, timeoutMs, env, platform, nodeVersion });
  } catch (e) {
    return { stdout: [], stderr: [`frontend design skills: unexpected error: ${e.message}`] };
  }
}
