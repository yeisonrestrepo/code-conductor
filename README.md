# code-conductor

A spec-first, token-efficient Claude Code configuration that turns AI-assisted coding into a disciplined, repeatable engineering workflow.

---

## The Problem

AI coding assistants are only as good as the structure you put around them. Without it, sessions drift: the agent overwrites files it shouldn't, skips the spec, reads entire codebases line by line, and produces code that solves the wrong problem efficiently. The result is fast output with slow outcomes — more rewrites, more context lost, more tokens burned. code-conductor is the structure.

| Without code-conductor | With code-conductor |
|---|---|
| Free-form prompt → agent guesses, overwrites, drifts | `/cc-spec` → approved spec → `/cc-plan` → confirmed steps → implement |
| Full files read on every turn | grep/find before read — targeted tool calls only |
| Conventions reset every session | Stack profile + memory loaded at session start |
| Frontend code with no UX consideration | UI/UX skill activated automatically for frontend stacks |

---

## Install

**macOS / Linux:**
```bash
curl -fsSL https://raw.githubusercontent.com/yeisonrestrepo/code-conductor/main/install.sh | bash
```

**Windows (PowerShell):**
```powershell
irm https://raw.githubusercontent.com/yeisonrestrepo/code-conductor/main/install.ps1 | iex
```

### Add to a project

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/yeisonrestrepo/code-conductor/main/install.sh | bash -s -- --project

