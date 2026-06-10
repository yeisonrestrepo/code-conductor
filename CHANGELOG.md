# Changelog

All notable changes to code-conductor are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.8.0] - 2026-06-10

### Changed

- **`/cc-implement`** (`project-template/.claude/commands/cc-implement.md`) — replaced the 2-line execution stub with a full **Surgical Plan State Ritual**. The agent now locates pending tasks via a targeted `Grep` scan (pattern `\[ \] \[T-\d{3,}(-[A-Z0-9]+)*\]`, `head_limit: 20`, `offset`-based loop with 10-iteration hard cap), verifies each line with a single-line `Read`, pre-flips the checkbox to `[>]` before executing, and post-flips to `[X]` or `[!]` after. Full plan file reads and full file rewrites are eliminated. Includes: 4-state checkbox protocol (`[ ]` / `[>]` / `[X]` / `[!]`), separate comparison-normalization and `old_string`-construction rules (Unicode invisible stripping is comparison-only), dependency evaluation with `PREREQUISITE_IN_PROGRESS` / `DEPENDENCY_FAILED` / `SCAN_LIMIT_EXCEEDED` halts, drift cap (5 mismatches → `VERIFY_DRIFT_EXCEEDED`), pre-flip retry cap (3 failures → mark `[!]` and halt), and a Step 6 hook (no-op conditional on `.conductor/cache.db`).
- **`/cc-plan`** (`project-template/.claude/commands/cc-plan.md`) — added **Task ID Requirements** section to the plan generation rules. Every generated task checkbox line must carry a unique alphanumeric ID with at least three digits (`T-001`) and unlimited suffix depth (`T-NNN(-[A-Z0-9]+)*`). IDs must be unique within the file; checkbox brackets must use plain ASCII `[ ]` (U+0020 only, no Unicode invisible characters). Applies to newly generated plans only; no retroactive addition to existing files.
- **`/cc-resume`** (`project-template/.claude/commands/cc-resume.md`) — added **Step 6a** between the plan-file discovery step and the git-state step. If a plan file was found, Step 6a scans it for `[>]` (in-progress) and `[!]` (failed) markers, extracts task IDs, and stores counts for the report. The Step 9 **Active Work** block now includes optional `In-progress` and `Failed` lines (omitted when no matches are found).
- All three commands mirrored identically to `project-template/.claude/commands/`.

### Fixed

- **BUG-003: Inefficient Plan State Persistence** — the full-file read/write loop in `/cc-implement` caused O(N²) token growth for long plans (one full read + one full rewrite per step). The surgical ritual reduces each step to a constant number of targeted tool calls regardless of plan length.

---

## [1.7.0] - 2026-06-09

### Added

- **`/cc-compact` command** (`global/commands/cc-compact.md`) — new phase-boundary slash command that serializes the current phase's essential state into a ≤300-token snapshot file (`.claude/memory/session-snapshot.md`) and prompts the user to run `/compact`. Fixes BUG-001: context accumulation was growing at O(N²) as Superpowers skills re-injected instructions into history on every turn, exhausting the Claude Pro context window within an hour of continuous development.
- **`/cc-implement` command** (`project-template/.claude/commands/cc-implement.md`) — new command for the implementation phase, carrying the Phase Handoff Enforcement check and the Destructive Read Invariant at entry.

### Changed

- **`/cc-spec`** (`project-template/.claude/commands/cc-spec.md`) — added **Destructive Read Invariant** at phase entry (reads then immediately deletes `session-snapshot.md` if present) and a **Phase exit** block that prompts the user to run `/cc-compact` before starting `/cc-plan`.
- **`/cc-plan`** (`project-template/.claude/commands/cc-plan.md`) — added **Phase Handoff Enforcement** check (halts with standby prompt if turn count exceeds 5) and **Destructive Read Invariant** at phase entry; added **Phase exit** block prompting `/cc-compact` before implementation.
- **`/cc-review`** (`project-template/.claude/commands/cc-review.md`) — added **Phase Handoff Enforcement** check and **Destructive Read Invariant** at phase entry.
- **`.gitignore`** — added `.claude/memory/session-snapshot.md` (session-local file, must not be committed).

### Fixed

- **BUG-001: Context overflow via Superpowers redundancy** — phase boundary mechanism eliminates O(N²) context growth by snapshotting and clearing history at each phase transition instead of carrying the full conversation forward.

---

## [1.6.0] - 2026-05-25

### Changed

- **`/cc-resume` update check** (`project-template/.claude/commands/cc-resume.md`) — added Step 8 that fetches the remote `VERSION` file and compares it to the locally installed version in `~/.claude/memory/conductor-version.md`. If a newer version is available, an `⚡` notice is included at the top of the Session Resume report with the update command. Network failures are silently ignored. Previous Steps 8–9 renumbered to 9–10.

---

## [1.5.1] - 2026-05-25

### Added

- **`LICENSE`** — Apache 2.0 license (copyright 2026 Yeison Restrepo). GitHub detects and displays it automatically on the repo page.
- **`CONTRIBUTING.md`** — contributor guide covering issue reporting (link to GitHub Issues tab), PR workflow (fork, branch from `main`, one feature per PR, link the issue), code style conventions, and license notice.
- **`.github/pull_request_template.md`** — PR template that auto-fills every new GitHub PR with: Description, Type of change (checkboxes), Related issue field, and Checklist (tested locally, docs updated, changelog entry).

