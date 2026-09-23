param([string]$BootstrapPython = "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe")
$ErrorActionPreference='Stop'
$spatialRoot=Split-Path $PSScriptRoot -Parent
Set-Location $spatialRoot
if(-not(Test-Path .venv/Scripts/python.exe)) { & $BootstrapPython -m venv .venv; if($LASTEXITCODE){throw 'Cannot create bootstrap environment'} }
& .venv/Scripts/python.exe -m pip install uv
if($LASTEXITCODE){throw 'Cannot install uv'}
$env:UV_PYTHON_BIN_DIR=Join-Path $spatialRoot '.python/bin'
& .venv/Scripts/uv.exe python install 3.10.21 --install-dir .python
if($LASTEXITCODE){throw 'Cannot install Python 3.10'}
if(-not(Test-Path .reconstruction-env/Scripts/python.exe)){
 & .venv/Scripts/uv.exe venv --python .python/cpython-3.10.21-windows-x86_64-none/python.exe .reconstruction-env
 if($LASTEXITCODE){throw 'Cannot create reconstruction environment'}
}
& .venv/Scripts/uv.exe pip install --python .reconstruction-env/Scripts/python.exe -r scripts/requirements-reconstruction.txt --index-strategy unsafe-best-match
if($LASTEXITCODE){throw 'Cannot install reconstruction dependencies'}
& .venv/Scripts/uv.exe pip install --python .reconstruction-env/Scripts/python.exe --no-deps 'git+https://github.com/facebookresearch/vggt.git@a288dd0f14786c93483e45524328726ab7b1b4ce'
if($LASTEXITCODE){throw 'Cannot install VGGT source'}
New-Item -ItemType Directory -Force .models,public/reconstruction-models | Out-Null
foreach($model in @(
 @{Path='.models/vggt-model.pt';Url='https://huggingface.co/facebook/VGGT-1B/resolve/main/model.pt'},
 @{Path='public/reconstruction-models/loftr_outdoor.ckpt';Url='https://huggingface.co/kornia/loftr/resolve/main/loftr_outdoor.ckpt'}
)){
 if(-not(Test-Path -LiteralPath $model.Path)) {Invoke-WebRequest $model.Url -OutFile ($model.Path+'.download');Move-Item -LiteralPath ($model.Path+'.download') -Destination $model.Path}
}
Write-Output 'Reconstruction installed. VGGT-1B checkpoint is for non-commercial research; read RECONSTRUCTION_PIPELINE.md before commercial use.'
