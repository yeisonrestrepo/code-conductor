---
description: "(Conductor) Execute implementation tasks from an approved plan"
---

## Phase entry - Handoff enforcement

Before doing anything else, perform this blocking check:

1. Count the number of turns in the current conversation history.
2. If turn count exceeds 5, halt immediately and output:

   > "Phase boundary detected. Please execute /compact to clear history before proceeding."

   Do not start any implementation tasks. Enter standby. Wait for the user to confirm `/compact` has been run before continuing.

3. If turn count ≤ 5 AND `.claude/memory/session-snapshot.md` exists, proceed to the Destructive Read Invariant below.
4. If turn count ≤ 5 AND `.claude/memory/session-snapshot.md` is absent, skip the Destructive Read Invariant and proceed directly - no snapshot context available (read-if-present fallback).

## Phase entry - Destructive Read Invariant

Applies only when snapshot exists (step 3 above).

1. Read `.claude/memory/session-snapshot.md` into context.
2. Delete the file immediately.
3. Use the snapshot contents as the starting context for this phase.

If the file cannot be deleted after reading, report the error and halt.

---

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
| Verify drift >= 5 consecutive | Halt; `VERIFY_DRIFT_EXCEEDED` |
| Pre-flip uniqueness != 1 | Halt; duplicate ID report |
| Pre-flip Edit no-match < 3 (same task) | Return to Step 1 |
| Pre-flip Edit no-match >= 3 (same task) | Mark `[!]`, halt |
| Post-flip Edit no-match | Halt; manual resolution |
| Task execution failure | Mark `[>]` → `[!]`, halt |
| Hook write failure | Log warning, continue |
| `[>]` prerequisite | Halt; `PREREQUISITE_IN_PROGRESS`; report task ID |
| `DEPENDENCY_FAILED` | Halt; report failed prerequisite |
| `SCAN_LIMIT_EXCEEDED` | Halt; report blocked task list |

---

Confirm between tasks unless the developer explicitly says to proceed without confirmation.
