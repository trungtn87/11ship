@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp011ship-app-launch.ps1" -App Food
exit /b %errorlevel%
