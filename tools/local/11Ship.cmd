@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp011ship-launcher.ps1" -Command Menu
set "code=%errorlevel%"
exit /b %code%
