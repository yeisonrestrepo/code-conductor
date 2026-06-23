# Remove claude-mem + Introduce code-conductor Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strip all claude-mem installation steps from both installers, add a silent uninstall to heal existing setups, move the three custom skills into a code-conductor plugin so they are Skill-tool-invokable, and update 6 prose references.

**Architecture:** Two phases — (1) surgical 1-line prose edits with no logic changes; (2) installer rewrites that remove the claude-mem block, add the silent uninstall + key-removal + glob-delete inside the `SKIP_DEPS` / `-NoDeps` guard, and add a plugin-creation block after the global settings merge. The plugin directory is wiped and recreated on every install to stay idempotent.

**Tech Stack:** bash, PowerShell 5.1, Node.js inline scripts (no jq assumption), Claude Code plugin schema.

## Global Constraints

- JSON output: 2-space indentation + trailing newline (`JSON.stringify(obj, null, 2) + '\n'`). No minification.
- No `jq` assumption: all `settings.json` manipulation uses `node -e` inline scripts.
- `set -euo pipefail` compatibility: every `node -e` call prefixed with `command -v node >/dev/null 2>&1 &&`; every non-fatal command suffixed with `|| true`.
- PS 5.1: mid-path wildcard glob-delete requires `Get-ChildItem` pipeline. No `&&`/`||` operator chains. `try/catch` for command-not-found.
- `plugin.json` required fields: `name`, `version`, `description`, `author.name` — all four, exact values.
- `enabledPlugins` JSON path: nested inside `{ "enabledPlugins": { ... } }`, not top-level.
- `node -e` null guard: `if (obj.enabledPlugins) { delete ... }` before delete; `if (!obj.enabledPlugins) obj.enabledPlugins = {}` before set.
- Plugin dir wipe: bash uses `rm -rf "${PLUGIN_DIR}" 2>/dev/null || true`; PS uses `if (Test-Path $pluginDir) { Remove-Item -Recurse -Force $pluginDir }`.
- `memory-first` and `agent-delegation` were NEVER in the superpowers cache — no cleanup of those names.
- BUG-003 invariant: all plan file edits are single-line surgical Edits only.
- Version bump target: `1.13.0` → `1.14.0`.

---

### Task 1: Surgical prose edits — remove "claude-mem" from 6 files

**Files:**
- Modify: `global/CLAUDE.md:25`
- Modify: `skills/memory-first.md:8`
- Modify: `skills/agent-delegation.md:37`
- Modify: `README.md:143`
- Modify: `project-template/.claude/hooks/pre-tool-use.sh:19`
- Modify: `.claude/hooks/pre-tool-use.sh:19`

**Interfaces:**
- Produces: 6 files with "claude-mem" references replaced by `.claude/memory/project.md`

- [ ] [T-001-A] **Edit `global/CLAUDE.md` line 25**

  Old line:
  ```
  1. **Memory** — check `claude-mem` / `.claude/memory/project.md`. If the answer is there, stop.
  ```
  New line:
  ```
  1. **Memory** — check `.claude/memory/project.md`. If the answer is there, stop.
  ```

  Use the Edit tool: `old_string` = `1. **Memory** — check \`claude-mem\` / \`.claude/memory/project.md\`. If the answer is there, stop.`; `new_string` = `1. **Memory** — check \`.claude/memory/project.md\`. If the answer is there, stop.`

- [ ] [T-001-B] **Edit `skills/memory-first.md` line 8**

  Old line:
  ```
  Check `.claude/memory/project.md` and the `claude-mem` index.
  ```
  New line:
  ```
  Check `.claude/memory/project.md`.
  ```

- [ ] [T-001-C] **Edit `skills/agent-delegation.md` line 37**

  Old line:
  ```
  - Answer is already in `project.md` or claude-mem.
  ```
  New line:
  ```
  - Answer is already in `.claude/memory/project.md`.
  ```

