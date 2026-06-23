# Remove claude-mem + Introduce code-conductor Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strip all claude-mem installation steps from both installers, add a silent uninstall to heal existing setups, move the three custom skills into a code-conductor plugin so they are Skill-tool-invokable, and update 6 prose references.

**Architecture:** Two phases — (1) surgical 1-line prose edits with no logic changes; (2) installer rewrites that remove the claude-mem block, add the silent uninstall + key-removal + glob-delete inside the `SKIP_DEPS` / `-NoDeps` guard, and add a plugin-creation block after the global settings merge. The plugin directory is wiped and recreated on every install to stay idempotent.

**Tech Stack:** bash, PowerShell 5.1, Node.js inline scripts (no jq assumption), Claude Code plugin schema.

## Global Constraints

- JSON output: 2-space indentation + trailing newline (`JSON.stringify(obj, null, 2) + '\n'`). No minification.
- No `jq` assumption: all `settings.json` manipulation uses `node -e` inline scripts.
- `set -euo pipefail` compatibility: every `node -e` call prefixed with `command -v node >/dev/null 2>&1 &&`; every non-fatal command suffixed with `|| true`; the uninstall call prefixed with `command -v npx >/dev/null 2>&1 &&`.
- `node -e` JSON resilience: all `JSON.parse` calls wrapped in `try/catch`; malformed or empty `settings.json` falls back to `{}` without aborting.
- Dynamic plugin version: both installers read `REMOTE_VERSION` / `$RemoteVersion` (already set by the version-fetch at the top of each installer) and use it for the plugin directory path and `plugin.json` version field. Fallback: `"1.0.0"` when the version fetch fails.
- Version harmonization: `VERSION`, `package.json`, `plugin.json`, and the plugin directory path must all resolve to the same version string at runtime. After the Task 4 version bump, the installer's `REMOTE_VERSION` fetch will return `1.14.0` from the remote tag; the `VERSION` file on disk will also read `1.14.0`. On offline/fresh machines where the remote fetch fails, the fallback `"1.0.0"` is the safe sentinel — it does NOT need to match `1.14.0` because it only applies when the remote is unreachable (the `.bak` path protects against a corrupted install).
- Remote version fetch execution sequence: (1) installer starts; (2) `REMOTE_VERSION` is set via `curl`/`Invoke-WebRequest` at the top of the script (line 87 bash / line 37 PS); (3) if the fetch times out or fails, `REMOTE_VERSION` is empty and `_cc_ver` / `$ccVersion` falls back to `"1.0.0"`; (4) plugin dir is created under `${_cc_ver}` / `$ccVersion`; (5) `plugin.json` version field is written with the same value; (6) `enabledPlugins` key is set regardless of version. Both the fallback path and the live path result in a valid plugin — they differ only in the versioned subdirectory name.
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

