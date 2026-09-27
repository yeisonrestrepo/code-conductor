# Installer Host-Owned State: One Contract for Both Deploy Surfaces

**Backlog id:** `[BUG-039]` (surviving id for the family). `[BUG-035]` is marked `[~]` superseded by this item.
**Date:** 2026-09-27
**Target release:** 1.30.0 (minor: the installer stops overwriting files it used to overwrite, and `settings.json` gains a merge path)

## Problem

`code-conductor` deploys managed assets by force-copying bundled trees over the host's `.claude/` directories. The copy has no general notion of which paths belong to the installer and which belong to the host, so every re-run destroys host-authored state that happens to share a filename with something the template ships.

Two instances are filed, and the audit for this spec found a third plus a latent fourth:

| Surface | Path | Today | Consequence of a re-run |
|---|---|---|---|
| `global/` to `~/.claude/` | `settings.json` | FORCE | `[BUG-035]`: user-added hook entries destroyed |
| `project-template/.claude/` to `<cwd>/.claude/` | `memory/project.md` | FORCE | `[BUG-039]`: the team's shared decision log replaced by the template stub |
| same | `memory/context-threshold.txt` | FORCE | `[BUG-039]`: an operator's tuned value reverted to the default |
| same | `settings.json` | FORCE | **Found by this audit.** Same defect as `[BUG-035]` on the project surface, with **no merger at all** running afterwards |
| same | `memory/bash-scan-allowlist.txt`, `memory/personal.md`, `memory/session-snapshot.json`, `memory/turn-count.txt`, `settings.local.json` | not shipped | **Latent.** Safe today only because the template does not carry those filenames. Nothing prevents a future release from adding one |

The `global/` surface already solves its half correctly for two files: `skipHostOwned` (`lib/installer/deploy.mjs:45`) excludes `memory/**` from the copy so `personal.md` and `verbosity.md` survive, and `deployGlobal` then creates the directory explicitly (`:119`) so write-if-absent seeding still works. The project surface was never given the equivalent, and `settings.json` was never added to the exclusion on either surface.

**The `settings.json` case is worse than "force-copied".** `bin/code-conductor.mjs` force-copies it at `:93` and then runs `mergeVerbosityHook` and `mergeGraphifyHook` into it at `:98-99`. The mergers exist precisely to preserve host entries, and they are merging into a file whose host entries were destroyed six lines earlier. The preservation machinery is real; it is applied one step too late.

**The family exists because the list was never a contract.** Each fix so far has been a one-off exclusion for the file that happened to break. The fix here is the list itself becoming a pinned, tested contract, so the next file added to either template is forced to declare its policy rather than inherit destruction by default.

## Solution

Introduce one module that pins, per deploy surface, an exhaustive table mapping each host-owned path to one of three policies: `skip` (never write it, and do not ship a seed), `seed` (write only when absent), or `merge` (combine host content with installer-owned parts). Both `deployGlobal` and `deployProject` consult their table through one shared mechanism, replacing the ad-hoc `skipHostOwned` filter. `settings.json` gains a real merge that is entry-level and fingerprint-driven, generalizing what `settings.mjs` already does for two hooks, and that writes nothing outside a separately pinned `MERGE_OWNED_KEYS`. Tests assert that the deploy paths honor the tables, that no shipped path colliding with a host-owned path lacks an entry, and that the merge writes no key it does not declare.

## Behavior

### Main path

1. `deployGlobal(assetRoot, home)` copies `global/` to `~/.claude/` with a filter derived from `GLOBAL_HOST_OWNED`, excluding every path whose policy is `skip`, `seed` or `merge`.
2. It creates the directories those exclusions prevented `cpSync` from creating.
3. For each `seed` entry, it writes the template's copy only if the target does not exist.
4. For each `merge` entry, it runs that entry's merge function against the host's file.
5. `deployProject(assetRoot, cwd)` does the same against `PROJECT_HOST_OWNED` for `project-template/.claude/`, which today it does not do at all.
6. `settings.json` merging replaces only hook-array entries whose `command` carries a conductor fingerprint, leaves every other entry in those arrays in place, and writes no top-level key outside `MERGE_OWNED_KEYS` (which is `['hooks']` and nothing else).
7. On a fresh install where `settings.json` is absent, the whole template file is written, `permissions` included. That is the only time `permissions` is ever written.

### Alternative paths

