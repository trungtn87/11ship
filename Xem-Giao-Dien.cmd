@echo off
rem Mo ban xem giao dien (du lieu minh hoa, khong ket noi may chu). Nhan dup chuot file nay.
cd /d "%~dp0"
where node >nul 2>nul || (echo Can cai Node.js truoc. & pause & exit /b 1)
node scripts\ui-preview.mjs --open
pause
