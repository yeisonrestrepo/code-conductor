# BUG-098: Split check fingerprint diffs against the current HEAD instead of the HEAD recorded at install

**Status:** Draft (pending independent review)

Source: the `[BUG-098]` entry in `AGENT-READABLE BACKLOG.md` (PILLAR 5), the intake of issue #341, a follow-up of `[BUG-092]`. The entry names a symptom (a moving `HEAD` and an edited `.git/info/exclude` hide files from the hand-back fingerprint), an impact (only the after-the-fact detection of `[BUG-092]` is affected; Guard 5 still denies direct writes) and a fix shape for `HEAD` (record it at install, diff against it at hand-back, treat a `HEAD` change as a crossing). It names no fix for the ignore file and no required test; "Choices the entry leaves open" below names what this spec takes and why.

**Read-budget disclosure.** `/cc-spec` caps `.mjs` and `.js` reads at the first 30 lines from offset 0. That cap was not held. These ranges were read past it, through `sed -n` or Grep output, and every line number cited below comes from those reads on `main` @ `5601b89`:

- `scripts/orchestrate.mjs` lines 171 (`OBJECT_NAME`), 265-300, 740-830, 1195-1245 and 1605-1620 (`sed -n`), plus Grep for `treeFingerprint`, `build_tree`, `SURFACE_CROSSED` and `base`;
- `tests/scripts/orchestrate.test.js` lines 5656-5700 (`sed -n`), plus Grep for `BUG-092` and `BUG-099`;
- `tests/installer/commands-parity.test.js` lines 386-400 (`sed -n`), plus Grep;
- `.claude/agents/code.md` and `.claude/agents/test-writer.md` by Grep only (tools and the word `commit`).

**Line check.** The entry cites `treeFingerprint` at `scripts/orchestrate.mjs:755`; on `5601b89` it starts at `:759` (BUG-099 added lines above it). Nothing else in the entry moved.

## Problem

BUG-092 made `install test-writer` and `install code`, on a run with a test surface, record a fingerprint of the work tree in the run file's `build_tree` (`buildTree`, `scripts/orchestrate.mjs:773-777`), and made `handback` compare it with a second fingerprint and halt `ORCH_HANDBACK_SURFACE_CROSSED` when a file on the other role's side of the split changed during the dispatch (`splitCheck`, `:1207-1219`). That check exists for the writes Guard 5 cannot see, the role's test command first among them.

Both fingerprints come from `treeFingerprint` (`:759-770`), which lists the tracked files that differ from whatever `HEAD` is at the moment it runs (`git diff --name-only … HEAD`) and the untracked files that `--exclude-standard` does not hide. Both inputs can move between the two calls, and the role's test command, which runs with the role's `Bash`, can move them:

- **`HEAD`.** If the test command stages and commits a file during the dispatch, that file no longer differs from the new `HEAD`, so it is absent from the hand-back fingerprint. A file that was absent at install too (a new test written by `code`) then compares equal, absent to absent, and no crossing is reported.
- **Ignore rules outside the tree.** `--exclude-standard` reads the in-tree `.gitignore` files, `$GIT_DIR/info/exclude` and the file `core.excludesFile` names (by default `$XDG_CONFIG_HOME/git/ignore`). A line added to either of the last two during the dispatch hides a file the role created, with the same result. Neither file is part of the work tree, so its change is in no fingerprint and in no diff the audit reads.

Neither the `code` nor the `test-writer` agent commits, and nothing in `/cc-orchestrate` commits between `install` and `handback` (Grep of `.claude/agents/code.md`, `.claude/agents/test-writer.md` and `.claude/commands/cc-orchestrate.md`), so a `HEAD` that moves during a Build dispatch, or an ignore file outside the tree that changes during it, is never part of the role's task.

## Solution

`install` records, with the fingerprint, the commit `HEAD` names (or `null` before the first commit) and the sha256 of the two ignore files outside the work tree. `handback` takes its fingerprint against the recorded commit instead of the current `HEAD`, so a committed file still shows as changed; and it treats a `HEAD` that moved, or an ignore file that changed, during the dispatch as a crossing: `ORCH_HANDBACK_SURFACE_CROSSED`, naming the move or the file, ahead of any crossed paths. A `build_tree` recorded without these fields (installed before this fix) is not a valid record and halts `ORCH_HANDBACK_SPLIT_UNVERIFIED`, recovered with `resume` as today.

