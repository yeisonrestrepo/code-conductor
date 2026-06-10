# BUG-003: Surgical Plan State Updates — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the full-file read/write loop in `cc-implement.md` with a 5-step surgical ritual; mandate unique task IDs in `cc-plan.md`; extend `cc-resume.md` to surface `[>]` and `[!]` markers.

**Architecture:** Prompt-only insertions into six command files (`.claude` + `project-template` mirrors for `cc-implement.md`, `cc-plan.md`, `cc-resume.md`). No new infrastructure, no dependencies. Each pair of changes is identical; the mirror is applied immediately after each primary file is updated.

**Tech Stack:** Markdown command files only — no code, no tests, no build step.

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `.claude/commands/cc-implement.md` | Modify | Replace 2-line execution stub with 5-step surgical ritual |
| `project-template/.claude/commands/cc-implement.md` | Modify | Identical mirror of above |
| `.claude/commands/cc-plan.md` | Modify | Add Task ID Requirements section to plan generation rules |
| `project-template/.claude/commands/cc-plan.md` | Modify | Identical mirror of above |
| `.claude/commands/cc-resume.md` | Modify | Add Step 6a (scan plan for `[>]`/`[!]`) and update Step 9 report |
| `project-template/.claude/commands/cc-resume.md` | Modify | Identical mirror of above |
| `AGENT-READABLE BACKLOG.md` | Modify | Mark BUG-003 `[X]` |
| `.claude/memory/project.md` | Modify | Append checkpoint |
| `docs/superpowers/plans/2026-06-10-bug003-surgical-plan-state.md` | Create | This plan document (staged in T-009) |

---

## Task 1: Surgical ritual — cc-implement.md

**Files:** Modify `.claude/commands/cc-implement.md`

- [ ] [T-001] Pre-check: grep the file and confirm the target string appears exactly once before editing.

  Run `Grep` with:
  - `pattern`: `Execute one plan step at a time`
  - `path`: `.claude/commands/cc-implement.md`
  - `output_mode`: `count`

  Expected count: 1. If count ≠ 1, halt and report.

