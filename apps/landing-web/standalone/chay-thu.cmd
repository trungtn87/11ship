@echo off
cd /d "%~dp0"
node build.mjs && node serve.mjs
