# BUG-097: Tree fingerprint follows symlinks and opens non-regular files during hand-back

**Status:** Draft (pending independent review)

Source: the `[BUG-097]` entry in `AGENT-READABLE BACKLOG.md` (PILLAR 5), the intake of issue #337, a follow-up of `[BUG-092]`. The entry names a symptom, an impact and a suggested fix shape (`lstat` each path; hash a symlink by its target string; record any other non-regular file as a fixed marker without opening it; cap the bytes read for a regular file; tests for an untracked symlink and a FIFO, POSIX only). It leaves the marker format, the cap and its behavior past the cap, and the treatment of the two out-of-tree ignore files open; "Choices the entry leaves open" below names what this spec takes and why.

**Read-budget disclosure.** `/cc-spec` caps `.mjs` and `.js` reads at the first 30 lines from offset 0. That cap was not held. These ranges were read past it, through `sed -n` or Grep output, and every line number cited below comes from those reads on `main` @ `010f8f2`:

- `scripts/orchestrate.mjs` lines 6-17 (imports) and 750-815 and 1218-1240 (`sed -n`), plus Grep for `contentHash`, `treeFingerprint`, `readFileSync` and `splitCheck`;
- `tests/scripts/orchestrate.test.js` by Grep only (`BUG-092`, `BUG-099`, `timeout`, `skipIf`);
- `tests/installer/deploy.test.js` and `tests/installer/settings-merge.test.js` by Grep only (their symlink skip pattern);
- `tools/skip-baseline.json`: its leg keys and its `deploy.test.js` lines;
- `tests/helpers/can-symlink.js` (the shared `CAN_SYMLINK` gate).

**What git lists, checked with git 2.43.0 in a scratch repository.** `git ls-files --others --exclude-standard` lists an untracked symlink (to a FIFO or anything else) but never an untracked FIFO, socket or device: those never reach `treeFingerprint`. `git diff --name-only <base> --` does list a tracked file that was replaced by a FIFO, without opening it. And `git ls-files --others --exclude-standard` with a FIFO as `core.excludesFile` blocks inside git (killed by `timeout 5`, exit 124), before any line of `orchestrate.mjs` reads the FIFO.

**Line check.** The entry cites `contentHash` at `scripts/orchestrate.mjs:701` and `treeFingerprint` at `:715`. On `010f8f2` they are at `:755` and `:760` (BUG-098 and BUG-099 added lines above them). Nothing else in the entry moved.

## Problem

BUG-092 made `install test-writer` and `install code`, on a run with a test surface, record a fingerprint of the work tree in the run file (`buildTree`, `scripts/orchestrate.mjs:796-801`), and made `handback` take a second one and compare (`splitCheck`, `:1244`, which calls `treeFingerprint` at `:1251`). Each fingerprint maps every changed or untracked, non-ignored path to `contentHash(join(root, path))` (`:769`), and `contentHash` (`:755`) is `createHash('sha256').update(readFileSync(abs))`, with any error read as `absent`.

`readFileSync` follows symbolic links and opens whatever is at the path. The paths come from git and are whatever the role's test command left in the tree, so:

- **A named pipe** reached through an untracked symlink, or a tracked file the test command replaced by a FIFO (`git diff` lists that path; an untracked FIFO itself is not listed, see above): `readFileSync` blocks until a writer appears, which never happens. `orchestrate.mjs install` or `handback` hangs, and the hand-back never completes.
- **A character device** reached through an untracked symlink (for example a link to `/dev/zero` or `/dev/urandom`): `readFileSync` reads until Node's buffer limit, about 2 GiB in memory, before the error turns into `absent`.
- **A symlink to a file outside the project:** the fingerprint records that file's sha256 in the run file, which is content the project does not own and which no hand-back is about.
- **A large regular file:** it is read into memory whole, whatever its size.

Limits, as the entry states them: this is a local availability problem of the orchestrator command. It does not disable the split check, and it needs the role's own test command to create the link or the pipe.

## Solution

