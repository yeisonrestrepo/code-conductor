# BUG-069: Installer overwrites an existing OpenCode guard plugin without a backup

**Status:** Approved 2026-11-19 by independent review (round 1)
**Item:** BUG-069 (intake of issue #164)
**Date:** 2026-11-19

## Problem

With `--project --opencode`, `deployProject` (`lib/installer/deploy.mjs:241`) copies every entry of `project-template/` other than `.claude` and the merged root files with a bare `cpSync(..., { recursive: true, force: true })` (`lib/installer/deploy.mjs:261-266`). The `.opencode` entry goes through that loop, so `.opencode/plugin/conductor-guard.js` is force-copied over whatever is already at that path.

A user who edited the plugin (or who has an older copy they adapted) loses those edits on the next `--opencode` install, with no copy left anywhere and no line telling them it happened. The installer's merged files (`CLAUDE.md`, `.gitignore`) behave differently: `mergeFileInto` (`lib/installer/file-merge.mjs:53`) backs the host file up to `<file>.installer-backup.<UTC stamp>` before rewriting it, refuses to write when the backup fails, and `backupReporter` (`lib/installer/deploy.mjs:34`) prints one stdout line naming the backup (BUG-049).

Only users who opted into the OpenCode plugin are exposed; the flag is opt-in. The README's Known-limits line for BUG-069 (`README.md:499`) currently tells them to copy an edited plugin aside by hand.

## Solution

Take `.opencode` out of the force-copy loop and install the plugin file through the same `mergeFileInto` path the merged root files use, with a merge function that returns the shipped plugin verbatim and reports `changed` only when the host bytes differ. That reuses, without new code paths, the backup-before-overwrite (`backupFile`: `.installer-backup.<stamp>` suffix, `-N` collision suffix, retention of 5), the "failed backup stops the write" rule, the atomic write, and the existing directory / dangling-symlink / symlink-resolution handling. The backup is reported with the existing `backupReporter`, given an action word so the line says "before replacing it" instead of "before merging". The "installed the OpenCode guard plugin" line is printed only when the plugin is actually in place afterwards.

**Choice the entry leaves open, and the one taken:** the entry asks for a backup, not for preserving the user's edits. The plugin stays a managed asset that the installer replaces with the shipped version (it must track the guard's payload contract, see README "OpenCode"); the user's version is kept as a backup and its path reported, exactly as the issue suggests. Keeping the host's edited file in place instead would leave a plugin that can silently drift from the guard it calls, so it is not taken.

**Why `mergeFileInto` and not a new copy helper:** it already implements every behavior the entry asks for, plus the edge cases (symlinks, directories) a new helper would have to re-derive. The only new code is a one-line "replace with template" merge function and the call site.

## Behavior

### Main path

1. `deployProject(..., { opencode: true })` reaches the root-entry loop; `.opencode` is skipped there unconditionally.
2. After the loop, when `opencode` is true, the installer ensures `<cwd>/.opencode/plugin/` exists (`mkdirSync` recursive) and calls `mergeFileInto(<template>/.opencode/plugin/conductor-guard.js, <cwd>/.opencode/plugin/conductor-guard.js, replaceWithTemplate, { warn, onBackup })`.
3. The target exists and differs from the shipped bytes: the host file is copied to `.opencode/plugin/conductor-guard.js.installer-backup.<UTC stamp>` first, then the shipped plugin is written atomically.
4. stdout gets, in this order:
   - `code-conductor: backed up .opencode/plugin/conductor-guard.js to .opencode/plugin/conductor-guard.js.installer-backup.<stamp> before replacing it (git-ignored by design)`
   - `code-conductor: installed the OpenCode guard plugin at .opencode/plugin/conductor-guard.js` (unchanged text).

   "git-ignored by design" is correct for the same reason it is for `CLAUDE.md`: `*.installer-backup.*` is in the managed `.gitignore` block (`project-template/gitignore:3`) that the same run merges.

### Alternative paths

- **No plugin yet (fresh install):** written verbatim, no backup, no backup line; the "installed" line prints. Same output as today.
- **Existing plugin byte-identical to the shipped one (re-install):** nothing is written and no backup is made (`changed: false` → `unchanged`); the "installed" line still prints, since the plugin is in place. Re-running the installer therefore does not pile up backups.
- **Existing plugin empty or whitespace-only:** replaced with no backup, as `mergeFileInto` does for an empty host `CLAUDE.md`; there is nothing to recover.
- **Repeated installs over an edited plugin within the same UTC second, or many installs:** the existing `-1`/`-2` collision suffix and retention of 5 backups apply unchanged.
- **Plugin path is a symlink to a regular file:** the real file is backed up and written through, as for the merged files (the link is kept). A backup outside the project root is reported with its absolute path and without the "git-ignored by design" suffix (existing `backupReporter` rule).
- **Host's other `.opencode/` files** (for example `.opencode/command/mine.md`): untouched, as today.
- **Without `opencode`:** no `.opencode/` is written and no OpenCode line is printed; a Claude Code install stays byte-for-byte unchanged.

