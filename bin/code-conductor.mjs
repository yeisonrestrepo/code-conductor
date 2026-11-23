#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveAssetRoot, resolveHome, nodeMajorAtLeast } from '../lib/installer/env.mjs';
import { assertAssets, assertMergeTargets, assertNotSelfInstall, deployGlobal, deployProject, chmodHooks } from '../lib/installer/deploy.mjs';
import { verbosityHookCommand, mergeVerbosityHook } from '../lib/installer/settings.mjs';
import { healGraphifyHook } from '../lib/installer/heal.mjs';
import { writeVerbosity, writeVersionFile } from '../lib/installer/config.mjs';
import { offerSuperpowers, NOTICES } from '../lib/installer/plugins.mjs';

const USAGE = `Usage: code-conductor [--project|-Project] [--no-deps|-NoDeps] [--verbosity|-Verbosity MIN|INFO|VERBOSE] [--opencode] [--antigravity] [--with-plugins] [--version] [--help]`;

// -Verbosity is the spelling the retired install.ps1 documented. Both spellings share
// every form (space-separated, inline `=`, missing value) and last-wins across them.
const VERBOSITY_FLAGS = ['--verbosity', '-Verbosity'];
const isVerbosityFlag = (a) => VERBOSITY_FLAGS.some((f) => a === f || a.startsWith(`${f}=`));

// Hand-rolled parser (five flags only). Deliberately NOT node:util's parseArgs —
// the CLI honors the zero-runtime-dependency rule and node:util adds no value for
// this tiny surface, so nothing is imported for argument handling.
// Conflict policy: flags are LAST-WINS. `--verbosity MIN --verbosity VERBOSE`
// yields VERBOSE (each match overwrites opts.verbosity); a repeated `--project`
// is idempotent. No "conflicting flags" error is raised — last-wins is the least
// surprising CLI convention and keeps the parser branchless.
function parseArgs(argv) {
  const opts = { project: false, opencode: false, antigravity: false, noDeps: false, withPlugins: false, verbosity: undefined, verbosityGiven: false, version: false, help: false, unknown: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    // -Project is the spelling the retired install.ps1 documented; matched exact-case
    // like every other flag here.
    if (a === '--project' || a === '-Project') opts.project = true;
    // Accepted no-op since FEAT-023 removed the shell installers: recognized so callers
    // carried over from install.sh get no misleading "unrecognized" warning. It does not
    // affect the superpowers offer, which only --with-plugins or the prompt controls.
    else if (a === '--no-deps' || a === '-NoDeps') opts.noDeps = true;
    // FEAT-048: also install the OpenCode guard plugin; meaningful only with --project.
    else if (a === '--opencode') opts.opencode = true;
    // FEAT-048 slice 2: also install the Antigravity CLI guard; meaningful only with --project.
    else if (a === '--antigravity') opts.antigravity = true;
    // FEAT-039: consent to install the superpowers plugin without asking; the only way a
    // non-interactive run installs it. Matched exact-case like every other flag.
    else if (a === '--with-plugins') opts.withPlugins = true;
    else if (isVerbosityFlag(a)) {
      opts.verbosityGiven = true;
      if (a.includes('=')) {
        // Inline form: --verbosity=INFO. Empty (`--verbosity=`) leaves value ''.
        // Surrounding whitespace (e.g. a quoted `--verbosity= VERBOSE `) is NOT
        // stripped here — normalizeVerbosity() trims before matching, so whitespace
        // is tolerated and a whitespace-only/`=`-only value normalizes to null → MIN+warn.
        opts.verbosity = a.slice(a.indexOf('=') + 1);
      } else {
        // Space-separated form: consume the next token only if it is a real value,
        // not another flag or the end of argv (`--verbosity` passed last). A missing
        // value stays undefined and falls back to MIN + warning in writeVerbosity.
        // Any `-` prefix marks a flag, so single-dash aliases are never eaten as the
        // level; no valid level starts with `-`.
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('-')) { opts.verbosity = next; i++; }
      }
    }
    else if (a === '--version' || a === '-v') opts.version = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    // Unrecognized flags / stray positionals are collected, not fatal: the install
    // still proceeds (exit 0) but run() emits one stderr warning so typos surface.
    else opts.unknown.push(a);
  }
  return opts;
}

