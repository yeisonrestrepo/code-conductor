# code-conductor installer -- Windows (PowerShell)
# Usage: irm https://raw.githubusercontent.com/yeisonrestrepo/code-conductor/main/install.ps1 | iex
#        & ([ScriptBlock]::Create((irm https://raw.githubusercontent.com/yeisonrestrepo/code-conductor/main/install.ps1))) -Project
#        & ([ScriptBlock]::Create((irm https://raw.githubusercontent.com/yeisonrestrepo/code-conductor/main/install.ps1))) -NoDeps
#        & ([ScriptBlock]::Create((irm https://raw.githubusercontent.com/yeisonrestrepo/code-conductor/main/install.ps1))) -Verbosity INFO
#        powershell.exe -ExecutionPolicy Bypass -File .\install.ps1
# Restricted/AllSigned policy: powershell.exe -ExecutionPolicy Bypass -File .\install.ps1
# Minimum: Windows PowerShell 5.1. Check: $PSVersionTable.PSVersion (Major>=5, Minor>=1)
# Exit codes: 0=success  4=post-install verification failure (hook registered but exec failed)

param(
  [switch]$Project,
  [switch]$NoDeps,
  [switch]$CleanupLogs,
  [ValidateSet("MIN","INFO","VERBOSE")]
  [string]$Verbosity = "MIN"
)

$REPO       = "yeisonrestrepo/code-conductor"
$BRANCH     = "main"
$BASE_URL   = "https://raw.githubusercontent.com/$REPO/$BRANCH"
$GLOBAL_DIR = "$env:USERPROFILE\.claude"
$FailedDeps = @()

function Write-Ok   { param($msg) Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn { param($msg) Write-Host "  [!!] $msg" -ForegroundColor Yellow }
function Write-Err  { param($msg) Write-Host "  [XX] $msg" -ForegroundColor Red }
function Write-Info { param($msg) Write-Host "   ->  $msg" -ForegroundColor Cyan }

Write-Host ""
Write-Host "  code-conductor installer" -ForegroundColor Cyan
Write-Host "  -------------------------"
Write-Host ""

$LocalVersionFile = "$GLOBAL_DIR\memory\conductor-version.md"
$LocalVersion     = if (Test-Path $LocalVersionFile) { (Get-Content $LocalVersionFile -Raw).Trim() } else { $null }
try   { $RemoteVersion = (Invoke-WebRequest -Uri "$BASE_URL/VERSION" -UseBasicParsing -TimeoutSec 5).Content.Trim() }
catch { $RemoteVersion = $null }

if ($RemoteVersion) { Write-Info "v$RemoteVersion" }
if ($LocalVersion -and $RemoteVersion -and $LocalVersion -ne $RemoteVersion) {
  Write-Warn "Updating $LocalVersion -> $RemoteVersion"
}
if ($RemoteVersion -or $LocalVersion) { Write-Host "" }

# -- Runtime detection ----------------------------------------------------------
$HasNode   = $false
$HasPython = $false

$nodePath = Get-Command node -ErrorAction SilentlyContinue
if ($nodePath) {
  $nodeVersion = (node --version).TrimStart('v')
  $major = [int]($nodeVersion.Split('.')[0])
  if ($major -ge 18) {
    $HasNode = $true
    Write-Ok "Node.js $nodeVersion detected"
  } else {
    Write-Warn "Node.js $nodeVersion found but version 18+ is required"
  }
}

if (Get-Command python3 -ErrorAction SilentlyContinue) {
  $HasPython = $true
  Write-Ok "Python 3 detected"
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
  $v = (python --version 2>&1)
  if ($v -match '^Python 3') {
    $HasPython = $true
    Write-Ok "Python 3 detected"
  }
}

$HasPython310 = $false
if ($HasPython) {
  $pyCmd = "python"
  if (Get-Command python3 -ErrorAction SilentlyContinue) { $pyCmd = "python3" }
  $pyVer = & $pyCmd -c "import sys; print(str(sys.version_info.major) + '.' + str(sys.version_info.minor))" 2>$null
  if ($pyVer) {
    $parts = $pyVer.Split('.')
    if ([int]$parts[0] -ge 3 -and [int]$parts[1] -ge 10) {
      $HasPython310 = $true
      Write-Ok "Python $pyVer (>=3.10) -- Graphify eligible"
    } else {
      Write-Warn "Python $pyVer found but Graphify requires 3.10+"
    }
  }
}

# -- Auto-install Node if missing ------------------------------------------------
if (-not $HasNode) {
  Write-Info "Node.js 18+ not found. Attempting to install via winget..."
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    if (Get-Command node -ErrorAction SilentlyContinue) { $HasNode = $true }
  } else {
    Write-Warn "winget not found. Install Node.js 18+ manually: https://nodejs.org"
  }
}

if (-not $HasNode -and -not $HasPython) {
  Write-Err "Neither Node.js 18+ nor Python 3 could be installed."
  Write-Host ""
  Write-Host "  Please install at least one:"
  Write-Host "  - Node.js 18+: https://nodejs.org"
  Write-Host "  - Python 3:    https://python.org"
  exit 1
}

# -- Dependency installation ----------------------------------------------------
function Install-Dep {
  param([string]$Name, [string]$Cmd)
  Write-Info "Installing $Name..."
  Invoke-Expression $Cmd
  if ($LASTEXITCODE -eq 0) {
    Write-Ok "$Name installed"
  } else {
    Write-Warn "$Name failed -- manual install: $Cmd"
    $script:FailedDeps += "${Name}: ${Cmd}"
  }
}

