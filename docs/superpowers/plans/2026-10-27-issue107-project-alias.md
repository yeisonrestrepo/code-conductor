# Issue #107 `-Project` implementation plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Update one checkbox per edit (BUG-003 invariant).

**Goal:** `-Project` behaves exactly like `--project`, and no single-dash flag is consumed as the `--verbosity` value.

**Spec:** `docs/superpowers/specs/2026-10-27-issue107-project-alias-design.md`, approved by the contributor 2026-10-27. Id pending owner intake.

## Global Constraints

- Zero runtime dependencies; the parser stays hand-rolled; exact-case matching.
- No release records (`VERSION`, `package.json` version, `CHANGELOG.md`, backlog).
- The installer is exercised only through `tests/installer/cli.test.js`, which uses temp directories.
- The verbosity value guard change (`--` to `-`) is shared with #108 and #109; whichever PR lands first carries it, and the others rebase to a no-op hunk.

## Tasks

- [x] 1. `bin/code-conductor.mjs`: `-Project` in the project branch, value guard `startsWith('-')`, `USAGE` shows `[--project|-Project]`.
- [x] 2. `tests/installer/cli.test.js`: alias scaffolds the project, lowercase stays unrecognized, not consumed after `--verbosity`, BUG-052 refusal kept, listed in `--help`.
- [x] 3. `README.md` and `.github/wiki/pages/Getting-Started.md`: `--project` / `-Project`.
- [x] 4. `.gitignore`: spec and plan leaves in sorted position.
- [x] 5. Run the full suite with `npx vitest run`.
