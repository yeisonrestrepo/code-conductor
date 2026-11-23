# BUG-089 — Known-failure substring matching lets generic entries or newly added failing tests pass a red suite

**Status:** Approved 2026-11-23 by the owner

**Item:** `[BUG-089]` (intake of issue #284, follow-up of `[BUG-074]`). Pillar 5: infrastructure, ecosystem and quality
assurance.

The spec and the plan need an owner approval, not a delegated one: the change edits control-plane files
(`.claude/agents/code.md`, `.claude/agents/qa.md`, `.claude/commands/cc-orchestrate.md`, `scripts/orchestrate.mjs`),
which a delegated plan review escalates (BUG-080), and it changes what the Verify gate accepts as green, which is the
security posture of that gate. The one posture choice the entry leaves open was decided by the owner, together with
four refinements; they are recorded in [Owner decisions](#owner-decisions) and the text below is written to them.

## Problem

`[BUG-074]` let the owner declare known failures for a run: `start --known-failure <text>` records each value in the
run file's `known_failures`, and `code` and `qa` call a failing test known when "the line the runner prints for it
contains a declared entry verbatim" (`.claude/agents/code.md:21`, `.claude/agents/qa.md:21`). Two holes follow from
plain substring matching:

1. **A generic entry matches almost everything.** `isKnownFailureArg` (`scripts/orchestrate.mjs:1493`) accepts any
   value that is non-blank, has no line break, is at most 200 characters, does not start with `--` and is not
   repeated. `--known-failure a`, `--known-failure test` or `--known-failure FAIL` are all accepted, and each is
   contained in nearly every failure line a runner prints. A red suite then reads as green and can reach
   `verify_pass`.
2. **A new failing test can borrow a declared entry.** The entry is matched against the failure line, not against the
   failure the owner meant. A `code` task can add a failing test whose file or title contains a declared entry (a new
   test in a declared file, or a title that repeats a declared title), and that new failure counts as known, by `code`
   and by `qa`.

Both need an entry the owner declared, and the start line and the final report show the entries and their matches, so
this is hardening of the Verify gate, not a bypass of owner intent.

## Solution

Two independent changes, one per hole, each the shape the entry suggests:

- **`start` refuses a generic entry.** A `--known-failure` value must be at least 12 characters long once trimmed and
  must not be a single word: it must hold at least one character outside the Unicode classes `\p{L}` (letters) and
  `\p{N}` (numbers) and the characters `_` and `-` (a space, a `/`, a `.`, a `:`, a `>` …), so a non-ASCII word such as
  `autenticación` is one word too. A value that fails either rule is refused with `START_USAGE`, exit 2, nothing written,
  exactly as the other malformed values are today.
- **A failing test in a file the change created or modified is never known.** At `install qa` in a run whose
  `known_failures` is non-empty, the script computes the change's files against the base commit `start` recorded
  (`security.base`) and writes them to `.conductor/handback/qa-change.txt`, one `A <path>` (created) or `M <path>`
  (modified) line each; every `install qa` rewrites the file, so a resumed run never reads a list from an earlier
  step. `qa.md` says that a failing test in a file that list names is red even when its line contains a declared
  entry, and that with no such file no failing test is known. `code.md` says the same for the files `code` itself
  created or edited in its task. Both roles take a failing test's file only from the runner's own output and compare
  it to a listed path by a fixed rule (see "Locating a failing test's file" below); a test whose file the output does
  not print is red. The shared green sentence that `plan`, `code` and `qa` hold word for word does
  not change; the new rule narrows the existing sentence "A failing test is known when …", which only `code` and `qa`
  carry.

No gate, router position or SNAP field changes. A red `qa` still halts through `ORCH_HANDBACK_MISSING`, as today.

### Decisions this spec takes, and why

1. **A length floor plus a not-one-word rule, not a required test-file path.** The entry offers either. A required
   path segment does not fit every runner this tool supports: `cc-stack` detects many stacks, and several runners print
   a failing test's own line without its file (jest's `● suite › title`, Go's `--- FAIL: TestName`). Requiring a path
   there would push the owner to declare whole files, which is broader, not narrower. The floor is runner-agnostic and
   refuses the cases the issue names: a single character, and one word, however long (`AssertionError`,
   `authentication`). 12 characters is the length of a short test path or `suite > title`, and refuses every common
   status word (`FAIL`, `failed`, `Error`, `timeout`, `TypeError`). The rule is a floor against degenerate entries, not
   a proof of specificity: an entry such as `should throw` still passes it, and the start line, the run header and the
   final report's matched-entry list (BUG-074) remain what makes a too-broad entry visible. The word test is written
   with Unicode classes (`/^[\p{L}\p{N}_-]+$/u` on the trimmed value), so `autenticación` or `проверка_доступа` is
   refused like its ASCII counterpart. Counting is in code points
   after `trim()`, so padding with spaces does not reach the floor; the 200-character ceiling is unchanged and is
   counted as today, on the value as given.
2. **"Added by the change" is decided per file, by the script, against the recorded base.** `qa` cannot run git
   (Guard 7 grants it only the test command), and a role's own `ops.f` list is the role's claim, not a measurement. The
   script already records the base commit at `start` for the security seat (`resolveSecurity`,
   `scripts/orchestrate.mjs:540`), so `install qa` can measure the change the same way the scan does: tracked files
   that differ from the base in the work tree (`git diff --name-status --no-renames <base>`, so a rename is a delete
   plus a create), plus untracked files that are not ignored (`git ls-files --others --exclude-standard`), the latter
   as `A`. The list is a superset of "tests the change added": every new test lives in a file the change created or
   modified, so none can borrow an entry. Its cost is that a declared failure in a file the change also edits is no
   longer known, so such a run cannot reach `verify_pass` until that failure is fixed. The owner chose this per-file
   rule over a per-test one (see [Owner decisions](#owner-decisions)).
3. **The list lives in the hand-back folder.** `.conductor/handback/` is in the orchestrator's write surface, which
   Guard 6 keeps every role from writing, and `end`, and `start` over a previous run, already remove the whole folder
   (`clearRunFiles`, `scripts/orchestrate.mjs:1559`), so a list never outlives its run. Within a run, every
   `install qa` (the first one and each one after a fix round or a resume) recomputes the change and overwrites the
   file, and when the list cannot be computed it removes any file left by an earlier `install qa`, so `qa` never reads
   a list older than the work tree it tests. The name `qa-change.txt` does not collide with a
   role report (`qa.txt`, `code-<N>.txt`, `code-fix-<r>.txt`). The file is written only when `known_failures` is
   non-empty, so a run without declared failures is byte-identical to today's.
4. **Doubt resolves to red, as in BUG-074.** When the base is `null` (not a git work tree, or no commit at `start`),
   when the run predates FEAT-034 and has no `security` record, or when git fails, the script writes no list and
   prints why; `qa` then knows no failing test, so green is exit 0 only. When `qa` cannot tell whether a failing test
   lies in a listed file, it is red.
5. **`code` applies the rule to its own edits.** `code` knows which files it created or edited in its task, so a
   failing test there is never known to it. Files earlier tasks changed are left to `qa`, whose run is the
   authoritative one; this keeps `code`'s rule free of anything it would have to measure.
6. **The run file's validation does not change.** `isKnownFailureList` keeps accepting any array of non-empty
   strings. A run started before this item may hold a short entry; refusing it would halt that live run with
   `ORCH_RUN_INVALID` for a value the owner declared under the old rule, and the run file is written only by `start`
   (Guard 6). The new `qa` rule applies to such a run as soon as it reaches `install qa`.
7. **Locating a failing test's file.** `qa` and `code` take a failing test's file only from the runner's own output:
   the path printed on the test's failure line, or on the file header the runner prints above it. They never use
   Read, Grep or Glob to find which file holds a title. When the output prints no path for a failing test, that test
   is red. This keeps the rule a reading of what the runner said, with nothing for the role to infer.
8. **Matching a printed path to a listed one.** Both paths are compared after every `\` is turned into `/`. A printed
   path matches a listed path when the two are equal, or when one ends with `/` followed by the other (so
   `/home/u/repo/tests/a.test.js` matches `tests/a.test.js`, and `tests/a.test.js` does not match
   `tests/ba.test.js`). When the role cannot settle the comparison by this rule, the test is red.

## Behavior

### Main path

1. The owner starts a run with a specific entry:
   `/cc-orchestrate BUG-089 --known-failure 'tests/contract/x.test.js > isolated store'`. `start` validates the value
   (at least 12 characters, more than one word, plus the BUG-074 rules), records it in `known_failures` and echoes it
   in the start line, unchanged from BUG-074.
2. Each `code` task runs the test command after its last edit. A failing test whose line contains a declared entry is
   known only when the runner's output prints its file and that file does not match (decision 8) one `code` created or
   edited in this task.
3. At `install qa`, the script lists the change's files against `security.base` into
   `.conductor/handback/qa-change.txt` (`A <path>` / `M <path>`, one per line, sorted by path) and adds one line to its
   output: `change files: <a> created, <m> modified (.conductor/handback/qa-change.txt)`. Each `install qa` overwrites
   the file. With `--check` it computes and prints the same line but writes nothing, as `--check` writes nothing
   today.
4. `qa` runs the test command. A failing test is known when its line contains a declared entry, the runner's output
   prints its file, and that file matches no path in `qa-change.txt` (decision 8). Green hands back `verify_pass`; the report lists each failing test with the entry it matched, as
   today, and names each failing test that matched an entry but was red because its file is in the list.
5. `end` removes the hand-back folder, the list with it.

### Alternative paths

- **No `--known-failure`.** No list is written and `install qa` prints no new line; `code` and `qa` behave as today
  (exit 0 only).
- **A new test file fails and its path contains a declared entry** (for example the owner declared
  `tests/contract/x.test.js` and a task creates `tests/contract/x.test.js.bak.test.js`): the file is `A` in the list,
  so `qa` reports red.
- **A task adds a failing test to a declared file**: the file is `M` in the list, so every failing test in it is red
  for `qa`, the new one and the declared one alike (owner decision (a)).
- **The change edits a file that holds a declared failure and adds no test**: same as above, red; the owner fixes
  that failure first (the cost of owner decision (a)).
- **A declared failure lies in a file the change does not touch**: known, as today.
- **The runner prints a failing test without its file** (for example a runner that prints only `--- FAIL: TestName`
  and no file header): that test is red for `qa` and for `code`, even when its line contains a declared entry.
- **A resumed run, or a second `install qa` after a fix round**: the list is recomputed and the file overwritten; when
  it cannot be computed this time, the earlier file is removed and the `unavailable` line is printed.
- **The base is `null`, the run has no `security` record, or git fails at `install qa`**: no list is written,
  `install qa` prints `change files: unavailable (<reason>); no failing test is known` instead, and `qa` treats the
  suite as green only on exit 0.
- **A run started before this item with a short entry**: still valid; `qa` applies the file rule.
- **Outside a run** (`/cc-test`): no known failures, exit 0 only, unchanged.

### Error cases

- `start --known-failure` with a value shorter than 12 characters once trimmed (`a`, `FAIL`, `   abc   `), or a single
  word (`AssertionError`, `authentication_tests`, `autenticación_de_usuarios`): `START_USAGE`, exit 2, nothing written. All BUG-074 refusals stay.
- The Start step in `cc-orchestrate.md` tells the orchestrator that such a refusal is the owner's to fix: it names the
  rule and asks the owner for a longer, more specific value; it never lengthens or edits one itself (BUG-074's
  verbatim rule).
- `qa-change.txt` absent or unreadable when `known_failures` is non-empty: `qa` knows no failing test; red on any
  non-zero exit.
- git output with paths that need quoting: the script reads it NUL-separated (`-z`), so a path with a space or a
  non-ASCII character is listed as it is.

## Acceptance Criteria

AC1-AC3 answer "require a minimum length or a test-file path segment in each entry"; AC4-AC7 answer "have `qa` treat
as red any failing test that the change itself added, even when it matches a declared entry"; AC8-AC10 keep the rest
of the run as it is.

- [ ] **AC1.** `start` refuses with `START_USAGE`, exit 2 and nothing written, a `--known-failure` value whose trimmed
  length is under 12 code points, and one whose trimmed value holds only letters, digits, `_` and `-`. Tests in
  `tests/scripts/orchestrate.test.js` cover `a`, `FAIL`, an 11-character path-like value, a value padded with spaces
  to over 12, `AssertionError`, a long single word, and the non-ASCII single word `autenticación` (one word under
  the `\p{L}`/`\p{N}` rule; a longer non-ASCII single word such as `autenticación_de_usuarios` is refused too).
- [ ] **AC2.** `start` accepts, records and echoes byte for byte a value of exactly 12 characters with a separator, a
  test path (`tests/a.test.js`), `suite > title`, and a value of exactly 200 characters with a separator. The BUG-074
  tests that use `a`, `b` and `'a'.repeat(200)` as accepted values switch to values that meet the rule and keep their
  assertions; its refusal cases (`'a'.repeat(201)` and the rest) keep refusing.
- [ ] **AC3.** The Start step in `.claude/commands/cc-orchestrate.md` and its `project-template` copy state the rule
  (at least 12 characters, more than one word) and that a refusal goes back to the owner, never edited by the
  orchestrator; README's `/cc-orchestrate` command-table row states the rule. `tests/installer/commands-parity.test.js`
  pins both.
- [ ] **AC4.** `install qa` in a run with non-empty `known_failures` and a recorded base writes
  `.conductor/handback/qa-change.txt` with one `A <path>` or `M <path>` line per file the work tree changed against
  the base (created, modified, renamed as delete plus create, untracked not-ignored as `A`; deleted files left out),
  sorted by path, and prints `change files: <a> created, <m> modified (.conductor/handback/qa-change.txt)`. With
  `--check` it prints the line and writes nothing. Every `install qa` overwrites the file: a second `install qa` after
  the work tree changed (as after a fix round or a resume) leaves only the new list, and one that finds the list
  unavailable removes the earlier file. Tests cover a created file, a modified file, a rename, an untracked file, an
  ignored file left out, a path with a space, the overwrite on a second `install qa`, and the removal when the second
  one finds the list unavailable.
- [ ] **AC5.** `install qa` with empty `known_failures` writes no list and its output is byte-identical to today's;
  with a `null` base, no `security` record, or a failing git, it writes no list and prints
  `change files: unavailable (<reason>); no failing test is known`. `end`, and `start` over a previous run, remove the
  list with the hand-back folder. Tests cover each.
- [ ] **AC6.** `.claude/agents/qa.md` and its `project-template` copy say that a failing test in a file
  `.conductor/handback/qa-change.txt` lists is never known, even when its line contains a declared entry; that without
  that file no failing test is known; that a failing test's file is taken only from the runner's output (the path on
  its line or on its file header), never located with Read, Grep or Glob, and that a test with no printed path is red;
  that paths are compared after turning `\` into `/`, matching when equal or when one ends with `/` plus the other,
  and red otherwise; and that the report names each failing test made red this way. `.claude/agents/code.md` and its
  copy say that a failing test in a file `code` created or edited in its task is never known, with the same
  file-from-output and path-match rules. `tests/unit/role-profiles.test.js` pins both.
- [ ] **AC7.** The shared green sentence stays byte-identical in `plan`, `code` and `qa` (the BUG-074 pin passes
  unchanged); `plan.md` is byte-unchanged.
- [ ] **AC8.** `isValidRun` and `isKnownFailureList` are unchanged: a run file holding a short entry still validates.
  The existing BUG-074 validation tests pass unchanged.
- [ ] **AC9.** No gate, router position or SNAP field is added or changed: `MAY_HAND_BACK`, `nextStep` and
  `scripts/snap-contract.mjs` are untouched, and the qa envelope is byte-identical to today's.
- [ ] **AC10.** Every profile stays at most 999 tokens; the `.claude/agents` mirror stays byte-identical; the
  `PROFILE_SHA256_1_37_0` rows for `code` and `qa` are updated in the same commit with a comment naming BUG-089, and
  every other profile is byte-unchanged. `npm test` exits 0.

## Out of Scope

- The `[BUG-089]` line in README's "Known limits": a release record, written by the release.
- `VERSION`, `CHANGELOG.md`, the backlog and `.claude/memory/**`.
- Line-level detection of added tests (reading diff hunks for test titles): the owner chose per file.
- An existing test in a file the change did not touch, which the change broke (for example through a shared helper),
  and which a declared file-path entry covers: it still counts as known. See the known limit in
  [Owner decisions](#owner-decisions).
- Making the router parse test output or decide green itself: the claim stays the role's.
- Revalidating the entries of a run started before this item.
- Declaring known failures outside a run, and `/cc-test`.
- Any change under `.github/`.

## System Impact

- `scripts/orchestrate.mjs`: `isKnownFailureArg` and a new `KNOWN_FAILURE_MIN` next to `KNOWN_FAILURE_MAX`
  (`:1490`-`:1494`); `install` (`:641`) for the `qa` step, a new helper that lists the change's files against
  `security.base` with git, the list file under `HANDBACK_DIR`, and the new output line. `clearRunFiles` (`:1559`)
  already removes the folder.
- `.claude/agents/qa.md`, `.claude/agents/code.md` and their `project-template/.claude/agents/` copies.
- `.claude/commands/cc-orchestrate.md` and its `project-template` copy: the Start step's value rule and the qa step's
  mention of the change list.
- `README.md`: the `/cc-orchestrate` row of the command table (`:262`). Not the "Known limits" lines.
- Tests: `tests/scripts/orchestrate.test.js` (`known failures [BUG-074]` block at `:4799` and a new BUG-089 block,
  with git fixtures as the security-seat tests use), `tests/unit/role-profiles.test.js` (sha pins, new pins),
  `tests/installer/commands-parity.test.js`.
- Guard 6 and Guard 7 are unaffected: the list is written by the script inside the existing write surface, and the
  test command does not change.

### Files Requiring Full Read (deferred to /cc-plan)

- `scripts/orchestrate.mjs`: `install` and `envelopeFields` for the qa step, `gitValue` and the security scan's git
  calls (`:574`, `:904`-`:918`) to reuse their spawn pattern, and `clearRunFiles`.
- `tests/scripts/orchestrate.test.js`: the git fixture helpers (`fixtureGit`, `fixtureCommit`) and every assertion that
  matches `install qa`'s whole output.

## Complexity Estimate

M — the `start` rule is a few lines, but the change list needs a git helper with its own fixtures, two profiles with
mirrors and sha pins, and command and README text with parity pins.

## Owner decisions

The owner decided the open question and refined the spec as follows; every other part of the spec stands as proposed,
including the 12 code point floor, the `change files: ...` output lines and the unchanged `isKnownFailureList`.

1. **Per file, not per test.** "A failing test the change added" is decided per file: any failing test in a file the
   change created or modified is red, even when it matches a declared entry. The per-test alternative (matching
   runner titles against the lines the change added) was declined: it fails for generated titles (`it.each`,
   template strings) and rests on judgment by `qa`.
2. **A failing test's file comes only from the runner's output.** `qa` takes it from the path printed on the test's
   line or on its file header, and never uses Read, Grep or Glob to locate a title. With no printed path, the test is
   red. The same holds for `code`. (Decision 7.)
3. **Path matching.** Paths are compared after turning `\` into `/`; a printed path matches a listed one when they
   are equal or when one ends with `/` plus the other. Anything else is red. (Decision 8.)
4. **The single-word rule uses Unicode classes.** The word characters are `\p{L}`, `\p{N}`, `_` and `-`, so
   `autenticación` is refused as one word; AC1 tests it.
5. **Every `install qa` rewrites `qa-change.txt`.** A resumed run never reads an old list; AC4 tests it.
6. **Known limit.** A file-path entry still covers an existing test in a file the change did not touch, when the
   change broke that test (for example through a shared helper or fixture it imports): that failure matches the
   entry, its file is not in the list, and it counts as known. Closing that gap needs a baseline run of the suite at
   the base commit and is out of scope for this item; the start line, the run header and the final report's
   matched-entry list (BUG-074) keep such a match visible to the owner.
