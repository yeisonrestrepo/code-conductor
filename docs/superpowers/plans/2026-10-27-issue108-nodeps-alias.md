# Issue #108 `-NoDeps` implementation plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Update one checkbox per edit (BUG-003 invariant).

**Goal:** `-NoDeps` behaves exactly like `--no-deps` (an accepted no-op) and is never consumed as the `--verbosity` value.

**Spec:** `docs/superpowers/specs/2026-10-27-issue108-nodeps-alias-design.md`, approved by the contributor 2026-10-27. Id pending owner intake.

**Stacked on #106** (`feat/issue-106-no-deps`); rebase onto `main` once #106 merges.

## Global Constraints

- Zero runtime dependencies; exact-case matching.
- No release records (`VERSION`, `package.json` version, `CHANGELOG.md`, backlog).
- The installer is exercised only through `tests/installer/cli.test.js`, which uses temp directories.
- The verbosity value guard change (`--` to `-`) is byte-identical to #107 and #109. The sibling PRs still conflict textually on `USAGE` and adjacent lines, so the second to land needs a trivial rebase.

## Tasks

- [x] 1. `bin/code-conductor.mjs`: `-NoDeps` in the no-deps branch, value guard `startsWith('-')`, `USAGE` shows `[--no-deps|-NoDeps]`.
- [x] 2. `tests/installer/cli.test.js`: alias accepted, lowercase unrecognized, not consumed after `--verbosity`, combined flags, `--help` listing.
- [x] 3. `README.md` and `.github/wiki/pages/Getting-Started.md`: `--no-deps` / `-NoDeps`.
- [x] 4. `.gitignore`: spec and plan leaves in sorted position.
- [x] 5. Run the full suite with `npx vitest run`.