# Unconditional claude-mem removal: heals existing installs regardless of -NoDeps
Write-Info "Removing claude-mem (no-op if never installed)..."
if (Get-Command npx -ErrorAction SilentlyContinue) {
  # Three-flag mandate: CI=1 suppresses npm/npx prompts; first --yes = npx auto-accept; second --yes = claude-mem confirmation.
  # cmd /c required: PS 5.1 npx.cmd may hang without the Windows command interpreter; 2>nul suppresses cmd-level stderr.
  try { $null = cmd /c "set CI=1 && npx --yes claude-mem uninstall --yes 2>nul" } catch {}
} else {
  Write-Warn "npx not found on PATH -- claude-mem uninstall skipped (install Node.js/npm to heal existing claude-mem installs)"
}
# Pre-verify parent directory of settings.json exists before any write
New-Item -ItemType Directory -Force "$env:USERPROFILE\.claude" -ErrorAction SilentlyContinue | Out-Null
# Clear read-only attribute if set -- prevents UnauthorizedAccessException on locked-down installs
$settingsPath = "$env:USERPROFILE\.claude\settings.json"
if (Test-Path $settingsPath) { $fi = Get-Item $settingsPath; if ($fi.IsReadOnly) { $fi.IsReadOnly = $false } }
# Backup settings.json before any mutation (T-003-A-1); single backup covers key-removal + plugin enabledPlugins write
$settingsBak = "$env:USERPROFILE\.claude\settings.json.bak"
if (Test-Path $settingsPath) {
  Copy-Item $settingsPath $settingsBak -Force
  if (-not (Test-Path $settingsBak) -or (Get-Item $settingsBak).Length -eq 0) {
    Write-Warn "settings.json backup failed or produced empty file -- proceeding without backup"
  }
}
# Remove claude-mem@thedotmack from enabledPlugins (no-op on fresh installs)
# Fresh-install guard: line 1 of the script is 'if(!existsSync(f))process.exit(0)' -- silently exits when settings.json absent.
# IMPORTANT: the closing '@' that ends $cmNodeScript MUST be at column 0 (no leading spaces/tabs).
$cmNodeScript = @'
const f=require('os').homedir()+'/.claude/settings.json';
if(!require('fs').existsSync(f))process.exit(0);
const _raw=require('fs').readFileSync(f,'utf8');
let obj={};try{obj=JSON.parse(_raw);}catch(e){if(_raw.trim()){process.stderr.write('WARN: settings.json is malformed JSON and non-empty -- skipping key removal to avoid data loss\n');process.exit(0);}}
if(obj.enabledPlugins){delete obj.enabledPlugins['claude-mem@thedotmack'];}
try{require('fs').mkdirSync(require('os').homedir()+'/.claude',{recursive:true});require('fs').writeFileSync(f,JSON.stringify(obj,null,2)+'\n');}catch(e){process.stderr.write('WARN: settings.json update failed: '+e.message+'\n');}
'@
if (Get-Command node -ErrorAction SilentlyContinue) {
  node -e $cmNodeScript 2>$null
} else {
  Write-Warn "node not found on PATH -- settings.json key-removal skipped (claude-mem@thedotmack key may remain until Node.js is installed)"
}
# Glob-delete orphaned superpowers-cached critical-review skill (PS 5.1 pipeline required; mid-path wildcards need Get-ChildItem)
$superDir = "$env:USERPROFILE\.claude\plugins\cache\claude-plugins-official\superpowers"
if (Test-Path $superDir) {
  Get-ChildItem $superDir -Directory -Force -ErrorAction SilentlyContinue |
    ForEach-Object {
      $t = Join-Path $_.FullName "skills\critical-review"
      if (Test-Path $t) {
        try { Remove-Item -Recurse -Force $t -ErrorAction Stop }
        catch [System.IO.IOException] {
          Start-Sleep -Seconds 2
          try { Remove-Item -Recurse -Force $t -ErrorAction Stop }
          catch { Write-Warn "Could not remove locked skill dir $t -- close Claude Code and re-run" }
        }
      }
    }
}
# Verify claude-mem cache directory removed (T-003-A-2)
$cmCache = "$env:USERPROFILE\.claude\plugins\cache\thedotmack\claude-mem"
if (Test-Path $cmCache) {
  Write-Warn "claude-mem cache dir still present at $cmCache - manual cleanup may be needed"
} else {
  Write-Ok "claude-mem cache dir removed"
}

if (-not $NoDeps) {
  Write-Host ""
  Write-Info "Installing dependencies..."
  Write-Host ""

  if ($HasNode) { Install-Dep "uipro-cli" "npm install -g uipro-cli" }

  if (Get-Command claude -ErrorAction SilentlyContinue) {
    Install-Dep "Playwright MCP" "claude mcp add playwright npx @playwright/mcp@latest"
    Install-Dep "Superpowers"    "claude plugin install superpowers@claude-plugins-official"
    Install-Dep "code-simplifier" "claude plugin install code-simplifier@claude-plugins-official"
  } else {
    Write-Warn "claude CLI not found -- Playwright MCP, Superpowers, and code-simplifier need the Claude Code CLI"
    $FailedDeps += "Playwright MCP: claude mcp add playwright npx @playwright/mcp@latest"
    $FailedDeps += "Superpowers: claude plugin install superpowers@claude-plugins-official"
    $FailedDeps += "code-simplifier: claude plugin install code-simplifier@claude-plugins-official"
  }

  if ($HasPython310) {
    if (Get-Command pipx -ErrorAction SilentlyContinue) {
      Install-Dep "Graphify" "pipx install graphifyy; if (`$LASTEXITCODE -eq 0) { python -m graphify install }"
    } else {
      Install-Dep "Graphify" "pip install graphifyy; if (`$LASTEXITCODE -eq 0) { python -m graphify install }"
    }
  } else {
    Write-Warn "Graphify requires Python 3.10+ -- skipped"
    $FailedDeps += "Graphify: pipx install graphifyy; graphify install"
  }
}

# -- Log maintenance helper (T-007-E) ------------------------------------------
# Usage: .\install.ps1 -CleanupLogs
function Invoke-LogCleanup {
    $logsDir = Join-Path $env:USERPROFILE ".claude\logs"
    $log     = Join-Path $logsDir "verbosity-hook.log"
    Write-Host "[verbosity-remind] INFO: starting log cleanup in $logsDir"
    # 1. Expired fence-warned markers
    Get-ChildItem $logsDir -Filter '.verbosity-fence-warned' -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTime -lt (Get-Date).AddMinutes(-60) } |
        ForEach-Object { Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue }
    # 2. Stale temp files from failed installs
    Get-ChildItem (Join-Path $env:USERPROFILE ".claude") -Recurse -Depth 2 -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '^settings\.json\.(tmp|installer-backup|pre-merge|clean|force)\.' -and
                       $_.LastWriteTime -lt (Get-Date).AddMinutes(-10) } |
        ForEach-Object { Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue }
    # 3. Log rotation (>1 MB)
    if (Test-Path $log) {
        $sz = (Get-Item $log).Length
        if ($sz -gt 1MB) {
            $ts = Get-Date -Format 'yyyyMMddHHmmss'
            Move-Item $log ($log + ".$ts.rotated") -Force -ErrorAction SilentlyContinue
            Write-Host "  PASS: log rotated ($sz bytes)"
        } else { Write-Host "  INFO: log size $sz bytes -- no rotation needed." }
    }
    # 4. Backup files older than 30 days
    Get-ChildItem (Join-Path $env:USERPROFILE ".claude") -Recurse -Depth 2 -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match 'installer-backup\.|pre-merge\.' -and
                       $_.LastWriteTime -lt (Get-Date).AddDays(-30) } |
        ForEach-Object { Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue }
    Write-Host "[verbosity-remind] INFO: log cleanup complete."
}

