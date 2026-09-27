@echo off
REM ============================================================
REM  IntExeBook launcher for Windows - just double-click this file.
REM  It tries (in order): Electron desktop app -> Python server ->
REM  plain browser mode.  Nothing has to be installed by you.
REM ============================================================
title IntExeBook
cd /d "%~dp0"

REM -- 1) packaged / ready-made desktop app --------------------------
if exist "release\IntExeBook*.exe" (
  for %%f in ("release\IntExeBook*.exe") do start "" "%%~ff"
  exit /b 0
)
if exist "node_modules\electron\dist\electron.exe" (
  start "" "node_modules\electron\dist\electron.exe" "."
  exit /b 0
)

REM -- 2) Python server (if Python happens to be installed) ---------
where python >nul 2>nul
if %errorlevel%==0 (set PY=python) else (set PY=py)
%PY% -c "import sys; sys.exit(0 if sys.version_info>=(3,8) else 1)" 2>nul
if not errorlevel 1 (
  start "" http://localhost:8000
  %PY% server\app.py --port 8000
  pause
  exit /b 0
)

REM -- 3) no Python? open the app straight in the default browser ---
start "" "%~dp0web\index.html"
exit /b 0
