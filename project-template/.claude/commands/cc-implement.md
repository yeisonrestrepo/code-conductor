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

Read `.claude/memory/project.md` and the active plan file before starting any task.

Execute one plan step at a time. Confirm between steps unless the developer explicitly says to proceed without confirmation.
