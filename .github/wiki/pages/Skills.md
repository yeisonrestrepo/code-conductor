# Skills

Skills extend agent behavior for cross-cutting concerns. They apply regardless of stack or project type.

## Always Active

### code-simplifier

Applied to every piece of code written or reviewed.

| Rule | Description |
|------|-------------|
| No speculative abstractions | Solve today's problem only |
| Functions max 30 lines | One thing per function |
| Flat over nested | Guard clauses and early returns |
| Descriptive names | No `Base`, `Abstract`, `Manager`, `Handler` |
| Comments explain why | Never what |

### critical-review

A 4-phase adversarial protocol during implementation:

1. **Pre-Flight** — Identify happy path, failure points, boundary conditions
2. **Adversarial Review** — RESILIENCE (silent failures), EFFICIENCY (code smells), FRICTION (happy-path friction)
3. **Self-Correction** — Each weakness refactored and re-verified in isolation
4. **`[VALIDATION]`** — Edge cases covered, justification, residual risks

### verbosity

Controls response length per turn. Set at install with `--verbosity`, stored in `~/.claude/memory/verbosity.md`. Re-injected every turn by the `verbosity-remind` hook so it never drifts.

| Level | Behavior |
|---|---|
| `MIN` (default) | One sentence. `[CHANGES]` tag with file list. |
| `INFO` | Up to 5 bullets. `[CHANGES]` + `[REASON]`. |
| `VERBOSE` | Full explanation, prose allowed. All tags. |

### memory-first

Before reading any file, walk this chain and stop at the first hit:

1. **Memory** — `project.md` + `personal.md`
2. **Grep / Glob** — pattern search
3. **Targeted read** — last resort, always `offset` + `limit`, max 150 lines

### agent-delegation

Keeps the main context clean:

- Sub-agents handle exploration and parallel work
- Return summaries of max 200 words
- Raw file contents never enter the main context

## Retired

### ui-ux-pro-max

Earlier releases described this as installed from GitHub for frontend stacks. No shipped code does either. Filed as `[FEAT-037]` for replacement.

The shipped `CLAUDE.md` templates still name it: `global/CLAUDE.md` lists it under Active Skills, and `project-template/CLAUDE.md` names it in its specialization and delegation tables. Until `[FEAT-037]` lands, treat those lines as retired guidance; no skill by that name is installed.

## Skill Files

Each skill lives in `skills/<name>/SKILL.md` with its full ruleset and activation conditions.

<!-- wiki-gen:skills-index -->
