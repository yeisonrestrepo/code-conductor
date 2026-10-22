# BUG-057 Bounded Project Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Draft — awaiting operator approval (follows the spec's approval).

**Goal:** Every phase entry reads a bounded `## Current State` digest at the top of `project.md` instead of the whole file, at a constant cost whatever the project's age.

**Architecture:** Command text only. The readers (`cc-implement`, `cc-plan`, `cc-resume`, both mirrors) Read with `limit: 60` and Grep history for detail. The writers (`cc-spec` mirrors, global `cc-checkpoint`) keep their append and add surgical single-line Edits to the digest. `/cc-checkpoint` bootstraps the section once on files that lack it. Hooks, installer and stub are untouched.

**Tech Stack:** Markdown commands, vitest.

**Spec:** `docs/superpowers/specs/2026-10-22-bug057-bounded-project-memory-design.md`, Draft.

## Global Constraints

- The skeleton, terminator and caps are exactly as written in the spec's Solution block: `## Current State`, `- Active spec:`, `- Last checkpoint:`, `### Conventions`, `### Debt`, `<!-- end current state -->`; 40 lines, 12 bullets per list, 200 characters per line; reader limit `60`, fallback limit `40`.
- History stays append-only. `cc-checkpoint.md`'s "append only, never delete" sentence, its staging paragraph (`staging-convention.test.js:110,114`) and its DB-tail section stay byte-identical.
- Mirror pairs move together: `cc-resume` stays byte-identical, and `cc-plan`, `cc-implement` and `cc-spec` differ only in script-path nesting (`commands-parity.test.js`).
- `project-template/.claude/memory/project.md`, `.claude/memory/project.md`, every hook, `lib/installer/*`, `settings.json`, `VERSION`, package versions, `CHANGELOG.md` and the backlog do not change.
- No em-dashes in command text (stub convention). Use hyphens or colons.
- Staging is by explicit path: `git add -u <path>` for tracked files, plain `git add <path>` for a new file whose `.gitignore` leaf exists. Never bare `git add -u`.
- Tests run with `GH_TOKEN=invalid-test-token`, `GH_ENTERPRISE_TOKEN=` and `GH_CONFIG_DIR=<empty temp dir>` (BUG-059).

## Review Focus

1. **A reader on a file without the section:** the fallback is bounded (`limit: 40` plus two `offset` reads). Pinned by AC2's test.
2. **The post-compact hooks' unanchored `grep "## Checkpoint" | tail -1`:** digest field values carry no `## ` prefix and sit above all history. Pinned by the skeleton test (no field value starts with `## `).
3. **The 1.28/1.29 stub warning:** the stub must stay byte-identical. Pinned by AC7's hash test.
4. **The DB tail's `pr`:** still the verbatim appended `## Checkpoint` body, not the digest edits.

---

### Task 0: Commit the spec, this plan and their ignore leaves

**Files:**
- Modify: `.gitignore` (two leaves in sorted position: the plan after `!/docs/superpowers/plans/2026-10-21-bug061-hook-project-root.md`, the spec after `!/docs/superpowers/specs/2026-10-21-bug061-hook-project-root-design.md`)
- Create (stage): both docs

- [ ] [T-000-0] `git switch -c fix/bug-057-bounded-project-memory` from `main`.
- [ ] [T-000-A] Add both leaves to `.gitignore`.
- [ ] [T-000-B] `git add -u .gitignore`, then `git add -f` both docs in the same step, before any parity run (it reads `git ls-files`).
- [ ] [T-000-C] Run `tests/unit/gitignore-block-parity.test.js`. Expected: pass.
- [ ] [T-000-D] Commit `docs: spec and plan for bounded project memory [BUG-057]`.

### Task 1: Write the failing test file (AC1-AC7)

**Files:**
- Create: `tests/unit/bounded-project-memory.test.js`
- Modify: `.gitignore` only if `tests/` turns out to be under a deny block (it is not today)

Eight tests, each reading the command files as text:

- [ ] [T-001-A] `AC1`: for each of the six reader files, every sentence that names `.claude/memory/project.md` with the verb `Read` also contains `limit: 60` and the terminator `<!-- end current state -->`.
- [ ] [T-001-B] `AC2`: each of the six reader files contains `limit: 40` and `^## (Spec|Checkpoint)`.
- [ ] [T-001-C] `AC3`: both `cc-resume` mirrors name `## Current State` in Step 3 and no longer contain `## Active Conventions` or `## Technical Debt`.
- [ ] [T-001-D] `AC4a`: `cc-checkpoint.md` still contains `(append only, never delete)` and contains the skeleton block verbatim (fenced).
- [ ] [T-001-E] `AC4b`: `cc-checkpoint.md` states `40 lines`, `12 bullets`, `200 characters`, and names the one-time bootstrap insert.
- [ ] [T-001-F] `AC5`: both `cc-spec` mirrors contain the `- Active spec:` single-line replace after the `## Spec: [name] [YYYY-MM-DD]` append, and normalized for script nesting (the `NORM` used by `commands-parity.test.js`) the two mirrors are equal.
- [ ] [T-001-G] `AC6`: extract the fenced skeleton from `cc-checkpoint.md`, fill each list to 12 bullets of 200 characters, prepend the stub's 3-line intro. Expect at most 60 lines, at most 40 section lines, and no field value starting with `## `.
- [ ] [T-001-H] `AC7`: `project-template/.claude/memory/project.md` equals `git show b018793:project-template/.claude/memory/project.md`, compared as bytes with line endings normalized to LF (autocrlf, BUG-058).
- [ ] [T-001-I] Run the file. Expected: T-001-A..G red, T-001-H green.

