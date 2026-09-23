$ErrorActionPreference = 'Stop'
$spatialProject = $PSScriptRoot
$spatialUrl = 'http://127.0.0.1:8794'
$spatialNode = (Get-Command node -ErrorAction Stop).Source
$spatialRunning = $false
try {
    $spatialResponse = Invoke-RestMethod "$spatialUrl/api/config" -TimeoutSec 2
    $spatialRunning = $spatialResponse.ffmpeg -ne $null
} catch {}
if (-not $spatialRunning) {
    $env:PORT = '8794'
    $env:RECORDINGS_DIR = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Spatial Replay Recordings'
    New-Item -ItemType Directory -Force -Path (Join-Path $spatialProject 'artifacts') | Out-Null
    $spatialProcess = Start-Process -FilePath $spatialNode -ArgumentList 'server.mjs' -WorkingDirectory $spatialProject -WindowStyle Hidden -RedirectStandardOutput (Join-Path $spatialProject 'artifacts/server.log') -RedirectStandardError (Join-Path $spatialProject 'artifacts/server-error.log') -PassThru
    $spatialProcess.Id | Set-Content -LiteralPath (Join-Path $spatialProject 'artifacts/server.pid')
    for ($spatialAttempt = 0; $spatialAttempt -lt 40; $spatialAttempt++) {
        try { Invoke-RestMethod "$spatialUrl/api/config" -TimeoutSec 1 | Out-Null; $spatialRunning = $true; break } catch { Start-Sleep -Milliseconds 250 }
    }
    if (-not $spatialRunning) { throw 'The local server could not start. Check artifacts/server-error.log.' }
}
# The user launches this file to open an interactive camera application.
Start-Process $spatialUrl
