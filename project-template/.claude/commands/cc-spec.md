---
description: "(Conductor) Define the problem and generate an approved spec"
---

## Phase entry - Destructive Read Invariant

If `.claude/memory/session-snapshot.md` exists:
1. Read its full contents into context.
2. Delete the file immediately.
3. Use the snapshot contents as the starting context for this phase.

If the file cannot be deleted after reading, report the error and halt.

---

## Phase 0 — Skill activation

Before doing anything else, invoke both skills in order:

```
Skill({ skill: "brainstorming", args: "$ARGUMENTS" })
Skill({ skill: "critical-review" })
```

`brainstorming` explores the problem space and surfaces unknowns. `critical-review` Phase 1 then runs the Pre-Flight Analysis (Happy Path / Failure Points / Boundary Conditions) on the proposed solution before the spec is written. Do not write the spec until both have completed.

---

Search the codebase for existing code related to `$ARGUMENTS` before asking any questions.

Run: `grep -r "$ARGUMENTS" src/ --include="*.{ts,js,py,java,go,rs}" -l 2>/dev/null | head -20`

Then ask only for missing context. You need to understand:
1. **Problem** — what is broken or missing?
2. **User** — who is affected and what do they expect?
3. **Constraints** — performance, security, backward compatibility?
4. **Similar features** — anything in the codebase to stay consistent with?

Generate a spec with these sections:

## Problem
[What is broken or missing, from the user's perspective]

## Solution
[What will be built, one paragraph]

## Behavior

### Main path
[Step-by-step: what happens in the happy path]

### Alternative paths
[Edge cases the user might hit]

### Error cases
[What happens when things go wrong]

## Acceptance Criteria
- [ ] [Testable criterion]
- [ ] [Testable criterion]

## Out of Scope
[Explicitly list what this spec does NOT cover]

## System Impact
[What existing code will be affected or needs to be reviewed]

## Complexity Estimate
[S / M / L — with one sentence justification]

---

Wait for explicit approval before proceeding to `/cc-plan`.

Once approved, append a summary to `.claude/memory/project.md` under:
`## Spec: [name] [YYYY-MM-DD]`

---

## Phase exit

Once the spec is approved and the summary has been appended to `.claude/memory/project.md`, instruct the user:

> "Spec complete. Run `/cc-compact` now before starting `/cc-plan`."

Do not proceed to plan phase without user confirmation that `/cc-compact` has been run.