- **Fresh scaffold.** No `.claude` exists. Every `seed` entry is written from the template and `settings.json` is written whole, so a new project is identical to today's result.
- **A host deliberately deleted a seeded file.** Write-if-absent restores it. This is accepted, not a defect: it is the same behavior `seedMemoryFile` has had for `personal.md`, and distinguishing "deleted on purpose" from "never existed" would require state the installer does not keep.
- **A host edited `permissions`.** Untouched forever after the seed, including a grant the operator revoked. A future release that adds a template grant does not deliver it to existing installs; that release's changelog entry must carry the manual-add instruction.
- **A path is host-owned but the template ships nothing for it** (`bash-scan-allowlist.txt`). Policy `skip`. There is no seed source and none is invented; the entry exists so that adding that filename to the template later fails the coverage test instead of silently destroying operator policy.
- **`settings.json` is a symlink** into a dotfiles repo. The merge writes through `resolveRealTarget` (`lib/installer/file-merge.mjs:13`), as the `CLAUDE.md` merge already does, so the link is never replaced by a regular file.
- **An earlier re-run already destroyed `project.md`.** On deploy, if the host's `project.md` is byte-identical to the template stub, print one line noting that an installer re-run before 1.30.0 may have overwritten it and giving the two git commands to recover a committed copy. Detection only; nothing is written.

### Error cases

- **Malformed host `settings.json`.** Route through the existing `backupMalformed` path in `settings.mjs`: back the file up, then proceed from the template's content. The merge must not throw, and must not leave the host without a working settings file.
- **`hooks` holds a non-array, or an entry is not an object.** Treat the malformed portion as absent rather than throwing, and preserve it verbatim in the output if it is not a conductor entry. The installer is not a JSON validator and must not fail a deploy over a shape it does not recognize.
- **A seed write fails** (permissions, read-only volume). Non-fatal and reported once; managed assets have already landed and the deploy should not be rolled back.
- **`.claude` exists and is not a directory.** Unchanged from today: `deployProject` throws `PROJECT_TARGET_NOT_DIR` and `run()` reports exit 1.

## Design decisions

### The enumeration is a policy table, not a skip list

The audit found three distinct required behaviors across the two surfaces, so a flat list of paths cannot express the contract. A table states each file's full treatment in one readable place:

```js
// ~/.claude/. Only personal.md and verbosity.md are shipped under global/memory/;
// conductor-version.md is written there by writeVersionFile and is installer-owned,
// so it needs no entry and survives because nothing ships that filename.
export const GLOBAL_HOST_OWNED = new Map([
  ['memory/personal.md',   'seed'],
  ['memory/verbosity.md',  'seed'],
  ['CLAUDE.md',            'merge'],
  ['settings.json',        'merge'],
  ['settings.local.json',  'skip'],
]);

// <cwd>/.claude/. Only project.md and context-threshold.txt are shipped; every
// `skip` below is a file the host or a conductor command writes at runtime and the
// template must never start shipping.
export const PROJECT_HOST_OWNED = new Map([
  ['memory/project.md',              'seed'],
  ['memory/context-threshold.txt',   'seed'],
  ['memory/personal.md',             'skip'],
  ['memory/bash-scan-allowlist.txt', 'skip'],
  ['memory/session-snapshot.json',   'skip'],
  ['memory/session-snapshot.md',     'skip'],
  ['memory/turn-count.txt',          'skip'],
  ['settings.json',                  'merge'],
  ['settings.local.json',            'skip'],
]);
```

Three notes on the entries, because each encodes a decision:

- `memory/personal.md` is `skip` on the project surface and `seed` on the global surface because only `global/` ships a template copy of it. Inventing a project-level stub would put template prose where a developer's local file belongs.
- The five project `skip` entries are the exhaustive set of runtime-written files under `.claude/memory/`: `personal.md` and `turn-count.txt` and both `session-snapshot` variants are named in `.gitignore` (`:3`, `:16`, `:11`, `:17`), and `bash-scan-allowlist.txt` is operator policy introduced by `[BUG-037]`. None is shipped today, so every one of them is currently protected only by absence. That is precisely the condition this table converts into a contract.
- `settings.local.json` is Claude Code's own local-override convention, not a conductor file, and is present in this repository's live `.claude/`. It is `skip` on both surfaces.

### The settings merge is entry-level and fingerprint-driven

Key-level replacement would keep unknown top-level keys but still destroy a host entry sharing an owned key, which is a narrower version of the same defect. Entry-level matching by a fingerprint substring in the command is what `settings.mjs:37-104` already does for `verbosity-remind.sh` and `graphify-ast-refresh`; this generalizes that mechanism to the full owned set rather than inventing a second one.

**The merge is in place.** The host's existing entry order is preserved, a conductor-owned entry is rewritten where it already sits rather than removed and re-appended, and only genuinely new entries are appended. This is cosmetic to correctness and load-bearing for trust: it is what makes a re-run's diff read as restraint rather than as the installer having rearranged a file it does not own, and it makes a re-run of an unchanged release a no-op at the byte level.

**Known limitation, stated rather than solved:** fingerprint matching is substring-based, so a host command that merely mentions a conductor hook's filename is captured as conductor-owned and replaced. Narrowing this would require a marker the installer writes into entries it owns, which changes the on-disk format for every existing install. Out of scope; recorded here so the next reader does not mistake it for an oversight.

