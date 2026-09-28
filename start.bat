@echo off
chcp 65001 >nul
title IntExeBook
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

REM ============================================================
REM  IntExeBook launcher for Windows - just double-click this file.
REM  It tries (in order):
REM    0) portable Python auto-installed by us  .runtime\python
REM    1) ready-made desktop app  release\IntExeBook*.exe
REM    2) Electron from node_modules (if dependencies were installed)
REM    3) plain Node.js            launcher.js   (no install needed)
REM    4) system Python            server\app.py
REM    5) AUTOMATIC setup: downloads a small portable Python
REM       into ".runtime" (one-time, ~25 MB, no admin rights)
REM    6) last resort: open web\index.html in the browser (limited mode)
REM  Teachers don't need to know anything - everything is automatic.
REM ============================================================

set "BUNDLED_PY=%~dp0.runtime\python\python.exe"

REM -- 0) portable Python we auto-installed earlier? --------------
if exist "%BUNDLED_PY%" (
  echo Starting IntExeBook...
  echo Leave this window open while you use the app. Close it to stop.
  start "" http://127.0.0.1:8000
  "%BUNDLED_PY%" server\app.py --port 8000
  echo.
  echo The server stopped unexpectedly. Press any key to close.
  pause >nul
  exit /b 1
)

REM -- 1) packaged / ready-made desktop app ----------------------
if exist "release\IntExeBook.exe" (
  start "" "release\IntExeBook.exe"
  exit /b 0
)
if exist "release\" (
  for %%f in ("release\IntExeBook*.exe") do (
    start "" "%%~ff"
    exit /b 0
  )
)

REM -- 2) Electron already installed locally? --------------------
if exist "node_modules\electron\dist\electron.exe" (
  start "" "node_modules\electron\dist\electron.exe" "."
  exit /b 0
)

REM -- helper: is a working node.exe available? ------------------
set "NODE_EXE="
where node >nul 2>nul && set "NODE_EXE=node"
if not defined NODE_EXE (
  if exist "%ProgramFiles%\nodejs\node.exe"        set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
)
if not defined NODE_EXE (
  if exist "%ProgramFiles(x86)%\nodejs\node.exe"   set "NODE_EXE=%ProgramFiles(x86)%\nodejs\node.exe"
)
if not defined NODE_EXE (
  if exist "%LocalAppData%\Programs\nodejs\node.exe" set "NODE_EXE=%LocalAppData%\Programs\nodejs\node.exe"
)

REM -- 3) plain Node.js launcher (zero dependencies) -------------
if defined NODE_EXE (
  echo Starting IntExeBook with Node.js...
  echo Leave this window open while you use the app. Close it to stop.
  "%NODE_EXE%" launcher.js
  echo.
  echo The server stopped unexpectedly. Press any key to close.
  pause >nul
  exit /b 1
)

REM -- 4) Python server ------------------------------------------
set "PY="
where py >nul 2>nul && set "PY=py"
if not defined PY (
  where python >nul 2>nul && set "PY=python"
)
if defined PY (
  "%PY%" -c "import sys; sys.exit(0 if sys.version_info>=(3,8) else 1)" >nul 2>nul
  if not errorlevel 1 (
    echo Starting IntExeBook with Python...
    echo Leave this window open while you use the app. Close it to stop.
    start "" http://127.0.0.1:8000
    "%PY%" server\app.py --port 8000
    echo.
    echo The server stopped unexpectedly. Press any key to close.
    pause >nul
    exit /b 1
  )
)

REM -- 5) AUTOMATIC setup: download a portable Python once --------
echo No Node.js or Python found on this computer.
echo IntExeBook will now set itself up automatically - one moment...
call setup-runtime.bat
if errorlevel 1 (
  REM setup failed and already showed instructions - fall through
  REM to the limited browser mode as a last resort.
  goto :limited
)
echo Starting IntExeBook...
echo Leave this window open while you use the app. Close it to stop.
start "" http://127.0.0.1:8000
"%BUNDLED_PY%" server\app.py --port 8000
echo.
echo The server stopped unexpectedly. Press any key to close.
pause >nul
exit /b 1

REM -- 6) last resort: open the UI straight from disk ------------
:limited
start "" "%~dp0web\index.html"
timeout /t 5 >nul

cls
echo ============================================================
echo  IntExeBook needs a small runtime to work fully.
echo.
echo  The page that just opened in your browser runs in LIMITED
echo  mode: demo textbooks only, no .zip support.
echo.
echo  To get the full app, do ONE of these:
echo.
echo   A. Easiest - download the ready-made app:
echo      1. Go to https://github.com/Avokadiy/IntExeBook/releases
echo      2. Download IntExeBook-Setup.exe (or the portable .exe)
echo      3. Run it - nothing else to install.
echo.
echo   B. Install Node.js once (free, 2 minutes):
echo      1. Go to https://nodejs.org  - download the LTS version
echo      2. Install it with all the default options
echo      3. Double-click start.bat again. Done!
echo.
echo   C. Install Python once (free):
echo      1. Go to https://python.org/downloads
echo      2. Install, tick "Add python.exe to PATH"
echo      3. Double-click start.bat again. Done!
echo ============================================================
echo.
echo This window will close automatically in 60 seconds,
echo or press any key to close it now.
pause >nul
exit /b 0
