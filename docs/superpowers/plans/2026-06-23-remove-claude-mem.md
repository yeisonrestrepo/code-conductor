# Remove claude-mem + Introduce code-conductor Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strip all claude-mem installation steps from both installers, add a silent uninstall to heal existing setups, move the three custom skills into a code-conductor plugin so they are Skill-tool-invokable, and update 6 prose references.

**Architecture:** Two phases: (1) surgical 1-line prose edits with no logic changes; (2) installer rewrites that remove the claude-mem block, move the silent uninstall + key-removal + glob-delete OUTSIDE the `SKIP_DEPS` / `-NoDeps` guard (so broken environments are healed unconditionally), and add a plugin-creation block inside the existing `SKIP_DEPS` guard after the global settings merge. The plugin directory is wiped and recreated on every install to stay idempotent.

**Tech Stack:** bash, PowerShell 5.1, Node.js inline scripts (no jq assumption), Claude Code plugin schema.

## Global Constraints

- JSON output: 2-space indentation + trailing newline (`JSON.stringify(obj, null, 2) + '\n'`). No minification.
- No `jq` assumption: all `settings.json` manipulation uses `node -e` inline scripts.
- `set -euo pipefail` compatibility: every `node -e` call prefixed with `command -v node >/dev/null 2>&1 &&`; every non-fatal command suffixed with `|| true`; the uninstall call prefixed with `command -v npx >/dev/null 2>&1 &&`.
- `node -e` JSON resilience: all `JSON.parse` calls wrapped in `try/catch`; malformed or empty `settings.json` falls back to `{}` without aborting.
- Dynamic plugin version: both installers read `REMOTE_VERSION` / `$RemoteVersion` (already set by the version-fetch at the top of each installer) and use it for the plugin directory path and `plugin.json` version field. Fallback: `"1.0.0"` when the version fetch fails.
- Version harmonization: `VERSION`, `package.json`, `plugin.json`, and the plugin directory path must all resolve to the same version string at runtime. After the Task 4 version bump, the installer's `REMOTE_VERSION` fetch will return `1.14.0` from the remote tag; the `VERSION` file on disk will also read `1.14.0`. On offline/fresh machines where the remote fetch fails, the fallback `"1.0.0"` is the safe sentinel - it does NOT need to match `1.14.0` because it only applies when the remote is unreachable (the `.bak` path protects against a corrupted install).
- Remote version fetch execution sequence: (1) installer starts; (2) `REMOTE_VERSION` is set via `curl`/`Invoke-WebRequest` at the top of each installer script; (3) if the fetch times out or fails, `REMOTE_VERSION` is empty and `_cc_ver` / `$ccVersion` falls back to `"1.0.0"`; (4) plugin dir is created under `${_cc_ver}` / `$ccVersion`; (5) `plugin.json` version field is written with the same value; (6) `enabledPlugins` key is set regardless of version. Both the fallback path and the live path result in a valid plugin: they differ only in the versioned subdirectory name.
- Local testing with pre-release version: when testing changes locally before the tag `v1.14.0` is pushed to the remote, the installer's fetch will return the current released version (e.g., `1.13.0`), not `1.14.0`. Override with: `REMOTE_VERSION=1.14.0 bash install.sh` (bash) or `$env:REMOTE_VERSION="1.14.0"; .\install.ps1` (PS). Never run the installer without this override during pre-release local testing, otherwise the plugin dir and `plugin.json` version will reflect the wrong version and subsequent verification steps will fail.
- PS 5.1: mid-path wildcard glob-delete requires `Get-ChildItem` pipeline. No `&&`/`||` operator chains. `try/catch` for command-not-found.
- `plugin.json` required fields: `name`, `version`, `description`, `author.name` - all four, exact values.
- `enabledPlugins` JSON path: nested inside `{ "enabledPlugins": { ... } }`, not top-level.
- `node -e` null guard: `if (obj.enabledPlugins) { delete ... }` before delete; `if (!obj.enabledPlugins) obj.enabledPlugins = {}` before set.
- Plugin dir wipe: bash uses `rm -rf "${PLUGIN_DIR}" 2>/dev/null || true`; PS uses `if (Test-Path $pluginDir) { Remove-Item -Recurse -Force $pluginDir }`.
- `memory-first` and `agent-delegation` were NEVER in the superpowers cache - no cleanup of those names.
- BUG-003 invariant: all plan file edits are single-line surgical Edits only.
- Version bump target: `1.13.0` → `1.14.0`.
- Absolute path resolution: all path variables (`${HOME}`, `$env:USERPROFILE`, `${GLOBAL_DIR}`, `$GLOBAL_DIR`) must resolve to absolute paths. Never use bare relative paths (e.g., `./plugins/`) in any installer step - always prefix with `${HOME}/` (bash) or `$env:USERPROFILE\` (PS). If `$HOME` is unset on the executing shell, the installer must abort with an explicit error before any path operation.
- `settings.json` rollback procedure: if the installer fails at any point after `settings.json` has been mutated, restore from backup: bash `[ -s "${HOME}/.claude/settings.json.bak" ] && cp "${HOME}/.claude/settings.json.bak" "${HOME}/.claude/settings.json"` / PS `if ((Get-Item "$env:USERPROFILE\.claude\settings.json.bak" -EA 0).Length -gt 0) { Copy-Item "$env:USERPROFILE\.claude\settings.json.bak" "$env:USERPROFILE\.claude\settings.json" -Force }`. The backup is created in T-002-A-1 / T-003-A-1 BEFORE any mutation. Never restore without first verifying the `.bak` is non-empty (`[ -s ... ]` / `Length -gt 0`).
- `settings.json` absent or unwritable parent: all `node -e` scripts guard with `if(!require('fs').existsSync(f))process.exit(0)` so a missing file is a no-op. `mkdirSync(dir,{recursive:true})` before `writeFileSync` creates `~/.claude/` if absent. If `~/.claude/` cannot be created (read-only `$HOME`, restricted permissions on corporate machines), `mkdirSync` throws - this is absorbed by `2>/dev/null || true` (bash) / `2>$null` (PS), and the missing entry is flagged during T-002-C / T-003-C assertion checks.
- Backup file cleanup policy: `settings.json.bak` is created (or overwritten) at the start of each installer run and is NOT auto-deleted on success. It persists as a recovery artifact. Manual cleanup after a verified successful install: bash `rm "${HOME}/.claude/settings.json.bak"` / PS `Remove-Item "$env:USERPROFILE\.claude\settings.json.bak"`. Never delete before confirming the active `settings.json` parses correctly. Safe to remove after 30 days or after the next successful installer run.

---

### Task 1: Surgical prose edits - remove "claude-mem" from 6 files

**Files:**
- Modify: `global/CLAUDE.md` (grep anchor: `check \`claude-mem\` /`)
- Modify: `skills/memory-first.md` (grep anchor: `claude-mem\` index`)
- Modify: `skills/agent-delegation.md` (grep anchor: `project.md\` or claude-mem`)
- Modify: `README.md` (grep anchor: `claude-mem\` / \`project.md\``)
- Modify: `project-template/.claude/hooks/pre-tool-use.sh` (grep anchor: `Check claude-mem / project.md`)
- Modify: `.claude/hooks/pre-tool-use.sh` (grep anchor: `Check claude-mem / project.md`)

