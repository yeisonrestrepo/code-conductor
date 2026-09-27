# Installer Host-Owned State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the list of host-owned files a pinned, tested contract on both deploy surfaces, so an installer re-run never destroys a file the host owns.

**Architecture:** One new module holds a policy table per deploy surface, mapping each host-owned path to `skip`, `seed` or `merge`, plus the fingerprint sets and `MERGE_OWNED_KEYS`. A second new module holds the generalized, entry-level, fingerprint-driven `settings.json` merge. `deployGlobal` and `deployProject` both consult their table through the same three calls (filter the copy, seed the absent, merge the mergeable), and `skipHostOwned` is deleted. Tests assert the tables cover the shipped trees in both directions and that the merge writes nothing outside the keys it declares.

**Tech Stack:** Node >= 20, ESM, zero runtime dependencies, vitest.

**Spec:** `docs/superpowers/specs/2026-09-27-bug039-installer-host-owned-state-design.md`

## Global Constraints

- Target release **1.30.0** (minor). The installer stops overwriting files it used to overwrite, and `settings.json` gains a merge path.
- **Zero runtime dependencies.** Nothing outside `node:` builtins may be imported by anything under `lib/` or `bin/`.
- **Node >= 20** is the hard floor enforced at `bin/code-conductor.mjs:59`. No syntax or API newer than Node 20.
- **No existing test case may be adjusted to make new code pass** (AC 21). A test may be deleted only when the code it covers is deleted, and that deletion is named in this plan.
- **No em-dashes** in any authored output, including code comments, the changelog and commit messages.
- **BUG-003 invariant:** plan state updates are surgical single-line edits, one checkbox at a time, never a bulk rewrite of this file.
- **BUG-040:** `git add` on a tracked path under `.claude/` exits 1 while staging correctly. Never chain `&&` after such a staging step; use `git add -f` and a separate command.
- **Guard 3 is live in this repository** and scans every `Bash` call. Avoid unquoted `\[ \]`, pipelines into `head`, `cat` heredocs carrying bracket classes, and `for (const x of ...)` inside `node -e`. Use Read, Edit, Write and scratchpad scripts.
- **Owner-scoped convention:** memory and backlog commits may land on `main`; all code work lands on `fix/bug-039-installer-host-owned-state`.
- Test baseline entering this plan: **747 passed, 12 skipped**. Every per-task count below is a prediction. **If a count is off by even one, reconcile before writing the next line of code.**

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `lib/installer/host-owned.mjs` | create | The two policy tables, `MERGE_OWNED_KEYS`, the per-surface fingerprint lists, the `cpSync` filter and the write-if-absent seeder. Data plus two tiny pure-ish helpers, nothing else. |
| `lib/installer/settings-merge.mjs` | create | `mergeSettingsFile`: the entry-level, fingerprint-driven, in-place `settings.json` merge. Imports backup helpers from `settings.mjs` and the symlink/atomic writers from `file-merge.mjs`. Kept out of `settings.mjs` to avoid a `settings.mjs` to `file-merge.mjs` import cycle. |
| `lib/installer/settings.mjs` | modify | Export `backupMalformed` so the new merger reuses it. `mergeVerbosityHook` and `mergeGraphifyHook` are otherwise untouched: they synthesize entries from the host's absolute home and remain the global surface's own mechanism. |
| `lib/installer/deploy.mjs` | modify | Delete `skipHostOwned`. Rewire `deployGlobal` and `deployProject` through the table. Add the `project.md` stub detection to `deployProject`. |
| `lib/installer/config.mjs` | modify | Delete `seedMemoryFile`, absorbed by the table's `seed` policy. |
| `bin/code-conductor.mjs` | modify | Drop the `seedMemoryFile` import and call. Pass a `warn` channel into `deployProject`. |
| `tests/installer/host-owned.test.js` | create | Unit tests for the filter and the seeder. |
| `tests/installer/settings-merge.test.js` | create | Unit tests for the merge: in-place order, idempotency, `MERGE_OWNED_KEYS`, malformed, symlink. |
| `tests/installer/deploy.test.js` | modify | Append the two surfaces' host-owned cases. No existing case changes. |
| `tests/installer/config.test.js` | modify | Delete the `seedMemoryFile` describe block and its import binding, because the function is deleted. |
| `tests/installer/cli.test.js` | modify | Append the end-to-end re-run cases. No existing case changes. |
| `tests/installer/templates.test.js` | modify | Append the shipped-tree contract assertions: table coverage, both fingerprint directions, the pinned `permissions` grant list. |

---

## Interfaces produced by this plan

Every later task depends on these exact names. They are defined in T-001 and T-002 and used unchanged thereafter.

```js
// lib/installer/host-owned.mjs
export const GLOBAL_HOST_OWNED: Map<string, 'skip'|'seed'|'merge'>
export const PROJECT_HOST_OWNED: Map<string, 'skip'|'seed'|'merge'>
export const MERGE_OWNED_KEYS: string[]                       // ['hooks']
export const GLOBAL_SETTINGS_FINGERPRINTS: string[]           // []
export const PROJECT_SETTINGS_FINGERPRINTS: string[]
export function hostOwnedFilter(sourceRoot: string, table: Map): (src: string) => boolean
export function seedHostOwned(sourceRoot: string, targetRoot: string, table: Map): string[]

// lib/installer/settings-merge.mjs
export function entryMatches(entry: unknown, fingerprint: string): boolean
export function matchingFingerprints(entry: unknown, fingerprints: string[]): string[]
export function mergeSettingsFile(
  templatePath: string, settingsPath: string, fingerprints: string[], opts?: { now?: Date }
): 'skipped-dir' | 'skipped-dangling' | 'skipped-missing-template' | 'created'
  | 'malformed-replaced' | 'unchanged' | 'merged'

// lib/installer/settings.mjs (newly exported, body unchanged)
export function backupMalformed(settingsPath: string, now: Date): void
```

---

## Task 0: Land the plan

**Files:**
- Create: `docs/superpowers/plans/2026-09-27-bug039-installer-host-owned-state.md` (this file)

**Interfaces:**
- Consumes: nothing.
- Produces: the committed plan every later task flips checkboxes in.

- [X] [T-000-A] Confirm the working branch is `fix/bug-039-installer-host-owned-state`. Run `git branch --show-current` and compare the output to that exact string. If it differs, stop and report; the branch gate at the end of `/cc-plan` creates it and no task may run before that gate completed.

- [>] [T-000-B] Stage the plan file. `docs/` is gitignored (`.gitignore:8`), so the force flag is required and the exit code cannot be chained.

```bash
git add -f "docs/superpowers/plans/2026-09-27-bug039-installer-host-owned-state.md"
```

- [ ] [T-000-C] Commit the plan.

```bash
git commit -m "docs: add the BUG-039 installer host-owned-state implementation plan

The plan turns the spec's policy tables into two new modules, a pinned
contract per deploy surface and a generalized settings merge, and names
every test that asserts the deploy paths honor them.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HLS5KAHkhpMChyqNTbqrhe"
```

### Spec truth: correct the spec before the code, never contradict it with the code

Two plan decisions changed what the spec asserts. The standing rule of this chain is that the spec is amended first and both documents then read as one truth, so these steps run before any code task.

- [ ] [T-000-D] In `docs/superpowers/specs/2026-09-27-bug039-installer-host-owned-state-design.md`, replace the two fingerprint acceptance criteria (the `:150` backward criterion and the `:151` forward criterion) with per-surface wording plus the global-set rationale. Replace both bullets with:

```markdown
- [ ] A test asserts, per surface, that every conductor fingerprint in that surface's list matches at least one entry in that surface's shipped `settings.json`, so a renamed hook cannot leave a dead fingerprint behind.
- [ ] A test asserts the forward direction, per surface: every hook entry in that surface's shipped `settings.json` matches exactly one conductor fingerprint. Every entry a template ships is by definition conductor-owned, so exhaustive forward coverage is assertable today. Without it, a future release can add a template hook entry and forget its fingerprint, after which the merge either never delivers that entry to existing installs or appends it beside itself on every re-run. The two directions together are the contract; either alone is half.
- [ ] The global surface's fingerprint list is **empty**, because `global/settings.json` ships `permissions` and no hooks at all: its two hook entries are synthesized at install time from the host's absolute home, which is why a bare `~` cannot be shipped (`settings.mjs:27-35`), and `mergeVerbosityHook` and `mergeGraphifyHook` already own them entry-level with their own tested fingerprints. Both directions are therefore vacuous for that file today, and that vacuity is **asserted rather than tolerated**: a test pins `GLOBAL_SETTINGS_FINGERPRINTS` equal to the shipped file's own hook-entry set, empty equalling empty, so the day that file ships a hook entry the forward assertion fails until a fingerprint is added.
```

- [ ] [T-000-E] In the same spec file, correct the stale rationale in the `### Recovery is detection only` section (`:129`). The sentence justifying the "may have been overwritten" wording by a fresh-scaffold false positive is no longer true: detection runs before the seed, so a fresh scaffold cannot warn about the stub it was just given. Replace the final sentence of that paragraph with:

```markdown
The detection runs before the seed, so a fresh scaffold never warns about the stub it was just given and that false-positive class does not exist. The residual one that remains is different and is accepted: a real project scaffolded earlier, worked in little or not at all, whose `project.md` genuinely still equals the stub. That is why the wording says "may have been overwritten" rather than "was".
```

