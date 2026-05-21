@echo off
setlocal
cd /d "%~dp0"
title Seedance 2.0 Local - setup

echo ============================================
echo   Seedance 2.0 Local - one-time setup
echo ============================================
echo.

REM --- 1. locate a Python interpreter --------------------------------------
set "PYCMD="
where py >nul 2>nul
if %errorlevel%==0 (
    py -3 -c "import sys; assert sys.version_info >= (3,10)" >nul 2>nul
    if %errorlevel%==0 set "PYCMD=py -3"
)
if "%PYCMD%"=="" (
    where python >nul 2>nul
    if %errorlevel%==0 (
        python -c "import sys; assert sys.version_info >= (3,10)" >nul 2>nul
        if %errorlevel%==0 set "PYCMD=python"
    )
)

if "%PYCMD%"=="" (
    echo [ERROR] Python 3.10+ not found.
    echo.
    echo   Install Python from https://www.python.org/downloads/
    echo   During install, check "Add python.exe to PATH" and "py launcher".
    echo.
    pause
    exit /b 1
)

echo Using Python: %PYCMD%
%PYCMD% --version
echo.

REM --- 2. create .venv if missing (or rebuild if broken) -------------------
set "VENV_OK="
if exist ".venv\Scripts\python.exe" (
    REM verify the stub still resolves to a real interpreter on this machine
    ".venv\Scripts\python.exe" -c "import sys" >nul 2>nul
    if not errorlevel 1 set "VENV_OK=1"
)

if defined VENV_OK (
    echo [OK] .venv already exists and is functional - reusing it.
) else (
    if exist ".venv\" (
        echo [WARN] Existing .venv is broken ^(likely copied from another PC^).
        echo        Removing it and creating a fresh one ...
        rmdir /s /q ".venv"
    )
    echo Creating virtual environment in .venv ...
    %PYCMD% -m venv .venv
    if errorlevel 1 (
        echo [ERROR] Failed to create .venv.
        pause
        exit /b 1
    )
)
echo.

REM --- 3. install dependencies inside .venv --------------------------------
echo Upgrading pip ...
".venv\Scripts\python.exe" -m pip install --upgrade pip
echo.
echo Installing dependencies from requirements.txt ...
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 (
    echo.
    echo [ERROR] pip install failed. Check your internet connection and retry.
    pause
    exit /b 1
)
echo.

REM --- 4. .env scaffold ----------------------------------------------------
if not exist ".env" (
    if exist ".env.example" (
        copy /y ".env.example" ".env" >nul
        echo [OK] Created .env from .env.example - open it and set ARK_API_KEY.
    )
) else (
    echo [OK] .env already exists - leaving it untouched.
)
echo.

echo ============================================
echo   Setup complete.
echo   1) Edit .env and set ARK_API_KEY
echo   2) Double-click run.bat to start the server
echo ============================================
echo.
pause
endlocal