### Fixed

- **`install.sh` / `install.ps1`** — replaced the broken curl/Invoke-WebRequest download of a raw `SKILL.md` file with the correct `uipro-cli` npm package: `npm install -g uipro-cli` is now installed globally (gated on Node.js presence, alongside `claude-mem`), and `uipro init --ai claude` runs in the project block when `--project` is passed. Both scripts include a PATH guard and a `FAILED_DEPS` fallback hint showing the full two-command sequence.

---

## [1.5.0] - 2026-05-25

### Added

- **`/cc-resume` command** (`project-template/.claude/commands/cc-resume.md`) — new command that restores full session context in a single invocation. Reads `CLAUDE.md` (project identity), `.claude/memory/project.md` (latest checkpoint, conventions, debt), `.claude/memory/personal.md` (preferences), the most recently modified spec from `docs/superpowers/specs/` and plan from `docs/superpowers/plans/` (mtime tiebreaker for same-day files), and git log + status. Renders a structured **Session Resume** report then runs `/cc-stack` to fully warm the session. Guards: stops with a clear message if `CLAUDE.md` is absent; continues with a warning if `## Project Identity` is incomplete. Both installers updated to download the command; README command table and file tree updated.

### Fixed

- **`/cc-init` project identity intake** (`project-template/.claude/commands/cc-init.md`) — command now opens with a project-state detection step (`IS_NEW` flag) and a project identity intake step that asks the user for name, description, stack, and language in a single prompt, then writes the answers into `CLAUDE.md`. Previously the command copied an empty template and never populated it.
- **`/cc-init` empty-project guard** — stack detection (`/cc-stack`), memory checkpoint (`/cc-checkpoint`), and graph sync (`/graphify .`) are now skipped when the project directory contains no source files, preventing errors and wasted steps on brand-new repos.
- **`project-template/CLAUDE.md` identity section** — replaced the dead HTML comment placeholder (`<!-- Fill in when installing: ... -->`) with actual fillable fields (`- **Name:**`, `- **Description:**`, `- **Stack:**`, `- **Language:** en`) that `/cc-init` can locate and populate.

---

## [1.4.0] - 2026-05-12

### Added

- **`global/hooks/graphify-ast-refresh.py`** — cross-platform `UserPromptSubmit` hook that checks whether the graphify AST output is stale (default threshold: 60 min, configurable via `GRAPHIFY_STALE_MINUTES`) and spawns a non-blocking background process to run file detection + AST extraction. Exits in under 5ms when the graph is fresh. Works on Windows (`CREATE_NO_WINDOW`), Linux, and macOS (`start_new_session=True`). Deployed by both installers to `~/.claude/hooks/` (skip-if-exists, so user customizations are preserved).

### Changed

- **`global/settings.json`** — added `UserPromptSubmit` hook registration for `graphify-ast-refresh.py` so the hook fires automatically every session.
- **Graphify skill mode dispatch** — `/graphify .` (no flags) now enters **STATUS mode**: reads `graph.json` metadata and prints a compact summary (age, node/edge/community counts, AST vs semantic coverage, uncached file count) without triggering any extraction or subagents. `/graphify query "..."` enters **QUERY mode**: traverses the existing graph; runs targeted semantic extraction only when needed (≤5 uncached files inline, >5 asks first). Full rebuild now requires explicit `/graphify --rebuild`. All other flags (`--mcp`, `--watch`, `add`, `explain`, `path`, etc.) are unchanged.
- **`install.sh` / `install.ps1`** — added `hooks/` to the global directory scaffold and deploy `graphify-ast-refresh.py` to `~/.claude/hooks/` during install.
- **`.gitignore`** — added `graphify-out/` to prevent the per-project knowledge graph cache from appearing in git status.

---

## [1.3.1] - 2026-05-12

### Added

- **`stack-profiles/flutter.md`** — Flutter/Dart profile covering two workspace variants: **single package** (`pubspec.yaml` only — feature-slice structure, Bloc and Riverpod patterns, `dart format`/`flutter analyze`/`flutter test` tooling) and **Melos monorepo** (`melos.yaml` present — `packages/` structure, `melos bootstrap`, `melos run` scripts, `melos.yaml` config pattern, monorepo-specific anti-patterns). `freezed` anti-pattern added per critical review.
- **`stack-profiles/react-native.md`** — React Native/TypeScript profile covering two workflow variants: **Bare** (`react-native` only — Metro bundler, `android/`+`ios/` native folders, React Navigation v6 typed screens, `pnpm android`/`ios`) and **Expo Managed** (`react-native` + `expo` — Expo Router file-based navigation, `npx expo install`, `app.config.ts` env config, EAS Build + EAS Update). TanStack Query recommendation added per critical review.
- **Critical Review Protocol applied** — Happy Path validated for all four project types (Flutter single, Flutter Melos, Bare RN, Expo Managed). Failure Points cover variant co-detection, hybrid Flutter/RN monorepo, plain Dart CLI, single-package Melos repos, and Expo transitive dep. Two corrections applied: `freezed` anti-pattern in Flutter, TanStack Query note in React Native.

### Changed

- **`/cc-stack` command** — added `react-native` and `expo` detection with variant announcement; added `melos.yaml` detection for Flutter monorepo variant; `flutter` and `react-native` added to the Available profiles list with variant footnotes.

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