- [ ] [T-000-F] Stage the spec. It sits under the gitignored `docs/`, so the force flag is required and the exit code cannot be chained.

```bash
git add -f "docs/superpowers/specs/2026-09-27-bug039-installer-host-owned-state-design.md"
```

- [ ] [T-000-G] Commit both spec corrections together, because they are one truth-alignment, not two.

```bash
git commit -m "docs: align the BUG-039 spec with the plan's two decisions [BUG-039]

The fingerprint criteria become per-surface and record why the global
list is empty: that file ships no hooks, its two entries are synthesized
from the host's absolute home, and the vacuity is asserted rather than
tolerated. The recovery section's rationale is corrected because the plan
runs stub detection before the seed, which removes the fresh-scaffold
false positive the old sentence was justifying.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HLS5KAHkhpMChyqNTbqrhe"
```

---

## Task 1: The policy tables module

**Files:**
- Create: `lib/installer/host-owned.mjs`
- Test: `tests/installer/host-owned.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `GLOBAL_HOST_OWNED`, `PROJECT_HOST_OWNED`, `MERGE_OWNED_KEYS`, `GLOBAL_SETTINGS_FINGERPRINTS`, `PROJECT_SETTINGS_FINGERPRINTS`, `hostOwnedFilter(sourceRoot, table)`, `seedHostOwned(sourceRoot, targetRoot, table)`.

**Why the fingerprint lists are per surface and why the global one is empty.** `global/settings.json` ships a `permissions` block and no `hooks` at all: the two global hook entries are synthesized at install time from the host's absolute home (`settings.mjs:27-35` explains why a bare `~` cannot be shipped), and `mergeVerbosityHook` and `mergeGraphifyHook` already own them entry-level. So the global surface's shipped fingerprint set is genuinely empty, and both coverage directions in T-007 are vacuously true for it, which is correct rather than a gap: the day `global/settings.json` starts shipping a hook entry, the forward test fails until a fingerprint is added.

- [ ] [T-001-A] Create `lib/installer/host-owned.mjs` with the tables and constants. Table keys are POSIX-style relative paths against each surface's copy source (`global/` and `project-template/.claude/` respectively).

```js
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
// the force-copy, and T-007's coverage tests are what stop that default from
// silently swallowing a newly shipped host-owned file.

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
// value, and T-007's forward test is what will catch the day that changes.
export const GLOBAL_SETTINGS_FINGERPRINTS = [];

// One fingerprint per shipped entry in project-template/.claude/settings.json,
// and exactly one: the UserPromptSubmit entry carries three commands in a single
// entry, so fingerprinting context-guard.sh as well would make that entry match
// two, which T-007's forward test rejects by design.
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
```

- [ ] [T-001-B] Create `tests/installer/host-owned.test.js` with the unit tests.

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  GLOBAL_HOST_OWNED, PROJECT_HOST_OWNED, MERGE_OWNED_KEYS,
  GLOBAL_SETTINGS_FINGERPRINTS, PROJECT_SETTINGS_FINGERPRINTS,
  hostOwnedFilter, seedHostOwned,
} from '../../lib/installer/host-owned.mjs';

let src, dst;
beforeEach(() => {
  src = mkdtempSync(join(tmpdir(), 'cc-ho-src-'));
  dst = mkdtempSync(join(tmpdir(), 'cc-ho-dst-'));
});
afterEach(() => {
  rmSync(src, { recursive: true, force: true });
  rmSync(dst, { recursive: true, force: true });
});

describe('policy tables', () => {
  it('use only the three defined policies', () => {
    const seen = new Set([...GLOBAL_HOST_OWNED.values(), ...PROJECT_HOST_OWNED.values()]);
    expect([...seen].sort()).toEqual(['merge', 'seed', 'skip']);
  });
  it('spell every key with forward slashes and no leading slash', () => {
    for (const k of [...GLOBAL_HOST_OWNED.keys(), ...PROJECT_HOST_OWNED.keys()]) {
      expect(k).not.toContain('\\');
      expect(k.startsWith('/')).toBe(false);
    }
  });
  it('declare hooks as the only merge-owned settings key', () => {
    expect(MERGE_OWNED_KEYS).toEqual(['hooks']);
  });
  it('ship no global fingerprints and three project fingerprints', () => {
    expect(GLOBAL_SETTINGS_FINGERPRINTS).toEqual([]);
    expect(PROJECT_SETTINGS_FINGERPRINTS).toEqual(['pre-tool-use.mjs', 'post-compact.sh', 'verbosity-remind.sh']);
  });
});

describe('hostOwnedFilter', () => {
  it('excludes exactly the table paths and keeps their parent directory', () => {
    const f = hostOwnedFilter(src, PROJECT_HOST_OWNED);
    expect(f(src)).toBe(true);
    expect(f(join(src, 'memory'))).toBe(true);
    expect(f(join(src, 'memory', 'project.md'))).toBe(false);
    expect(f(join(src, 'settings.json'))).toBe(false);
    expect(f(join(src, 'commands', 'cc-spec.md'))).toBe(true);
    expect(f(join(src, 'hooks', 'pre-tool-use.mjs'))).toBe(true);
  });
  it('does not exclude a same-named file at a different depth', () => {
    const f = hostOwnedFilter(src, PROJECT_HOST_OWNED);
    expect(f(join(src, 'commands', 'memory', 'project.md'))).toBe(true);
  });
});

describe('seedHostOwned', () => {
  it('writes a seed entry only when the target is absent', () => {
    mkdirSync(join(src, 'memory'), { recursive: true });
    writeFileSync(join(src, 'memory', 'project.md'), 'STUB');
    writeFileSync(join(src, 'memory', 'context-threshold.txt'), '75');
    expect(seedHostOwned(src, dst, PROJECT_HOST_OWNED).sort())
      .toEqual(['memory/context-threshold.txt', 'memory/project.md']);
    expect(readFileSync(join(dst, 'memory', 'project.md'), 'utf8')).toBe('STUB');

    writeFileSync(join(dst, 'memory', 'project.md'), 'HOST PROSE');
    expect(seedHostOwned(src, dst, PROJECT_HOST_OWNED)).toEqual([]);
    expect(readFileSync(join(dst, 'memory', 'project.md'), 'utf8')).toBe('HOST PROSE');
  });
  it('never writes a skip or merge entry', () => {
    writeFileSync(join(src, 'settings.json'), '{}');
    writeFileSync(join(src, 'settings.local.json'), '{}');
    seedHostOwned(src, dst, PROJECT_HOST_OWNED);
    expect(existsSync(join(dst, 'settings.json'))).toBe(false);
    expect(existsSync(join(dst, 'settings.local.json'))).toBe(false);
  });
  it('skips a seed entry whose template source is missing, without throwing', () => {
    expect(() => seedHostOwned(src, dst, GLOBAL_HOST_OWNED)).not.toThrow();
    expect(existsSync(join(dst, 'memory', 'personal.md'))).toBe(false);
  });
});
```

- [ ] [T-001-C] Run the new file alone and confirm it passes.

Run: `npx vitest run tests/installer/host-owned.test.js`
Expected: 9 passed.

- [ ] [T-001-D] Run the full suite and record the count.

Run: `npx vitest run`
Expected: **756 passed, 12 skipped** (747 + 9). If the number differs by even one, stop and reconcile before continuing.

- [ ] [T-001-E] Stage and commit.

```bash
git add lib/installer/host-owned.mjs tests/installer/host-owned.test.js
git commit -m "feat: pin the host-owned policy tables per deploy surface [BUG-039]

Both surfaces get an exhaustive path-to-policy table, the merge-owned
settings keys, and the per-surface fingerprint lists. Nothing consumes
them yet; the deploy paths are rewired in the tasks that follow.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HLS5KAHkhpMChyqNTbqrhe"
```

---

## Task 2: The generalized settings merge

**Files:**
- Modify: `lib/installer/settings.mjs:41-45` (export `backupMalformed`)
- Create: `lib/installer/settings-merge.mjs`
- Test: `tests/installer/settings-merge.test.js`

**Interfaces:**
- Consumes: `MERGE_OWNED_KEYS` from T-001; `backupMalformed`, `utcStamp` from `settings.mjs`; `resolveRealTarget`, `writeAtomic` from `file-merge.mjs`.
- Produces: `entryMatches(entry, fingerprint)`, `matchingFingerprints(entry, fingerprints)`, `mergeSettingsFile(templatePath, settingsPath, fingerprints, opts)`.

**Why a new file rather than a bigger `settings.mjs`.** `file-merge.mjs` already imports `utcStamp` and `pruneBackups` from `settings.mjs`. Putting a function that needs `resolveRealTarget` into `settings.mjs` would close an import cycle. ESM tolerates the cycle, but a reviewer should not have to reason about it, so the new merger sits downstream of both.

- [ ] [T-002-A] In `lib/installer/settings.mjs`, add the `export` keyword to `backupMalformed`. The body is unchanged; only the declaration line changes.

Change line 41 from:

```js
function backupMalformed(settingsPath, now) {
```

to:

```js
export function backupMalformed(settingsPath, now) {
```

- [ ] [T-002-B] Create `lib/installer/settings-merge.mjs`.

