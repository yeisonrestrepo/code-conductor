# Changelog

All notable changes to code-conductor are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.3.0] - 2026-05-12

### Added

- **`/cc-init` command** — new session initialization command that chains `/cc-stack` → `/cc-checkpoint` → `/graphify .` → hook integrity check → confirmation report. Run at the start of every session.
- **`system-prompt.md`** — portable Managed Agent system prompt for `agents.create({ system })`. Defines persona, dynamic stack specialization (BACKEND_ONLY / FRONTEND_ONLY / FULLSTACK), graph-first discovery protocol, dependency integrity enforcement, sub-agent delegation table, response tags, and verbosity protocol.
- **`critical-review` skill** — 4-phase adversarial review protocol: Pre-Flight Analysis (Happy Path / Failure Points / Boundary Conditions), Adversarial Review (RESILIENCE / EFFICIENCY / FRICTION), Self-Correction Loop, and mandatory `[VALIDATION]` report. Wired into `/cc-spec`, `/cc-plan`, `/cc-review`, and `/cc-debug`.
- **`[VALIDATION]` response tag** — required closing section on every implementation. Exempt from MIN one-sentence rule; uses compact three-field format at MIN verbosity.
- **Superpowers skill wiring** — all project commands now activate domain-specific skills in Phase 0: `brainstorming` (`/cc-spec`), `writing-plans` (`/cc-plan`), `subagent-driven-development` (`/cc-review`, `/cc-debug`, `/cc-test`), `code-simplifier` + `subagent-driven-development` (`/cc-refactor`).

### Changed

- **`ui-ux` skill replaced by `ui-ux-pro-max`** — the bundled `skills/ui-ux.md` is removed. Both installers now download the skill directly from [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill). All internal references updated.
- **Hook command hardened** — `settings.json` hook commands now use an existence guard: if the hook file is absent, a warning is printed and the operation proceeds (exit 0) rather than blocking with a cryptic shell error.
- **GraphNavigator fallback made actionable** — when `graphify-out/graph.json` is absent, the system prompt now instructs the agent to run `/cc-init` first, then fall back to a defined `Explore` sub-agent search pattern.

### Removed

- `skills/ui-ux.md` — replaced by external `ui-ux-pro-max` skill.
- `initial_prompt.xml` — bootstrapping artifact with no runtime role.
- `.worktrees/feat/token-orchestrator` — stale abandoned worktree from pre-v1.2.0.

---

## [1.2.0] - 2026-05-05

### Changed

- **Command rename:** all 10 commands now use a `cc-` prefix (`/cc-spec`, `/cc-plan`, `/cc-review`, `/cc-debug`, `/cc-refactor`, `/cc-test`, `/cc-docs`, `/cc-checkpoint`, `/cc-stack`, `/cc-lang`) to avoid conflicts with built-in Claude Code commands that share the same names (`/plan`, `/review`, `/debug`, etc.)
- All internal cross-references, both installers, `global/CLAUDE.md`, and `README.md` updated to reflect the new names

---

## [1.1.1] - 2026-05-04

### Fixed

- **Installer hang on blank screen** — version fetch (`VERSION` file lookup) was running before any output, causing a blank terminal if the request was slow or the file didn't exist yet. Moved the banner print before the fetch and added a 5-second timeout (`-TimeoutSec 5` / `--max-time 5`) to both `install.ps1` and `install.sh`.

---

## [1.1.0] - 2026-05-04

### Fixed

- **Windows installer:** re-saved as UTF-8 with BOM to prevent PowerShell 5.1 parse errors — box-drawing characters in the script were being misread as Windows-1252, with byte `0x94` interpreted as a closing `"` and breaking string literals
- **claude-mem (Windows):** added `npm config set legacy-peer-deps true` around the install call to resolve an ERESOLVE peer dependency conflict between `tree-sitter@0.21.1` and `tree-sitter@0.22.4`
- **Graphify (Windows):** replaced `graphify install` with `python -m graphify install` to fix a false-positive `[OK]` status — `CommandNotFoundException` does not update `$LASTEXITCODE`, so the old code always reported success even when the command was not on PATH
- **Graphify (macOS/Linux):** same fix applied to `install.sh` — replaced `graphify install` with `python3 -m graphify install`

### Added

- **Command palette identifier:** all 10 commands now include a `description` frontmatter field showing `(Conductor)` so they are easy to identify alongside commands from other sources in the Claude Code command palette
- **Version tracking:** both installers now save the installed version to `~/.claude/memory/conductor-version.md` and display it in the install banner; re-running the installer shows an update notice when a newer version is available

---

## [1.0.0] - initial release

- Global core: spec-first workflow, token efficiency rules, memory conventions, safety guards
- Project template: `/spec` `/plan` `/review` `/debug` `/refactor` `/test` `/docs`
- Stack profiles: JavaScript, TypeScript, Python, Java, Go, Rust, React, Angular, Next.js, NestJS, Django, Flask
- Skills: `code-simplifier`, `ui-ux`, `verbosity`, `memory-first`, `agent-delegation`
- Hooks: `pre-tool-use` (large-file + duplicate-file guards), `post-compact` (checkpoint reminder)
- Dependencies: `claude-mem`, Playwright MCP, Superpowers plugin, Graphify
