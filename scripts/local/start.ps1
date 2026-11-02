param([string]$Node = "")
$ErrorActionPreference = 'Stop'
$repoPath = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
if (-not $Node) { $candidate = Get-Command node -ErrorAction SilentlyContinue; if ($candidate) { $Node = $candidate.Source } else { $Node = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' } }
if (-not (Test-Path -LiteralPath $Node)) { throw 'Node 24 is required. Pass -Node with its full path.' }
try { $existing = Invoke-RestMethod 'http://127.0.0.1:8782/api/status' -TimeoutSec 2; if ($existing.process.pid) { Write-Output 'Local tracker is already running: http://127.0.0.1:8782'; exit 0 } } catch { }
$dataPath = Join-Path $repoPath 'local-data'
New-Item -ItemType Directory -Force -Path $dataPath | Out-Null
$scriptPath = Join-Path $PSScriptRoot 'tracker.mjs'
$process = Start-Process -FilePath $Node -ArgumentList @(('"'+$scriptPath+'"'),'--watch','--data-dir',('"'+$dataPath+'"')) -WorkingDirectory $repoPath -WindowStyle Hidden -RedirectStandardOutput (Join-Path $dataPath 'worker.log') -RedirectStandardError (Join-Path $dataPath 'worker-error.log') -PassThru
Write-Output "Started process $($process.Id). Open http://127.0.0.1:8782."