**Interfaces:**
- Produces: 6 files with "claude-mem" references replaced by `.claude/memory/project.md`

**Punctuation matching rules (critical: mismatches silently fail Edit tool):**
- The `old_string` in T-001-A and T-001-D contains a U+2014 EM DASH between `**Memory**` and `check`, and between `**Project memory**` and the backtick. These em-dashes must appear verbatim in the `old_string` or the Edit tool will fail to match. Copy the old_string exactly from the code block below; do not retype the em-dash character. The `new_string` for both edits replaces the em-dash construction with a colon per formatting constraints.
- Backticks in `old_string` are U+0060 GRAVE ACCENT (`` ` ``), not curly quotes.
- The slash `/` in `claude-mem` / `.claude/memory/project.md` is U+002F SOLIDUS.
- Before running any Edit on global/CLAUDE.md or README.md, verify em-dash presence: `grep -Pn '\x{2014}' <file>` (the grep should return a match; if it returns nothing the file has already been edited and you can skip the step).

- [ ] [T-001-A] **Edit `global/CLAUDE.md` (anchor: `check \`claude-mem\` /`)**

  Old line:
  ```
  1. **Memory** — check `claude-mem` / `.claude/memory/project.md`. If the answer is there, stop.
  ```
  New line (em-dash replaced with colon):
  ```
  1. **Memory**: check `.claude/memory/project.md`. If the answer is there, stop.
  ```

  Use the Edit tool: `old_string` = `1. **Memory** — check \`claude-mem\` / \`.claude/memory/project.md\`. If the answer is there, stop.`; `new_string` = `1. **Memory**: check \`.claude/memory/project.md\`. If the answer is there, stop.`

