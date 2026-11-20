# BUG-059 (re-dispatch) Verify the fake gh fix on `main` meets the entry: implementation plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Update one checkbox per edit (BUG-003 invariant). Execute in file order.

**Goal:** show, on this branch, that every acceptance criterion of `[BUG-059]` is met by code and tests already on `main` (merged in `25e29e8`, PR #87), without changing any code. The fake gh resolves on win32 through a Node preload, and a test path that would reach the real gh dies with `CC_REAL_GH_BLOCKED` on every platform.

**Spec:** `docs/superpowers/specs/2026-11-20-bug059-fake-gh-is-posix-only-so-on-windows-the-suites-design.md` (sha256 `f52b959a44dc1eea713d997c07345954a1c264b0a00d27430ec9a8e558a23a65`). Filed from issue #75. Prior work: spec `docs/superpowers/specs/2026-10-22-bug059-fake-gh-win32-design.md`, plan `docs/superpowers/plans/2026-10-22-bug059-fake-gh-win32.md`.

**Test command:** `npm test`. Filtered runs use `npx vitest run <file>`.

## Global Constraints

- **No code change.** `tests/`, `scripts/`, `lib/`, `vitest.config.js`, hooks, the installer, settings and workflows stay byte-identical to `origin/main` (spec, AC7 and Out of Scope).
- **Files changed by this item:** the spec, this plan, and their two leaf lines in `.gitignore`. The spec and its leaf are already committed on this branch (`f4bc0bd`, `920b80d`); Task 0 adds this plan and its leaf.
- No release records: `VERSION`, the `package.json` / `package-lock.json` version, `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md` (checkbox and DONE line), `.claude/memory/**` and the README "Known limits" line for `[BUG-059]` (`README.md:499`) stay untouched. The release writes them (spec, Out of Scope).
- **A red verification is not fixed here.** If any task below fails, the build stops and reports the failing test by name as a regression since `25e29e8`. That becomes a new spec, not a silent edit in this item (spec, Solution).
- This plan sits under the ignored `docs/superpowers/plans/`: it is new in Task 0 (`git add -f`), and tracked afterwards and re-included by its leaf (`git add -u`).
- Tests run under the vitest setup file `tests/helpers/gh-guard.js` (`vitest.config.js:8`), which strips gh credentials and arms the intercept, so no step here can reach the real gh.

## Plan decisions

1. **One verification task, no edit task.** The spec's Solution maps each criterion to an existing test; the build re-runs those tests and the full suite, and checks the repository facts the criteria name.
2. **AC6's grep is narrowed to skip constructs.** The spec writes the check as `grep -n "skipIf\|platform" tests/unit/gh-guard.test.js` "is empty". At `3b23689` that grep prints one line, `tests/unit/gh-guard.test.js:10`, because the describe title is `'[BUG-059] the fake gh resolves on every platform'`; that word is the criterion itself, not a skip. The criterion is "no `[BUG-059]` test carries a platform skip", so the plan checks it with `grep -nE "skip|runIf|process\.platform|win32" tests/unit/gh-guard.test.js`, which is empty at `3b23689` (measured during planning). The spec text is not changed (it is approved by hash).
3. **The `.gitignore` leaf** for this plan goes in sorted position in the plans block: directly after `!/docs/superpowers/plans/2026-11-19-bug087-installer-follows-a-symlink-at-the-opencode.md` and directly before `!/docs/superpowers/plans/2026-11-20-bug071-opencode-guard-evaluates-bash-commands-without.md`. The spec's leaf is already at `.gitignore:281`.

## Files read in full (spec, Files Requiring Full Read)

None, per the spec. Checked by grep during planning: the five test titles at `tests/unit/gh-guard.test.js:11`, `:24`, `:31`, `:38`, `:43`; `setupFiles: ['tests/helpers/gh-guard.js']` at `vitest.config.js:8`; no `bin/sh` under `tests/helpers/`; `git diff --stat origin/main -- tests scripts vitest.config.js` empty.

---

### Task 0: Commit this plan and its ignore leaf

**Files:**
- Modify: `.gitignore` (one leaf, sorted position)
- Create (stage): `docs/superpowers/plans/2026-11-20-bug059-fake-gh-is-posix-only-so-on-windows-the-suites.md`

- [X] [T-000-A] Modify `.gitignore`: add `!/docs/superpowers/plans/2026-11-20-bug059-fake-gh-is-posix-only-so-on-windows-the-suites.md` directly after the `2026-11-19-bug087-…` plan leaf and before the `2026-11-20-bug071-…` plan leaf (Plan decision 3). No dependency.
- [X] [T-000-B] Stage: `git add -u .gitignore`, then `git add -f docs/superpowers/plans/2026-11-20-bug059-fake-gh-is-posix-only-so-on-windows-the-suites.md`. Depends on T-000-A.
- [X] [T-000-C] Commit: `docs: plan verifying the fake gh fix already on main meets the entry [BUG-059]`. Depends on T-000-B.

### Task 1: Verify every acceptance criterion on this branch (AC1-AC7)

**Files:**
- Read only: `tests/unit/gh-guard.test.js`, `tests/scripts/ticket.test.js`, `tests/scripts/orchestrate.test.js`, `tests/helpers/`
- Modify: this plan (checkboxes only)

- [X] [T-001-A] Run `npx vitest run tests/unit/gh-guard.test.js`. Expected: `Test Files 1 passed (1)`, `Tests 5 passed (5)`. The filter's full match set, all green: "routes a gh call to the fake through fakeGh().env(), leaving PATH alone" (AC1), "kills a node child that names gh without a fake, with a named error" (AC2), "kills a node grandchild too, because NODE_OPTIONS is inherited" (AC3), "blocks gh in the test worker itself, by name and by an .exe path" (AC4), "strands any path the preload cannot see with no gh credentials" (AC5). No dependency.
- [X] [T-001-B] Run `npx vitest run tests/scripts/ticket.test.js tests/scripts/orchestrate.test.js`. Expected: `Test Files 2 passed (2)` with no failed test; every gh call is served by the fake (AC1). Depends on T-001-A only for order.
- [X] [T-001-C] Run `grep -nE "skip|runIf|process\.platform|win32" tests/unit/gh-guard.test.js` and `grep -rn "bin/sh" tests/helpers/`. Expected: both print nothing (exit 1) (AC6, Plan decision 2).
- [X] [T-001-D] Run `git diff --stat origin/main -- tests scripts lib vitest.config.js`. Expected: empty (AC7, no code change).
- [X] [T-001-E] Run `npm test`. Expected: exit 0, no failed test file (AC7). A failure caused by the sandbox environment (network, tmp permissions) is reported as ENV with its test name; any other red stops the build and is reported as a regression (Global Constraints).
- [X] [T-001-F] Stage: `git add -u docs/superpowers/plans/2026-11-20-bug059-fake-gh-is-posix-only-so-on-windows-the-suites.md` so the ticked boxes ride the commit. Depends on T-001-A through T-001-E.
- [X] [T-001-G] Commit: `docs: verify the fake gh fix on main meets the entry [BUG-059]`. Depends on T-001-F. Its own tick rides no later commit, since this is the last group; the closeout leaves it as the runner's commit of the tree.

## Test List

- [ ] Unit: `tests/unit/gh-guard.test.js`, the five `[BUG-059]` tests (AC1-AC5), unchanged.
- [ ] Integration: `tests/scripts/ticket.test.js` writeback and `tests/scripts/orchestrate.test.js` ticket intake, served by the fake (AC1), unchanged.
- [ ] Full suite: `npm test` green (AC7).
- [ ] E2E: not applicable, no UI.
- No new test: the item changes no behavior, and the criteria are already pinned by the tests above.

## Commit Order

1. Task 0: this plan and its `.gitignore` leaf (made by the runner at the end of the plan session).
2. Task 1: the plan with its verification boxes ticked. Nothing else changes, unless the verification turns red, in which case nothing is committed beyond the ticks already made and the build reports the regression.

## Identified Risks

- **The spec's AC6 grep is not empty as written** (`tests/unit/gh-guard.test.js:10`, the word "platform" in the describe title). Caught here and handled by Plan decision 2; an auditor reading only the spec's command would see one line and should read it as the title, not a skip.
- **A regression since `25e29e8`** in the fake, the intercept or the guard: T-001-A or T-001-B turns red. The build stops and reports it; it is not fixed in this item.
- **The full suite is red for an unrelated reason** on this branch: T-001-E reports the failing test names. Sandbox-only failures are ENV; others are reported, not fixed here, since this item may not change code.
- **Records stay stale until the release.** The backlog checkbox, the README Known limits line and the `CHANGELOG.md` entry still describe `[BUG-059]` as open after this item merges. The release updates them; this item does not.
- **Windows itself is not run in this item.** The win32 behavior is covered by the `ci-windows-node24` leg (`.github/workflows/test.yml:25`) and the prior spec's AC1 measurement; this branch runs on Linux.