# Windows
& ([ScriptBlock]::Create((irm https://raw.githubusercontent.com/yeisonrestrepo/code-conductor/main/install.ps1))) -Project
```

### Flags

By default, the installer installs only the global core files. Use flags to extend this behavior.

| Flag | Description |
|------|-------------|
| `--project` / `-Project` | Also install the project template into the current directory |
| `--no-deps` / `-NoDeps` | Skip dependency installation (Node tooling, Playwright MCP, plugins); copy agent files only |
| `--verbosity MIN\|INFO\|VERBOSE` / `-Verbosity` | Set the default response verbosity (default: `MIN`). `MIN` = one sentence per response. `INFO` = bullet list. `VERBOSE` = full explanation. Re-run the installer to change it. |

### Update

Re-run the same install command. User-configured files are never overwritten; agent-managed files are always updated.

---

## How It Works

code-conductor operates at three layers:

**Global core** (`~/.claude/`) — applies to every project on your machine. Enforces the spec-first workflow, token efficiency rules, safety checks, code simplicity rules, and memory conventions. Installed once; always active.

**Project template** (`.claude/`) — lives in your repo and is shared with your team via git. Adds project-specific slash commands, hooks that guard file writes, and a shared memory file for decisions, conventions, and technical debt.

**Dynamic profiles + skills** — loaded at session start by `/cc-stack` based on your detected framework. Each profile defines naming conventions, project structure, standard tooling, idiomatic patterns, and anti-patterns for your specific stack. Skills extend the agent's behavior for cross-cutting concerns like code simplicity and UI/UX.

---

## Available Commands

All commands are tagged `(Conductor)` in the Claude Code command palette so they're easy to spot alongside commands from other sources.

### Global (all projects)

| Command | Description |
|---------|-------------|
| `/cc-checkpoint` | Read the current session, extract decisions, conventions, and debt, then write them to `project.md` and `personal.md` with a timestamp. Run before `/compact`, after completing a feature, and after key architectural decisions. |
| `/cc-stack` | Scan manifest files to detect your framework, confirm before loading the matching profile, and cache the result in `project.md` to avoid re-detection next session. |
| `/cc-lang [code]` | Switch response language for this session. Code identifiers, filenames, and commit messages remain English regardless. |

### Project (requires `--project` install)

| Command | Description |
|---------|-------------|
| `/cc-init` | Initialize or re-sync the project environment: detect stack, checkpoint memory, refresh the project graph, and verify hook integrity. Run at the start of every session. |
| `/cc-spec [name]` | Search the codebase first, ask only for missing context, generate a full feature spec, and wait for your approval before any plan is made. |
| `/cc-plan` | Require an approved spec, map the codebase, and generate an ordered implementation plan with exact file paths, a test list, a commit order, and identified risks. |
| `/cc-review [file\|dir]` | Review code in three layers — Critical / Important / Suggestion — then deliver a verdict and offer to auto-fix. |
| `/cc-debug [problem]` | Generate hypotheses ordered by probability, confirm before investigating, use Playwright MCP for visual bugs, and report the root cause with a targeted fix. |
| `/cc-refactor [file\|module]` | Diagnose complexity, plan ordered changes, apply one step at a time, and verify tests pass after each step. |
| `/cc-test [scope]` | Analyze coverage gaps, write tests in AAA pattern, add Playwright E2E where applicable, run after confirmation, and report results. |
| `/cc-docs [scope]` | Audit existing documentation, write inline docs in the correct format for your stack (JSDoc / docstrings / JavaDoc / GoDoc), and preview before writing. |

---

## Skills

Skills extend agent behavior for cross-cutting concerns that apply regardless of stack.

### code-simplifier — always active

Applied to every piece of code written or reviewed in every session. Enforces:

- No speculative abstractions — solve today's problem only
- Functions ≤30 lines, doing one thing
- Flat over nested — guard clauses and early returns
- Descriptive names — no `Base`, `Abstract`, `Manager`, `Handler`
- Comments explain why, never what

### ui-ux-pro-max — frontend projects

Activated automatically when `/cc-stack` loads a frontend stack profile (React, Angular, Next.js, and similar). Installed from [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) — the installer downloads it directly from GitHub. Enforces visual hierarchy, spacing grids, semantic color tokens, component states, WCAG AA accessibility, and framework-specific UI conventions.

### critical-review — always active during implementation

Applied to every implementation task via a 4-phase adversarial protocol:

1. **Pre-Flight** — Happy Path, Failure Points, and Boundary Conditions identified before any code is written
2. **Adversarial Review** — RESILIENCE (silent failures), EFFICIENCY (code smells), FRICTION (happy-path friction)
3. **Self-Correction** — each weakness refactored and re-verified in isolation
4. **`[VALIDATION]`** — required closing section on every implementation: edge cases covered, best-outcome justification, residual risks

### verbosity — always active

Controls how much Claude writes per turn. The level is set at install time via `--verbosity` and stored in `~/.claude/memory/verbosity.md`. Default: `MIN`.

| Level | Behavior |
|-------|----------|
| `MIN` | One declarative sentence. `[CHANGES]` tag with file list only. |
| `INFO` | Bullet list of what changed and why. Max 5 bullets. `[CHANGES]` + `[REASON]`. |
| `VERBOSE` | Full explanation, prose allowed. All response tags. |

### memory-first — always active

Before reading any file, Claude walks a priority lookup chain and stops at the first step that answers the question:

1. **Project memory** — `claude-mem` / `project.md`
2. **Graphify graph** — structural/relational queries (`what calls X`, `what depends on Y`)
3. **Grep / Glob** — pattern searches
4. **Targeted read** — last resort, always with `offset` + `limit`, max 150 lines

### agent-delegation — always active

Keeps the main context clean. Sub-agents handle exploration and parallel work; they return a ≤200-word summary to the main context. Raw file contents and intermediate data never enter the main context.

---

## Hooks

Hooks run automatically at specific points in a Claude Code session. They require no manual setup.

### pre-tool-use

Fires before every tool call. Two guards:

**Large-file Read guard** — if Claude tries to read a file with more than 150 lines without specifying an `offset` and `limit`, the call is blocked and Claude is redirected to the orchestrator lookup chain (memory → graph → grep → targeted read). Prevents reading entire codebases when a targeted search would do.

**Duplicate file guard** — if Claude tries to write or create a file that already exists, it prints a warning showing the file path, line count, and last-modified timestamp, then presents three options: overwrite, edit in place, or cancel. Prevents silently replacing files you've already configured.

### post-compact

Fires after `/compact`. Reads `project.md`, shows the timestamp of the last `/cc-checkpoint`, and reminds you to run `/cc-checkpoint` if context from this session hasn't been saved yet. Prevents losing decisions and conventions when the context window is compressed.

---

## Stack Profiles

Running `/cc-stack` detects your framework from manifest files and loads the matching profile. Each profile defines naming conventions, standard project structure, tooling, idiomatic patterns with examples, and anti-patterns — so the agent never applies Python conventions to a TypeScript file.

| Profile | Detected by |
|---------|-------------|
| `javascript` | `package.json` (no TypeScript) |
| `typescript` | `tsconfig.json` |
| `python` | `requirements.txt`, `pyproject.toml` |
| `java` | `pom.xml`, `build.gradle` |
| `go` | `go.mod` |
| `rust` | `Cargo.toml` |
| `react` | `package.json` with `react` dependency but no `next` |
| `angular` | `angular.json` |
| `nextjs` | `next.config.js` / `next.config.ts` |
| `nestjs` | `package.json` → `@nestjs/core` |
| `django` | `manage.py` + `django` in deps |
| `flask` | `flask` in deps |
| `flutter` (single package) | `pubspec.yaml` |
| `flutter` (Melos monorepo) | `pubspec.yaml` + `melos.yaml` |
| `react-native` (Bare) | `package.json` with `react-native` (no `expo`) |
| `react-native` (Expo Managed) | `package.json` with `react-native` + `expo` |

---

## Memory Architecture

```
~/.claude/
  memory/
    personal.md     ← local only, never committed
                       dev preferences, shortcuts
    verbosity.md    ← agent-managed, set by installer
                       active verbosity level (MIN/INFO/VERBOSE)

project-root/
  .claude/
    memory/
      project.md    ← in git, shared with team
                       decisions, conventions, debt, workarounds
```

`/cc-checkpoint` writes to both. Run it before `/compact`, after completing a feature, and after any key architectural decision.

`/cc-stack` reads `project.md` to skip re-detection on subsequent sessions.

---

## Language Support

| Priority | Source | How to set |
|----------|--------|------------|
| 1 (highest) | Session | `/lang [code]` |
| 2 | Project | `language:` in project `CLAUDE.md` |
| 3 | Personal | `response_language:` in `personal.md` |
| 4 (default) | Global | English |

**Supported codes:** `en` `es` `pt` `fr` `de` `it` `zh` `ja` `ko`

Code identifiers, file names, and commit messages are always English.

---

## File Structure

```
code-conductor/
├── README.md
├── VERSION
├── .gitignore
├── install.sh                    macOS/Linux
├── install.ps1                   Windows
├── global/
│   ├── CLAUDE.md                 Global agent behavior (all projects)
│   ├── settings.json
│   ├── commands/
│   │   ├── cc-checkpoint.md      /cc-checkpoint
│   │   ├── cc-stack.md           /cc-stack
│   │   └── cc-lang.md            /cc-lang
│   └── memory/
│       └── personal.md           Template (never committed)
├── project-template/
│   ├── CLAUDE.md
│   └── .claude/
│       ├── settings.json         Hooks wiring (pre-tool-use, post-compact)
│       ├── system-prompt.md      Managed Agent system prompt (agents.create)
│       ├── commands/
│       │   ├── cc-init.md        /cc-init — session initialization
│       │   ├── cc-spec.md        /cc-spec
│       │   ├── cc-plan.md        /cc-plan
│       │   ├── cc-review.md      /cc-review
│       │   ├── cc-debug.md       /cc-debug
│       │   ├── cc-refactor.md    /cc-refactor
│       │   ├── cc-test.md        /cc-test
│       │   └── cc-docs.md        /cc-docs
│       ├── hooks/
│       │   ├── pre-tool-use.sh   Large-file read guard + duplicate file guard
│       │   └── post-compact.sh   Checkpoint reminder after `/compact`
│       └── memory/
│           └── project.md        Shared team memory (in git)
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
    ├── code-simplifier.md        Always active — complexity and simplicity rules
    ├── critical-review.md        Always active — 4-phase adversarial review protocol
    ├── verbosity.md              Always active — MIN/INFO/VERBOSE response rules
    ├── memory-first.md           Always active — memory → graph → grep → read chain
    └── agent-delegation.md       Always active — sub-agent spawn rules
    # ui-ux-pro-max installed from github.com/nextlevelbuilder/ui-ux-pro-max-skill
```

---

## .gitignore Note

When installed with `--project`, the installer appends `.claude/memory/personal.md` to your project's `.gitignore`. This keeps personal preferences local and out of the shared repo.