- [ ] [T-001-B] **Edit `skills/memory-first.md` (anchor: `claude-mem\` index`)**

  Old line:
  ```
  Check `.claude/memory/project.md` and the `claude-mem` index.
  ```
  New line:
  ```
  Check `.claude/memory/project.md`.
  ```

- [ ] [T-001-C] **Edit `skills/agent-delegation.md` (anchor: `project.md\` or claude-mem`)**

  Old line:
  ```
  - Answer is already in `project.md` or claude-mem.
  ```
  New line:
  ```
  - Answer is already in `.claude/memory/project.md`.
  ```

- [ ] [T-001-D] **Edit `README.md` (anchor: `claude-mem\` / \`project.md\``)**

  Old line:
  ```
  1. **Project memory** — `claude-mem` / `project.md`
  ```
  New line (em-dash replaced with colon):
  ```
  1. **Project memory**: `.claude/memory/project.md`
  ```

- [ ] [T-001-E] **Edit `project-template/.claude/hooks/pre-tool-use.sh` (anchor: `Check claude-mem / project.md`)**

  Old line:
  ```
     echo "   1. Check claude-mem / project.md"
  ```
  New line:
  ```
     echo "   1. Check .claude/memory/project.md"
  ```

- [ ] [T-001-F] **Edit `.claude/hooks/pre-tool-use.sh` (anchor: `Check claude-mem / project.md`)**

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

### Task 2: `install.sh` - remove claude-mem block, add silent uninstall + plugin wiring

**Files:**
- Modify: `install.sh` (lines 187–199 removed; two new blocks added)

**Interfaces:**
- Consumes: `${GLOBAL_DIR}/skills/critical-review.md`, `${GLOBAL_DIR}/skills/memory-first.md`, `${GLOBAL_DIR}/skills/agent-delegation.md` (written by the `download` calls at lines 965–969, which run before the new plugin block)
- Produces: `~/.claude/plugins/cache/code-conductor/code-conductor/<REMOTE_VERSION>/` directory on the user's machine (version resolved at runtime from `${REMOTE_VERSION:-1.0.0}`); `enabledPlugins["code-conductor@code-conductor"]: true` in `~/.claude/settings.json`

- [ ] [T-002-A-0] **Locate and read the claude-mem install block in `install.sh` before editing**

  Do not rely on line numbers (they shift with code drift). Instead, find the block by content:
  ```bash
  grep -n 'install_dep "claude-mem"' install.sh
  ```
  Note the returned line number as `$N`. Then read 20 lines from that point:
  ```
  Read({ file_path: "install.sh", offset: $N - 1, limit: 20 })
  ```
  Verify the output contains `install_dep "claude-mem"` followed by the `if [ "$HAS_NODE" = true ]` npm-install block. If the block differs from `old_string` below (extra blank lines, indentation), update `old_string` to match before proceeding. Do not skip this step: Edit tool failures from mismatched blocks are the most common failure mode for this task.