### Error cases

- **Backup fails** (for example a read-only `plugin/` directory): the plugin is not overwritten, the existing `mergeFileInto` warning goes to stderr, the "installed" line is not printed, and the rest of the install continues (same status as a merged file, `skipped-backup-failed`).
- **Write fails after a successful backup:** existing warning naming the unchanged file and its backup; no "installed" line.
- **Plugin path is a directory or a dangling symlink:** existing `skipping … — the target is a directory` / `— it is a dangling symlink` warning; nothing written; no "installed" line.
- **Shipped plugin missing from a damaged package:** `mergeFileInto` returns `skipped-missing`; no "installed" line. (`assertAssets` and the template tests already guard the shipped tree.)

## Acceptance Criteria

- [ ] With `opencode: true` and an existing `.opencode/plugin/conductor-guard.js` whose bytes differ from the shipped plugin, `deployProject` leaves a `.installer-backup.<stamp>` file next to it holding the host's original bytes, and the plugin holds the shipped bytes.
- [ ] That install reports the backup path on stdout with the line given in Main path step 4, before the "installed" line.
- [ ] With a byte-identical existing plugin, no backup file is created and no backup line is printed; the "installed" line prints.
- [ ] With no existing plugin, output and resulting files are identical to today's (the existing FEAT-048 tests in `tests/installer/deploy.test.js` and `tests/installer/cli.test.js` pass unchanged).
- [ ] When the backup cannot be written, the host's plugin is left byte-for-byte unchanged, a stderr warning is emitted, and no "installed" line is printed.
- [ ] Without `opencode`, no `.opencode/` path is created (existing test stays green).
- [ ] The host project's other `.opencode/` files are kept (existing test stays green).
- [ ] The existing merged-file backup lines still end in `before merging` (existing assertions in `deploy.test.js` and `cli.test.js` stay green).
- [ ] A test pins that `project-template/.opencode/` ships exactly one file, `plugin/conductor-guard.js`, so a second shipped file cannot be silently dropped now that the directory is no longer force-copied wholesale.
- [ ] `npm test` passes.

## Out of Scope

- Preserving the user's edited plugin in place, or merging edits into the shipped plugin (see the choice above).
- The README Known-limits line for BUG-069 (`README.md:499`) and every other record (`VERSION`, `CHANGELOG.md`, backlog): written by the release.
- Backups for other force-copied assets (`.claude/` hooks, commands, skills): not named by this entry.
- `.opencode` or `.opencode/plugin` existing as a regular file: today `cpSync` throws there; the new `mkdirSync` throws there too. Behavior is not changed by this item.
- BUG-071 (the plugin forwarding only `command`) and any change to the plugin's own code.

## System Impact

- `lib/installer/deploy.mjs` (protected surface: installer): the root-entry loop stops copying `.opencode`; a short step after it installs the plugin through `mergeFileInto` with a `replaceWithTemplate` merge function; `backupReporter` gains an action word (default `merging`, so existing callers and lines are unchanged); the "installed" report becomes conditional on the returned status (`created`, `merged`, `unchanged`).
- `lib/installer/file-merge.mjs`: used as is (`mergeFileInto`, `backupFile`); no change expected.
- `tests/installer/deploy.test.js`: new cases in `describe('deployProject: OpenCode plugin (FEAT-048)')` for differing / identical / backup-failure targets; existing cases unchanged.
- `tests/installer/templates.test.js` (or the OpenCode describe block): the one-file pin for `project-template/.opencode/`.
- No new dependency, no new network access, no change to installed permissions or to which files the installer writes beyond the backup file (already a pattern the managed `.gitignore` block covers).

### Files Requiring Full Read (deferred to /cc-plan)

- `lib/installer/deploy.mjs` (309 lines): the spec phase inspected only the header and grep-located excerpts of `backupReporter` and `deployProject`; the plan reads it in full before task breakdown.
- `lib/installer/file-merge.mjs` (110 lines): `backupThenWrite`'s statuses and warning texts were seen only through grep excerpts.
- `tests/installer/deploy.test.js`: the FEAT-048 describe block and its `capture()` helper, to place the new cases.

## Complexity Estimate

S — one call site in the installer moves onto an existing, tested merge-and-backup path, plus a reporter wording parameter and four focused tests.
