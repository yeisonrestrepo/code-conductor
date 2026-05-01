# Global Claude Configuration

Applies to every project on this machine. Project CLAUDE.md adds project-specific overrides on top.

## Workflow

Always follow this sequence. No exceptions.

1. `/spec` — define the problem and wait for approval
2. `/plan` — map the implementation and wait for approval
3. Implement — one step at a time, confirm between steps unless told otherwise

Never write code without an approved spec. Never start implementing without an approved plan.

## Token Efficiency

- grep/find before read — never open a file without searching first
- Never read a full file over 150 lines — use line offsets and limits
- One tool call, one purpose — no exploratory reads during implementation

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
- Switch: `/lang [code]` changes response language for the session
- Code identifiers, file names, and commit messages are always English
- Supported codes: en es pt fr de it zh ja ko

## Stack Detection

Auto-run `/stack` at the start of every session. Confirm before loading any stack profile. If the stack is already in project.md memory, load from there and ask if anything changed.

## Memory

- `project.md` — in git, shared with the team. Decisions, conventions, debt, workarounds.
- `personal.md` — local only, never committed. Developer preferences, personal shortcuts.
- Run `/checkpoint` before `/compact`, after feature completion, after key architectural decisions.

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
- `ui-ux` — activate via `/stack` when frontend frameworks are detected

## Loaded Profiles

Stack profiles are loaded dynamically by `/stack`. They define conventions for your specific language and framework. Never apply one language's conventions to another.
