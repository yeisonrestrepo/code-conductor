# BUG-065 Guard 3 Test Temp-Dir Cleanup Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Update one checkbox per edit (BUG-003 invariant).

**Goal:** A Windows handle that outlives `bash` for a moment never turns a correct Guard 3 verdict into a failed row.

**Architecture:** `tests/hooks/guard3.test.js` gains `removeTempDir(dir)`: `fs.rmSync` in a hand-rolled retry loop (10 attempts, 50 ms linear backoff, `EBUSY`/`EPERM`/`ENOTEMPTY` only) that never throws, because Node 24 `maxRetries` was measured not to retry. `runRow`'s `finally` and the `afterAll` sweep both call it. No hook, corpus or shipped file changes.

**Tech Stack:** Node `fs`, vitest, Git Bash on Windows.

**Spec:** `docs/superpowers/specs/2026-10-24-bug065-guard3-eperm-cleanup-design.md`, reviewed by the owner in the PR.

## Global Constraints

- The corpus, dialect and termination cases stay byte-identical; the file still runs 176 tests.
- Staging by explicit path: `git add -u <path>` for tracked files, `git add -f <path>` for the new spec and plan until their `.gitignore` leaves land. Never bare `git add -u`.
- The pre-commit hook runs the full suite. Never bypass it.
- No release records.

## Review Focus

1. **Cleanup can no longer fail a row.** The `finally` calls a helper that never throws.
2. **Leftovers are still reaped.** The `afterAll` sweep uses the same retrying helper per dir, so one stuck dir no longer aborts the sweep of the rest.

---

### Task 0: Branch, spec, plan, ignore leaves, backlog

- [X] [T-000-0] Worktree `fix/bug-065-guard3-eperm-cleanup` from `origin/main`.
- [X] [T-000-A] Write the spec and this plan.
- [ ] [T-000-B] Add both `.gitignore` leaves in sorted position (BUG-042 toll).
- [ ] [T-000-C] Add the `[BUG-065]` backlog entry after `[BUG-061]`; append a `## Spec: BUG-065` entry to `.claude/memory/project.md`.
- [ ] [T-000-D] Commit `docs: spec and plan for the guard3 temp-dir cleanup [BUG-065]`.

### Task 1: Before measurement

- [ ] [T-001-A] On a detached `origin/main` worktree, run `tests/hooks/guard3.test.js` 20 times while the branch runs alongside (shared machine load); record per run: exit, failed tests, EPERM/EBUSY lines.

### Task 2: Fix

**Files:** Modify `tests/hooks/guard3.test.js`

- [ ] [T-002-A] Add `removeTempDir(dir)`; call it from `runRow`'s `finally` and from the `afterAll` sweep.
- [ ] [T-002-B] Run the 20-run tally on the branch, concurrently with Task 1. Expected: zero EPERM/EBUSY failures.
- [ ] [T-002-C] Commit `fix: retry and tolerate guard3 temp-dir cleanup on Windows [BUG-065]`.

### Task 3: Verify

- [ ] [T-003-A] `npx vitest run` full suite on the branch and on `main` under identical conditions (gh neutralized); record both counts.

### Task 4: Evidence (PR only, never committed)

- [ ] [T-004-A] Render the vitest summaries and both tallies to PNG with headless Edge in the scratchpad.
- [ ] [T-004-B] Open the PR with `Closes #95`, counts, tally and the PNGs attached.
