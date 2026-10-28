# Commands Reference

All commands are tagged `(Conductor)` in the Claude Code command palette.

## Global Commands (all projects)

| Command | What it does |
|---|---|
| `/cc-checkpoint` | Extract decisions, conventions and debt from the current session; write to `project.md` and `personal.md` with timestamp. Run before `/compact`, after features, after key decisions. |
| `/cc-stack` | Run `detect-stack.mjs` and write detected commands + ruleset into project `CLAUDE.md`. On later sessions asks if anything changed before re-detecting. |
| `/cc-lang [code]` | Switch response language for the session. Codes: `en` `es` `pt` `fr` `de` `it` `zh` `ja` `ko`. Identifiers, filenames and commits stay English. |
| `/cc-compact` | Serialize phase state to a SNAP JSON snapshot, then prompt to run `/compact`. Run at phase boundaries. |

## Project Commands (requires `--project` install)

### Workflow

| Command | What it does |
|---|---|
| `/cc-init` | Initialize or re-sync: detect stack, checkpoint memory, verify hook integrity. |
| `/cc-resume` | Restore full context: project identity, memory, latest spec/plan, git state, stack. Surfaces `[>]` (interrupted) and `[!]` (failed) task markers. |

### Spec-First Pipeline

| Command | What it does |
|---|---|
| `/cc-spec [name]` | Search codebase, ask only for missing context, write a full spec, **wait for approval**. |
| `/cc-plan` | From approved spec: ordered tasks with exact file paths, test list, commit order, risks. Tasks carry `[T-NNN]` IDs with plain ASCII checkboxes. |
| `/cc-implement` | Execute tasks with 5-step ritual: grep-locate → single-line read → flip `[>]` → execute → flip `[X]`. Never reads the full plan. Step 4.5: OWASP security scan. Step 6: SQLite cache write. |

### Orchestration

| Command | What it does |
|---|---|
| `/cc-orchestrate <ITEM> [--auto] [--ticket <N\|URL>]` | Route a backlog item through Define → Build → Verify with role agents. See [Orchestrator Guide](Orchestrator-Guide). |

### Utilities

| Command | What it does |
|---|---|
| `/cc-review [file\|dir]` | Three-layer review (Critical / Important / Suggestion) + verdict + auto-fix offer. |
| `/cc-debug [problem]` | Hypothesis-driven debugging: characterize → hypothesize → investigate → report → fix after confirm. |
| `/cc-refactor [file\|module]` | Diagnose complexity, plan changes, apply one step at a time, verify tests after each. |
| `/cc-test [scope]` | Find coverage gaps, write AAA-pattern tests, run after confirmation, report results. |
| `/cc-docs [scope]` | Audit documentation, write inline docs (JSDoc / docstrings / JavaDoc / GoDoc), preview before writing. |
| `/cc-metrics [--dir <path>]` | Read-only report of token and time spend from local session logs, by tool, command, phase, branch, pillar and session, with recommendations that quote their numbers. |
| `/cc-flow` | Print the guard lanes with per-guard pass, deny and ask counts, then the newest 20 hook decisions. The same log drives the flow status line. |

## The Ideal Workflow

```
/cc-resume            ← restore context
/cc-spec user-auth    ← write spec, wait for approval
/cc-plan              ← write plan, wait for approval  
/cc-implement         ← execute tasks one at a time
/cc-checkpoint        ← save decisions to memory
/cc-compact           ← snapshot state, then /compact
```

The key idea: **nothing gets built until a human approved what will be built.**
