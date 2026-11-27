# Getting Started

## Prerequisites

| Dependency | Required for | How to get it |
|---|---|---|
| Node.js `>= 20` | Running the CLI | Any current Node LTS |
| Claude Code | The environment everything runs inside | [Anthropic's Claude Code docs](https://www.anthropic.com/claude-code) |
| superpowers plugin | `/cc-spec`, `/cc-plan`, `/cc-debug`, `/cc-refactor`, `/cc-review`, `/cc-test` | The installer offers it (it asks first; a non-interactive run needs `--with-plugins`). Fallback: `/plugin install superpowers@claude-plugins-official` inside Claude Code, then `/reload-plugins` |
| GitHub CLI (`gh`) | Only `/cc-orchestrate --ticket` | [Install GitHub CLI](https://cli.github.com/), then `gh auth login` |

## Installation

**Minimum safe version: `1.34.4`.** Always install `@latest`.

### Global only (all projects get the core)

```bash
npx @yeison.restrepo.r/code-conductor@latest
```

### Global + project scaffold

```bash
npx @yeison.restrepo.r/code-conductor@latest --project
```

### Flags

| Flag | Description |
|---|---|
| `--project` / `-Project` | Also scaffold `.claude/` in the current directory. Refused, before anything is written, in a clone of code-conductor itself |
| `--no-deps` / `-NoDeps` | Accepted for compatibility with the retired shell installers; a no-op that does not affect the superpowers offer |
| `--verbosity MIN\|INFO\|VERBOSE` / `-Verbosity LEVEL` | Response verbosity (default `MIN`; also `--verbosity=INFO`). An invalid value warns and falls back to `MIN`. PowerShell's `-Verbosity:INFO` is not supported; it warns and stays `MIN` |
| `--opencode` | With `--project`, also install the OpenCode guard plugin at `.opencode/plugin/conductor-guard.js`, which sends OpenCode's `bash`, `read`, `write`, `edit`, `multiedit`, patch and `task` calls to the project's own guard, lets read-only tools through, and blocks every other tool. Also install the `cc-*` commands in `.opencode/command/`, and the band agents in `.opencode/agent/` as `conductor-<role>` subagents. Also install `.opencode/plugin/conductor-context.js`, which adds the verbosity and context-guard lines to each of your prompts. Without `--project` it warns and writes nothing for OpenCode |
| `--antigravity` | With `--project`, also install the Antigravity CLI (`agy`) guard: `.agents/hooks/conductor-guard.mjs` plus a `PreToolUse` entry merged into `.agents/hooks.json`. It maps `run_command`, `read_file`, `write_file` and `edit_file` to the project's own guard and blocks every other tool. Without `--project` it warns and writes nothing for Antigravity |
| `--codex` | With `--project`, also merge into `.codex/hooks.json` a `PreToolUse` entry that runs the project's own guard and a `UserPromptSubmit` entry that injects the verbosity and context-guard lines; trust them once in Codex with `/hooks`. Without `--project` it warns and writes nothing for Codex |
| `--with-plugins` | Install the superpowers plugin without asking (`claude plugin install superpowers@claude-plugins-official`); a non-interactive run installs it only with this flag. On any failure the installer prints the manual command and still exits 0 |
| `--version`, `-v` | Print the version and exit |
| `--help`, `-h` | Print usage and exit |

Any other argument is reported as unrecognized on stderr and ignored; the install continues. The installer offers the superpowers plugin (it asks first, or installs it with `--with-plugins` when non-interactive); Claude Code and `gh` stay yours to set up (see Prerequisites).

## Your First Session

```bash
# 1. Install into your project
cd your-project
npx @yeison.restrepo.r/code-conductor@latest --project

# 2. Commit the scaffold
git add .claude/ && git commit -m "chore: add code-conductor scaffold"

# 3. Start Claude Code and resume context
/cc-resume

# 4. The workflow
/cc-spec user-auth        # write spec → wait for approval
/cc-plan                  # write plan → wait for approval
/cc-implement             # execute tasks one by one
/cc-checkpoint            # save decisions to memory
```

## What the installer creates

```
~/.claude/                        # Global core (all projects)
  CLAUDE.md                       # Managed block merged; your content kept
  settings.json                   # verbosity-remind hook entry merged in
  commands/cc-checkpoint.md
  commands/cc-stack.md
  commands/cc-lang.md
  commands/cc-compact.md
  hooks/verbosity-remind.sh       # The only global hook
  skills/<name>/SKILL.md          # The five skills
  memory/personal.md              # Seeded once, never overwritten
  memory/verbosity.md             # Level from --verbosity
  memory/conductor-version.md     # Installed version

<project>/                        # With --project
  CLAUDE.md                       # Managed block merged
  .gitignore                      # One labelled Code Conductor block
  .claude/commands/cc-*.md        # 11 project commands
  .claude/agents/                 # 6 agents: spec, plan, code, audit, qa, define-review
  .claude/hooks/pre-tool-use.mjs  # Guards 1–7
  .claude/hooks/context-guard.sh  # Turn counter (+ .ps1)
  .claude/hooks/post-compact.sh   # Counter reset after /compact (+ .ps1)
  .claude/hooks/verbosity-remind.sh  # Project-level verbosity re-injection
  .claude/memory/                 # project.md, bash-scan-allowlist.txt, context-threshold.txt
  .claude/scripts/*.mjs           # All 11 script CLIs (detect-stack, orchestrate, snap-*, ...)
  .claude/settings.json           # Hook matchers (hooks merged into an existing file)
  .claude/review-loop.settings.json  # Auto-mode exception for the review loop
```

Both the `.sh` and `.ps1` hooks are copied on every platform, and `settings.json` registers both. [Architecture Overview](Architecture-Overview#level-2-containers) shows how these payloads fit together.

## Verify it works

```bash
# This should be DENIED by Guard 3 (mass content dump)
cat *.ts

# This should run with no friction
grep -n 'export' src/index.ts
```

If the first command shows `BASH SCAN BLOCKED`, the guards are active.