- [ ] [T-001-A] Apply the Edit: replace the two-line execution stub (lines 31–33) with the full surgical ritual.

  **old_string** (exact, including blank line separator):
  ```
  Read `.claude/memory/project.md` and the active plan file before starting any task.
  
  Execute one plan step at a time. Confirm between steps unless the developer explicitly says to proceed without confirmation.
  ```

  **new_string**:
  ```
  Read `.claude/memory/project.md` before starting any task.
  
  ## Surgical Plan State Ritual
  
  Execute all plan tasks using the 5-step surgical ritual below. **Do not read the full plan file.**
  
  ### Checkbox State Protocol
  
  | Symbol | Meaning |
  |--------|---------|
  | `[ ]` | Pending |
  | `[>]` | In-progress (pre-flipped before execution begins) |
  | `[X]` | Complete |
  | `[!]` | Failed; halt immediately |
  
  The Grep locator targets only `[ ]` states. `[>]`, `[X]`, and `[!]` are invisible to the locator.
  
  ### String Rules
  
  **Comparison normalization** (Steps 2 and 3 — used only to decide if strings match, never as `old_string`):
  1. Strip leading/trailing ASCII whitespace (space, tab)
  2. Strip `\r`
  3. Strip Unicode invisible characters: `​`, `﻿`, `‌`, `‍`
  
  **`old_string` construction** (Steps 3 and 5 — the actual string passed to `Edit`):
  - Take the Read result verbatim; strip trailing whitespace and `\r` only
  - Preserve all leading whitespace (indentation)
  - Do NOT strip Unicode invisibles
  
  ### Step 1: Locate
  
  Run `Grep` with:
  - `pattern`: `\[ \] \[T-\d{3,}(-[A-Z0-9]+)*\]`
  - `path`: active plan file path (resolved from session context; never the workspace root)
  - `head_limit: 20`
  - `offset`: total results examined so far in this scan loop (starts at 0)
  
  **Fallback**: if `offset` is unsupported, replace the loop with a single `head_limit: 200` Grep.
  
  **Unicode note**: the pattern assumes clean ASCII `[ ]` (U+0020 space only between brackets). Task lines with Unicode invisible characters within the checkbox brackets will not be matched; this condition is prevented by the ASCII-only generation rule in `cc-plan.md` (Task 3).
  
  From the returned batch, apply dependency evaluation:
  - **Eligible**: all declared prerequisites carry `[X]`
  - **Transiently blocked** (`[ ]` prerequisite): skip; advance offset and re-run Grep
  - **Stalled** (`[>]` prerequisite): halt with `PREREQUISITE_IN_PROGRESS`; report the in-progress task ID; do not skip to unrelated tasks
  - **Permanently blocked** (`[!]` prerequisite): halt with `DEPENDENCY_FAILED`; report the failed prerequisite ID
  
  **Scan loop cap**: 10 Grep iterations maximum (<=200 tasks). If the cap is reached with no eligible task, halt with `SCAN_LIMIT_EXCEEDED`; list all blocked tasks and their unmet dependencies.
  
  If Grep returns no `[ ]` matches and `offset = 0`: output a completion summary and stop. If Grep returns no `[ ]` matches and `offset > 0`: halt with `SCAN_LIMIT_EXCEEDED`; all pending tasks are blocked (do not output a completion summary).
  
  ### Step 2: Verify
  
  `Read` the active plan file with `offset: N-1, limit: 1` (N = 1-based line number from Step 1).
  
  Apply Comparison Normalization to both the Read result and the Grep match:
  - Normalized match → proceed to Step 3 using the Read result for `old_string` construction
  - Normalized mismatch → line drift; discard N and return to Step 1
  
  **Drift cap**: after 5 consecutive drift mismatches, halt with `VERIFY_DRIFT_EXCEEDED`.
  
  ### Step 3: Pre-flip
  
  Assert uniqueness: run `Grep` for the exact task ID — for task `[T-001-A]`, use pattern `\[T-001-A\]` (the closing `\]` prevents sub-task prefix matches without requiring PCRE2). Scope to the active plan file. Confirm match count = 1. If count ≠ 1, halt and report the ID for manual resolution.
  
  Construct `old_string` using the `old_string` construction rule. Use `Edit` to replace `[ ]` with `[>]`.
  
  **Pre-flip retry cap**: if `Edit` reports `old_string` not found, return to Step 1. After 3 consecutive failures on the same task ID: run `Grep` for the task ID pattern scoped to the active plan file → `Read` the matched line (`offset: N-1, limit: 1`) → construct `old_string` from the Read result verbatim (trailing whitespace and `\r` stripped, regardless of current checkbox state) → construct `new_string` by replacing only the **first** `[_]` pattern (where `_` is any single character) with `[!]`, preserving all other brackets in the line → apply `Edit`. Then halt with a pre-flip failure report.
  
  ### Step 4: Execute
  
  Carry out the task described on that line.
  
  ### Step 5: Post-flip
  
  Construct `old_string` from the pre-flip line with `[ ]` replaced by `[>]` (the state after Step 3). Apply the `old_string` construction rule. Use `Edit` to replace:
  - `[>]` → `[X]` on success
  - `[>]` → `[!]` on failure
  
  On `[!]`: proceed to Step 6 to record the failure state, then halt with a failure report. Post-flip Edit no-match (unexpected `[>]` absence) → halt immediately for manual resolution; do not proceed to Step 6.
  
  ### Step 6: Hook
  
  Runs after both success (`[X]`) and failure (`[!]`) paths. If `.conductor/cache.db` exists, attempt to record task ID + final state + timestamp. If the write fails for any reason, log a non-fatal warning and continue. The plan file is the authoritative state record.
  
  After the hook: if the task state is `[!]`, halt with the failure report from Step 5.
  
  ### Repeat from Step 1.
  
  ### Error Reference
  
  | Condition | Action |
  |-----------|--------|
  | Verify drift < 5 | Discard line, return to Step 1 |
  | Verify drift ≥ 5 consecutive | Halt; `VERIFY_DRIFT_EXCEEDED` |
  | Pre-flip uniqueness ≠ 1 | Halt; duplicate ID report |
  | Pre-flip Edit no-match < 3 (same task) | Return to Step 1 |
  | Pre-flip Edit no-match ≥ 3 (same task) | Mark `[!]`, halt |
  | Post-flip Edit no-match | Halt; manual resolution |
  | Task execution failure | Mark `[>]` → `[!]`, halt |
  | Hook write failure | Log warning, continue |
  | `[>]` prerequisite | Halt; `PREREQUISITE_IN_PROGRESS`; report task ID |
  | `DEPENDENCY_FAILED` | Halt; report failed prerequisite |
  | `SCAN_LIMIT_EXCEEDED` | Halt; report blocked task list |
  
  ---
  
  Confirm between tasks unless the developer explicitly says to proceed without confirmation.
  ```

