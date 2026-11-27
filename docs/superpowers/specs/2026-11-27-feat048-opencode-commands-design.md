# FEAT-048 slice 4: `cc-*` commands on OpenCode

**Status:** Approved 2026-11-27 (the user pre-approved the remaining #97 work and asked to start on it)
**Item:** `[FEAT-048]` Multi-Harness Support, issue #97. Slices 1 (OpenCode guard, `1.44.0`) and 2-3 (`[FEAT-063]`, `1.59.0`) are merged; their DONE lines name OpenCode commands as still open.
**Branch:** `feat/feat-048-opencode-commands`

## Problem

`--project --opencode` installs only the guard plugin. An OpenCode user has no `/cc-spec`, `/cc-plan`, `/cc-implement` or the rest; README's OpenCode table says so ("Not installed for OpenCode yet"). FEAT-048's acceptance criteria require the commands in each harness's own layout, generated from the `.claude/` sources and checked for drift.

## Measured on 2026-11-27 (source of OpenCode v1.19.6, the latest release, plus an offline probe)

| Fact | Evidence |
|---|---|
| Project commands load from `.opencode/{command,commands}/**/*.md`; frontmatter keys are the command's config, the body is its `template` | `packages/opencode/src/config/command.ts` `load()`; `config.ts:439` loads it only for `.opencode` directories, so `.claude/commands/` is never read |
| `$ARGUMENTS` is replaced by the user's text; `$1`, `$2`... by positional arguments | `session/prompt.ts:1376-1391` |
| After substitution, every `` !`…` `` in the template is run in the user's shell and replaced by its output, outside any tool call | `prompt.ts:1397-1407`, `SHELL_REGEX = /!`([^`]+)`/g` in `config/markdown.ts` |
| Every `@name` not preceded by a word character or a backtick attaches the file or directory `name` (relative to the worktree), or an agent of that name, outside any tool call | `prompt.ts:157-191`, `FILE_REGEX` in `config/markdown.ts` |

The guard plugin hooks `tool.execute.before`, so neither the shell run nor the file attach passes through the guard.

**Offline probe** (the three regexes above over the 18 rendered command bodies): rendered verbatim, OpenCode would act on 6 tokens in 4 commands: one shell run in `cc-implement` (the `` `!` `` code span at its step 3 opens a match that runs `):` plus the following text as a shell command and swallows the template up to the next backtick), and file attaches of `deprecated"` and `code` (`cc-docs`) and `($resume_out)` (`cc-implement`, `cc-plan`, `cc-spec`). With the neutralization below: 0.

OpenCode is not installed on the measuring machine and installing it was not permitted in this session, so the result is not live-run here; the POC's 1.18.33 live run loaded commands from `.opencode/command/`.

## Variants considered

- **A. Verbatim** (the Antigravity render as is): fails, since a shipped command would run a shell command the guard never sees.
- **B. Verbatim plus a fixed neutralization (chosen):** two ASCII rewrites that OpenCode's regexes cannot match and a reader can undo: `` !` `` becomes `` ! ` `` and an attachable `@x` becomes `@ x`. The preamble says so. No source changes, so no Claude Code file changes.
- **C. Stub commands that point the model at a skill:** depends on the model choosing to load it, and a long body read hits Guard 1. Rejected.

## Solution

`lib/installer/harness-commands.mjs` gains a third render per command: `.opencode/command/cc-<name>.md`, frontmatter `description` (the source description), then an OpenCode preamble (the shared `PREAMBLE` plus one sentence on the inserted spaces), then the source body with both rewrites applied. `staleRenders` and `--write` cover the new folder. `--project --opencode` copies `.opencode/command/` next to the guard plugin with the same `copyRenderedCommands` step Antigravity and Codex use.

## Behavior
- `code-conductor --project --opencode` installs the guard plugin and `.opencode/command/cc-*.md`; `/cc-spec` in OpenCode runs the spec command.
- `--opencode` without `--project` still warns and writes nothing; a Claude Code install is unchanged byte for byte.
- Host files in `.opencode/command/` with other names are left alone; `cc-*` files are managed and overwritten on re-run.
- `node lib/installer/harness-commands.mjs --write` regenerates all three render sets.

## Acceptance Criteria
- [ ] Every `cc-*.md` source has exactly one rendered OpenCode command, and the drift test covers it.
- [ ] The rendered frontmatter is the source description; the body is the preamble plus the source body with only the two rewrites.
- [ ] A test applies OpenCode v1.19.6's `SHELL_REGEX`, `FILE_REGEX` and `$N` placeholder regex to every rendered OpenCode command and finds no match (no non-empty file name), so a future source that adds one fails.
- [ ] Review round 1: `$ARGUMENTS` next to a backtick (preamble included) is spaced apart, because OpenCode substitutes it before the shell pass and an argument ending in `!` would complete a trigger; a dot-led `@.env` or `@.` is spaced out too. A test re-checks every render with sample arguments ending in `!` and `@` substituted.
- [ ] `--project --opencode` installs the commands; without `--opencode` nothing is written under `.opencode/`; host files with other names survive.
- [ ] README's OpenCode section states the commands are installed and the two rewrites.
- [ ] Zero new runtime dependencies.

## Out of Scope
- Band agents and context injection on any harness (still open on #97).
- `$ARGUMENTS` text that itself contains `` !`…` ``: OpenCode substitutes it before the shell pass, so a user's own argument can run a command they typed. That is OpenCode's behavior for any command and is documented, not changed.
- Changing any `.claude/commands/` source.
- A live OpenCode run (needs the CLI installed; noted in the PR).

## System Impact
- `lib/installer/harness-commands.mjs`, `lib/installer/deploy.mjs`.
- New generated files under `project-template/.opencode/command/`; `.gitignore` gains only the leaf lines for this spec and its plan (`project-template/` is not under an ignored root).
- Tests: `tests/installer/harness-commands.test.js`, `tests/installer/deploy.test.js`, and the `[BUG-069]` pin in `tests/installer/templates.test.js`, which today allows only `plugin/conductor-guard.js` under `project-template/.opencode/`. Its purpose (no shipped file silently left uninstalled) is kept: it now allows the plugin plus exactly the rendered `command/cc-*.md` set, which the new copy step installs.
- README OpenCode section.

## Complexity Estimate
**S.** One more render target, one rewrite function, one copy step on an existing flag.
