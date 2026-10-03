# BUG-051 Detector Path Resolution Implementation Plan

**Goal:** Make `/cc-stack` and `/cc-resume` resolve the detector script from `.claude/scripts/` first (installed), falling back to `scripts/` (dev layout).

**Spec:** `docs/superpowers/specs/2026-10-03-bug051-detector-path-design.md`, APPROVED 2026-10-03.

## Steps

- [x] T-001: Update `global/commands/cc-stack.md`
  - Step 1 fallback and Step 3 detector invocation use resolved path

- [x] T-002: Update `project-template/.claude/commands/cc-resume.md`
  - Auto-fill step resolves detector path dynamically

- [x] T-003: Update `.claude/commands/cc-resume.md` (mirror)
  - Byte-identical to project-template version

- [x] T-004: Version bump and changelog
  - Bump to `1.38.2`, add changelog entry