if ($CleanupLogs) { Invoke-LogCleanup; exit 0 }

# -- Download helper ------------------------------------------------------------
function Save-RemoteFile {
  param([string]$Src, [string]$Dest, [bool]$Overwrite = $true)

  if (-not $Overwrite -and (Test-Path $Dest)) {
    Write-Info "Skipped (already exists): $Dest"
    return
  }

  $dir = Split-Path $Dest -Parent
  if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }

  try {
    Invoke-WebRequest -Uri "$BASE_URL/$Src" -OutFile $Dest -UseBasicParsing
    Write-Ok "Downloaded: $Dest"
  } catch {
    Write-Warn "Failed to download: $Src"
  }
}

# -- settings.json merge helper -------------------------------------------------
# Requires PS 5.1+ (ships with Windows 10). ALL writes use the .NET
# WriteAllText API with UTF-8-no-BOM encoding — never Set-Content or Out-File,
# which write UTF-16 LE with BOM on PS 5.1 and break Claude Code's JSON parser.
function Merge-SettingsJson {
    param([string]$SettingsPath, [string]$HookCmd)

    # Pre-execution timestamped backup
    if (Test-Path $SettingsPath) {
        $bkTs = Get-Date -Format "yyyyMMddHHmmss"
        $bkDst = $SettingsPath + ".pre-merge." + $bkTs
        try {
            Copy-Item $SettingsPath $bkDst -ErrorAction Stop
            Write-Host "  [verbosity-remind] backed up -> $bkDst"
        } catch {
            Write-Warning "[verbosity-remind] WARN: Could not write pre-merge backup."
        }
    }

    # Read-only guard
    if (Test-Path $SettingsPath) {
        $fi = Get-Item $SettingsPath
        if ($fi.IsReadOnly) {
            try { $fi.IsReadOnly = $false } catch {
                Write-Error "[verbosity-remind] ERROR: $SettingsPath is read-only and cannot be cleared."
                return
            }
        }
    }

    # Idempotency pre-check: skip merge if the hook command is already present
    if (Test-Path $SettingsPath) {
        try {
            $check = Get-Content $SettingsPath -Raw -Encoding utf8 | ConvertFrom-Json
            $existing_arr = @()
            if ($check.hooks -and $check.hooks.PSObject.Properties['UserPromptSubmit']) {
                $existing_arr = @($check.hooks.UserPromptSubmit)
            }
            $already = $existing_arr | Where-Object {
                $hks = $_.hooks
                if ($hks -is [array]) { $hks | Where-Object { $_.command -eq $HookCmd } }
                else { $_.command -eq $HookCmd }
            }
            if ($already) {
                Write-Host "  [verbosity-remind] settings.json already contains hook -- skipping (idempotent)"
                return
            }
        } catch { }
    }

    # Parse existing file or start from empty object
    $doc = $null
    if (Test-Path $SettingsPath) {
        try {
            $doc = Get-Content $SettingsPath -Raw -Encoding utf8 | ConvertFrom-Json
        } catch {
            Write-Warning "[verbosity-remind] WARN: settings.json malformed -- backing up and starting fresh."
            $ts = Get-Date -Format "yyyyMMddHHmmss"
            $rnd = [System.Guid]::NewGuid().ToString('N').Substring(0, 8)
            Copy-Item $SettingsPath ($SettingsPath + ".bak." + $ts + "." + $rnd) -ErrorAction SilentlyContinue
        }
    }
    if ($null -eq $doc) { $doc = [PSCustomObject]@{} }

    # Ensure hooks object exists
    if ($null -eq $doc.hooks -or $doc.hooks -isnot [PSCustomObject]) {
        $doc | Add-Member -Force -NotePropertyName hooks -NotePropertyValue ([PSCustomObject]@{})
    }

    # Ensure UserPromptSubmit array exists and strip any stale verbosity-remind entries
    $arr = @()
    if ($doc.hooks.PSObject.Properties['UserPromptSubmit'] -and
            $doc.hooks.UserPromptSubmit -is [array]) {
        $arr = @($doc.hooks.UserPromptSubmit | Where-Object {
            $hks = $_.hooks
            if ($hks -is [array]) {
                -not ($hks | Where-Object { $_.command -like "*verbosity-remind.sh*" })
            } else {
                $_.command -notlike "*verbosity-remind.sh*"
            }
        })
    }

    # Append the new entry in nested format
    $entry = [PSCustomObject]@{
        matcher = ""
        hooks   = @([PSCustomObject]@{ type = "command"; command = $HookCmd })
    }
    $arr += $entry
    $doc.hooks | Add-Member -Force -NotePropertyName UserPromptSubmit -NotePropertyValue $arr

    # Atomic write: temp file + rename (NTFS rename is atomic)
    $json = $doc | ConvertTo-Json -Depth 10
    $rnd = [System.Guid]::NewGuid().ToString('N').Substring(0, 8)
    $tmp = $SettingsPath + ".tmp." + $rnd
    try {
        $enc = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText($tmp, $json, $enc)
        Move-Item -Path $tmp -Destination $SettingsPath -Force
        Write-Host "  [verbosity-remind] OK: settings.json updated (UTF-8 no BOM)"
    } catch {
        Remove-Item $tmp -Force -ErrorAction SilentlyContinue
        Write-Error "[verbosity-remind] ERROR: Atomic write to $SettingsPath failed: $_"
    }
}

# ── Early-stage mandatory backup (T-005-J) ─────────────────────────────────────
function Backup-EarlySettings {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return }
    $ts = Get-Date -Format 'yyyyMMddHHmmss'
    $bak = $Path + ".installer-backup." + $ts
    try {
        Copy-Item -Path $Path -Destination $bak -Force
        Write-Host "  [verbosity-remind] early backup: $Path -> $bak"
    } catch {
        Write-Warning "[verbosity-remind] WARN: could not write early backup of $Path."
        Write-Warning "  Proceeding without early backup -- per-merge backup inside Merge-SettingsJson is still active."
    }
}
Backup-EarlySettings "$env:USERPROFILE\.claude\settings.json"
if ($Project) { Backup-EarlySettings ".claude\settings.json" }

