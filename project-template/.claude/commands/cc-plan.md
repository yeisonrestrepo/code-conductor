---
description: "(Conductor) Map implementation steps from an approved spec"
---

Require an approved spec before starting. If no spec is in `.claude/memory/project.md` or in the recent conversation, stop and say:
"No approved spec found. Run `/cc-spec [name]` first."

Read `.claude/memory/project.md` and this project's `CLAUDE.md` before doing anything else.

**Map the codebase structure** before reading any file content:
- List directories
- Identify files related to the spec using grep, not reads
- Note existing patterns to follow

**Generate a plan with:**

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
