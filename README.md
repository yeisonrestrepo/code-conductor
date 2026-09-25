# code-conductor

[![npm version](https://img.shields.io/npm/v/%40yeison.restrepo.r%2Fcode-conductor.svg)](https://www.npmjs.com/package/@yeison.restrepo.r/code-conductor)
[![License](https://img.shields.io/github/license/yeisonrestrepo/code-conductor.svg)](https://github.com/yeisonrestrepo/code-conductor/blob/main/LICENSE)
[![GitHub issues](https://img.shields.io/github/issues/yeisonrestrepo/code-conductor.svg)](https://github.com/yeisonrestrepo/code-conductor/issues)

A spec-first, token-efficient Claude Code configuration that turns AI-assisted coding into a disciplined, repeatable engineering workflow.

---

## Dependencies

code-conductor assumes these are already in place — the installer does not set them up for you:

| Dependency | Required for | How to get it |
|---|---|---|
| Node.js `>= 20` | Running the `code-conductor` CLI itself | Any current Node LTS |
| Claude Code | The environment every command/skill/hook in this repo runs inside | — |
| **superpowers plugin** | `/cc-spec` (`brainstorming`), `/cc-plan` (`writing-plans`), and `/cc-debug`, `/cc-refactor`, `/cc-review`, `/cc-test` (all four via `subagent-driven-development`) | Install from Claude Code's `/plugin` marketplace, then run `/reload-plugins`, **before** using these commands — without it, their `Skill(...)` calls fail |
| ui-ux-pro-max skill | UI/UX guidance on frontend projects | No manual step — the installer downloads it from GitHub automatically when `/cc-stack` detects a frontend stack |

---

## The Problem

AI coding assistants are only as good as the structure you put around them. Without it, sessions drift: the agent overwrites files it shouldn't, skips the spec, reads entire codebases line by line, and produces code that solves the wrong problem efficiently. The result is fast output with slow outcomes — more rewrites, more context lost, more tokens burned. code-conductor is the structure.

| Without code-conductor | With code-conductor |
|---|---|
| Free-form prompt → agent guesses, overwrites, drifts | `/cc-spec` → approved spec → `/cc-plan` → confirmed steps → implement |
| Full files read on every turn | grep/find before read — targeted tool calls only |
| Conventions reset every session | Stack profile + memory loaded at session start |
| Frontend code with no UX consideration | UI/UX skill activated automatically for frontend stacks |
| Manual CLAUDE.md with `<command>` placeholders | **Stack auto-detection** — `code-conductor --project` reads your `package.json`, `go.mod`, `Cargo.toml`, etc. and auto-fills CLAUDE.md Development Commands so the agent never guesses your build/test/lint commands |
| Verbose markdown handoffs eat context | **SNAP v1**: minified single-line JSON handoff format, schema-validated by `scripts/snap-validate.mjs`, ≥15% smaller than the markdown snapshot it replaces |

---

## Install

```bash
npx @yeison.restrepo.r/code-conductor            # one-shot global setup
# or
npm install -g @yeison.restrepo.r/code-conductor && code-conductor
```

### Add to a project

`--project` performs the global setup **and** scaffolds the project template in one call — there is no separate step to run first:

```bash
code-conductor --project      # global setup + scaffold ./.claude in the current repo
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

> **Note:** Do not clone this repository into a parent directory named `graphify-out` or `node_modules`. Guard 4 checks path components and will block agent `Read` calls on source files if the repository root is nested inside such a directory. Use relative paths if this layout is unavoidable.

---

## How It Works

code-conductor operates at three layers:

**Global core** (`~/.claude/`) — applies to every project on your machine. Enforces the spec-first workflow, token efficiency rules, safety checks, code simplicity rules, and memory conventions. Installed once; always active.

**Project template** (`.claude/`) — lives in your repo and is shared with your team via git. Adds project-specific slash commands, hooks that guard file writes, and a shared memory file for decisions, conventions, and technical debt.

**Dynamic stack discovery + skills** — `/cc-stack` runs the bundled `detect-stack.mjs` scanner and writes your detected build/test/lint/format commands plus a concise, generated ruleset straight into your project `CLAUDE.md`. Skills extend the agent's behavior for cross-cutting concerns like code simplicity and UI/UX.

---

## Available Commands

All commands are tagged `(Conductor)` in the Claude Code command palette so they're easy to spot alongside commands from other sources.

### Global (all projects)

| Command | Description |
|---------|-------------|
| `/cc-checkpoint` | Read the current session, extract decisions, conventions, and debt, then write them to `project.md` and `personal.md` with a timestamp. Run before `/compact`, after completing a feature, and after key architectural decisions. |
| `/cc-stack` | Run the dynamic detector to identify your framework and write the detected commands and a generated ruleset into your project `CLAUDE.md`. |
| `/cc-lang [code]` | Switch response language for this session. Code identifiers, filenames, and commit messages remain English regardless. |

### Project (requires `--project` install)

| Command | Description |
|---------|-------------|
| `/cc-resume` | Restore full session context in one command: reads project identity, memory, latest spec and plan, git state, and loads the stack profile. Scans the active plan for `[>]` (interrupted) and `[!]` (failed) task markers and surfaces them in the session report. Run at the start of every session after initialization. |
| `/cc-init` | Initialize or re-sync the project environment: detect stack, checkpoint memory, refresh the project graph, and verify hook integrity. Run at the start of every session. |
| `/cc-spec [name]` | Search the codebase first, ask only for missing context, generate a full feature spec, and wait for your approval before any plan is made. |
| `/cc-plan` | Require an approved spec, map the codebase, and generate an ordered implementation plan with exact file paths, a test list, a commit order, and identified risks. Every generated task line carries a unique `[T-NNN]` ID (min 3 digits, unlimited suffix depth) using plain ASCII checkboxes — enforced at generation time. |
| `/cc-compact` | Phase-boundary command. Serializes the current phase's essential state (decisions, pending steps, files touched, constraints) into a single-line SNAP JSON snapshot at `.claude/memory/session-snapshot.json` — and, when Node `>= 22.5` is available, a git-hash-keyed row in the local `.conductor/cache.db` — then prompts you to run `/compact` to clear conversation history. Run at the end of every phase to prevent context overflow. |
| `/cc-implement` | Execute implementation tasks from an approved plan using a surgical 5-step ritual: Grep-locate pending tasks → single-line Read verify → pre-flip `[ ]` to `[>]` → execute → post-flip to `[X]` or `[!]`. Never reads or rewrites the full plan file. Includes dependency evaluation, drift detection, and a Step 6 hook that records each task's final state to a local SQLite cache (see below). |

Each of `/cc-spec`, `/cc-plan`, and `/cc-implement` opens its phase with a **resume read** (`scripts/resume-read.mjs`): it restores any context stored for the current git commit, so work survives branch switches and rollbacks (see [Local State Cache & Session Persistence](#local-state-cache--session-persistence--v1220)).
| `/cc-review [file\|dir]` | Review code in three layers - Critical / Important / Suggestion - then deliver a verdict and offer to auto-fix. |
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

Activated automatically when `/cc-stack` detects a frontend stack (React, Angular, Next.js, and similar). Installed from [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) — the installer downloads it directly from GitHub. Enforces visual hierarchy, spacing grids, semantic color tokens, component states, WCAG AA accessibility, and framework-specific UI conventions.

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

1. **Project memory**: `.claude/memory/project.md`
2. **Graphify graph** — structural/relational queries (`what calls X`, `what depends on Y`)
3. **Grep / Glob** — pattern searches
4. **Targeted read** — last resort, always with `offset` + `limit`, max 150 lines

### agent-delegation — always active

Keeps the main context clean. Sub-agents handle exploration and parallel work; they return a ≤200-word summary to the main context. Raw file contents and intermediate data never enter the main context.

---

## Hooks

Hooks run automatically at specific points in a Claude Code session. They require no manual setup.

### graphify-ast-refresh *(global)*

Fires on every `UserPromptSubmit`. A small Node wrapper (`graphify-ast-refresh.mjs`) checks whether `graphify-out/.graphify_ast_done` is fresh (default: 60 min, override with `GRAPHIFY_STALE_MINUTES`). If it is stale or missing, the wrapper looks for a `python3` or `python` on `PATH` (override with `GRAPHIFY_PYTHON`) and spawns the Python payload (`graphify-ast-refresh.py`) in the background to run file detection and AST extraction - no LLM calls, no tokens. The main session inherits a ready graph without paying the generation cost.

Node hosts the check because Python is what is being probed: on a machine with no Python the wrapper exits 0 in silence rather than printing an interpreter error on every prompt. Set `CC_GRAPHIFY_DEBUG=1` to see the one line it would otherwise swallow. Works on Windows, Linux, and macOS, and returns immediately when the graph is current.

### pre-tool-use

Fires before `Read`, `Write`, `Edit`, `create_file`, `write_file` and `Bash`. A single zero-dependency Node front door (`pre-tool-use.mjs`) reads the `PreToolUse` payload from stdin, dispatches on `tool_name`, and returns its verdict as `hookSpecificOutput.permissionDecision`. Every path exits 0: a denial is data, never an exit code.

**Large-file Read guard (Guard 1)** - a `Read` of a file over 150 lines that names no `limit` is denied, and the reason redirects Claude to the orchestrator lookup chain (memory, graph, grep, targeted read). Prevents reading entire codebases when a targeted search would do.

**Duplicate file guard (Guard 2)** - a `Write`, `create_file` or `write_file` naming a path that already exists returns `ask`, showing the path, line count and last-modified timestamp with three options: edit in place, confirm the overwrite, or cancel. `Edit` is deliberately not gated, because editing in place is the action this guard recommends.

**Bash scan guard (Guard 3)** - not shipped yet. `Bash` already routes to the guard's slot and the slot is empty. The twelve-pattern scanner is verified in this repository against `tests/fixtures/guard3-reference.sh` and ships in `[BUG-037]`.

**graphify-out and node_modules guard (Guard 4)** - a `Read` whose path carries `graphify-out` or `node_modules` as an exact path component is denied, with backslashes and `..` resolved first. Use Glob for existence checks and the graphify skill for graph questions.

Input the hook cannot parse fails closed: it is denied with one stderr line naming `CC_HOOK_ALLOW=1`, which overrides that denial alone and leaves every guard fully active on every payload the hook can read. Set `CC_HOOK_DEBUG=1` to see the diagnostic lines it otherwise swallows.

### context-guard *(global + project)* — v1.15.0

Fires on every `UserPromptSubmit`. Atomically increments a turn counter in `.claude/memory/turn-count.txt`. At 80% of the configured threshold it emits ⚠ CONTEXT WARNING; at or above the threshold it emits 🚨 CONTEXT CRITICAL. The threshold is read from `.claude/memory/context-threshold.txt` (default: 25). After `/compact`, the `post-compact` hook resets the counter to 0.

Available on both Unix (`context-guard.sh`) and Windows (`context-guard.ps1`). Set `CC_GUARD_DEBUG=1` to print debug info to stderr. Set `CC_PROJECT_ROOT` to override the project root used for the memory directory.

### post-compact

Fires after `/compact`. Resets the turn counter to 0, reads `project.md`, shows the timestamp of the last `/cc-checkpoint`, and reminds you to run `/cc-checkpoint` if context from this session hasn't been saved yet. Prevents losing decisions and conventions when the context window is compressed.

### verbosity-remind *(global + project)* — v1.11.0

Fires on every `UserPromptSubmit`. Re-injects the active MIN/INFO/VERBOSE verbosity constraint before every Claude response, preventing level drift as the context window fills (BUG-014).

The global hook defers to a project-level hook if one exists (upward traversal from `$PWD`). The active level is read from the nearest `.claude/memory/verbosity.md` ancestor file. Set `CC_VERBOSITY_SKIP=1` to disable in CI/CD environments.

> **Note — `$HOME` unset environments:** When `$HOME` is unset (e.g., some CI containers, `sudo -H` shells, minimal Docker images), `verbosity-remind.sh` exits immediately with code 0 and emits no output. Claude falls back to MIN verbosity by default. Set `HOME=/root` (or the appropriate home directory) in the container environment to restore full hook behavior. The hook never raises an error when `$HOME` is absent — it degrades gracefully to ensure the user's session is never blocked.

---

## Local State Cache & Session Persistence — v1.22.0

`/cc-implement`'s Step 6 hook records each task's final state to a local SQLite cache at `.conductor/cache.db`, written by the bundled `scripts/conductor-db.mjs` engine — a zero-dependency ES module wrapping Node's built-in `node:sqlite`.

- **Schema (v2, ARCH-008):** `task_state(plan_file, task_id, state, updated_at)` keyed by `(plan_file, task_id)` — `plan_file` normalized to a repo-relative POSIX path so the same plan de-duplicates across working directories — plus `sessions`, `snapshots` (one verbatim SNAP blob per git commit, newest wins), and `raw_history`. Upserts on every write.
- **Runtime-gated:** `node:sqlite` needs Node `>= 22.5`, so every caller probes the Node version and self-disables below it. `engines.node` stays `>=20`; the cache is an optimization, never a requirement.
- **Non-authoritative + fail-safe:** the plan markdown and the `.claude/memory/session-snapshot.json` handoff remain the sources of truth. Every failure path — absent `node:sqlite`, a corrupt or non-regular file at the db path, `SQLITE_BUSY`, a newer schema, CLI misuse — degrades to a single `CONDUCTOR_DB:` stderr line and exit 0. A corrupt db is renamed aside (never `rm -r`) and recreated.
- **Gitignored:** `.conductor/` is local-only and never committed.

### Phase-entry resume — v1.22.0

`/cc-spec`, `/cc-plan`, and `/cc-implement` open each phase by running `scripts/resume-read.mjs`, which resolves the current git commit hash and restores any context stored for it — surviving branch switches and rollbacks. A valid DB snapshot for the commit wins; otherwise it falls back to the `.claude/memory/session-snapshot.json` handoff written by `/cc-compact`. A hit prints a `RESUME_HIT` block the command adopts as its starting context; a clean miss proceeds fresh; a readable-but-corrupt handoff halts the phase (exit `4`) with a `SNAP_INVALID` notice so you can inspect it. This completes the **ARCH-008** milestone: relational schema (v1.20.0) → checkpoint/compact writers (v1.21.0) → phase-entry readers (v1.22.0).

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

`/cc-stack` records the detected stack in your project `CLAUDE.md` (the `- Stack:` line and the `## Active Stack Profiles` block); on later sessions it asks whether anything changed before re-detecting.

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
├── bin/code-conductor.mjs        npm CLI entry (npx code-conductor)
├── lib/installer/                CLI modules (env, deploy, settings, config)
├── global/
│   ├── CLAUDE.md                 Global agent behavior (all projects)
│   ├── settings.json
│   ├── commands/
│   │   ├── cc-checkpoint.md      /cc-checkpoint
│   │   ├── cc-stack.md           /cc-stack
│   │   └── cc-lang.md            /cc-lang
│   ├── hooks/
│   │   ├── graphify-ast-refresh.mjs Node wrapper: freshness + interpreter check
│   │   └── graphify-ast-refresh.py  Background AST refresh on UserPromptSubmit
│   └── memory/
│       └── personal.md           Template (never committed)
├── project-template/
│   ├── CLAUDE.md
│   ├── gitignore                 Merged into the host project's .gitignore
│   └── .claude/
│       ├── settings.json         Hooks wiring (pre-tool-use, post-compact)
│       ├── commands/
│       │   ├── cc-init.md        /cc-init — session initialization
│       │   ├── cc-resume.md      /cc-resume — session context restore
│       │   ├── cc-spec.md        /cc-spec
│       │   ├── cc-plan.md        /cc-plan
│       │   ├── cc-implement.md   /cc-implement
│       │   ├── cc-review.md      /cc-review
│       │   ├── cc-compact.md     /cc-compact — phase boundary compaction
│       │   ├── cc-debug.md       /cc-debug
│       │   ├── cc-refactor.md    /cc-refactor
│       │   ├── cc-test.md        /cc-test
│       │   └── cc-docs.md        /cc-docs
│       ├── hooks/
│       │   ├── pre-tool-use.mjs  Node front door: large-file, duplicate-write and graphify-out guards
│       │   ├── context-guard.sh  Turn-counter warning (.sh + .ps1)
│       │   └── post-compact.sh   Checkpoint reminder + cache sweep after `/compact` (.sh + .ps1)
│       └── memory/
│           └── project.md        Shared team memory (in git)
├── scripts/
│   ├── conductor-db.mjs          Zero-dep node:sqlite engine (.conductor/cache.db)
│   ├── resume-read.mjs           Phase-entry resume reader (DB snapshot → handoff fallback)
│   ├── snap-build.mjs            SNAP v1/v2 handoff serializer
│   ├── snap-validate.mjs         SNAP schema validator
│   ├── session-id.mjs            Stable session-id resolver
│   └── detect-stack.mjs          Stack auto-detection scanner
└── skills/
    ├── code-simplifier/SKILL.md   Always active — complexity and simplicity rules
    ├── critical-review/SKILL.md   Always active — 4-phase adversarial review protocol
    ├── verbosity/SKILL.md         Always active — MIN/INFO/VERBOSE response rules
    ├── memory-first/SKILL.md      Always active — memory → graph → grep → read chain
    └── agent-delegation/SKILL.md  Always active — sub-agent spawn rules
    # Claude Code registers personal skills only at ~/.claude/skills/<name>/SKILL.md
    # ui-ux-pro-max installed from github.com/nextlevelbuilder/ui-ux-pro-max-skill
```

---

## .gitignore Note

When installed with `--project`, the installer appends these rules to your project's
`.gitignore`, and only the ones you are missing — your own entries are never touched:

```
.claude/memory/turn-count.txt
*.installer-backup.*
*.installer-tmp.*
```

The last two keep the installer's own backups and crash-stranded temp files out of
`git status`. The rules ship inside the package as `project-template/gitignore`
(no leading dot) because npm strips any file literally named `.gitignore` from every
published tarball; the installer restores the dot when it writes to your project.

---

## How the installer treats your CLAUDE.md

`CLAUDE.md` and `.gitignore` are **merged**, never overwritten. Everything else the
installer ships (`settings.json`, hooks, commands, `scripts/`) is replaced on every run.

- **Managed sections** live between `<!-- cc:managed:start -->` and `<!-- cc:managed:end -->`.
  Code Conductor owns that block and replaces its contents wholesale on every upgrade, so
  released improvements reach existing installs. Edits inside the block are lost.
- **Everything outside the block is yours.** Existing sections are preserved byte-for-byte;
  sections the template has and your file lacks are appended once, immediately above the
  managed block. Sections you wrote that the template has never heard of are never touched.
- **Before any change, the installer copies your file to
  `CLAUDE.md.installer-backup.<UTC timestamp>`** and keeps the five most recent.

> **One-time migration on your first 1.24 install.** If your `CLAUDE.md` predates the
> sentinel markers and already contains sections that the managed block also defines
> (`## Agent Identity`, `## Hard Constraints`, …), **those sections are removed** and
> replaced by the managed block, so you do not end up with two copies of each. This is the
> only path that discards content you wrote. **Your pre-migration file is preserved in the
> `.installer-backup.` copy beside it** — diff it after upgrading and move anything you
> want to keep into a section outside the managed block.

> **A cosmetic wart of that same migration, in `~/.claude/CLAUDE.md` only.** The managed
> block carries the file's intro sentence ("Applies to every project on this machine…"),
> and your pre-sentinel copy keeps its own above the block, so you will see that one
> sentence twice after the first upgrade. Delete the copy above the block — it is outside
> the managed region, so your deletion sticks.

If the markers in your file are damaged — a `start` with no `end`, two blocks, an `end`
before its `start` — the installer prints a warning, leaves the file completely untouched,
and finishes the rest of the install. Fix the markers and re-run.

---

## Uninstall Notes

> **`git revert` in non-repository environments (CI/CD, Docker, bare installs):**
> Uninstall steps that use `git checkout <tag>` or `git revert <sha>` require a git working tree. In CI/CD pipelines, Docker containers, or directories that are not git repositories, these commands will fail with `fatal: not a git repository`. This is expected and non-fatal.
>
> **In non-repo environments:** manually delete or restore `skills/verbosity/SKILL.md` and remove the `verbosity-remind` entry from `~/.claude/settings.json`. Hook removal (`rm ~/.claude/hooks/verbosity-remind.sh`) and `settings.json` cleanup work identically in all environments — no git is required.