# -- Install global files -------------------------------------------------------
Write-Host ""
Write-Info "Installing global Claude files to $GLOBAL_DIR..."
Write-Host ""

foreach ($sub in "commands", "hooks", "memory", "skills", "stack-profiles") {
  New-Item -ItemType Directory -Path "$GLOBAL_DIR\$sub" -Force | Out-Null
}

# User-configured -- skip if exist
Save-RemoteFile "global/CLAUDE.md"         "$GLOBAL_DIR\CLAUDE.md"         $false
Save-RemoteFile "global/settings.json"      "$GLOBAL_DIR\settings.json"      $false
Save-RemoteFile "global/memory/personal.md" "$GLOBAL_DIR\memory\personal.md" $false
Save-RemoteFile "global/hooks/graphify-ast-refresh.py" "$GLOBAL_DIR\hooks\graphify-ast-refresh.py" $false
Save-RemoteFile "global/hooks/verbosity-remind.sh" "$GLOBAL_DIR\hooks\verbosity-remind.sh"

# Agent-managed -- always overwrite
Save-RemoteFile "global/commands/cc-checkpoint.md" "$GLOBAL_DIR\commands\cc-checkpoint.md"
Save-RemoteFile "global/commands/cc-stack.md"      "$GLOBAL_DIR\commands\cc-stack.md"
Save-RemoteFile "global/commands/cc-lang.md"       "$GLOBAL_DIR\commands\cc-lang.md"
Save-RemoteFile "global/commands/cc-compact.md"    "$GLOBAL_DIR\commands\cc-compact.md"
Save-RemoteFile "skills/code-simplifier.md"    "$GLOBAL_DIR\skills\code-simplifier.md"
Save-RemoteFile "skills/critical-review.md"    "$GLOBAL_DIR\skills\critical-review.md"
Save-RemoteFile "skills/verbosity.md"          "$GLOBAL_DIR\skills\verbosity.md"
Save-RemoteFile "skills/memory-first.md"       "$GLOBAL_DIR\skills\memory-first.md"
Save-RemoteFile "skills/agent-delegation.md"   "$GLOBAL_DIR\skills\agent-delegation.md"


foreach ($stackProfile in @("_base","_multi-stack","_template","javascript","typescript","python","java","go","rust","react","angular","nextjs","nestjs","django","flask")) {
  Save-RemoteFile "stack-profiles/$stackProfile.md" "$GLOBAL_DIR\stack-profiles\$stackProfile.md"
}

"VERBOSITY: $Verbosity" | Set-Content "$GLOBAL_DIR\memory\verbosity.md" -Encoding utf8
Write-Ok "Verbosity set to $Verbosity"

# Global settings.json merge (T-005-C)
$globalHookCmd = "bash $env:USERPROFILE/.claude/hooks/verbosity-remind.sh"
Merge-SettingsJson "$GLOBAL_DIR\settings.json" $globalHookCmd

# -- code-conductor skills: install as personal skills (~/.claude/skills/<name>/SKILL.md)
# Claude Code auto-loads directory-format personal skills. The previous approach --
# writing to ~/.claude/plugins/cache/ and setting enabledPlugins -- never worked:
# plugins are loaded from installed_plugins.json, which the installer cannot safely
# write, so Claude Code ignored (and orphan-swept) the hand-crafted cache dir.
if (-not $NoDeps) {
  # USERPROFILE abort guard: must be an absolute path before any skill dir operations
  if ([string]::IsNullOrWhiteSpace($env:USERPROFILE) -or -not [System.IO.Path]::IsPathRooted($env:USERPROFILE)) {
    Write-Warn "USERPROFILE is empty or not an absolute path ('$env:USERPROFILE') -- aborting skills install to prevent invalid paths"
  } else {
    try {
      # Absolute path resolution guard: verify $GLOBAL_DIR is absolute before Copy-Item
      if (-not [System.IO.Path]::IsPathRooted($GLOBAL_DIR)) {
        $GLOBAL_DIR = "$env:USERPROFILE\.claude"
      }
      if (-not (Test-Path "$GLOBAL_DIR\skills")) {
        Write-Warn "GLOBAL_DIR\skills not found at $GLOBAL_DIR\skills -- Copy-Item step may fail; verify download steps ran first"
      }
      @('critical-review','memory-first','agent-delegation') | ForEach-Object {
        $skillSrc = "$GLOBAL_DIR\skills\$_.md"
        if (-not (Test-Path $skillSrc)) { throw "ERROR: source skill file missing: $skillSrc" }
        if ((Get-Item $skillSrc).Length -eq 0) { throw "ERROR: source skill file is empty: $skillSrc" }
        if (-not (Select-String -Path $skillSrc -Pattern '^#' -Quiet)) {
          Write-Warn "skill file $_.md has no markdown heading -- skill may not load correctly in Claude Code"
        }
        New-Item -ItemType Directory -Force "$GLOBAL_DIR\skills\$_" | Out-Null
        Copy-Item $skillSrc "$GLOBAL_DIR\skills\$_\SKILL.md"
      }
      # Heal artifacts of the old broken plugin install: orphaned cache dir + dead enabledPlugins key
      $oldPluginCache = "$env:USERPROFILE\.claude\plugins\cache\code-conductor"
      if (Test-Path $oldPluginCache) {
        Remove-Item -Recurse -Force $oldPluginCache -ErrorAction SilentlyContinue
      }
      if (Get-Command node -ErrorAction SilentlyContinue) {
        $cleanupScript = @'
const f=require('os').homedir()+'/.claude/settings.json';
if(!require('fs').existsSync(f))process.exit(0);
const _raw=require('fs').readFileSync(f,'utf8');
let obj={};try{obj=JSON.parse(_raw);}catch(e){process.exit(0);}
if(obj.enabledPlugins){delete obj.enabledPlugins['code-conductor@code-conductor'];}
try{require('fs').writeFileSync(f,JSON.stringify(obj,null,2)+'\n');}catch(e){process.stderr.write('WARN: settings.json update failed: '+e.message+'\n');}
'@
        node -e $cleanupScript 2>$null
      }
      Write-Ok "code-conductor skills installed as personal skills (critical-review, memory-first, agent-delegation)"
    } catch [System.UnauthorizedAccessException] {
      Write-Warn "code-conductor skills install failed: access denied at $GLOBAL_DIR\skills"
      Write-Warn "Fix: run installer as Administrator, or grant write access to $GLOBAL_DIR\skills"
    } catch {
      Write-Warn "code-conductor skills install failed: $_"
    }
  }
}

