# Issue #118 contract harness isolation implementation plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Update one checkbox per edit (BUG-003 invariant).

**Goal:** the pre-tool-use contract suite gives the same result with or without a live orchestrator run in the checkout.

**Spec:** `docs/superpowers/specs/2026-11-10-issue118-contract-test-isolation-design.md` (draft, pending owner approval). Id pending owner intake.

## Global Constraints

- Test-only change; the hook and every protected surface are untouched.
- No release records (`VERSION`, `package.json` version, `CHANGELOG.md`, backlog).
- No new dependencies. No skip-set change, so `tools/skip-baseline.json` is untouched on every leg.

## Tasks

- [x] 1. `tests/hooks/pre-tool-use-contract.test.js`: the Write case asserts empty stdout; red with a live run (`1 failed | 23 passed`).
- [x] 2. Same file: `fire()` spawns with `cwd: dir`; 24/24 with a live run and without one.
- [x] 3. `.gitignore`: spec and plan leaves in sorted position.
- [x] 4. Run the full suite with `npx vitest run --maxWorkers=2 --minWorkers=1`.
