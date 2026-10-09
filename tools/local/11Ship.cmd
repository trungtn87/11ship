@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp011ship-launcher.ps1" -Command Menu
set "code=%errorlevel%"
if not "%code%"=="0" pause
exit /b %code%
