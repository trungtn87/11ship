@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp011ship-launcher.ps1" -Command Start %*
set "code=%errorlevel%"
exit /b %code%