**Punctuation matching rules (critical — mismatches silently fail Edit tool):**
- The `old_string` in T-001-A and T-001-D contains U+2014 EM DASH (`—`) — copy-paste from this plan; do not retype. The `new_string` replaces `—` with a colon (`:`) per formatting constraints.
- Backticks in `old_string` are U+0060 GRAVE ACCENT (`` ` ``), not U+2018/U+2019 curly quotes.
- The slash `/` in `claude-mem` / `.claude/memory/project.md` is U+002F SOLIDUS.
- Spaces around `—` in `old_string` are regular U+0020 (one space each side); the colon in `new_string` has no trailing space before the content.
- Before running any Edit, verify em-dash presence: `grep -Pn '\x{2014}' <file>` (should match line 25 in global/CLAUDE.md and line 143 in README.md).

- [ ] [T-001-A] **Edit `global/CLAUDE.md` line 25**

  Old line:
  ```
  1. **Memory** — check `claude-mem` / `.claude/memory/project.md`. If the answer is there, stop.
  ```
  New line (em-dash replaced with colon):
  ```
  1. **Memory**: check `.claude/memory/project.md`. If the answer is there, stop.
  ```

  Use the Edit tool: `old_string` = `1. **Memory** — check \`claude-mem\` / \`.claude/memory/project.md\`. If the answer is there, stop.`; `new_string` = `1. **Memory**: check \`.claude/memory/project.md\`. If the answer is there, stop.`

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
  New line (em-dash replaced with colon):
  ```
  1. **Project memory**: `.claude/memory/project.md`
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
- Produces: `~/.claude/plugins/cache/code-conductor/code-conductor/<REMOTE_VERSION>/` directory on the user's machine (version resolved at runtime from `${REMOTE_VERSION:-1.0.0}`); `enabledPlugins["code-conductor@code-conductor"]: true` in `~/.claude/settings.json`

- [ ] [T-002-A-0] **Read `install.sh` lines 183–205 before editing**

  Before issuing any Edit call, read the exact source text:
  ```
  Read({ file_path: "install.sh", offset: 183, limit: 23 })
  ```
  Verify the output contains `install_dep "claude-mem"` and the `if [ "$HAS_NODE" = true ]` npm-install block. If the text differs from the `old_string` below (e.g. extra blank lines, different indentation), update the `old_string` in T-002-A to match before proceeding. Do not skip this step — Edit tool failures caused by truncated or mismatched blocks are the most common failure mode for this task.

- [ ] [T-002-A-1] **Backup `settings.json` before modification (bash)**

  Immediately before the node key-removal call, add this shell-level backup:
  ```bash
  if [ -f "${HOME}/.claude/settings.json" ]; then
    cp "${HOME}/.claude/settings.json" "${HOME}/.claude/settings.json.bak" 2>/dev/null || true
    # Backup validation: confirm .bak exists and is non-zero before proceeding
    if [ ! -s "${HOME}/.claude/settings.json.bak" ]; then
      warn "settings.json backup failed or produced empty file — proceeding without backup"
    fi
  fi
  ```
  Recovery: `cp "${HOME}/.claude/settings.json.bak" "${HOME}/.claude/settings.json"`. The `.bak` is overwritten on each install run. If recovery is needed: verify `settings.json.bak` is non-empty before restoring (`[ -s ... ]` check).

- [ ] [T-002-A-2] **Verify claude-mem cache directory is removed after uninstall**

  Add this assertion immediately after the npx uninstall call:
  ```bash
  _cm_cache="${HOME}/.claude/plugins/cache/thedotmack/claude-mem"
  if [ -d "${_cm_cache}" ]; then
    warn "claude-mem cache dir still present at ${_cm_cache} — manual cleanup may be needed"
  else
    ok "claude-mem cache dir removed"
  fi
  ```
  This is a non-fatal warn (not `exit 1`) because `npx claude-mem uninstall` may be unavailable on fresh machines where claude-mem was never installed.

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
    # Silent claude-mem removal — heals existing installs; no-op if npx/Node absent
    command -v npx >/dev/null 2>&1 && npx --yes claude-mem uninstall 2>/dev/null || true
    # Pre-verify parent directory of settings.json exists before any write
    mkdir -p "${HOME}/.claude" 2>/dev/null || true
    # Remove claude-mem@thedotmack from enabledPlugins (no-op on fresh installs)
    command -v node >/dev/null 2>&1 && node -e "
const f=require('os').homedir()+'/.claude/settings.json';
if(!require('fs').existsSync(f))process.exit(0);
let obj={};try{obj=JSON.parse(require('fs').readFileSync(f,'utf8'));}catch(e){}
if(obj.enabledPlugins){delete obj.enabledPlugins['claude-mem@thedotmack'];}
require('fs').mkdirSync(require('os').homedir()+'/.claude',{recursive:true});
require('fs').writeFileSync(f,JSON.stringify(obj,null,2)+'\n');
" 2>/dev/null || true
    # Glob-delete orphaned superpowers-cached critical-review skill (all versions)
    rm -rf "${HOME}/.claude/plugins/cache/claude-plugins-official/superpowers"/*/skills/critical-review 2>/dev/null || true
  ```

- [ ] [T-002-B-0] **Node.js version baseline check (bash)**

  Insert this guard at the top of the plugin creation block (inside `if [ "$SKIP_DEPS" = false ]`), before any `node -e` call:
  ```bash
  if command -v node >/dev/null 2>&1; then
    _node_major=$(node -e "process.stdout.write(String(process.version.split('.')[0].replace('v','')))" 2>/dev/null || echo "0")
    if [ "$_node_major" -lt 16 ] 2>/dev/null; then
      warn "Node.js v${_node_major} detected — v16+ required for plugin injection; skipping settings.json update"
      _node_ok=false
    else
      _node_ok=true
    fi
  else
    _node_ok=false
  fi
  ```
  Guard all subsequent `node -e` calls in this block with `[ "$_node_ok" = true ] &&`.

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
    _cc_ver="${REMOTE_VERSION:-1.0.0}"
    PLUGIN_DIR="${HOME}/.claude/plugins/cache/code-conductor/code-conductor/${_cc_ver}"
    rm -rf "${PLUGIN_DIR}" 2>/dev/null || true
    mkdir -p "${PLUGIN_DIR}/.claude-plugin"
    mkdir -p "${PLUGIN_DIR}/skills/critical-review"
    mkdir -p "${PLUGIN_DIR}/skills/memory-first"
    mkdir -p "${PLUGIN_DIR}/skills/agent-delegation"
    cat > "${PLUGIN_DIR}/.claude-plugin/plugin.json" <<PLUGINJSON
{
  "name": "code-conductor",
  "version": "${_cc_ver}",
  "description": "code-conductor custom skills: critical-review, memory-first, agent-delegation",
  "author": {
    "name": "code-conductor"
  }
}
PLUGINJSON
    # Path separator note: cp uses forward slashes on bash/macOS/Linux; on Windows Git Bash
    # forward slashes are also valid. The target SKILL.md path must use forward slashes here
    # because bash cp does not interpret backslashes as separators.
    cp "${GLOBAL_DIR}/skills/critical-review.md"   "${PLUGIN_DIR}/skills/critical-review/SKILL.md"
    cp "${GLOBAL_DIR}/skills/memory-first.md"       "${PLUGIN_DIR}/skills/memory-first/SKILL.md"
    cp "${GLOBAL_DIR}/skills/agent-delegation.md"   "${PLUGIN_DIR}/skills/agent-delegation/SKILL.md"
    # enabledPlugins note: if 'code-conductor@code-conductor' is already present but set to
    # false, the assignment below overwrites it with true — this is the correct healing behavior.
    command -v node >/dev/null 2>&1 && node -e "
const f=require('os').homedir()+'/.claude/settings.json';
let obj={};if(require('fs').existsSync(f)){try{obj=JSON.parse(require('fs').readFileSync(f,'utf8'));}catch(e){}}
if(!obj.enabledPlugins)obj.enabledPlugins={};
obj.enabledPlugins['code-conductor@code-conductor']=true;
require('fs').mkdirSync(require('os').homedir()+'/.claude',{recursive:true});
require('fs').writeFileSync(f,JSON.stringify(obj,null,2)+'\n');
" 2>/dev/null || true
    ok "code-conductor plugin installed (critical-review, memory-first, agent-delegation)"
  fi
  ```

- [ ] [T-002-C] **Verify plugin.json exists and is structurally valid**

  Run immediately after the installer code is written (before the test suite):

  ```bash
  _cc_ver="${REMOTE_VERSION:-1.0.0}"
  PLUGIN_DIR="${HOME}/.claude/plugins/cache/code-conductor/code-conductor/${_cc_ver}"
  [ -f "${PLUGIN_DIR}/.claude-plugin/plugin.json" ] \
    || { echo "ERROR: plugin.json not created"; exit 1; }
  node -e "
const pj = JSON.parse(require('fs').readFileSync('${PLUGIN_DIR}/.claude-plugin/plugin.json','utf8'));
['name','version','description','author'].forEach(k => {
  if (!pj[k]) throw new Error('plugin.json missing field: ' + k);
});
console.log('plugin.json OK: ' + pj.name + ' v' + pj.version);
"
  ```

  Expected output: `plugin.json OK: code-conductor v<version>` (e.g. `v1.14.0` when `REMOTE_VERSION=1.14.0`)

  **Version conflict check** — if a stale versioned dir from a previous install exists alongside the current one (e.g. `1.0.0/` coexisting with `1.14.0/`), the wipe in T-002-B removes only `${PLUGIN_DIR}` (the current version). Detect and warn about stale dirs:
  ```bash
  _cc_base="${HOME}/.claude/plugins/cache/code-conductor/code-conductor"
  _stale_count=$(ls -1 "${_cc_base}" 2>/dev/null | grep -cv "^${_cc_ver}$" || echo 0)
  [ "$_stale_count" -gt 0 ] && warn "Stale plugin version dirs found in ${_cc_base} — remove manually if needed"
  ```

  Also verify SKILL.md files were copied:
  ```bash
  for skill in critical-review memory-first agent-delegation; do
    [ -f "${PLUGIN_DIR}/skills/${skill}/SKILL.md" ] \
      || { echo "ERROR: missing SKILL.md for ${skill}"; exit 1; }
  done
  echo "All SKILL.md files present"
  ```

  Expected output: `All SKILL.md files present`

  **Bash parity: verify `enabledPlugins` key was written and `claude-mem` key is absent:**
  ```bash
  command -v node >/dev/null 2>&1 && node -e "
const s=require('os').homedir()+'/.claude/settings.json';
const obj=JSON.parse(require('fs').readFileSync(s,'utf8'));
if(obj.enabledPlugins?.['code-conductor@code-conductor']!==true)
  throw new Error('enabledPlugins code-conductor key not true');
if('claude-mem@thedotmack' in (obj.enabledPlugins||{}))
  process.stderr.write('WARN: claude-mem@thedotmack still present\n');
console.log('settings.json assertions passed');
" || echo "WARN: settings.json assertion check failed"
  ```
  Expected stdout: `settings.json assertions passed`

- [ ] [T-002-D] **Run tests**

  ```bash
  npm test
  ```
  Expected: all tests pass (142 passed, 3 skipped). The hook text edits from Task 1 do not affect test assertions (confirmed by grep — no tests assert on "claude-mem" text).

- [ ] [T-002-E] **Commit**

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
- Produces: `%USERPROFILE%\.claude\plugins\cache\code-conductor\code-conductor\<RemoteVersion>\` on Windows (version resolved at runtime from `if ($RemoteVersion) { $RemoteVersion } else { "1.0.0" }`); `enabledPlugins["code-conductor@code-conductor"]: true` in `~/.claude/settings.json`

- [ ] [T-003-A-0] **Read `install.ps1` lines 123–170 before editing**

  Before issuing any Edit call, read the exact source text:
  ```
  Read({ file_path: "install.ps1", offset: 123, limit: 48 })
  ```
  Verify the output contains `Write-Info "Installing claude-mem..."` and the winget fallback block. If the text differs from the `old_string` below, update the `old_string` in T-003-A to match before proceeding. Backtick continuation characters in PS (`` ` ``) must be preserved exactly — they are U+0060 GRAVE ACCENT, not U+2018/U+2019 curly quotes.