```js
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
function upsertEntry(arr, tplEntry, fingerprint) {
  const idx = arr.findIndex((e) => entryMatches(e, fingerprint));
  if (idx === -1) return [...arr, tplEntry];
  return arr
    .map((e, i) => (i === idx ? tplEntry : e))
    .filter((e, i) => i === idx || !entryMatches(e, fingerprint));
}

// Merge the template's hook events into the host's, event by event. A host event
// the template does not ship is carried through untouched.
function mergeHookTree(hostHooks, tplHooks, fingerprints) {
  const next = { ...hostHooks };
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
      arr = upsertEntry(arr, tplEntry, fps[0]);
    }
    next[event] = arr;
  }
  return next;
}

// Merge the template's hook entries into the host's settings.json, touching no
// top-level key outside MERGE_OWNED_KEYS. `fingerprints` names the entries this
// installer OWNS on that surface; an entry matching none of them is host-owned
// and is never read, moved or rewritten.
export function mergeSettingsFile(templatePath, settingsPath, fingerprints, { now = new Date() } = {}) {
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
  let host = null;
  if (raw.trim() !== '') {
    try { host = JSON.parse(raw); } catch { host = undefined; }
  } else {
    host = {};
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
  if (MERGE_OWNED_KEYS.includes('hooks') && Object.keys(tplHooks).length > 0) {
    merged.hooks = mergeHookTree(isPlainObject(host.hooks) ? host.hooks : {}, tplHooks, fingerprints);
  }

  const text = `${JSON.stringify(merged, null, 2)}\n`;
  // Skipping an identical write is what makes a re-run of an unchanged release
  // byte-identical AND leaves the file's mtime alone.
  if (text === raw) return 'unchanged';
  writeAtomic(target.realPath, text);
  return 'merged';
}
```

- [ ] [T-002-C] Create `tests/installer/settings-merge.test.js`.

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync, lstatSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeSettingsFile, entryMatches, matchingFingerprints } from '../../lib/installer/settings-merge.mjs';
import { MERGE_OWNED_KEYS } from '../../lib/installer/host-owned.mjs';

const FPS = ['pre-tool-use.mjs', 'post-compact.sh', 'verbosity-remind.sh'];
const TPL = {
  hooks: {
    PreToolUse: [{ matcher: 'Read|Bash', hooks: [{ type: 'command', command: 'node .claude/hooks/pre-tool-use.mjs' }] }],
    PostCompact: [{ hooks: [
      { type: 'command', command: 'bash .claude/hooks/post-compact.sh' },
      { type: 'command', command: 'powershell .claude/hooks/post-compact.ps1' },
    ] }],
  },
  permissions: { allow: [], deny: [] },
};
const HOST_ENTRY = { matcher: '', hooks: [{ type: 'command', command: 'bash /home/me/my-own-hook.sh' }] };

let dir, tpl, sp;
const write = (p, o) => writeFileSync(p, `${JSON.stringify(o, null, 2)}\n`, 'utf8');
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cc-sm-'));
  tpl = join(dir, 'template.json');
  sp = join(dir, 'settings.json');
  write(tpl, TPL);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('entryMatches', () => {
  it('matches on any command in the entry and tolerates junk', () => {
    expect(entryMatches({ hooks: [{ command: 'x' }, { command: 'run post-compact.sh now' }] }, 'post-compact.sh')).toBe(true);
    expect(entryMatches({ hooks: [{ command: 'x' }] }, 'post-compact.sh')).toBe(false);
    expect(entryMatches(null, 'x')).toBe(false);
    expect(entryMatches({ hooks: 'nope' }, 'x')).toBe(false);
    expect(entryMatches({ hooks: [null, { command: 7 }] }, 'x')).toBe(false);
  });
  it('reports every fingerprint an entry carries', () => {
    const e = { hooks: [{ command: 'a pre-tool-use.mjs b' }, { command: 'c post-compact.sh d' }] };
    expect(matchingFingerprints(e, FPS)).toEqual(['pre-tool-use.mjs', 'post-compact.sh']);
  });
});

describe('mergeSettingsFile: fresh and degenerate targets', () => {
  it('writes the template verbatim when settings.json is absent', () => {
    expect(mergeSettingsFile(tpl, sp, FPS)).toBe('created');
    expect(readFileSync(sp, 'utf8')).toBe(readFileSync(tpl, 'utf8'));
    expect(read(sp).permissions).toEqual({ allow: [], deny: [] });
  });
  it('reports a missing template instead of throwing', () => {
    expect(mergeSettingsFile(join(dir, 'nope.json'), sp, FPS)).toBe('skipped-missing-template');
    expect(existsSync(sp)).toBe(false);
  });
  it('skips a directory at the target path', () => {
    mkdirSync(sp);
    expect(mergeSettingsFile(tpl, sp, FPS)).toBe('skipped-dir');
  });
  it('skips a dangling symlink rather than replacing it with a file', () => {
    symlinkSync(join(dir, 'gone.json'), sp);
    expect(mergeSettingsFile(tpl, sp, FPS)).toBe('skipped-dangling');
    expect(lstatSync(sp).isSymbolicLink()).toBe(true);
  });
  it('treats a whitespace-only file as empty and merges without a backup', () => {
    writeFileSync(sp, '  \n');
    expect(mergeSettingsFile(tpl, sp, FPS)).toBe('merged');
    expect(readdirSync(dir).some((n) => n.includes('malformed-backup'))).toBe(false);
    expect(read(sp).hooks.PreToolUse).toHaveLength(1);
  });
});

describe('mergeSettingsFile: host preservation', () => {
  it('leaves a host-added entry present and unmodified', () => {
    write(sp, { hooks: { PreToolUse: [HOST_ENTRY] } });
    expect(mergeSettingsFile(tpl, sp, FPS)).toBe('merged');
    const arr = read(sp).hooks.PreToolUse;
    expect(arr[0]).toEqual(HOST_ENTRY);
    expect(arr).toHaveLength(2);
  });
  it('leaves a host-modified permissions block byte-identical, including a removed grant', () => {
    const permissions = { allow: ['Bash(grep:*)'], deny: ['Bash(curl:*)'] };
    write(sp, { permissions, hooks: {} });
    mergeSettingsFile(tpl, sp, FPS);
    expect(read(sp).permissions).toEqual(permissions);
  });
  it('writes no top-level key outside MERGE_OWNED_KEYS', () => {
    const host = {
      permissions: { allow: ['Bash(ls:*)'], deny: [] },
      env: { FOO: 'bar' },
      statusLine: { type: 'command', command: 'echo hi' },
      model: 'claude-opus-5',
      somethingClaudeCodeAddsLater: { a: 1 },
    };
    write(sp, host);
    mergeSettingsFile(tpl, sp, FPS);
    const after = read(sp);
    for (const [k, v] of Object.entries(host)) expect(after[k]).toEqual(v);
    const added = Object.keys(after).filter((k) => !(k in host));
    expect(added).toEqual(MERGE_OWNED_KEYS.filter((k) => added.includes(k)));
    expect(added.every((k) => MERGE_OWNED_KEYS.includes(k))).toBe(true);
  });
});

describe('mergeSettingsFile: owned entries', () => {
  it('replaces a conductor entry in position when its command changed', () => {
    const stale = { matcher: 'Write', hooks: [{ type: 'command', command: 'node .claude/hooks/pre-tool-use.mjs' }] };
    write(sp, { hooks: { PreToolUse: [HOST_ENTRY, stale, { matcher: 'z', hooks: [{ command: 'tail' }] }] } });
    mergeSettingsFile(tpl, sp, FPS);
    const arr = read(sp).hooks.PreToolUse;
    expect(arr).toHaveLength(3);
    expect(arr[0]).toEqual(HOST_ENTRY);
    expect(arr[1].matcher).toBe('Read|Bash');
    expect(arr[2].matcher).toBe('z');
  });
  it('collapses a duplicated conductor entry to one, keeping the first position', () => {
    const owned = { matcher: 'old', hooks: [{ type: 'command', command: 'node .claude/hooks/pre-tool-use.mjs' }] };
    write(sp, { hooks: { PreToolUse: [owned, HOST_ENTRY, owned] } });
    mergeSettingsFile(tpl, sp, FPS);
    const arr = read(sp).hooks.PreToolUse;
    expect(arr).toHaveLength(2);
    expect(arr[0].matcher).toBe('Read|Bash');
    expect(arr[1]).toEqual(HOST_ENTRY);
  });
  it('is byte-identical on a second run of an unchanged release', () => {
    write(sp, { hooks: { PreToolUse: [HOST_ENTRY] }, permissions: { allow: ['Bash(ls:*)'] } });
    mergeSettingsFile(tpl, sp, FPS);
    const first = readFileSync(sp, 'utf8');
    expect(mergeSettingsFile(tpl, sp, FPS)).toBe('unchanged');
    expect(readFileSync(sp, 'utf8')).toBe(first);
  });
  it('treats a non-array hook event as absent without discarding sibling events', () => {
    write(sp, { hooks: { PreToolUse: 'nonsense', UserPromptSubmit: [HOST_ENTRY] } });
    expect(mergeSettingsFile(tpl, sp, FPS)).toBe('merged');
    const after = read(sp);
    expect(after.hooks.PreToolUse).toHaveLength(1);
    expect(after.hooks.UserPromptSubmit).toEqual([HOST_ENTRY]);
  });
});

