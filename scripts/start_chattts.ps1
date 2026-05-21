param(
  [string]$InstallDir = "D:\chattts",
  [string]$CacheDir = "D:\chattts\cache",
  [int]$Port = 8789
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
$venvPython = Join-Path $installPath ".venv\Scripts\python.exe"
$serverPath = Join-Path $repoRoot "scripts\chattts_server.py"

if (-not (Test-Path $venvPython)) {
  Write-Host "ChatTTS venv not found: $venvPython"
  Write-Host "Run: npm.cmd run voice:chattts:setup"
  exit 1
}

$env:PIP_CACHE_DIR = Join-Path $cachePath "pip"
$env:HF_HOME = Join-Path $cachePath "huggingface"
$env:HUGGINGFACE_HUB_CACHE = Join-Path $env:HF_HOME "hub"
$env:HF_HUB_DISABLE_XET = "1"
$env:HF_HUB_DISABLE_SYMLINKS_WARNING = "1"
$env:TORCH_HOME = Join-Path $cachePath "torch"
$env:TEMP = Join-Path $cachePath "tmp"
$env:TMP = Join-Path $cachePath "tmp"
$env:CHATTTS_HOST = "127.0.0.1"
$env:CHATTTS_PORT = "$Port"
$env:CHATTTS_REPO_DIR = $repoPath
$env:CHATTTS_SOURCE = "huggingface"

Write-Host "Starting ChatTTS helper on http://127.0.0.1:$Port/tts"
& $venvPython $serverPath