- [ ] [T-003-A-1] **Backup `settings.json` before modification (PowerShell)**

  Immediately before the `$cmNodeScript` execution, add:
  ```powershell
  $settingsPath = "$env:USERPROFILE\.claude\settings.json"
  $settingsBak  = "$env:USERPROFILE\.claude\settings.json.bak"
  if (Test-Path $settingsPath) {
    Copy-Item $settingsPath $settingsBak -Force
    # Backup validation: confirm .bak exists and is non-zero size before proceeding
    if (-not (Test-Path $settingsBak) -or (Get-Item $settingsBak).Length -eq 0) {
      Write-Warn "settings.json backup failed or produced empty file -- proceeding without backup"
    }
  }
  ```
  Recovery: `Copy-Item $settingsBak $settingsPath -Force`. Verify `(Get-Item $settingsBak).Length -gt 0` before restoring. Overwritten on each install run.

- [ ] [T-003-A-2] **Verify claude-mem cache directory removed (PowerShell)**

  Add after the uninstall call:
  ```powershell
  $cmCache = "$env:USERPROFILE\.claude\plugins\cache\thedotmack\claude-mem"
  if (Test-Path $cmCache) {
    Write-Warn "claude-mem cache dir still present at $cmCache — manual cleanup may be needed"
  } else {
    Write-Ok "claude-mem cache dir removed"
  }
  ```

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

  Use the Edit tool: `old_string` = the entire block shown above (lines 127–165); `new_string` = the replacement block below.

  New (replacement — inside the `-not $NoDeps` block, directly after `Write-Host ""`):
  ```powershell
    # Silent claude-mem removal — heals existing installs; no-op if npx/Node absent
    Write-Info "Removing claude-mem (no-op if never installed)..."
    # Explicit npx guard: try/catch absorbs command-not-found on Node-absent machines
    if (Get-Command npx -ErrorAction SilentlyContinue) {
      try { $null = cmd /c "npx --yes claude-mem uninstall 2>nul" } catch {}
    }
    # Pre-verify parent directory of settings.json exists before any write
    New-Item -ItemType Directory -Force "$env:USERPROFILE\.claude" -ErrorAction SilentlyContinue | Out-Null
    # Remove claude-mem@thedotmack from enabledPlugins (no-op on fresh installs)
    $cmNodeScript = @'
const f=require('os').homedir()+'/.claude/settings.json';
if(!require('fs').existsSync(f))process.exit(0);
let obj={};try{obj=JSON.parse(require('fs').readFileSync(f,'utf8'));}catch(e){}
if(obj.enabledPlugins){delete obj.enabledPlugins['claude-mem@thedotmack'];}
require('fs').mkdirSync(require('os').homedir()+'/.claude',{recursive:true});
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

- [ ] [T-003-B-0] **Node.js version baseline check (PowerShell)**

  Insert this guard at the top of the plugin creation block (inside `if (-not $NoDeps)`):
  ```powershell
  $nodeOk = $false
  if (Get-Command node -ErrorAction SilentlyContinue) {
    $nodeMajor = [int](node -e "process.stdout.write(String(process.version.split('.')[0].replace('v','')))" 2>$null)
    if ($nodeMajor -ge 16) { $nodeOk = $true }
    else { Write-Warn "Node.js v$nodeMajor detected -- v16+ required for plugin injection; skipping settings.json update" }
  }
  ```
  Gate all subsequent `node -e` calls in this block with `if ($nodeOk) { ... }`.

  **Windows permission error handling**: On corporate machines with restricted `%APPDATA%` or `%USERPROFILE%`, `New-Item` or `Copy-Item` may throw `UnauthorizedAccessException`. Wrap the entire plugin creation block in:
  ```powershell
  try {
    # ... all New-Item, Copy-Item, node -e calls ...
  } catch [System.UnauthorizedAccessException] {
    Write-Warn "code-conductor plugin install failed: access denied at $pluginDir"
    Write-Warn "Fix: run installer as Administrator, or grant write access to $env:USERPROFILE\.claude\plugins"
  } catch {
    Write-Warn "code-conductor plugin install failed: $_"
  }
  ```
  The outer `if (-not $NoDeps)` block remains; the `try/catch` is the inner wrapper. A permission failure is non-fatal — the installer continues; missing the plugin is reported via `Write-Warn`, not `throw`.

- [ ] [T-003-B] **Add code-conductor plugin creation block after global settings merge**

  In `install.ps1`, find the line:
  ```powershell
  Merge-SettingsJson "$GLOBAL_DIR\settings.json" $globalHookCmd
  ```

  Insert the following block IMMEDIATELY AFTER that line (before the `# -- Install project template` comment):

  ```powershell
  # -- code-conductor plugin: wipe versioned dir and recreate --------------------
  if (-not $NoDeps) {
    $ccVersion = if ($RemoteVersion) { $RemoteVersion } else { "1.0.0" }
    $pluginDir = "$env:USERPROFILE\.claude\plugins\cache\code-conductor\code-conductor\$ccVersion"
    if (Test-Path $pluginDir) { Remove-Item -Recurse -Force $pluginDir }
    New-Item -ItemType Directory -Force "$pluginDir\.claude-plugin" | Out-Null
    # Create intermediate skills/ dir before leaf subdirs (required on PS 5.1)
    New-Item -ItemType Directory -Force "$pluginDir\skills" | Out-Null
    New-Item -ItemType Directory -Force "$pluginDir\skills\critical-review" | Out-Null
    New-Item -ItemType Directory -Force "$pluginDir\skills\memory-first" | Out-Null
    New-Item -ItemType Directory -Force "$pluginDir\skills\agent-delegation" | Out-Null
    $pluginEnc = [System.Text.UTF8Encoding]::new($false)
    # Double-quoted here-string so $ccVersion expands into plugin.json content
    $pluginJsonContent = @"
{
  "name": "code-conductor",
  "version": "$ccVersion",
  "description": "code-conductor custom skills: critical-review, memory-first, agent-delegation",
  "author": {
    "name": "code-conductor"
  }
}
"@
    [System.IO.File]::WriteAllText(
      "$pluginDir\.claude-plugin\plugin.json",
      $pluginJsonContent + "`n",
      $pluginEnc
    )
    # Path separator note: Copy-Item on PS 5.1/Windows uses backslashes here because
    # $pluginDir and $GLOBAL_DIR were set with backslash separators. Claude Code plugin
    # resolution on Windows reads SKILL.md via its own path normalization — backslash
    # paths in the plugin dir are correct on Windows; forward slashes also work on PS 5.1.
    Copy-Item "$GLOBAL_DIR\skills\critical-review.md"   "$pluginDir\skills\critical-review\SKILL.md"
    Copy-Item "$GLOBAL_DIR\skills\memory-first.md"       "$pluginDir\skills\memory-first\SKILL.md"
    Copy-Item "$GLOBAL_DIR\skills\agent-delegation.md"   "$pluginDir\skills\agent-delegation\SKILL.md"
    # enabledPlugins note: if 'code-conductor@code-conductor' is already present but set to
    # false, the assignment below overwrites it with true — correct healing behavior.
    $enableScript = @'
