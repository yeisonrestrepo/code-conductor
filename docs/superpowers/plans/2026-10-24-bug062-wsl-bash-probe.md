# BUG-062 WSL Bash Probe Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Update one checkbox per edit (BUG-003 invariant).

**Goal:** Bash-dependent suites run under a bash that can open a script by its native path, or skip with a named reason, so the WSL launcher on PATH no longer turns ~227 tests red.

**Architecture:** `tests/helpers/bash.js` probes candidates (`bash`, then Git for Windows' `bin/bash.exe` on win32) by running a temp script given by its absolute path, and exports `BASH` (path or `null`). Four suites import it.

**Tech Stack:** Node `child_process`, vitest.

**Spec:** `docs/superpowers/specs/2026-10-24-bug062-wsl-bash-probe-design.md`.

## Global Constraints

- No hook, settings or installer change.
- Functions ≤30 lines, guard clauses; mirrors the `tests/helpers/can-symlink.js` probe shape.
- Staging by explicit path; `git add -f` only for the new spec/plan before their leaves land. Never bare `git add -u`.
- The pre-commit hook runs the full suite. Never bypass it.

## Review Focus

1. **WSL first on PATH**: the probe rejects it and Git's bash is used. Pinned in Task 1 and by the context-guard reproduction.
2. **No usable bash**: `BASH` is `null`, suites skip, one warning names why.
3. **POSIX hosts**: `bash` passes the probe, nothing changes.

---

### Task 0: Spec, plan and their ignore leaves

- [X] [T-000-A] Write the spec and this plan.
- [X] [T-000-B] Add both `.gitignore` leaves in sorted position (BUG-042 toll).
- [X] [T-000-C] Add the `[BUG-062]` backlog entry after `[BUG-061]`.
- [X] [T-000-D] Commit `docs: spec and plan for the WSL bash probe [BUG-062]`.

### Task 1: Failing helper test

**Files:** Create `tests/unit/bash-helper.test.js`

- [X] [T-001-A] Cases: `findBash` returns `null` for a missing binary and for `process.execPath` (exits non-zero on the probe script); `BASH`, when non-null, runs a script by native path; on win32 with Git's `bin/bash.exe` present, `BASH` is non-null.
- [X] [T-001-B] Run it on `main`. Expected: fails (helper absent).

### Task 2: Helper and suite swap

**Files:** Create `tests/helpers/bash.js`; modify `tests/hooks/{context-guard,guard3,hook-project-root,verbosity-remind}.test.js`, `README.md` (Known limits bullet, required by `repo-invariants` for an open backlog defect)

- [X] [T-002-A] Write `findBash(candidates)` and `BASH`.
- [X] [T-002-B] Replace each local probe and each literal `'bash'` spawn with `BASH`.
- [X] [T-002-C] Run the helper test and the four suites with the WSL launcher first on PATH. Expected: all pass.

### Task 3: Verification

- [X] [T-003-A] Full suite on the branch and on `origin/main`, same PATH (WSL first), gh neutralized. Record counts in the PR.