describe('mergeSettingsFile: malformed', () => {
  it('backs up invalid JSON and writes the template so the host keeps a working file', () => {
    writeFileSync(sp, '{ not: valid, }');
    expect(mergeSettingsFile(tpl, sp, FPS, { now: new Date('2026-07-05T12:34:56Z') })).toBe('malformed-replaced');
    expect(readdirSync(dir).filter((n) => n.includes('malformed-backup')))
      .toEqual(['settings.json.malformed-backup.20260705T123456Z']);
    expect(readFileSync(join(dir, 'settings.json.malformed-backup.20260705T123456Z'), 'utf8')).toBe('{ not: valid, }');
    expect(read(sp).hooks.PreToolUse).toHaveLength(1);
  });
  it('treats an array root as malformed', () => {
    writeFileSync(sp, '[]');
    expect(mergeSettingsFile(tpl, sp, FPS, { now: new Date('2026-07-05T12:34:56Z') })).toBe('malformed-replaced');
  });
});

describe('mergeSettingsFile: symlink', () => {
  it('writes through the link and leaves it a link', () => {
    const real = join(dir, 'real-settings.json');
    write(real, { hooks: { PreToolUse: [HOST_ENTRY] } });
    symlinkSync(real, sp);
    expect(mergeSettingsFile(tpl, sp, FPS)).toBe('merged');
    expect(lstatSync(sp).isSymbolicLink()).toBe(true);
    expect(read(real).hooks.PreToolUse).toHaveLength(2);
  });
});
```

- [ ] [T-002-D] Run the new file alone.

Run: `npx vitest run tests/installer/settings-merge.test.js`
Expected: 17 passed.

- [ ] [T-002-E] Run the settings suite to confirm the `backupMalformed` export broke nothing.

Run: `npx vitest run tests/installer/settings.test.js`
Expected: the existing count, unchanged, all passing.

- [ ] [T-002-F] Run the full suite and record the count.

Run: `npx vitest run`
Expected: **773 passed, 12 skipped** (756 + 17). Reconcile any difference before continuing.

- [ ] [T-002-G] Stage and commit.

```bash
git add lib/installer/settings.mjs lib/installer/settings-merge.mjs tests/installer/settings-merge.test.js
git commit -m "feat: add the entry-level fingerprint settings merge [BUG-039]

The merge replaces a conductor-owned hook entry where it already sits,
appends only genuinely new ones, leaves every other entry untouched, and
writes no top-level key outside MERGE_OWNED_KEYS, so permissions is
written exactly once at seed time and never again.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HLS5KAHkhpMChyqNTbqrhe"
```

---

## Task 3: Rewire `deployGlobal` and delete `skipHostOwned`

**Files:**
- Modify: `lib/installer/deploy.mjs:40-51` (delete `skipHostOwned`), `:106-121` (`deployGlobal`), `:1-4` (imports)
- Test: `tests/installer/deploy.test.js` (append only)

**Interfaces:**
- Consumes: `GLOBAL_HOST_OWNED`, `GLOBAL_SETTINGS_FINGERPRINTS`, `hostOwnedFilter`, `seedHostOwned` from T-001; `mergeSettingsFile` from T-002.
- Produces: `deployGlobal(assetRoot, home)` with an unchanged signature and return value.

- [ ] [T-003-A] In `lib/installer/deploy.mjs`, add the two new imports after line 4.

```js
import { GLOBAL_HOST_OWNED, PROJECT_HOST_OWNED, GLOBAL_SETTINGS_FINGERPRINTS, PROJECT_SETTINGS_FINGERPRINTS, hostOwnedFilter, seedHostOwned } from './host-owned.mjs';
import { mergeSettingsFile } from './settings-merge.mjs';
```

- [ ] [T-003-B] Delete the whole `skipHostOwned` block, `lib/installer/deploy.mjs:40-51`, comment included. It is replaced by `hostOwnedFilter`; leaving it beside the table would preserve in miniature the divergence this item exists to close.

- [ ] [T-003-C] Replace the body of `deployGlobal` (`lib/installer/deploy.mjs:106-121`) with the table-driven form.

```js
export function deployGlobal(assetRoot, home) {
  const target = join(home, '.claude');
  const globalDir = join(assetRoot, 'global');
  mkdirSync(target, { recursive: true });
  cpSync(globalDir, target, { ...CP_OPTS, filter: hostOwnedFilter(globalDir, GLOBAL_HOST_OWNED) });
  mergeFileInto(join(globalDir, 'CLAUDE.md'), join(target, 'CLAUDE.md'), mergeClaudeMdText);
  const skillsDir = join(target, 'skills');
  unblockSkillPaths(assetRoot, skillsDir);
  cpSync(join(assetRoot, 'skills'), skillsDir, CP_OPTS);
  sweepStaleFlatSkills(assetRoot, skillsDir);
  // The filter excludes both files under global/memory, so a host that has
  // neither gets the directory from here rather than from cpSync. config.mjs's
  // version and verbosity writes both assume the parent dir exists.
  mkdirSync(join(target, 'memory'), { recursive: true });
  seedHostOwned(globalDir, target, GLOBAL_HOST_OWNED);
  // global/settings.json ships permissions and no hooks, so on an existing
  // install this is a no-op that exists to stop the force-copy; on a fresh one
  // it writes the template whole, which is the only time permissions is written.
  // The two synthesized global hook entries are merged afterwards by bin/.
  mergeSettingsFile(join(globalDir, 'settings.json'), join(target, 'settings.json'), GLOBAL_SETTINGS_FINGERPRINTS);
  return target;
}
```

- [ ] [T-003-D] Append a new describe block to the END of `tests/installer/deploy.test.js`. Do not modify any existing case. The block's fixtures add `settings.json` and `verbosity.md` to the asset tree the existing `beforeEach` builds.

```js
describe('deployGlobal: host-owned state', () => {
  const GLOBAL_SETTINGS = { permissions: { allow: ['Bash(grep:*)'], deny: [] } };
  const HOST_ENTRY = { matcher: '', hooks: [{ type: 'command', command: 'bash /home/me/my-own-hook.sh' }] };
  beforeEach(() => {
    writeFileSync(join(asset, 'global', 'memory', 'verbosity.md'), 'VERBOSITY: MIN\n');
    writeFileSync(join(asset, 'global', 'settings.json'), `${JSON.stringify(GLOBAL_SETTINGS, null, 2)}\n`);
  });

  it('seeds personal.md and verbosity.md on a fresh install', () => {
    const dir = deployGlobal(asset, home);
    expect(readFileSync(join(dir, 'memory', 'personal.md'), 'utf8')).toBe('BUNDLED');
    expect(readFileSync(join(dir, 'memory', 'verbosity.md'), 'utf8')).toBe('VERBOSITY: MIN\n');
  });

  it('leaves host-edited memory files byte-identical on a re-run', () => {
    deployGlobal(asset, home);
    const p = join(home, '.claude', 'memory', 'personal.md');
    writeFileSync(p, 'MY OWN NOTES');
    deployGlobal(asset, home);
    expect(readFileSync(p, 'utf8')).toBe('MY OWN NOTES');
  });

  it('writes settings.json whole on a fresh install, permissions included', () => {
    const dir = deployGlobal(asset, home);
    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')).permissions)
      .toEqual({ allow: ['Bash(grep:*)'], deny: [] });
  });

  it('leaves a host-added UserPromptSubmit entry present and unmodified on a re-run', () => {
    const dir = deployGlobal(asset, home);
    const sp = join(dir, 'settings.json');
    writeFileSync(sp, `${JSON.stringify({ hooks: { UserPromptSubmit: [HOST_ENTRY] }, permissions: { allow: [], deny: [] } }, null, 2)}\n`);
    deployGlobal(asset, home);
    expect(JSON.parse(readFileSync(sp, 'utf8')).hooks.UserPromptSubmit).toEqual([HOST_ENTRY]);
  });

  it('leaves a host-owned settings.local.json untouched', () => {
    const dir = join(home, '.claude');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'settings.local.json'), '{"local":true}');
    writeFileSync(join(asset, 'global', 'settings.local.json'), '{"template":true}');
    deployGlobal(asset, home);
    expect(readFileSync(join(dir, 'settings.local.json'), 'utf8')).toBe('{"local":true}');
  });

  it('still force-copies managed assets alongside the host-owned exclusions', () => {
    const dir = deployGlobal(asset, home);
    writeFileSync(join(dir, 'hooks', 'h.sh'), 'TAMPERED');
    deployGlobal(asset, home);
    expect(readFileSync(join(dir, 'hooks', 'h.sh'), 'utf8')).toBe('#!/bin/sh\n');
  });
});
```

- [ ] [T-003-E] Confirm `skipHostOwned` has no remaining reference anywhere.

Run: `grep -rn "skipHostOwned" lib bin tests`
Expected: no output, exit 1.

- [ ] [T-003-F] Run the deploy suite.

Run: `npx vitest run tests/installer/deploy.test.js`
Expected: the existing deploy count plus 6, all passing. In particular `deployGlobal > copies managed assets and skills but not global/memory` must still pass unchanged: `memory/personal.md` is now excluded by the table rather than by a directory rule, and `memory/` is still created.

- [ ] [T-003-G] Run the full suite and record the count.

Run: `npx vitest run`
Expected: **779 passed, 12 skipped** (773 + 6). Reconcile any difference before continuing.

- [ ] [T-003-H] Stage and commit.

```bash
git add lib/installer/deploy.mjs tests/installer/deploy.test.js
git commit -m "fix: route deployGlobal through the host-owned table [BUG-039]

