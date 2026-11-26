# BUG-091 — Known-failure change list omits new files created under ignored paths

**Status:** Draft (pending independent review)

**Item:** `[BUG-091]` (intake of issue #306, follow-up of `[BUG-089]`). Pillar 5: infrastructure, ecosystem and
quality assurance.

## Problem

In a run that declares `--known-failure` entries, `install qa` writes `.conductor/handback/qa-change.txt`: the files
the change created (`A <path>`) or modified (`M <path>`) against the base commit `start` recorded. The `qa` profile
never counts a failing test in a listed file as known (BUG-089).

`changeList` in `scripts/orchestrate.mjs` (`:718`-`:731`) builds that list from two git calls:

- `git diff --name-status --no-renames --relative -z <base>` (tracked files, created or modified);
- `git ls-files --others --exclude-standard -z` (untracked files that no ignore rule matches).

A new file that matches an ignore rule (`.gitignore` at any depth, `.git/info/exclude` or `core.excludesFile`)
appears in neither. If a build step creates a failing test at such a path and the test runner still executes it, or
adds a rule that ignores the path, and the runner's line for that test contains a declared entry, `qa` counts the
failure as known and the suite reads green.

The impact is limited. Since BUG-089 an entry must be at least 12 characters and more than one word, and it must
match. A `.gitignore` edit shows up as `M .gitignore`. An edit to `.git/info/exclude` or to a global excludes file
shows up nowhere. So this is defense in depth for the BUG-089 rule, not a way around the owner's intent.

## Solution

`changeList` makes a third git call and lists the untracked ignored paths too:

```
git ls-files --others --ignored --exclude-standard --directory --no-empty-directory -z
```

- Every entry it prints is added as `A <path>`, except `.conductor/` and anything under it. That folder holds the
  router's own state, including the list file itself.
- `--directory` prints a wholly untracked ignored directory as a single `<dir>/` entry (for example `node_modules/`)
  instead of every file in it, so the list stays small. A directory that also holds tracked files is never collapsed:
  git lists only its untracked ignored parts (checked with git: `ign/` holding tracked `ign/t.js` and untracked
  `ign/s/n.js` prints `ign/s/`). `--no-empty-directory` leaves out empty directories, which hold no tests.
- The `qa` profile gets one more matching sentence, for entries that end in `/`. A failing test's file matches such an
  entry when a leading part of the file's path that ends in `/` matches the entry under the existing path rule
  (after every `\` becomes `/`, equal, or one ends with `/` followed by the other). Existing matching for file
  entries does not change.
- That sentence is symmetric, like the BUG-089 rule it reuses, so it holds in both directions a printed runner path
  can differ from the listed one. Written out for an entry `D/` and a printed file `F`, it matches in three cases:
  - `F` starts with `D/` (a leading part equals the entry): `tests/.tmp/` matches `tests/.tmp/new.test.js`;
  - `F` contains `/` followed by `D/` (a leading part ends with `/` followed by the entry): the runner prints a
    longer path than the list, as in `pkg/tests/.tmp/new.test.js` against `tests/.tmp/`;
  - the entry ends with `/` followed by a leading part of `F` that ends in `/` (the entry ends with `/` followed by
    a leading part): the runner runs in a subfolder and prints a shorter path, as in `tests/.tmp/new.test.js`
    against `pkg/tests/.tmp/`, because `pkg/tests/.tmp/` ends with `/tests/.tmp/`.
- The second and third cases also match paths that only share a directory name: `dist/` matches
  `pkg/a/dist/x.test.js`, and `pkg/tests/` matches `tests/x.test.js` printed from any folder. That is accepted on
  purpose, as it is for file entries since BUG-089. It only ever makes fewer failures known, so the error goes the
  safe way (a red suite).
- `--directory` stays. Without it git prints every file of an ignored directory, `node_modules/` included, so the
  list would grow with the dependency tree on every run that declares a known failure. The symmetric sentence makes
  the collapsed `<dir>/` entry as strict as listing each file would be, whenever the printed path reaches the
  directory: if the BUG-089 rule would match the printed file against a file `D/rest` under the directory because
  they are equal or the printed file ends with `/D/rest`, a leading part of the printed file is `D/` or ends with
  `/D/`; if it would match because `D/rest` ends with `/` followed by the printed file and that file still names
  part of `D`, a leading part of the printed file is what `D/` ends with.
- One case stays open, and the spec names it rather than hide it: a runner whose working directory is the ignored
  directory itself or a folder inside it prints a path with no part of `D` in it (`new.test.js` for
  `tests/.tmp/new.test.js`). A file entry would match that path; a directory entry cannot, because nothing in the
  printed path ties it to the directory, and treating every such path as a match would make any relative path match
  any directory entry. It needs a test command run from inside an ignored directory that the change created; see
  Out of Scope.

### Decisions this spec takes, and why

1. **The fix lists ignored paths; it does not refuse known failures whenever `.gitignore` changed.** The entry
   suggests both. Only listing covers all the cases: a test created under a path that was *already* ignored at the
   base, and a path ignored through `.git/info/exclude` or `core.excludesFile`, none of which shows `M .gitignore`.
   It also covers a `.gitignore` edit, because the newly ignored file is listed. Refusing on `M .gitignore` would add
   nothing to that and would turn every legitimate `.gitignore` edit into a red suite, so this spec does not add it.
2. **Every untracked ignored path counts as created, including ones that existed before the base commit.** Git keeps
   no record of untracked files, so the script cannot tell a file the change created from one that was there before
   `start`. The error goes the safe way: an ignored path that existed before is listed, so a failing test in it is
   never known and the suite reads red. That needs a test runner that executes an ignored path, a test in it that
   matches a declared entry, and one that was already failing. If that happens, the owner sees it: `qa` names each
   test that matched an entry but is not known because the list names its file (BUG-089). Taking a snapshot of
   ignored files at `start` would close this gap, but it adds run state for a rare case. It is out of scope.
3. **Only `.conductor/` is excluded**, as the entry suggests. Other router files that are ignored and untracked
   (`.claude/memory/orchestrator-run.json`, `band-envelope.json`, `session-snapshot.json`) are listed. They hold no
   tests, so listing them only adds a few lines, and an exception for each would be one more rule to keep up to date.
   In a work tree that ignores `.claude/memory/` and tracks nothing under it, git collapses those files into one
   `A .claude/memory/` entry (checked with git on the BUG-089 test fixture, which ignores `.claude/memory/` and
   tracks `.claude/agents/` and `.claude/scripts/`: the call prints `.claude/memory/`, `.conductor/` and
   `ignored.txt`). Existing tests whose exact list or count holds that entry are updated, not worked around: the
   fixture keeps ignoring `.claude/memory/`, because dropping that rule would make the same files untracked and
   not ignored, and they would be listed one by one instead.
4. **The output line keeps its format.** `change files: <a> created, <m> modified (…)` now counts a directory entry
   as one created entry. The command text says the list can hold `<dir>/` entries. No new output line is added, so the
   commands-parity pins on the line stay as they are.
5. **The new git call fails the same way the other two do.** If any of the three exits non-zero, the list is
   `unavailable (git cannot compare the work tree with the base commit)`, the old file is removed and no failing test
   is known. That is what happens today.

## Behavior

### Main path

1. A run declares a known failure and reaches the `qa` step. The change created `tests/.tmp/new.test.js` under the
   ignored `tests/.tmp/`, which did not exist at the base.
2. `install qa` runs the three git calls. Its list holds `A tests/.tmp/`, together with the diff's entries and the
   untracked non-ignored files, sorted by path with each path listed once.
3. The test runner prints `FAIL tests/.tmp/new.test.js > <a title containing the entry>`. `qa` matches the printed
   file against the entry `tests/.tmp/`, does not count the failure as known, names it as matched-but-not-known, and
   reports the suite red.

### Alternative paths

- **A file under an ignored directory that also holds tracked files:** listed as the file (`A ign/new.test.js`) or as
  its wholly untracked subdirectory (`A ign/sub/`).
- **A runner that prints paths relative to a subfolder:** the list holds `A pkg/tests/.tmp/` and the runner, run in
  `pkg/`, prints `FAIL tests/.tmp/new.test.js`. The leading part `tests/.tmp/` matches the entry, because the entry
  ends with `/tests/.tmp/`, so the failure is not known and the suite reads red.
- **A runner that prints longer paths than the list:** the list holds `A tests/.tmp/` and the runner prints
  `pkg/tests/.tmp/new.test.js`. The leading part `pkg/tests/.tmp/` ends with `/tests/.tmp/`, so it matches and the
  failure is not known.
- **A runner run from inside the collapsed directory:** the list holds `A tests/.tmp/` and the runner, run in
  `tests/.tmp/`, prints `FAIL new.test.js`. No leading part of `new.test.js` matches the entry, so the directory
  entry does not settle it; the failure is known only if its line contains a declared entry (Solution, Out of Scope).
- **A single ignored file:** a new `ignored.txt` matched by a `.gitignore` line is listed as `A ignored.txt`.
- **A `.gitignore` edit that ignores a new test file:** the list holds `M .gitignore` and the test file (or its
  directory) as `A`.
- **An ignored path that existed before the base:** listed as `A`; see Decision 2.
- **`.conductor/` is ignored:** git prints `.conductor/` as one entry, and it is left out. When git prints separate
  paths under it (because some path inside is tracked), those are left out as well.
- **A path both git calls return:** an ignored file never comes from `--exclude-standard` without `--ignored`, so the
  two untracked calls never overlap. A path the diff already holds keeps its diff status, because the untracked
  calls only ever add `A`. A file can't be tracked and untracked at once, so overwriting cannot happen either way.
- **`install qa --check`:** prints the change line, writes nothing (unchanged).
- **A run without known failures:** no git call and no list (unchanged).

### Error cases

- **Any of the three git calls exits non-zero:** `change files: unavailable (git cannot compare the work tree with
  the base commit); no failing test is known`, and an existing list file is removed (unchanged message, Decision 5).
- **No security record or no base commit:** unchanged reasons.

## Acceptance Criteria

- **AC1** — In a run with a declared known failure, `install qa` lists a new untracked file that a `.gitignore` rule
  matches as `A <path>`, and lists the router's ignored `.claude/memory/` as `A .claude/memory/` (Decision 3). The
  existing tests of the BUG-089 block in `tests/scripts/orchestrate.test.js` whose exact expectations change, and
  to what:
  - the AC4 test that today expects `ignored.txt` to be left out (`:5105`): `change files: 5 created, 1 modified`,
    and the list `A .claude/memory/`, `A docs/specs/demo-design.md`, `A ignored.txt`, `A tests/a b.test.js`,
    `M tests/kept.test.js`, `A tests/new.test.js`, in that order; its title stops saying ignored files are left out;
  - the AC4 `install qa --check` test (`:5118`): `changeLine(2, 0)`;
  - the AC4 second-install test (`:5126`): the final list is `A .claude/memory/`, `A docs/specs/demo-design.md`,
    `A tests/second.test.js`;
  - the AC8 short-entry install test (`:5197`): `changeLine(2, 0)` and the list `A .claude/memory/`,
    `A docs/specs/demo-design.md`.
  The block's `SPEC_ONLY` constant, used by the last two, becomes `A .claude/memory/\nA docs/specs/demo-design.md\n`
  under a name that says it is the base list of the fixture. No other test in the file builds a change list: every
  other `--known-failure` run stops before `install qa`.
- **AC2** — A new, wholly untracked ignored directory holding a file is listed once as `A <dir>/`, and none of its
  files is listed on its own. An empty ignored directory is not listed.
- **AC3** — Nothing at or under `.conductor/` is in the list, whether `.conductor/` is ignored as a whole or holds a
  tracked file.
- **AC4** — A change that adds a `.gitignore` rule and a new test file the rule matches produces both `M .gitignore`
  and `A <that path>`.
- **AC5** — Git's `-z` output is parsed by NUL, so an ignored path containing a space is listed byte for byte.
- **AC6** — `changeList` treats a non-zero exit from the ignored-files call the way it treats one from the other two
  calls (one status check over all three). If the work tree's index is corrupt, which makes the `ls-files` calls
  fail, `install qa` prints the existing unavailable line and removes a list file left by an earlier `install qa`. The
  existing BUG-089 unavailable cases (a null base, no security record, a base git cannot read, and the second
  install that finds the list unavailable) keep passing as they are: none of them reaches a list.
  Known limit of this test: a corrupt index makes all three calls fail together, and no fixture makes only the
  ignored-files call fail while the other two succeed (it reads the same index and the same ignore rules as the
  untracked call). So the test shows the unavailable path still works with three calls; it cannot show on its own
  that the third call's status is checked. That part is checked in the code: the plan writes the status check as
  one condition naming all three results, and the build audit reads it.
- **AC7** — `.claude/agents/qa.md` and `project-template/.claude/agents/qa.md` carry, byte-identical, the sentence on
  entries ending in `/`: a failing test's file matches such an entry when a leading part of its path that ends in
  `/` matches the entry under the existing path rule (equal, or one ends with `/` followed by the other, after every
  `\` becomes `/`). The sentence names the three cases of the Solution by example: `tests/.tmp/` matches
  `tests/.tmp/x.test.js`; `tests/.tmp/` matches `pkg/tests/.tmp/x.test.js`; and `pkg/tests/.tmp/` matches
  `tests/.tmp/x.test.js` printed by a runner in `pkg/`. It also says such a match through a shared directory name is
  accepted because it only makes fewer failures known. `tests/unit/role-profiles.test.js` pins the sentence, with a
  separate assertion that the subfolder example (`pkg/tests/.tmp/` matching `tests/.tmp/x.test.js`) is in both
  profiles, and updates the profile sha pins. The BUG-089 sentences pinned there are unchanged.
- **AC8** — Every `cc-orchestrate` mirror describes the list as the files the change created or modified plus the
  untracked ignored paths outside `.conductor/`, a wholly ignored directory being one `<dir>/` entry.
  `tests/installer/commands-parity.test.js` pins that phrase. The existing BUG-089 phrases stay.
- **AC9** — `npm test` is green.

## Out of Scope

- Telling ignored files the change created from ones that were there before `start` (Decision 2).
- Refusing every known failure when `.gitignore` changed (Decision 1).
- A test command run from inside an ignored directory the change created, whose printed paths hold no part of that
  directory (Solution). Closing it would mean listing every file of every ignored directory, `node_modules/`
  included.
- Leaving out other router files (Decision 3).
- `.claude/agents/code.md`: `code` matches against the files it created or edited itself, not against this list.
- The README "Known limits" line for `[BUG-091]` and every other record (`CHANGELOG.md`, backlog, `VERSION`,
  memory): the release updates them.
- The BUG-089 known limit: a changed shared helper breaks an untouched test.

## System Impact

- `scripts/orchestrate.mjs`: `changeList` (`:718`-`:731`) and its BUG-089 comment. No other function changes.
- `.claude/agents/qa.md` and `project-template/.claude/agents/qa.md`: one added sentence after the path-match rule.
- `.claude/commands/cc-orchestrate.md` and its mirrors (`project-template/.claude/commands/cc-orchestrate.md`,
  `project-template/.agents/skills/cc-orchestrate/SKILL.md`, `project-template/.agents/workflows/cc-orchestrate.md`):
  the qa step's description of the list, in the Verify step: `.claude/commands/cc-orchestrate.md:91`,
  `project-template/.claude/commands/cc-orchestrate.md:91`, `project-template/.agents/skills/cc-orchestrate/SKILL.md:95`
  and `project-template/.agents/workflows/cc-orchestrate.md:94`.
- Tests: `tests/scripts/orchestrate.test.js` (the BUG-089 block at `:5075`: the four tests AC1 names and its
  `SPEC_ONLY` constant updated for `A .claude/memory/` and `A ignored.txt`, plus new cases), `tests/unit/role-profiles.test.js` (pins and sha), `tests/installer/commands-parity.test.js`.
- Guard 6 and Guard 7 are unaffected: the script writes the list inside the existing write surface, and neither the
  test command nor the envelope changes.
- These are control-plane files (the `qa` profile, the orchestrate command and script), the same surfaces BUG-089
  touched, and the change moves what the Verify gate accepts as green, in the stricter direction.

### Files Requiring Full Read (deferred to /cc-plan)

- `scripts/orchestrate.mjs`: `changeList` and `changeNote` (`:716`-`:742`).
- `tests/scripts/orchestrate.test.js`: the BUG-089 block from `:5075`, including how its unavailable-list cases
  make git fail.
- `.claude/agents/qa.md`: line 21.

## Complexity Estimate

S — one extra git call and one filter in `changeList`, one profile sentence and one command phrase, each with mirrors,
plus fixture tests in an existing block.
