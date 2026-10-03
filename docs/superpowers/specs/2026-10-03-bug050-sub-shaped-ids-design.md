# BUG-050: Release Instruments Silently Skip Sub-Shaped IDs

**Status:** APPROVED 2026-10-03. **Target:** `1.38.6`, patch. **Branch:** `fix/bug-050-sub-shaped-ids`.

## Problem

`tools/record-parity.mjs` and `tools/id-ceiling.mjs` silently skipped sub-shaped ids (e.g. `ARCH-008-S1`). Their regexes matched only top-level ids (`PREFIX-NNN`), causing sub-items to be invisible to both instruments.

## Solution

Both instruments now detect sub-shaped ids and report them with a named failure. The 3 historical `ARCH-008` sub-items are grandfathered.

### Acceptance Criteria

1. `id-ceiling.mjs` detects and reports sub-shaped ids.
2. `record-parity.mjs` detects and reports sub-shaped ids.
3. The 3 ARCH-008 sub-items are grandfathered and do not fail.
4. `repo-invariants.test.js` covers both instruments.

## Components Affected

- `tools/id-ceiling.mjs` — sub-shaped id detection
- `tools/record-parity.mjs` — sub-shaped id detection
- `tests/tools/id-ceiling.test.js` — new tests
- `tests/tools/record-parity.test.js` — new tests
- `tests/tools/repo-invariants.test.js` — updated assertions
