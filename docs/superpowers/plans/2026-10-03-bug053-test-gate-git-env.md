# BUG-053 Test GIT_* Env Scrubbing Implementation Plan

**Goal:** Isolate test fixtures from inherited `GIT_*` env vars so `git init` in temp dirs works correctly from linked worktrees.

**Spec:** `docs/superpowers/specs/2026-10-03-bug053-test-gate-git-env-design.md`, APPROVED 2026-10-03.

## Steps

- [x] T-001: Create `tests/helpers/git-env.js` with `cleanGitEnv()`
- [x] T-002: Apply to `tests/scripts/conductor-db.test.js`
- [x] T-003: Apply to `tests/scripts/handoff-cycle.test.js`
- [x] T-004: Apply to `tests/scripts/resume-read.test.js`
- [x] T-005: Apply to `tests/unit/staging-convention.test.js`
- [x] T-006: Version bump to 1.38.3, changelog entry
