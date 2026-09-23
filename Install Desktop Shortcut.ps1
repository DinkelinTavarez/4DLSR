$ErrorActionPreference = 'Stop'
$spatialDesktop = [Environment]::GetFolderPath('Desktop')
$spatialTarget = Join-Path $PSScriptRoot 'Open Spatial Replay.cmd'
$spatialShortcut = Join-Path $spatialDesktop 'Spatial Replay.lnk'
$spatialShell = New-Object -ComObject WScript.Shell
if (Test-Path -LiteralPath $spatialShortcut) {
    $existingSpatialShortcut = $spatialShell.CreateShortcut($spatialShortcut)
    if ($existingSpatialShortcut.TargetPath -ne $spatialTarget) {
        throw 'A different Spatial Replay shortcut already exists. It was preserved.'
    }
}
$spatialLink = $spatialShell.CreateShortcut($spatialShortcut)
$spatialLink.TargetPath = $spatialTarget
$spatialLink.WorkingDirectory = $PSScriptRoot
$spatialLink.Description = 'Record your webcam, rewind, and explore depth-based 4D playback locally.'
$spatialLink.IconLocation = "$env:SystemRoot\System32\shell32.dll,137"
$spatialLink.Save()
New-Item -ItemType Directory -Path (Join-Path $spatialDesktop 'Spatial Replay Recordings') -Force | Out-Null
Write-Output $spatialShortcut
