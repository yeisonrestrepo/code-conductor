# FEAT-048 slice 3: `cc-*` commands on Antigravity CLI and Codex CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render every `cc-*` command into agy workflows and Codex skills, committed, drift-tested, installed by the existing `--antigravity` / `--codex` flags.

**Architecture:** A pure renderer in `lib/installer/harness-commands.mjs` turns one command file into a workflow text and a skill text; a `--write` entry regenerates `project-template/.agents/`. `deployProject` copies the rendered folders under the flags.

**Tech Stack:** Node ≥22 ESM, `node:` builtins only, vitest.

**Spec:** `docs/superpowers/specs/2026-11-23-feat048-harness-commands-design.md`

## Global Constraints

- Sources: `project-template/.claude/commands/cc-*.md` and `global/commands/cc-*.md`; source bodies are copied unchanged after the preamble.
- Zero new runtime dependencies; a Claude Code install without the flags is unchanged.
- New `/docs` files need `git add -f` plus sorted `.gitignore` leaves.

## Review Focus

1. A source with CRLF line endings renders the same as its LF form.
2. A source with no frontmatter or no `description` fails the render loudly, naming the file.
3. A host `.agents/workflows/mine.md` and `.agents/skills/mine/` survive an install.
4. A deleted source command leaves no stale rendered file (the drift test lists extra files).
5. A description containing a double quote stays valid YAML in the rendered frontmatter.

---

- [X] [T-000] Commit the spec and plan
  - [X] [T-000-A] Add the two `!/docs/superpowers/...` leaves to `.gitignore` in sorted position.
  - [X] [T-000-B] `git add -f` the spec and plan, `git add -u .gitignore`, `git commit -m "docs: add the FEAT-048 slice 3 harness commands spec and plan"`

### Task 1: Renderer and drift test

**Interfaces:**
- `renderCommand(name, text) -> { workflow: string, skill: string }`; throws `Error('<name>: missing frontmatter description')`.
- `renderAll(repoRoot) -> Map<relPath, text>` with keys `.agents/workflows/cc-<x>.md` and `.agents/skills/cc-<x>/SKILL.md`.
- CLI: `node lib/installer/harness-commands.mjs --write` writes `renderAll` into `project-template/` and removes stale `cc-*` renders.

- [X] [T-001] Renderer, generated files and drift test
  - [X] [T-001-A] Write `tests/installer/harness-commands.test.js`: frontmatter shape for workflow and skill; preamble present once; body after frontmatter equals the source body; CRLF source equals LF; missing description throws naming the file; quoted description stays parseable; drift: every `renderAll` entry equals the committed file and no extra `cc-*` render exists.
  - [X] [T-001-B] Implement `lib/installer/harness-commands.mjs`; run `--write`.
  - [X] [T-001-C] Run `npx vitest run tests/installer/harness-commands.test.js`; expected PASS.
  - [X] [T-001-D] Stage the renderer, test, `project-template/.agents/workflows`, `project-template/.agents/skills` and the plan; `git commit -m "feat: render cc-* commands as Antigravity workflows and Codex skills [FEAT-048]"`

### Task 2: Install under the flags

- [X] [T-002] Copy the rendered folders in `deployProject`
  - [X] [T-002-A] Add deploy tests: workflows only with `antigravity`, skills only with `codex`, host `mine.md` / `mine/` kept, neither folder without a flag.
  - [X] [T-002-B] Implement in `lib/installer/deploy.mjs` (copy `.agents/workflows` under `antigravity`, `.agents/skills` under `codex`).
  - [X] [T-002-C] Run `npx vitest run tests/installer/deploy.test.js tests/installer/cli.test.js`; expected PASS.
  - [X] [T-002-D] Live: install into a scratch project, `agy -p "/cc-lang es"`-style run of a rendered workflow, and Codex listing `cc-spec` among its skills.
  - [X] [T-002-E] Stage `lib/installer/deploy.mjs`, `tests/installer/deploy.test.js` and the plan; `git commit -m "feat: install the cc-* commands for Antigravity and Codex [FEAT-048]"`

### Task 3: Docs and PR

- [X] [T-003] Document and open the PR
  - [X] [T-003-A] README Antigravity/Codex rows for commands; backlog slice 3 line.
  - [X] [T-003-B] `git commit -m "docs: document the cc-* commands on Antigravity and Codex [FEAT-048]"`; push; draft PR based on `feat/feat-048-codex-antigravity-guards`, body ending `Code created by Claude Code (Claude Opus 5.5)`.
