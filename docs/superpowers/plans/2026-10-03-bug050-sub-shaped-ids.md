# BUG-050 Sub-Shaped ID Detection Implementation Plan

**Goal:** Make release instruments detect and report sub-shaped ids instead of silently skipping them.

**Spec:** `docs/superpowers/specs/2026-10-03-bug050-sub-shaped-ids-design.md`, APPROVED 2026-10-03.

## Steps

- [x] T-001: Add sub-shaped id detection to `tools/id-ceiling.mjs`
- [x] T-002: Add sub-shaped id detection to `tools/record-parity.mjs`
- [x] T-003: Grandfather the 3 ARCH-008 sub-items
- [x] T-004: Add tests to both test files
- [x] T-005: Update `tests/tools/repo-invariants.test.js`
- [x] T-006: Version bump to 1.38.6, changelog entry, backlog flip
