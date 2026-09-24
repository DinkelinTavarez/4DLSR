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

# Start the private phone gateway and the account-assigned fixed ngrok endpoint
# when remote access has been configured. The gateway still requires the saved
# 256-bit bearer key and only exposes its explicit route allowlist.
$spatialArtifacts = Join-Path $spatialProject 'artifacts'
$spatialRemoteConfig = Join-Path $spatialArtifacts 'remote-access.json'
if (Test-Path -LiteralPath $spatialRemoteConfig) {
    $spatialRemote = Get-Content -LiteralPath $spatialRemoteConfig -Raw | ConvertFrom-Json
    $spatialGatewayPort = if ($spatialRemote.port) { [int]$spatialRemote.port } else { 8800 }
    $spatialGatewayRunning = $false
    try {
        Invoke-WebRequest "http://127.0.0.1:$spatialGatewayPort/api/remote/state" -Headers @{ Authorization = 'Bearer unavailable' } -TimeoutSec 2 -UseBasicParsing | Out-Null
    } catch {
        $spatialGatewayRunning = $_.Exception.Response.StatusCode.value__ -eq 401
    }
    if (-not $spatialGatewayRunning) {
        $spatialGateway = Start-Process -FilePath $spatialNode -ArgumentList 'remote-gateway.mjs' -WorkingDirectory $spatialProject -WindowStyle Hidden -RedirectStandardOutput (Join-Path $spatialArtifacts 'remote-gateway.log') -RedirectStandardError (Join-Path $spatialArtifacts 'remote-gateway-error.log') -PassThru
        $spatialGateway.Id | Set-Content -LiteralPath (Join-Path $spatialArtifacts 'remote-gateway.pid')
    }
    if ($spatialRemote.publicUrl -and $spatialRemote.publicUrl -match '^https://([a-z0-9-]+\.)+ngrok-free\.dev$') {
        $spatialDomain = ([uri]$spatialRemote.publicUrl).Host
        $spatialNgrokReady = $false
        try {
            $spatialNgrokReady = @((Invoke-RestMethod 'http://127.0.0.1:4040/api/tunnels' -TimeoutSec 2).tunnels | Where-Object public_url -eq $spatialRemote.publicUrl).Count -gt 0
        } catch {}
        if (-not $spatialNgrokReady) {
            $spatialNgrokPackage = Get-AppxPackage -Name 'ngrok.ngrok' -ErrorAction SilentlyContinue
            $spatialNgrok = if ($spatialNgrokPackage) { Join-Path $spatialNgrokPackage.InstallLocation 'ngrok.exe' } else { (Get-Command ngrok -ErrorAction Stop).Source }
            $spatialTunnel = Start-Process -FilePath $spatialNgrok -ArgumentList @('http',"--url=$spatialDomain",[string]$spatialGatewayPort,'--log=stdout','--log-format=json') -WorkingDirectory $spatialProject -WindowStyle Hidden -RedirectStandardOutput (Join-Path $spatialArtifacts 'ngrok.log') -RedirectStandardError (Join-Path $spatialArtifacts 'ngrok-error.log') -PassThru
            $spatialTunnel.Id | Set-Content -LiteralPath (Join-Path $spatialArtifacts 'ngrok.pid')
        }
    }
}
# The user launches this file to open an interactive camera application.
Start-Process $spatialUrl
