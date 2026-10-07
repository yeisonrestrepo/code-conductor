# BUG-053: Test Fixtures Inherit GIT_* Env Vars From Linked Worktrees

**Status:** APPROVED 2026-10-03. **Target:** `1.38.3`, patch. **Branch:** `fix/bug-053-test-gate-git-env`.

## Problem

Test fixtures using `git init` in temp directories inherit `GIT_DIR`, `GIT_WORK_TREE` and other `GIT_*` env vars from the parent process when the test suite runs from a linked worktree. This causes `git init` to write into the real repo instead of the temp directory, corrupting test isolation.

## Solution

A shared `tests/helpers/git-env.js` exporting `cleanGitEnv()` that strips all 6 `GIT_*` vars (`GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_OBJECT_DIRECTORY`, `GIT_ALTERNATE_OBJECT_DIRECTORIES`, `GIT_CEILING_DIRECTORIES`). Applied to 4 test files that spawn `git init` in temp directories.

### Acceptance Criteria

1. `cleanGitEnv()` strips all 6 `GIT_*` vars while preserving `PATH` and other env vars.
2. All 4 affected test files use `cleanGitEnv()` for their git operations.
3. Tests pass both from the main checkout and from a linked worktree.

## Components Affected

- `tests/helpers/git-env.js` — new shared helper
- `tests/scripts/conductor-db.test.js` — applies `cleanGitEnv()`
- `tests/scripts/handoff-cycle.test.js` — applies `cleanGitEnv()`
- `tests/scripts/resume-read.test.js` — applies `cleanGitEnv()`
- `tests/unit/staging-convention.test.js` — applies `cleanGitEnv()`
