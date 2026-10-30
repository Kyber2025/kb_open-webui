# Kividas CLI installer for Windows (PowerShell 5+).
#   irm https://dl.kividas.com/cli/install.ps1 | iex
# Installs kividas.exe into %USERPROFILE%\.kividas\bin and adds it to the user PATH.
# Claude Code on Windows runs commands through Git Bash, so Git for Windows is checked too.
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
# Render the (UTF-8) messages below correctly on consoles that default to a legacy
# code page (Windows PowerShell 5.1 on zh-CN uses CP936). The script itself is
# served as text/plain; charset=utf-8 so `irm` decodes it as UTF-8.
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$base = if ($env:KIVIDAS_CDN) { $env:KIVIDAS_CDN } else { 'https://dl.kividas.com/cli' }
$home_ = if ($env:KIVIDAS_HOME) { $env:KIVIDAS_HOME } else { Join-Path $env:USERPROFILE '.kividas' }
$bin = Join-Path $home_ 'bin'
New-Item -ItemType Directory -Force -Path $bin | Out-Null

$manifest = Invoke-RestMethod -Uri "$base/latest.json" -UseBasicParsing
$ver = $manifest.launcher.version
$plat = 'windows-x64'
$art = $manifest.launcher.platforms.$plat
if (-not $ver -or -not $art) { throw "kividas: no Windows launcher in $base/latest.json" }
$dest = Join-Path $bin 'kividas.exe'
$tmp = "$dest.new"
Write-Host "kividas: installing launcher $ver ($plat) -> $dest"
Invoke-WebRequest -Uri $art.url -OutFile $tmp -UseBasicParsing
if ($art.sha256) {
  $got = (Get-FileHash -Algorithm SHA256 -Path $tmp).Hash.ToLower()
  if ($got -ne $art.sha256.ToLower()) { Remove-Item $tmp; throw "kividas: checksum mismatch for $($art.url)" }
}
if (Test-Path $dest) { Remove-Item $dest -Force }
Move-Item $tmp $dest

# User PATH (persistent) + current session.
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if (-not ($userPath -split ';' | Where-Object { $_ -eq $bin })) {
  [Environment]::SetEnvironmentVariable('Path', "$bin;$userPath", 'User')
  Write-Host "kividas: added $bin to the user PATH"
}
$env:Path = "$bin;$env:Path"

# Git for Windows check (Claude Code's shell on Windows).
$gitBash = @("$env:ProgramFiles\Git\bin\bash.exe", "${env:ProgramFiles(x86)}\Git\bin\bash.exe", "$env:LOCALAPPDATA\Programs\Git\bin\bash.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $gitBash) {
  Write-Host ''
  Write-Host '注意：未检测到 Git for Windows。Claude Code 在 Windows 上通过 Git Bash 执行命令，请安装：' -ForegroundColor Yellow
  Write-Host '  winget install --id Git.Git -e        （或 https://git-scm.com/download/win）' -ForegroundColor Yellow
}

Write-Host ''
Write-Host '安装完成。新开一个终端窗口，然后：'
Write-Host '  kividas login     # 用 proxy.kividas.com 的账号登录'
Write-Host '  kividas           # 进入 Claude Code 终端（首次会下载 Claude Code 本体）'
