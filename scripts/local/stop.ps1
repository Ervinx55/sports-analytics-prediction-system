$repoPath = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$dataPath = Join-Path $repoPath 'local-data'
if (Test-Path -LiteralPath $dataPath) { Set-Content -LiteralPath (Join-Path $dataPath 'STOP') -Value 'Stop requested' }
Write-Output 'Stop requested. The tracker will close after its bounded current cycle finishes.'
