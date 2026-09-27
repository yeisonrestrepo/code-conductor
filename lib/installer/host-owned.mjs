import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

// One policy per host-owned path, keyed by the path RELATIVE to that surface's
// copy source and always spelled with forward slashes. The audit behind BUG-039
// found three distinct required behaviors, which is why this is a table and not
// a skip list:
//   'skip'  never written by the installer, and no template copy exists
//   'seed'  written from the template only when the target is absent
//   'merge' host content combined with the installer-owned parts
// There is no fourth policy and no default: a path absent from the table keeps
// the force-copy, and the coverage tests in templates.test.js are what stop that
// default from silently swallowing a newly shipped host-owned file.

// ~/.claude/. Only personal.md and verbosity.md ship under global/memory/;
// conductor-version.md is written there by writeVersionFile, is installer-owned,
// and needs no entry because nothing ships that filename.
export const GLOBAL_HOST_OWNED = new Map([
  ['memory/personal.md', 'seed'],
  ['memory/verbosity.md', 'seed'],
  ['CLAUDE.md', 'merge'],
  ['settings.json', 'merge'],
  ['settings.local.json', 'skip'],
]);

// <cwd>/.claude/. Only project.md and context-threshold.txt ship. Every 'skip'
// below is a file the host or a conductor command writes at runtime and the
// template must never start shipping; each is protected today only by its
// absence from the template, which is exactly what this table replaces.
export const PROJECT_HOST_OWNED = new Map([
  ['memory/project.md', 'seed'],
  ['memory/context-threshold.txt', 'seed'],
  ['memory/personal.md', 'skip'],
  ['memory/bash-scan-allowlist.txt', 'skip'],
  ['memory/session-snapshot.json', 'skip'],
  ['memory/session-snapshot.md', 'skip'],
  ['memory/turn-count.txt', 'skip'],
  ['settings.json', 'merge'],
  ['settings.local.json', 'skip'],
]);

// The ONLY top-level settings.json keys the merge may write into an existing
// host file. Declared rather than implied: permissions, env, statusLine, model
// and every key a future Claude Code adds are host-owned by construction, and
// a test asserts the merge writes nothing outside this list. Unioning a
// template's permissions into a host's file would silently restore a grant the
// operator deliberately revoked, which is a ratchet that only loosens.
export const MERGE_OWNED_KEYS = ['hooks'];

// global/settings.json ships no hooks: its two entries are synthesized from the
// host's absolute home by settings.mjs and merged there. Empty is the correct
// value, and the forward-coverage test is what will catch the day that changes.
export const GLOBAL_SETTINGS_FINGERPRINTS = [];

// One fingerprint per shipped entry in project-template/.claude/settings.json,
// and exactly one: the UserPromptSubmit entry carries three commands in a single
// entry, so fingerprinting context-guard.sh as well would make that entry match
// two, which the forward-coverage test rejects by design.
export const PROJECT_SETTINGS_FINGERPRINTS = [
  'pre-tool-use.mjs',
  'post-compact.sh',
  'verbosity-remind.sh',
];

// cpSync filter: exclude exactly the table's own paths, nothing more. A parent
// directory is never excluded, so cpSync still creates it and a sibling managed
// file inside it is still copied. Matching on the path RELATIVE to the copy
// source is load-bearing: matching on the absolute path would let a host whose
// home happens to contain "/memory/" exclude the whole tree.
export function hostOwnedFilter(sourceRoot, table) {
  return (src) => {
    const rel = relative(sourceRoot, src);
    if (rel === '') return true;
    return !table.has(rel.split(sep).join('/'));
  };
}

// Write-if-absent for every 'seed' entry. A template source that does not exist
// is skipped rather than throwing: a damaged or hand-edited package should not
// abort a deploy whose managed assets have already landed.
export function seedHostOwned(sourceRoot, targetRoot, table) {
  const seeded = [];
  for (const [rel, policy] of table) {
    if (policy !== 'seed') continue;
    const parts = rel.split('/');
    const src = join(sourceRoot, ...parts);
    const dst = join(targetRoot, ...parts);
    if (existsSync(dst) || !existsSync(src)) continue;
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(src, dst);
    seeded.push(rel);
  }
  return seeded;
}
