# Issue #106 `--no-deps` implementation plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Update one checkbox per edit (BUG-003 invariant).

**Goal:** `--no-deps` is recognized as an accepted no-op: the install proceeds unchanged and no unrecognized-argument warning is printed.

**Spec:** `docs/superpowers/specs/2026-10-27-issue106-no-deps-flag-design.md`, approved by the contributor 2026-10-27. Id pending owner intake.

## Global Constraints

- Zero runtime dependencies; the parser stays hand-rolled.
- No release records (`VERSION`, `package.json` version, `CHANGELOG.md`, backlog).
- The installer is exercised only through `tests/installer/cli.test.js`, which uses temp directories.

## Tasks

- [x] 1. `bin/code-conductor.mjs`: add `noDeps: false` to `opts`, a `--no-deps` branch, `[--no-deps]` in `USAGE`, and update the "four flags" comment.
- [x] 2. `tests/installer/cli.test.js`: no warning, same installed file set with and without the flag, not consumed as the `--verbosity` value, combined with `--project`, and listed in `--help`.
- [x] 3. `README.md` Install flags table and `.github/wiki/pages/Getting-Started.md`: add or correct the `--no-deps` row.
- [x] 4. `.gitignore`: add the spec and plan leaves in sorted position.
- [x] 5. Run the full suite with `npx vitest run`.
