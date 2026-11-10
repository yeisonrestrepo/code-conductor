# Issue #132 history truncation single measure implementation plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Update one checkbox per edit (BUG-003 invariant).

**Goal:** snap-build truncates `ops.n`, `ops.f`, `mem.d` and `mem.x` elements to the validator's `elementLength`, so every snapshot it emits validates.

**Spec:** `docs/superpowers/specs/2026-11-10-issue132-history-truncation-single-measure-design.md` (draft, pending owner approval). Id pending owner intake. Stacked on PR #133, which is stacked on PR #129.

## Global Constraints

- One protected surface changes: `scripts/snap-build.mjs` (`normArray` truncation, one new helper). `elementLength` is imported already (PR #133).
- No release records (`VERSION`, `package.json` version, `CHANGELOG.md`, backlog).
- No new dependencies. Tests are added, none skipped, so `tools/skip-baseline.json` is untouched on every leg.

## Tasks

- [x] 1. Tests in `tests/scripts/snap-build.test.js` (AC1 to AC4); AC1 to AC3 red on PR #133's head.
- [x] 2. `scripts/snap-build.mjs`: `truncateToCap`, called by `normArray`. New cases green.
- [x] 3. `.gitignore`: spec and plan leaves in sorted position.
- [x] 4. Run the full suite with `npx vitest run --maxWorkers=2 --minWorkers=1`.