const f=require('os').homedir()+'/.claude/settings.json';
let obj={};if(require('fs').existsSync(f)){try{obj=JSON.parse(require('fs').readFileSync(f,'utf8'));}catch(e){}}
if(!obj.enabledPlugins)obj.enabledPlugins={};
obj.enabledPlugins['code-conductor@code-conductor']=true;
require('fs').mkdirSync(require('os').homedir()+'/.claude',{recursive:true});
require('fs').writeFileSync(f,JSON.stringify(obj,null,2)+'\n');
'@
    if (Get-Command node -ErrorAction SilentlyContinue) {
      node -e $enableScript 2>$null
    }
    Write-Ok "code-conductor plugin installed (critical-review, memory-first, agent-delegation)"
  }
  ```

- [ ] [T-003-C] **Verify plugin.json exists and is structurally valid (PowerShell)**

  Run after the installer block is written:

  ```powershell
  $ccVersion = if ($RemoteVersion) { $RemoteVersion } else { "1.0.0" }
  $pluginDir = "$env:USERPROFILE\.claude\plugins\cache\code-conductor\code-conductor\$ccVersion"
  if (-not (Test-Path "$pluginDir\.claude-plugin\plugin.json")) {
    throw "ERROR: plugin.json not created at $pluginDir\.claude-plugin\plugin.json"
  }
  $pj = Get-Content "$pluginDir\.claude-plugin\plugin.json" -Raw -Encoding utf8 | ConvertFrom-Json
  @('name','version','description','author') | ForEach-Object {
    if (-not $pj.$_) { throw "plugin.json missing field: $_" }
  }
  # Parity assertion: version field must exactly match the runtime $ccVersion
  if ($pj.version -ne $ccVersion) {
    throw "plugin.json version '$($pj.version)' does not match expected '$ccVersion'"
  }
  Write-Ok "plugin.json OK: $($pj.name) v$($pj.version)"
  ```

  Expected output: `[OK] plugin.json OK: code-conductor v<version>` (e.g. `v1.14.0` when `$RemoteVersion = "1.14.0"`)

  **PS parity: verify `enabledPlugins` key was written to `settings.json`:**
  ```powershell
  $settingsJson = Get-Content "$env:USERPROFILE\.claude\settings.json" -Raw -Encoding utf8 | ConvertFrom-Json
  if ($settingsJson.enabledPlugins.'code-conductor@code-conductor' -ne $true) {
    throw "ERROR: enabledPlugins['code-conductor@code-conductor'] not set to true in settings.json"
  }
  Write-Ok "settings.json enabledPlugins entry confirmed"
  ```
  Expected output: `[OK] settings.json enabledPlugins entry confirmed`

  **PS parity: verify `claude-mem@thedotmack` key is absent (not just false):**
  ```powershell
  $cmKey = $settingsJson.enabledPlugins.'claude-mem@thedotmack'
  if ($null -ne $cmKey) {
    Write-Warn "claude-mem@thedotmack still present in enabledPlugins (value: $cmKey) -- key removal may have failed"
  } else {
    Write-Ok "claude-mem@thedotmack key absent from enabledPlugins"
  }
  ```

  **Version conflict check** — detect stale versioned dirs from prior installs:
  ```powershell
  $ccBase = "$env:USERPROFILE\.claude\plugins\cache\code-conductor\code-conductor"
  $staleDirs = Get-ChildItem $ccBase -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -ne $ccVersion }
  if ($staleDirs) {
    Write-Warn "Stale plugin version dirs found: $($staleDirs.Name -join ', ') -- remove manually if needed"
  }
  ```

  Also verify SKILL.md files are present and non-empty:
  ```powershell
  @('critical-review','memory-first','agent-delegation') | ForEach-Object {
    $skillPath = "$pluginDir\skills\$_\SKILL.md"
    if (-not (Test-Path $skillPath)) { throw "ERROR: missing SKILL.md for $_" }
    if ((Get-Item $skillPath).Length -eq 0) { throw "ERROR: SKILL.md is empty for $_" }
  }
  Write-Ok "All SKILL.md files present and non-empty"
  ```

  Expected output: `[OK] All SKILL.md files present and non-empty`

- [ ] [T-003-D] **Run tests**

  ```bash
  npm test
  ```
  Expected: 142 passed, 3 skipped.

- [ ] [T-003-E] **Commit**

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

  First read the file to confirm its sole content:
  ```
  Read({ file_path: "VERSION" })
  ```
  Expected content: a single line `1.13.0` (no surrounding text). Then use the Edit tool:
  - `file_path`: `VERSION`
  - `old_string`: `1.13.0`
  - `new_string`: `1.14.0`

  Verify with `Read({ file_path: "VERSION" })` — must contain only `1.14.0`.

- [ ] [T-004-B] **Edit `package.json` version field**

  First read the relevant lines to confirm uniqueness of the match:
  ```
  Read({ file_path: "package.json", offset: 1, limit: 10 })
  ```
  Confirm the `"version"` key appears exactly once in the file (grep: `grep -c '"version"' package.json` → `1`). Then use the Edit tool:
  - `file_path`: `package.json`
  - `old_string`: `"version": "1.13.0"`
  - `new_string`: `"version": "1.14.0"`

  Verify: `grep '"version"' package.json` → `"version": "1.14.0"`.

- [ ] [T-004-C] **Prepend `[1.14.0]` entry to `CHANGELOG.md`**

  First read the top of CHANGELOG.md to confirm the exact anchor text:
  ```
  Read({ file_path: "CHANGELOG.md", offset: 1, limit: 8 })
  ```
  The file must start with `# Changelog` followed by blank lines then `## [1.13.0]`. Use the Edit tool with **literal newlines** (not `\n` escape sequences) in `old_string`:
  - `file_path`: `CHANGELOG.md`
  - `old_string`: the exact literal text of the first 4 lines (including blank lines) as returned by the Read above
  - `new_string`: the same anchor line + the `[1.14.0]` block + the `[1.13.0]` anchor

  The full `new_string` content to write (use literal newlines):
  ```markdown
  # Changelog


  ## [1.14.0] - 2026-06-23

  ### Removed
  - `[BUG-020]` claude-mem installation steps removed from `install.sh` and `install.ps1`; silent `npx --yes claude-mem uninstall` call added to heal existing installs; `claude-mem@thedotmack` key removed from `enabledPlugins` in `~/.claude/settings.json` on install
  - `[BUG-020]` Orphaned superpowers-cached `critical-review` skill glob-deleted on install (all superpowers versions)

  ### Added
  - `[BUG-020]` code-conductor Claude Code plugin (`~/.claude/plugins/cache/code-conductor/code-conductor/<version>/`) — owns `critical-review`, `memory-first`, and `agent-delegation` skills; installed and enabled by both installers
  - `[BUG-020]` `"code-conductor@code-conductor": true` injected into `~/.claude/settings.json` `enabledPlugins` by both installers; `Skill({ skill: "critical-review" })` now resolves without superpowers dependency

  ### Changed
  - `[BUG-020]` 6 prose references to `claude-mem` replaced with `.claude/memory/project.md` in `global/CLAUDE.md`, `skills/memory-first.md`, `skills/agent-delegation.md`, `README.md`, `.claude/hooks/pre-tool-use.sh`, `project-template/.claude/hooks/pre-tool-use.sh`


  ## [1.13.0]
  ```

  Verify: `Read({ file_path: "CHANGELOG.md", offset: 1, limit: 20 })` — must show `[1.14.0]` before `[1.13.0]`.

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