### Choices the entry leaves open

1. **The base is the commit `install` saw, not the run's `security.base`.** The run already records a base commit for the security seat and the change list (`changeList`, `:735-750`), but it is `null` on runs without a seat and it is the run's start, not this dispatch's. The fingerprint compares two moments of one dispatch, so its base is the `HEAD` at that dispatch's `install`, as the entry says.
2. **A moved `HEAD` is a crossing even when no crossed path is found.** Diffing against the recorded commit already brings committed files back into the hand-back fingerprint, so the move does not hide them any more. It still halts, as the entry asks, because no Build role commits (Problem, last paragraph): a move means the test command or the role did something outside its task, and a commit can also rewrite history the owner has to review (an amend, a reset) in ways no path list shows. The halt names both commits and, when there are any, the crossed paths found against the recorded one.
3. **Ignore rules: the two out-of-tree files are fingerprinted, not the ignored set.** The entry names `.git/info/exclude` and no fix. Two shapes were weighed. Listing ignored paths at install and at hand-back (as `changeList` does for qa) catches any newly hidden file, but it reports every new ignored artifact on the other side of the split: a `coverage/` folder that a `test-writer` test run creates for the first time would halt it, a false positive BUG-092 avoided on purpose by honoring ignore rules. Fingerprinting the files that hold the rules catches the edit itself, has no such false positive (no task edits a file under `.git/` or the user's global configuration), and adds two entries to the record. The files are `git rev-parse --git-path info/exclude` (correct in a linked worktree, where it lives in the common directory) and `core.excludesFile` as `git config --path core.excludesFile` prints it, else `$XDG_CONFIG_HOME/git/ignore`, else `$HOME/.config/git/ignore`, git's own default order. They are keyed in the record by the fixed labels `info/exclude` and `core.excludesFile`, so the record holds no absolute path, and a `core.excludesFile` that is repointed during the dispatch to a file with other content also counts as changed. A file that does not exist hashes as `absent`, as in the tree map, so creating one is a change.
4. **In-tree `.gitignore` files stay as they are.** A tracked or visible `.gitignore` is a project file a task may legitimately change; its change is already a path in both fingerprints (a crossing when it lies on the other side of the split) and in the diff the audit reviews. A new file hidden by a `.gitignore` edit on the role's own side is not caught by this item; see Out of Scope.
5. **One halt code, a longer message.** A moved `HEAD` and a changed ignore file are reported with the existing `ORCH_HANDBACK_SURFACE_CROSSED`, because their recovery is the same (the owner reviews and reverts by hand, then `resume`) and every copy of `/cc-orchestrate` already explains it. The message keeps BUG-092's exact text when only paths crossed, so its tests and documents still match.
6. **The record is validated, an old one is rejected.** `isTreeRecord` (`:1200-1202`) accepts a `files` record only with `head` either `null` or an object name (`OBJECT_NAME`, `:171`) and `ignores` a plain object whose two labels map to strings. A run file installed by an earlier version mid-dispatch then halts `ORCH_HANDBACK_SPLIT_UNVERIFIED`, and `resume` re-dispatches with a full record, rather than pass a check it cannot complete. The `unavailable` record is unchanged.

## Behavior

### Main path

1. A run with `test_surface: ["tests/**"]` reaches `install code`. `install` records `build_tree: { role: "code", head: "<sha of HEAD>", ignores: { "info/exclude": "<sha256|absent>", "core.excludesFile": "<sha256|absent>" }, files: { … } }`, where `files` is the tracked files that differ from that commit plus the untracked, non-ignored files, each with its sha256 (as today).
2. `code` runs its test command, which neither commits nor edits an ignore file. `handback code` reads `HEAD` and the two ignore files, takes the fingerprint against the recorded `head`, finds the same `HEAD`, the same ignore hashes and no path on the test side that changed, and records the hand-back as today.

### Alternative paths

- **The test command commits a new test file** (`git add tests/b.test.js && git commit`) during a `code` dispatch: the hand-back fingerprint, taken against the recorded commit, lists `tests/b.test.js`; `handback code` halts `ORCH_HANDBACK_SURFACE_CROSSED` naming the move from the recorded commit to the new one and `tests/b.test.js`.
- **The test command commits a file on the role's own side** (a `code` commit of `src/a.js`): no path crossed, but `HEAD` moved; the hand-back halts naming the move only.
- **The test command adds a line to `.git/info/exclude`** that hides a new `tests/hidden.test.js` during a `code` dispatch: the file is in neither fingerprint, but the `info/exclude` hash changed; the hand-back halts naming `info/exclude`. The same holds for the file `core.excludesFile` names.
- **No commit at install:** `head` is `null`; the fingerprint at both ends lists every tracked file, as `treeFingerprint` does today without a `HEAD`. A first commit made during the dispatch is a `HEAD` move from `no commit` to its sha.
- **`HEAD` moved and moved back** (commit, then `git reset --soft` to the recorded commit) during the dispatch: `HEAD` equals the recorded commit and the diff against it shows the files as changed, so the check runs as on an unmoved `HEAD`.
- **`test-writer`:** the same, with the crossed paths outside the surface, as in BUG-092.
- **`install --check`, roles other than `code` and `test-writer`, runs without a test surface:** no fingerprint, as today.
- **git unavailable at install:** `build_tree` is `{ role, unavailable }` as today, and the hand-back is recorded with `split check: unavailable (<reason>)`.
- **`resume` after either halt:** unchanged. It drops `build_tree` and keeps the records it can still anchor (a new commit on top of the recorded one still descends from the approvals); the re-dispatched `install` records the new `HEAD` and ignore hashes. `resume` does not revert the commit or the ignore edit: the owner does that by hand first, as the halt's documentation says.

### Error cases

- **`HEAD` moved:** `ORCH_HANDBACK_SURFACE_CROSSED: <role> moved HEAD from <recorded sha | no commit> to <current sha | no commit> during its dispatch`, then, when any ignore file changed, `; <role> changed the ignore file <label>[, <label>] during its dispatch`, then, when any path crossed, `; ` and BUG-092's text `<role> changed <paths> during its dispatch, <inside|outside> the test surface <surface>`. The hand-back is not recorded.
- **Only ignore files changed, or ignore files and paths:** the same message without the `HEAD` part, starting `ORCH_HANDBACK_SURFACE_CROSSED: <role> changed the ignore file …`.
- **Only paths crossed:** BUG-092's message, byte for byte.
- **The recorded commit cannot be diffed** (pruned after a rewrite): `treeFingerprint` fails as for any git error, and the hand-back halts `ORCH_HANDBACK_SPLIT_UNVERIFIED` with git's reason, as today.
- **A `build_tree` without `head` or `ignores`, or with a malformed one:** `ORCH_HANDBACK_SPLIT_UNVERIFIED: no valid fingerprint of the tree recorded at install for <role>; resume to re-dispatch it`, as today.

## Acceptance Criteria

- [ ] `install code` and `install test-writer` on a run with a test surface record `build_tree.head` as the full object name `HEAD` resolves to (or `null` in a repository with no commit) and `build_tree.ignores` with exactly the labels `info/exclude` and `core.excludesFile`, each the sha256 of the file or `absent`; BUG-092's AC6 record expectations are extended by these two fields (`tests/scripts/orchestrate.test.js`).
- [ ] A `code` dispatch whose test command commits a new file under `tests/` halts `handback code` with `ORCH_HANDBACK_SURFACE_CROSSED`, naming the move between the two full object names and the committed file, and records no hand-back (`tests/scripts/orchestrate.test.js`).
- [ ] A `test-writer` dispatch that commits a change to a source file halts the same way, naming the file outside the surface (`tests/scripts/orchestrate.test.js`).
- [ ] A `code` dispatch that commits only a file on its own side halts naming the `HEAD` move and no path (`tests/scripts/orchestrate.test.js`).
- [ ] A `code` dispatch that appends a rule to `.git/info/exclude` hiding a new `tests/` file halts naming `info/exclude`; a repository-level `core.excludesFile` edited during a dispatch halts naming `core.excludesFile` (`tests/scripts/orchestrate.test.js`).
- [ ] In a repository with no commit at install, a first commit during the dispatch halts naming the move from `no commit` (`tests/scripts/orchestrate.test.js`).
- [ ] A `build_tree` with `files` but no `head` or no `ignores` halts `ORCH_HANDBACK_SPLIT_UNVERIFIED` with BUG-092's message (`tests/scripts/orchestrate.test.js`).
- [ ] BUG-092's other split-check tests and BUG-099's run-file bound tests pass unchanged.
- [ ] The four `/cc-orchestrate` copies (`.claude/commands/cc-orchestrate.md`, `project-template/.claude/commands/cc-orchestrate.md`, `project-template/.agents/skills/cc-orchestrate/SKILL.md`, `project-template/.agents/workflows/cc-orchestrate.md`) say, beside the `ORCH_HANDBACK_SURFACE_CROSSED` sentence, that the hand-back also halts it when `HEAD` moved or `.git/info/exclude` or the `core.excludesFile` file changed during the dispatch, and that the owner reverts the commit or the edit by hand before `resume`; `tests/installer/commands-parity.test.js` pins the sentence in the `[BUG-092 AC5]` block.
- [ ] The README's "Guard 5 in detail" paragraph says in one clause that `install` also records `HEAD` and the out-of-tree ignore files, and that the hand-back diffs against that `HEAD` and halts when either moved.
- [ ] `npm test` exits 0.

## Out of Scope

- A new file hidden by an in-tree `.gitignore` edit on the role's own side (choice 4). The edit is a changed path the audit reviews; catching its effect needs the ignored-set listing that choice 3 rejects for its false positives. A follow-up candidate, not minted here.
- Ignore sources other than the two files `--exclude-standard` reads outside the tree (for example `-c core.excludesFile=` on a single command, which affects no later command).
- `[BUG-097]` (symbolic links and non-regular files in `contentHash`).
- Guard 5 and the hooks: unchanged; they already deny the direct writes.
- The README "Known limits" line for `[BUG-098]`, `CHANGELOG.md`, `VERSION` and every other record: the release writes them.
- `.github/workflows/` and `.github/actions/`.

## System Impact

- `scripts/orchestrate.mjs`: `treeFingerprint` (`:759-770`) takes the base commit to diff against instead of reading `HEAD` itself; a small helper reads `HEAD` (or `null`) and the two ignore hashes; `buildTree` (`:773-777`) records `head` and `ignores`; `isTreeRecord` (`:1200-1202`) validates them; `splitCheck` (`:1207-1219`) compares them and builds the longer message. `install`, `handback`, `resume`, BUG-099's bound (two short entries more) and the halt-code set are unchanged.
- The four `/cc-orchestrate` copies (one sentence each) and `README.md` ("Guard 5 in detail", one clause).
- Tests: `tests/scripts/orchestrate.test.js` (the BUG-092 block at `:5656`: AC6 expectations extended, new cases beside AC7), `tests/installer/commands-parity.test.js` (one `toContain` in the `[BUG-092 AC5]` block).
- Not touched: `.claude/hooks/`, the SNAP contract and envelope versions, the installer, settings, the run-file shape outside `build_tree`. No network, dependency or installed-permission change: the change only adds two git reads and two file hashes to a check that already runs, and halts where it would otherwise pass a hidden crossing.

### Files Requiring Full Read (deferred to /cc-plan)

- `scripts/orchestrate.mjs` (about 1960 lines): `treeFingerprint`, `buildTree`, `isTreeRecord`, `splitCheck` and their callers, `nulPaths`, `contentHash`, `OBJECT_NAME`.
- `tests/scripts/orchestrate.test.js`: the BUG-092 block from `:5656` (its `atWriter`/`atCode` fixture, `fixtureGit`, `fixtureCommit`, `crossed`) and how a test simulates a test command's writes between `install` and `handback`.
- `tests/installer/commands-parity.test.js`: the `[BUG-092 AC5]` block (`:391-399`).

## Complexity Estimate

S: one function gains a base argument, the fingerprint record gains two fields with their validation, and the hand-back compares them, reusing the existing halt code; plus one sentence in five documents and about seven tests.