- [ ] [T-001-B] Verify: read lines 31–40 of `.claude/commands/cc-implement.md` and confirm the ritual header "Surgical Plan State Ritual" is present.

  Run `Read` with `offset: 30, limit: 10`. Confirm line 32 contains `## Surgical Plan State Ritual`.

---

## Task 2: Surgical ritual — project-template mirror

**Files:** Modify `project-template/.claude/commands/cc-implement.md`
**Depends on:** Task 1 complete.

- [ ] [T-002] Pre-check: confirm the target string appears exactly once.

  Run `Grep` with:
  - `pattern`: `Execute one plan step at a time`
  - `path`: `project-template/.claude/commands/cc-implement.md`
  - `output_mode`: `count`

  Expected count: 1.

- [ ] [T-002-A] Apply the identical Edit as T-001-A — same `old_string`, same `new_string` — to `project-template/.claude/commands/cc-implement.md`.

- [ ] [T-002-B] Verify: read lines 31–40 of `project-template/.claude/commands/cc-implement.md` and confirm "Surgical Plan State Ritual" is present.

- [ ] [T-002-C] Diff-check: confirm `.claude/commands/cc-implement.md` and `project-template/.claude/commands/cc-implement.md` are identical after line 1 (frontmatter description may differ).

  Run: `git diff --no-index .claude/commands/cc-implement.md project-template/.claude/commands/cc-implement.md`

  Expected: no diff output (or only the frontmatter description line if it differs).

---

## Task 3: Task ID mandate — cc-plan.md

**Files:** Modify `.claude/commands/cc-plan.md`

- [ ] [T-003] Pre-check: confirm the target insertion anchor appears exactly once.

  Run `Grep` with:
  - `pattern`: `\*\*Generate a plan with:\*\*`
  - `path`: `.claude/commands/cc-plan.md`
  - `output_mode`: `count`

  Expected count: 1.

- [ ] [T-003-A] Apply the Edit: insert the Task ID Requirements section between the "Map codebase structure" block and "Generate a plan with:".

  **old_string**:
  ```
  **Generate a plan with:**
  
  ## Ordered Steps
  ```

  **new_string**:
  ```
  **Generate a plan with:**
  
  ## Task ID Requirements
  
  Every task checkbox line must carry a unique alphanumeric ID:
  
      - [ ] [T-001] Top-level task
      - [ ] [T-001-A] Sub-task A
      - [ ] [T-001-A-1] Sub-sub-task
      - [ ] [T-002] Next top-level task
  
  Rules:
  - Minimum 3 digits (`T-001`); no upper bound (`T-1000` is valid)
  - Suffix depth is unlimited: `T-NNN(-[A-Z0-9]+)*`
  - IDs must be unique within the file; verify before saving; no two tasks may share the same ID
  - Generated checkbox lines must use plain ASCII `[ ]` (U+0020 space only between brackets); no Unicode invisible characters
  - Apply to all generated task lines only; do not add IDs retroactively to existing plan files
  
  ## Ordered Steps
  ```

- [ ] [T-003-B] Verify: run `Grep` for `Task ID Requirements` in `.claude/commands/cc-plan.md`. Expected count: 1.

---

## Task 4: Task ID mandate — project-template mirror

**Files:** Modify `project-template/.claude/commands/cc-plan.md`
**Depends on:** Task 3 complete.

- [ ] [T-004] Pre-check: confirm anchor appears exactly once in the mirror file.

  Run `Grep` with:
  - `pattern`: `\*\*Generate a plan with:\*\*`
  - `path`: `project-template/.claude/commands/cc-plan.md`
  - `output_mode`: `count`

  Expected count: 1.

- [ ] [T-004-A] Apply the identical Edit as T-003-A to `project-template/.claude/commands/cc-plan.md`.

- [ ] [T-004-B] Verify: run `Grep` for `Task ID Requirements` in `project-template/.claude/commands/cc-plan.md`. Expected count: 1.

- [ ] [T-004-C] Diff-check: confirm `.claude/commands/cc-plan.md` and `project-template/.claude/commands/cc-plan.md` are identical after line 1.

  Run: `git diff --no-index .claude/commands/cc-plan.md project-template/.claude/commands/cc-plan.md`

  Expected: no diff output.

---

## Task 5: Active-state markers — cc-resume.md

**Files:** Modify `.claude/commands/cc-resume.md`

- [ ] [T-005] Pre-check: confirm the Step 6 / Step 7 boundary anchor appears exactly once.

  Run `Grep` with:
  - `pattern`: `## Step 7 — Read git state`
  - `path`: `.claude/commands/cc-resume.md`
  - `output_mode`: `count`

  Expected count: 1.

