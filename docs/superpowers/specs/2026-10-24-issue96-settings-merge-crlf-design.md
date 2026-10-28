# Issue #96 Settings Merge CRLF Idempotence — Design

**Status:** PROPOSED 2026-10-24 (owner reviews in the PR)
**Issue:** #96 (backlog id assigned owner-side)

## Problem

`mergeSettingsFile` (`lib/installer/settings-merge.mjs`) skips a write only when the serialized merge equals the host file byte for byte (`:115`). The serializer always emits LF. A fresh install copies the template verbatim (`:82`), so a CRLF template (a Windows checkout with `core.autocrlf=true`) yields a CRLF `settings.json`. The second, unchanged run compares LF text to CRLF bytes, reports `merged`, and rewrites the file to LF with a new hash and mtime. The third run settles. The same spurious rewrite hits any host file an editor saved with CRLF.

## Solution

Normalize the host's line endings before the comparison: `text === raw.replace(/\r\n/g, '\n')`. A file whose only difference is CRLF is reported `unchanged` and left untouched, CRLF included.

Rejected alternative: write LF on the fresh-install branch. It fixes only the installer-created case and still rewrites a user's CRLF file once.

## Behavior

- CRLF template, run 1: `created`, template verbatim (unchanged behavior).
- CRLF template, run 2 with unchanged input: `unchanged`, file byte-identical.
- CRLF host equal to the merge after normalizing: `unchanged`, CRLF kept.
- CRLF host that needs a real merge: `merged`, written as LF (unchanged behavior; the serializer owns the format of a file it rewrites).
- LF hosts and every host-owned key: unchanged behavior.

## Acceptance Criteria

- [ ] Second run against a CRLF template returns `unchanged` and the bytes do not change.
- [ ] A CRLF host that the merge would not change returns `unchanged` and keeps its bytes.
- [ ] Every existing settings-merge and deploy test passes unchanged.

## Out of Scope

- Preserving CRLF when a real merge rewrites the file (`settings-merge.mjs:118`). When the merge changes content, the file is written with LF, so a user's CRLF is not kept. This is not a regression: `main` writes LF on every merge too, and this fix only stops the rewrite when nothing but line endings differ.
- Other formatting differences (indent, key order) that already cause a one-time rewrite.
- Release records (VERSION, CHANGELOG, backlog flip).

## System Impact

- `lib/installer/settings-merge.mjs` (one comparison)
- `tests/installer/settings-merge.test.js` (two cases)

## Complexity Estimate

**XS.** One line plus two tests.
