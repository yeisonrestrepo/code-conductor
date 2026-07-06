#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveAssetRoot, resolveHome, nodeMajorAtLeast } from '../lib/installer/env.mjs';
import { assertAssets, deployGlobal, deployProject, chmodHooks } from '../lib/installer/deploy.mjs';
import { verbosityHookCommand, mergeVerbosityHook } from '../lib/installer/settings.mjs';
import { writeVerbosity, seedMemoryFile, writeVersionFile } from '../lib/installer/config.mjs';

const USAGE = `Usage: code-conductor [--project] [--verbosity MIN|INFO|VERBOSE] [--version] [--help]`;

// Hand-rolled parser (four flags only). Deliberately NOT node:util's parseArgs —
// the CLI honors the zero-runtime-dependency rule and node:util adds no value for
// this tiny surface, so nothing is imported for argument handling.
// Conflict policy: flags are LAST-WINS. `--verbosity MIN --verbosity VERBOSE`
// yields VERBOSE (each match overwrites opts.verbosity); a repeated `--project`
// is idempotent. No "conflicting flags" error is raised — last-wins is the least
// surprising CLI convention and keeps the parser branchless.
function parseArgs(argv) {
  const opts = { project: false, verbosity: undefined, verbosityGiven: false, version: false, help: false, unknown: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project') opts.project = true;
    else if (a === '--verbosity' || a.startsWith('--verbosity=')) {
      opts.verbosityGiven = true;
      if (a.startsWith('--verbosity=')) {
        // Inline form: --verbosity=INFO. Empty (`--verbosity=`) leaves value ''.
        // Surrounding whitespace (e.g. a quoted `--verbosity= VERBOSE `) is NOT
        // stripped here — normalizeVerbosity() trims before matching, so whitespace
        // is tolerated and a whitespace-only/`=`-only value normalizes to null → MIN+warn.
        opts.verbosity = a.slice('--verbosity='.length);
      } else {
        // Space-separated form: consume the next token only if it is a real value,
        // not another flag or the end of argv (`--verbosity` passed last). A missing
        // value stays undefined and falls back to MIN + warning in writeVerbosity.
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) { opts.verbosity = next; i++; }
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

// log(stream, msg) is injected so tests capture output without spawning a process.
export function run(argv, env = process.env, { cwd = process.cwd(), log } = {}) {
  const emit = log || ((stream, msg) => process[stream].write(`${msg}\n`));

  // Hard runtime floor: refuse to run on Node < 20 with a clear message rather than
  // failing obscurely inside cpSync/ESM later. env.node lets tests inject a version.
  if (!nodeMajorAtLeast(20, env.node)) {
    emit('stderr', `code-conductor: Node >=20 required, found ${env.node || process.versions.node}`);
    return 1;
  }

  const assetRoot = resolveAssetRoot();
  const opts = parseArgs(argv);

  if (opts.unknown.length) emit('stderr', `code-conductor: ignoring unrecognized argument(s): ${opts.unknown.join(' ')}`);

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
    writing = true;                                                    // copy phase begins
    const claudeDir = deployGlobal(assetRoot, home);
    chmodHooks(claudeDir);
    seedMemoryFile(home, 'personal.md', assetRoot);
    const v = writeVerbosity(home, assetRoot, opts.verbosity, opts.verbosityGiven);
    if (v.warn) emit('stderr', v.warn);
    mergeVerbosityHook(join(claudeDir, 'settings.json'), verbosityHookCommand(home));
    writeVersionFile(home, pkgVersion(assetRoot));
    if (opts.project) deployProject(assetRoot, cwd);
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
    if (err.code === 'PROJECT_TARGET_NOT_DIR') { emit('stderr', `code-conductor: ${err.message}`); return 1; }
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