**Considered and declined: a one-time backup on first migration.** The settings gate offered backing up `settings.json` before the first merged deploy. Declined, because the merge preserves host content by construction rather than by recovery, and the one path where content genuinely cannot be preserved, a malformed host file, already backs up through `backupMalformed` with a five-deep pruner. A steady-state backup on every re-run would be noise, and a one-time backup needs migration state the installer does not keep.

### `permissions` is host-owned after seeding, and that is declared, not implied

A privilege grant list whose removals do not stick is not a permission list; it is a ratchet that only loosens. Unioning the template's grants into a host's file would silently restore a grant the operator deliberately revoked, which is the opposite of what a guardrails product should do: the operator's tightening must always win over the template's convenience.

So `permissions` is written exactly once, at seed time, and never again. Crucially this is **declared by a constant rather than implied by the merge happening not to look at it**:

```js
export const MERGE_OWNED_KEYS = ['hooks'];
```

A companion test asserts the merge writes no key outside `MERGE_OWNED_KEYS`. `env`, `statusLine`, `model` and every key a future Claude Code adds inherit the same answer by construction, which is the test of whether a contract is finished: it answers "what about key X" without a new decision.

The cost is real and its disposition is mechanical. A test pins the seeded `permissions` block by naming the current grant list, so changing the template's grants forces touching that test, and the review of that touch is where the changelog's manual-add instruction gets written. Forgetting becomes a failing test rather than a silent gap.

**One line to prevent a future "improvement":** the stub-detection warning does **not** extend to `permissions`. A host `permissions` block differing from the seed is the feature working, not a loss to detect, and must never produce a warning.

### Recovery is detection only

Both 1.28.0 and 1.29.0 instructed users to re-run the installer, so some `project.md` files are already gone. Restoring automatically from git would mean the installer reaching into the host's history and writing files from it, with new failure modes (detached HEAD, shallow clone, submodule, dirty index, no git at all) for a path that fires in one narrow case. Detect the stub, print the recovery commands, write nothing.

**Detection covers `project.md` only, and not `context-threshold.txt`.** Stub-equality is informative for `project.md` because a project that has been worked in accumulates decisions, so a stub where prose belongs is genuinely suspicious. It is uninformative for `context-threshold.txt`, whose stub is a default value most hosts never tune, so the warning would fire on nearly every install and train users to ignore it. The detection runs before the seed, so a fresh scaffold never warns about the stub it was just given and that false-positive class does not exist. The residual one that remains is different and is accepted: a real project scaffolded earlier, worked in little or not at all, whose `project.md` genuinely still equals the stub. That is why the wording says "may have been overwritten" rather than "was".

### Supersession

`[BUG-039]` is the surviving id and carries the family; `[BUG-035]` is marked `[~]` superseded by `[BUG-039]`, following the direction set when `[BUG-036]` superseded `[BUG-034]` (the newer id survives). `[BUG-035]`'s entry gains a forward pointer so the 1.28.0 and 1.29.0 changelog references to it still resolve.

## Acceptance Criteria

