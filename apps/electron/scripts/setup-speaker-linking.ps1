param(
  [string]$PythonVersion = '3.11',
  [string]$TorchIndex = 'https://download.pytorch.org/whl/cu126'
)

$ErrorActionPreference = 'Stop'
$electronRoot = Split-Path -Parent $PSScriptRoot
$runtimePath = Join-Path $electronRoot '.venv-speaker-linking'
$pythonPath = Join-Path $runtimePath 'Scripts\python.exe'
$requirementsPath = Join-Path $electronRoot 'resources\speaker-linking\requirements.txt'

uv venv --python $PythonVersion $runtimePath
uv pip install --python $pythonPath torch torchaudio --index-url $TorchIndex
uv pip install --python $pythonPath -r $requirementsPath

Write-Host ''
Write-Host 'Speaker-linking runtime installed.'
Write-Host "Set transcription.speakerLinkingPythonPath to: $pythonPath"
Write-Host 'The compatible 3.1 fallback works immediately with an authorized Hugging Face token.'
Write-Host 'Accept the Community-1 model conditions to enable the preferred pipeline.'
