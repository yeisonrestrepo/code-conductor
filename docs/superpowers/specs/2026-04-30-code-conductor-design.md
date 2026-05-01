# code-conductor — Design Spec

**Date:** 2026-04-30
**Status:** Approved

## Overview

A structured, token-efficient Claude Code configuration repository. Installs a set of files globally (`~/.claude/`) and/or into a project (`.claude/`), giving every Claude session consistent behavior, slash commands, hooks, and stack-aware profiles.

One-liner install on any machine. Re-running the installer updates agent-managed files without overwriting user-configured ones.

---

## Architecture

Three-layer system:

| Layer | Location | Scope |
|---|---|---|
| Global core | `~/.claude/` | Every project on the machine |
| Project template | `project-root/.claude/` | One repo, shared with the team via git |
| Stack profiles + skills | Loaded dynamically at session start | Per detected stack |

---

## File Structure (39 files)

```
code-conductor/
├── README.md
├── .gitignore
├── install.sh                    macOS/Linux — curl -fsSL URL | bash
├── install.ps1                   Windows — irm URL | iex
├── global/
│   ├── CLAUDE.md
│   ├── settings.json
│   ├── commands/
│   │   ├── checkpoint.md         /checkpoint
│   │   ├── stack.md              /stack
│   │   └── lang.md               /lang
│   └── memory/
│       └── personal.md
├── project-template/
│   ├── CLAUDE.md
│   └── .claude/
│       ├── settings.json
│       ├── commands/
│       │   ├── spec.md           /spec
│       │   ├── plan.md           /plan
│       │   ├── review.md         /review
│       │   ├── debug.md          /debug
│       │   ├── refactor.md       /refactor
│       │   ├── test.md           /test
│       │   └── docs.md           /docs
│       ├── hooks/
│       │   ├── pre-tool-use.sh
│       │   └── post-compact.sh
│       └── memory/
│           └── project.md
├── stack-profiles/
│   ├── _base.md
│   ├── _multi-stack.md
│   ├── _template.md
│   ├── javascript.md
│   ├── typescript.md
│   ├── python.md
│   ├── java.md
│   ├── go.md
│   ├── rust.md
│   ├── react.md
│   ├── angular.md
│   ├── nextjs.md
│   ├── nestjs.md
│   ├── django.md
│   └── flask.md
└── skills/
    ├── code-simplifier.md
    └── ui-ux.md
```

---

## Components

### global/CLAUDE.md — Mandatory agent behaviors

Encodes these rules for every Claude session on the machine:

- **Workflow:** `/spec → /plan → confirm → implement`. No code without an approved spec.
- **Tokens:** grep/find before read. Never read a full file over 150 lines. One tool call, one purpose.
- **Safety:** Check file exists before create. Confirm before any write or destructive command.
- **Simplicity:** `code-simplifier` always active. No speculative abstractions. No premature patterns.
- **Language:** English by default. `/lang [code]` switches session. Code identifiers always English.
- **Stack:** Auto-run `/stack` at session start. Confirm before loading profiles.
- **Memory:** `project.md` in git (shared). `personal.md` local only (never committed).
- **Delegation:** Superpowers for isolated tasks. Playwright for visual debug and E2E.
- **Response tags:** `[CHANGES]`, `[BUG]`, `[PLAN]`, `[REASON]` — always used.

### Slash Commands

**Global (3):**

| Command | Behavior |
|---|---|
| `/checkpoint` | Read recent conversation → identify decisions/conventions/debt → update `project.md` + `personal.md` → report with timestamp |
| `/stack` | Scan manifest files → infer framework from dependency contents → confirm before loading profiles |
| `/lang [code]` | Switch response language immediately. Scope: responses + comments only. Never identifiers, filenames, commits. |

**Project (7):**

| Command | Behavior |
|---|---|
| `/spec [name]` | Search codebase first → ask only missing context → generate full spec → wait for approval → save to `project.md` |
| `/plan` | Require approved spec → map codebase → generate ordered steps with file paths, test list, commit order, risks |
| `/review [file\|dir\|nothing]` | Three layers: 🔴 Critical / 🟡 Important / 🟢 Suggestion → verdict → offer auto-fix |
| `/debug [problem]` | Hypotheses by probability → confirm before investigating → Playwright MCP for visual bugs → root cause + fix |
| `/refactor [file\|module]` | Diagnose complexity → plan ordered changes → one step at a time → verify tests after each |
| `/test [scope]` | Analyze coverage gaps → AAA pattern → Playwright E2E → run after confirmation → report |
| `/docs [scope]` | Audit existing docs → inline format by language (JSDoc/docstrings/JavaDoc/GoDoc) → preview before writing |

