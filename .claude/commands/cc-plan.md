---
description: "(Conductor) Map implementation steps from an approved spec"
---

## Phase entry - Handoff enforcement

Before doing anything else, perform this blocking check:

1. Count the number of turns in the current conversation history.
2. If turn count exceeds 5, halt immediately and output:

   > "Phase boundary detected. Please execute /compact to clear history before proceeding."

   Do not start any plan tasks. Enter standby. Wait for the user to confirm `/compact` has been run before continuing.

3. If turn count ≤ 5 AND `.claude/memory/session-snapshot.md` exists, proceed to the Destructive Read Invariant below.
4. If turn count ≤ 5 AND `.claude/memory/session-snapshot.md` is absent, skip the Destructive Read Invariant and proceed directly - no snapshot context available (read-if-present fallback).

## Phase entry - Destructive Read Invariant

Applies only when snapshot exists (step 3 above).

1. Read `.claude/memory/session-snapshot.md` into context.
2. Delete the file immediately.
3. Use the snapshot contents as the starting context for this phase.

If the file cannot be deleted after reading, report the error and halt.

---

## Phase 0 — Skill activation

Before doing anything else, invoke both skills in order:

```
Skill({ skill: "writing-plans", args: "$ARGUMENTS" })
Skill({ skill: "critical-review" })
```

`writing-plans` structures the format and sequencing strategy. `critical-review` Phase 1 then runs the Pre-Flight Analysis on the implementation approach — surface failure points and boundary conditions before committing to an ordered step list. Do not generate steps until both have completed.

---

Require an approved spec before starting. If no spec is in `.claude/memory/project.md` or in the recent conversation, stop and say:
"No approved spec found. Run `/cc-spec [name]` first."

Read `.claude/memory/project.md` and this project's `CLAUDE.md` before doing anything else.

**Map the codebase structure** before reading any file content:
- List directories
- Identify files related to the spec using grep, not reads
- Note existing patterns to follow

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

Each step must include:
- Exact file path(s)
- Action (create / modify / delete)
- What changes and why
- Whether it has a dependency on a previous step

## Test List
- [ ] Unit tests for [unit]
- [ ] Integration test for [seam]
- [ ] E2E test if UI is affected

## Commit Order
[Which steps to group into commits]

## Identified Risks
[What could go wrong and how to catch it early]

---

Execute one step at a time. Confirm between steps unless the developer explicitly says to proceed without confirmation.

---

## Phase exit

Once the plan is approved and saved, instruct the user:

> "Plan complete. Run `/cc-compact` now before starting implementation."

Do not proceed to implementation without user confirmation that `/cc-compact` has been run.
