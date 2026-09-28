@echo off
chcp 65001 >nul
title IntExeBook - automatic runtime setup
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

REM ============================================================
REM  IntExeBook runtime bootstrapper (fully automatic).
REM  Called by start.bat when neither Node.js nor Python is found.
REM
REM  It downloads an OFFICIAL portable "embeddable" Python 3.12
REM  straight from python.org (about 11 MB) and unpacks it into
REM  ".runtime\python" INSIDE this app folder.
REM  Nothing is installed system-wide, no admin rights are needed.
REM  Requirements: Windows 10/11 (64-bit) + internet connection.
REM ============================================================

set "RT_DIR=%~dp0.runtime"
set "PY_DIR=%RT_DIR%\python"
set "PY_EXE=%PY_DIR%\python.exe"
set "ZIP_FILE=%RT_DIR%\python-embed.zip"

REM -- official embeddable Python builds (python.org FTP) ---------
set "URL_1=https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip"
set "URL_2=https://www.python.org/ftp/python/3.13.5/python-3.13.5-embed-amd64.zip"

echo.
echo  ----------------------------------------------------------
echo   IntExeBook needs to download a tiny free component
echo   (a portable Python, about 11 MB) so the app can run.
echo   This happens ONLY ONCE. No admin rights required.
echo  ----------------------------------------------------------
echo.

if not exist "%RT_DIR%" mkdir "%RT_DIR%"

REM -- already set up? just verify ---------------------------------
if exist "%PY_EXE%" (
    "%PY_EXE%" -c "import sys; sys.exit(0 if sys.version_info^(=(3,8)^) else 1)" >nul 2>nul
    if not errorlevel 1 goto :ready
    echo Existing portable Python looks broken - re-downloading...
    rmdir /s /q "%PY_DIR%" >nul 2>nul
)

REM -- 1) download the archive (certutil ships with Win10/11) ------
echo [1/2] Downloading portable Python (~11 MB)... please wait,
echo       do NOT close this window.
del "%ZIP_FILE%" >nul 2>nul
call :try_download "%URL_1%"
if exist "%ZIP_FILE%" goto :downloaded
echo       First attempt failed, trying a backup address...
timeout /t 3 /nobreak >nul
call :try_download "%URL_2%"
if not exist "%ZIP_FILE%" goto :no_download

:downloaded
for %%F in ("%ZIP_FILE%") do set "SZ=%%~zF"
if %SZ% LSS 3000000 (
    echo       The downloaded file seems incomplete ^(network problem^).
    del "%ZIP_FILE%" >nul 2>nul
    goto :no_download
)

REM -- 2) unpack ----------------------------------------------------
echo [2/2] Unpacking...
rmdir /s /q "%PY_DIR%" >nul 2>nul
mkdir "%PY_DIR%" >nul 2>nul
tar -xf "%ZIP_FILE%" -C "%PY_DIR%"
if errorlevel 1 goto :no_extract
if not exist "%PY_EXE%" goto :no_extract
del "%ZIP_FILE%" >nul 2>nul

:ready
"%PY_EXE%" -c "import sys; sys.exit(0 if sys.version_info^(=(3,8)^) else 1)" >nul 2>nul
if errorlevel 1 goto :broken
exit /b 0

REM ---- helper: download with certutil, then PowerShell ------------
:try_download
if exist "%ZIP_FILE%" exit /b 0
certutil -urlcache -split -f %1 "%ZIP_FILE%" >nul 2>nul
if exist "%ZIP_FILE%" exit /b 0
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%~1' -OutFile '%ZIP_FILE%' -UseBasicParsing } catch { exit 1 }" >nul 2>nul
exit /b 0

:no_download
echo.
echo  ==========================================================
echo   Could not download the component - most likely there is
echo   NO INTERNET CONNECTION on this computer right now.
echo.
echo   Check the cable / Wi-Fi and run start.bat again.
echo   If your office blocks downloads, install Node.js once:
echo   https://nodejs.org  (LTS version, default options),
echo   then run start.bat again.
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