function pkgVersion(assetRoot) {
  return JSON.parse(readFileSync(join(assetRoot, 'package.json'), 'utf8')).version;
}

// FEAT-039: the last setup step, fail-open. Its own try keeps it out of run()'s exit
// classes: nothing here can turn a finished deploy into an exit 1 or 2.
function offerPlugins(emit, options) {
  try {
    const result = offerSuperpowers(options);
    if (NOTICES[result.status]) emit('stdout', `code-conductor: ${NOTICES[result.status]}`);
    for (const line of result.lines) emit('stderr', `code-conductor: ${line}`);
  } catch { /* fail-open: a reporting error never changes the exit code */ }
}

// log(stream, msg) is injected so tests capture output without spawning a process. The
// plugin options (FEAT-039) let tests replace the TTY check, the prompt, the spawn, the
// timeout and the child's env, so no test can prompt or reach a real claude.
export function run(argv, env = process.env, { cwd = process.cwd(), log, nodeVersion = process.versions.node, isInteractive = Boolean(process.stdin.isTTY && process.stdout.isTTY), ask, spawn, pluginTimeoutMs, pluginEnv = process.env } = {}) {
  const emit = log || ((stream, msg) => process[stream].write(`${msg}\n`));

  // Hard runtime floor: refuse to run on Node < 20 with a clear message rather than
  // failing obscurely inside cpSync/ESM later. The version comes from options, never env:
  // on Windows env lookups are case-insensitive and npm sets NODE to node.exe's path,
  // so a lowercase node key read that path (BUG-060).
  if (!nodeMajorAtLeast(20, nodeVersion)) {
    emit('stderr', `code-conductor: Node >=20 required, found ${nodeVersion}`);
    return 1;
  }

  const assetRoot = resolveAssetRoot();
  const opts = parseArgs(argv);

  if (opts.unknown.length) emit('stderr', `code-conductor: ignoring unrecognized argument(s): ${opts.unknown.join(' ')}`);
  if (opts.opencode && !opts.project) emit('stderr', 'code-conductor: --opencode needs --project; no OpenCode files were written');
  if (opts.antigravity && !opts.project) emit('stderr', 'code-conductor: --antigravity needs --project; no Antigravity files were written');

  // --help and --version are explicit informational OUTPUT (not diagnostics), so they
  // go to STDOUT and exit 0 — this lets `code-conductor --version` be captured in a
  // shell substitution. Only warnings/errors ever go to stderr.
  if (opts.help) { emit('stdout', USAGE); return 0; }
  if (opts.version) { emit('stdout', pkgVersion(assetRoot)); return 0; }

  const home = resolveHome(env);
  if (!home) { emit('stderr', 'code-conductor: cannot resolve home directory (HOME/USERPROFILE unset)'); return 1; }

  // `writing` gates the two exit classes the constraints mandate:
  //   false → pre-flight/environment failure (missing asset, EROFS/EACCES before
  //           the first copy) → exit 1;
  //   true  → any error once a copy has begun is a mid-copy PARTIAL_WRITE → exit 2,
  //           recoverable by an idempotent re-run.
  // The flag is a SINGLE gate spanning BOTH deployment tracks: global runs first and
  // flips it, so by the time --project's deployProject runs, writing is already true.
  // A mid-copy failure in either track is therefore treated identically (exit 2),
  // except the two tagged precondition errors (MISSING_ASSET, PROJECT_TARGET_NOT_DIR)
  // and the environment codes (EROFS/EACCES/EPERM), which are exit 1 regardless.
  let writing = false;
  try {
    assertAssets(assetRoot, ['global', 'skills', 'scripts', 'project-template']); // pre-flight
    assertMergeTargets(home, cwd, opts.project);                                  // pre-flight
    if (opts.project) assertNotSelfInstall(assetRoot, cwd);                       // pre-flight, BUG-052
    writing = true;                                                    // copy phase begins
    const claudeDir = deployGlobal(assetRoot, home, { warn: (m) => emit('stderr', m), report: (m) => emit('stdout', m) });
    chmodHooks(claudeDir);
    const v = writeVerbosity(home, assetRoot, opts.verbosity, opts.verbosityGiven);
    if (v.warn) emit('stderr', v.warn);
    mergeVerbosityHook(join(claudeDir, 'settings.json'), verbosityHookCommand(home));
    // Never throws and never changes the exit code: see healGraphifyHook.
    const heal = healGraphifyHook(home);
    if (heal.status === 'removed') emit('stdout', 'code-conductor: removed the retired graphify-ast-refresh hook from settings.json (backup written beside it)');
    for (const line of heal.lines) emit('stderr', `code-conductor: ${line}`);
    writeVersionFile(home, pkgVersion(assetRoot));
    if (opts.project) deployProject(assetRoot, cwd, { warn: (m) => emit('stderr', m), report: (m) => emit('stdout', m), home, opencode: opts.opencode, antigravity: opts.antigravity });
    offerPlugins(emit, { home, withPlugins: opts.withPlugins, isInteractive, ask, spawn, timeoutMs: pluginTimeoutMs, env: pluginEnv });
    return 0;
  } catch (err) {
    // Pre-flight failures (nothing written yet) → exit 1.
    if (!writing) {
      if (err.code === 'MISSING_ASSET') emit('stderr', `code-conductor: ${err.message}`);
      else if (err.code === 'EROFS') emit('stderr', `code-conductor: cannot write to ${err.path} (read-only file system) — remount writable or adjust permissions`);
      else emit('stderr', `code-conductor: cannot start install: ${err.message}`);
      return 1;
    }
    // Precondition conflict (--project target is a non-directory) → exit 1, not 2:
    // nothing was partially written for the project, the path is simply unusable.
    // SELF_INSTALL is caught in pre-flight; this mapping is the backstop should that ordering ever change.
    if (err.code === 'PROJECT_TARGET_NOT_DIR' || err.code === 'SELF_INSTALL') { emit('stderr', `code-conductor: ${err.message}`); return 1; }
    // Environment errors that surface on the very first write are still exit 1.
    if (err.code === 'EROFS') { emit('stderr', `code-conductor: cannot write to ${err.path} (read-only file system) — remount writable or adjust permissions`); return 1; }
    if (err.code === 'EACCES' || err.code === 'EPERM') { emit('stderr', `code-conductor: permission denied writing ${err.path} — fix with chmod/chown`); return 1; }
    // Any other error mid-copy is a partial write → exit 2 (idempotent re-run repairs it).
    emit('stderr', `code-conductor: PARTIAL_WRITE at ${err.path || 'unknown path'}: ${err.message} — re-run to complete the partial install`);
    return 2;
  }
}

// Compare as file URLs so a Windows path (C:\...\bin\code-conductor.mjs) matches
// import.meta.url; naive `file://` + backslash string concat never would. Node's ESM
// loader sets import.meta.url to the module's REALPATH, so argv[1] must be realpath-
// resolved too — otherwise a symlinked launch path (npx cache, a global prefix, or
// macOS /tmp -> /private/var) never matches and the CLI exits 0 doing nothing.
function invokedDirectly() {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  let resolved;
  try { resolved = realpathSync(argv1); } catch { resolved = argv1; }
  return import.meta.url === pathToFileURL(resolved).href;
}
if (invokedDirectly()) process.exit(run(process.argv.slice(2)));
