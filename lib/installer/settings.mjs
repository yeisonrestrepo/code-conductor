import { readFileSync, writeFileSync, copyFileSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';

const FINGERPRINT = 'verbosity-remind.sh';
const MAX_MALFORMED_BACKUPS = 5;

function utcStamp(d) {
  // Date.toISOString() is ALWAYS UTC (trailing Z). Strip the separators and the
  // fractional millis: 2026-07-05T12:34:56.789Z -> 20260705T123456Z. Fixed width,
  // so lexical filename order == chronological order (drives pruneMalformedBackups).
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

function entryHasCommand(entry, predicate) {
  return entry && Array.isArray(entry.hooks) && entry.hooks.some(h => h && predicate(h));
}

function backupMalformed(settingsPath, now) {
  const dst = `${settingsPath}.malformed-backup.${utcStamp(now)}`;
  copyFileSync(settingsPath, dst);
  pruneMalformedBackups(settingsPath);
}

export function pruneMalformedBackups(settingsPath, keep = MAX_MALFORMED_BACKUPS) {
  const dir = dirname(settingsPath);
  const prefix = `${basename(settingsPath)}.malformed-backup.`;
  const backups = readdirSync(dir).filter(n => n.startsWith(prefix)).sort();
  for (const n of backups.slice(0, Math.max(0, backups.length - keep))) {
    try { unlinkSync(join(dir, n)); } catch { /* best effort */ }
  }
}

export function mergeVerbosityHook(settingsPath, hookCmd, now = new Date()) {
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

  arr = arr.filter(e => !entryHasCommand(e, h => typeof h.command === 'string' && h.command.includes(FINGERPRINT)));
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
