# Architecture Overview

code-conductor operates at three layers. Each is independent, and higher layers build on lower ones.

## Layer 1: Global Core (`~/.claude/`)

Installed once, applies to every project on your machine.

- **Spec-first workflow** — `/cc-checkpoint`, `/cc-stack`, `/cc-lang`, `/cc-compact`
- **Token-efficiency rules** — memory-first lookup chain, bounded reads
- **Safety checks** — file existence verification, no hardcoded secrets
- **Simplicity rules** — code-simplifier skill always active
- **Memory conventions** — `personal.md` for cross-project preferences

## Layer 2: Project Template (`.claude/`)

Lives in your repository, shared via git with the team.

- **Slash commands** — `/cc-spec`, `/cc-plan`, `/cc-implement`, `/cc-orchestrate`, etc.
- **Guards** — `pre-tool-use.mjs`, a single zero-dependency hook with 7 guards
- **Role agents** — `spec`, `plan`, `code`, `audit`, `qa`, `define-review`
- **Shared memory** — `project.md` for team decisions and conventions
- **Stack detection** — `detect-stack.mjs` auto-fills build/test/lint commands

## Layer 3: Dynamic Stack Discovery & Skills

`/cc-stack` detects your stack and writes commands into `CLAUDE.md`. Skills enforce cross-cutting behavior:

- `code-simplifier` — max 30-line functions, guard clauses, descriptive names
- `critical-review` — 4-phase adversarial protocol during implementation
- `verbosity` — MIN/INFO/VERBOSE, re-injected every turn
- `memory-first` — lookup chain: memory → grep → targeted read
- `agent-delegation` — sub-agents return 200-word summaries, not raw data

## Data Flow

```
Session Start
    │
    ├─► /cc-resume ─► loads project.md + personal.md + stack + latest spec/plan
    │
    ▼
/cc-spec ─► human approval ─► /cc-plan ─► human approval ─► /cc-implement
    │                              │                              │
    │                              │                              ├── per task:
    │                              │                              │   grep → read → flip [>] → execute → flip [X]
    │                              │                              │   └── Step 6: SQLite cache write
    │                              │                              │
    ▼                              ▼                              ▼
              All writes pass through Guards 1–7
              (pre-tool-use.mjs, fires on Read/Write/Edit/Bash)
```

## Orchestrated Flow

For well-defined backlog items, `/cc-orchestrate` automates the entire flow:

```
/cc-orchestrate FEAT-123
    │
    ├── Start ─► resolve test command, create run file
    │
    ├── Define ─► spec agent ─► review loop ─► human approval
    │           └── plan agent ─► review loop ─► human approval
    │
    ├── Build ─► code agent (per task, serial)
    │           └── Guard 5 (band scope) + Guard 7 (role shell)
    │
    ├── Verify ─► audit agent (static review)
    │           └── qa agent (runs tests, cannot write files)
    │
    └── Report ─► hand-backs + approval records
                  Release stays human.
```

## File Layout

```
<project>/
├── .claude/
│   ├── agents/          # Role agent definitions (spec, plan, code, audit, qa)
│   ├── commands/        # /cc-* slash commands
│   ├── hooks/           # pre-tool-use.mjs (Guards 1–7), context-guard, verbosity
│   ├── memory/          # project.md, session state, turn counter
│   ├── scripts/         # detect-stack.mjs, orchestrate.mjs, snap-validate.mjs
│   ├── settings.json    # Hook matcher configuration
│   └── review-loop.settings.json  # Auto-mode exception for review loop
├── .conductor/          # Local-only (gitignored)
│   ├── cache.db         # SQLite task state cache (Node >= 22.5)
│   └── ticket/          # Ticket snapshots for bound issues
└── CLAUDE.md            # Managed block from /cc-stack + your own content
```
