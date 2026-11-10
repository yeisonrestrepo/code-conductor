# Issue #136 ops.f keep action code implementation plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Update one checkbox per edit (BUG-003 invariant).

**Goal:** snap-build cuts the path of an over-cap `ops.f` entry and keeps its `:C`/`:M`/`:D` suffix, so the snapshot validates.

**Spec:** `docs/superpowers/specs/2026-11-10-issue136-ops-f-keep-action-code-design.md` (draft, pending owner approval). Id pending owner intake. Stacked on PR #137, which is stacked on PR #133 and PR #129.

## Global Constraints

- One protected surface changes: `scripts/snap-build.mjs` (one new helper, `truncateFileEntry`; `normArray` takes the truncation function; the `ops.f` call passes it).
- No release records (`VERSION`, `package.json` version, `CHANGELOG.md`, backlog).
- No new dependencies. Tests are added, none skipped, so `tools/skip-baseline.json` is untouched on every leg.

## Tasks

- [x] 1. Tests in `tests/scripts/snap-build.test.js` (AC1 to AC5); PR #137's `ops.f` test validates its output. AC1, AC2 and AC4 red on PR #137's head.
- [x] 2. `scripts/snap-build.mjs`: `truncateFileEntry`, passed to `normArray` for `ops.f`. New cases green.
- [x] 3. `.gitignore`: spec and plan leaves in sorted position.
- [x] 4. Run the full suite with `npx vitest run --maxWorkers=2 --minWorkers=1`.