skipHostOwned is deleted rather than extended. The global surface now
excludes exactly the table's paths, seeds the absent ones, and merges
settings.json instead of force-copying it, which is the destruction that
made the mergers at bin/code-conductor.mjs:98-99 merge into an already
emptied file.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HLS5KAHkhpMChyqNTbqrhe"
```

---

## Task 4: Rewire `deployProject`

**Files:**
- Modify: `lib/installer/deploy.mjs:137-167` (`deployProject`)
- Test: `tests/installer/deploy.test.js` (append only)

**Interfaces:**
- Consumes: `PROJECT_HOST_OWNED`, `PROJECT_SETTINGS_FINGERPRINTS`, `hostOwnedFilter`, `seedHostOwned`, `mergeSettingsFile`.
- Produces: `deployProject(assetRoot, cwd)` with an unchanged signature for now; T-005 adds the third options parameter.

- [ ] [T-004-A] In `lib/installer/deploy.mjs`, replace the copy section of `deployProject` (the `cpSync(join(templateRoot, '.claude'), target, CP_OPTS)` call at `:152`) and add the seed and merge after the root-file loop. The `.claude` copy line becomes:

```js
  const templateClaude = join(templateRoot, '.claude');
  cpSync(templateClaude, target, { ...CP_OPTS, filter: hostOwnedFilter(templateClaude, PROJECT_HOST_OWNED) });
```

and immediately after the `MERGED_ROOT_FILES` loop, before the `sweepStaleRootScripts` call, insert:

```js
  // The filter excludes both shipped memory files, so a host with neither gets
  // the directory from here. Same reason as deployGlobal's.
  mkdirSync(join(target, 'memory'), { recursive: true });
  seedHostOwned(templateClaude, target, PROJECT_HOST_OWNED);
  mergeSettingsFile(join(templateClaude, 'settings.json'), join(target, 'settings.json'), PROJECT_SETTINGS_FINGERPRINTS);
```

- [ ] [T-004-B] Append a new describe block to the END of `tests/installer/deploy.test.js`. The fixtures extend the asset tree the existing `beforeEach` builds with the two shipped memory files and a project `settings.json`.

```js
describe('deployProject: host-owned state', () => {
  const STUB = '# Project Memory\n\n## Decisions\n';
  const THRESHOLD = '75\n';
  const PROJECT_SETTINGS = {
    hooks: { PreToolUse: [{ matcher: 'Read|Bash', hooks: [{ type: 'command', command: 'node .claude/hooks/pre-tool-use.mjs' }] }] },
    permissions: { allow: [], deny: [] },
  };
  const HOST_ENTRY = { matcher: '', hooks: [{ type: 'command', command: 'bash ./my-own-hook.sh' }] };
  let claude;
  beforeEach(() => {
    mkdirSync(join(asset, 'project-template', '.claude', 'memory'), { recursive: true });
    writeFileSync(join(asset, 'project-template', '.claude', 'memory', 'project.md'), STUB);
    writeFileSync(join(asset, 'project-template', '.claude', 'memory', 'context-threshold.txt'), THRESHOLD);
    writeFileSync(join(asset, 'project-template', '.claude', 'settings.json'), `${JSON.stringify(PROJECT_SETTINGS, null, 2)}\n`);
    claude = join(home, '.claude');
  });

  it('seeds project.md, context-threshold.txt and settings.json on a fresh scaffold', () => {
    deployProject(asset, home);
    expect(readFileSync(join(claude, 'memory', 'project.md'), 'utf8')).toBe(STUB);
    expect(readFileSync(join(claude, 'memory', 'context-threshold.txt'), 'utf8')).toBe(THRESHOLD);
    expect(JSON.parse(readFileSync(join(claude, 'settings.json'), 'utf8')).permissions).toEqual({ allow: [], deny: [] });
  });

  it('leaves a host-modified project.md byte-identical on a re-run', () => {
    deployProject(asset, home);
    const p = join(claude, 'memory', 'project.md');
    writeFileSync(p, '# Project Memory\n\n## Decisions\n\n- We chose X over Y.\n');
    deployProject(asset, home);
    expect(readFileSync(p, 'utf8')).toBe('# Project Memory\n\n## Decisions\n\n- We chose X over Y.\n');
  });

  it('leaves a host-modified context-threshold.txt byte-identical on a re-run', () => {
    deployProject(asset, home);
    const p = join(claude, 'memory', 'context-threshold.txt');
    writeFileSync(p, '40\n');
    deployProject(asset, home);
    expect(readFileSync(p, 'utf8')).toBe('40\n');
  });

  it('leaves a host-created bash-scan-allowlist.txt byte-identical even when the template ships one', () => {
    deployProject(asset, home);
    const p = join(claude, 'memory', 'bash-scan-allowlist.txt');
    writeFileSync(p, '# operator policy\ndocs/\n');
    writeFileSync(join(asset, 'project-template', '.claude', 'memory', 'bash-scan-allowlist.txt'), 'TEMPLATE POLICY\n');
    deployProject(asset, home);
    expect(readFileSync(p, 'utf8')).toBe('# operator policy\ndocs/\n');
  });

  it('leaves every latent runtime-written file byte-identical on a re-run', () => {
    deployProject(asset, home);
    const files = {
      [join(claude, 'memory', 'personal.md')]: 'MY PREFS\n',
      [join(claude, 'memory', 'session-snapshot.json')]: '{"v":1}\n',
      [join(claude, 'memory', 'session-snapshot.md')]: '# snapshot\n',
      [join(claude, 'memory', 'turn-count.txt')]: '17\n',
      [join(claude, 'settings.local.json')]: '{"local":true}\n',
    };
    for (const [p, body] of Object.entries(files)) writeFileSync(p, body);
    // Ship every one of them from the template, which is the future this table exists to survive.
    writeFileSync(join(asset, 'project-template', '.claude', 'memory', 'personal.md'), 'TEMPLATE\n');
    writeFileSync(join(asset, 'project-template', '.claude', 'memory', 'session-snapshot.json'), 'TEMPLATE\n');
    writeFileSync(join(asset, 'project-template', '.claude', 'memory', 'session-snapshot.md'), 'TEMPLATE\n');
    writeFileSync(join(asset, 'project-template', '.claude', 'memory', 'turn-count.txt'), 'TEMPLATE\n');
    writeFileSync(join(asset, 'project-template', '.claude', 'settings.local.json'), 'TEMPLATE\n');
    deployProject(asset, home);
    for (const [p, body] of Object.entries(files)) expect(readFileSync(p, 'utf8')).toBe(body);
  });

  it('leaves a host-added settings.json entry present and unmodified on a re-run', () => {
    deployProject(asset, home);
    const sp = join(claude, 'settings.json');
    const host = JSON.parse(readFileSync(sp, 'utf8'));
    host.hooks.UserPromptSubmit = [HOST_ENTRY];
    writeFileSync(sp, `${JSON.stringify(host, null, 2)}\n`);
    deployProject(asset, home);
    expect(JSON.parse(readFileSync(sp, 'utf8')).hooks.UserPromptSubmit).toEqual([HOST_ENTRY]);
  });

  it('leaves a host-modified permissions block byte-identical, including a removed grant', () => {
    deployProject(asset, home);
    const sp = join(claude, 'settings.json');
    const host = JSON.parse(readFileSync(sp, 'utf8'));
    host.permissions = { allow: ['Bash(ls:*)'], deny: ['Bash(curl:*)'] };
    writeFileSync(sp, `${JSON.stringify(host, null, 2)}\n`);
    deployProject(asset, home);
    expect(JSON.parse(readFileSync(sp, 'utf8')).permissions).toEqual({ allow: ['Bash(ls:*)'], deny: ['Bash(curl:*)'] });
  });

  it('updates a conductor-owned entry whose template command changed', () => {
    deployProject(asset, home);
    const sp = join(claude, 'settings.json');
    const changed = JSON.parse(JSON.stringify(PROJECT_SETTINGS));
    changed.hooks.PreToolUse[0].matcher = 'Read|Write|Bash';
    writeFileSync(join(asset, 'project-template', '.claude', 'settings.json'), `${JSON.stringify(changed, null, 2)}\n`);
    deployProject(asset, home);
    const arr = JSON.parse(readFileSync(sp, 'utf8')).hooks.PreToolUse;
    expect(arr).toHaveLength(1);
    expect(arr[0].matcher).toBe('Read|Write|Bash');
  });

  it('produces a byte-identical settings.json on a re-run of an unchanged release', () => {
    deployProject(asset, home);
    const sp = join(claude, 'settings.json');
    const first = readFileSync(sp, 'utf8');
    deployProject(asset, home);
    expect(readFileSync(sp, 'utf8')).toBe(first);
  });
});
```

- [ ] [T-004-C] Run the deploy suite.

Run: `npx vitest run tests/installer/deploy.test.js`
Expected: the T-003-F count plus 9, all passing.

- [ ] [T-004-D] Run the full suite and record the count.

Run: `npx vitest run`
Expected: **788 passed, 12 skipped** (779 + 9). Reconcile any difference before continuing.

- [ ] [T-004-E] Stage and commit.

```bash
git add lib/installer/deploy.mjs tests/installer/deploy.test.js
git commit -m "fix: route deployProject through the host-owned table [BUG-039]

