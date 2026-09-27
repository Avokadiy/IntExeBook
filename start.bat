@echo off
REM ============================================================
REM  IntExeBook launcher for Windows
REM  Double-click to start the app and open it in your browser.
REM ============================================================
cd /d "%~dp0"

where python >nul 2>nul
if %errorlevel%==0 (set PY=python) else (set PY=py)

%PY% -c "import sys; sys.exit(0 if sys.version_info>=(3,8) else 1)" 2>nul
if errorlevel 1 (
  echo Python 3.8+ is required. Install it from https://www.python.org/downloads/
  pause
  exit /b 1
)

start "" http://localhost:8000
%PY% server\app.py --port 8000
pause