- [ ] [T-001-D] **Edit `README.md` line 143**

  Old line:
  ```
  1. **Project memory** — `claude-mem` / `project.md`
  ```
  New line:
  ```
  1. **Project memory** — `.claude/memory/project.md`
  ```

- [ ] [T-001-E] **Edit `project-template/.claude/hooks/pre-tool-use.sh` line 19**

  Old line:
  ```
     echo "   1. Check claude-mem / project.md"
  ```
  New line:
  ```
     echo "   1. Check .claude/memory/project.md"
  ```

- [ ] [T-001-F] **Edit `.claude/hooks/pre-tool-use.sh` line 19**

  Same as T-001-E. Old:
  ```
     echo "   1. Check claude-mem / project.md"
  ```
  New:
  ```
     echo "   1. Check .claude/memory/project.md"
  ```

- [ ] [T-001-G] **Commit**

  ```bash
  git add global/CLAUDE.md skills/memory-first.md skills/agent-delegation.md README.md \
    project-template/.claude/hooks/pre-tool-use.sh .claude/hooks/pre-tool-use.sh
  git commit -m "chore: replace claude-mem prose references with project.md (6 files)"
  ```

---

### Task 2: `install.sh` — remove claude-mem block, add silent uninstall + plugin wiring

**Files:**
- Modify: `install.sh` (lines 187–199 removed; two new blocks added)

**Interfaces:**
- Consumes: `${GLOBAL_DIR}/skills/critical-review.md`, `${GLOBAL_DIR}/skills/memory-first.md`, `${GLOBAL_DIR}/skills/agent-delegation.md` (written by the `download` calls at lines 965–969, which run before the new plugin block)
- Produces: `~/.claude/plugins/cache/code-conductor/code-conductor/1.0.0/` directory on the user's machine; `enabledPlugins["code-conductor@code-conductor"]: true` in `~/.claude/settings.json`

- [ ] [T-002-A] **Remove the claude-mem install block from the SKIP_DEPS section**

  In `install.sh`, find and delete the following exact block (lines 187–199). Use the Edit tool with `old_string` set to the entire block and `new_string` set to the replacement below.

  Old (to remove entirely — replace with the uninstall + cleanup lines):
  ```bash
    [ "$HAS_NODE" = true ] && install_dep "claude-mem" "npx --yes claude-mem install"

    if [ "$HAS_NODE" = true ]; then
      _cm_dir=$(find "${HOME}/.claude/plugins/cache/thedotmack/claude-mem" -maxdepth 1 -mindepth 1 -type d 2>/dev/null | sort -rV | head -1)
      if [ -n "$_cm_dir" ] && [ -f "$_cm_dir/package.json" ]; then
        info "Installing claude-mem dependencies..."
        if npm install --prefix "$_cm_dir" --ignore-scripts --silent; then
          ok "claude-mem dependencies installed"
        else
          warn "claude-mem dependencies failed -- run: npm install --prefix \"$_cm_dir\" --ignore-scripts"
        fi
      fi
    fi
  ```

  New (replacement — inside the SKIP_DEPS block):
  ```bash
    # Silent claude-mem removal — heals existing installs; no-op if never installed or Node absent
    npx claude-mem uninstall --yes 2>/dev/null || true
    # Remove claude-mem@thedotmack from enabledPlugins (no-op on fresh installs)
    command -v node >/dev/null 2>&1 && node -e "
const f=require('os').homedir()+'/.claude/settings.json';
if(!require('fs').existsSync(f))process.exit(0);
const obj=JSON.parse(require('fs').readFileSync(f,'utf8'));
if(obj.enabledPlugins){delete obj.enabledPlugins['claude-mem@thedotmack'];}
require('fs').writeFileSync(f,JSON.stringify(obj,null,2)+'\n');
" 2>/dev/null || true
    # Glob-delete orphaned superpowers-cached critical-review skill (all versions)
    rm -rf "${HOME}/.claude/plugins/cache/claude-plugins-official/superpowers"/*/skills/critical-review 2>/dev/null || true
  ```