### Task 5: Automated plugin test file

**Files:**
- Create: `tests/plugin/code-conductor-plugin.test.js`

**Interfaces:**
- Consumes: `~/.claude/plugins/cache/code-conductor/code-conductor/<version>/` — present only when the installer has run (not in CI where install hasn't executed)
- Produces: 5 test assertions that gate plugin schema and skill file integrity

- [ ] [T-005-A] **Create `tests/plugin/code-conductor-plugin.test.js`**

  ```js
  const fs = require('fs');
  const path = require('path');
  const os = require('os');

  const PLUGIN_BASE = path.join(os.homedir(), '.claude', 'plugins', 'cache', 'code-conductor', 'code-conductor');
  const PLUGIN_INSTALLED = fs.existsSync(PLUGIN_BASE);

  const describeIf = PLUGIN_INSTALLED ? describe : describe.skip;

  describeIf('code-conductor plugin', () => {
    let pluginDir;

    beforeAll(() => {
      // Resolve the single versioned subdirectory
      const versions = fs.readdirSync(PLUGIN_BASE);
      expect(versions).toHaveLength(1);
      pluginDir = path.join(PLUGIN_BASE, versions[0]);
    });

    test('versioned plugin directory exists', () => {
      expect(fs.existsSync(pluginDir)).toBe(true);
    });

    test('plugin.json has all 4 required fields', () => {
      const jsonPath = path.join(pluginDir, '.claude-plugin', 'plugin.json');
      expect(fs.existsSync(jsonPath)).toBe(true);
      const pj = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      expect(pj.name).toBe('code-conductor');
      expect(typeof pj.version).toBe('string');
      expect(pj.version.length).toBeGreaterThan(0);
      expect(typeof pj.description).toBe('string');
      expect(pj.description.length).toBeGreaterThan(0);
      expect(pj.author && pj.author.name).toBe('code-conductor');
    });

    test.each(['critical-review', 'memory-first', 'agent-delegation'])(
      'SKILL.md for %s exists and is non-empty',
      (skill) => {
        const skillPath = path.join(pluginDir, 'skills', skill, 'SKILL.md');
        expect(fs.existsSync(skillPath)).toBe(true);
        expect(fs.statSync(skillPath).size).toBeGreaterThan(0);
      }
    );
  });
  ```

- [ ] [T-005-B] **Run tests**

  ```bash
  npm test
  ```
  Expected: 142+ passed (new tests skip in CI where plugin dir is absent), 3 skipped.

- [ ] [T-005-C] **Commit**

  ```bash
  git add tests/plugin/code-conductor-plugin.test.js
  git commit -m "test: add code-conductor plugin schema and skill file assertions"
  ```

- [ ] [T-005-D] **Manual smoke test: Claude Code CLI plugin load**

  After both installers have run (or after `bash install.sh` completes on the local machine), verify the plugin loads cleanly:

  ```bash
  # Confirm CLI is available
  claude --version
  ```
  Expected: a version string (any); confirms Claude Code CLI is on PATH.

  Then start a new session and run:
  ```
  /graphify
  ```
  If the skill resolves without `Unknown skill: graphify`, the plugin directory is being scanned. Then verify the code-conductor skills:
  ```
  /critical-review
  ```
  Expected: skill content loads (no `Unknown skill: critical-review` error).

  **Note**: This step cannot be automated in `npm test` because it requires a live Claude Code session. Record the result manually. If `Unknown skill` is returned, check:
  1. `~/.claude/settings.json` contains `"code-conductor@code-conductor": true`
  2. `~/.claude/plugins/cache/code-conductor/code-conductor/<version>/.claude-plugin/plugin.json` exists with all 4 fields
  3. Claude Code was restarted after the installer ran (plugin registry is read at session start)

---

## Test List

- [ ] `npm test` passes after each commit (T-002-D, T-003-D, T-004-D) — 142 passed, 3 skipped
- [ ] No test file asserts on "claude-mem" text (pre-confirmed by grep — no updates needed)
- [ ] Manual smoke: run `bash install.sh --no-deps` on a clean machine — no claude-mem step runs, no plugin created (NoDeps guard)
- [ ] Manual smoke: run `bash install.sh` — `~/.claude/plugins/cache/code-conductor/code-conductor/<REMOTE_VERSION>/.claude-plugin/plugin.json` exists with correct 4-field schema

## Commit Order

1. T-001-G — prose edits (6 files, 1 commit)
2. T-002-E — install.sh (1 commit)
3. T-003-E — install.ps1 (1 commit)
4. T-004-E — version bump (1 commit)
5. T-005-C — plugin test file (1 commit)

Total: 5 commits.

## Identified Risks

1. **plugin.json heredoc trailing newline**: bash `cat > file <<'EOF'` appends a final newline from the heredoc — the file will end with `}\n`. This matches the spec requirement. Verify with `xxd "${PLUGIN_DIR}/.claude-plugin/plugin.json" | tail -1` — last byte should be `0a`.
2. **PS `node -e` here-string quoting**: The single-quoted `@'...'@` here-string in PS 5.1 does not expand `$` — JS `$` signs inside the script are safe. Verify after install that `settings.json` contains `"code-conductor@code-conductor": true` and lacks `"claude-mem@thedotmack"`.
3. **settings.json race**: both the key-removal and key-addition `node -e` calls read and write `settings.json` in sequence. On a fresh machine where `settings.json` was just created by `_merge_settings_json`, the file exists before the key-addition call. No race on single-threaded install.
4. **SKIP_DEPS guard split**: the uninstall+cleanup is in the existing `SKIP_DEPS` block; the plugin creation is in a second `if [ "$SKIP_DEPS" = false ]` block after global file downloads. Both are skipped when `--no-deps` is passed. Verify by running `bash install.sh --no-deps` and confirming no `code-conductor` dir is created.
5. **Global skills not yet downloaded at SKIP_DEPS time**: The `cp` calls in the plugin block (T-002-B section 2) reference `${GLOBAL_DIR}/skills/*.md`, which are written by the `download` calls above in the installer flow — the plugin block is placed AFTER those downloads, so the files exist. Confirm by checking the installer comment `# ── code-conductor plugin: wipe versioned dir and recreate` appears after `download "skills/agent-delegation.md"`.
