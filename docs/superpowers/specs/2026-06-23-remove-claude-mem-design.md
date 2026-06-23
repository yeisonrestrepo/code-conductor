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

**Plugin cache directory structure (exact):**
```
~/.claude/plugins/cache/
└── code-conductor/               ← author namespace
    └── code-conductor/           ← plugin name
        └── 1.0.0/                ← version
            ├── .claude-plugin/
            │   └── plugin.json
            └── skills/
                ├── critical-review/
                │   └── SKILL.md
                ├── memory-first/
                │   └── SKILL.md
                └── agent-delegation/
                    └── SKILL.md
```

The Skill tool resolves a skill named `"critical-review"` by scanning all enabled plugin directories for `skills/critical-review/SKILL.md`. Each skill subdirectory must match the skill name exactly (case-sensitive on Linux/macOS; treat as case-sensitive for portability on Windows NTFS).

**`enabledPlugins` JSON path (exact):** The key is nested one level inside `~/.claude/settings.json` under the top-level `"enabledPlugins"` object — it is not a top-level property itself:

```json
{
  "enabledPlugins": {
    "superpowers@claude-plugins-official": true,
    "code-simplifier@claude-plugins-official": true,
    "claude-mem@thedotmack": false,
    "code-conductor@code-conductor": true
  }
}
```

The `_merge_settings_json` function must merge into `.enabledPlugins["code-conductor@code-conductor"]`, not write a top-level key.

**Source-to-target file transformation (exact):** Each flat source file in the repo is renamed to `SKILL.md` and placed inside a subdirectory named after the skill:

| Repo source | Plugin target |
|-------------|---------------|
| `skills/critical-review.md` | `…/skills/critical-review/SKILL.md` |
| `skills/memory-first.md` | `…/skills/memory-first/SKILL.md` |
| `skills/agent-delegation.md` | `…/skills/agent-delegation/SKILL.md` |

The flat filenames are the human-readable source of truth; the `SKILL.md` name is required by the plugin resolution contract.

**Parent directory creation (mandatory before copy):** Each skill target subdirectory must be created before the copy step. The installers must run `mkdir -p` (bash) / `New-Item -ItemType Directory -Force` (PS) for every leaf directory — including `.claude-plugin/` — before writing any file. Copy failures in nested targets are prevented by ensuring all parent paths exist first:

```bash
# bash — order matters; all mkdirs before any cp
mkdir -p "${PLUGIN_DIR}/.claude-plugin"
mkdir -p "${PLUGIN_DIR}/skills/critical-review"
mkdir -p "${PLUGIN_DIR}/skills/memory-first"
mkdir -p "${PLUGIN_DIR}/skills/agent-delegation"
```

```powershell
# PS 5.1 — New-Item -Force is safe even if dir already exists
New-Item -ItemType Directory -Force "$pluginDir\.claude-plugin" | Out-Null
New-Item -ItemType Directory -Force "$pluginDir\skills\critical-review" | Out-Null
New-Item -ItemType Directory -Force "$pluginDir\skills\memory-first" | Out-Null
New-Item -ItemType Directory -Force "$pluginDir\skills\agent-delegation" | Out-Null
```

These run **after** the wipe step and **before** any file write.

**`plugin.json` required schema (exact):** Claude Code validates the following fields at plugin load time. All four fields are required; omitting any causes the plugin to be silently skipped:

```json
{
  "name": "code-conductor",
  "version": "1.0.0",
  "description": "code-conductor custom skills: critical-review, memory-first, agent-delegation",
  "author": {
    "name": "code-conductor"
  }
}
```

- `name`: must match the plugin directory name (`code-conductor`) — used for the `<name>@<author>` resolution key.
- `version`: must match the versioned subdirectory name (`1.0.0`).
- `description`: free-text; non-empty string required.
- `author.name`: must match the author namespace directory (`code-conductor`).
- No other fields (`homepage`, `repository`, `license`, `keywords`) are required, though they are harmless if present.
- **JSON formatting:** Both `plugin.json` and any `settings.json` writes use **2-space indentation** with a trailing newline (`JSON.stringify(obj, null, 2) + '\n'`). Minified single-line output is prohibited — Claude Code and human reviewers both read these files directly. Existing `settings.json` content must be preserved; only the targeted keys are added or removed.

