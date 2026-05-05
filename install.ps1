# code-conductor installer — Windows (PowerShell)
# Usage: irm https://raw.githubusercontent.com/yeisonrestrepo/code-conductor/main/install.ps1 | iex
#        & ([ScriptBlock]::Create((irm https://raw.githubusercontent.com/yeisonrestrepo/code-conductor/main/install.ps1))) -Project
#        & ([ScriptBlock]::Create((irm https://raw.githubusercontent.com/yeisonrestrepo/code-conductor/main/install.ps1))) -NoDeps
#        & ([ScriptBlock]::Create((irm https://raw.githubusercontent.com/yeisonrestrepo/code-conductor/main/install.ps1))) -Verbosity INFO

param(
  [switch]$Project,
  [switch]$NoDeps,
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
Write-Host "  ─────────────────────────"
Write-Host ""

$LocalVersionFile = "$GLOBAL_DIR\memory\conductor-version.md"
$LocalVersion     = if (Test-Path $LocalVersionFile) { (Get-Content $LocalVersionFile -Raw).Trim() } else { $null }
try   { $RemoteVersion = (Invoke-WebRequest -Uri "$BASE_URL/VERSION" -UseBasicParsing -TimeoutSec 5).Content.Trim() }
catch { $RemoteVersion = $null }

if ($RemoteVersion) { Write-Info "v$RemoteVersion" }
if ($LocalVersion -and $RemoteVersion -and $LocalVersion -ne $RemoteVersion) {
  Write-Warn "Updating $LocalVersion → $RemoteVersion"
}
if ($RemoteVersion -or $LocalVersion) { Write-Host "" }

# ── Runtime detection ──────────────────────────────────────────────────────────
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
      Write-Ok "Python $pyVer (>=3.10) — Graphify eligible"
    } else {
      Write-Warn "Python $pyVer found but Graphify requires 3.10+"
    }
  }
}

# ── Auto-install Node if missing ────────────────────────────────────────────────
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

# ── Dependency installation ────────────────────────────────────────────────────
function Install-Dep {
  param([string]$Name, [string]$Cmd)
  Write-Info "Installing $Name..."
  Invoke-Expression $Cmd
  if ($LASTEXITCODE -eq 0) {
    Write-Ok "$Name installed"
  } else {
    Write-Warn "$Name failed — manual install: $Cmd"
    $script:FailedDeps += "${Name}: ${Cmd}"
  }
}

if (-not $NoDeps) {
  Write-Host ""
  Write-Info "Installing dependencies..."
  Write-Host ""

  if ($HasNode) {
    Write-Info "Installing claude-mem..."

    # Attempt 1 — run via cmd.exe; legacy-peer-deps resolves tree-sitter version conflict
    npm config set legacy-peer-deps true
    cmd /c "npx --yes claude-mem install"
    $claudeMemResult = $LASTEXITCODE
    npm config set legacy-peer-deps false
    if ($claudeMemResult -eq 0) {
      Write-Ok "claude-mem installed"
    } else {
      # Attempt 2 — auto-install Visual C++ Build Tools (required by tree-sitter) then retry
      Write-Info "claude-mem needs Visual C++ Build Tools — installing via winget (this may take a few minutes)..."
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
            Write-Warn "claude-mem failed after build tools install — manual install: npx --yes claude-mem install"
            $script:FailedDeps += "claude-mem: npx --yes claude-mem install"
          }
        } else {
          Write-Warn "Visual C++ Build Tools install failed — manual install: npx --yes claude-mem install"
          $script:FailedDeps += "claude-mem: npx --yes claude-mem install"
        }
      } else {
        Write-Warn "winget not found — manual install: npx --yes claude-mem install"
        $script:FailedDeps += "claude-mem: npx --yes claude-mem install"
      }
    }
  }

  if ($HasNode -and $HasPython) {
    Install-Dep "ui-ux-pro-max-skill" "npm install -g uipro-cli; uipro init --ai claude"
  } else {
    Write-Warn "ui-ux-pro-max-skill requires both Node and Python — skipped"
    $FailedDeps += "ui-ux-pro-max-skill: npm install -g uipro-cli; uipro init --ai claude"
  }

  if (Get-Command claude -ErrorAction SilentlyContinue) {
    Install-Dep "Playwright MCP" "claude mcp add playwright npx @playwright/mcp@latest"
    Install-Dep "Superpowers"    "claude plugin install superpowers@claude-plugins-official"
    Install-Dep "code-simplifier" "claude plugin install code-simplifier@claude-plugins-official"
  } else {
    Write-Warn "claude CLI not found — Playwright MCP, Superpowers, and code-simplifier need the Claude Code CLI"
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
    Write-Warn "Graphify requires Python 3.10+ — skipped"
    $FailedDeps += "Graphify: pipx install graphifyy; graphify install"
  }
}

