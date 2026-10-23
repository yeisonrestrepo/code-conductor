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

  # The key must follow { or , so an escaped "session_id" inside the prompt text never matches.
  $sessionId = ''
  try {
    if ([Console]::IsInputRedirected) {
      $reader = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), [System.Text.UTF8Encoding]::new($false))
      $in = $reader.ReadToEnd()
      if ($in -match '[{,]\s*"session_id"\s*:\s*"([A-Za-z0-9_-]+)"') { $sessionId = $Matches[1] }
    }
  } catch { }

  # Accepts "<id> <count>" or a legacy bare "<count>".
  $storedId = ''
  $count = 0
  $countFile = Join-Path $mem 'turn-count.txt'
  try {
    $raw = [System.IO.File]::ReadAllText($countFile, [System.Text.Encoding]::UTF8)
    $fields = @($raw.Split("`n")[0].TrimEnd("`r").Trim() -split '\s+')
    if ($fields.Count -eq 1 -and $fields[0] -match '^[0-9]+$') { $count = [int]$fields[0] }
    if ($fields.Count -ge 2 -and $fields[0] -match '^[A-Za-z0-9_-]+$' -and $fields[1] -match '^[0-9]+$') {
      $storedId = $fields[0]
      $count = [int]$fields[1]
    }
  } catch { }

  # A count left by another session says nothing about this session's context (BUG-056).
  if ($sessionId -and $sessionId -cne $storedId) { $count = 0 }
  if (-not $sessionId) { $sessionId = $storedId }

  $warning  = [Math]::Truncate($critical * 80 / 100)
  $newCount = [Math]::Min($count + 1, 99999)
  $line = if ($sessionId) { "$sessionId $newCount" } else { "$newCount" }

  $target = Join-Path $mem 'turn-count.txt'
  $tmp    = Join-Path $mem 'turn-count.txt.tmp'
  $enc    = [System.Text.UTF8Encoding]::new($false)
  [System.IO.File]::WriteAllText($tmp, "$line`n", $enc)
  try {
    # PowerShell turns a bare $null into "" for a string argument, which Replace rejects.
    [System.IO.File]::Replace($tmp, $target, [NullString]::Value)
  } catch [System.IO.FileNotFoundException] {
    try {
      [System.IO.File]::Move($tmp, $target)
    } catch {
      Remove-Item $tmp -Force -ErrorAction SilentlyContinue
      exit 0
    }
  }

  if ($env:CC_GUARD_DEBUG) {
    Write-Host "[context-guard] root=$root session=$sessionId count=$newCount critical=$critical warning=$warning"
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