SQLite replacement (FEAT-005, ARCH-008) is explicitly deferred to a separate spec.

## Behavior

### Main path
1. Developer runs `install.sh` or `install.ps1` on a fresh machine — no claude-mem install step runs; the code-conductor plugin is created and enabled.
2. Developer runs either installer on a machine with an existing claude-mem install — the installer runs the uninstall command silently before proceeding; the plugin hook and cached plugin directory are removed. The installer then removes any lingering `"claude-mem@thedotmack"` entry from `enabledPlugins` in `~/.claude/settings.json` and wipes the superpowers-cached copy of `critical-review` via a glob-delete (no version pinning required) so no duplicate skill resolution occurs.
3. Sessions start without the `UserPromptSubmit` worker hook firing.
4. `Skill({ skill: "critical-review" })` (and `memory-first`, `agent-delegation`) resolve from `code-conductor@code-conductor` — no superpowers version dependency.
5. Agent lookup chain step 1 reads `.claude/memory/project.md` (behavior unchanged).

### Alternative paths
- `--no-deps` / `-NoDeps` flag — the claude-mem uninstall call and plugin creation are skipped (inside the existing `SKIP_DEPS` guard).
- Developer uninstalls claude-mem manually via Claude Code UI — also valid; the silent uninstall call is a no-op.
- Superpowers plugin updates to a new version — code-conductor skills are unaffected (different author namespace).

### Error cases
- `npx claude-mem uninstall` not found or exits non-zero (never installed, or Node.js absent on a fresh machine):
  - **`install.sh` (exact form):** `npx claude-mem uninstall --yes 2>/dev/null || true` — `2>/dev/null` suppresses stderr noise; `|| true` ensures the exit code is always 0 so `set -euo pipefail` does not abort the script. Both guards are required together.
  - **`install.ps1` (exact form):** `try { $null = cmd /c "npx claude-mem uninstall --yes 2>nul" } catch {}` — `cmd /c` delegates to the Windows command interpreter, which handles `npx` correctly with `legacy-peer-deps`. The `try/catch` absorbs any terminating exception (including command-not-found when Node.js is absent). `$null =` discards stdout. `2>nul` suppresses cmd-level stderr. Do **not** use `-ErrorAction SilentlyContinue` on native exe calls — PS 5.1 does not convert native exit codes to terminating exceptions, so `-ErrorAction` has no effect on them; command-not-found errors are thrown as terminating exceptions that only `try/catch` can absorb.
- `~/.claude/settings.json` does not exist — the `_merge_settings_json` function already handles creation; no special case needed.
- **`settings.json` key removal without `jq`:** Neither installer may assume `jq` is present. The removal of `"claude-mem@thedotmack"` from `enabledPlugins` must use the same `node -e` inline script mechanism already used by `_merge_settings_json` in the existing installers. The inline script must guard against a missing `enabledPlugins` object to avoid a `TypeError: Cannot read properties of undefined`:
  ```js
  const f = require('os').homedir() + '/.claude/settings.json';
  const obj = JSON.parse(require('fs').readFileSync(f, 'utf8'));
  if (obj.enabledPlugins) { delete obj.enabledPlugins['claude-mem@thedotmack']; }
  require('fs').writeFileSync(f, JSON.stringify(obj, null, 2) + '\n');
  ```
  The `if (obj.enabledPlugins)` guard makes the delete a no-op on fresh machines where the key was never written. Written output uses `JSON.stringify(obj, null, 2)` (2-space indentation) to match the existing `settings.json` format. A trailing newline is appended.
- **`node` absence guard in `install.sh`:** Under `set -euo pipefail`, the `node -e` call must be prefixed with `command -v node >/dev/null 2>&1 &&` so the entire expression is skipped (exit 0) when Node.js is absent, rather than aborting the script on command-not-found:
  ```bash
  command -v node >/dev/null 2>&1 && node -e "..." || true
  ```
  The trailing `|| true` is redundant when `command -v` short-circuits, but is kept as a belt-and-suspenders guard if `node` exists but the script itself exits non-zero.
