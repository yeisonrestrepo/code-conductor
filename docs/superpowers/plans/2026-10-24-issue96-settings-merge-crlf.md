# BUG-066 Settings Merge CRLF Idempotence Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Update one checkbox per edit (BUG-003 invariant).

**Goal:** An unchanged re-run of the installer never rewrites a `settings.json` whose only difference from the merge is CRLF line endings.

**Architecture:** `mergeSettingsFile` compares its LF serialization against the host text with `\r\n` normalized to `\n`. No other code changes.

**Tech Stack:** Node ESM, vitest.

**Spec:** `docs/superpowers/specs/2026-10-24-bug066-settings-merge-crlf-design.md`, owner reviews in the PR.

## Global Constraints

- LF hosts, host-owned keys and the fresh-install branch behave exactly as on `main`.
- No release records: no `VERSION`, `package.json`, `CHANGELOG.md`, backlog flip.
- Staging is by explicit path: `git add -u <path>` for tracked files, `git add -f <path>` for a new file under `docs/` before its leaf is in the index. Never bare `git add -u`.
- The pre-commit hook runs the full vitest suite. Never bypass it.

---

### Task 0: Branch, spec, plan and their ignore leaves

- [X] [T-000-0] Worktree on `fix/bug-066-settings-merge-crlf` from `origin/main`.
- [X] [T-000-A] Write the spec and this plan.
- [X] [T-000-B] Add both `.gitignore` leaves in sorted position (BUG-042 toll).
- [X] [T-000-C] Add the `[BUG-066]` backlog entry after `[BUG-061]`.
- [X] [T-000-E] Found by the full suite: `repo-invariants.test.js` requires every open backlog item in README's Known limits, so `[BUG-066]` gets a Known-limits line; release closeout removes it.
- [X] [T-000-D] Commit `docs: spec and plan for the CRLF settings merge [BUG-066]`.

### Task 1: Failing tests

**Files:** Modify `tests/installer/settings-merge.test.js`

- [X] [T-001-A] Add: CRLF template, run twice, second run `unchanged` and byte-identical.
- [X] [T-001-B] Add: CRLF host equal to the merge, `unchanged` and bytes kept.
- [X] [T-001-C] Run the file. Expected: both new cases fail on `main`'s code.

### Task 2: Fix

**Files:** Modify `lib/installer/settings-merge.mjs`

- [X] [T-002-A] Compare against `raw.replace(/\r\n/g, '\n')`.
- [X] [T-002-B] Run `tests/installer/`. Expected: all pass.
- [X] [T-002-C] Commit `fix: compare settings merges with host line endings normalized [BUG-066]`.

### Task 3: Verify and evidence (PR only, never committed)

- [X] [T-003-A] Full `npx vitest run` on the branch and on `main` under identical conditions.
- [X] [T-003-B] Install twice into a temp host with a CRLF template on `main` and on the branch; record `settings.json` sha256, mtime and status per run.
- [X] [T-003-C] Render the suite summaries and both install captures to PNG with headless Edge; attach to the PR under `Closes #96`.
