try {
  $root = if ($env:CC_PROJECT_ROOT) { $env:CC_PROJECT_ROOT } else { '.' }
  $mem  = Join-Path $root '.claude\memory'
  if ((Test-Path $mem) -and -not (Test-Path $mem -PathType Container)) { exit 0 }
  New-Item -ItemType Directory -Force $mem -ErrorAction SilentlyContinue | Out-Null
  if (-not (Test-Path $mem -PathType Container)) { exit 0 }

  $target = Join-Path $mem 'turn-count.txt'
  $tmp    = Join-Path $mem 'turn-count.txt.tmp'
  $enc    = [System.Text.UTF8Encoding]::new($false)
  [System.IO.File]::WriteAllText($tmp, "0`n", $enc)
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

  ""
  "[PKG] Conversation compacted. Context counter reset to 0."
  $projMd = Join-Path $root '.claude\memory\project.md'
  if (Test-Path $projMd) {
    $lastMatch = Select-String '## Checkpoint' $projMd | Select-Object -Last 1
    if ($lastMatch) { "   Last checkpoint: $($lastMatch.Line)" } else { "   No checkpoints recorded yet in project.md." }
  } else { "   No project.md found." }
  ""
  "   [TIP] If this session had important decisions, run /checkpoint before continuing."

  $cond = Join-Path $root '.conductor'
  Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $cond 'session-id')
  Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $cond 'session-id.*.tmp')

  ""
} catch {
  exit 0
}
