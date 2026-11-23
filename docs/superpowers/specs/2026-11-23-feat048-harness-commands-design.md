# FEAT-048 slice 3: `cc-*` commands on Antigravity CLI and Codex CLI

**Status:** Approved 2026-11-23 (the user pre-approved the remaining #97 work: "avanza, aprueba todo")
**Item:** `[FEAT-048]` Multi-Harness Support, issue #97. Slice 2 (guards on agy and Codex) is PR #303; this branch stacks on it.
**Branch:** `feat/feat-048-harness-commands`

## Problem

After slice 2 an Antigravity or Codex user is guarded but has no workflow: `/cc-spec`, `/cc-plan`, `/cc-implement` and the rest exist only as Claude Code commands under `.claude/commands/` and `~/.claude/commands/`. The #97 acceptance criteria also require these files to be generated from the `.claude/` sources and checked for drift, never hand-copied.

## Measured on 2026-11-23 (Windows 11)

| Fact | Antigravity CLI 1.5.15 | Codex CLI 0.171.0 |
|---|---|---|
| Project slash commands | `.agents/workflows/<name>.md`, frontmatter `description`; `agy -p "/probe-flow"` ran the workflow body (**live**) | None at project level (custom prompts live only in the user's `~/.codex/prompts`) |
| Project skills | `.agents/skills/<name>/SKILL.md` discovered, name and description preloaded, body read on use (**live**) | `.agents/skills/<name>/SKILL.md` discovered by name (**live**) |

## Solution

A generator, `lib/installer/harness-commands.mjs`, renders every `cc-*` command from `project-template/.claude/commands/` and `global/commands/` into:
- **Antigravity workflows:** `project-template/.agents/workflows/cc-<name>.md`, invoked as `/cc-<name>`.
- **Codex skills:** `project-template/.agents/skills/cc-<name>/SKILL.md`, which Codex uses when the user asks for `cc-<name>` by name.

Each rendered file keeps the source body unchanged and adds one fixed preamble: the text was written for Claude Code, a named Claude Code tool means the harness's closest equivalent, and `$ARGUMENTS` means the text the user gave with the command. The rendered files are committed; a drift test re-renders them and fails on any difference. `--antigravity` also installs the workflows and `--codex` the skills, so neither flag changes a Claude Code install.

## Behavior
- `code-conductor --project --antigravity` copies `.agents/workflows/cc-*.md` next to the slice 2 guard; `/cc-spec` in agy runs the spec workflow.
- `code-conductor --project --codex` copies `.agents/skills/cc-*/SKILL.md`; asking Codex to "use cc-spec" loads that skill.
- Host files in `.agents/workflows/` and `.agents/skills/` with other names are left alone; `cc-*` files are managed and overwritten on re-run.
- Running `node lib/installer/harness-commands.mjs --write` regenerates the template files after a command changes.

## Acceptance Criteria
- [ ] Every `cc-*.md` in `project-template/.claude/commands/` and `global/commands/` has exactly one rendered workflow and one rendered skill; no other `cc-*` files are rendered.
- [ ] The drift test fails when a source command changes without regenerating.
- [ ] Rendered skill frontmatter has `name: cc-<name>` and the source description; workflow frontmatter has the source description.
- [ ] `--antigravity` installs the workflows, `--codex` installs the skills, neither installs without its flag, and host files with other names survive.
- [ ] Live: agy runs a rendered workflow; Codex lists a rendered skill.
- [ ] Zero new runtime dependencies.

## Out of Scope
- OpenCode commands: OpenCode is not installed on the measuring machine, so its layout is not measured here.
- Band agents (`.claude/agents/`) and the orchestrator: they depend on Claude Code's Agent tool.
- Context injection (`UserPromptSubmit`): measured as firing on Codex, still a separate item.
- Rewriting command bodies per harness.

## System Impact
- New `lib/installer/harness-commands.mjs`; `lib/installer/deploy.mjs` installs the folders under the existing flags.
- New generated files under `project-template/.agents/workflows/` and `project-template/.agents/skills/`.
- Tests: new `tests/installer/harness-commands.test.js`; additions to `tests/installer/deploy.test.js`.
- README Antigravity/Codex subsections, backlog entry.

## Complexity Estimate
**S/M.** One pure renderer, a drift test and two copy steps on flags that already exist.
