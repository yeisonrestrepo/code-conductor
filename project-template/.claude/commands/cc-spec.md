---
description: "(Conductor) Define the problem and generate an approved spec"
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
