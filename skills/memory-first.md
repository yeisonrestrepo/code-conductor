# Memory-First Protocol

Follow this lookup chain in strict order before reading any file, running any search, or spawning any tool. Stop at the first step that answers the question.

## Chain

### 1. Project Memory
Check `.claude/memory/project.md` and the `claude-mem` index.

Use Grep on project.md first:
```
Grep "<keyword>" ".claude/memory/project.md"
```

If the answer is there, use it. Do not proceed to step 2.

### 2. Graphify Graph
For structural or relational questions, query the code graph.

**Use when asking:**
- "What calls function X?"
- "What does module Y depend on?"
- "Where is interface Z implemented?"
- "What is the path between component A and B?"

```bash
graphify query "<your question>"
```

Skip this step if `graphify` is not installed or returns an error. Fall through to step 3.

**Do not use for:** literal string patterns, variable names, import statements.

### 3. Grep / Glob
For pattern searches, use the `Grep` or `Glob` tools inline. Never read a full file to find a pattern.

### 4. Targeted Read
Last resort. Only when steps 1–3 cannot answer.
- Always specify `offset` and `limit`.
- Max 150 lines per call.
- Know approximately which lines to read before calling.

The `pre-tool-use` hook blocks `Read` calls on files >150 lines with no explicit `limit`. If blocked, return to step 1.
