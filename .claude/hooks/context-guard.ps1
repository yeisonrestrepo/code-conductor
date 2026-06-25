try {
  $root = if ($env:CC_PROJECT_ROOT) { $env:CC_PROJECT_ROOT } else { '.' }
  $mem  = Join-Path $root '.claude\memory'
  if ((Test-Path $mem) -and -not (Test-Path $mem -PathType Container)) { exit 0 }
  New-Item -ItemType Directory -Force $mem -ErrorAction SilentlyContinue | Out-Null
  if (-not (Test-Path $mem -PathType Container)) { exit 0 }

  $critical = 25
  $threshFile = Join-Path $mem 'context-threshold.txt'
  try {
    $raw = [System.IO.File]::ReadAllText($threshFile, [System.Text.Encoding]::UTF8)
    $val = $raw.Split("`n")[0].TrimEnd("`r").Trim()
    if ($val -match '^[1-9][0-9]*$') { $critical = [int]$val }
  } catch { }

  $count = 0
  $countFile = Join-Path $mem 'turn-count.txt'
  try {
    $raw = [System.IO.File]::ReadAllText($countFile, [System.Text.Encoding]::UTF8)
    $val = $raw.Split("`n")[0].TrimEnd("`r").Trim()
    if ($val -match '^[0-9]+$') { $count = [int]$val }
  } catch { }

  $warning  = [Math]::Truncate($critical * 80 / 100)
  $newCount = [Math]::Min($count + 1, 99999)

  $target = Join-Path $mem 'turn-count.txt'
  $tmp    = Join-Path $mem 'turn-count.txt.tmp'
  $enc    = [System.Text.UTF8Encoding]::new($false)
  [System.IO.File]::WriteAllText($tmp, "$newCount`n", $enc)
  try {
    [System.IO.File]::Replace($tmp, $target, $null)
  } catch [System.IO.FileNotFoundException] {
    try {
      [System.IO.File]::Move($tmp, $target)
    } catch {
      Remove-Item $tmp -Force -ErrorAction SilentlyContinue
      exit 0
    }
  }

  if ($env:CC_GUARD_DEBUG) {
    Write-Host "[context-guard] root=$root count=$newCount critical=$critical warning=$warning"
  }

  if ($newCount -ge 99999) {
    "[!!] CONTEXT CRITICAL: Turn 99999/$critical (counter saturated) -- run /cc-compact NOW."
  } elseif ($newCount -ge $critical) {
    "[!!] CONTEXT CRITICAL: Turn $newCount/$critical -- run /cc-compact NOW before context overflows."
  } elseif ($warning -gt 0 -and $newCount -ge $warning) {
    "[!] CONTEXT WARNING: Turn $newCount/$critical -- consider running /cc-compact soon."
  }
} catch {
  exit 0
}