# -- CLAUDE.md smart fill -------------------------------------------------------
# Set-ClaudeMdFields <MdPath> <JsonStr>
# Replaces blank and <command> placeholder lines in CLAUDE.md.
function Set-ClaudeMdFields {
  param([string]$MdPath, [string]$JsonStr)
  if ($ExecutionContext.SessionState.LanguageMode -eq 'ConstrainedLanguage') {
    Write-Warning "detect-stack: ConstrainedLanguage mode — skipping auto-fill"
    return
  }
  if (-not (Test-Path -LiteralPath $MdPath)) { return }
  $null = Remove-Item "${MdPath}.tmp.*" -Force -ErrorAction SilentlyContinue
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { return }

  $jsonTmp = [System.IO.Path]::GetTempFileName()
  Remove-Item -LiteralPath $jsonTmp -Force -ErrorAction SilentlyContinue
  $jsonTmp = $jsonTmp + ".json"
  try {
    [System.IO.File]::WriteAllText($jsonTmp, $JsonStr, [System.Text.UTF8Encoding]::new($false))

    $script = @'
const fs = require('fs');
const mdPath   = process.argv[1];
const jsonPath = process.argv[2];
let d;
try { d = JSON.parse(fs.readFileSync(jsonPath, 'utf8')); } catch { process.exit(0); }
const FIELDS = {name:'Name',description:'Description',stack:'Stack',build:'Build',test:'Test',lint:'Lint',format:'Format',setup:'Setup'};
let content;
try { content = fs.readFileSync(mdPath, 'utf8').replace(/^﻿/, ''); } catch { process.exit(0); }
for (const [key, label] of Object.entries(FIELDS)) {
  const val = d[key];
  if (typeof val !== 'string' || !val.trim()) continue;
  const clean = val.trim().replace(/\r?\n/g, ' ').replace(/\\[ntr]/g, ' ');
  const re = new RegExp('^(\\s*-?\\s*' + label + ':)\\s*(<[^>]*>)?\\s*(\\r?)$', 'im');
  if (!re.test(content)) continue;
  content = content.replace(re, '$1 ' + clean.replace(/\$/g, '$$$$') + '$3');
}
const tmp = mdPath + '.tmp.' + process.pid;
fs.writeFileSync(tmp, content, 'utf8');
try { fs.renameSync(tmp, mdPath); } catch { fs.writeFileSync(mdPath, content, 'utf8'); try { fs.unlinkSync(tmp); } catch {} }
'@
    node -e $script $MdPath $jsonTmp 2>$null
  } finally {
    Remove-Item -LiteralPath $jsonTmp -Force -ErrorAction SilentlyContinue
  }
}

