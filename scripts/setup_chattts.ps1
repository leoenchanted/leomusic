param(
  [string]$InstallDir = "D:\chattts",
  [string]$CacheDir = "D:\chattts\cache",
  [string]$RepoUrl = "https://github.com/2noise/ChatTTS.git",
  [string]$Python = "python",
  [switch]$StrictPython,
  [switch]$AllowUnsupportedPython
)

$ErrorActionPreference = "Stop"

function Resolve-FullPath([string]$PathValue) {
  if ([System.IO.Path]::IsPathRooted($PathValue)) {
    return $PathValue
  }
  return (Join-Path (Get-Location).Path $PathValue)
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$installPath = Resolve-FullPath $InstallDir
$cachePath = Resolve-FullPath $CacheDir
$repoPath = Join-Path $installPath "ChatTTS"
$venvPath = Join-Path $installPath ".venv"
$venvPython = Join-Path $venvPath "Scripts\python.exe"

Write-Host "LEO DJ ChatTTS setup"
Write-Host "Install dir: $installPath"
Write-Host "Repo dir:    $repoPath"
Write-Host "Cache dir:   $cachePath"

$versionText = (& $Python -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}')").Trim()
if ($LASTEXITCODE -ne 0 -or -not $versionText) {
  throw "Cannot run Python command: $Python"
}

$parts = $versionText.Split(".")
$majorMinor = "$($parts[0]).$($parts[1])"
$ideal = @("3.10", "3.11")
$minimumMajor = 3
$minimumMinor = 10

if (([int]$parts[0] -lt $minimumMajor -or ([int]$parts[0] -eq $minimumMajor -and [int]$parts[1] -lt $minimumMinor)) -and -not $AllowUnsupportedPython) {
  Write-Host ""
  Write-Host "ChatTTS/PyTorch needs a modern Python. Detected Python $versionText."
  Write-Host "Install Python 3.11, then run:"
  Write-Host "  powershell -ExecutionPolicy Bypass -File scripts\setup_chattts.ps1 -Python `"D:\Python311\python.exe`""
  Write-Host ""
  Write-Host "If you still want to try this Python anyway:"
  Write-Host "  powershell -ExecutionPolicy Bypass -File scripts\setup_chattts.ps1 -AllowUnsupportedPython"
  exit 1
}

if (-not $ideal.Contains($majorMinor)) {
  Write-Host ""
  Write-Host "Warning: ChatTTS is usually safest on Python 3.10 or 3.11. Detected Python $versionText."
  Write-Host "This setup will continue. If pip or torch fails, install Python 3.11 and rerun with -Python."
  if ($StrictPython) {
    exit 1
  }
}

New-Item -ItemType Directory -Force $installPath | Out-Null
New-Item -ItemType Directory -Force $cachePath | Out-Null
New-Item -ItemType Directory -Force (Join-Path $cachePath "pip") | Out-Null
New-Item -ItemType Directory -Force (Join-Path $cachePath "huggingface") | Out-Null
New-Item -ItemType Directory -Force (Join-Path $cachePath "torch") | Out-Null
New-Item -ItemType Directory -Force (Join-Path $cachePath "tmp") | Out-Null

if (-not (Test-Path $repoPath)) {
  Write-Host "Cloning ChatTTS official repo..."
  git clone $RepoUrl $repoPath
} else {
  Write-Host "ChatTTS repo already exists. To update it later:"
  Write-Host "  git -C `"$repoPath`" pull"
}

$env:PIP_CACHE_DIR = Join-Path $cachePath "pip"
$env:HF_HOME = Join-Path $cachePath "huggingface"
$env:HUGGINGFACE_HUB_CACHE = Join-Path $env:HF_HOME "hub"
$env:HF_HUB_DISABLE_XET = "1"
$env:HF_HUB_DISABLE_SYMLINKS_WARNING = "1"
$env:TORCH_HOME = Join-Path $cachePath "torch"
$env:TEMP = Join-Path $cachePath "tmp"
$env:TMP = Join-Path $cachePath "tmp"

if (-not (Test-Path $venvPython)) {
  & $Python -m venv $venvPath
}

& $venvPython -m pip install --upgrade pip wheel "setuptools<82"
& $venvPython -m pip install -r (Join-Path $repoPath "requirements.txt")
& $venvPython -m pip install flask flask-cors soundfile

Write-Host ""
Write-Host "ChatTTS installed."
Write-Host "Official WebUI:"
Write-Host "  D:\chattts\.venv\Scripts\python.exe D:\chattts\ChatTTS\examples\web\webui.py"
Write-Host ""
Write-Host "Start the server:"
Write-Host "  npm.cmd run voice:chattts"
Write-Host ""
Write-Host "Then in LEO DJ Settings:"
Write-Host "  Voice Model = Local TTS Helper"
Write-Host "  Helper Endpoint = http://127.0.0.1:8789/tts"
