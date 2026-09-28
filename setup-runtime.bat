@echo off
chcp 65001 >nul
title IntExeBook - automatic runtime setup
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

REM ============================================================
REM  IntExeBook runtime bootstrapper (fully automatic).
REM  Called by start.bat when neither Node.js nor Python is found.
REM  It downloads a small PORTABLE, UNOFFICIAL build of Python 3.12
REM  from the official python-build-standalone project and unpacks
REM  it into ".runtime\python" INSIDE this app folder.
REM  Nothing is installed system-wide, no admin rights are needed.
REM  Requirements: Windows 10/11 x64 + internet connection.
REM ============================================================

set "RT_DIR=%~dp0.runtime"
set "PY_DIR=%RT_DIR%\python"
set "PY_EXE=%PY_DIR%\python.exe"
set "ZIP_FILE=%RT_DIR%\python-portable.zip"

set "PY_URL=https://github.com/astral-sh/python-build-standalone/releases/download/20250603/cpython-3.12.11+20250603-x86_64-pc-windows-msvc-install_only.tar.gz"
set "VCRUN_URL=https://github.com/HeyOnIj/web-based/raw/master/vcruntime140.dll"

echo.
echo  ----------------------------------------------------------
echo   IntExeBook needs to download a tiny free component
echo   (a portable Python, about 25 MB) so the app can run.
echo   This happens ONLY ONCE. No admin rights required.
echo  ----------------------------------------------------------
echo.

if not exist "%RT_DIR%" mkdir "%RT_DIR%"

REM -- already set up? just verify ---------------------------------
if exist "%PY_EXE%" (
    "%PY_EXE%" -c "import sys; sys.exit(0 if sys.version_info>=(3,9) else 1)" >nul 2>nul
    if not errorlevel 1 goto :ready
    echo Existing portable Python looks broken - re-downloading...
    rmdir /s /q "%PY_DIR%" >nul 2>nul
)

REM -- 1) download the archive (certutil works on every Win10/11) --
echo [1/3] Downloading portable Python (~25 MB)... please wait,
echo       do NOT close this window.
del "%ZIP_FILE%" >nul 2>nul
certutil -urlcache -split -f "%PY_URL%" "%ZIP_FILE%" >nul 2>nul
if exist "%ZIP_FILE%" goto :downloaded
echo       First download attempt failed, trying again...
timeout /t 3 /nobreak >nul
certutil -urlcache -split -f "%PY_URL%" "%ZIP_FILE%" >nul 2>nul
if not exist "%ZIP_FILE%" goto :no_download

:downloaded
for %%F in ("%ZIP_FILE%") do set "SZ=%%~zF"
if %SZ% LSS 5000000 (
    echo       The downloaded file seems incomplete ^(network problem^).
    del "%ZIP_FILE%" >nul 2>nul
    goto :no_download
)

REM -- 2) unpack ---------------------------------------------------
echo [2/3] Unpacking...
rmdir /s /q "%PY_DIR%" >nul 2>nul
tar -xf "%ZIP_FILE%" -C "%RT_DIR%"
if errorlevel 1 goto :no_extract
if not exist "%PY_EXE%" goto :no_extract
del "%ZIP_FILE%" >nul 2>nul

REM -- 3) some bare Windows lack vcruntime140.dll ------------------
echo [3/3] Finalizing...
"%PY_EXE%" -c "import sys" >nul 2>nul
if errorlevel 1 (
    if not exist "%PY_DIR%\vcruntime140.dll" (
        certutil -urlcache -split -f "%VCRUN_URL%" "%PY_DIR%\vcruntime140.dll" >nul 2>nul
    )
)

:ready
"%PY_EXE%" -c "import sys; sys.exit(0 if sys.version_info>=(3,9) else 1)" >nul 2>nul
if errorlevel 1 goto :broken
exit /b 0

:no_download
echo.
echo  ==========================================================
echo   Could not download the component - most likely there is
echo   NO INTERNET CONNECTION on this computer right now.
echo.
echo   Check the cable / Wi-Fi and run start.bat again.
echo   If the office blocks downloads, install Node.js manually:
echo   https://nodejs.org  (LTS version, default options).
echo  ==========================================================
pause
exit /b 1

:no_extract
echo.
echo  ==========================================================
echo   Could not unpack the downloaded file. Try running
echo   start.bat once more. If it keeps failing, install
echo   Node.js from https://nodejs.org and start.bat again.
echo  ==========================================================
pause
exit /b 1

:broken
echo.
echo  ==========================================================
echo   The portable Python was set up but does not work on this
echo   Windows version. Please install Node.js instead:
echo   https://nodejs.org  (LTS version, default options),
echo   then run start.bat again.
echo  ==========================================================
pause
exit /b 1
