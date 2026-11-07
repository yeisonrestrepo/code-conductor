# Issue #93 Guard 1 Binary Reads — Design

**Status:** APPROVED 2026-10-24 (owner reviews in the PR)
**Issue:** #93 (backlog id assigned owner-side)

## Problem

`guard1LargeRead` (`.claude/hooks/pre-tool-use.mjs:82-96`) reads every regular file as UTF-8 and `countLines` counts `\n` characters. A binary has no lines, but any binary with more than 150 `0x0A` bytes is denied with `Guard 1: LARGE FILE READ BLOCKED`. Claude Code renders an image Read as an image, not as text tokens, so the denial protects nothing and forces a meaningless `limit: 1`. Reproduced in #93 on a 60,896-byte PNG with 199 `0x0A` bytes, and by a contract test against `main`.

## Solution

Guard 1 skips binary files, detected by a NUL-byte sniff of the first 8,000 bytes: the heuristic git uses (`buffer_is_binary`, `FIRST_FEW_BYTES`). The hook already reads the whole file, so the sniff is one `Buffer.indexOf(0)` over a subarray, with no extra I/O. Both hook copies (`.claude/hooks/` and `project-template/.claude/hooks/`) change identically.

Rejected alternative: an extension allowlist (`.png`, `.jpg`, …). It needs a list kept in step with Claude Code's renderers and misses every binary not on it; content sniffing needs no list.

## Behavior

### Main path

1. Read with no `limit` on a regular file: the hook reads it as a Buffer.
2. A NUL byte in the first 8,000 bytes, and no UTF-16 BOM (`FF FE` or `FE FF`) at the start: binary, allow (no decision written).
3. Otherwise: decode as UTF-8, count `\n`, deny above 150 as today.

### Alternative paths

- `limit` present, non-regular path, unreadable file: unchanged (allow).
- Text file with a NUL only past byte 8,000: still text, still denied above 150 lines.
- UTF-16 text with a BOM (PowerShell 5.1's `cmd > out.txt`): NULs throughout, but Claude Code reads it as text, so it is text here too and is denied above 150 lines. Its newline is still one `0x0A` byte, so the UTF-8 count is right.

### Error cases

- Read failure: unchanged, debug line and allow.

## Acceptance Criteria

- [ ] A no-limit Read of a PNG with more than 150 `0x0A` bytes is allowed (fails on `main`).
- [ ] A 200-line text file is still denied, including one whose first NUL sits past the sniff window.
- [ ] A 200-line UTF-16LE or UTF-16BE text file with a BOM is still denied.
- [ ] Every existing Guard 1 case passes unchanged.
- [ ] Both hook copies stay byte-identical.

## Out of Scope

- Guard 2's line count of a binary in its "FILE ALREADY EXISTS" prompt (an `ask`, never a denial; shows a meaningless number only).
- UTF-16 text with no BOM: it has NULs and nothing marks it as text, so it is treated as binary, as git treats it.
- A binary with an unknown extension that Claude Code would render as text now passes Guard 1 too. The sniff can't tell which binaries Claude Code renders; only the 150-line limit is lost for them.
- PDF handling via the Read `pages` parameter: a PDF without NUL in its first 8,000 bytes keeps today's behavior.
- Release records (VERSION, CHANGELOG, backlog flip).

## System Impact

- `.claude/hooks/pre-tool-use.mjs`, `project-template/.claude/hooks/pre-tool-use.mjs`
- `tests/hooks/pre-tool-use-contract.test.js` (four new cases)

## Complexity Estimate

**XS.** One helper and one guard clause in a mirrored file, plus two tests.
