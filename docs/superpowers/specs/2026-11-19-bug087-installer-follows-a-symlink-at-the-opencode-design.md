# BUG-087: Installer follows a symlink at the OpenCode guard plugin destination and overwrites its target

**Status:** Approved 2026-11-19 by independent review (round 1)
**Item:** BUG-087 (intake of issue #260; regression of BUG-069)
**Date:** 2026-11-19

## Problem

Since BUG-069, `installOpencodePlugin` (`lib/installer/deploy.mjs:245`; the entry's `:71` predates the current layout) installs `.opencode/plugin/conductor-guard.js` through `mergeFileInto` (`lib/installer/file-merge.mjs:53`). `mergeFileInto` first calls `resolveRealTarget` (`lib/installer/file-merge.mjs:17-23`), which follows a symlink at the target and works on the resolved path on purpose: a `CLAUDE.md` or `.gitignore` symlinked into a dotfiles checkout is a legitimate setup, and the merged files must keep the link.

The plugin is not that kind of file. It is a managed asset, and the shipped bytes always win (`replaceWithTemplate`, `lib/installer/deploy.mjs:243`). When the project checkout ships `.opencode/plugin/conductor-guard.js` as a symlink, `code-conductor --project --opencode`:

1. resolves the link to its target, which can be anywhere the user can write, including outside the project;
2. copies that target to `<target>.installer-backup.<UTC stamp>` next to it;
3. overwrites the target with the shipped plugin bytes;
4. leaves the link in place, so the project's plugin path still points at the outside file.

The repository author chooses the link target; the user running the installer supplies the write permission. The outcome is integrity loss of one user-writable file, recoverable from the backup, plus a stray backup file next to it. It is not code execution. Before BUG-069 the plugin went through `cpSync` with `dereference: false, force: true`, which replaced a link at the destination instead of following it, so this is a regression.

A dangling link at that path has a second, smaller symptom of the same cause: `mergeFileInto` returns `skipped-dangling` and the plugin is not installed at all, while `cpSync` used to install it.

## Solution

In `installOpencodePlugin`, after the `mkdirSync` of `.opencode/plugin/` and before `mergeFileInto`, `lstat` the destination. If it is a symbolic link, remove the link itself (`unlinkSync` removes the link, never its target) and warn on stderr that it was replaced, naming the old link text so the user can recreate it. Then call `mergeFileInto` as today; the path no longer exists, so it takes its `created` branch and writes a regular file with the shipped bytes. A destination that is not a link keeps today's BUG-069 behavior exactly.

**Choice the entry leaves open, and the one taken: unlink and write a regular file, not skip.** Reasons:

- The plugin is the OpenCode side of the guard. Skipping would let any checkout disable the guard install with one symlink, leaving the user with a stderr line and no plugin. Replacing the link makes `--opencode` always end with the shipped guard in place, which is what the flag asks for.
- It restores the pre-BUG-069 result the entry names as correct (`cpSync` with `dereference: false, force: true` replaced the link).
- The file the link pointed to is never opened, read, backed up or written, so nothing outside the project is touched. The link itself is the only thing removed; its text is printed, and in a checkout that tracks it, `git status` shows it and `git checkout` restores it.
- The issue states the plugin "is never meant to live in a dotfiles checkout", so there is no legitimate symlinked setup to preserve, unlike `CLAUDE.md`.

**Why the check lives in `installOpencodePlugin` and not in `mergeFileInto`:** following a link is the correct, tested behavior for the merged root files (`tests/installer/file-merge.test.js` `[AC3]`, `tests/installer/deploy.test.js` "through realpath and keeps the link"). Only the managed-asset call site needs the other rule.

## Behavior

### Main path

1. `deployProject(..., { opencode: true })` calls `installOpencodePlugin`, which creates `<cwd>/.opencode/plugin/` as today.
2. `lstatSync(<cwd>/.opencode/plugin/conductor-guard.js)` reports a symbolic link.
3. The installer reads the link text (`readlinkSync`), removes the link with `unlinkSync`, and warns on stderr:
   `code-conductor: replaced the symlink at .opencode/plugin/conductor-guard.js (it pointed to <link text>) with the shipped plugin; the file it pointed to was not touched`
4. `mergeFileInto` finds no target and writes the shipped plugin as a regular file (`created`), with no backup and no backup line.
5. stdout gets the existing `code-conductor: installed the OpenCode guard plugin at .opencode/plugin/conductor-guard.js`.
6. The file the link pointed to has the same bytes as before, and no `.installer-backup.` file appears next to it.

### Alternative paths

- **No file at the destination, or a regular file:** `lstat` fails with `ENOENT` or reports a regular file; nothing new happens and BUG-069's behavior (create; back up and replace; leave a byte-identical file alone) is unchanged byte for byte, output included.
- **Dangling symlink:** handled by the same branch (lstat sees the link, `readlinkSync` works on a dangling link). The link is replaced and the plugin is installed, where today it is skipped with `it is a dangling symlink`.
- **Symlink to a directory:** same branch. `unlinkSync` removes the link, not the directory or anything in it, and the plugin is installed. Today `mergeFileInto` skips it as `the target is a directory`.
- **A real directory at the destination:** not a link; unchanged (`mergeFileInto` skips it with `the target is a directory`).
- **Without `--opencode`:** `installOpencodePlugin` is not called; nothing changes.

### Error cases

- **`unlinkSync` fails** (for example the plugin directory is read-only): warn on stderr `code-conductor: skipping .opencode/plugin/conductor-guard.js — it is a symlink and could not be removed (<code>); nothing was written`, do not call `mergeFileInto`, and print no `installed` line. The link and its target are left exactly as they were. This matches BUG-069's rule that a failed precondition stops the write and suppresses the `installed` line.
- **`readlinkSync` fails** after `lstat` said link (a race with another process): the warning in step 3 says `(it pointed to an unreadable target)` and the unlink proceeds; the target is still never touched.
- **The link is swapped back between the unlink and the write** (a concurrent local writer in the project directory): out of reach for this item, see Out of Scope. `writeAtomic`'s final `renameSync` replaces a link at the path rather than following it, so the plugin path itself is not written through.

## Acceptance Criteria

The entry's two asks map to AC1 (lstat before `mergeFileInto`, the unlink-and-write option) and AC2 (the test with a symlinked destination outside the project root).

- [ ] **AC1.** `installOpencodePlugin` checks the destination with `lstatSync` before calling `mergeFileInto`, and a symbolic link there is removed with `unlinkSync` and replaced by a regular file holding the shipped plugin bytes.
- [ ] **AC2.** A new `[BUG-087]` row in the FEAT-048 block of `tests/installer/deploy.test.js` (skipped only when `CAN_SYMLINK` is false) points the plugin path at a file in a separate temp directory outside the project root, runs `deployProject(..., { opencode: true })`, and asserts: the outside file's bytes are unchanged; no `.installer-backup.` file exists in the outside directory; `lstatSync` of the plugin path reports a regular file, not a link; the plugin path holds the shipped bytes; stderr has the "replaced the symlink" line naming the link text; stdout is exactly the `installed` line.
- [ ] **AC3.** A `[BUG-087]` row with a dangling link at the plugin path asserts the plugin is installed as a regular file with the shipped bytes and the `installed` line is printed.
- [ ] **AC4.** A `[BUG-087]` row (POSIX non-root and `CAN_SYMLINK` only) makes the plugin directory read-only after creating the link, and asserts the link is still a link to the same text, its target is unchanged, stderr has the `could not be removed` line, and stdout has no `OpenCode` line. Its full test name is added to the `ci-windows-node24` key of `tools/skip-baseline.json`, as the BUG-069 backup-failure row was.
- [ ] **AC5.** The three existing `[BUG-069]` rows and the other FEAT-048 rows pass unchanged, and `tests/installer/file-merge.test.js` and the "through realpath and keeps the link" rows of `tests/installer/deploy.test.js` pass unchanged (the merged files still follow their links).
- [ ] **AC6.** `npm test` exits 0.

## Out of Scope

- **Changing `mergeFileInto` or `resolveRealTarget`.** Following a link stays correct for `CLAUDE.md` and `.gitignore`.
- **Symlinked parent directories** (`.opencode/` or `.opencode/plugin/` being a link). `mkdirSync` and the write still go through such a link. That is a related but different defect, was not introduced by BUG-069, and a symlinked `.opencode/` may be a deliberate shared configuration, so whether to refuse it is a separate product question. It should be filed as its own issue (CONTRIBUTING, "If you are an AI agent", rule 4).
- **The temp file name in `writeAtomic`** (`<path>.installer-tmp.<pid>`), which `writeFileSync` would follow if a link already sat at that exact name. It applies to every merged file, not only the plugin, and is a separate issue to file.
- **Concurrent local writers** racing the installer in the project directory.
- **Any record** (`VERSION`, `CHANGELOG.md`, backlog, memory, README Known-limits lines): written owner-side at release.

## System Impact

- `lib/installer/deploy.mjs`: `installOpencodePlugin` (line 245) gains the lstat/unlink step, as a small helper so the function stays under 30 lines; the `node:fs` import gains `readlinkSync` (`lstatSync` and `unlinkSync` are already imported, line 1). This is the installer, a protected surface: the change is confined to that one function and its new helper, and tests run in temp directories only (the installer is never run on this repository).
- `tests/installer/deploy.test.js`: three new `[BUG-087]` rows in the `deployProject: OpenCode plugin (FEAT-048)` block; `symlinkSync`, `lstatSync`, `chmodSync`, `CAN_SYMLINK` and `POSIX_NON_ROOT` are already available there.
- `tools/skip-baseline.json`: one new name under `ci-windows-node24` for the POSIX-only row (AC4). Predicted CI effect: `ci-node20` and `ci-node24` skip sets unchanged (those legs run symlink and non-root rows today); `ci-windows-node24` gains exactly that one name, while the AC2 and AC3 rows run there, as the existing `CAN_SYMLINK` rows do.
- `bin/` and the CLI exit code: unchanged; `installOpencodePlugin` already reports through `warn` and `report` without affecting the exit status.
- Callers checked: `installOpencodePlugin` has one caller (`lib/installer/deploy.mjs:283`); `mergeFileInto` is not changed, so its other callers are unaffected.

### Files Requiring Full Read (deferred to /cc-plan)

_None._ The function under change, `mergeFileInto`, `resolveRealTarget`, `writeAtomic` and the FEAT-048 test block were read in this phase.

## Complexity Estimate

S — one guard of a few lines at a single call site in the installer, three test rows and one skip-baseline line; no change to the shared merge path.
