# Issue #128 single scope-cap measure implementation plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Update one checkbox per edit (BUG-003 invariant).

**Goal:** router, builder and validator measure an `ops.scope` element with one function, so a scope the router accepts always validates.

**Spec:** `docs/superpowers/specs/2026-11-10-issue128-scope-cap-single-measure-design.md` (draft, pending owner approval). Id pending owner intake. Stacked on PR #129.

## Global Constraints

- Three protected surfaces change, one import and one call site each: `scripts/snap-validate.mjs` (calls the shared measure, same arithmetic), `scripts/snap-build.mjs` (`scopeArray` measure), `scripts/orchestrate.mjs` (`taskScope` measure). `scripts/snap-contract.mjs` gains one export.
- No release records (`VERSION`, `package.json` version, `CHANGELOG.md`, backlog).
- No new dependencies. Tests are added, none skipped, so `tools/skip-baseline.json` is untouched on every leg.

## Tasks

- [x] 1. Tests: `tests/unit/snap-contract.test.js` (AC1), `tests/scripts/orchestrate.test.js` (AC2), `tests/scripts/snap-build.test.js` (AC3, AC4); AC1 to AC3 red on PR #129's head.
- [x] 2. `scripts/snap-contract.mjs`: export `elementLength`; the three consumers call it. New cases green.
- [x] 3. `.gitignore`: spec and plan leaves in sorted position.
- [x] 4. Run the full suite with `npx vitest run --maxWorkers=2 --minWorkers=1`.