- [ ] [T-005-A] Apply the Edit: insert Step 6a between Step 6 and Step 7.

  **old_string**:
  ```
  ## Step 7 — Read git state
  ```

  **new_string**:
  ```
  ## Step 6a: Scan active plan for in-progress and failed tasks
  
  If a plan file was found in Step 6, scan it for active-state markers:
  
  Run `Grep` with:
  - `pattern`: `\[>\]|\[!\]`
  - `path`: the plan file path found in Step 6
  - `output_mode`: `content`
  
  Collect results:
  - Lines containing `[>]` are **in-progress tasks** (execution interrupted mid-flight)
  - Lines containing `[!]` are **failed tasks** (execution halted; manual resolution required)
  
  Extract the task ID (e.g. `[T-001-A]`) from each matching line. Store counts and IDs for the report.
  
  If no `[>]` or `[!]` lines are found, skip these fields in the report.
  
  ## Step 7 — Read git state
  ```

- [ ] [T-005-B] Apply the Edit: extend the Step 9 Active Work block to include in-progress and failed task lines.

  **old_string** (within the Step 9 report template):
  ```
  ### Active Work
  Spec:  [spec filename] — [spec title]
  Plan:  [plan filename] — [plan title]
  ```

  **new_string**:
  ```
  ### Active Work
  Spec:  [spec filename] — [spec title]
  Plan:  [plan filename] — [plan title]
  In-progress: [count] task(s) - [task IDs]   (include only if [>] tasks were found in Step 6a)
  Failed:      [count] task(s) - [task IDs]   (include only if [!] tasks were found in Step 6a)
  ```

- [ ] [T-005-C] Verify: run `Grep` for `Step 6a` in `.claude/commands/cc-resume.md`. Expected count: 1.

---

## Task 6: Active-state markers — project-template mirror

**Files:** Modify `project-template/.claude/commands/cc-resume.md`
**Depends on:** Task 5 complete.

- [ ] [T-006] Pre-check: confirm the Step 7 anchor appears exactly once in the mirror file.

  Run `Grep` with:
  - `pattern`: `## Step 7 — Read git state`
  - `path`: `project-template/.claude/commands/cc-resume.md`
  - `output_mode`: `count`

  Expected count: 1.

- [ ] [T-006-A] Apply the identical Edit as T-005-A to `project-template/.claude/commands/cc-resume.md`.

- [ ] [T-006-B] Apply the identical Edit as T-005-B to `project-template/.claude/commands/cc-resume.md`.

- [ ] [T-006-C] Verify: run `Grep` for `Step 6a` in `project-template/.claude/commands/cc-resume.md`. Expected count: 1.

- [ ] [T-006-D] Diff-check: confirm `.claude/commands/cc-resume.md` and `project-template/.claude/commands/cc-resume.md` are identical after line 1.

  Run: `git diff --no-index .claude/commands/cc-resume.md project-template/.claude/commands/cc-resume.md`

  Expected: no diff output.

---

## Task 7: Mark BUG-003 complete in backlog

**Files:** Modify `AGENT-READABLE BACKLOG.md`

- [ ] [T-007] Pre-check: locate the BUG-003 line and confirm it appears exactly once with a pending checkbox.

  Run `Grep` with:
  - `pattern`: `\[BUG-003\]`
  - `path`: `AGENT-READABLE BACKLOG.md`
  - `output_mode`: `content`

  Expected: exactly one matching line containing `[ ]`. Note the 1-based line number (N). If the line does not contain `[ ]` or count ≠ 1, halt and report.

- [ ] [T-007-A] Read the BUG-003 line to obtain the exact current text.

  Run `Read` with `offset: N-1, limit: 1`. Use the Read result verbatim (trailing whitespace and `\r` stripped) as `old_string`. Construct `new_string` by replacing only the **first occurrence** of `[ ]` with `[X]` in the line (the checkbox always precedes the task ID; do not replace any `[ ]` that may appear in the description text). Apply `Edit`.

- [ ] [T-007-B] Verify: run `Grep` for `\[X\] \x60\[BUG-003\]\x60` in `AGENT-READABLE BACKLOG.md`. Expected count: 1.

---

## Task 8: Append checkpoint to project.md

**Files:** Modify `.claude/memory/project.md`

