import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { backupMalformed } from './settings.mjs';
import { resolveRealTarget, backupFile, writeAtomic } from './file-merge.mjs';

// FEAT-021 retired the graph rung. Deleting the hook from the package deletes nothing
// from hosts, because deployGlobal copies and never removes, and it merges settings.json
// without touching `hooks` (plan M1). This module is the only thing that ever removes
// what earlier releases installed. It follows the BUG-020 purge (remove what we put
// there) and the 1.24.0 flat-skill sweep (remove only on an exact content match).
export const GRAPHIFY_FINGERPRINT = 'graphify-ast-refresh';

// Each file shipped exactly one version (.py @968dc6f, .mjs @5b4a1af), and no published
// tarball carries a CRLF copy (plan M2). The files are gone from the tree, so these
// constants are the only surviving record; tests/installer/heal.test.js pins them.
export const SHIPPED_GRAPHIFY_HASHES = new Map([
  ['graphify-ast-refresh.py', '761199f1650b9a38273ce04b91fffdc8dcd5f73bd9adad957b7bbc1c3e9a800b'],
  ['graphify-ast-refresh.mjs', 'c78e4e5e6989731f8a8ef60e7039c0b17b8e5feaa8ac30ee595441c215282e36'],
]);

const isGraphifyHook = (h) => h && typeof h.command === 'string' && h.command.includes(GRAPHIFY_FINGERPRINT);

// Hooks sharing an entry with ours were never ours: remove only the matching hook and
// drop the entry only when that empties it. Returns null when nothing matched.
function pruneEntries(entries) {
  let changed = false;
  const out = [];
  for (const entry of entries) {
    if (!entry || !Array.isArray(entry.hooks) || !entry.hooks.some(isGraphifyHook)) { out.push(entry); continue; }
    changed = true;
    const kept = entry.hooks.filter((h) => !isGraphifyHook(h));
    if (kept.length > 0) out.push({ ...entry, hooks: kept });
  }
  return changed ? out : null;
}

// UserPromptSubmit only: no release ever wrote the hook under another event.
export function unmergeGraphifyHook(settingsPath, now = new Date()) {
  const target = resolveRealTarget(settingsPath);
  if (!target.exists) return 'absent';
  const raw = readFileSync(target.realPath, 'utf8');
  if (raw.trim() === '') return 'absent';
  let obj;
  try { obj = JSON.parse(raw); } catch { obj = undefined; }
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    backupMalformed(target.realPath, now);
    return 'malformed-skipped';
  }
  const entries = obj.hooks?.UserPromptSubmit;
  if (!Array.isArray(entries)) return 'absent';
  const pruned = pruneEntries(entries);
  if (!pruned) return 'absent';
  backupFile(target.realPath, now);
  obj.hooks.UserPromptSubmit = pruned;
  writeAtomic(target.realPath, `${JSON.stringify(obj, null, 2)}\n`);
  return 'removed';
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

// An unreadable file counts as modified: keeping it is the safe side of the match.
function sweepOne(path, shippedHash) {
  if (!existsSync(path)) return null;
  let hash = null;
  try { hash = sha256(path); } catch { /* treated as modified below */ }
  if (hash !== shippedHash) return `kept ${path} (modified since install); it is no longer used and can be deleted`;
  try { unlinkSync(path); return null; }
  catch (e) { return `could not remove ${path} (${e.code ?? e.message}); it is no longer used and can be deleted`; }
}

export function sweepGraphifyHooks(hooksDir, shipped = SHIPPED_GRAPHIFY_HASHES) {
  const lines = [];
  for (const [name, hash] of shipped) {
    const line = sweepOne(join(hooksDir, name), hash);
    if (line) lines.push(line);
  }
  return lines;
}

// Cleanup of our own leftovers, not deployment, so it is the one deliberate exception to
// run()'s mid-copy failure policy: every failure becomes a line and none escapes. The
// files go only after the entry is gone (or was never there), because deleting a file a
// live entry still names turns a silent hook into an error on every prompt.
export function healGraphifyHook(home, { shipped = SHIPPED_GRAPHIFY_HASHES, now = new Date() } = {}) {
  const claudeDir = join(home, '.claude');
  try {
    const status = unmergeGraphifyHook(join(claudeDir, 'settings.json'), now);
    if (status === 'malformed-skipped') {
      return { status, lines: ['left the graphify-ast-refresh hook files in place: settings.json is malformed and may still reference them'] };
    }
    return { status, lines: sweepGraphifyHooks(join(claudeDir, 'hooks'), shipped) };
  } catch (e) {
    return { status: 'error', lines: [`graphify cleanup skipped: ${e.message}`] };
  }
}
