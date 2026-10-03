# BUG-045 Guard 3 Quoted Paths Implementation Plan

**Goal:** Fix Guard 3 allowlist to match quoted paths by including quote characters in boundary sets.

**Spec:** `docs/superpowers/specs/2026-10-03-bug045-guard3-quoted-paths-design.md`, APPROVED 2026-10-03.

## Steps

- [x] T-001: Add `"` and `'` to G3_BD and G3_AD in hook and mirror
- [x] T-002: Update authority `guard3-reference.sh`
- [x] T-003: Add 6 corpus rows for quoted paths
- [x] T-004: Update corpus count assertion in `guard3.test.js`
- [x] T-005: Version bump to 1.38.7, changelog entry, backlog flip