### Hooks

| Hook | Trigger | Behavior |
|---|---|---|
| `pre-tool-use.sh` | Write/Create tool calls | Extract path from `CLAUDE_TOOL_INPUT` JSON. If file exists: print warning (path, line count, last modified), list 3 options, exit 1. |
| `post-compact.sh` | After `/compact` | Read `project.md`, show last checkpoint timestamp, remind to run `/checkpoint`. |

### Stack Profiles (15)

Each profile defines: naming conventions table, standard project structure, tooling table, common commands, 2–3 idiomatic patterns with examples, anti-patterns, detector files list.

- `_base.md` — universal rules: English identifiers, Conventional Commits, one file one responsibility, no silent error swallowing, no hardcoded secrets, comments explain why not what.
- `_multi-stack.md` — coordinator for multi-language repos: each layer owns its directory, cross-layer contracts are source of truth, full-stack feature order (contract → backend → frontend → tests → E2E).
- `_template.md` — blank template for adding new profiles.
- Language profiles: `javascript.md`, `typescript.md`, `python.md`, `java.md`, `go.md`, `rust.md`
- Framework profiles: `react.md`, `angular.md`, `nextjs.md`, `nestjs.md`, `django.md`, `flask.md`

### Skills (2)

| Skill | Activation | Content |
|---|---|---|
| `code-simplifier.md` | Always active (loaded by global core) | Rules with good/bad examples for: no speculative abstractions, no premature layers, no single-implementation interfaces, functions ≤30 lines, no defensive code for impossible cases, flat over nested, descriptive names, constants only when used 2+ places. Complexity signals defined. |
| `ui-ux.md` | Activatable for frontend projects | Visual hierarchy, whitespace, consistency system, motion with purpose. Component states (default/hover/active/disabled/loading/error/empty). Typography + spacing (4px base) + semantic color tokens. Tailwind conventions. Accessibility baseline. |

---

## Installers

### Behavior (identical across `install.sh` and `install.ps1`)

**Runtime detection order:** Node.js 18+ → Python 3 → error + exit

**Auto-install Node if missing:**
- macOS: Homebrew → nvm
- Linux: nvm → apt/dnf/pacman
- Windows: winget

**Dependencies (install in order, warn-and-continue on failure):**

1. `npx claude-mem install` — requires Node 18+
2. `npm install -g uipro-cli && uipro init --ai claude --global` — requires Node + Python 3
3. `claude mcp add playwright npx @playwright/mcp@latest` — requires Node + claude CLI
4. `claude plugin install superpowers@claude-plugins-official` — requires claude CLI
5. `claude plugin install code-simplifier@claude-plugins-official` — requires claude CLI

**File download rules:**
- User-configured files (`CLAUDE.md`, `settings.json`, memory templates): skip if exist
- Agent-managed files (commands, hooks, stack profiles, skills): always overwrite
- Source: `https://raw.githubusercontent.com/${REPO}/${BRANCH}/[path]`

**Flags:**
- `--project` / `-Project` — also install project template into current directory; update `.gitignore` to exclude `.claude/memory/personal.md`
- `--no-deps` — skip dependency installation, agent files only

**Final report:** what installed, what failed with manual commands, available slash commands.

---

## Memory Architecture

```
~/.claude/memory/personal.md     ← local only, never committed
project-root/.claude/memory/
  project.md                     ← in git, shared with team
```

`/checkpoint` writes to both. `personal.md` holds dev preferences; `project.md` holds decisions, conventions, debt, workarounds.

---

## Execution Order

Files are generated 1–39 in the order specified in `initial_prompt.xml`, ending with:

```sh
git init && git add . && git commit -m "feat: initial release — code-conductor v1.0.0"
```

No remote added. User handles that manually.

---

## Out of Scope

- No CI/CD configuration
- No npm package publish
- No GitHub Actions
- No remote push during install
