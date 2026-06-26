param([string]$MdPath, [string]$JsonStr)
$helper = Join-Path $PSScriptRoot "_fill_helper.cjs"
$jsonTmp = [System.IO.Path]::GetTempFileName()
try {
  [System.IO.File]::WriteAllText($jsonTmp, $JsonStr, [System.Text.UTF8Encoding]::new($false))
  & node $helper $MdPath $jsonTmp
} finally {
  if (Test-Path $jsonTmp) { Remove-Item $jsonTmp -Force -ErrorAction SilentlyContinue }
}