# -- Install project template ---------------------------------------------------
if ($Project) {
  Write-Host ""
  Write-Info "Installing project template into current directory..."
  Write-Host ""

  $projDir = ".claude"
  foreach ($sub in "commands", "hooks", "memory") {
    New-Item -ItemType Directory -Path "$projDir\$sub" -Force | Out-Null
  }

  if (-not (Test-Path "CLAUDE.md")) {
    Write-Host -ForegroundColor Red "Error: install.ps1 must be run from the repository root (CLAUDE.md not found)."
    exit 1
  }

  # Parent-directory warning: Guard 4 blocks absolute Read paths if repo is cloned inside
  # a directory named graphify-out or node_modules. Non-fatal -- install proceeds.
  $pwdParts = ($pwd.Path -split '[/\\]') | Where-Object { $_ -ne '' }
  foreach ($part in $pwdParts) {
    if ($part -eq 'graphify-out' -or $part -eq 'node_modules') {
      Write-Host "Warning: repository is cloned inside a directory named '$part'. Guard 4 may produce false positives on absolute Read paths. See README for details." -ForegroundColor Yellow
      break
    }
  }
  Remove-Variable -Name pwdParts, part -ErrorAction SilentlyContinue

  Save-RemoteFile "project-template/CLAUDE.md"                 "CLAUDE.md"                      $false

  # -- detect-stack: auto-fill CLAUDE.md fields ----------------------------------
  $_prevConsoleEnc = [Console]::OutputEncoding
  $_prevOutEnc     = $OutputEncoding
  try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $OutputEncoding = [System.Text.Encoding]::UTF8
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

    $dsSkip = $false
    $nmRaw = node --version 2>$null
    if ($nmRaw -match '^v(\d+)') { $nm = [int]$Matches[1] } else { $nm = 0 }
    if (-not (Get-Command node -ErrorAction SilentlyContinue) -or $nm -lt 18) {
      Write-Warn "detect-stack: Node >= 18 required -- skipping auto-fill"
      $dsSkip = $true
    }

    if (-not $dsSkip) {
      $_dsTmpBase = [System.IO.Path]::GetTempFileName()
      Remove-Item -LiteralPath $_dsTmpBase -Force -ErrorAction SilentlyContinue
      $dsTmp = $_dsTmpBase + '.mjs'
      $dsOk  = $false
      try {
        Invoke-WebRequest -Uri "$BaseUrl/scripts/detect-stack.mjs" -OutFile $dsTmp -TimeoutSec 10 -ErrorAction Stop
        if ((Get-Item -LiteralPath $dsTmp -ErrorAction SilentlyContinue).Length -gt 0) { $dsOk = $true }
      } catch {
        Write-Warn "detect-stack: could not download script -- skipping auto-fill"
      }

      if ($dsOk) {
        $dsRaw = node $dsTmp "$($pwd.Path)" 2>$null | Out-String
        $dsJson = try { $dsRaw | ConvertFrom-Json } catch { $null }
        if ($dsJson -and ($dsRaw.Trim() -ne '{}')) {
          Set-ClaudeMdFields "CLAUDE.md" $dsRaw.Trim()
          Write-Ok "CLAUDE.md fields auto-filled from manifest detection"
          $null = New-Item -ItemType Directory -Path "scripts" -Force -ErrorAction SilentlyContinue
          Copy-Item -LiteralPath $dsTmp -Destination "scripts\detect-stack.mjs" -Force -ErrorAction SilentlyContinue
        } else {
          Write-Info "No stack detected -- CLAUDE.md placeholders kept for /cc-init to fill"
        }
      }
      Remove-Item -LiteralPath $dsTmp -Force -ErrorAction SilentlyContinue
    }
  } finally {
    [Console]::OutputEncoding = $_prevConsoleEnc
    $OutputEncoding = $_prevOutEnc
  }

  Save-RemoteFile "project-template/.claude/settings.json"     "$projDir\settings.json"          $false
  Save-RemoteFile "project-template/.claude/memory/project.md" "$projDir\memory\project.md"      $false

  foreach ($cmd in @("cc-init","cc-resume","cc-spec","cc-plan","cc-implement","cc-review","cc-debug","cc-refactor","cc-test","cc-docs")) {
    Save-RemoteFile "project-template/.claude/commands/$cmd.md" "$projDir\commands\$cmd.md"
  }

  Save-RemoteFile "project-template/.claude/hooks/pre-tool-use.sh"  "$projDir\hooks\pre-tool-use.sh"  $false
  Save-RemoteFile "project-template/.claude/hooks/post-compact.sh"    "$projDir\hooks\post-compact.sh"
  Save-RemoteFile "project-template/.claude/hooks/context-guard.sh"   "$projDir\hooks\context-guard.sh"
  Save-RemoteFile "project-template/.claude/hooks/context-guard.ps1"  "$projDir\hooks\context-guard.ps1"
  Save-RemoteFile "project-template/.claude/hooks/post-compact.ps1"   "$projDir\hooks\post-compact.ps1"

  # Project verbosity hook copy + settings.json merge (T-005-D)
  Save-RemoteFile "project-template/.claude/hooks/verbosity-remind.sh" "$projDir\hooks\verbosity-remind.sh"
  # Single-quoted here-string: bash variables like ${PWD:-}, $_dir, $_h are NOT expanded by PS.
  # The closing '@ MUST be at column 0.
  $projHookEmbedded = (@'
bash -c 'set +e; _dir="${PWD:-}"; _prev=""; _iters=0; while [ "$_dir" != "$_prev" ] && [ "$_iters" -lt 40 ]; do _h="$_dir/.claude/hooks/verbosity-remind.sh"; [ -f "$_h" ] && [ -r "$_h" ] && { bash "$_h"; exit $?; }; _prev="$_dir"; _dir="${_dir%/*}"; [ -z "$_dir" ] && _dir=/; _iters=$((_iters+1)); done; exit 0'
'@).TrimEnd()
  Merge-SettingsJson "$projDir\settings.json" $projHookEmbedded

  # -- context-guard hook wiring -------------------------------------------
  $cgNodeOk = $false
  if (Get-Command node -ErrorAction SilentlyContinue) {
    $nm = node -e "process.stdout.write(String(process.version.split('.')[0].replace('v','')))" 2>$null
    if ([int]$nm -ge 16) { $cgNodeOk = $true } else { Write-Warn "Node.js v$nm < 16 -- context-guard wiring skipped" }
  } else { Write-Warn "node not found -- context-guard settings.json wiring skipped" }
  if ($cgNodeOk) {
    $cgScript = @'
const fs = require('fs');
const f  = process.argv[1];
let obj  = {};
if (fs.existsSync(f)) {
  const raw = fs.readFileSync(f, 'utf8');
  try {
    const p = JSON.parse(raw);
    if (p !== null && typeof p === 'object' && !Array.isArray(p)) { obj = p; }
    else { process.stderr.write('WARN: settings.json root is not a JSON object -- treating as {}\n'); }
  } catch(e) { if (raw.trim()) process.stderr.write('WARN: settings.json is malformed -- treating as {}\n'); }
}
if (!obj.hooks) obj.hooks = {};
['UserPromptSubmit','PostCompact'].forEach(k => {
  if (!Array.isArray(obj.hooks[k])) obj.hooks[k] = [{ hooks: [] }];
  if (!obj.hooks[k][0]) obj.hooks[k][0] = { hooks: [] };
  if (!Array.isArray(obj.hooks[k][0].hooks)) obj.hooks[k][0].hooks = [];
});
function appendIfAbsent(arr, cmd) {
  if (!arr.some(h => h.command === cmd)) arr.push({ type: 'command', command: cmd });
}
const UPS_BASH = "bash -c 'set +e; _dir=\"${PWD:-}\"; _prev=\"\"; _i=0; while [ \"$_dir\" != \"$_prev\" ] && [ \"$_i\" -lt 40 ]; do _h=\"$_dir/.claude/hooks/context-guard.sh\"; [ -f \"$_h\" ] && [ -r \"$_h\" ] && { CC_PROJECT_ROOT=\"$_dir\" bash \"$_h\"; exit $?; }; _prev=\"$_dir\"; _dir=\"${_dir%/*}\"; [ -z \"$_dir\" ] && _dir=/; _i=$((_i+1)); done; exit 0'";
const UPS_PS   = "powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \".claude/hooks/context-guard.ps1\"";
const PC_PS    = "powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \".claude/hooks/post-compact.ps1\"";
appendIfAbsent(obj.hooks.UserPromptSubmit[0].hooks, UPS_BASH);
appendIfAbsent(obj.hooks.UserPromptSubmit[0].hooks, UPS_PS);
appendIfAbsent(obj.hooks.PostCompact[0].hooks,      PC_PS);
const tmp = f + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', { encoding: 'utf8' });
fs.renameSync(tmp, f);
'@
    $cgSettingsPath = "$projDir\settings.json"
    node -e $cgScript $cgSettingsPath 2>$null
    if ($LASTEXITCODE -eq 0) { Write-Ok "context-guard hooks registered in $cgSettingsPath" }
    else { Write-Warn "context-guard settings.json wiring failed -- add hooks manually" }
  }

  if ((Get-Command graphify -ErrorAction SilentlyContinue) -and (Get-Command claude -ErrorAction SilentlyContinue)) {
    Install-Dep "Graphify project graph" "graphify .; graphify hook install; claude mcp add graphify 'python -m graphify.serve graphify-out/graph.json'"
  }

  if (Get-Command uipro -ErrorAction SilentlyContinue) {
    Install-Dep "ui-ux-pro-max" "uipro init --ai claude"
  } else {
    Write-Warn "uipro not found -- skipped"
    $FailedDeps += "ui-ux-pro-max: npm install -g uipro-cli; uipro init --ai claude"
  }

  # Update .gitignore
  $gitignore = ".gitignore"
  $entry = ".claude/memory/personal.md"
  if (-not (Test-Path $gitignore) -or -not (Select-String -Path $gitignore -Pattern ([regex]::Escape($entry)) -Quiet)) {
    Add-Content -Path $gitignore -Value $entry
    Write-Ok "Added $entry to .gitignore"
  }

  # -- .gitattributes eol rules (idempotent) --------------------------------
  $ga = ".gitattributes"
  $gaRo = (Test-Path $ga) -and (Get-Item $ga).IsReadOnly
  if ($gaRo) {
    Write-Warn ".gitattributes is read-only -- *.sh eol=lf and *.ps1 eol=crlf not added; add manually"
  } else {
    $enc8 = [System.Text.UTF8Encoding]::new($false)
    $gaContent = if (Test-Path $ga) { [System.IO.File]::ReadAllText($ga, [System.Text.Encoding]::UTF8) } else { '' }
    if ($gaContent -notmatch '\*\.sh text eol=lf') {
      [System.IO.File]::AppendAllText($ga, "*.sh text eol=lf`n", $enc8)
    }
    if ($gaContent -notmatch '\*\.ps1 text eol=crlf') {
      [System.IO.File]::AppendAllText($ga, "*.ps1 text eol=crlf`n", $enc8)
    }
    Write-Ok "Updated .gitattributes eol rules"
  }

  # -- turn-count.txt gitignore entry (idempotent) --------------------------
  $tcEntry = ".claude/memory/turn-count.txt"
  $gi = ".gitignore"
  $giContent = if (Test-Path $gi) { [System.IO.File]::ReadAllText($gi, [System.Text.Encoding]::UTF8) } else { '' }
  if ($giContent -notlike "*$tcEntry*") {
    $enc8 = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::AppendAllText($gi, "$tcEntry`n", $enc8)
    Write-Ok "Added $tcEntry to .gitignore"
  }

  # Node.js and npm engine constraint check (FEAT-024)
  $nodeVer = node --version 2>&1
  if ($LASTEXITCODE -eq 0) {
    # Guard against shell wrapper corruption (nvm/asdf/nvs can inject output
    # that corrupts $nodeVer); [int]'' throws -- validate the regex match first.
    $nodeMajorRaw = [regex]::Match($nodeVer, 'v(\d+)\.').Groups[1].Value
    if (-not $nodeMajorRaw) {
      Write-Warn "Could not parse Node.js major version from '$nodeVer'; a shell wrapper may have corrupted the output; engine check skipped"
    } else {
      $nodeMajor = [int]$nodeMajorRaw
      if ($nodeMajor -lt 20) {
        Write-Warn "Node.js $nodeVer is below the >=20 engine requirement; npm test may fail"
      } else {
        Write-Ok "Node.js $nodeVer meets the >=20 engine requirement"
        # npm 10+ ships bundled with Node 20; verify it is present and usable.
        $npmVer = npm --version 2>&1
        if ($LASTEXITCODE -eq 0) {
          $npmMajorRaw = [regex]::Match($npmVer, '^(\d+)\.').Groups[1].Value
          if ($npmMajorRaw) {
            $npmMajor = [int]$npmMajorRaw
            if ($npmMajor -lt 10) {
              Write-Warn "npm $npmVer is below >=10; run 'npm install -g npm@latest' to upgrade"
            } else {
              Write-Ok "npm $npmVer meets the >=10 constraint"
            }
          } else {
            Write-Warn "Could not parse npm version from '$npmVer'; engine check skipped"
          }
        } else {
          Write-Warn "npm not found in PATH even though Node >=20 is present; reinstall Node or add npm to PATH"
        }
      }
    }
  } else {
    Write-Warn "node not found in PATH - cannot verify >=20 engine requirement; npm test will fail unless Node >=20 is installed"
  }

  # Pre-commit test gate (FEAT-024)
  $gitDirCheck = git rev-parse --git-dir 2>&1
  if ($LASTEXITCODE -eq 0) {
    $hooksDir = (git rev-parse --git-path hooks 2>&1).ToString().Trim()
    $precommit = Join-Path $hooksDir "pre-commit"
    $sentinel = "# code-conductor:test-gate"
    if ($hooksDir) {
      $hasGate = $false
      if (Test-Path $precommit) {
        $hasGate = (Get-Content $precommit -Raw) -match [regex]::Escape($sentinel)
      }
      if ($hasGate) {
        Write-Ok "Pre-commit test gate already present (idempotent)"
      } else {
        $hooksDirParent = Split-Path $precommit -Parent
        if (-not (Test-Path $hooksDirParent)) {
          New-Item -ItemType Directory -Path $hooksDirParent -Force | Out-Null
        }
        # $enc is initialized here, before the write-access probe, to prevent a
        # use-before-init runtime error: the probe's WriteAllText call uses $enc
        # when test-writing a temp file to the hooks-dir parent.
        $enc = [System.Text.UTF8Encoding]::new($false)
        # Verify write access before modifying the hook file.
        $canWrite = $true
        if (Test-Path $precommit) {
          try { $s = [System.IO.File]::Open($precommit, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Write); $s.Close() } catch { $canWrite = $false }
        } elseif ($hooksDirParent -and (Test-Path $hooksDirParent)) {
          $tmpTest = Join-Path $hooksDirParent ([System.IO.Path]::GetRandomFileName())
          try { [System.IO.File]::WriteAllText($tmpTest, '', $enc); Remove-Item $tmpTest -Force } catch { $canWrite = $false }
        }
        if (-not $canWrite) {
          Write-Warn "Cannot write to pre-commit location ($precommit); test gate not installed"
        } else {
        # $guardBlock: single-quoted here-string; no PS variable expansion.
        # closing '@ MUST be at column 0 in the actual install.ps1 file.
        # CRLF to LF normalization ensures bash on Git for Windows parses correctly.
        $guardBlock = (@'
# code-conductor:test-gate
command -v npm >/dev/null 2>&1 || { echo "[conductor] npm not found - skipping test gate"; exit 0; }
_root=$(git rev-parse --show-toplevel)
[ -d "$_root/node_modules" ] || { echo "[conductor] node_modules not installed - run npm ci first, skipping test gate"; exit 0; }
cd "$_root" && npm test
# /code-conductor:test-gate
'@).Replace("`r`n", "`n").Replace("`r", "`n")
        if (Test-Path $precommit) {
          # Existing file: normalize its line endings, strip trailing whitespace,
          # then append a blank separator + guard block (all LF, UTF-8 no BOM).
          $existing = [System.IO.File]::ReadAllText($precommit, $enc).Replace("`r`n", "`n").Replace("`r", "`n")
          [System.IO.File]::WriteAllText($precommit, $existing.TrimEnd() + "`n" + $guardBlock, $enc)
        } else {
          # New file: write POSIX sh shebang + guard block.
          # #!/bin/sh (not #!/bin/bash) is the git hook convention; the guard block
          # uses only POSIX-compatible commands (command -v, cd, &&).
          # $enc guarantees UTF-8 no BOM; "#!/bin/sh`n" uses LF (PS backtick-n = \n).
          if ($hooksDirParent -and -not (Test-Path $hooksDirParent)) {
            New-Item -ItemType Directory -Path $hooksDirParent -Force | Out-Null
          }
          [System.IO.File]::WriteAllText($precommit, "#!/bin/sh`n" + $guardBlock, $enc)
        }
        Write-Ok "Pre-commit test gate appended to $precommit"
        } # end $canWrite
      }
    } else {
      Write-Warn "Could not resolve git hooks directory - pre-commit hook not installed"
    }
  } else {
    Write-Warn "Not in a git repository - pre-commit hook not installed"
  }
}

# ── Post-install hook trigger (T-005-I) ────────────────────────────────────────
$hookPath = Join-Path $GLOBAL_DIR "hooks\verbosity-remind.sh"
if (-not (Test-Path $hookPath)) {
    Write-Warning "[verbosity-remind] ERROR: hook not found at $hookPath after install. Re-run installer."
} else {
    $bashExe = (Get-Command bash -ErrorAction SilentlyContinue).Source
    if (-not $bashExe) {
        Write-Warning "[verbosity-remind] ERROR: bash not found on PATH. Install Git for Windows and add bash to PATH."
    } else {
        $result = & $bashExe $hookPath 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "PASS: post-install hook trigger succeeded (exit 0)"
        } else {
            Write-Warning "[verbosity-remind] ERROR exec: hook exited $LASTEXITCODE"
        }
        $settingsPath = "$env:USERPROFILE\.claude\settings.json"
        if (Test-Path $settingsPath) {
            try {
                $sd = Get-Content $settingsPath -Raw -Encoding utf8 | ConvertFrom-Json
                $vcount = 0
                $ups = @()
                if ($sd.hooks -and $sd.hooks.PSObject.Properties['UserPromptSubmit']) {
                    $ups = @($sd.hooks.UserPromptSubmit)
                }
                foreach ($e in $ups) {
                    $hks = $e.hooks
                    if ($hks -is [array]) {
                        foreach ($h in $hks) {
                            if ($h.command -like "*verbosity-remind*") { $vcount++ }
                        }
                    }
                }
                if ($vcount -eq 1) {
                    Write-Host "PASS: settings.json contains exactly 1 verbosity-remind entry"
                } elseif ($vcount -gt 1) {
                    Write-Warning "[verbosity-remind] ERROR json: $vcount duplicate entries. Re-run installer."
                } else {
                    Write-Warning "[verbosity-remind] ERROR json: 0 verbosity-remind entries. Re-run installer."
                }
            } catch {
                Write-Warning "[verbosity-remind] WARN: Could not parse settings.json for entry count."
            }
        }
    }
}