The project surface gains the filter, the write-if-absent seed and the
settings merge it never had, so a re-run no longer replaces a team's
project.md with the template stub, reverts a tuned context threshold, or
force-copies a settings.json that no merger ever repaired.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HLS5KAHkhpMChyqNTbqrhe"
```

---

## Task 5: Stub detection for an already-overwritten `project.md`

**Files:**
- Modify: `lib/installer/deploy.mjs` (`deployProject` signature and body)
- Test: `tests/installer/deploy.test.js` (append only)

**Interfaces:**
- Consumes: `deployProject` from T-004.
- Produces: `deployProject(assetRoot, cwd, { warn } = {})`, where `warn` receives one already-formatted multi-line string. The default writes it to stderr, matching `mergeFileInto`'s emitter convention (`file-merge.mjs:48`).

**Why detection runs before the seed.** The check compares the host's `project.md` against the template stub. Running it after the seed would make every fresh scaffold warn about its own brand-new stub. Running it before means the file must have existed already, which removes the fresh-install false positive entirely and leaves only the one the spec accepts: a real project scaffolded earlier that genuinely still equals the stub. That is why the wording says "may have been overwritten".

- [ ] [T-005-A] In `lib/installer/deploy.mjs`, add the detection helper directly above `deployProject`.

```js
// 1.28.0 and 1.29.0 both told users to re-run the installer, and that re-run
// force-copied the template stub over the host's project.md. Detection only:
// restoring from git would mean the installer writing host files out of the
// host's own history, with new failure modes (detached HEAD, shallow clone,
// submodule, dirty index, no git at all) for a path that fires in one narrow
// case. Print the two commands and write nothing.
function warnIfProjectMemoryIsStub(templateClaude, target, emit) {
  const rel = '.claude/memory/project.md';
  const stub = join(templateClaude, 'memory', 'project.md');
  const host = join(target, 'memory', 'project.md');
  if (!existsSync(stub) || !existsSync(host)) return false;
  if (readFileSync(host, 'utf8') !== readFileSync(stub, 'utf8')) return false;
  emit([
    `code-conductor: ${rel} matches the bundled stub; an installer re-run before 1.30.0 may have overwritten it.`,
    `  Find a committed copy:  git log --oneline -- ${rel}`,
    `  Restore it:             git checkout <commit> -- ${rel}`,
  ].join('\n'));
  return true;
}
```

- [ ] [T-005-B] Change the `deployProject` signature and wire the detection in, before the seed.

Signature becomes:

```js
export function deployProject(assetRoot, cwd, { warn } = {}) {
  const emit = warn || ((m) => process.stderr.write(`${m}\n`));
```

and the detection call goes immediately before the `mkdirSync(join(target, 'memory'), ...)` line added in T-004-A:

```js
  warnIfProjectMemoryIsStub(templateClaude, target, emit);
```

- [ ] [T-005-C] Append a new describe block to the END of `tests/installer/deploy.test.js`.

```js
describe('deployProject: overwritten project.md detection', () => {
  const STUB = '# Project Memory\n\n## Decisions\n';
  let warned;
  const warn = (m) => warned.push(m);
  beforeEach(() => {
    warned = [];
    mkdirSync(join(asset, 'project-template', '.claude', 'memory'), { recursive: true });
    writeFileSync(join(asset, 'project-template', '.claude', 'memory', 'project.md'), STUB);
  });

  it('says nothing on a fresh scaffold, whose stub it just wrote', () => {
    deployProject(asset, home, { warn });
    expect(warned).toEqual([]);
    expect(readFileSync(join(home, '.claude', 'memory', 'project.md'), 'utf8')).toBe(STUB);
  });

  it('prints the recovery line exactly once when the host copy equals the stub', () => {
    deployProject(asset, home, { warn });
    warned.length = 0;
    deployProject(asset, home, { warn });
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain('may have been overwritten');
    expect(warned[0]).toContain('git log --oneline -- .claude/memory/project.md');
    expect(warned[0]).toContain('git checkout <commit> -- .claude/memory/project.md');
  });

  it('writes nothing when it warns', () => {
    deployProject(asset, home, { warn });
    const p = join(home, '.claude', 'memory', 'project.md');
    const before = readFileSync(p, 'utf8');
    deployProject(asset, home, { warn });
    expect(readFileSync(p, 'utf8')).toBe(before);
  });

  it('stays silent once the host has written real prose', () => {
    deployProject(asset, home, { warn });
    writeFileSync(join(home, '.claude', 'memory', 'project.md'), `${STUB}\n- We chose X.\n`);
    warned.length = 0;
    deployProject(asset, home, { warn });
    expect(warned).toEqual([]);
  });
});
```

- [ ] [T-005-D] Run the deploy suite.

Run: `npx vitest run tests/installer/deploy.test.js`
Expected: the T-004-C count plus 4, all passing.

- [ ] [T-005-E] Run the full suite and record the count.

Run: `npx vitest run`
Expected: **792 passed, 12 skipped** (788 + 4). Reconcile any difference before continuing.

- [ ] [T-005-F] Stage and commit.

```bash
git add lib/installer/deploy.mjs tests/installer/deploy.test.js
git commit -m "feat: detect a project.md an earlier re-run may have overwritten [BUG-039]

Detection only, project.md only, and checked before the seed so a fresh
scaffold never warns about the stub it was just given. context-threshold
detection is deliberately absent: its stub is a default most hosts never
tune, so the warning would fire near-universally.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HLS5KAHkhpMChyqNTbqrhe"
```

---

## Task 6: Wire the CLI and retire `seedMemoryFile`

**Files:**
- Modify: `bin/code-conductor.mjs:8` (import), `:95` (call), `:101` (warn channel)
- Modify: `lib/installer/config.mjs:35-41` (delete `seedMemoryFile`)
- Modify: `tests/installer/config.test.js:5` and `:61-67` (delete the block covering the deleted function)
- Test: `tests/installer/cli.test.js` (append only)

**Interfaces:**
- Consumes: `deployProject(assetRoot, cwd, { warn })` from T-005; `seedHostOwned` indirectly through `deployGlobal`.
- Produces: no new exports.

**Why `seedMemoryFile` goes and `writeVerbosity`'s internal seed stays.** `seedMemoryFile` exists only to write `global/memory/personal.md` if absent, which the table's `seed` policy now does inside `deployGlobal`. Keeping a second write-if-absent mechanism beside the table would preserve exactly the divergence this item closes, so it is deleted along with the two test cases that cover it: that is a deletion of dead code, not an adjustment of a case to make new code pass. `writeVerbosity`'s own copy-if-absent at `config.mjs:20` stays, because `writeVerbosity` is also the `--verbosity` flag path and must work when called directly with a home; its seed is its own precondition, not a second policy.

- [ ] [T-006-A] In `lib/installer/config.mjs`, delete the whole `seedMemoryFile` function, `:35-41`.

- [ ] [T-006-B] In `bin/code-conductor.mjs:8`, drop `seedMemoryFile` from the import.

```js
import { writeVerbosity, writeVersionFile } from '../lib/installer/config.mjs';
```

- [ ] [T-006-C] In `bin/code-conductor.mjs`, delete line 95, `seedMemoryFile(home, 'personal.md', assetRoot);`. `deployGlobal` seeded it at line 93.

- [ ] [T-006-D] In `bin/code-conductor.mjs:101`, pass the warn channel so the stub-detection line reaches the user's stderr through the same emitter every other diagnostic uses.

```js
    if (opts.project) deployProject(assetRoot, cwd, { warn: (m) => emit('stderr', m) });
```

- [ ] [T-006-E] In `tests/installer/config.test.js`, delete `seedMemoryFile` from the import on line 5, then delete the `describe('seedMemoryFile', ...)` block at `:61-67`. Both removals are required: the function no longer exists, so the import alone would fail the file.

- [ ] [T-006-F] Append a new describe block to the END of `tests/installer/cli.test.js`. These are the end-to-end cases that use the REAL bundled assets, which is the only layer where the copy-then-merge ordering is observable.

```js
describe('run: host-owned state across a re-run', () => {
  it('still seeds personal.md into a fresh global install', () => {
    run([], { HOME: home }, { cwd, log });
    expect(existsSync(join(home, '.claude', 'memory', 'personal.md'))).toBe(true);
  });

  it('keeps a host-added global settings.json entry across a re-run', () => {
    run([], { HOME: home }, { cwd, log });
    const sp = join(home, '.claude', 'settings.json');
    const s = JSON.parse(readFileSync(sp, 'utf8'));
    s.hooks.UserPromptSubmit.push({ matcher: '', hooks: [{ type: 'command', command: 'bash /home/me/mine.sh' }] });
    writeFileSync(sp, `${JSON.stringify(s, null, 2)}\n`);
    run([], { HOME: home }, { cwd, log });
    const after = JSON.parse(readFileSync(sp, 'utf8'));
    expect(after.hooks.UserPromptSubmit.some(e => e.hooks.some(h => h.command === 'bash /home/me/mine.sh'))).toBe(true);
  });

  it('keeps a host-modified global permissions block across a re-run', () => {
    run([], { HOME: home }, { cwd, log });
    const sp = join(home, '.claude', 'settings.json');
    const s = JSON.parse(readFileSync(sp, 'utf8'));
    s.permissions = { allow: ['Bash(grep:*)'], deny: ['Bash(curl:*)'] };
    writeFileSync(sp, `${JSON.stringify(s, null, 2)}\n`);
    run([], { HOME: home }, { cwd, log });
    expect(JSON.parse(readFileSync(sp, 'utf8')).permissions).toEqual({ allow: ['Bash(grep:*)'], deny: ['Bash(curl:*)'] });
  });

  it('keeps a host-modified project.md and context-threshold.txt across a --project re-run', () => {
    run(['--project'], { HOME: home }, { cwd, log });
    const pm = join(cwd, '.claude', 'memory', 'project.md');
    const ct = join(cwd, '.claude', 'memory', 'context-threshold.txt');
    writeFileSync(pm, '# Ours\n\n- decision one\n');
    writeFileSync(ct, '40\n');
    run(['--project'], { HOME: home }, { cwd, log });
    expect(readFileSync(pm, 'utf8')).toBe('# Ours\n\n- decision one\n');
    expect(readFileSync(ct, 'utf8')).toBe('40\n');
  });

  it('keeps a host-created bash-scan-allowlist.txt across a --project re-run', () => {
    run(['--project'], { HOME: home }, { cwd, log });
    const p = join(cwd, '.claude', 'memory', 'bash-scan-allowlist.txt');
    writeFileSync(p, '# operator policy\ndocs/\n');
    run(['--project'], { HOME: home }, { cwd, log });
    expect(readFileSync(p, 'utf8')).toBe('# operator policy\ndocs/\n');
  });

  it('produces a byte-identical project settings.json on a second --project run', () => {
    run(['--project'], { HOME: home }, { cwd, log });
    const sp = join(cwd, '.claude', 'settings.json');
    const first = readFileSync(sp, 'utf8');
    run(['--project'], { HOME: home }, { cwd, log });
    expect(readFileSync(sp, 'utf8')).toBe(first);
  });
});
```

- [ ] [T-006-G] Confirm no reference to the deleted function survives.

Run: `grep -rn "seedMemoryFile" lib bin tests`
Expected: no output, exit 1.

- [ ] [T-006-H] Run the two touched suites.

Run: `npx vitest run tests/installer/cli.test.js tests/installer/config.test.js`
Expected: cli gains 6 cases, config loses 1 case (the single `it` inside the deleted describe). All passing.

- [ ] [T-006-I] Run the full suite and record the count.

Run: `npx vitest run`
Expected: **797 passed, 12 skipped** (792 + 6 - 1). Reconcile any difference before continuing.

- [ ] [T-006-J] Stage and commit.

```bash
git add bin/code-conductor.mjs lib/installer/config.mjs tests/installer/cli.test.js tests/installer/config.test.js
git commit -m "refactor: retire seedMemoryFile and wire the deploy warn channel [BUG-039]

The table's seed policy is now the single write-if-absent mechanism, so
the standalone helper and its coverage go with it. deployProject gets the
CLI's stderr emitter, and end-to-end cases pin the re-run behavior against
the real bundled assets, which is the only layer where the old
copy-then-merge ordering was observable.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HLS5KAHkhpMChyqNTbqrhe"
```

---

## Task 7: The shipped-tree contract

**Files:**
- Modify: `tests/installer/templates.test.js` (append only)

**Interfaces:**
- Consumes: both tables, both fingerprint lists, `matchingFingerprints`.
- Produces: nothing; this task is the contract's enforcement.

**What "coverage" means mechanically.** Three assertions together make the enumeration a contract:

1. **No shipped path may carry `skip`.** `skip` means "no seed source exists". The day a template starts shipping `bash-scan-allowlist.txt`, this fails, which is exactly the guard the spec asks for.
2. **Every `seed` and `merge` entry must have a template source**, so no entry points at a file that is no longer shipped.
3. **Any shipped path that is host-owned on the other surface must have an entry on its own surface too**, so adding `memory/personal.md` to `project-template/` cannot slip through by virtue of only `global/` knowing the name.

- [ ] [T-007-A] Add the contract block to `tests/installer/templates.test.js`. The two `import` lines go with the file's other imports at the top (after line 5); everything below them is appended to the END of the file. It reuses the file's existing `root`, `readText`, `readdirSync`, `existsSync` and `join` bindings, so no other import changes.

```js
import {
  GLOBAL_HOST_OWNED, PROJECT_HOST_OWNED,
  GLOBAL_SETTINGS_FINGERPRINTS, PROJECT_SETTINGS_FINGERPRINTS,
} from '../../lib/installer/host-owned.mjs';
import { matchingFingerprints } from '../../lib/installer/settings-merge.mjs';

const SURFACES = [
  { name: 'global', dir: 'global', table: GLOBAL_HOST_OWNED, fingerprints: GLOBAL_SETTINGS_FINGERPRINTS },
  { name: 'project', dir: 'project-template/.claude', table: PROJECT_HOST_OWNED, fingerprints: PROJECT_SETTINGS_FINGERPRINTS },
];
const HOST_OWNED_ANYWHERE = new Set([...GLOBAL_HOST_OWNED.keys(), ...PROJECT_HOST_OWNED.keys()]);

function shippedPaths(absDir) {
  const out = [];
  const walk = (dir, rel) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const next = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(join(dir, entry.name), next);
      else out.push(next);
    }
  };
  walk(absDir, '');
  return out;
}