- [ ] [T-002-B] **Add code-conductor plugin creation block after the global settings merge**

  In `install.sh`, find the line:
  ```bash
  [ "$_global_json_ok" = "1" ] && _merge_settings_json "${GLOBAL_DIR}/settings.json" "$_global_hook_cmd" \
      || warn "[verbosity-remind] WARN: skipping global settings.json merge -- pre-validation failed."
  ```

  Insert the following block IMMEDIATELY AFTER that line (before the `# CC_VERBOSITY_SKIP conflict check` comment):

  ```bash
  # ── code-conductor plugin: wipe versioned dir and recreate ────────────────────
  if [ "$SKIP_DEPS" = false ]; then
    PLUGIN_DIR="${HOME}/.claude/plugins/cache/code-conductor/code-conductor/1.0.0"
    rm -rf "${PLUGIN_DIR}" 2>/dev/null || true
    mkdir -p "${PLUGIN_DIR}/.claude-plugin"
    mkdir -p "${PLUGIN_DIR}/skills/critical-review"
    mkdir -p "${PLUGIN_DIR}/skills/memory-first"
    mkdir -p "${PLUGIN_DIR}/skills/agent-delegation"
    cat > "${PLUGIN_DIR}/.claude-plugin/plugin.json" <<'PLUGINJSON'
{
  "name": "code-conductor",
  "version": "1.0.0",
  "description": "code-conductor custom skills: critical-review, memory-first, agent-delegation",
  "author": {
    "name": "code-conductor"
  }
}
PLUGINJSON
    cp "${GLOBAL_DIR}/skills/critical-review.md"   "${PLUGIN_DIR}/skills/critical-review/SKILL.md"
    cp "${GLOBAL_DIR}/skills/memory-first.md"       "${PLUGIN_DIR}/skills/memory-first/SKILL.md"
    cp "${GLOBAL_DIR}/skills/agent-delegation.md"   "${PLUGIN_DIR}/skills/agent-delegation/SKILL.md"
    command -v node >/dev/null 2>&1 && node -e "
const f=require('os').homedir()+'/.claude/settings.json';
const obj=require('fs').existsSync(f)?JSON.parse(require('fs').readFileSync(f,'utf8')):{};
if(!obj.enabledPlugins)obj.enabledPlugins={};
obj.enabledPlugins['code-conductor@code-conductor']=true;
require('fs').writeFileSync(f,JSON.stringify(obj,null,2)+'\n');
" 2>/dev/null || true
    ok "code-conductor plugin installed (critical-review, memory-first, agent-delegation)"
  fi
  ```

- [ ] [T-002-C] **Run tests**

  ```bash
  npm test
  ```
  Expected: all tests pass (142 passed, 3 skipped). The hook text edits from Task 1 do not affect test assertions (confirmed by grep — no tests assert on "claude-mem" text).

- [ ] [T-002-D] **Commit**

  ```bash
  git add install.sh
  git commit -m "feat: remove claude-mem from install.sh; add code-conductor plugin wiring"
  ```

---

### Task 3: `install.ps1` — remove claude-mem block, add silent uninstall + plugin wiring

**Files:**
- Modify: `install.ps1` (lines 127–165 removed; two new blocks added)

