---
description: "(Conductor) Execute implementation tasks from an approved plan"
---

## Phase entry - Resume Read

Before doing anything else, restore any stored context for the current commit by running `.claude/scripts/resume-read.mjs`. It resolves the current git hash, prefers a valid DB snapshot (`conductor-db get-snapshot`), falls back to the `.claude/memory/session-snapshot.json` handoff file, and prints a `RESUME_HIT` block on a hit / nothing on a miss. Capture its stdout **and** its exit code with the canonical per-platform form (each first probes for `node` and treats its absence as a clean miss, never an error):

- **Unix / Git Bash:**
  ```sh
  if command -v node >/dev/null 2>&1; then
    resume_out="$(node .claude/scripts/resume-read.mjs 2>>.conductor/last-write.log)"; resume_rc=$?
  else resume_rc=3; resume_out=""; fi
  ```
- **PowerShell:**
  ```powershell
  if (Get-Command node -ErrorAction SilentlyContinue) {
    $__eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    if (Test-Path variable:PSNativeCommandUseErrorActionPreference) {
      $__nap = $PSNativeCommandUseErrorActionPreference; $PSNativeCommandUseErrorActionPreference = $false
    }
    try {
      $resume_out = node .claude/scripts/resume-read.mjs 2>> .conductor/last-write.log; $resume_rc = $LASTEXITCODE
    } catch { $resume_rc = 3; $resume_out = "" }
    finally {
      $ErrorActionPreference = $__eap
      if (Test-Path variable:__nap) { $PSNativeCommandUseErrorActionPreference = $__nap }
    }
  } else { $resume_rc = 3; $resume_out = "" }
  ```

Branch on `resume_rc` - **only `0` and `4` are meaningful; every other code proceeds fresh:**

- **`0`** → parse the captured block and adopt it as this phase's starting context, then echo one banner to the user: `> Resumed from stored snapshot @ <commit> (phase: <phase>)`, appending ` (checkpoint prose available)` when the block reports `prose: available`. Parsing (the command owns normalization): split on `\n`; strip a trailing `\r` from every line; drop leading/trailing wholly-blank lines; require `lines[0].trim() === 'RESUME_HIT'` (anything else = miss); `key: value` lines split on the first `': '` (both sides trimmed); the `pending:` block is every subsequent `^\s*-\s+` line up to the first blank line or EOF, each item trimmed. Unknown keys are ignored. In PowerShell, `node …` binds `string[]` for multi-line output - normalize with `$lines = @($resume_out)`; a `$null`/empty capture with `resume_rc = 3` is a miss.
- **`4`** → **operational halt.** Do not run this phase's normal work. Emit exactly: `SNAP_INVALID: corrupt handoff at .claude/memory/session-snapshot.json - inspect or remove it, then re-run.` and enter standby awaiting user action. The corrupt file is left on disk (the script did not delete it).
- **`3` or any other code** → **proceed fresh** (clean miss, bypass, degrade, absent `node`, or any unexpected runtime code). Ignore the capture.

`resume-read.mjs` writes its own trace lines to `.conductor/last-write.log` via `appendFileSync`; the `2>>` redirect above only sinks the incidental exit-4 halt reason away from the UI - it is not the trace channel.

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

Runs after both success (`[X]`) and failure (`[!]`) paths. Record the task's final state to the local cache, best-effort:

1. Probe `node --version`. If it is missing or below `22.5.0`, skip the cache write (the `node:sqlite` engine needs `>= 22.5`); the plan file remains authoritative.
2. Decide how to launch so that an unrecognized flag can never fatally abort Node at startup. Probe with throwaway children, in order:
   a. **No flag first:** run `node --no-warnings -e "require('node:sqlite')"`. Exit 0 means `node:sqlite` is stable on this Node — launch the recorder **without** `--experimental-sqlite`.
   b. **Flag second:** else run `node --experimental-sqlite --no-warnings -e "require('node:sqlite')"`. Exit 0 means the flag is needed and recognized — launch the recorder **with** `--experimental-sqlite --no-warnings`.
   c. **Neither:** else skip the cache write. Both a too-old Node and a future Node that removed/renamed the flag land here.

   Each probe is a disposable child; a non-zero exit — including a fatal `bad option: --experimental-sqlite` from a Node that does not recognize the flag — is caught and simply advances to the next branch. The fatal startup error is therefore always contained inside a probe whose failure is expected; it never propagates and never aborts the hook.
3. Launch the chosen form, from the repo root, with the active plan file path, the task ID, and the just-written state character (`X` or `!`):

   `node <chosen-flags> .claude/scripts/conductor-db.mjs record "<plan_file>" "<task_id>" "<state>"`

   All three arguments **must** be wrapped in double quotes exactly as shown. A repository path can contain spaces (e.g. `/Users/me/My Projects/repo/docs/plan.md`); unquoted, the shell word-splits it into several argv entries and the recorder sees `!== 3` positionals, silently rejecting a legitimate write. `--no-warnings` (in both probe and launch) suppresses Node's `ExperimentalWarning: SQLite is an experimental feature` line so it never pollutes hook stderr; it does not affect the recorder's own `CONDUCTOR_DB:` diagnostics (those are direct `process.stderr` writes, not process warnings).

   The recorder self-initializes `.conductor/cache.db`, upserts the row, and exits 0 on every path. If the launch fails for any reason (permission error, unexpected abort), it is non-fatal: log a warning and continue. The plan file is the authoritative state record.

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