describe('host-owned tables cover the shipped trees', () => {
  it.each(SURFACES)('$name ships nothing marked skip', ({ dir, table }) => {
    const offenders = shippedPaths(join(root, dir)).filter((p) => table.get(p) === 'skip');
    expect(offenders).toEqual([]);
  });

  it.each(SURFACES)('$name has a template source for every seed and merge entry', ({ dir, table }) => {
    const missing = [];
    for (const [rel, policy] of table) {
      if (policy === 'skip') continue;
      if (!existsSync(join(root, dir, ...rel.split('/')))) missing.push(rel);
    }
    expect(missing).toEqual([]);
  });

  it.each(SURFACES)('$name declares a policy for every shipped path host-owned on either surface', ({ dir, table }) => {
    const undeclared = shippedPaths(join(root, dir)).filter((p) => HOST_OWNED_ANYWHERE.has(p) && !table.has(p));
    expect(undeclared).toEqual([]);
  });
});

describe('settings fingerprint coverage', () => {
  const entriesOf = (rel) => {
    const hooks = JSON.parse(readText(rel)).hooks;
    if (!hooks) return [];
    return Object.values(hooks).flatMap((v) => (Array.isArray(v) ? v : []));
  };
  const SHIPPED = [
    { rel: 'global/settings.json', fingerprints: GLOBAL_SETTINGS_FINGERPRINTS },
    { rel: 'project-template/.claude/settings.json', fingerprints: PROJECT_SETTINGS_FINGERPRINTS },
  ];

  // Backward: a fingerprint that matches nothing is dead, which happens when a
  // hook is renamed and the constant is not.
  it.each(SHIPPED)('$rel leaves no fingerprint dead', ({ rel, fingerprints }) => {
    const entries = entriesOf(rel);
    const dead = fingerprints.filter((fp) => !entries.some((e) => matchingFingerprints(e, [fp]).length === 1));
    expect(dead).toEqual([]);
  });

  // Forward: every shipped entry is by definition conductor-owned, so exhaustive
  // forward coverage is assertable today. Without it, a release can add a
  // template entry and forget its fingerprint, after which the merge either
  // never delivers it to existing installs or appends it beside itself on every
  // re-run. The two directions together are the contract; either alone is half.
  it.each(SHIPPED)('$rel matches every shipped entry to exactly one fingerprint', ({ rel, fingerprints }) => {
    const wrong = entriesOf(rel)
      .map((e, i) => ({ i, hits: matchingFingerprints(e, fingerprints) }))
      .filter((r) => r.hits.length !== 1);
    expect(wrong).toEqual([]);
  });

  // Vacuity asserted, not tolerated. global/settings.json ships permissions and
  // no hooks: its two entries are synthesized from the host's absolute home, so
  // a bare ~ cannot be shipped (settings.mjs:27-35) and the two mergers in
  // settings.mjs own them with their own tested fingerprints. Empty equals empty
  // today, and the day that file ships a hook entry this case fails first, ahead
  // of the forward assertion it would otherwise silently satisfy.
  it('global/settings.json ships no hook entry, matching its empty fingerprint list', () => {
    expect(entriesOf('global/settings.json')).toEqual([]);
    expect(GLOBAL_SETTINGS_FINGERPRINTS).toEqual([]);
  });
});

describe('seeded permissions', () => {
  // permissions is written exactly once, at seed time, and never again, so the
  // template's grant list is the only chance to deliver one. Pinning it verbatim
  // makes changing it force a touch of this test, and the review of that touch is
  // where the changelog's manual-add instruction gets written. Forgetting becomes
  // a failing test rather than a silent gap.
  it('global/settings.json ships exactly the four read-only grants', () => {
    expect(JSON.parse(readText('global/settings.json')).permissions).toEqual({
      allow: ['Bash(grep:*)', 'Bash(find:*)', 'Bash(ls:*)', 'Bash(cat:*)'],
      deny: [],
    });
  });
  it('project-template/.claude/settings.json ships an empty grant list', () => {
    expect(JSON.parse(readText('project-template/.claude/settings.json')).permissions).toEqual({ allow: [], deny: [] });
  });
});
```

- [ ] [T-007-B] Run the templates suite.

Run: `npx vitest run tests/installer/templates.test.js`
Expected: the existing templates count plus 11 (3 coverage cases x 2 surfaces, 2 fingerprint directions x 2 files, the global vacuity pin, 2 permissions pins), all passing.

- [ ] [T-007-C] Prove the forward test actually bites. Temporarily remove `'post-compact.sh'` from `PROJECT_SETTINGS_FINGERPRINTS` in `lib/installer/host-owned.mjs`, run `npx vitest run tests/installer/templates.test.js`, and confirm BOTH directions fail for the project file (forward: the PostCompact entry now matches zero; backward stays green because the removed fingerprint is simply gone). Then restore the line exactly and re-run to green. A coverage test that cannot fail is not a coverage test.

- [ ] [T-007-D] Run the full suite and record the count.

Run: `npx vitest run`
Expected: **808 passed, 12 skipped** (797 + 11). Reconcile any difference before continuing.

- [ ] [T-007-E] Stage and commit.

```bash
git add tests/installer/templates.test.js
git commit -m "test: make the host-owned enumeration a contract [BUG-039]

