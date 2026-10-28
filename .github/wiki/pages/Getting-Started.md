# Getting Started

## Prerequisites

| Dependency | Required for | How to get it |
|---|---|---|
| Node.js `>= 20` | Running the CLI | Any current Node LTS |
| Claude Code | The environment everything runs inside | [Anthropic's Claude Code docs](https://www.anthropic.com/claude-code) |
| superpowers plugin | `/cc-spec`, `/cc-plan`, `/cc-debug`, `/cc-refactor`, `/cc-review`, `/cc-test` | Install from Claude Code's `/plugin` marketplace, then `/reload-plugins` |
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
| `--project` | Also scaffold `.claude/` in the current directory |
| `--no-deps` / `-NoDeps` | Accepted for compatibility; a no-op, since the npm CLI installs no dependencies |
| `--verbosity MIN\|INFO\|VERBOSE` / `-Verbosity LEVEL` | Response verbosity (default `MIN`). PowerShell's `-Verbosity:INFO` is not supported; it warns and stays `MIN`. |

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
  commands/cc-checkpoint.md
  commands/cc-stack.md
  commands/cc-lang.md
  commands/cc-compact.md
  hooks/verbosity-remind.sh
  hooks/context-guard.sh
  memory/personal.md
  memory/verbosity.md
  CLAUDE.md

<project>/.claude/                # Project template
  commands/cc-*.md                # 10 project commands
  hooks/pre-tool-use.mjs          # Guards 1–7
  hooks/context-guard.*           # Turn counter
  hooks/verbosity-remind.*        # Verbosity re-injection
  agents/                         # 6 role agent definitions
  memory/project.md               # Shared team memory
  scripts/detect-stack.mjs        # Stack auto-detection
  settings.json                   # Hook matcher config
```

## Verify it works

```bash
# This should be DENIED by Guard 3 (mass content dump)
cat *.ts

# This should run with no friction
grep -n 'export' src/index.ts
```

If the first command shows `BASH SCAN BLOCKED`, the guards are active.
