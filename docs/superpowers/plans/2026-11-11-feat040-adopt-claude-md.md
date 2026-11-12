# FEAT-040 adopt host CLAUDE.md implementation plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Update one checkbox per edit (BUG-003 invariant).

**Goal:** `/cc-stack` offers to adopt a host-authored `CLAUDE.md`, writing only on approval of the exact render.

**Spec:** `docs/superpowers/specs/2026-11-11-feat040-adopt-claude-md-design.md` (implemented, pending owner approval). Issue #145.

## Global Constraints

- One new script, `scripts/adopt-claude-md.mjs`; functions of 30 lines or fewer, guard clauses, English identifiers.
- The managed block is never modified; no release records.
- No new dependencies.

## Tasks

- [x] 1. `scripts/adopt-claude-md.mjs`: `sections`, `render`, `apply <token>`; sentinel and fence refusals; backup before write.
- [x] 2. `tests/unit/adopt-claude-md.test.js`: six acceptance criteria, CRLF, fenced heading, duplicates, unbalanced sentinels, open fence, host text around a block, template parity.
- [x] 3. `global/commands/cc-stack.md` step 4b; `README.md` managed-block section.
- [x] 4. `lib/installer/deploy.mjs` ships `merge-md.mjs` to `.claude/lib/installer/`; test in `tests/installer/deploy.test.js`.
- [x] 5. Hardening: Active Stack Profiles trigger, exclusive backups, section multiset check, plan errors as exit 2.
- [x] 6. `.gitignore`: evidence images, spec and plan leaves in sorted position.
- [x] 7. Run the full suite with `npx vitest run`.
