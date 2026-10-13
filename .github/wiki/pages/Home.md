# code-conductor

**Make Claude Code work like a senior engineer, not an enthusiastic intern.**

code-conductor is a drop-in governance layer for [Claude Code](https://www.anthropic.com/claude-code): slash commands, hooks, guardrails and a persistent memory system that turn free-form AI coding sessions into a disciplined, repeatable engineering workflow.

---

## Quick Navigation

| Page | Description |
|------|-------------|
| [Getting Started](Getting-Started) | Installation and first session |
| [Architecture Overview](Architecture-Overview) | How the three layers fit together |
| [Guards Reference](Guards-Reference) | Guards 1–7: what each one enforces |
| [Commands Reference](Commands-Reference) | All `/cc-*` slash commands |
| [Orchestrator Guide](Orchestrator-Guide) | Hands-off delivery with `/cc-orchestrate` |
| [SNAP Protocol](SNAP-Protocol) | Minified JSON handoffs between phases |
| [Band Roles & Agents](Band-Roles-and-Agents) | The five role agents and their boundaries |
| [Skills](Skills) | Cross-cutting behavior: simplifier, verbosity, memory-first |
| [Memory Architecture](Memory-Architecture) | Project memory, personal memory and the lookup chain |
| [Contributing](Contributing) | How work enters this repository |
| [FAQ](FAQ) | Common questions and troubleshooting |

---

## Key Concepts at a Glance

```
┌─────────────────────────────────────────────────────────┐
│                    Claude Code Session                   │
│                                                         │
│  ┌───────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  /cc-spec     │→ │  /cc-plan    │→ │ /cc-implement│  │
│  │  (approve)    │  │  (approve)   │  │  (execute)   │  │
│  └───────────────┘  └──────────────┘  └──────────────┘  │
│         ↑                                    ↓          │
│  ┌──────┴──────────────────────────────────────────┐    │
│  │              Guards (pre-tool-use)               │    │
│  │  G1: Large reads  G3: Bash scan  G5: Band scope │    │
│  │  G2: Dup writes   G4: node_modules  G6: Orch    │    │
│  │                   G7: Role shell                 │    │
│  └─────────────────────────────────────────────────┘    │
│         ↑                                               │
│  ┌──────┴──────────────────────────────────────────┐    │
│  │                   Memory Layer                   │    │
│  │  project.md (git) │ personal.md (local)          │    │
│  │  session-snapshot  │ .conductor/cache.db          │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

## Why this exists

Without code-conductor, Claude Code reads entire files, forgets conventions between sessions, starts coding before anyone agrees on what to build, and fills the context window until it breaks. These aren't model problems — they're process problems, and process is what code-conductor installs.
