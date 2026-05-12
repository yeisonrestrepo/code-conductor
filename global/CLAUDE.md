# Global Claude Configuration

Applies to every project on this machine. Project CLAUDE.md adds project-specific overrides on top.

## Workflow

Always follow this sequence. No exceptions.

1. `/cc-spec` — define the problem and wait for approval
2. `/cc-plan` — map the implementation and wait for approval
3. Implement — one step at a time, confirm between steps unless told otherwise

Never write code without an approved spec. Never start implementing without an approved plan.

## Token Efficiency

- grep/find before read — never open a file without searching first
- Never read a full file over 150 lines — use line offsets and limits
- One tool call, one purpose — no exploratory reads during implementation

## Orchestrator Protocol

Before reading any file or spawning any search, classify the task and walk this chain. Stop at the first step that answers the question.

1. **Memory** — check `claude-mem` / `.claude/memory/project.md`. If the answer is there, stop.
2. **Graph** — structural question? Run `graphify query "<question>"` if `graphify` is installed. Stop.
3. **Grep / Glob** — pattern search? Use `Grep` or `Glob` inline. Stop.
4. **Explore sub-agent** — need 3+ files to answer one question? Spawn an `Explore` sub-agent. It returns a ≤200-word summary. Main context receives only the summary. Stop.
5. **Parallel agents** — 2+ independent implementation tasks? Spawn parallel agents in worktrees. Each returns a ≤200-word summary.
6. **Targeted read** — last resort. Always use `offset` + `limit`. Max 150 lines per call.

Never jump to a later step if an earlier one can answer the question.

## Safety

- Check file exists before creating — use the pre-tool-use hook
- Confirm before any write or destructive shell command
- Never hardcode secrets, tokens, passwords, or API keys
- Never run `rm -rf` without explicit user confirmation

## Simplicity

The code-simplifier skill is always active. Apply its rules to every change:

- No speculative abstractions — solve today's problem only
- Functions do one thing, max 30 lines
- Flat over nested — guard clauses and early returns
- Descriptive names — no Base/Abstract/Generic/Manager/Handler
- Comments explain why, never what

## Language

- Default: English (responses + code comments + identifiers)
- Switch: `/cc-lang [code]` changes response language for the session
- Code identifiers, file names, and commit messages are always English
- Supported codes: en es pt fr de it zh ja ko

## Stack Detection

Auto-run `/cc-stack` at the start of every session. Confirm before loading any stack profile. If the stack is already in project.md memory, load from there and ask if anything changed.

## Memory

- `project.md` — in git, shared with the team. Decisions, conventions, debt, workarounds.
- `personal.md` — local only, never committed. Developer preferences, personal shortcuts.
- Run `/cc-checkpoint` before `/compact`, after feature completion, after key architectural decisions.

## Delegation

- Use Superpowers for isolated, parallelizable sub-tasks
- Use Playwright MCP for visual debugging and E2E tests
- Always confirm scope before spawning sub-agents

## Response Format

Always tag responses:

- `[CHANGES]` — list of files changed and what changed
- `[BUG]` — bug report with file:line reference
- `[PLAN]` — ordered implementation steps
- `[REASON]` — explanation of a decision or approach

## Active Skills

- `code-simplifier` — always active, loaded automatically
- `ui-ux-pro-max` — activate via `/cc-stack` when frontend frameworks are detected
- `verbosity` — always active; reads level from `memory/verbosity.md` (default: MIN)
- `memory-first` — always active; enforces the orchestrator lookup chain
- `agent-delegation` — always active; governs when and how to spawn sub-agents

## Loaded Profiles

Stack profiles are loaded dynamically by `/cc-stack`. They define conventions for your specific language and framework. Never apply one language's conventions to another.
