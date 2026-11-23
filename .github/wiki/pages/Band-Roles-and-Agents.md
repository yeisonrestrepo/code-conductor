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
| `docs.md` | docs | ship | RW | No (Guard 7) | Documentation surface only |
| `release.md` | release | ship | RW | No (Guard 7) | Release surface from the project's release profile only |

A sixth agent, `define-review.md`, is a non-band advisory reviewer for the review loop.

`docs.md` is not seated in a run: `/cc-docs --release <ref>` dispatches it against one shipped release, outside any run. It exists only in SNAP v5 envelopes, claims only `verify_pass`, and leaves its edits uncommitted for you to review.

`release.md` is not seated in a run either: `/cc-release <version>` dispatches it outside any run, in every installed project, driven by that project's committed release profile (`.claude/release-profile.json`, written by `/cc-release --init`). It exists only in SNAP v6 envelopes, claims only `verify_pass`, and edits only the profile's version locations, changelog and, when bound, backlog; `release.mjs check` judges the diff and runs the profile's checks before you commit it.

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
