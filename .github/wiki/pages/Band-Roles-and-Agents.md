# Band Roles and Agents

During orchestrated runs, five role agents handle specific phases. Each is defined in `.claude/agents/` with a fixed tool mask, success condition, and scope constraint.

## Role Matrix

| Agent | Role | Band | Tool Kind | Shell | Can Write |
|-------|------|------|-----------|-------|-----------|
| `spec.md` | spec | define | RW | No (Guard 7) | Spec files only |
| `plan.md` | plan | define | RW | No (Guard 7) | Plan files only |
| `code.md` | code | build | RW | Test command only | Task scope from envelope |
| `audit.md` | audit | verify | R | No (Guard 7) | Nothing (no write tools; Guard 5 denies `tk: R`) |
| `qa.md` | qa | verify | X | Test command only | Nothing (no write tools; Guard 5 denies `tk: X`) |

A sixth agent, `define-review.md`, is a non-band advisory reviewer for the review loop.

## Agent Constraints

Each agent's frontmatter declares:

- **`tools:`** — The role's tool mask (what tools it can call)
- **Success condition** — What constitutes a completed task
- **Stop-on-denial** — If a guard denies, the agent stops
- **One hand-back** — Claims only the role's own gate
- **No dispatch** — Agents cannot dispatch other agents (Guard 6: `ORCH_NESTED_DISPATCH`)
- **Scope copy** — Verbatim scope from the SNAP envelope

All prompts fit in 999 tokens or fewer.

The tool mask each agent declares:

<!-- wiki-gen:agent-tools -->

## The Hand-back

When a role completes, it returns exactly one `SNAP_HANDBACK` line. The orchestrator validates this before the next dispatch. A wall of prose never reaches the orchestrator's context.

## Guard Enforcement

```
                    ┌──────────────┐
                    │  Orchestrator │
                    │   (Guard 6)   │
                    └──────┬───────┘
                           │ dispatch
              ┌────────────┼────────────┐
              ▼            ▼            ▼
         ┌────────┐   ┌────────┐   ┌────────┐
         │  spec  │   │  code  │   │   qa   │
         │  G5+G7 │   │  G5+G7 │   │  G5+G7 │
         └────────┘   └────────┘   └────────┘
         No shell     Test only    Test only
         Spec scope   Task scope   No writes
```

## The Review Loop

Before each define approval:

1. `define-review` agent checks the spec/plan against a declared checklist
2. Open rows go back to the generating role via `SendMessage`
3. Up to 3 reviewer passes, 2 revisions
4. `ORCH_REVIEW_CAP` refuses a fourth round (no halt)
5. Advisory only — your approval is always required

## How roles are dispatched

1. Orchestrator builds a SNAP v3 envelope with the role's scope
2. Validates: `snap-validate --to <role>`
3. Installs envelope at `.claude/memory/band-envelope.json`
4. Dispatches via `Agent` tool with `agent_type` matching the role name
5. Waits for completion
6. Validates the `SNAP_HANDBACK` response
7. Proceeds to next role or phase