Replace `contentHash` with a reader that never follows a link in the tree (neither the path's last component nor a directory above it), never opens a file that is not a regular file, and never reads more than a fixed number of bytes. For each path, `treeFingerprint` first checks that every directory between the root and the path is a real directory, not a link (choice 6), then `lstat`s the path: a symbolic link is recorded by a hash of its target string, read with `readlinkSync`, and its target is never opened; a directory, FIFO, socket or device is recorded as a fixed marker naming its type, without being opened; a regular file up to the cap is hashed as today, read in fixed-size chunks through a descriptor opened without following links and without blocking, and checked again with `fstat` once open; a regular file over the cap is recorded by its size and modification time, unread. The two out-of-tree ignore files of BUG-098 go through the same reader with one difference: their symlinks are followed, as git follows them. Every value stays a string, so `isTreeRecord` (`:1227`) and `changedPaths` (`:1230`) compare the new values unchanged.

### Choices the entry leaves open

1. **The value formats.** A regular file keeps its bare 64-hex sha256, so every fingerprint value of an ordinary tree is what BUG-092 records today and its tests stay as they are. The other kinds carry a prefix no sha256 and no `absent` can take:
   - a symlink: `symlink:<sha256 of the target string's bytes>`. The target is hashed, not stored, so an absolute path outside the project (a home directory, a user name) never lands in the run file. Changing where the link points changes the value; changing the content of what it points to does not, which is what the entry asks for: the link is the tree's entry, the target is not.
   - any other non-regular file: `special:<type>`, with `<type>` one of `directory`, `fifo`, `socket`, `char-device`, `block-device` or `other`. Naming the type, instead of one marker for all, lets a FIFO replaced by a socket count as a change at no cost. `directory` covers what git can list that is not a file (an untracked nested repository, `sub/`, or a submodule path); today `readFileSync` throws `EISDIR` on it and records `absent`, and both ends of the comparison now record `special:directory` instead.
   - a regular file over the cap: `large:<size>:<mtime in nanoseconds>` (from `lstat` with `bigint: true`).
   - a path that is gone or that cannot be read for any other reason: `absent`, as today.
2. **The cap is 64 MiB (`64 * 1024 * 1024` bytes), and a file over it is judged by size and modification time.** The entry asks for a cap and does not say what happens past it. Hashing only a prefix would miss a change after the cap that keeps the size; judging by size and `mtime` catches every write a cooperative tool makes (a write moves `mtime`) and reads nothing. 64 MiB is far above any source or test file a task writes and keeps the read at a fraction of a second. It is a named constant beside the reader. A file that grows past the cap while it is being read stops the read after the cap and is recorded as over the cap, from `fstat`, so the read is bounded even then.
3. **Reading a regular file: `lstat` first, then a guarded open.** `lstat` alone leaves a window between it and the open in which the path can be replaced by a FIFO or a link. The open therefore uses `O_RDONLY | O_NOFOLLOW | O_NONBLOCK` (each flag from `fs.constants`, and `0` where the platform does not define it, as on Windows), and `fstat` on the open descriptor must again say regular file; if it does not, the value is the `special:<type>` the descriptor reports and nothing is read. `O_NONBLOCK` makes an open of a FIFO that appears in that window return at once instead of waiting for a writer, and `O_NOFOLLOW` makes a link that appears in it fail the open (`absent`) instead of being followed. Reading is a loop of `readSync` into one 64 KiB buffer fed to the hash, so memory stays constant whatever the file. The descriptor is closed in every case.
4. **The two ignore files follow their symlinks; everything else applies to them.** `info/exclude` and `core.excludesFile` (`treeAnchor`, `:784-793`) are not paths in the tree: git reads them through their links, and a user's `~/.config/git/ignore` is often a link into a dotfiles repository. Hashing them by link string would let an edit of the linked file go unseen, which reopens what BUG-098 closed. So their reader uses `stat`, not `lstat`, and opens without `O_NOFOLLOW`; the non-regular markers, `O_NONBLOCK`, the `fstat` check and the cap all apply, so a FIFO or a device there cannot hang or flood the command either. Their values stay keyed by BUG-098's fixed labels, so no path is recorded.
5. **No change to the record shape, the halt codes or their messages.** Values are strings as before, so `isTreeRecord` accepts them, and `ORCH_HANDBACK_SURFACE_CROSSED` and `ORCH_HANDBACK_SPLIT_UNVERIFIED` keep their text.
6. **A link in a directory above the path makes the path `absent`.** `lstat` and `O_NOFOLLOW` guard only the last component: if the test command replaces the tracked directory `a/` by a link to a directory elsewhere, `git diff` lists the tracked `a/b` as deleted, and `lstat(join(root, 'a/b'))` would follow `a` and hash a file outside the tree. So before the `lstat`, each parent component under the root (for `a/b/c`, `a` and then `a/b`) is `lstat`ed and must be a directory that is not a link; if one is not, or is gone, the value is `absent`. That is git's own view of the path (it reports `a/b` deleted and lists the link `a` itself as untracked, recorded as `symlink:`), it opens nothing, and the root itself is not checked, so a project under a linked directory (macOS `/tmp`) works as today. Results are cached per parent within one fingerprint, so the extra cost is one `lstat` per distinct directory. The ignore files of choice 4 are not tree paths and skip this check.
7. **A FIFO as an ignore file is git's hang, not the reader's, and stays out of scope.** git opens `core.excludesFile` and `info/exclude` without `O_NONBLOCK` when `ls-files --others --exclude-standard` runs (`:766`), and `spawnSync` there has no `timeout`, so `install` would block inside git whatever the reader does. Adding a `timeout` to the git calls of `treeFingerprint` and `treeAnchor` would need a new halt reason and a choice of limit for every git call on large repositories, for a case that needs the user's own git configuration to point at a pipe; it is a different fix from the one the entry asks for. The reader still treats the ignore files with `O_NONBLOCK` and the `fstat` check (choice 4), so it adds no hang of its own; see Out of Scope.

## Owner decisions

None. The fix narrows what the orchestrator command reads; it adds no network, dependency, installed permission or public surface. If the review judges otherwise, the question is the cap value and the over-cap rule (choice 2).

## Behavior

### Main path

1. A run with `test_surface: ["tests/**"]` reaches a Build dispatch of `test-writer`. The tree holds the usual changed files and, from an earlier test run, an untracked symlink `tests/tmp/pipe-link` pointing at a FIFO with no writer, an untracked symlink `tests/tmp/null` pointing at `/dev/zero`, and the tracked file `tests/fixtures/stream` replaced by a FIFO with `mkfifo`.
2. `install test-writer` fingerprints the tree. `tests/tmp/pipe-link` is recorded as `symlink:<sha256 of its target string>`, `tests/tmp/null` as `symlink:<sha256 of "/dev/zero">`, and `tests/fixtures/stream` (listed by `git diff`) as `special:fifo`, none of them opened; each regular file is recorded by its sha256 as today. The command returns at once.
3. The role writes its tests and runs the suite; `handback test-writer` fingerprints the tree again the same way, finds no change outside the surface and records the hand-back as today.

### Alternative paths

- **A symlink to a file outside the project:** recorded as `symlink:<hash of its target string>`; the outside file is never opened and its hash is in no run file. An edit of the outside file during the dispatch is not a change to the tree; repointing the link is, and is judged by the split like any other changed path.
- **A tracked directory replaced by a link** (`a/` now points elsewhere): the tracked `a/b` that `git diff` lists is `absent` (choice 6), and the untracked link `a` is `symlink:<hash of its target string>`; nothing outside the tree is opened.
- **An untracked FIFO, socket or device:** git does not list it, so it is in no fingerprint, today or after this fix.
- **A dangling symlink:** recorded by its target string like any other link, not as `absent`.
- **A regular file over 64 MiB:** recorded as `large:<size>:<mtime>`, unread. A write that changes its size or modification time counts as a change.
- **A regular file under the cap:** hashed as today; the value and every BUG-092, BUG-098 and BUG-099 test that pins one is unchanged.
- **A directory git lists** (nested repository, submodule): `special:directory` at both ends, so it does not count as changed unless it is replaced by a file or removed.
- **Windows:** `O_NOFOLLOW` and `O_NONBLOCK` are absent from `fs.constants`, so they are `0` there; `lstat` and `readlinkSync` still classify a symlink, and Windows has no FIFO in the tree. The `lstat`-first rule is what protects that platform.
- **A run file whose `build_tree` was installed by an earlier version mid-dispatch:** a symlink or a directory in it carries the old value (the target's hash, or `absent`) and the hand-back's new value differs. On the role's own side of the split that changes nothing; on the other side it halts `ORCH_HANDBACK_SURFACE_CROSSED` naming the path, and `resume` re-installs with the new values. The halt costs one re-dispatch and only on a run upgraded mid-dispatch.
- **An ignore file that is a symlink:** followed, and its target's content hashed under the cap (choice 4). A device there is recorded as `special:<type>`, unread. A FIFO there is recorded the same way by the reader, but git itself then blocks in `ls-files` (choice 7, Out of Scope).

### Error cases

- **A path replaced by a FIFO or a link between `lstat` and the open:** the open either fails (`O_NOFOLLOW` on a link: `absent`) or returns at once and `fstat` reports it as not a regular file (`special:<type>`); nothing blocks and nothing outside the tree is read.
- **A file that grows past the cap while it is read:** the read stops after the cap and the value is `large:<size>:<mtime>` from `fstat`.
- **`readlinkSync` or `lstat` fails** (the path vanished, permission denied): `absent`, as today's read error.
- **A read error after the open:** `absent`, and the descriptor is closed.

## Acceptance Criteria

- [ ] An untracked symlink to a file outside the project is recorded in `build_tree.files` as `symlink:` followed by the sha256 of its target string, not the target's content hash; editing the target leaves the value unchanged, repointing the link changes it (`tests/scripts/orchestrate.test.js`, temp git repositories; skipped where the platform cannot create a symlink).
- [ ] An untracked symlink to `/dev/zero` is recorded as a `symlink:` value, and `install` and `handback` complete within the test's spawn timeout (`tests/scripts/orchestrate.test.js`, POSIX only).
- [ ] An untracked symlink to a FIFO with no writer is recorded as a `symlink:` value, and a tracked file replaced by a FIFO (`mkfifo`) is recorded as `special:fifo`; `install code` and `handback code` complete within the test's spawn timeout in both cases (`tests/scripts/orchestrate.test.js`, POSIX only).
- [ ] A tracked file replaced by a FIFO, or an untracked symlink, outside the test surface and left unchanged during a `test-writer` dispatch does not halt; one created during it halts `ORCH_HANDBACK_SURFACE_CROSSED` with BUG-092's message (`tests/scripts/orchestrate.test.js`).
- [ ] A regular file over 64 MiB (a sparse file from `truncateSync`) is recorded as `large:<size>:<mtime>` without being read, and a change of its modification time counts as a change (`tests/scripts/orchestrate.test.js`).
- [ ] A regular file under the cap is still recorded as the bare sha256 of its bytes; every existing BUG-092, BUG-098 and BUG-099 test passes unchanged (`tests/scripts/orchestrate.test.js`).
- [ ] A tracked directory replaced by a symlink to a directory outside the project records its tracked file as `absent` and the link as a `symlink:` value; no hash of the outside file is in `build_tree.files` (`tests/scripts/orchestrate.test.js`, skipped where the platform cannot create a symlink).
- [ ] A symlinked `core.excludesFile` is hashed by its target's content, so an edit of the target during the dispatch still halts with BUG-098's ignore-file message (`tests/scripts/orchestrate.test.js`, skipped where the platform cannot create a symlink).
- [ ] `scripts/orchestrate.mjs` no longer calls `readFileSync` on a fingerprinted path or an ignore file (`tests/scripts/orchestrate.test.js`, a source check like the existing one at `:1328`, or the behavior tests above).
- [ ] `tools/skip-baseline.json` lists every new test a CI leg skips (the POSIX-only ones on `ci-windows-node24`), so each leg's skip assertion stays green.
- [ ] `npm test` exits 0.

## Out of Scope

- Any other `readFileSync` in `scripts/orchestrate.mjs` (the run file, the hand-back reports, the plan, `CLAUDE.md`, the change list): their paths are the router's own or the owner's, not whatever a test command left in the tree.
- `changeList` (`:735-750`) and the qa change list: it lists paths and does not read them.
- A non-cooperative agent that restores a large file's `mtime` with `utimes` after a same-size write: as in BUG-092, the run file and the guards assume cooperative agents.
- A FIFO as `core.excludesFile` or `info/exclude`: git blocks on it inside `ls-files --others --exclude-standard`, before and independently of the reader (choice 7). A `timeout` on the git calls is a separate fix.
- Following a symlink to judge the file it points to: the link is the tree entry (choice 1).
- The README "Known limits" line for `[BUG-097]`, if any, and every other record: the release writes them.
- `.github/workflows/` and `.github/actions/`.

## System Impact

- `scripts/orchestrate.mjs`: `contentHash` (`:755`) is replaced by a bounded reader with a follow / no-follow mode and a 64 MiB constant; `treeFingerprint` (`:769`) uses the no-follow mode, `treeAnchor` (`:788`, `:791`) the follow mode. The `node:fs` import (`:6`) gains `closeSync`, `constants`, `fstatSync`, `lstatSync`, `openSync`, `readSync`, `readlinkSync` and `statSync` as needed. `splitCheck`, `isTreeRecord`, `changedPaths`, `buildTree` and the halt messages are untouched.
- `tests/scripts/orchestrate.test.js`: new tests in the BUG-092 describe block or a new `[BUG-097]` block, using its temp-repository fixtures.
- `tools/skip-baseline.json`: the new POSIX-only and symlink-gated test names on the legs that skip them.
- Not touched: the hooks, the installer, the SNAP contract, settings, the agent profiles and the `/cc-orchestrate` copies (no halt code or message changes), README and wiki (no documented behavior changes). No network, dependency or installed-permission change.

### Files Requiring Full Read (deferred to /cc-plan)

- `scripts/orchestrate.mjs`: `treeAnchor` and `buildTree` in full, `splitCheck` (`:1244-1260`), and any other caller of `contentHash` the plan's Grep finds.
- `tests/scripts/orchestrate.test.js`: the BUG-092 / BUG-098 / BUG-099 fixtures (`:5656-6090`), its `orch` spawn helper and timeout (`:687`), and how it creates temp git repositories and sets `core.excludesFile`.
- `tests/helpers/can-symlink.js`: the shared `CAN_SYMLINK` gate the new symlink tests import, as `tests/installer/deploy.test.js:2` and `tests/installer/settings-merge.test.js:2` do.

## Complexity Estimate

S: one helper replaced in one script, two call sites switched, and a handful of tests with their skip-baseline lines; no record, message, hook or contract change.
