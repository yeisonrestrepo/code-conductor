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

if (-not $NoDeps) {
  Write-Host ""
  Write-Info "Installing dependencies..."
  Write-Host ""

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
        } else { Write-Host "  INFO: log size $sz bytes — no rotation needed." }
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

# -- Install project template ---------------------------------------------------
if ($Project) {
  Write-Host ""
  Write-Info "Installing project template into current directory..."
  Write-Host ""

  $projDir = ".claude"
  foreach ($sub in "commands", "hooks", "memory") {
    New-Item -ItemType Directory -Path "$projDir\$sub" -Force | Out-Null
  }

  Save-RemoteFile "project-template/CLAUDE.md"                 "CLAUDE.md"                      $false
  Save-RemoteFile "project-template/.claude/settings.json"     "$projDir\settings.json"          $false
  Save-RemoteFile "project-template/.claude/memory/project.md" "$projDir\memory\project.md"      $false

  foreach ($cmd in @("cc-init","cc-resume","cc-spec","cc-plan","cc-implement","cc-review","cc-debug","cc-refactor","cc-test","cc-docs")) {
    Save-RemoteFile "project-template/.claude/commands/$cmd.md" "$projDir\commands\$cmd.md"
  }

  Save-RemoteFile "project-template/.claude/hooks/pre-tool-use.sh"  "$projDir\hooks\pre-tool-use.sh"
  Save-RemoteFile "project-template/.claude/hooks/post-compact.sh"  "$projDir\hooks\post-compact.sh"

  # Project verbosity hook copy + settings.json merge (T-005-D)
  Save-RemoteFile "project-template/.claude/hooks/verbosity-remind.sh" "$projDir\hooks\verbosity-remind.sh"
  # Single-quoted here-string: bash variables like ${PWD:-}, $_dir, $_h are NOT expanded by PS.
  # The closing '@ MUST be at column 0.
  $projHookEmbedded = (@'
bash -c 'set +e; _dir="${PWD:-}"; _prev=""; _iters=0; while [ "$_dir" != "$_prev" ] && [ "$_iters" -lt 40 ]; do _h="$_dir/.claude/hooks/verbosity-remind.sh"; [ -f "$_h" ] && [ -r "$_h" ] && { bash "$_h"; exit $?; }; _prev="$_dir"; _dir="${_dir%/*}"; [ -z "$_dir" ] && _dir=/; _iters=$((_iters+1)); done; exit 0'
'@).TrimEnd()
  Merge-SettingsJson "$projDir\settings.json" $projHookEmbedded

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
