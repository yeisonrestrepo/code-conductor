# BUG-045: Guard 3 Allowlist Fails on Quoted Paths

**Status:** APPROVED 2026-10-03. **Target:** `1.38.7`, patch. **Branch:** `fix/bug-045-guard3-quoted-paths`.

## Problem

Guard 3's allowlist matcher used boundary sets (`G3_BD`, `G3_AD`) that did not include quote characters. When a shell command quoted a path (e.g. `cat "docs/x.md"`), the allowlist regex failed to match, causing false denials.

## Solution

Added `"` and `'` to both `G3_BD` and `G3_AD` boundary sets in the hook, its mirror, and the authority reference. Added 6 corpus rows covering quoted paths.

### Acceptance Criteria

1. Quoted paths in allowlisted commands are correctly matched.
2. Both the hook mirror pair and the authority reference carry the fix.
3. Corpus rows cover single-quoted, double-quoted, and unquoted paths.

## Components Affected

- `.claude/hooks/pre-tool-use.mjs` — boundary set update
- `project-template/.claude/hooks/pre-tool-use.mjs` — mirror
- `tests/fixtures/guard3-reference.sh` — authority boundary set
- `tests/fixtures/guard3-corpus.js` — 6 new rows
- `tests/hooks/guard3.test.js` — corpus count assertion