- **Residual claude-mem artifacts:** The `npx claude-mem uninstall --yes` command is the authoritative cleanup mechanism; it removes the plugin's hook registration, the `~/.claude/plugins/cache/thedotmack/claude-mem/` directory, and any MCP worker state. The installers additionally: (a) remove the `"claude-mem@thedotmack"` key from `enabledPlugins` via the `node -e` mechanism above; (b) glob-delete the orphaned superpowers-cached `critical-review` skill directory. `memory-first` and `agent-delegation` were **never** placed in the superpowers cache (confirmed: only `critical-review` was added there as a temporary fix) — no cleanup of those names is required. No other env vars, cached metadata, or configuration blocks are known to be left behind by claude-mem and no further purge is specified.
- **Code-conductor plugin directory wipe on re-run:** `rm -rf "${PLUGIN_DIR}" 2>/dev/null || true` (bash) / `if (Test-Path $pluginDir) { Remove-Item -Recurse -Force $pluginDir }` (PS). The explicit existence check in PS is required because `Remove-Item -Recurse -Force` on a non-existent path throws a terminating error in PS 5.1 even with `-Force`; wrapping in `if (Test-Path …)` is the idiomatic suppression. In bash, `2>/dev/null || true` is sufficient since `rm -rf` exits 0 on absent paths. The wipe is scoped to the versioned subdirectory only; parent directories are left intact.
- **Superpowers glob-delete (PS 5.1):** PowerShell 5.1 does not expand mid-path wildcards in `Remove-Item` paths directly (e.g. `Remove-Item "…/superpowers/*/skills/critical-review" -Recurse` silently does nothing). The correct mechanism is a `Get-ChildItem` pipeline expansion:
  ```powershell
  Get-ChildItem "$env:USERPROFILE\.claude\plugins\cache\claude-plugins-official\superpowers" -Directory |
    ForEach-Object {
      $t = Join-Path $_.FullName "skills\critical-review"
      if (Test-Path $t) { Remove-Item -Recurse -Force $t }
    }
  ```
  In bash, the shell glob expands naturally: `rm -rf "${HOME}/.claude/plugins/cache/claude-plugins-official/superpowers"/*/skills/critical-review 2>/dev/null || true`.

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
- [ ] The installer glob-deletes `~/.claude/plugins/cache/claude-plugins-official/superpowers/*/skills/critical-review/` (all superpowers versions) so no duplicate skill resolution occurs — this is automated, not manual
- [ ] The installer removes `"claude-mem@thedotmack"` from `enabledPlugins` in `~/.claude/settings.json` (set to absent, not `false`)
- [ ] No residual `~/.claude/plugins/cache/thedotmack/claude-mem/` directory remains after running the installer on a machine where claude-mem was previously installed — the `npx claude-mem uninstall` command is responsible; no additional manual wipe is specified

## Out of Scope
- SQLite embedded database engine (FEAT-005, ARCH-008)
- Changing the `.claude/memory/project.md` format or convention
- Graphify skill or graphify-out hooks
- Publishing code-conductor to a public plugin marketplace
- Migrating all skills to the plugin (only the three Skill-tool-invoked skills move; `verbosity.md`, `code-simplifier.md` remain as native Claude Code skills in `~/.claude/skills/`)

## Version Bump Policy

Yes — this change set requires a version bump. Rationale: it removes an installed dependency from the public installer (breaking change for existing installs that relied on claude-mem), introduces a new plugin artifact, and modifies the `enabledPlugins` contract in `~/.claude/settings.json`.

- `VERSION`: bump from current to next **minor** (`1.13.0` → `1.14.0`) — new capability (code-conductor plugin) shipped alongside the removal.
- `package.json`: update `"version"` field to match.
- `CHANGELOG.md`: prepend `[1.14.0]` entry with **Removed** (claude-mem), **Added** (code-conductor plugin + skill wiring), and **Changed** (8 prose reference updates).

The version bump commit is the final commit in the implementation sequence, after all file changes are verified and `npm test` exits 0.

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

**Test regression audit:** No existing tests in `tests/` assert on the hook error message text ("Check claude-mem / project.md") or on the presence of the claude-mem plugin — confirmed by grep. The two `pre-tool-use.sh` hook message edits are safe with respect to the current test suite. No test files require updating as part of this change set.

### Files Requiring Full Read (deferred to /cc-plan)

- `install.sh` — claude-mem blocks and `_merge_settings_json` function extend beyond 30 lines; need full context for safe removal and new plugin wiring
- `install.ps1` — claude-mem blocks extend ~40 lines; need full context for safe removal and PS 5.1-compatible plugin wiring