- [ ] [T-008] Append a checkpoint block to `.claude/memory/project.md` documenting BUG-003 completion.

  Append after the last existing content:

  ```
  ## Checkpoint 2026-06-10 (BUG-003)
  
  ### Decisions
  - BUG-003 implemented: surgical 5-step plan-state ritual in cc-implement.md
  - Task IDs `[T-NNN+]` mandated in cc-plan.md at generation time
  - cc-resume.md extended to surface `[>]` and `[!]` markers in session report
  - All six command files updated (`.claude` + `project-template` mirrors)
  - Hook (Step 6) is a no-op conditional on `.conductor/cache.db`
  
  ### Conventions
  - Plans must include `[T-NNN]` IDs on every task checkbox line
  - 4-state checkbox protocol: `[ ]` pending, `[>]` in-progress, `[X]` complete, `[!]` failed
  - Pre-flip uniqueness: Grep with `\[T-NNN\]` (plain pattern, no PCRE2); count must equal 1 before any Edit
  
  ### Technical Debt
  - SQLite hook in cc-implement.md Step 6 is a no-op until FEAT-005 is implemented
  ```

---

## Task 9: Commit

**Files:** All modified above.

- [ ] [T-009] Stage all modified files and commit.

  ```bash
  git add .claude/commands/cc-implement.md \
          project-template/.claude/commands/cc-implement.md \
          .claude/commands/cc-plan.md \
          project-template/.claude/commands/cc-plan.md \
          .claude/commands/cc-resume.md \
          project-template/.claude/commands/cc-resume.md \
          "AGENT-READABLE BACKLOG.md" \
          .claude/memory/project.md \
          docs/superpowers/plans/2026-06-10-bug003-surgical-plan-state.md
  ```

  Commit message:
  ```
  feat(cc-implement): surgical 5-step plan-state ritual (BUG-003)

  Replace full-file read/write loop with grep-locate → verify → pre-flip
  → execute → post-flip protocol. Add [T-NNN] task ID mandate to cc-plan.
  Extend cc-resume to surface [>]/[!] markers on session restore.

  Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
  ```

---

## Test List

These are prompt-only changes. Verification is structural, not executable.

- [ ] T-AC-1: `cc-implement.md` contains "Surgical Plan State Ritual" and no instruction to "read the active plan file" — grep both conditions
- [ ] T-AC-2: `cc-plan.md` contains "Task ID Requirements" section with `T-NNN(-[A-Z0-9]+)*` pattern and uniqueness rule
- [ ] T-AC-3: All six command files updated — grep "Surgical Plan State Ritual" in cc-implement files; "Task ID Requirements" in cc-plan files; "Step 6a" in cc-resume files
- [ ] T-AC-4: Grep pattern `\[ \] \[T-\d{3,}(-[A-Z0-9]+)*\]`, `head_limit: 20`, `offset`-based loop, 10-iteration cap, and fallback all present in cc-implement.md
- [ ] T-AC-5: "Comparison normalization" and "`old_string` construction" appear as distinct named sections in cc-implement.md
- [ ] T-AC-6: `DEPENDENCY_FAILED` (for `[!]`), `PREREQUISITE_IN_PROGRESS` (for `[>]`), and transient block (`[ ]` only) are all present in cc-implement.md
- [ ] T-AC-7: `VERIFY_DRIFT_EXCEEDED` and "5 consecutive" appear together in cc-implement.md
- [ ] T-AC-8: Pre-flip uniqueness uses plain `\[T-NNN\]` pattern (closing bracket as sub-task discriminator, no PCRE2 lookahead) in cc-implement.md
- [ ] T-AC-9: "3 consecutive failures" and `[!]` mark appear together in pre-flip retry cap section
- [ ] T-AC-10: Post-flip section references `[>]`-state line (not `[ ]`-state line) for `old_string` construction
- [ ] T-AC-11: `[!]` state triggers "halt immediately" — present in post-flip section
- [ ] T-AC-12: "non-fatal warning" and "continue" appear together in hook step
- [ ] T-AC-13: `cc-resume.md` contains Step 6a with `[>]` and `[!]` parsing
- [ ] T-AC-14: Hook step references `.conductor/cache.db` as existence check

---

## Commit Order

All nine tasks commit together in T-009 — the changes are tightly coupled (all six files must be consistent, backlog and project.md finalize the feature). No intermediate commits needed.

---

## Identified Risks

1. **old_string mismatch due to trailing whitespace** — the `old_string` in each task above must exactly match the current file content. Steps T-001 through T-006 each begin with a pre-check grep; if the grep returns count ≠ 1, stop and inspect before editing.

2. **Backlog checkbox format** — T-007 uses Grep content output to locate the exact BUG-003 line before editing; T-007-A derives `old_string` from a Read of that line. If the Grep returns no match or the line does not contain `[ ]`, halt before attempting the edit.
