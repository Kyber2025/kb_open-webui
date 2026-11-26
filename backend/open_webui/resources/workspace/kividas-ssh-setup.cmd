@echo off
setlocal DisableDelayedExpansion
title Kividas SSH Setup
set "KIVIDAS_SSH_SETUP_SELF=%~f0"
set "KIVIDAS_SSH_CONNECTION_FILE=%~1"
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -STA -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; try { $Text=[IO.File]::ReadAllText($env:KIVIDAS_SSH_SETUP_SELF); $Marker=':KIVIDAS_SSH_PAYLOAD'; $Payload=$Text.Substring($Text.LastIndexOf($Marker)+$Marker.Length).Trim(); $Script=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Payload)).TrimStart([char]0xFEFF); & ([ScriptBlock]::Create($Script)) -ConnectionFile $env:KIVIDAS_SSH_CONNECTION_FILE -PickConnectionFile } catch { Write-Host ('Setup failed: '+$_.Exception.Message) -ForegroundColor Red; exit 1 }"
set "KIVIDAS_SETUP_EXIT=%ERRORLEVEL%"
echo.
pause
exit /b %KIVIDAS_SETUP_EXIT%
:KIVIDAS_SSH_PAYLOAD
__KIVIDAS_POWERSHELL_BASE64__
