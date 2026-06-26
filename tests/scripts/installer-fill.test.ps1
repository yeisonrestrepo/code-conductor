# tests/scripts/installer-fill.test.ps1
# Run with: powershell -File tests/scripts/installer-fill.test.ps1

$pass = 0; $fail = 0

function Assert-Contains {
  param([string]$Label, [string]$File, [string]$Pattern)
  $content = [System.IO.File]::ReadAllText($File, [System.Text.Encoding]::UTF8)
  if ($content -like "*$Pattern*") {
    Write-Host "PASS: $Label"; $script:pass++
  } else {
    Write-Host "FAIL: $Label (expected '$Pattern')"; $script:fail++
    Write-Host ($content | Select-Object -First 5)
  }
}

function Assert-NotContains {
  param([string]$Label, [string]$File, [string]$Pattern)
  $content = [System.IO.File]::ReadAllText($File, [System.Text.Encoding]::UTF8)
  if ($content -notlike "*$Pattern*") {
    Write-Host "PASS: $Label"; $script:pass++
  } else {
    Write-Host "FAIL: $Label (did NOT expect '$Pattern')"; $script:fail++
  }
}

$helperPs1 = Join-Path $PSScriptRoot "_fill_helper.ps1"
if (-not (Test-Path $helperPs1)) {
  Write-Host "FAIL: _fill_helper.ps1 not found at $helperPs1"
  exit 1
}

function Set-ClaudeMdFields {
  param([string]$MdPath, [string]$JsonStr)
  & $helperPs1 -MdPath $MdPath -JsonStr $JsonStr
}

$TEMPLATE = @'
## Project Identity
- Name:
- Description:
- Stack:
- Language: en

## Development Commands
- Build: <command>
- Test: <command>
- Lint: <command>
- Format: <command>
- Setup: <command>
'@

# ── Test 1: basic fill ──────────────────────────────────────────────────────
$t = [System.IO.Path]::GetTempPath() + "cctest-" + [System.Guid]::NewGuid().ToString("N")
New-Item -ItemType Directory -Path $t | Out-Null
[System.IO.File]::WriteAllText("$t\CLAUDE.md", $TEMPLATE, [System.Text.Encoding]::UTF8)
Set-ClaudeMdFields "$t\CLAUDE.md" '{"name":"myapp","build":"npm run build","test":"jest"}'
Assert-Contains "basic: name filled"  "$t\CLAUDE.md" "- Name: myapp"
Assert-Contains "basic: build filled" "$t\CLAUDE.md" "- Build: npm run build"
Assert-Contains "basic: test filled"  "$t\CLAUDE.md" "- Test: jest"
Remove-Item $t -Recurse -Force

# ── Test 2: value with $ (dollar sign) ────────────────────────────────────
$t = [System.IO.Path]::GetTempPath() + "cctest-" + [System.Guid]::NewGuid().ToString("N")
New-Item -ItemType Directory -Path $t | Out-Null
[System.IO.File]::WriteAllText("$t\CLAUDE.md", $TEMPLATE, [System.Text.Encoding]::UTF8)
Set-ClaudeMdFields "$t\CLAUDE.md" '{"build":"DATABASE_URL=$DB npm test"}'
Assert-Contains "dollar: build with $ preserved" "$t\CLAUDE.md" '$DB'
Remove-Item $t -Recurse -Force

# ── Test 3: value with backslash (Windows path) ────────────────────────────
$t = [System.IO.Path]::GetTempPath() + "cctest-" + [System.Guid]::NewGuid().ToString("N")
New-Item -ItemType Directory -Path $t | Out-Null
[System.IO.File]::WriteAllText("$t\CLAUDE.md", $TEMPLATE, [System.Text.Encoding]::UTF8)
Set-ClaudeMdFields "$t\CLAUDE.md" '{"setup":"C:\\Users\\foo\\setup"}'
Assert-Contains "backslash: setup with path" "$t\CLAUDE.md" "Users"
Remove-Item $t -Recurse -Force

# ── Test 4: non-placeholder line is preserved ──────────────────────────────
$t = [System.IO.Path]::GetTempPath() + "cctest-" + [System.Guid]::NewGuid().ToString("N")
New-Item -ItemType Directory -Path $t | Out-Null
$custom = "## Development Commands`n- Build: my-custom-build`n- Test: <command>"
[System.IO.File]::WriteAllText("$t\CLAUDE.md", $custom, [System.Text.Encoding]::UTF8)
Set-ClaudeMdFields "$t\CLAUDE.md" '{"build":"npm run build","test":"jest"}'
Assert-Contains     "preserve: custom build unchanged" "$t\CLAUDE.md" "- Build: my-custom-build"
Assert-NotContains  "preserve: detected build not written" "$t\CLAUDE.md" "- Build: npm run build"
Assert-Contains     "preserve: placeholder test filled"   "$t\CLAUDE.md" "- Test: jest"
Remove-Item $t -Recurse -Force

# ── Summary ──────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "Results: $pass passed, $fail failed"
if ($fail -eq 0) { exit 0 } else { exit 1 }
