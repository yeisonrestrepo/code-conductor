# Spec: Remove claude-mem + Introduce code-conductor Plugin

**Date:** 2026-06-23
**Backlog items addressed:** BUG-020 (partial — removes orphan dependency), FEAT-005/ARCH-008 deferred
**Complexity:** S

---

## Problem

The claude-mem MCP plugin registers a `UserPromptSubmit` hook that launches a background `bun` worker on every prompt. The worker fails to start and reports "claude-mem worker unreachable for 32 consecutive hooks," blocking the session entirely. `enabledPlugins: false` in global settings does not suppress the hook. Additionally, claude-mem requires `tree-sitter` native bindings that fail to compile on Windows without Visual C++ Build Tools, creating brittle installation paths.

A secondary problem: the project's own skills (`critical-review`, `memory-first`, `agent-delegation`) live as flat `.md` files in `~/.claude/skills/` and are not invokable via the `Skill` tool, which only resolves skills from installed plugin directories. This forces them into the superpowers plugin cache, coupling them to a third-party version tree.

## Solution

Two deliverables in one change set:

1. **claude-mem removal** — strip all claude-mem installation steps from both installers, add a single silent uninstall call to heal existing installations, and update all prose references to point to `.claude/memory/project.md` as the sole memory layer.

2. **code-conductor plugin** — introduce a minimal Claude Code plugin (`code-conductor@code-conductor`) that owns the project's custom skills. The installers create the plugin directory structure under `~/.claude/plugins/cache/code-conductor/code-conductor/1.0.0/`, write a `plugin.json`, copy the three skill files, and inject `"code-conductor@code-conductor": true` into `~/.claude/settings.json` via the existing `_merge_settings_json` mechanism. Skills are then `Skill`-tool-invokable from any project, independent of the superpowers version.

SQLite replacement (FEAT-005, ARCH-008) is explicitly deferred to a separate spec.

## Behavior

### Main path
1. Developer runs `install.sh` or `install.ps1` on a fresh machine — no claude-mem install step runs; the code-conductor plugin is created and enabled.
2. Developer runs either installer on a machine with an existing claude-mem install — the installer runs `npx claude-mem uninstall --yes` silently before proceeding; the plugin hook is removed.
3. Sessions start without the `UserPromptSubmit` worker hook firing.
4. `Skill({ skill: "critical-review" })` (and `memory-first`, `agent-delegation`) resolve from `code-conductor@code-conductor` — no superpowers version dependency.
5. Agent lookup chain step 1 reads `.claude/memory/project.md` (behavior unchanged).

### Alternative paths
- `--no-deps` / `-NoDeps` flag — the claude-mem uninstall call and plugin creation are skipped (inside the existing `SKIP_DEPS` guard).
- Developer uninstalls claude-mem manually via Claude Code UI — also valid; the silent uninstall call is a no-op.
- Superpowers plugin updates to a new version — code-conductor skills are unaffected (different author namespace).

### Error cases
- `npx claude-mem uninstall` not found or exits non-zero (never installed) — wrapped in `|| true` / `-ErrorAction SilentlyContinue`; install proceeds normally.
- `~/.claude/settings.json` does not exist — the `_merge_settings_json` function already handles creation; no special case needed.
- Code-conductor plugin directory already exists (re-run) — file writes are idempotent; overwriting is safe for plugin-managed files.

## Acceptance Criteria

### claude-mem removal
- [ ] `install.sh` contains no claude-mem install logic; contains one silent `npx claude-mem uninstall --yes || true` call inside the `SKIP_DEPS` guard
- [ ] `install.ps1` contains no claude-mem install logic; contains one silent uninstall call inside the `-NoDeps` guard
- [ ] Running either installer on a machine with claude-mem installed removes the plugin
- [ ] `UserPromptSubmit` hook no longer times out after running either installer
- [ ] `global/CLAUDE.md` lookup chain step 1 references only `project.md`
- [ ] `skills/memory-first.md` step 1 references only `project.md`
- [ ] `skills/agent-delegation.md` has no claude-mem reference
- [ ] `README.md` lookup chain item 1 references only `project.md`
- [ ] Both `pre-tool-use.sh` hook error messages referencing `claude-mem` are updated

### code-conductor plugin
- [ ] `~/.claude/plugins/cache/code-conductor/code-conductor/1.0.0/.claude-plugin/plugin.json` is created by the installer
- [ ] `skills/critical-review/SKILL.md`, `skills/memory-first/SKILL.md`, `skills/agent-delegation/SKILL.md` are written into the plugin directory
- [ ] `"code-conductor@code-conductor": true` is present in `~/.claude/settings.json` after install
- [ ] `Skill({ skill: "critical-review" })` resolves without error in a new session
- [ ] The temporary fix at `superpowers/6.0.3/skills/critical-review/SKILL.md` is removed by the installer (or noted as safe to delete manually)

## Out of Scope
- SQLite embedded database engine (FEAT-005, ARCH-008)
- Changing the `.claude/memory/project.md` format or convention
- Graphify skill or graphify-out hooks
- Publishing code-conductor to a public plugin marketplace
- Migrating all skills to the plugin (only the three Skill-tool-invoked skills move; `verbosity.md`, `code-simplifier.md` remain as native Claude Code skills in `~/.claude/skills/`)

## System Impact

| File | Change |
|------|--------|
| `install.sh` | Remove ~12-line claude-mem block; add 1-line silent uninstall; add plugin dir creation + settings merge |
| `install.ps1` | Remove ~40-line claude-mem block; add 1-line silent uninstall; add plugin dir creation + settings merge |
| `global/CLAUDE.md` | 1-line edit: Orchestrator Protocol step 1 |
| `skills/memory-first.md` | 1-line edit: step 1 header |
| `skills/agent-delegation.md` | 1-line edit: "When NOT to Spawn" item |
| `README.md` | 1-line edit: memory-first lookup chain item 1 |
| `project-template/.claude/hooks/pre-tool-use.sh` | 1-line edit: hook error message |
| `.claude/hooks/pre-tool-use.sh` | 1-line edit: hook error message |
| `skills/critical-review.md` | Source of truth for SKILL.md content (file kept; installer copies to plugin dir) |
| `skills/memory-first.md` | Source of truth; installer also copies to plugin dir |
| `skills/agent-delegation.md` | Source of truth; installer also copies to plugin dir |
| `~/.claude/plugins/cache/code-conductor/code-conductor/1.0.0/` | Created by installer (not in repo) |
| `~/.claude/settings.json` | `enabledPlugins` entry added by installer (not in repo) |

### Files Requiring Full Read (deferred to /cc-plan)

- `install.sh` — claude-mem blocks and `_merge_settings_json` function extend beyond 30 lines; need full context for safe removal and new plugin wiring
- `install.ps1` — claude-mem blocks extend ~40 lines; need full context for safe removal and PS 5.1-compatible plugin wiring
