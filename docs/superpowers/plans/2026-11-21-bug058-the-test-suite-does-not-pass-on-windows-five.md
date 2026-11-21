# BUG-058 (re-dispatch) Verify the Windows test suite fix on `main` meets the entry, and name three skip reasons: implementation plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Update one checkbox per edit (BUG-003 invariant). Execute in file order.

**Goal:** show, on this branch, that every acceptance criterion of `[BUG-058]` is met by code and tests already on `main` (merged in `8d0be53`, PR #90), and close the one clause that is not fully met ("self-skip with a named reason") by adding the three comments the spec fixes above the W2, W3 and W4 skips. No condition, test name, test body, workflow or baseline changes.

**Spec:** `docs/superpowers/specs/2026-11-21-bug058-the-test-suite-does-not-pass-on-windows-five-design.md` (sha256 `05b739b1dc8700ffd264451cacbe1ed59a17030557f241ed6b2ed2d8eaf57044`). Filed from issue #76; absorbs the first candidate of issue #65. Prior work: spec `docs/superpowers/specs/2026-10-22-bug058-windows-suite-design.md`, plan `docs/superpowers/plans/2026-10-22-bug058-windows-suite.md`.

**Test command:** `npm test`. Filtered runs use `npx vitest run <file>`.

## Global Constraints

- **Comment-only change.** The only source edits are three added `//` lines: one in `tests/hooks/guard4.test.js`, two in `tests/hooks/verbosity-remind.test.js`. `scripts/`, `tools/` (including `tools/skip-baseline.json`), `.gitattributes`, `.github/`, `vitest.config.js` and every other test file stay byte-identical to `origin/main` (spec, AC9 and Out of Scope).
- **The comment text is the spec's, verbatim** (spec, Solution). The build copies it; it does not reword it.
- **Files changed by this item:** the spec, this plan, their two leaf lines in `.gitignore`, and the two test files above. The spec and its leaf are already committed on this branch (`cf42701`, `4e470cb`, `7bda0c2`); Task 0 adds this plan and its leaf.
- No release records: `VERSION`, the `package.json` / `package-lock.json` version, `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md` (checkbox and DONE line), `.claude/memory/**` and the README "Known limits" line for `[BUG-058]` (`README.md:498`) stay untouched. The release writes them (spec, Out of Scope).
- **A red verification is not fixed here.** If any verification step fails for a reason other than the four environment/phase tests the spec names under "Measured", the build stops and reports the failing test by name as a regression since `8d0be53`. That becomes a new spec, not a silent edit in this item (spec, Solution).
- Neither skip W2 nor W3 is lifted (spec, Out of Scope): lifting one changes the `ci-windows-node24` key, and only a Windows run can measure that.
- No `.github/workflows/` change: the `windows-latest` leg already exists (`.github/workflows/test.yml:25`, skip-baseline step at `:55`). No `WORKFLOW_NEEDED`.
- Staging: both test files are tracked (`git add -u <path>`). This plan sits under the ignored `docs/superpowers/plans/`: it is new in Task 0 (`git add -f`), and tracked afterwards and re-included by its leaf (`git add -u`).

## Plan decisions

1. **Comment placement.** Each comment goes on its own line directly above the `it.skipIf(…)` line of its test, at that line's indentation (two spaces in both files). The spec cites the identity lines; the `it.skipIf` lines are, measured at `a8c584c`:
   - W2: `tests/hooks/guard4.test.js:110`, `  it.skipIf(WIN32)('row16: denies with PATH restricted to an empty dir', () => {`. The new line goes after the existing two-line `// FLIPPED. …` comment (`:108-109`) and before `:110`, so the existing comment stays untouched and the new one sits next to the skip it explains.
   - W4: `tests/hooks/verbosity-remind.test.js:160`, `  it.skipIf(process.platform === 'win32')(`; its title is on `:161`. The comment goes above `:160`, since a line between `:160` and `:161` would sit inside the call's argument list.
   - W3: `tests/hooks/verbosity-remind.test.js:230`, `  it.skipIf(process.platform === 'win32')('T-14: traversal cap=40 …`. The comment goes above `:230`.
   Steps anchor on the line's text, not its number, so the W4 insertion (which shifts W3 down by one) cannot misplace W3.
2. **Why the identity sets cannot move.** Vitest's skip identity is the describe chain plus the test title; a `//` line changes neither. AC9's byte-identity check on the three keys of `tools/skip-baseline.json` is a check that the baseline was not touched, and the full-suite run plus the skip-baseline instrument confirm the skipped set on Linux. The Windows set is confirmed by the PR's `ci-windows-node24` leg (AC6).
3. **AC4's grep set is measured.** `grep -rln chmod tests --include='*.test.js'` names six files at `a8c584c`: `deploy`, `heal`, `handoff-cycle`, `verbosity-remind`, `context-guard`, `conductor-db`. These are the files holding the spec's seven expected sites. The `chmodHooks` hits in `deploy.test.js` are the production function's name, not fixtures (spec, AC4).
4. **AC7's set difference is measured.** `ci-windows-node24` minus `ci-node24` gives 11 identities at `a8c584c`, the W1-W11 rows of the spec's table.
5. **Expected suite result.** The spec measured `Test Files 2 failed | 64 passed (66)`, `Tests 4 failed | 3614 passed | 12 skipped (3630)` with the spec's leaf uncommitted. Once the spec and this plan are committed, the `gitignore-block-parity` pair passes, so the expected build-time result is the two `staging-convention` AC7/AC8 tests red on a git that exits 0 for `git add -u <untracked>` (ENV, spec "Measured"), and everything else green. On a git that exits 128 there, the suite is fully green.
6. **The `.gitignore` leaf** for this plan goes in sorted position in the plans block: directly after `!/docs/superpowers/plans/2026-11-20-bug088-installer-prints-the-opencode-plugin-symlink.md` and directly before `!/docs/superpowers/plans/2026-11-21-feat052-orchestrate-role-subagents-omit-inherited.md`. The spec's leaf is already at `.gitignore:296`.

## Files read in full (spec, Files Requiring Full Read)

None, per the spec. Checked by grep and targeted reads during planning: `.gitattributes:1-3`; `git ls-files --eol | grep -c i/crlf` is `0`; `git merge-base --is-ancestor 25e29e8 8d0be53` succeeds; the three `it.skipIf` lines above; `tools/skip-baseline.json` keys `ci-node20`, `ci-node24`, `ci-windows-node24` (the last with 24 identities); `git diff --stat origin/main -- tests scripts tools .gitattributes .github vitest.config.js` empty.

---

### Task 0: Commit this plan and its ignore leaf

**Files:**
- Modify: `.gitignore` (one leaf, sorted position)
- Create (stage): `docs/superpowers/plans/2026-11-21-bug058-the-test-suite-does-not-pass-on-windows-five.md`

- [X] [T-000-A] Modify `.gitignore`: add `!/docs/superpowers/plans/2026-11-21-bug058-the-test-suite-does-not-pass-on-windows-five.md` directly after the `2026-11-20-bug088-…` plan leaf and before the `2026-11-21-feat052-…` plan leaf (Plan decision 6). No dependency.
- [X] [T-000-B] Stage: `git add -u .gitignore`, then `git add -f docs/superpowers/plans/2026-11-21-bug058-the-test-suite-does-not-pass-on-windows-five.md`. Depends on T-000-A.
- [X] [T-000-C] Commit: `docs: plan verifying the Windows suite fix on main and naming three skip reasons [BUG-058]`. Depends on T-000-B.

### Task 1: Name the three missing skip reasons (AC7)

**Files:**
- Modify: `tests/hooks/guard4.test.js` (one added comment line)
- Modify: `tests/hooks/verbosity-remind.test.js` (two added comment lines)
- Modify: this plan (checkboxes only)

- [X] [T-001-A] Modify `tests/hooks/guard4.test.js`: insert, directly above the line `  it.skipIf(WIN32)('row16: denies with PATH restricted to an empty dir', () => {` and below the existing `// over an already-parsed string, so an empty PATH cannot disarm it.` line, the line `  // Skipped on win32: the case replaces PATH wholesale, a POSIX fixture (it set PATH=/bin when the skip was added in BUG-017).` (W2, Plan decision 1). No dependency.
- [X] [T-001-B] Modify `tests/hooks/verbosity-remind.test.js`: insert, directly above the `  it.skipIf(process.platform === 'win32')(` line whose next line is `    'row13: unreadable project hook -> global retains authority',`, the line `  // Skipped on win32: chmod 0o000 does not make a file unreadable there, so the project hook would still be read.` (W4). No dependency.
- [X] [T-001-C] Modify `tests/hooks/verbosity-remind.test.js`: insert, directly above the line `  it.skipIf(process.platform === 'win32')('T-14: traversal cap=40 blocks verbosity.md 45 levels above; HOME fallback emits MIN', { timeout: 15000 }, () => {`, the line `  // Skipped on win32: the 45-level working directory sits within a few characters of the 260-character MAX_PATH limit under a default temp directory.` (W3). Depends on T-001-B only for order within the file.
- [X] [T-001-D] Run `npx vitest run tests/hooks/guard4.test.js tests/hooks/verbosity-remind.test.js`. Expected: `Test Files 2 passed (2)`, no failed test. On Linux the filter's full match set is every test in both files; none is skipped on Linux by these three conditions, so row16, row13 and T-14 all run and pass, as they do on `origin/main`. Depends on T-001-A through T-001-C.
- [X] [T-001-E] Run `git diff -U0 origin/main -- tests`. Expected: exactly two files, `tests/hooks/guard4.test.js` and `tests/hooks/verbosity-remind.test.js`; exactly three `+` content lines, each one of the three comments above; no `-` content lines (AC9). Depends on T-001-D.
- [X] [T-001-F] Stage: `git add -u tests/hooks/guard4.test.js`, then `git add -u tests/hooks/verbosity-remind.test.js`. Depends on T-001-A through T-001-E.
- [X] [T-001-G] Stage: `git add -u docs/superpowers/plans/2026-11-21-bug058-the-test-suite-does-not-pass-on-windows-five.md` so the ticked boxes ride the commit. Depends on T-001-F.
- [X] [T-001-H] Commit: `test: name the skip reason of the three Windows-only skips that lacked one [BUG-058]`. Depends on T-001-G. Its own tick rides the next commit group.

### Task 2: Verify every acceptance criterion on this branch (AC1-AC9)

**Files:**
- Read only: `.gitattributes`, `tests/scripts/conductor-db.test.js`, `tests/helpers/can-symlink.js`, `tests/installer/smoke.test.js`, `.github/workflows/test.yml`, `tools/skip-baseline.json`, and the test files named below
- Modify: this plan (checkboxes only)

- [X] [T-002-A] AC1: run `sed -n 1,3p .gitattributes` and `git ls-files --eol | grep -c i/crlf`. Expected: lines `* text=auto eol=lf`, `*.sh text eol=lf`, `*.ps1 text eol=crlf`; count `0`. Then `npx vitest run tests/unit/merge-md.test.js tests/installer/templates.test.js`. Expected: `Test Files 2 passed (2)`, no failed test (the match set is both whole files, AC9b and the gitignore header test included). No dependency.
- [X] [T-002-B] AC2: run `grep -n "\-\-import\|BLOCK" tests/scripts/conductor-db.test.js`. Expected: every `--import` argument is `BLOCK`, and `BLOCK` is assigned `new URL('./fixtures/block-sqlite.mjs', import.meta.url).href`. Then `npx vitest run tests/scripts/conductor-db.test.js`. Expected: `Test Files 1 passed (1)`, no failed test (the read-only-dir test at `:374` skips on win32 only, so it runs on Linux).
- [X] [T-002-C] AC3: run `grep -rn symlinkSync tests` and read each site with a bounded read. Expected: every call either passes `'junction'` or sits in a test gated on `CAN_SYMLINK` (or `POSIX_SYMLINK`, which includes it) from `tests/helpers/can-symlink.js`.
- [X] [T-002-D] AC4: run `grep -rn chmod tests --include='*.test.js'`. Expected: fixture sites `context-guard:160` (skip at `:156`), `verbosity-remind` (row13, now one line lower), `deploy:715`, `:766`, `heal:122`, `handoff-cycle:105`, `conductor-db:381`, plus their restore calls (`chmodSync(…, 0o755)` / `0o644`), the `chmodSync` names in the `node:fs` import lines and the `chmodHooks` name hits in `deploy.test.js`, none of which is a fixture (Plan decision 3). Each fixture site sits in a test skipped by `WIN32`, `process.platform === 'win32'` or `POSIX_NON_ROOT`, and each such identity is in `ci-windows-node24`.
- [X] [T-002-E] AC5: run `sed -n 15,23p tests/installer/smoke.test.js`. Expected: `npm pack` runs as one shell string and `tar` reads a relative tarball name. Then `npx vitest run tests/installer/smoke.test.js`. Expected: `Test Files 1 passed (1)`. A failure caused by the sandbox (no network for `npm pack`, tmp permissions) is reported as ENV with its test name.
- [X] [T-002-F] AC6: run `grep -n "windows-latest\|skip-baseline" .github/workflows/test.yml` and `node -e 'console.log(Object.keys(require("./tools/skip-baseline.json")))'`. Expected: the matrix row `{ os: windows-latest, node: '24', env: ci-windows-node24 }`, the `tools/skip-baseline.mjs --env ${{ matrix.env }}` step, and the key `ci-windows-node24`. The green leg with `SKIP_BASELINE_OK ci-windows-node24` is the PR's CI result, reported by the runner after this build; this sandbox runs Linux only.
- [X] [T-002-G] AC7: run `node -e 'const j=require("./tools/skip-baseline.json");const l=new Set(j["ci-node24"]);j["ci-windows-node24"].filter(x=>!l.has(x)).forEach(x=>console.log(x))'`. Expected: the 11 identities W1-W11 (Plan decision 4). Read the skip site of each with a bounded read; expected: each condition, or a comment on the line above it (inside it, for W10), names its reason, and W2, W3, W4 carry the comments from Task 1.
- [X] [T-002-H] AC8: run `git merge-base --is-ancestor 25e29e8 8d0be53`. Expected: exit 0.
- [X] [T-002-I] AC9, scope: run `git diff --stat origin/main -- scripts tools .gitattributes .github vitest.config.js` (expected: empty) and `git diff --stat origin/main -- tests` (expected: only `tests/hooks/guard4.test.js` and `tests/hooks/verbosity-remind.test.js`). Then `git diff --quiet origin/main -- tools/skip-baseline.json` (expected: exit 0, so all three keys are byte-identical).
- [X] [T-002-J] AC9, suite: run `npm test`. Expected: per Plan decision 5, no failed test outside `tests/unit/staging-convention.test.js` AC7/AC8, which are reported as ENV only when this git exits 0 on `git add -u <untracked path>` (reproduce in a fresh `git init` under `$TMPDIR`). Any other red, including the `gitignore-block-parity` pair, stops the build and is reported by name (Global Constraints). Depends on T-002-A through T-002-I for order.
- [X] [T-002-K] Stage: `git add -u docs/superpowers/plans/2026-11-21-bug058-the-test-suite-does-not-pass-on-windows-five.md` so the ticked boxes ride the commit. Depends on T-002-A through T-002-J.
- [X] [T-002-L] Commit: `docs: verify the Windows suite fix on main meets the entry [BUG-058]`. Depends on T-002-K. Its own tick rides no later commit, since this is the last group; the closeout leaves it as the runner's commit of the tree.

## Test List

- [X] Unit: `tests/hooks/guard4.test.js` and `tests/hooks/verbosity-remind.test.js`, unchanged in behavior after the three comments (T-001-D).
- [X] Unit: `tests/unit/merge-md.test.js` (AC9b) and `tests/installer/templates.test.js` (gitignore header), the cause-1 byte comparisons (AC1).
- [X] Integration: `tests/scripts/conductor-db.test.js` (`--import` URL, AC2) and `tests/installer/smoke.test.js` (`npm pack` shell string, AC5).
- [X] Full suite: `npm test`, red only in the named ENV pair (AC9).
- [ ] Windows: the PR's `ci-windows-node24` leg, green with `SKIP_BASELINE_OK ci-windows-node24` (AC6); CI evidence, not run in this sandbox.
- [X] E2E: not applicable, no UI.
- No new test: the item changes no behavior, and the criteria are already pinned by the tests above and by the skip-baseline instrument.

## Commit Order

1. Task 0: this plan and its `.gitignore` leaf (made by the runner at the end of the plan session).
2. Task 1: the three comments in the two test files, with the plan's Task 1 ticks.
3. Task 2: the plan with its verification boxes ticked. Nothing else changes, unless the verification turns red, in which case nothing is committed beyond the ticks already made and the build reports the regression.

In this lane the runner makes the build's commits from the tree at the end of the session; the staging and commit steps above are marked done when it does.

## Identified Risks

- **A comment lands inside a call's argument list** (W4, whose `it.skipIf(…)(` line and title line are separate). Caught by Plan decision 1, which places it above `:160`, and by T-001-D (a syntax slip fails the file) and T-001-E (the diff shows exactly three added lines).
- **Line numbers shift after the W4 insertion.** Steps anchor on line text, not numbers; T-002-D's expected list names row13 by test, not by line.
- **The skipped set moves.** It cannot from a comment (Plan decision 2); T-002-I's byte check on `tools/skip-baseline.json` and the full suite's skip count (12 on Linux, as measured in the spec) would show it.
- **A regression since `8d0be53`** in any of the five causes: T-002-A through T-002-E turn red. The build stops and reports it; it is not fixed in this item.
- **The full suite is red for an unrelated reason:** T-002-J reports the failing names. Sandbox-only failures (git version, network, tmp permissions) are ENV; others are reported, not fixed here.
- **The comments' reasons for W2 and W3 are inferred, not measured on Windows** (spec, Problem). The wording states the class and claims no measurement; lifting either skip is out of scope.
- **Records stay stale until the release.** The backlog checkbox, the README Known limits line (`README.md:498`) and the `CHANGELOG.md` entry still describe `[BUG-058]` as open after this item merges. The release updates them; this item does not.
