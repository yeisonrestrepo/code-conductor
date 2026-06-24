# Agent Delegation

Keep the main context clean. Raw file contents, grep output, and intermediate data never enter the main context. Sub-agents process data and return summaries only.

## When to Spawn

### Explore Sub-Agent
**Condition:** Task requires reading 3+ files to answer one question, or codebase exploration precedes implementation.

```javascript
// Use the Agent tool with these parameters:
Agent({
  subagent_type: "Explore",
  description: "<10-word description of the lookup>",
  prompt: "<question>. Search across relevant files. Return a summary of ≤200 words. Do not include raw file contents."
})
```

### Parallel Agents
**Condition:** 2+ implementation tasks with no shared state, each describable independently.

Send both Agent calls in a single message so they run in parallel:

```javascript
// Use the Agent tool twice in the same message — they run in parallel:
Agent({ description: "Task A", prompt: "... Return a summary of ≤200 words." })
Agent({ description: "Task B", prompt: "... Return a summary of ≤200 words." })
```

## Output Contract
- Every sub-agent returns ≤200 words to the main context.
- The main context acts only on summaries, not raw data.
- If a sub-agent needs user input, it surfaces one question to the main context and stops.

## When NOT to Spawn
- Single Grep or Glob can answer the question.
- Answer is already in `.claude/memory/project.md`.
- Task requires back-and-forth with the user (stay inline).
