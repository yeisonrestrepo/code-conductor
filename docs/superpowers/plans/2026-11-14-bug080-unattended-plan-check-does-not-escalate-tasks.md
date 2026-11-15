# BUG-080 unattended plan check does not escalate tasks that write guard-enforcement and control-plane files implementation plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Update one checkbox per edit (BUG-003 invariant). Execute in file order.

**Goal:** Confirm, on the `v1.52.0` base, that the BUG-080 fix stands as the approved spec describes it and keep it stable: `CONTROL_PLANE`, `inControlPlane`, the shared reach helper and the reason `task <id> declares <entry> inside the control-plane files` are already on `main` (`b06b2fd`, merged by `1208f40`, released in `76a37f5`). This round changes no code. It pins the state with drift checks and the existing tests, and it records the result.

**Spec:** `docs/superpowers/specs/2026-11-14-bug080-unattended-plan-check-does-not-escalate-tasks-design.md` (approved 2026-11-14 by independent review, round 1; sha256 `1d6ddf32509a423a3a7fafa57f83b55b138a343fc0e2c9f7e54560c19a0d4ade`). Issue #219.

**Test command:** `npm test`. Filtered runs use `npx vitest run <file>` and `-t <pattern>`.

## Global Constraints

- No release records: `VERSION`, the `package.json` / `package-lock.json` version, `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md`, `.claude/memory/**` and the README "Known limits" lines stay untouched (spec, Owner Decisions, "Records": they are written at release 1.52.1).
- **Stable surface (spec, Owner Decisions).** `CONTROL_PLANE` and `WRITE_SURFACE` stay unchanged, and U22 and U41-U45 stay green byte for byte, including the `docs/CLAUDE.md` near miss in U43. No edit to `scripts/` or `tests/`.
- **Matcher hardening is BUG-083, not this item.** No change to how `inSurface`, `inControlPlane`, `taskGlob`, `ntfsAlias`, `reachesDir` or `reachesList` normalize or match a `Files` entry.
- **Hook untouched.** `.claude/hooks/pre-tool-use.mjs` and `project-template/.claude/hooks/pre-tool-use.mjs` are not edited; the matching Guard 5 check is a separate follow-up item. BUG-081 and BUG-082 are not folded in.
- No new dependency, no network, no workflow, installer, settings, command or SNAP-script change; `tools/skip-baseline.json` untouched.
- The only file this plan edits after Task 0 is the plan itself (its checkboxes). It is tracked, so every staging step is `git add -u <path>` with an explicit path.

## Plan decisions

1. **Why no code task.** The spec's "Base and state" decision says the `CONTROL_PLANE` list, `inControlPlane` and U41-U45 stand as merged on `76a37f5`. Measured on this branch (HEAD `d3e644b`): `git diff --stat 76a37f5 HEAD -- scripts tests .claude project-template lib tools` is empty, so the code under review is the code that shipped. `scripts/orchestrate.mjs:22` holds `WRITE_SURFACE`, `:25` opens `CONTROL_PLANE`; `reachesDir`, `reachesList`, `taskGlob`, `ntfsAlias`, `inSurface`, `inControlPlane` and `surfaceTask` sit at lines 1057-1093 and match the spec's reach rule and precedence (write surface first, then control plane, per task, in plan order). Writing the code again would be an empty diff; changing it would break the "keep stable" decision.
2. **How each AC maps to a merged test.** AC1 → U41 (28 rows); AC2 → U42 (14 rows); AC3 → U43 (9 rows, `docs/CLAUDE.md` included); AC4 → U22 (18 rows, unchanged) and U44 (3 rows); AC5 → U45; AC6 → the `WRITE_SURFACE` pin, the `CONTROL_PLANE` pin (`tests/scripts/orchestrate.test.js:478`) and the Guard 6 parity pin (`tests/hooks/guard6.test.js:215`); AC7 → `npm test`.
3. **Drift checks are diffs against the release, not re-reads.** "Unchanged" is checked with `git diff --quiet 76a37f5 -- <paths>`, which proves byte identity for the code, the tests and the hook in one command, rather than with line-by-line comparisons that drift.
4. **`.gitignore` leaf already present.** The leaf `!/docs/superpowers/plans/2026-11-14-bug080-unattended-plan-check-does-not-escalate-tasks.md` is at `.gitignore:169`, between the bug076 and feat053 plan leaves, from the first round of this item. Adding it again would duplicate the line, so Task 0 verifies it and does not edit `.gitignore`. This plan replaces the first round's plan at the same path; that file is tracked, so it is staged with `-u`.

## Baseline (measured on this branch, HEAD d3e644b)

- `npx vitest run tests/scripts/orchestrate.test.js -t "BUG-080|U22 |write surface"`: **76 passed, 606 skipped (682)**, about 70 s. The match set: the 56 BUG-080 tests (the `CONTROL_PLANE` pin, U41 ×28, U42 ×14, U43 ×9, U44 ×3, U45), the 18 U22 rows, and the `write surface [FEAT-011 AC4]` tests other than the pin.
- `npx vitest run tests/hooks/guard6.test.js`: **30 passed (30)**.
- `grep -c "BUG-080" tests/scripts/orchestrate.test.js`: 7.

---

### Task 0: Commit this plan

**Files:**
- Modify: `docs/superpowers/plans/2026-11-14-bug080-unattended-plan-check-does-not-escalate-tasks.md`