# ── Download helper ────────────────────────────────────────────────────────────
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

# ── Install global files ───────────────────────────────────────────────────────
Write-Host ""
Write-Info "Installing global Claude files to $GLOBAL_DIR..."
Write-Host ""

foreach ($sub in "commands", "memory", "skills", "stack-profiles") {
  New-Item -ItemType Directory -Path "$GLOBAL_DIR\$sub" -Force | Out-Null
}

# User-configured — skip if exist
Save-RemoteFile "global/CLAUDE.md"         "$GLOBAL_DIR\CLAUDE.md"         $false
Save-RemoteFile "global/settings.json"      "$GLOBAL_DIR\settings.json"      $false
Save-RemoteFile "global/memory/personal.md" "$GLOBAL_DIR\memory\personal.md" $false

# Agent-managed — always overwrite
Save-RemoteFile "global/commands/checkpoint.md" "$GLOBAL_DIR\commands\checkpoint.md"
Save-RemoteFile "global/commands/stack.md"      "$GLOBAL_DIR\commands\stack.md"
Save-RemoteFile "global/commands/lang.md"       "$GLOBAL_DIR\commands\lang.md"
Save-RemoteFile "skills/code-simplifier.md"    "$GLOBAL_DIR\skills\code-simplifier.md"
Save-RemoteFile "skills/ui-ux.md"              "$GLOBAL_DIR\skills\ui-ux.md"
Save-RemoteFile "skills/verbosity.md"        "$GLOBAL_DIR\skills\verbosity.md"
Save-RemoteFile "skills/memory-first.md"     "$GLOBAL_DIR\skills\memory-first.md"
Save-RemoteFile "skills/agent-delegation.md" "$GLOBAL_DIR\skills\agent-delegation.md"

foreach ($stackProfile in @("_base","_multi-stack","_template","javascript","typescript","python","java","go","rust","react","angular","nextjs","nestjs","django","flask")) {
  Save-RemoteFile "stack-profiles/$stackProfile.md" "$GLOBAL_DIR\stack-profiles\$stackProfile.md"
}

"VERBOSITY: $Verbosity" | Set-Content "$GLOBAL_DIR\memory\verbosity.md" -Encoding utf8
Write-Ok "Verbosity set to $Verbosity"

# ── Install project template ───────────────────────────────────────────────────
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

  foreach ($cmd in @("spec","plan","review","debug","refactor","test","docs")) {
    Save-RemoteFile "project-template/.claude/commands/$cmd.md" "$projDir\commands\$cmd.md"
  }

  Save-RemoteFile "project-template/.claude/hooks/pre-tool-use.sh"  "$projDir\hooks\pre-tool-use.sh"
  Save-RemoteFile "project-template/.claude/hooks/post-compact.sh"  "$projDir\hooks\post-compact.sh"

  if ((Get-Command graphify -ErrorAction SilentlyContinue) -and (Get-Command claude -ErrorAction SilentlyContinue)) {
    Install-Dep "Graphify project graph" "graphify .; graphify hook install; claude mcp add graphify 'python -m graphify.serve graphify-out/graph.json'"
  }

  # Update .gitignore
  $gitignore = ".gitignore"
  $entry = ".claude/memory/personal.md"
  if (-not (Test-Path $gitignore) -or -not (Select-String -Path $gitignore -Pattern ([regex]::Escape($entry)) -Quiet)) {
    Add-Content -Path $gitignore -Value $entry
    Write-Ok "Added $entry to .gitignore"
  }
}

# ── Final report ───────────────────────────────────────────────────────────────
Write-Host ""
if ($RemoteVersion) {
  $RemoteVersion | Set-Content $LocalVersionFile -Encoding utf8
}

Write-Host "  ─────────────────────────────────────────"
Write-Host "  code-conductor installed" -ForegroundColor Green
if ($RemoteVersion) { Write-Host "  v$RemoteVersion" -ForegroundColor DarkGray }
Write-Host "  ─────────────────────────────────────────"
Write-Host ""
Write-Host "  To update: re-run the install command"
Write-Host "  Changelog: https://github.com/yeisonrestrepo/code-conductor/blob/main/CHANGELOG.md"
Write-Host ""
Write-Host "  Global commands (all projects):"
Write-Host "    /checkpoint  /stack  /lang"
Write-Host ""
if ($Project) {
  Write-Host "  Project commands (this project):"
  Write-Host "    /spec  /plan  /review  /debug  /refactor  /test  /docs"
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