- [ ] [T-002-A-1] **Backup `settings.json` before modification (bash)**

  Immediately before the node key-removal call, add this shell-level backup:
  ```bash
  if [ -f "${HOME}/.claude/settings.json" ]; then
    cp "${HOME}/.claude/settings.json" "${HOME}/.claude/settings.json.bak" 2>/dev/null || true
    # Backup validation: confirm .bak exists and is non-zero before proceeding
    if [ ! -s "${HOME}/.claude/settings.json.bak" ]; then
      warn "settings.json backup failed or produced empty file - proceeding without backup"
    fi
  fi
  ```
  Recovery: `cp "${HOME}/.claude/settings.json.bak" "${HOME}/.claude/settings.json"`. The `.bak` is overwritten on each install run. If recovery is needed: verify `settings.json.bak` is non-empty before restoring (`[ -s ... ]` check).

- [ ] [T-002-A-2] **Verify claude-mem cache directory is removed after uninstall**

  Add this assertion immediately after the npx uninstall call:
  ```bash
  _cm_cache="${HOME}/.claude/plugins/cache/thedotmack/claude-mem"
  if [ -d "${_cm_cache}" ]; then
    warn "claude-mem cache dir still present at ${_cm_cache} - manual cleanup may be needed"
  else
    ok "claude-mem cache dir removed"
  fi
  ```
  This is a non-fatal warn (not `exit 1`) because `npx claude-mem uninstall` may be unavailable on fresh machines where claude-mem was never installed.

- [ ] [T-002-A] **Remove the claude-mem install block from the SKIP_DEPS section**

  In `install.sh`, find and delete the block starting with `install_dep "claude-mem"` (located by T-002-A-0 grep). Use the Edit tool with `old_string` set to the entire block and `new_string` set to the replacement below. Do not use line numbers as the anchor.

  Old (to remove entirely - replace with the uninstall + cleanup lines):
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

  New (replacement - placed OUTSIDE the SKIP_DEPS block, unconditionally, so broken environments are healed even when `--no-deps` is passed):
  ```bash
    # Unconditional claude-mem removal: heals existing installs regardless of --no-deps
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
      warn "Node.js v${_node_major} detected - v16+ required for plugin injection; skipping settings.json update"
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
    # Active Claude Code process check: on Linux/macOS rm succeeds on open files (files unlinked
    # but space held until process closes). On Windows/Git Bash the wipe may leave locked files
    # behind. Warn the user to close Claude Code before proceeding.
    if command -v pgrep >/dev/null 2>&1 && pgrep -x "claude" >/dev/null 2>&1; then
      warn "Claude Code process detected -- plugin dir wipe may leave locked files; close Claude Code before running installer, or restart it after install completes"
    fi
    # Write permission pre-check: verify ~/.claude/plugins is writable before any wipe or mkdir
    mkdir -p "${HOME}/.claude/plugins" 2>/dev/null || true
    if [ ! -w "${HOME}/.claude/plugins" ] && [ ! -w "${HOME}/.claude" ] && [ ! -w "${HOME}" ]; then
      warn "No write permission on ${HOME}/.claude/plugins -- code-conductor plugin install may fail (check directory permissions or run with sudo)"
    fi
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
    # false, the assignment below overwrites it with true - this is the correct healing behavior.
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

  **Version conflict check** - if a stale versioned dir from a previous install exists alongside the current one (e.g. `1.0.0/` coexisting with `1.14.0/`), the wipe in T-002-B removes only `${PLUGIN_DIR}` (the current version). Detect and warn about stale dirs:
  ```bash
  _cc_base="${HOME}/.claude/plugins/cache/code-conductor/code-conductor"
  _stale_count=$(ls -1 "${_cc_base}" 2>/dev/null | grep -cv "^${_cc_ver}$" || echo 0)
  [ "$_stale_count" -gt 0 ] && warn "Stale plugin version dirs found in ${_cc_base} - remove manually if needed"
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

  **Bash trailing newline verification with xxd fallback (minimal environments):** `xxd` may be absent on Alpine, BusyBox, or distroless containers. Use this fallback chain:
  ```bash
  if command -v xxd >/dev/null 2>&1; then
    _last_nibble=$(xxd "${PLUGIN_DIR}/.claude-plugin/plugin.json" | awk 'END{print $NF}')
    [ "$_last_nibble" = "0a" ] \
      && echo "plugin.json trailing newline: LF confirmed (xxd)" \
      || warn "plugin.json does not end with LF (xxd: last nibble is ${_last_nibble})"
  elif command -v od >/dev/null 2>&1; then
    _last_byte=$(od -An -tx1 "${PLUGIN_DIR}/.claude-plugin/plugin.json" | awk 'END{print $NF}')
    [ "$_last_byte" = "0a" ] \
      && echo "plugin.json trailing newline: LF confirmed (od)" \
      || warn "plugin.json does not end with LF (od: last byte is ${_last_byte})"
  else
    command -v node >/dev/null 2>&1 && node -e "
const b=require('fs').readFileSync('${PLUGIN_DIR}/.claude-plugin/plugin.json');
if(b[b.length-1]!==0x0a){process.stderr.write('WARN: plugin.json does not end with LF (node)\n');}
else{console.log('plugin.json trailing newline: LF confirmed (node fallback)');}
" 2>/dev/null || true
  fi
  ```
  Expected: one of the three `LF confirmed` lines. If all three tools are absent, skip and rely on the T-003-C PS byte-level assertion as the authoritative check.

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
  Expected: all tests pass (142 passed, 3 skipped). The hook text edits from Task 1 do not affect test assertions (confirmed by grep - no tests assert on "claude-mem" text).