- [X] [T-001] Rewrite this plan file for the approved spec `1d6ddf32…`, replacing the first round's plan at the same path. No dependency.
- [X] [T-002] `.gitignore`: verify the leaf `!/docs/superpowers/plans/2026-11-14-bug080-unattended-plan-check-does-not-escalate-tasks.md` is present once, in sorted position (`grep -c` gives 1, at line 169). No edit (plan decision 4). Depends on T-001.
- [X] [T-003] Stage: `git add -u docs/superpowers/plans/2026-11-14-bug080-unattended-plan-check-does-not-escalate-tasks.md` (tracked file under the ignored `docs/superpowers/plans/`). Depends on T-002.
- [X] [T-004] Commit: `docs: plan the BUG-080 verification on the 1.52.0 base [BUG-080]`. Depends on T-003.

---

### Task 1: Drift checks and the BUG-080 tests

**Files:**
- Modify: `docs/superpowers/plans/2026-11-14-bug080-unattended-plan-check-does-not-escalate-tasks.md` (checkboxes only)

- [X] [T-101] No code drift since the release: `git diff --quiet 76a37f5 -- scripts tests lib tools .claude/hooks project-template/.claude/hooks .claude/commands project-template/.claude/commands .claude/settings.json project-template/.claude/settings.json` exits 0. A non-zero exit means the branch moved under the spec's base: stop and report it, do not edit. Depends on T-004.
- [X] [T-102] The lists are the ones the spec names: `grep -n "^export const WRITE_SURFACE = \[RUN_FILE, ENVELOPE_FILE, '.claude/memory/session-snapshot.json', '.conductor/\*\*'\];" scripts/orchestrate.mjs` gives one match, and `grep -n "export const CONTROL_PLANE\|const inControlPlane\|function surfaceTask\|inside the control-plane files" scripts/orchestrate.mjs` gives exactly one line each. Depends on T-101.
- [X] [T-103] Run `npx vitest run tests/scripts/orchestrate.test.js -t "BUG-080|U22 |write surface"`. This is a confirmation run, not a red step; the filter's full match set is predicted **all green, 76 passed, 606 skipped (682)**: the `CONTROL_PLANE` pin, U41 (28), U42 (14), U43 (9, `docs/CLAUDE.md` included), U44 (3), U45, the 18 U22 rows, and the `write surface [FEAT-011 AC4]` pins. Any red row is a regression against the release: stop and report it with the row name. Depends on T-102.
- [X] [T-104] Run `npx vitest run tests/hooks/guard6.test.js`. Predicted: **30 passed (30)**, the `ORCH_WRITE_SURFACE` parity pin (line 215) included (AC6). Depends on T-103.

---

### Task 2: Full suite and closeout

**Files:**
- Modify: `docs/superpowers/plans/2026-11-14-bug080-unattended-plan-check-does-not-escalate-tasks.md` (checkboxes only)

- [X] [T-201] Run `npm test`. Predicted: exit 0, every file green, no new skip (AC7). A failure that comes from the sandbox (network, tmp permissions) is reported as ENV with the test's name; any other red is a regression to report. Depends on T-104.
- [X] [T-202] Final scope check: `git status --porcelain` lists only this plan file as modified; `git diff --quiet 76a37f5 -- scripts tests .claude project-template lib tools VERSION CHANGELOG.md package.json package-lock.json README.md "AGENT-READABLE BACKLOG.md"` exits 0 (no code, test, hook, installer or owner-record change against the base). Depends on T-201.
- [X] [T-203] Stage: `git add -u docs/superpowers/plans/2026-11-14-bug080-unattended-plan-check-does-not-escalate-tasks.md` (ticks T-101 to T-202). Depends on T-202.
- [X] [T-204] Commit: `docs: verify the BUG-080 control-plane escalation on the 1.52.0 base [BUG-080]`. Depends on T-203.

---

## Test List

- [X] Integration, AC1 (one row per control-plane entry): U41, 28 rows, unchanged since `76a37f5`.
- [X] Integration, AC2 (directory, glob and case forms): U42, 14 rows.
- [X] Integration, AC3 (near misses approve): U43, 9 rows, the `docs/CLAUDE.md` near miss included.
- [X] Integration, AC4 (write-surface reason kept): U22 (18 rows, byte for byte) and U44 (3 rows).
- [X] Integration, AC5 (plan order wins): U45.
- [X] Unit, AC6: the `WRITE_SURFACE` and `CONTROL_PLANE` pins in `tests/scripts/orchestrate.test.js` and the Guard 6 parity pin `tests/hooks/guard6.test.js:215`.
- [X] AC7: `npm test` green (T-201).
- [X] No new test: the spec fixes U22 and U41-U45 as the tests that must stay as merged. No E2E/UI test: there is no UI.

## Commit Order

0. Task 0: this plan (done by this session's commit).
1. Tasks 1 and 2: one commit, T-204, carrying only the plan's ticks T-101 to T-202. Task 1 has no commit of its own because it edits nothing but checkboxes. The ticks of T-203 and T-204 are made after the last commit and ride whichever commit next stages this plan.

## Identified Risks

- **The branch moves under the base.** If a later merge changes `scripts/`, `tests/` or the hook before the build runs, T-101 fails first and the build stops before any test runs, instead of reporting a green suite for code the spec did not approve.
- **Scope creep into BUG-083 or the Guard 5 follow-up.** A reviewer may ask to harden the matcher or to mirror the list in the hook. The spec assigns both elsewhere; the build reports such a request and does not edit `scripts/orchestrate.mjs` or the hook.
- **Run time.** The full `orchestrate.test.js` file takes several minutes (the U-rows spawn the CLI); T-103's filter keeps the targeted check at about 70 s, and `npm test` in T-201 runs everything once.
- **A plan that only verifies.** The runner's build commit then holds only plan ticks. That matches the spec's "stand as merged" decision; the code itself is in `b06b2fd`.
- **Line numbers drift.** References are from HEAD `d3e644b`; locate by the quoted text if they move.
