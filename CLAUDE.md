# Project Claude Configuration

Extends global CLAUDE.md. Project-specific rules take precedence over global ones.

## Project Identity

<!-- Fill in when installing:
name: [project name]
stack: [detected by /stack]
language: [optional override, e.g., "es" for Spanish responses]
-->

## Architecture Notes

<!-- Key architectural decisions for this project -->

## Conventions

<!-- Project-specific conventions that override _base.md defaults -->

## Out of Scope

<!-- Things Claude should not touch in this project -->

## Active Stack Profiles

<!-- Set by /stack. Example:
- typescript
- nextjs
- _multi-stack (if applicable)
-->

## Execution Rules

### Graph-First

Before modifying any file, query the project graph:

```
Agent({
  subagent_type: "Explore",
  description: "Graph lookup: <symbol or file>",
  prompt: "Using the graphify knowledge graph for this project, find all callers, dependents, and related nodes for <target>. Return ≤150 words."
})
```

Skip only when: the change is isolated to a new file with no existing callers.

### Verbosity

VERBOSITY: MIN

- One declarative sentence per response.
- `[CHANGES]` tag: list modified files only.
- On ambiguity: one clarifying question, nothing else.

### Sub-Agent Delegation

Invoke the matching skill via the `Skill` tool before starting each domain task:

| Task | Skill |
|------|-------|
| Refactor | `code-simplifier` |
| Tests | `cc-test` command |
| Docs | `cc-docs` command |
| Debug | `cc-debug` command |
| Frontend | `ui-ux-pro-max` |

Use the `Explore` sub-agent for any lookup requiring 3+ file reads.
