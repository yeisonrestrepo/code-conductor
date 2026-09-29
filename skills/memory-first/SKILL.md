---
name: memory-first
description: "Lookup chain enforced before any file read or search: project memory, grep/glob, targeted read — stop at the first step that answers"
type: skill
---

# Memory-First Protocol

Follow this lookup chain in strict order before reading any file, running any search, or spawning any tool. Stop at the first step that answers the question.

## Chain

### 1. Project Memory
Check `.claude/memory/project.md`.

Use the Grep tool to check project.md first:

```
Grep pattern="<keyword>" path=".claude/memory/project.md"
```

If Grep returns matches, use that information and stop. If no matches, proceed to step 2.

### 2. Grep / Glob
For pattern searches, use the `Grep` or `Glob` tools inline. Never read a full file to find a pattern.

### 3. Targeted Read
Last resort. Only when steps 1–2 cannot answer.
- Always specify `offset` and `limit`.
- Max 150 lines per call.
- Know approximately which lines to read before calling.

The `pre-tool-use` hook blocks `Read` calls on files >150 lines with no explicit `limit`. If blocked, return to step 1.
