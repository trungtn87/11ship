@echo off
setlocal
chcp 65001 >nul
rem 11Ship test OTP inbox reader (M01.22): read-only, double-click friendly.
rem Keeps the window open only when started by a double-click (or SHIP11_NO_PAUSE is not 1 there).
set "DBL=0"
echo %cmdcmdline% | find /i "%~nx0" >nul && set "DBL=1"
where node >nul 2>nul
if errorlevel 1 (
  echo Khong tim thay Node.js. Cai Node.js theo .node-version roi thu lai.
  set "code=1"
  goto finish
)
pushd "%~dp0..\.."
node scripts\test-sms-inbox.mjs
set "code=%errorlevel%"
popd
:finish
if "%DBL%"=="1" if not "%SHIP11_NO_PAUSE%"=="1" (
  echo.
  pause
)
exit /b %code%