### Task 2: Readers (AC1, AC2, AC3)

**Files:** `.claude/commands/cc-implement.md:42`, `cc-plan.md:55,58`, `cc-resume.md:38-47`, and the same lines in `project-template/.claude/commands/`.

- [ ] [T-002-A] `cc-implement.md:42` → `Read .claude/memory/project.md with limit: 60 and stop at <!-- end current state -->. For detail, Grep the heading its Active spec or Last checkpoint line names (-n) and Read that entry with offset and limit: 60. If the file has no ## Current State, Read with limit: 40, then Grep ^## (Spec|Checkpoint) with -n and Read the last match of each with offset and limit: 60.` Apply to both mirrors.
- [ ] [T-002-B] `cc-plan.md:55` → the spec check reads `Active spec:` (or the fallback's last `^## Spec:`). `:58` takes the T-002-A wording plus "and this project's `CLAUDE.md`". Both mirrors.
- [ ] [T-002-C] `cc-resume.md` Step 3: replace `:40-45` with the bounded read and extract `Last checkpoint` (Read its entry by offset, 3 bullets max), `### Conventions` and `### Debt` from `## Current State`. The fallback extracts the last checkpoint only. Copy the result to the template mirror byte-for-byte.
- [ ] [T-002-D] Run `commands-parity.test.js` and the new file. Expected: T-001-A, B, C green; parity at 50.

### Task 3: Writers (AC4, AC5, AC6)

**Files:** `global/commands/cc-checkpoint.md:13-15`, `.claude/commands/cc-spec.md:127-134`, `project-template/.claude/commands/cc-spec.md:127-134`.

- [ ] [T-003-A] `cc-checkpoint.md`: after the existing `:13-15` bullets, insert an `**Update ## Current State**` block. It carries the fenced skeleton, the caps, one Edit per field or bullet, removal of one superseded or resolved bullet per Edit when a list would exceed 12, and a one-time bootstrap insert directly after the intro when the section is absent. If the terminator is missing, report it and do not repair. `:13` and `:17` stay byte-identical.
- [ ] [T-003-B] Both `cc-spec` mirrors, after `:128`: `Then replace the single - Active spec: line in ## Current State with the new heading text, without its leading "## ". If the section is absent, skip it; /cc-checkpoint bootstraps it.`
- [ ] [T-003-C] Run the new file, `staging-convention.test.js`, `commands-parity.test.js` and `host-owned.test.js`. Expected: 8/8, 17 and 50 unchanged.
- [ ] [T-003-D] Commit `fix: bound the phase-entry read of project memory [BUG-057]`.

### Task 4: Wiki page

- [ ] [T-004-A] `.github/wiki/pages/Memory-Architecture.md`, `## /cc-checkpoint` section: one paragraph on `## Current State` (bounded digest at top, history append-only below, readers use `limit: 60`). Check the FEAT-043 sync test still passes.
- [ ] [T-004-B] Full suite with the gh isolation env. Expected: baseline + 8, with no new failures over the BUG-058 Windows baseline.
- [ ] [T-004-C] Commit `docs: describe the Current State digest [BUG-057]`.

## Test List

- [ ] Unit: `bounded-project-memory.test.js`, 8 tests (AC1-AC7).
- [ ] Integration: existing `commands-parity`, `staging-convention`, `host-owned`, `deploy` (stub warning) pass unchanged.
- [ ] E2E: none. Owner field check: `/cc-resume` on this repository before and after one `/cc-checkpoint`, comparing tool calls and bytes read.

## Commit Order

1. Task 0: spec, plan and `.gitignore` leaves (docs).
2. Tasks 1-3: test file, readers and writers in one green commit (fix). The pre-commit gate rejects a red intermediate.
3. Task 4: wiki paragraph (docs).

## Identified Risks

- **Model compliance:** the caps are prompt-enforced. A writer can overrun 12 bullets. The read stays bounded anyway, because readers stop at line 60 whatever the section holds.
- **Digest drift:** curation is judgment, so a bullet may linger after it is resolved. History stays authoritative ("the record wins", existing convention), and the digest is a pointer, not the record.
- **Team merges:** two branches editing the same digest line conflict on one line instead of hundreds. That is an improvement over C, but it is not zero.
- **Pre-commit gate on Windows:** the full suite has known Windows failures (BUG-058). Commits from Windows may need the owner's CI as the gate. Do not bypass the hook.