**Interfaces:**
- Consumes: `$GLOBAL_DIR\skills\critical-review.md`, `$GLOBAL_DIR\skills\memory-first.md`, `$GLOBAL_DIR\skills\agent-delegation.md` (written by `Save-RemoteFile` calls at lines 401–405, which run before the new plugin block)
- Produces: `%USERPROFILE%\.claude\plugins\cache\code-conductor\code-conductor\1.0.0\` on Windows; `enabledPlugins["code-conductor@code-conductor"]: true` in `~/.claude/settings.json`

- [ ] [T-003-A] **Remove the claude-mem install block from the `-NoDeps` section**

  In `install.ps1`, find and delete the following exact block (lines 127–165 in the `-not $NoDeps` block). Replace it with the uninstall + cleanup lines below.

  Old (entire block to remove):
  ```powershell
    if ($HasNode) {
      Write-Info "Installing claude-mem..."

      # Attempt 1 -- run via cmd.exe; legacy-peer-deps resolves tree-sitter version conflict
      npm config set legacy-peer-deps true
      cmd /c "npx --yes claude-mem install"
      $claudeMemResult = $LASTEXITCODE
      npm config set legacy-peer-deps false
      if ($claudeMemResult -eq 0) {
        Write-Ok "claude-mem installed"
      } else {
        # Attempt 2 -- auto-install Visual C++ Build Tools (required by tree-sitter) then retry
        Write-Info "claude-mem needs Visual C++ Build Tools -- installing via winget (this may take a few minutes)..."
        if (Get-Command winget -ErrorAction SilentlyContinue) {
          winget install Microsoft.VisualStudio.2022.BuildTools `
            --silent --accept-source-agreements --accept-package-agreements `
            --override "--quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
          if ($LASTEXITCODE -eq 0) {
            Write-Info "Retrying claude-mem install..."
            npm config set legacy-peer-deps true
            cmd /c "npx --yes claude-mem install"
            $claudeMemResult = $LASTEXITCODE
            npm config set legacy-peer-deps false
            if ($claudeMemResult -eq 0) {
              Write-Ok "claude-mem installed"
            } else {
              Write-Warn "claude-mem failed after build tools install -- manual install: npx --yes claude-mem install"
              $script:FailedDeps += "claude-mem: npx --yes claude-mem install"
            }
          } else {
            Write-Warn "Visual C++ Build Tools install failed -- manual install: npx --yes claude-mem install"
            $script:FailedDeps += "claude-mem: npx --yes claude-mem install"
          }
        } else {
          Write-Warn "winget not found -- manual install: npx --yes claude-mem install"
          $script:FailedDeps += "claude-mem: npx --yes claude-mem install"
        }
      }
    }

    if ($HasNode) {
      $claudeMemPluginDir = Get-ChildItem "$env:USERPROFILE\.claude\plugins\cache\thedotmack\claude-mem" -Directory -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending | Select-Object -First 1 -ExpandProperty FullName
      if ($claudeMemPluginDir) {
        Write-Info "Installing claude-mem dependencies..."
        npm install --prefix $claudeMemPluginDir --ignore-scripts --silent
        if ($LASTEXITCODE -eq 0) { Write-Ok "claude-mem dependencies installed" }
        else { Write-Warn "claude-mem dependencies failed -- run: npm install --prefix `"$claudeMemPluginDir`" --ignore-scripts" }
      }
    }
  ```

  New (replacement — inside the `-not $NoDeps` block, directly after `Write-Host ""`):
  ```powershell
    # Silent claude-mem removal — heals existing installs; no-op if never installed
    Write-Info "Removing claude-mem (no-op if never installed)..."
    try { $null = cmd /c "npx claude-mem uninstall --yes 2>nul" } catch {}
    # Remove claude-mem@thedotmack from enabledPlugins (no-op on fresh installs)
    $cmNodeScript = @'
const f=require('os').homedir()+'/.claude/settings.json';
if(!require('fs').existsSync(f))process.exit(0);
const obj=JSON.parse(require('fs').readFileSync(f,'utf8'));
if(obj.enabledPlugins){delete obj.enabledPlugins['claude-mem@thedotmack'];}
require('fs').writeFileSync(f,JSON.stringify(obj,null,2)+'\n');
'@
    if (Get-Command node -ErrorAction SilentlyContinue) {
      node -e $cmNodeScript 2>$null
    }
    # Glob-delete orphaned superpowers-cached critical-review skill (PS 5.1 pipeline required)
    $superDir = "$env:USERPROFILE\.claude\plugins\cache\claude-plugins-official\superpowers"
    if (Test-Path $superDir) {
      Get-ChildItem $superDir -Directory -ErrorAction SilentlyContinue |
        ForEach-Object {
          $t = Join-Path $_.FullName "skills\critical-review"
          if (Test-Path $t) { Remove-Item -Recurse -Force $t }
        }
    }
  ```

- [ ] [T-003-B] **Add code-conductor plugin creation block after global settings merge**

  In `install.ps1`, find the line:
  ```powershell
  Merge-SettingsJson "$GLOBAL_DIR\settings.json" $globalHookCmd
  ```

  Insert the following block IMMEDIATELY AFTER that line (before the `# -- Install project template` comment):

  ```powershell
  # -- code-conductor plugin: wipe versioned dir and recreate --------------------
  if (-not $NoDeps) {
    $pluginDir = "$env:USERPROFILE\.claude\plugins\cache\code-conductor\code-conductor\1.0.0"
    if (Test-Path $pluginDir) { Remove-Item -Recurse -Force $pluginDir }
    New-Item -ItemType Directory -Force "$pluginDir\.claude-plugin" | Out-Null
    New-Item -ItemType Directory -Force "$pluginDir\skills\critical-review" | Out-Null
    New-Item -ItemType Directory -Force "$pluginDir\skills\memory-first" | Out-Null
    New-Item -ItemType Directory -Force "$pluginDir\skills\agent-delegation" | Out-Null
    $pluginEnc = [System.Text.UTF8Encoding]::new($false)
    $pluginJsonContent = @'
{
  "name": "code-conductor",
  "version": "1.0.0",
  "description": "code-conductor custom skills: critical-review, memory-first, agent-delegation",
  "author": {
    "name": "code-conductor"
  }
}
'@
    [System.IO.File]::WriteAllText(
      "$pluginDir\.claude-plugin\plugin.json",
      $pluginJsonContent + "`n",
      $pluginEnc
    )
    Copy-Item "$GLOBAL_DIR\skills\critical-review.md"   "$pluginDir\skills\critical-review\SKILL.md"
    Copy-Item "$GLOBAL_DIR\skills\memory-first.md"       "$pluginDir\skills\memory-first\SKILL.md"
    Copy-Item "$GLOBAL_DIR\skills\agent-delegation.md"   "$pluginDir\skills\agent-delegation\SKILL.md"
    $enableScript = @'
const f=require('os').homedir()+'/.claude/settings.json';
const obj=require('fs').existsSync(f)?JSON.parse(require('fs').readFileSync(f,'utf8')):{};
if(!obj.enabledPlugins)obj.enabledPlugins={};
obj.enabledPlugins['code-conductor@code-conductor']=true;
require('fs').writeFileSync(f,JSON.stringify(obj,null,2)+'\n');
'@
    if (Get-Command node -ErrorAction SilentlyContinue) {
      node -e $enableScript 2>$null
    }
    Write-Ok "code-conductor plugin installed (critical-review, memory-first, agent-delegation)"
  }
  ```

- [ ] [T-003-C] **Run tests**

  ```bash
  npm test
  ```
  Expected: 142 passed, 3 skipped.

- [ ] [T-003-D] **Commit**

  ```bash
  git add install.ps1
  git commit -m "feat: remove claude-mem from install.ps1; add code-conductor plugin wiring"
  ```

---

### Task 4: Version bump to 1.14.0

**Files:**
- Modify: `VERSION`
- Modify: `package.json`
- Modify: `CHANGELOG.md` (prepend new entry)

**Interfaces:**
- Produces: published version `1.14.0` visible in `VERSION`, `package.json`, and `CHANGELOG.md`

- [ ] [T-004-A] **Edit `VERSION`**

  Old content: `1.13.0`
  New content: `1.14.0`

- [ ] [T-004-B] **Edit `package.json` version field**

  Old: `"version": "1.13.0"`
  New: `"version": "1.14.0"`

- [ ] [T-004-C] **Prepend `[1.14.0]` entry to `CHANGELOG.md`**

  Insert the following block immediately after the `# Changelog` header line (before the existing `## [1.13.0]` entry):

  ```markdown

  ## [1.14.0] - 2026-06-23

  ### Removed
  - `[BUG-020]` claude-mem installation steps removed from `install.sh` and `install.ps1`; silent `npx claude-mem uninstall --yes` call added to heal existing installs; `claude-mem@thedotmack` key removed from `enabledPlugins` in `~/.claude/settings.json` on install
  - `[BUG-020]` Orphaned superpowers-cached `critical-review` skill glob-deleted on install (all superpowers versions)

  ### Added
  - `[BUG-020]` code-conductor Claude Code plugin (`~/.claude/plugins/cache/code-conductor/code-conductor/1.0.0/`) — owns `critical-review`, `memory-first`, and `agent-delegation` skills; installed and enabled by both installers
  - `[BUG-020]` `"code-conductor@code-conductor": true` injected into `~/.claude/settings.json` `enabledPlugins` by both installers; `Skill({ skill: "critical-review" })` now resolves without superpowers dependency

  ### Changed
  - `[BUG-020]` 6 prose references to `claude-mem` replaced with `.claude/memory/project.md` in `global/CLAUDE.md`, `skills/memory-first.md`, `skills/agent-delegation.md`, `README.md`, `.claude/hooks/pre-tool-use.sh`, `project-template/.claude/hooks/pre-tool-use.sh`

  ```

- [ ] [T-004-D] **Run tests**

  ```bash
  npm test
  ```
  Expected: 142 passed, 3 skipped.

- [ ] [T-004-E] **Commit**

  ```bash
  git add VERSION package.json CHANGELOG.md
  git commit -m "chore(release): bump to v1.14.0 — remove claude-mem, add code-conductor plugin"
  ```

---

## Test List

- [ ] `npm test` passes after each commit (T-002-C, T-003-C, T-004-D) — 142 passed, 3 skipped
- [ ] No test file asserts on "claude-mem" text (pre-confirmed by grep — no updates needed)
- [ ] Manual smoke: run `bash install.sh --no-deps` on a clean machine — no claude-mem step runs, no plugin created (NoDeps guard)
- [ ] Manual smoke: run `bash install.sh` — `~/.claude/plugins/cache/code-conductor/code-conductor/1.0.0/.claude-plugin/plugin.json` exists with correct 4-field schema

## Commit Order

1. T-001-G — prose edits (6 files, 1 commit)
2. T-002-D — install.sh (1 commit)
3. T-003-D — install.ps1 (1 commit)
4. T-004-E — version bump (1 commit)

Total: 4 commits.

## Identified Risks

1. **plugin.json heredoc trailing newline**: bash `cat > file <<'EOF'` appends a final newline from the heredoc — the file will end with `}\n`. This matches the spec requirement. Verify with `xxd "${PLUGIN_DIR}/.claude-plugin/plugin.json" | tail -1` — last byte should be `0a`.
2. **PS `node -e` here-string quoting**: The single-quoted `@'...'@` here-string in PS 5.1 does not expand `$` — JS `$` signs inside the script are safe. Verify after install that `settings.json` contains `"code-conductor@code-conductor": true` and lacks `"claude-mem@thedotmack"`.
3. **settings.json race**: both the key-removal and key-addition `node -e` calls read and write `settings.json` in sequence. On a fresh machine where `settings.json` was just created by `_merge_settings_json`, the file exists before the key-addition call. No race on single-threaded install.
4. **SKIP_DEPS guard split**: the uninstall+cleanup is in the existing `SKIP_DEPS` block; the plugin creation is in a second `if [ "$SKIP_DEPS" = false ]` block after global file downloads. Both are skipped when `--no-deps` is passed. Verify by running `bash install.sh --no-deps` and confirming no `code-conductor` dir is created.
5. **Global skills not yet downloaded at SKIP_DEPS time**: The `cp` calls in the plugin block (T-002-B section 2) reference `${GLOBAL_DIR}/skills/*.md`, which are written by the `download` calls above in the installer flow — the plugin block is placed AFTER those downloads, so the files exist. Confirm by checking the installer comment `# ── code-conductor plugin: wipe versioned dir and recreate` appears after `download "skills/agent-delegation.md"`.
