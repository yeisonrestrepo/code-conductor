---
description: "(Conductor) Serialize phase state and prompt for context compaction"
---

Run `git rev-parse HEAD` to get the current commit SHA.

Collect the following from the current conversation context:
- **Phase:** the phase that just completed (spec | plan | implement | review)
- **Decisions:** finalized decisions made this phase (max 10, one line each)
- **Pending:** the next immediate step(s)
- **Files Touched:** files created, modified, or deleted this phase
- **Constraints:** hard constraints the next phase must respect (max 5)
- **Spec Reference:** path to the active spec file in `docs/superpowers/specs/`

Write `.claude/memory/session-snapshot.md` with this exact schema:

~~~markdown
# Session Snapshot
**Phase:** [spec | plan | implement | review]
**Commit:** <SHA-1>

## Decisions
- <one line per finalized decision, max 10>

## Pending
- <next immediate step>
- <step after that, if known>

## Files Touched
- `path/to/file` - <created | modified | deleted>

## Constraints
- <hard constraints the next phase must respect, max 5>

## Spec Reference
`docs/superpowers/specs/<filename>.md`
~~~

Keep the snapshot under 300 tokens. No freeform prose - only facts the next phase can act on.

If writing the snapshot fails (e.g., missing `.claude/memory/` directory), report the error and stop. Do NOT output the compact prompt.

Once the snapshot is written successfully, output exactly:

> Snapshot written. Run `/compact` now to clear history.
