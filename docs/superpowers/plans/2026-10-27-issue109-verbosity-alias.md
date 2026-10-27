# Issue #109 `-Verbosity` implementation plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Update one checkbox per edit (BUG-003 invariant).

**Goal:** `-Verbosity` behaves exactly like `--verbosity` in every form, with last-wins across the two spellings.

**Spec:** `docs/superpowers/specs/2026-10-27-issue109-verbosity-alias-design.md`, approved by the contributor 2026-10-27. Id pending owner intake.

## Global Constraints

- Zero runtime dependencies; exact-case matching; no `-Verbosity:LEVEL` form.
- No release records (`VERSION`, `package.json` version, `CHANGELOG.md`, backlog).
- The installer is exercised only through `tests/installer/cli.test.js`, which uses temp directories.
- The verbosity value guard change (`--` to `-`) is byte-identical to #107 and #108, so the three merge cleanly in any order.

## Tasks

- [x] 1. `bin/code-conductor.mjs`: `VERBOSITY_FLAGS` and `isVerbosityFlag`, inline value sliced after the first `=`, value guard `startsWith('-')`, `USAGE` shows `[--verbosity|-Verbosity MIN|INFO|VERBOSE]`.
- [x] 2. `tests/installer/cli.test.js`: space and inline forms, last-wins across spellings, trailing flag, invalid value, single-dash token not consumed, lowercase unrecognized, `--help` listing.
- [x] 3. `README.md` and `.github/wiki/pages/Getting-Started.md`: `--verbosity` / `-Verbosity`.
- [x] 4. `.gitignore`: spec and plan leaves in sorted position.
- [x] 5. Run the full suite with `npx vitest run`.
