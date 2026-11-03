param([string]$Node = "")
$ErrorActionPreference = 'Stop'
$repoPath = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
if (-not $Node) { $candidate = Get-Command node -ErrorAction SilentlyContinue; if ($candidate) { $Node = $candidate.Source } else { $Node = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' } }
if (-not (Test-Path -LiteralPath $Node)) { throw 'Node 24 is required. Pass -Node with its full path.' }
$major = & $Node -p 'Number(process.versions.node.split(".")[0])'
if ($LASTEXITCODE -ne 0 -or [int]$major -lt 24) { throw 'Node 24 or newer is required for the local SQLite ledger. Pass -Node with a compatible executable.' }
try { $existing = Invoke-RestMethod 'http://127.0.0.1:8782/api/status' -TimeoutSec 2; if ($existing.process.pid) { Write-Output 'Local tracker is already running: http://127.0.0.1:8782'; exit 0 } } catch { }
$dataPath = Join-Path $repoPath 'local-data'
New-Item -ItemType Directory -Force -Path $dataPath | Out-Null
$scriptPath = Join-Path $PSScriptRoot 'tracker.mjs'
$process = Start-Process -FilePath $Node -ArgumentList @(('"'+$scriptPath+'"'),'--watch','--data-dir',('"'+$dataPath+'"')) -WorkingDirectory $repoPath -WindowStyle Hidden -RedirectStandardOutput (Join-Path $dataPath 'worker.log') -RedirectStandardError (Join-Path $dataPath 'worker-error.log') -PassThru
Start-Sleep -Seconds 2
$process.Refresh()
if ($process.HasExited) { throw "Tracker exited during startup. Read $dataPath/worker-error.log for the cause." }
Write-Output "Started process $($process.Id). Open http://127.0.0.1:8782."