Three coverage assertions per surface, both fingerprint directions, and
the seeded permissions grant list pinned verbatim. The family exists
because this list was never a contract; these are the tests that make it
one, so the next file added to either template must declare its policy
rather than inherit destruction by default.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HLS5KAHkhpMChyqNTbqrhe"
```

---

## Task 8: Release 1.30.0

**Files:**
- Modify: `VERSION`, `package.json`, `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md`

**Interfaces:**
- Consumes: everything above.
- Produces: the 1.30.0 release commit.

- [ ] [T-008-A] Run the full suite one final time with no filter and confirm zero failures and zero existing cases adjusted.

Run: `npx vitest run`
Expected: **808 passed, 12 skipped**. This is AC 21. If any pre-existing case required a change to reach green, stop: that is the failure this criterion exists to catch, and it is reported before the release commit, not after.

- [ ] [T-008-B] Edit `VERSION` to `1.30.0` (single line plus trailing newline).

- [ ] [T-008-C] Edit the `"version"` field in `package.json` to `1.30.0`.

- [ ] [T-008-D] Insert a new section at `CHANGELOG.md:3`, directly above `## [1.29.0]`, leaving every existing line untouched.

```markdown
## [1.30.0] - 2026-09-27

### Fixed

- **[BUG-039]** (superseding **[BUG-035]**) The installer deployed its bundled trees by force-copying them over the host's `.claude/` directories, with no general notion of which paths belong to the installer and which belong to the host. Every re-run destroyed host-authored state that happened to share a filename with something the template ships: a team's `.claude/memory/project.md` replaced by the template stub, an operator's tuned `context-threshold.txt` reverted, and `settings.json` overwritten on both surfaces. The `settings.json` case was worse than a plain overwrite: the global install force-copied the file and then merged the verbosity and graphify hook entries into it, so the machinery built to preserve host entries was merging into a file whose host entries had died six lines earlier, and on the project surface no merger ran at all. Both surfaces now consult one pinned policy table mapping each host-owned path to `skip`, `seed` or `merge`, and `skipHostOwned` is gone. `settings.json` gains a real merge: conductor-owned hook entries are matched by a fingerprint in their command and rewritten where they already sit, every other entry is left exactly as it was, and no top-level key outside `MERGE_OWNED_KEYS` (which is `hooks` and nothing else) is ever written. `permissions` is therefore written exactly once, on a fresh install, and never again, including a grant you deliberately removed: a permission list whose removals do not stick is a ratchet that only loosens. A future release that adds a template grant will say so here with the manual-add instruction, because a test pins the shipped grant list verbatim. The five latent files protected until now only by the template not shipping their names (`memory/personal.md`, `memory/bash-scan-allowlist.txt`, both `session-snapshot` variants, `memory/turn-count.txt`, plus `settings.local.json`) are now protected by the table instead, and coverage tests in both directions fail the build if a template starts shipping one without declaring its policy.

If an earlier re-run already replaced your `.claude/memory/project.md`, this version detects it: when the file is byte-identical to the bundled stub, the deploy prints the two `git` commands that recover a committed copy. It writes nothing; recovery is yours to run.

Existing installations: re-run the installer to apply. This is the first release where that re-run is safe for the files listed above.
```

- [ ] [T-008-E] In `AGENT-READABLE BACKLOG.md:287`, flip the `[BUG-039]` heading from `[ ]` to `[X]` with a surgical single-line edit. Change only the two bracket characters; the rest of the line stays byte-identical.

- [ ] [T-008-F] Append one bullet under the `[BUG-039]` entry recording the outcome: the shipping release, the two new modules, the retirement of `skipHostOwned` and `seedMemoryFile`, and the one limitation carried forward (substring fingerprint matching, out of scope by decision, recorded in the spec).

- [ ] [T-008-G] Stage the release files. `AGENT-READABLE BACKLOG.md` is at the repository root and needs no force flag; nothing here sits under `.claude/`, so no `git add` exit-code workaround applies.

```bash
git add VERSION package.json CHANGELOG.md "AGENT-READABLE BACKLOG.md"
```

- [ ] [T-008-H] Commit the release.

```bash
git commit -m "chore: release 1.30.0 [BUG-039]

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HLS5KAHkhpMChyqNTbqrhe"
```

- [ ] [T-008-I] Report the final state and STOP. Do not push and do not open a pull request without explicit authorization; the standing convention is that the branch is pushed only when the developer says so.

---

## Test List

- [ ] [T-100] Unit tests for the policy tables, `hostOwnedFilter` and `seedHostOwned` (`tests/installer/host-owned.test.js`, T-001)
- [ ] [T-101] Unit tests for `entryMatches`, `matchingFingerprints` and `mergeSettingsFile` across fresh, degenerate, preserving, owned, malformed and symlink cases (`tests/installer/settings-merge.test.js`, T-002)
- [ ] [T-102] Integration tests for the `deployGlobal` seam: seed, re-run preservation, settings merge, managed assets still forced (`tests/installer/deploy.test.js`, T-003)
- [ ] [T-103] Integration tests for the `deployProject` seam, including all five latent files shipped deliberately by the fixture (`tests/installer/deploy.test.js`, T-004)
- [ ] [T-104] Integration tests for the stub detection, fresh-scaffold silence included (`tests/installer/deploy.test.js`, T-005)
- [ ] [T-105] End-to-end `run()` tests over the real bundled assets, both surfaces, across two runs (`tests/installer/cli.test.js`, T-006)
- [ ] [T-106] Contract tests over the shipped trees: table coverage x3, both fingerprint directions, the global vacuity pin, pinned permissions (`tests/installer/templates.test.js`, T-007)
- [ ] [T-107] No E2E/UI test: this project ships no UI.

## Commit Order

| Commit | Tasks | Contents |
|---|---|---|
| 1 | T-000 | The plan file |
| 2 | T-001 | `host-owned.mjs` and its tests, consumed by nothing yet |
| 3 | T-002 | `settings-merge.mjs`, the `backupMalformed` export, and its tests |
| 4 | T-003 | `deployGlobal` rewired, `skipHostOwned` deleted |
| 5 | T-004 | `deployProject` rewired |
| 6 | T-005 | Stub detection |
| 7 | T-006 | CLI wiring, `seedMemoryFile` retired, end-to-end cases |
| 8 | T-007 | The shipped-tree contract |
| 9 | T-008 | Release 1.30.0 |

Commits 2 and 3 add code nothing calls yet, which is deliberate: each is independently reviewable and the suite is green at every boundary, so a reviewer can reject the merge semantics without also rejecting the deploy rewiring.

## Identified Risks

- **`cpSync` may not create a directory all of whose children the filter excludes.** Both surfaces now exclude every shipped file under `memory/`. The explicit `mkdirSync(join(target, 'memory'))` on each surface makes the behavior not matter, and `deploy.test.js`'s existing assertion at `:70` catches a regression immediately. Caught at T-003-F.
- **The global surface's two hook entries are synthesized, not shipped**, so `GLOBAL_SETTINGS_FINGERPRINTS` is empty and T-007's two directions are vacuous for `global/settings.json`. This is a deliberate deviation from AC 14's literal wording ("every conductor fingerprint in the tables matches at least one entry in the corresponding shipped `settings.json`"): the global fingerprints live in `settings.mjs` because only the installer knows the host's absolute home, and they are already covered by the existing `settings.test.js` and `cli.test.js` cases. The forward test still guards the future: the day `global/settings.json` ships a hook entry, it fails until a fingerprint is added. **Flagged for approval rather than decided silently.**
- **`mergeSettingsFile` skips a shipped entry matching zero or several fingerprints**, so a mis-fingerprinted entry silently never reaches existing installs. That is the quieter of the two failures (the alternative, appending it, duplicates it on every re-run), and T-007's forward test is what makes it loud. T-007-C proves that test can fail.
- **Malformed handling differs from `mergeHook`, and is spec-conformant, not a deviation.** The spec's error case says to back the file up, then proceed from the template's content, and that the host must not be left without a working settings file: writing the template after the backup is the letter, not an extension of it. The old `mergeHook` backed up and wrote nothing, and stays untouched, which is the right conservatism for a function whose callers did not ask for the new behavior. No existing case moves; the new behavior is asserted only on the new function. Caught at T-002-E.
- **Deleting `seedMemoryFile` removes an existing test case.** This is the one place the plan touches a pre-existing test. It is a deletion of coverage for deleted code, not an adjustment of an assertion to fit new behavior, and T-006-I's predicted count already carries the -1 so the reconciliation is explicit rather than absorbed.
- **The substring fingerprint captures a host command that merely mentions a conductor hook filename.** Out of scope by decision; narrowing it needs an on-disk marker in every existing install. Recorded in the spec and in the changelog's silence, not solved here.
- **Byte-identical idempotency depends on the host file already being 2-space JSON with a trailing newline.** A host file with 4-space indent is rewritten once on the first merge and is byte-stable from the second run onward. AC 16 says "a re-run of an unchanged release", which that satisfies; it is named here so the first-run diff is not read as a defect.
