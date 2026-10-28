# BUG-063 Guard 1 Binary Reads Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Update one checkbox per edit (BUG-003 invariant).

**Goal:** A no-limit Read of a binary file (an image) is never denied by Guard 1, while text files keep the 150-line limit.

**Architecture:** `guard1LargeRead` reads the file as a Buffer; a NUL byte in the first 8,000 bytes marks it binary and the guard allows. Otherwise the Buffer is decoded as UTF-8 and counted as today.

**Tech Stack:** Node (zero-dependency ESM hook), vitest.

**Spec:** `docs/superpowers/specs/2026-10-24-bug063-guard1-binary-reads-design.md`, APPROVED 2026-10-24.

## Global Constraints

- Sniff window 8,000 bytes (git's `FIRST_FEW_BYTES`); no extension list.
- Text behavior unchanged: every existing Guard 1 test passes.
- `project-template/.claude/hooks/pre-tool-use.mjs` stays byte-identical to `.claude/hooks/pre-tool-use.mjs`.
- No release records. Staging by explicit path; never bare `git add -u`; never bypass the pre-commit hook.

---

### Task 0: Spec, plan and their ignore leaves

- [X] [T-000-A] Write the spec and this plan.
- [X] [T-000-B] Add both `.gitignore` leaves in sorted position (BUG-042 toll).
- [X] [T-000-C] Append the `[BUG-063]` backlog entry after `[BUG-061]` and the `## Spec: BUG-063` entry to `.claude/memory/project.md`.
- [X] [T-000-D] Commit `docs: spec and plan for the Guard 1 binary skip [BUG-063]`.

### Task 1: Failing test

**Files:** Modify `tests/hooks/pre-tool-use-contract.test.js`

- [X] [T-001-A] Add: a PNG (signature + NUL-bearing IHDR length + 200 `0x0A`) Read with no limit allows; a text file with 200 newlines and its first NUL past byte 8,000 is denied.
- [X] [T-001-B] Run the file. Expected: the PNG case fails on the current hook; the rest pass.

### Task 2: Fix

**Files:** Modify `.claude/hooks/pre-tool-use.mjs`, `project-template/.claude/hooks/pre-tool-use.mjs`

- [X] [T-002-A] Add `isBinary(buffer)` (`buffer.subarray(0, 8000).indexOf(0) !== -1`); in `guard1LargeRead` read a Buffer, return `null` when binary, else count `buffer.toString('utf8')`.
- [X] [T-002-B] Copy to the template twin; run the contract and parity tests. Expected: all pass.
- [X] [T-002-C] Commit `fix: skip binary files in Guard 1 [BUG-063]`.

### Task 3: Verify and evidence (PR only, never committed)

- [X] [T-003-A] Full `npx vitest run` on the branch and on `main` under identical conditions; record both counts.
- [X] [T-003-B] Feed a Read of a real PNG to `main`'s hook and the branch hook; render the captures and the suite summaries to PNG with headless Edge.
- [ ] [T-003-C] Open the PR with `Closes #93` and the PNGs attached.
