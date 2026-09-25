import { readFileSync, writeFileSync, copyFileSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';

const FINGERPRINT = 'verbosity-remind.sh';
const GRAPHIFY_FINGERPRINT = 'graphify-ast-refresh';
const MAX_MALFORMED_BACKUPS = 5;
const MALFORMED_SUFFIX = '.malformed-backup.';

// Date.toISOString() is ALWAYS UTC (trailing Z). Strip the separators and the
// fractional millis: 2026-07-05T12:34:56.789Z -> 20260705T123456Z. Fixed width,
// so lexical filename order == chronological order (drives pruneBackups).
// Exported because the CLAUDE.md/.gitignore writer reuses it — duplicating this
// format would silently break the pruner's ordering assumption.
export function utcStamp(d) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

export function verbosityHookCommand(home) {
  // Normalize backslashes to forward slashes: the command is executed by `bash`
  // (Git Bash/WSL on Windows), which treats `\` as an escape char, so a native
  // Windows path would break. Forward slashes are valid on every platform and keep
  // the stored command byte-stable, which is what the idempotency check compares.
  const hookPath = join(home, '.claude', 'hooks', 'verbosity-remind.sh').replace(/\\/g, '/');
  return `bash ${hookPath}`;
}

export function graphifyHookCommand(home) {
  // Same absolute-path rule as verbosityHookCommand, for a second reason: a hook
  // `command` with no `args` runs under PowerShell on a Windows host without Git
  // Bash, and PowerShell does not expand a bare `~/...` passed to an external
  // program. The installer is the only party that knows the host's home, so the
  // shipped settings.json carries no graphify entry at all.
  const hookPath = join(home, '.claude', 'hooks', 'graphify-ast-refresh.mjs').replace(/\\/g, '/');
  return `node ${hookPath}`;
}

function entryHasCommand(entry, predicate) {
  return entry && Array.isArray(entry.hooks) && entry.hooks.some(h => h && predicate(h));
}

function backupMalformed(settingsPath, now) {
  const dst = `${settingsPath}${MALFORMED_SUFFIX}${utcStamp(now)}`;
  copyFileSync(settingsPath, dst);
  pruneMalformedBackups(settingsPath);
}

// Generalized over the suffix family so one pruner serves both the malformed
// settings.json backups and the installer backups written beside CLAUDE.md and
// .gitignore. Sorting is lexical, which equals chronological only because every
// name embeds a fixed-width utcStamp.
export function pruneBackups(filePath, suffix, keep = MAX_MALFORMED_BACKUPS) {
  const dir = dirname(filePath);
  const prefix = `${basename(filePath)}${suffix}`;
  const backups = readdirSync(dir).filter(n => n.startsWith(prefix)).sort();
  for (const n of backups.slice(0, Math.max(0, backups.length - keep))) {
    try { unlinkSync(join(dir, n)); } catch { /* best effort */ }
  }
}

export function pruneMalformedBackups(settingsPath, keep = MAX_MALFORMED_BACKUPS) {
  pruneBackups(settingsPath, MALFORMED_SUFFIX, keep);
}

// One merge serves both hooks: same malformed-file handling, same idempotency
// rule, same canonical two-space write. `fingerprint` is the substring naming
// the entry this repo OWNS. Every entry matching it is replaced by hookCmd, so
// manual edits to an owned entry are discarded by design; every entry that does
// not match is left exactly as it was.
function mergeHook(settingsPath, hookCmd, fingerprint, now) {
  // A missing settings.json (ENOENT) is not an error: initialize a fresh, empty
  // config object and let the merge create the file. The existsSync check plus
  // the ENOENT catch guard against both the plain-missing case and a TOCTOU
  // delete between the check and the read.
  let raw = '{}';
  if (existsSync(settingsPath)) {
    try { raw = readFileSync(settingsPath, 'utf8'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  // A zero-byte or whitespace-only file is NOT malformed — it is an uninitialized
  // config. Treat it as an empty object and merge (matching install.sh, which starts
  // from {} on an empty file). Only genuine non-empty invalid JSON triggers a backup.
  if (raw.trim() === '') raw = '{}';
  let obj;
  try { obj = JSON.parse(raw); } catch { backupMalformed(settingsPath, now); return { status: 'malformed-skipped' }; }
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    backupMalformed(settingsPath, now);
    return { status: 'malformed-skipped' };
  }
  if (typeof obj.hooks !== 'object' || obj.hooks === null || Array.isArray(obj.hooks)) obj.hooks = {};
  let arr = Array.isArray(obj.hooks.UserPromptSubmit) ? obj.hooks.UserPromptSubmit : [];

  if (arr.some(e => entryHasCommand(e, h => h.command === hookCmd))) return { status: 'idempotent-skip' };

  arr = arr.filter(e => !entryHasCommand(e, h => typeof h.command === 'string' && h.command.includes(fingerprint)));
  arr.push({ matcher: '', hooks: [{ type: 'command', command: hookCmd }] });
  obj.hooks.UserPromptSubmit = arr;
  // Enforce 2-space indentation (matches install.sh's JSON.stringify(d,null,2) and the
  // bundled settings.json) rather than detecting/preserving the user's indent width —
  // one canonical format keeps diffs stable and the merge deterministic. The `+ '\n'`
  // appends the single trailing newline POSIX text files expect (and that the bundled
  // settings.json already ends with). Explicit utf8 encoding.
  writeFileSync(settingsPath, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  return { status: 'merged' };
}

export function mergeVerbosityHook(settingsPath, hookCmd, now = new Date()) {
  return mergeHook(settingsPath, hookCmd, FINGERPRINT, now);
}

export function mergeGraphifyHook(settingsPath, hookCmd, now = new Date()) {
  return mergeHook(settingsPath, hookCmd, GRAPHIFY_FINGERPRINT, now);
}