- [ ] [T-002-E] **Commit**

  ```bash
  git add install.sh
  git commit -m "feat: remove claude-mem from install.sh; add code-conductor plugin wiring"
  ```

---

### Task 3: `install.ps1` - remove claude-mem block, add silent uninstall + plugin wiring

**Files:**
- Modify: `install.ps1` (lines 127–165 removed; two new blocks added)

**Interfaces:**
- Consumes: `$GLOBAL_DIR\skills\critical-review.md`, `$GLOBAL_DIR\skills\memory-first.md`, `$GLOBAL_DIR\skills\agent-delegation.md` (written by `Save-RemoteFile` calls at lines 401–405, which run before the new plugin block)
- Produces: `%USERPROFILE%\.claude\plugins\cache\code-conductor\code-conductor\<RemoteVersion>\` on Windows (version resolved at runtime from `if ($RemoteVersion) { $RemoteVersion } else { "1.0.0" }`); `enabledPlugins["code-conductor@code-conductor"]: true` in `~/.claude/settings.json`

- [ ] [T-003-A-0] **Locate and read the claude-mem install block in `install.ps1` before editing**

  Do not rely on line numbers. Find the block by content:
  ```powershell
  Select-String -Path install.ps1 -Pattern 'Write-Info "Installing claude-mem'
  ```
  Note the returned line number as `$N`. Then read 50 lines from that point:
  ```
  Read({ file_path: "install.ps1", offset: $N - 3, limit: 50 })
  ```
  Verify the output contains `Write-Info "Installing claude-mem..."` and the winget fallback block. If the block differs from `old_string` below, update `old_string` to match before proceeding. Backtick continuation characters in PS (`` ` ``) must be preserved exactly: they are U+0060 GRAVE ACCENT, not curly quotes.

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
    Write-Warn "claude-mem cache dir still present at $cmCache - manual cleanup may be needed"
  } else {
    Write-Ok "claude-mem cache dir removed"
  }
  ```

- [ ] [T-003-A] **Remove the claude-mem install block from the `-NoDeps` section**

  In `install.ps1`, find and delete the block starting with `if ($HasNode) { Write-Info "Installing claude-mem..."` (located by T-003-A-0 grep). Replace it with the uninstall + cleanup lines below. Do not use line numbers as the anchor.

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

  New (replacement - placed OUTSIDE the `-not $NoDeps` block, unconditionally, so broken environments are healed even when `-NoDeps` is passed):
  ```powershell
    # Unconditional claude-mem removal: heals existing installs regardless of -NoDeps
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
  # Pre-validate write permissions on global plugin directory before any wipe or mkdir attempt
  $pluginRoot = "$env:USERPROFILE\.claude\plugins"
  New-Item -ItemType Directory -Force $pluginRoot -ErrorAction SilentlyContinue | Out-Null
  try {
    $permTestFile = Join-Path $pluginRoot ".perm-test-$(Get-Random)"
    [System.IO.File]::WriteAllText($permTestFile, "")
    Remove-Item $permTestFile -Force -ErrorAction SilentlyContinue
  } catch {
    Write-Warn "No write permission on $pluginRoot -- plugin install may fail; run as Administrator or grant $env:USERNAME write access to $pluginRoot"
  }

  $nodeOk = $false
  if (Get-Command node -ErrorAction SilentlyContinue) {
    $nodeMajor = [int](node -e "process.stdout.write(String(process.version.split('.')[0].replace('v','')))" 2>$null)
    if ($nodeMajor -ge 16) { $nodeOk = $true }
    else { Write-Warn "Node.js v$nodeMajor detected -- v16+ required for plugin injection; skipping settings.json update" }
  }
  ```
  Gate all subsequent `node -e` calls in this block with `if ($nodeOk) { ... }`.

  **Locked directory (active Claude Code process):** If Claude Code is running while the installer executes, the versioned plugin dir may be held open. The wipe step (`Remove-Item -Recurse -Force $pluginDir`) will throw `IOException` on locked files. Detection: catch `[System.IO.IOException]` separately from `[System.UnauthorizedAccessException]`. Mitigation: close Claude Code before running the installer, or rename the locked dir as a fallback:
  ```powershell
  try {
    if (Test-Path $pluginDir) { Remove-Item -Recurse -Force $pluginDir }
  } catch [System.IO.IOException] {
    $fallback = "$pluginDir.old-$(Get-Date -Format 'yyyyMMddHHmmss')"
    Rename-Item $pluginDir $fallback -ErrorAction SilentlyContinue
    Write-Warn "Plugin dir locked; renamed to $fallback -- delete after closing Claude Code"
  }
  ```
  The same risk applies on bash (files held by a running process); `rm -rf` will succeed on Linux/macOS (files unlinked but space not reclaimed until process closes), but will fail on Windows NTFS with "file in use" errors.

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
  The outer `if (-not $NoDeps)` block remains; the `try/catch` is the inner wrapper. A permission failure is non-fatal - the installer continues; missing the plugin is reported via `Write-Warn`, not `throw`.

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
    # Trailing newline: "`n" in PS 5.1 is LF (0x0A), not CRLF. [System.IO.File]::WriteAllText
    # with UTF8Encoding($false) writes raw bytes -- no BOM, no CRLF conversion.
    # The explicit "`n" appended to $pluginJsonContent produces exactly one LF at EOF,
    # satisfying the JSON formatting constraint (2-space indent + trailing LF, no CRLF).
    [System.IO.File]::WriteAllText(
      "$pluginDir\.claude-plugin\plugin.json",
      $pluginJsonContent + "`n",
      $pluginEnc
    )
    # Path separator note: Copy-Item on PS 5.1/Windows uses backslashes here because
    # $pluginDir and $GLOBAL_DIR were set with backslash separators. Claude Code plugin
    # resolution on Windows reads SKILL.md via its own path normalization - backslash
    # paths in the plugin dir are correct on Windows; forward slashes also work on PS 5.1.
    Copy-Item "$GLOBAL_DIR\skills\critical-review.md"   "$pluginDir\skills\critical-review\SKILL.md"
    Copy-Item "$GLOBAL_DIR\skills\memory-first.md"       "$pluginDir\skills\memory-first\SKILL.md"
    Copy-Item "$GLOBAL_DIR\skills\agent-delegation.md"   "$pluginDir\skills\agent-delegation\SKILL.md"
    # Pre-verify parent directory of settings.json exists before enabledPlugins write
    New-Item -ItemType Directory -Force "$env:USERPROFILE\.claude" -ErrorAction SilentlyContinue | Out-Null
    # enabledPlugins note: if 'code-conductor@code-conductor' is already present but set to
    # false, the assignment below overwrites it with true: correct healing behavior.
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

  **Trailing newline cross-platform verification (PS):** Verify `plugin.json` ends with a single LF byte, not CRLF:
  ```powershell
  $bytes = [System.IO.File]::ReadAllBytes("$pluginDir\.claude-plugin\plugin.json")
  $last  = $bytes[-1]
  $prev  = $bytes[-2]
  if ($last -ne 0x0A) {
    throw "plugin.json does not end with LF (0x0A); last byte is 0x$($last.ToString('X2'))"
  }
  if ($prev -eq 0x0D) {
    throw "plugin.json ends with CRLF (0x0D 0x0A); must be LF only"
  }
  Write-Ok "plugin.json trailing newline: LF confirmed"
  ```
  Expected output: `[OK] plugin.json trailing newline: LF confirmed`

  **Version conflict check** -- detect stale versioned dirs from prior installs:
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

  Verify with `Read({ file_path: "VERSION" })` - must contain only `1.14.0`.

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
  - `[BUG-020]` code-conductor Claude Code plugin (`~/.claude/plugins/cache/code-conductor/code-conductor/<version>/`) - owns `critical-review`, `memory-first`, and `agent-delegation` skills; installed and enabled by both installers
  - `[BUG-020]` `"code-conductor@code-conductor": true` injected into `~/.claude/settings.json` `enabledPlugins` by both installers; `Skill({ skill: "critical-review" })` now resolves without superpowers dependency

  ### Changed
  - `[BUG-020]` 6 prose references to `claude-mem` replaced with `.claude/memory/project.md` in `global/CLAUDE.md`, `skills/memory-first.md`, `skills/agent-delegation.md`, `README.md`, `.claude/hooks/pre-tool-use.sh`, `project-template/.claude/hooks/pre-tool-use.sh`


  ## [1.13.0]
  ```

  Verify: `Read({ file_path: "CHANGELOG.md", offset: 1, limit: 20 })` - must show `[1.14.0]` before `[1.13.0]`.

- [ ] [T-004-D] **Run tests**

  ```bash
  npm test
  ```
  Expected: 142 passed, 3 skipped.

- [ ] [T-004-E] **Commit**

  ```bash
  git add VERSION package.json CHANGELOG.md
  git commit -m "chore(release): bump to v1.14.0 - remove claude-mem, add code-conductor plugin"
  ```

---

### Task 5: Automated plugin test file

**Files:**
- Create: `tests/plugin/code-conductor-plugin.test.js`

**Interfaces:**
- Consumes: `~/.claude/plugins/cache/code-conductor/code-conductor/<version>/` - present only when the installer has run (not in CI where install hasn't executed)
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

  **Post-install plugin list query (CLI structural integrity check):** Before starting the live session, run this offline automatable verification using the same JSON engine as the installer:
  ```bash
  _cc_ver="${REMOTE_VERSION:-1.0.0}"
  node -e "
const base=require('os').homedir()+'/.claude/plugins/cache/code-conductor/code-conductor/${_cc_ver}';
const pj=JSON.parse(require('fs').readFileSync(base+'/.claude-plugin/plugin.json','utf8'));
['name','version','description','author'].forEach(k=>{if(!pj[k])throw new Error('missing field: '+k);});
['critical-review','memory-first','agent-delegation'].forEach(s=>{
  const p=base+'/skills/'+s+'/SKILL.md';
  if(!require('fs').existsSync(p)||require('fs').statSync(p).size===0)throw new Error('bad SKILL.md: '+s);
});
console.log('Post-install check OK: '+pj.name+' v'+pj.version+', 3 skills readable');
"
  ```
  Expected: `Post-install check OK: code-conductor v<version>, 3 skills readable`
  This check does not require a live Claude Code session and confirms plugin dir + skill files are structurally valid before the first session launch. Run it immediately after `bash install.sh` completes on the local machine.

  **Note**: The live session check below cannot be automated in `npm test`. Record result manually. If `Unknown skill` is returned, check:
  1. `~/.claude/settings.json` contains `"code-conductor@code-conductor": true`
  2. `~/.claude/plugins/cache/code-conductor/code-conductor/<version>/.claude-plugin/plugin.json` exists with all 4 fields
  3. Claude Code was restarted after the installer ran (plugin registry is read at session start)

---

## Test List

- [ ] `npm test` passes after each commit (T-002-D, T-003-D, T-004-D) - 142 passed, 3 skipped
- [ ] No test file asserts on "claude-mem" text (pre-confirmed by grep - no updates needed)
- [ ] Manual smoke: run `bash install.sh --no-deps` on a clean machine - no claude-mem step runs, no plugin created (NoDeps guard)
- [ ] Manual smoke: run `bash install.sh` - `~/.claude/plugins/cache/code-conductor/code-conductor/<REMOTE_VERSION>/.claude-plugin/plugin.json` exists with correct 4-field schema

## Commit Order

1. T-001-G - prose edits (6 files, 1 commit)
2. T-002-E - install.sh (1 commit)
3. T-003-E - install.ps1 (1 commit)
4. T-004-E - version bump (1 commit)
5. T-005-C - plugin test file (1 commit)

Total: 5 commits.

## Identified Risks

1. **plugin.json heredoc trailing newline**: bash `cat > file <<'EOF'` appends a final newline from the heredoc - the file will end with `}\n`. This matches the spec requirement. `xxd` may be absent in minimal environments (Alpine, BusyBox, distroless containers). Use this tool fallback chain in T-002-C: (1) `xxd ... | awk 'END{print $NF}'` - primary; (2) `od -An -tx1 ... | awk 'END{print $NF}'` - POSIX fallback present on Alpine/BSDs; (3) `node -e "const b=readFileSync(...); if(b[b.length-1]!==0x0a)throw..."` - always available since Node.js is a hard prerequisite. If all three tools are absent the check is skipped; the PS T-003-C byte-level `ReadAllBytes` check is the authoritative verification in that case.
2. **PS `node -e` here-string quoting**: The single-quoted `@'...'@` here-string in PS 5.1 does not expand `$` - JS `$` signs inside the script are safe. Verify after install that `settings.json` contains `"code-conductor@code-conductor": true` and lacks `"claude-mem@thedotmack"`.
3. **settings.json race**: both the key-removal and key-addition `node -e` calls read and write `settings.json` in sequence. On a fresh machine where `settings.json` was just created by `_merge_settings_json`, the file exists before the key-addition call. No race on single-threaded install.
4. **SKIP_DEPS guard split**: the uninstall+cleanup is in the existing `SKIP_DEPS` block; the plugin creation is in a second `if [ "$SKIP_DEPS" = false ]` block after global file downloads. Both are skipped when `--no-deps` is passed. Verify by running `bash install.sh --no-deps` and confirming no `code-conductor` dir is created.
5. **Global skills not yet downloaded at SKIP_DEPS time**: The `cp` calls in the plugin block (T-002-B section 2) reference `${GLOBAL_DIR}/skills/*.md`, which are written by the `download` calls above in the installer flow - the plugin block is placed AFTER those downloads, so the files exist. Confirm by checking the installer comment `# ── code-conductor plugin: wipe versioned dir and recreate` appears after `download "skills/agent-delegation.md"`.