# -- Final report ---------------------------------------------------------------
Write-Host ""
if ($RemoteVersion) {
  $RemoteVersion | Set-Content $LocalVersionFile -Encoding utf8
}

Write-Host "  -----------------------------------------"
Write-Host "  code-conductor installed" -ForegroundColor Green
if ($RemoteVersion) { Write-Host "  v$RemoteVersion" -ForegroundColor DarkGray }
Write-Host "  -----------------------------------------"
Write-Host ""
Write-Host "  To update: re-run the install command"
Write-Host "  Changelog: https://github.com/yeisonrestrepo/code-conductor/blob/main/CHANGELOG.md"
Write-Host ""
Write-Host "  Global commands (all projects):"
Write-Host "    /cc-checkpoint  /cc-stack  /cc-lang  /cc-compact"
Write-Host ""
if ($Project) {
  Write-Host "  Project commands (this project):"
  Write-Host "    /cc-init  /cc-resume  /cc-spec  /cc-plan  /cc-review  /cc-debug  /cc-refactor  /cc-test  /cc-docs"
  Write-Host ""
}

if ($FailedDeps.Count -gt 0) {
  Write-Host ""
  Write-Warn "Some items need manual installation:"
  foreach ($item in $FailedDeps) {
    Write-Host "    $item"
  }
}