- [ ] A `--project` re-run over an existing installation leaves a host-modified `.claude/memory/project.md` byte-identical.
- [ ] The same re-run leaves a host-modified `.claude/memory/context-threshold.txt` byte-identical.
- [ ] The same re-run leaves a host-created `.claude/memory/bash-scan-allowlist.txt` byte-identical.
- [ ] The same re-run leaves `.claude/memory/personal.md`, `session-snapshot.json`, `session-snapshot.md`, `turn-count.txt` and `.claude/settings.local.json` byte-identical when each is present. All five appear in `PROJECT_HOST_OWNED`; this criterion enumerates the same five the audit did, so the two cannot drift apart silently.
- [ ] A global re-run leaves a host-added `UserPromptSubmit` entry in `~/.claude/settings.json` present and unmodified.
- [ ] A project re-run leaves a host-added entry in `<cwd>/.claude/settings.json` present and unmodified.
- [ ] A re-run updates a conductor-owned hook entry whose template command changed, on both surfaces, so the 1.28.0-style matcher repair still reaches existing installs.
- [ ] A re-run leaves a host-modified `permissions` block byte-identical, including a grant the host removed.
- [ ] A fresh scaffold receives `project.md`, `context-threshold.txt`, `settings.json` and its `permissions` block from the template.
- [ ] A fresh global install receives `personal.md`, `verbosity.md` and `settings.json` from the template.
- [ ] A test asserts every path shipped under `global/` or `project-template/.claude/` that collides with a host-owned path has an entry in that surface's table; adding such a file to a template without a table entry fails.
- [ ] A test asserts the settings merge writes no top-level key outside `MERGE_OWNED_KEYS`.
- [ ] A test pins the seeded `permissions` grant list verbatim, so changing the template's grants cannot pass silently.
- [ ] A test asserts, per surface, that every conductor fingerprint in that surface's list matches at least one entry in that surface's shipped `settings.json`, so a renamed hook cannot leave a dead fingerprint behind.
- [ ] A test asserts the forward direction, per surface: every hook entry in that surface's shipped `settings.json` matches exactly one conductor fingerprint. Every entry a template ships is by definition conductor-owned, so exhaustive forward coverage is assertable today. Without it, a future release can add a template hook entry and forget its fingerprint, after which the merge either never delivers that entry to existing installs or appends it beside itself on every re-run. The two directions together are the contract; either alone is half.
- [ ] The global surface's fingerprint list is **empty**, because `global/settings.json` ships `permissions` and no hooks at all: its two hook entries are synthesized at install time from the host's absolute home, which is why a bare `~` cannot be shipped (`settings.mjs:27-35`), and `mergeVerbosityHook` and `mergeGraphifyHook` already own them entry-level with their own tested fingerprints. Both directions are therefore vacuous for that file today, and that vacuity is **asserted rather than tolerated**: a test pins `GLOBAL_SETTINGS_FINGERPRINTS` equal to the shipped file's own hook-entry set, empty equalling empty, so the day that file ships a hook entry the forward assertion fails until a fingerprint is added.
- [ ] A merge preserves the host's existing entry order, replaces a conductor-owned entry in position rather than removing and re-appending it, and appends only entries that are genuinely new. A re-run of an unchanged release produces a byte-identical `settings.json`.
- [ ] A malformed host `settings.json` is backed up and the deploy completes without throwing.
- [ ] A symlinked `settings.json` is written through its resolved path and remains a symlink.
- [ ] Deploying when `project.md` matches the template stub prints the recovery line exactly once and writes nothing.
- [ ] `skipHostOwned` is gone, with both surfaces going through the one shared mechanism.
- [ ] The full suite passes with no existing case adjusted to fit.

## Out of Scope

- **Narrowing fingerprint matching** beyond substring, which would need an on-disk marker in every existing install.
- **Automatic restoration** of an already-overwritten `project.md`.
- **Removing stale assets** an older version deployed and the current one no longer ships; `sweepStaleFlatSkills` and `sweepStaleRootScripts` cover the two known cases and a general sweeper is separate work.
- **`[BUG-040]`** (`git add` exit code under `.claude/`) and **`[BUG-038]`** (`/cc-checkpoint` phase carry-forward), both unrelated and independently queued.
- **The `skills/` and `scripts/` surfaces.** Both are wholly managed, `cpSync` does not delete unshipped files, and the audit found no host-owned path under either. Named here so the next reader knows they were audited rather than forgotten.

## System Impact

- `lib/installer/deploy.mjs`: `skipHostOwned` (`:45`) removed, `deployGlobal` (`:106`) and `deployProject` (`:137`) rewired through the shared mechanism, `CP_OPTS` (`:23`) unchanged.
- `lib/installer/settings.mjs`: `mergeHook` (`:69`) generalized from two fingerprints to the owned set; `backupMalformed` and `pruneMalformedBackups` reused as-is.
- `lib/installer/config.mjs`: `seedMemoryFile` (`:35`) is the write-if-absent precedent and may generalize to serve all `seed` entries.
- `bin/code-conductor.mjs:93-101`: the copy-then-merge ordering that makes `[BUG-035]` observable.
- A new module holding the tables, `MERGE_OWNED_KEYS`, and the fingerprint set.
- Tests: `tests/installer/deploy.test.js`, `settings.test.js`, `cli.test.js` (the end-to-end re-run case), `templates.test.js` (the coverage assertion sits naturally beside the existing shipped-asset sweeps).

### Files Requiring Full Read (deferred to /cc-plan)

- `lib/installer/deploy.mjs`: the 30-line cap reached the header and `MERGED_ROOT_FILES`; the copy sites were mapped by grep, but the rewire needs the whole file.
- `lib/installer/settings.mjs`: `mergeHook`'s body (`:69-104`) is where the generalization lands.
- `lib/installer/config.mjs`: the `seedMemoryFile` and `writeVerbosity` bodies.
- `lib/installer/file-merge.mjs`: `mergeFileInto`'s write path, for the symlink and backup guarantees.
- `bin/code-conductor.mjs`: the call ordering.
- `tests/installer/deploy.test.js` and `settings.test.js`: existing cases must not be adjusted to fit.

## Complexity Estimate

**L.** The mechanism is small and the precedents all exist in-repo, but the work spans two deploy surfaces, a generalized merger, a new pinned contract with four separate meta-tests, and an end-to-end re-run case that is invisible on first install. The risk is not difficulty; it is the number of places a host-owned file can be destroyed, which is exactly why the enumeration is the deliverable.
