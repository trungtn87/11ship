@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp011ship-app-launch.ps1" -App Ship
exit /b %errorlevel%
