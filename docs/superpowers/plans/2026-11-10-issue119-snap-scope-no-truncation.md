# Issue #119 snap-build scope refusal implementation plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Update one checkbox per edit (BUG-003 invariant).

**Goal:** snap-build never emits an `ops.scope` different from the one it was given; an over-cap scope is refused by name.

**Spec:** `docs/superpowers/specs/2026-11-10-issue119-snap-scope-no-truncation-design.md` (draft, pending owner approval). Id pending owner intake.

## Global Constraints

- One protected surface changes: `scripts/snap-build.mjs`, scope handling only. `normArray` and the other arrays are untouched.
- No release records (`VERSION`, `package.json` version, `CHANGELOG.md`, backlog).
- No new dependencies. Tests are added, none skipped, so `tools/skip-baseline.json` is untouched on every leg.

## Tasks

- [x] 1. `tests/scripts/snap-build.test.js`: cases for AC1, AC2 and AC3; AC1 and AC2 red on `main` (exit 0, truncated output).
- [x] 2. `scripts/snap-build.mjs`: a scope guard before `normArray`; the new cases green, the file's existing cases unchanged.
- [x] 3. `.gitignore`: spec and plan leaves in sorted position.
- [x] 4. Run the full suite with `npx vitest run --maxWorkers=2 --minWorkers=1`.
