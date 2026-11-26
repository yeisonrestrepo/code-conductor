import { existsSync, readFileSync } from 'node:fs';
// This merger lives in its own module for one structural reason: file-merge.mjs
// already imports utcStamp and pruneBackups from settings.mjs, so putting a
// function that needs resolveRealTarget into settings.mjs would close an import
// cycle. Sitting downstream of both keeps the graph acyclic.
import { backupMalformed } from './settings.mjs';
import { resolveRealTarget, writeAtomic } from './file-merge.mjs';
import { MERGE_OWNED_KEYS } from './host-owned.mjs';

// An entry is one { matcher, hooks: [...] } object inside a hook-event array.
// It belongs to the conductor when ANY of its commands carries the fingerprint,
// because a single shipped entry can hold several commands (the template's
// UserPromptSubmit entry holds three). Substring matching is deliberate and its
// limitation is recorded in the spec: a host command that merely mentions a
// conductor hook's filename is captured as owned. Narrowing that would need a
// marker written into every existing install.
export function entryMatches(entry, fingerprint) {
  if (!entry || typeof entry !== 'object' || !Array.isArray(entry.hooks)) return false;
  return entry.hooks.some((h) => h && typeof h.command === 'string' && h.command.includes(fingerprint));
}

// Exact-command twin of entryMatches, for commands an older release shipped.
function entryHasCommand(entry, command) {
  if (!entry || typeof entry !== 'object' || !Array.isArray(entry.hooks)) return false;
  return entry.hooks.some((h) => h && typeof h.command === 'string' && h.command === command);
}

export function matchingFingerprints(entry, fingerprints) {
  return fingerprints.filter((fp) => entryMatches(entry, fp));
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Replace the FIRST host entry carrying this fingerprint where it already sits,
// and drop any later duplicate. In-place replacement is what makes a re-run's
// diff read as restraint rather than as the installer having rearranged a file
// it does not own. Dropping later duplicates repairs a file an older merge
// duplicated; without it a stale copy would survive forever.
// `legacy` lists the exact commands an older release shipped for this entry: a
// command that changed so much it no longer carries the current fingerprint
// would otherwise never be found, and the stale (here fail-open) copy would stay
// next to the new one. They match by equality so a host command that only
// resembles one stays host-owned (BUG-096). `legacyHit` tells the caller such a copy was replaced or
// dropped, so it can report an edit the user must re-trust.
function upsertEntry(arr, tplEntry, fingerprint, legacy = []) {
  const ours = (e) => entryMatches(e, fingerprint) || legacy.some((cmd) => entryHasCommand(e, cmd));
  const idx = arr.findIndex(ours);
  if (idx === -1) return { entries: [...arr, tplEntry], legacyHit: false };
  const legacyHit = arr.some((e, i) => i >= idx && ours(e) && !entryMatches(e, fingerprint));
  const entries = arr
    .map((e, i) => (i === idx ? tplEntry : e))
    .filter((e, i) => i === idx || !ours(e));
  return { entries, legacyHit };
}

// Merge the template's hook events into the host's, event by event. A host event
// the template does not ship is carried through untouched.
function mergeHookTree(hostHooks, tplHooks, fingerprints, legacyCommands) {
  const next = { ...hostHooks };
  let legacyHit = false;
  for (const [event, tplEntries] of Object.entries(tplHooks)) {
    if (!Array.isArray(tplEntries)) continue;
    let arr = Array.isArray(hostHooks[event]) ? [...hostHooks[event]] : [];
    for (const tplEntry of tplEntries) {
      const fps = matchingFingerprints(tplEntry, fingerprints);
      // A shipped entry matching zero or several fingerprints cannot be paired
      // with a host entry safely: appending it blindly would duplicate it on
      // every re-run. Skip it, and let the forward-coverage test in
      // templates.test.js be the thing that fails loudly.
      if (fps.length !== 1) continue;
      const result = upsertEntry(arr, tplEntry, fps[0], legacyCommands[fps[0]]);
      arr = result.entries;
      legacyHit = legacyHit || result.legacyHit;
    }
    next[event] = arr;
  }
  return { hooks: next, legacyHit };
}

// Merge the template's hook entries into the host's settings.json, touching no
// top-level key outside MERGE_OWNED_KEYS. `fingerprints` names the entries this
// installer OWNS on that surface; an entry matching none of them is host-owned
// and is never read, moved or rewritten.
export function mergeSettingsFile(templatePath, settingsPath, fingerprints, { now = new Date(), legacyCommands = {} } = {}) {
  if (!existsSync(templatePath)) return 'skipped-missing-template';
  const templateText = readFileSync(templatePath, 'utf8');

  // Writing through the resolved path keeps a settings.json symlinked into a
  // dotfiles repo a symlink, exactly as the CLAUDE.md merge already does.
  const target = resolveRealTarget(settingsPath);
  if (target.isDir) return 'skipped-dir';
  if (target.dangling) return 'skipped-dangling';

  // A fresh install takes the template verbatim. This is the ONLY moment the
  // permissions block is ever written; after it, permissions is host-owned
  // forever, including a grant the operator removed.
  if (!target.exists) {
    writeAtomic(target.realPath, templateText);
    return 'created';
  }

  const raw = readFileSync(target.realPath, 'utf8');
  // A zero-byte or whitespace-only file is an uninitialized config, not a
  // malformed one, matching what mergeHook already does.
  let host = {};
  if (raw.trim() !== '') {
    try { host = JSON.parse(raw); } catch { host = undefined; }
  }
  // Genuine invalid JSON, or a valid non-object root: back it up, then write the
  // template so the host is never left without a working settings file.
  if (host === undefined || !isPlainObject(host)) {
    backupMalformed(target.realPath, now);
    writeAtomic(target.realPath, templateText);
    return 'malformed-replaced';
  }

  const template = JSON.parse(templateText);
  const tplHooks = isPlainObject(template.hooks) ? template.hooks : {};
  // The ONLY assignment into the host object in this whole function, and it is
  // guarded by the constant. That is what makes MERGE_OWNED_KEYS a declaration
  // rather than a comment: permissions, env, statusLine, model and every key a
  // future Claude Code adds are host-owned because no line here can reach them.
  const merged = { ...host };
  let legacyHit = false;
  if (MERGE_OWNED_KEYS.includes('hooks') && Object.keys(tplHooks).length > 0) {
    const tree = mergeHookTree(isPlainObject(host.hooks) ? host.hooks : {}, tplHooks, fingerprints, legacyCommands);
    merged.hooks = tree.hooks;
    legacyHit = tree.legacyHit;
  }

  const text = `${JSON.stringify(merged, null, 2)}\n`;
  // Skipping an identical write is what makes a re-run of an unchanged release
  // byte-identical AND leaves the file's mtime alone. The host's line endings
  // are not content: a CRLF file (a Windows autocrlf checkout, or an editor's
  // choice) that matches after normalizing is left as it is.
  if (text === raw.replace(/\r\n/g, '\n')) return 'unchanged';
  writeAtomic(target.realPath, text);
  return legacyHit ? 'legacy-replaced' : 'merged';
}