Write-Host ""

# ── Final install summary (stderr, machine-readable) (T-005-J-2) ───────────────
# CI/CD: capture with (.\install.ps1 2>&1) | Select-String '\[verbosity-remind\] INSTALL'
$summaryGlobal = if (Test-Path "$GLOBAL_DIR\hooks\verbosity-remind.sh") { 'OK' } else { 'FAIL(missing)' }
$summaryProject = 'SKIP'
if ($Project) {
    $summaryProject = if (Test-Path "$projDir\hooks\verbosity-remind.sh") { 'OK' } else { 'FAIL(missing)' }
}
$settingsPath2 = "$env:USERPROFILE\.claude\settings.json"
$summarySettings = 'UNKNOWN'
if (Test-Path $settingsPath2) {
    try {
        $raw2 = Get-Content $settingsPath2 -Raw -Encoding utf8
        $summarySettings = if ($raw2 -match 'verbosity-remind') { 'OK(text-match)' } else { 'FAIL(not-found)' }
    } catch {
        $summarySettings = 'FAIL(parse-error)'
    }
}
$exitCode2 = if ($summaryGlobal -eq 'OK' -and $summarySettings -like 'OK*') { 0 } else { 4 }
[Console]::Error.WriteLine("[verbosity-remind] INSTALL global=$summaryGlobal project=$summaryProject settings=$summarySettings exit=$exitCode2")
exit $exitCode2
