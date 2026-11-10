# FEAT-045: CI Records-Guard — Design

**Item:** `[FEAT-045]` CI Records-Guard: an External PR Touching Owner-Side Records Goes Red by Machine
**Backlog:** `AGENT-READABLE BACKLOG.md:727-731` (intake of issue #65; ticket #123)
**Status:** Draft, awaiting owner approval
**Date:** 2026-11-08

No earlier FEAT-045 spec exists under `docs/superpowers/specs/` (checked 2026-11-08), so this file is the first one and replaces nothing.

---

## Rulings

The owner delegated these rulings for this item. The spec implements them and does not reopen them.

1. **Detection is semantic** (POC variant C, 12/12 scenarios). The check compares parsed values between base and head:
   - the `VERSION` content;
   - the `version` field of `package.json`;
   - the root `version` and `packages[""].version` of `package-lock.json`;
   - the set of `CHANGELOG.md` release headings (widened by Ruling 10);
   - backlog heading states and `* **DONE` lines (widened by Rulings 8 and 9).

   Edits to nearby text and lockfile changes that touch only dependencies must pass. POC reference: `poc-feat045/poc.mjs` in the session scratchpad.
2. **Owner detection.** The workflow skips the check when `github.event.pull_request.user.login == github.repository_owner`. It never uses `author_association`, because collaborators stay bound by CONTRIBUTING. It never exempts a branch name.
3. **Script.** The logic lives in a zero-dependency Node ESM script under `tools/`, written in the style of `tools/skip-baseline.mjs`. It exports pure functions that have unit tests under `tests/`. The CLI reads base and head contents with `git show <rev>:<path>`, so it works offline. Failure messages name the file and one of two anchors:
   - `CONTRIBUTING.md#what-contributors-must-never-do` for a version or a release heading;
   - `CONTRIBUTING.md#records-are-owner-side` for a backlog flip or a DONE line.
4. **Workflow (amended by Ruling 11).** The check runs on `pull_request` and uses only first-party actions already used in this repo, at the same majors as `test.yml`: `actions/checkout@v7` and `actions/setup-node@v7`. The checkout needs enough fetch depth to reach the base. It uses no third-party actions. The spec picks the least invasive placement; see Solution §3.
5. **Docs (amended by Rulings 7 and 13).** `CONTRIBUTING.md` gets one line naming the check. The only other doc edits allowed are the two in Rulings 7 and 13. There are no README Known limits, `VERSION`, `CHANGELOG` or backlog edits.
6. **Tracked surface.** A new doc needs its leaf line in the `.gitignore` tracked-surface block, because that block is deny-by-default for `/docs/*`. See System Impact.
7. **README Instruments edit is allowed.** `README.md`'s `## Instruments: releases that verify their own record` section gains one bullet naming `` **`records-guard.mjs`** ``, and its count word changes from "Four" to "Five". The repo invariant `tests/tools/repo-invariants.test.js:130-135` requires this edit. It is not a Known-limits record. The script stays in `tools/`.
8. **DONE lines: any change to the set fails.** Any difference in the set of `* **DONE` lines between base and head is a violation, whether a line was added or removed. Editing the text of a DONE line removes one line and adds another, so it fails.
9. **Backlog headings: any change of state marker fails.** For each id, any change of its heading's state marker is a violation: `[ ]`, `[X]`, `[x]`, `[~]` or any other single character. Adding an item in any state other than `[ ]` is a violation, and so is removing an item in any state other than `[ ]`.
10. **CHANGELOG: every versioned heading counts.** Every `## [<version>]` heading counts, including pre-release versions such as `1.44.0-rc.1`. Only `## [Unreleased]` is exempt.
11. **The setup-node step is required.** The job uses `actions/setup-node@v7`, the same major as `test.yml`, so the script runs on a known Node rather than whatever the runner image ships.
12. **Owner exemption is the repository owner's login only.** A release PR opened by any other login goes red. This is intended.
13. **The `tools/README.md` instrument table gets one row.** That table lists every other `tools/*.mjs` instrument (`tools/README.md:7-12`), so for consistency it gains one row for `records-guard.mjs`.
14. **Branch protection is out of scope.** Making the check a required status is an owner repository setting.

---

## Problem

`CONTRIBUTING.md#what-contributors-must-never-do` and `#records-are-owner-side` reserve these records for the owner:
- `VERSION`;
- the `package.json` and `package-lock.json` versions;
- `CHANGELOG.md` release headings;
- backlog heading flips and DONE lines.

Only review enforces this today. `.github/workflows/test.yml` runs the suite and `tools/skip-baseline.mjs`, and nothing compares the records between base and head. PR #59 shipped exactly this class of violation, and only a human caught it.

A naive check is worse than none:
- **Path-only (POC A, 7/12)** fails legitimate edits: a `package.json` script change, a lockfile dependency bump, a `## [Unreleased]` entry, new backlog text.
- **Added-line regex (POC B, 11/12)** fails every lockfile dependency bump, because each lockfile entry carries its own `"version":` line.

## Solution

### 1. `tools/records-guard.mjs` (new, repo-only)

The header follows `skip-baseline.mjs`:
- shebang, a purpose comment, a `REPO-ONLY` note, and a "why this exists" paragraph citing PR #59;
- `node:` built-ins only (`node:child_process`, `node:path`, `node:url`), with no npm imports;
- pure functions are exported, and `main()` runs only when the file is executed directly;
- `process.exitCode` is set, never `process.exit()`.

**Exports (pure, no I/O):**

| Export | Contract |
|---|---|
| `RECORD_FILES` | Frozen list: `VERSION`, `package.json`, `package-lock.json`, `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md`. |
| `ANCHOR_NEVER`, `ANCHOR_RECORDS` | The two anchor strings in Ruling 3. |
| `checkVersionFile(base, head)` | Compares `base.trim()` with `head.trim()`. Returns `{ violations: string[] }`. |
| `checkPackageJson(base, head)` | Compares the parsed top-level `version`. Returns `{ violations }`, or `{ error }` when a side fails to parse (see Error cases). |
| `checkLockfile(base, head)` | Compares the parsed root `version` and `packages[""].version`. Ignores every other key, including `packages["node_modules/…"].version`. |
| `checkChangelog(base, head)` | Builds a set of release versions from line-anchored `^## \[([^\]]+)\]` on each side, dropping `Unreleased` (case-insensitive). Any difference between the sets is a violation, added or removed (Ruling 10). Pre-release versions such as `1.44.0-rc.1` count. |
| `checkBacklog(base, head)` | (a) Parses headings of the form `### [<state>] ` followed by a backticked `[<ID>]` (id `[A-Z]+-\d+`), the same shape `tests/tools/repo-invariants.test.js:116` matches. `<state>` is any single character. For each id, its states are the sorted list of the markers on its headings, with `x` normalized to `X`. A violation is any difference in that list between base and head (Ruling 9). An id absent on one side counts as having the single state `[ ]`, so adding or removing an item in state `[ ]` passes, and adding or removing an item in any other state fails. (b) Collects the lines matching `^\* \*\*DONE` as a multiset on each side. Every line present on only one side is a violation (Ruling 8). An added line is reported with its head line number, and a removed line with its base line number. |
| `checkRecord(path, base, head)` | Dispatches on the path. `null` means absent at that revision. See the presence rules under Behavior. |
| `evaluate(files)` | Takes `files: Array<{ path, base, head }>` and returns `{ code, lines }`, the same shape as `skip-baseline.evaluate`. |
| `parseArgs(argv)` | Takes `--base <rev> --head <rev>`. Both are required. An empty value or a missing value is an error, which is the same fail-closed rule as in `skip-baseline.parseArgs`. |

Every parser normalizes `\r\n` to `\n` before matching.

**Messages.** There is one line per violation, and each line names the file and an anchor:

```
RECORDS_GUARD_VIOLATION VERSION: 1.43.0 -> 1.44.0; see CONTRIBUTING.md#what-contributors-must-never-do
RECORDS_GUARD_VIOLATION package-lock.json: packages[""].version 1.43.0 -> 1.44.0; see CONTRIBUTING.md#what-contributors-must-never-do
RECORDS_GUARD_VIOLATION CHANGELOG.md: release heading [1.44.0] added; see CONTRIBUTING.md#what-contributors-must-never-do
RECORDS_GUARD_VIOLATION AGENT-READABLE BACKLOG.md: FEAT-045 heading [ ] -> [X]; see CONTRIBUTING.md#records-are-owner-side
RECORDS_GUARD_VIOLATION AGENT-READABLE BACKLOG.md: DONE line added at line 728; see CONTRIBUTING.md#records-are-owner-side
RECORDS_GUARD_VIOLATION AGENT-READABLE BACKLOG.md: DONE line removed (base line 721); see CONTRIBUTING.md#records-are-owner-side
RECORDS_GUARD_FAILED: 6 violation(s). Records are written by the owner at release time.
```

A clean run prints `RECORDS_GUARD_OK: 5 record files compared, no owner-side change (base <rev>, head <rev>)` and exits 0. An instrument fault prints `RECORDS_GUARD_ABORT: <reason>` and exits 1. Every doubt aborts, because this is a gate.

**CLI I/O (`main`).** The CLI makes `spawnSync('git', [...])` calls with an argv array. It uses no shell, so the space in `AGENT-READABLE BACKLOG.md` needs no quoting.
1. It verifies each revision with `git rev-parse --verify --quiet <rev>^{commit}`. On failure it aborts and names the rev and the fetch depth.
2. For each record path, `git cat-file -e <rev>:<path>` decides whether the path is present. When it is present, `git show <rev>:<path>` reads the content. When it is absent, the content is `null`.
3. It calls `evaluate`, prints the lines and sets `exitCode`.

### 2. `tests/tools/records-guard.test.js` (new)

This follows the convention of `tests/tools/skip-baseline.test.js`. It imports the pure exports from `../../tools/records-guard.mjs` and runs the CLI through `spawnSync(process.execPath, …)` in a temporary git repository under `mkdtempSync(tmpdir())`.

### 3. `.github/workflows/records-guard.yml` (new sibling workflow)

**Choice and reason.** The check goes in a sibling workflow, not a job inside `test.yml`. This is the least invasive placement:
- `test.yml` also runs on `push` and is a three-leg matrix keyed to `tools/skip-baseline.json`. A job there would need its own `if:` for the event, its own runner and its own owner skip, and every edit to that file risks the matrix design.
- A sibling file leaves `test.yml` byte-identical. It gives the check its own named status ("Records guard"), and it needs no `npm ci` and no cache. It uses `actions/setup-node@v7` without `cache:` (Ruling 11).

```yaml
name: Records guard

on:
  pull_request:
    branches: [main]

permissions:
  contents: read

jobs:
  records-guard:
    # Ruling 2: the owner's own PRs (release PRs included) are exempt; collaborators are not.
    if: github.event.pull_request.user.login != github.repository_owner
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v7
        with:
          # The pull_request checkout is the merge commit; depth 2 reaches its first
          # parent, which is the base tip the PR is being merged into.
          fetch-depth: 2
          persist-credentials: false
      - uses: actions/setup-node@v7
        with:
          # engines.node's floor, so the guard proves it needs nothing newer.
          node-version: '20'
      - name: Fail if the PR changes owner-side records
        run: node tools/records-guard.mjs --base HEAD^1 --head HEAD
```

`HEAD^1` against the merge commit `HEAD` is the PR's net effect on the current `main`. A PR branch that merged `origin/main` after a release therefore does not read the owner's release as its own change. The job pins Node 20 through `setup-node`, which is `engines.node`'s floor. The owner did not rule on the version. The floor was picked so the guard cannot depend on a newer API; `'24'` would also satisfy Ruling 11.

### 4. `CONTRIBUTING.md` (one line)

One line goes at the end of the `## Records are owner-side` record list, after the paragraph ending "written owner-side." Suggested wording:

> The `Records guard` workflow (`tools/records-guard.mjs`) fails any PR not opened by the owner that changes one of these records, except the README Known-limits lines, and its message names the file and the rule.

### 5. `README.md` Instruments section (Ruling 7)

In `README.md:482-489`, under `## Instruments: releases that verify their own record`, make two edits:
- the opening word changes from "Four checks live in `tools/`" to "Five checks live in `tools/`", and the rest of that sentence is adjusted so it stays true;
- one bullet is added that begins with `` **`records-guard.mjs`** `` and says what the check compares, that it runs in `.github/workflows/records-guard.yml` on non-owner PRs, and why it exists (PR #59).

This keeps `tests/tools/repo-invariants.test.js:130-135` green.

### 6. `tools/README.md` instrument table (Ruling 13)

One row goes into the table at `tools/README.md:7-12`: `` | `records-guard.mjs` | invariant | `.github/workflows/records-guard.yml` on every non-owner PR; by hand with `--base`/`--head` | ``.

---

## Behavior

### Main path

1. A contributor opens or updates a PR against `main`. The `pull_request` event fires. The author is not `github.repository_owner`, so the job runs.
2. Checkout fetches the merge commit and its first parent.
3. The script reads the five record files at `HEAD^1` and `HEAD` and runs the five semantic checks.
4. If nothing changed in substance, the job prints `RECORDS_GUARD_OK` and exits 0, and the check is green.
5. Otherwise the job prints one `RECORDS_GUARD_VIOLATION` line per finding, each naming the file and its CONTRIBUTING anchor, then `RECORDS_GUARD_FAILED`, and exits 1. The check shows a red X.

### Alternative paths

- **Owner PR, including a release PR.** The job-level `if:` is false, the job reports *skipped*, and nothing is evaluated.
- **Owner push to `main`.** The workflow has no `push` trigger and does not run. Release records land this way and are unaffected.
- **A PR that touches no record file.** All five files compare equal and the check passes. A README edit next to `## Known limits` is in this case, because README is not in `RECORD_FILES`.
- **Legitimate edits to a record file pass:**
  - a `package.json` script, dependency or field change, or a JSON re-indent;
  - a lockfile change to dependencies only;
  - a new or edited `## [Unreleased]` entry;
  - a typo fix inside an existing release body;
  - a changed date on an existing release heading, because the version is unchanged;
  - new backlog item text;
  - a new `### [ ]` item.
- **Local, offline run.** `node tools/records-guard.mjs --base <sha> --head HEAD`. For a feature branch, the honest base is the merge-base with `main`. The script compares exactly the two revisions it is given and computes no merge-base itself.

### Error cases and failure points

| Case | Result |
|---|---|
| Record present at base, absent at head (deleted or renamed away) | `RECORDS_GUARD_VIOLATION <path>: deleted or renamed at head; see <anchor for that file>`, exit 1. A rename is a deletion at the record path. The new path is not a record and is not checked. |
| Record absent at base, present at head (created) | `RECORDS_GUARD_VIOLATION <path>: created at head; see <anchor>`, exit 1. |
| Record absent at both | Not compared and not a violation. The OK line counts only the files compared. |
| `package.json` or `package-lock.json` fails `JSON.parse` at **head** | Violation: `<path>: not valid JSON at head (<message>); its version cannot be verified; see ANCHOR_NEVER`, exit 1. This fails closed. |
| The same file fails to parse at **base** | `RECORDS_GUARD_ABORT: <path> is not valid JSON at base <rev> (<message>)`, exit 1. The fault is in `main`, not in the PR, so it is reported as an instrument fault rather than as a contributor violation. |
| `version` absent on one side and present on the other, or of a different type | Strict `!==` on the parsed values makes it a violation. |
| `packages` or `packages[""]` missing in the lockfile | Optional chaining reads it as `undefined`. A change between `undefined` and a value is a violation, and `undefined` on both sides is equal. |
| Base rev not in the clone: a shallow checkout at depth 1, a fork PR without depth, a typo | `RECORDS_GUARD_ABORT: revision "<rev>" is not a commit in this clone; the checkout needs fetch-depth >= 2 (or fetch the base)`, exit 1. This is never read as "file absent". |
| `git` missing or `git show` failing for any reason other than path absence | `RECORDS_GUARD_ABORT: git <args> failed (<stderr first line>)`, exit 1. |
| Bad CLI arguments: missing, empty, unknown flag | `RECORDS_GUARD_ABORT: <reason>; usage: node tools/records-guard.mjs --base <rev> --head <rev>`, exit 1. |
| Fork PR | `pull_request` checks out `refs/pull/N/merge` from the base repository, so depth 2 works the same as for a same-repo PR. The token is read-only and no secrets are used. |
| PR with merge conflicts | GitHub creates no merge ref, so the workflow does not run. This matches the existing `test.yml` behavior. |

### Boundary conditions

- **Line endings.** CRLF and LF compare equal in every parser. `VERSION` compares trimmed, so a trailing newline or a BOM change alone passes.
- **CHANGELOG.** Headings are matched line-anchored. `## [1.44.0]` inside prose or indented text does not match. A line-start heading inside a fenced code block does match, which fails closed.
  - A duplicated existing version adds nothing to the set and passes, per the ruled set semantics.
  - Removing a release heading changes the set and is a violation.
  - Any bracketed version counts, including a pre-release heading such as `## [1.44.0-rc.1]` (Ruling 10). Only `## [Unreleased]` is exempt, in any letter case.
- **Backlog headings.** Any change of an id's state marker is a violation (Ruling 9), including `[ ]`, `[X]`, `[~]` and any other character. `[X]` and `[x]` are the same state.
  - Headings in state `[~]` exist (`AGENT-READABLE BACKLOG.md:280, 296, 373, 379`). A flip into or out of `[~]` fails.
  - An id that appears in more than one heading is compared as the sorted list of its states.
  - A heading whose id token is not in backticks is not parsed. Every current heading uses backticks.
- **DONE lines.** The comparison is a multiset over the exact line text, and any difference fails (Ruling 8).
  - Editing the text of an existing DONE line yields two violations, one removed and one added.
  - Removing a DONE line alone is a violation, and so is removing a whole closed item: its DONE line goes, and its non-`[ ]` heading goes with it.
  - The FEAT-045 entry's own description (line 728) mentions "DONE line" mid-line and does not match the `^\* \*\*DONE` anchor.
- **Several violations in one file.** Every one is reported, not only the first.
- **Very large backlog.** It is a single string per side, roughly 1,100 lines today, and is processed in linear time.

---

## Acceptance Criteria

Each criterion maps to at least one case in `tests/tools/records-guard.test.js`, unless it is marked as a workflow or doc check.

1. A `VERSION` change (`1.43.0` → `1.44.0`) gives exactly one violation naming `VERSION` and `CONTRIBUTING.md#what-contributors-must-never-do`. A whitespace-only or CRLF-only change gives none.
2. A `package.json` `version` change gives a violation naming `package.json` and `ANCHOR_NEVER`. A `scripts` or `devDependencies` change, or a re-indent with the version unchanged, gives none.
3. A lockfile change of root `version` and `packages[""].version` gives two violations naming `package-lock.json` and `ANCHOR_NEVER`. A change of one only gives one. A `packages["node_modules/<x>"].version` change alone gives none (POC scenario 5).
4. A `CHANGELOG.md` with a new `## [1.44.0] - <date>` heading gives a violation naming `CHANGELOG.md`, `[1.44.0]` and `ANCHOR_NEVER`. A new `## [Unreleased]` section gives none. A typo fix in an old release body gives none, and so does a date edit on an existing heading. A new `## [1.44.0-rc.1]` heading gives a violation. Removing an existing release heading gives a violation.
5. A backlog FEAT-045 heading flip from `### [ ]` to `### [X]` gives a violation naming `AGENT-READABLE BACKLOG.md`, the id and `CONTRIBUTING.md#records-are-owner-side`. So do each of these:
   - the reverse flip `[X]` → `[ ]`;
   - a flip `[ ]` → `[~]`, and `[~]` → `[X]`;
   - a new item added as `[X]` or `[~]`;
   - the removal of an `[X]` or `[~]` item.

   Adding or removing a `### [ ]` item gives none, and a `[X]` → `[x]` case change gives none.
6. An added `* **DONE…` line gives a violation naming the backlog file, its head line number and `ANCHOR_RECORDS`. A removed DONE line gives a violation naming its base line number. An edited DONE line gives two. Editing the text of a backlog item that is not DONE gives none, and so does adding a new `### [ ]` item.
7. A README edit adjacent to `## Known limits` gives none. README is never read.
8. Every POC variant-C scenario (12) is reproduced as a unit case on fixture text with the same expected PASS/FAIL. **Verification:** the suite reports 12/12.
9. A record present at base and absent at head gives a violation naming the path, and so does the reverse. A record absent on both sides gives none.
10. Invalid JSON at head gives a violation, and the run exits 1. Invalid JSON at base gives `RECORDS_GUARD_ABORT` and exit 1. Neither throws an uncaught exception.
11. CLI cases in a temporary git repository:
    - (a) two commits differing only in `VERSION` → exit 1 with the violation line;
    - (b) two commits differing only in a README line → exit 0 and `RECORDS_GUARD_OK`;
    - (c) `--base` set to a nonexistent rev → exit 1 and `RECORDS_GUARD_ABORT` naming the rev;
    - (d) missing `--head` → exit 1 and an abort with usage;
    - (e) a record whose path contains a space (`AGENT-READABLE BACKLOG.md`) is read correctly.
12. `tools/records-guard.mjs` imports only `node:` built-ins (asserted by a test over its import lines). `tools/` stays absent from `package.json` `files`; the existing `tests/tools/tools-not-shipped.test.js` stays green.
13. **Workflow check (read-only test over the YAML text).** `.github/workflows/records-guard.yml` meets all of these:
    - it triggers on `pull_request` only;
    - every `uses:` is either `actions/checkout@v7` or `actions/setup-node@v7`, the same majors as `test.yml`;
    - it sets `fetch-depth: 2` and `permissions: contents: read`;
    - its job `if:` compares `github.event.pull_request.user.login` with `github.repository_owner`;
    - it does not contain `author_association` or `head_ref`.
14. `.github/workflows/test.yml` is byte-identical to `main`.
15. **Doc check.** The `CONTRIBUTING.md` diff is exactly one added line, and that line names the check. The only other `.md` changes are:
    - the `README.md` Instruments section, with one bullet added and "Four" changed to "Five" (Ruling 7);
    - one row added to the `tools/README.md` instrument table (Ruling 13);
    - the spec and plan themselves.
16. The new test file contributes no skipped tests on any CI leg, so `tools/skip-baseline.json` needs no change. It uses no `skipIf`, and `git` is present on all three legs.
17. The full suite is green on all three CI legs. This includes `tests/tools/repo-invariants.test.js`, whose "names every tools/ instrument … with their count" case passes with the Ruling 7 README edit, and `tests/unit/gitignore-block-parity.test.js`.

---

## Out of Scope

- **README Known-limits lines.** CONTRIBUTING lists them as owner-side records, but the backlog AC requires README edits to pass, and Ruling 1 does not list them.
- **Minting ids.** That belongs to `id-ceiling.mjs`.
- **Release branches, tags and GitHub Releases.**
- **Runtime dependencies.** Other CONTRIBUTING hard rules are not covered either.
- **Tamper resistance.** Under `pull_request`, the workflow and script that run are the PR's own versions, so a PR that edits `tools/records-guard.mjs` or deletes the workflow can disable its own check. This guard catches mistakes; it is not an adversarial control. `pull_request_target` is deliberately not used, because it runs with base-repo credentials next to untrusted code. Review still covers edits to `.github/` and `tools/`.
- **Branch protection (Ruling 14).** Making "Records guard" a required status check is a repository setting the owner controls. This item does not change it.
- **Edits outside the doc scope.** No change to `test.yml`, `tools/skip-baseline.json`, `VERSION`, `package.json`, `package-lock.json`, `CHANGELOG.md`, the backlog or README Known limits.
- **GitHub annotations.** The script does not emit `::error` annotations.

---

## System Impact

| File | Change |
|---|---|
| `tools/records-guard.mjs` | **Create.** The checker: pure exports plus the CLI. |
| `tests/tools/records-guard.test.js` | **Create.** Unit, CLI and YAML-text cases for AC 1–13 and 16. |
| `.github/workflows/records-guard.yml` | **Create.** The sibling workflow. |
| `CONTRIBUTING.md` | **Modify.** One line under `## Records are owner-side`. |
| `.gitignore` | **Modify.** Tracked-surface leaf lines, in sorted position inside the BUG-042 block: `!/docs/superpowers/specs/2026-11-08-feat045-ci-records-guard-design.md`, and the plan's leaf `!/docs/superpowers/plans/2026-11-08-feat045-….md` when the plan lands. `tests/unit/gitignore-block-parity.test.js` enforces this. Until a leaf lands, a new doc stages only with `git add -f <path>` (CLAUDE.md Staging Convention). `tools/`, `tests/` and `.github/` are not under the deny block. |
| `README.md` (`## Instruments: releases that verify their own record`, lines 482-489) | **Modify (Ruling 7).** One `` **`records-guard.mjs`** `` bullet; "Four" → "Five". |
| `tools/README.md` (instrument table, lines 7-12) | **Modify (Ruling 13).** One row for `records-guard.mjs`. |

**Dependencies.** `tests/tools/repo-invariants.test.js:130-135` lists every tracked `tools/*.mjs` through `git ls-files`. It asserts that each file is named as `` **`<name>`** `` in README's Instruments section, and that the section says `<CountWord> checks live in \`tools/\`` with the count matching (`README.md:484` says "Four" today). Without the Ruling 7 README edit, adding `tools/records-guard.mjs` turns this test red, so the script and the README edit must land in the same commit.

The owner exemption covers the repository owner's login (`yeisonrestrepo`) only. A release PR opened from any other login goes red, which is intended (Ruling 12).

## Complexity Estimate

**S–M.** The script is about 150 lines, close to the POC's variant C plus CLI I/O and error handling. The tests are about 200 lines and the workflow about 25. The doc edits are three small ones: one CONTRIBUTING line, one README bullet with its count word, and one `tools/README.md` row. There is no change to a protected surface (hooks, installer, SNAP scripts, settings). The one ordering constraint is that the script and the README edit land together.
