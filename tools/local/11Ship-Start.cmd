@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp011ship-launcher.ps1" -Command Start %*
set "code=%errorlevel%"
if not "%code%"=="0" pause
exit /b %code%
