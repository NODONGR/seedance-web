@echo off
setlocal
cd /d "%~dp0"
title Seedance 2.0 Local

echo ============================================
echo   Seedance 2.0 Local - starting server...
echo ============================================
echo.

if not exist ".venv\Scripts\python.exe" (
    echo [ERROR] .venv not found.
    echo.
    echo   Run setup.bat first to create the virtual environment
    echo   and install dependencies.
    echo.
    pause
    exit /b 1
)

if not exist ".env" (
    echo [WARN] .env not found - the server will fail without ARK_API_KEY.
    echo        Copy .env.example to .env and fill in ARK_API_KEY, then re-run.
    echo.
)

echo URL: http://127.0.0.1:8000
echo (close this window to stop the server)
echo.

REM open browser after a short delay so uvicorn has time to bind the port
start "" /b cmd /c "timeout /t 2 /nobreak >nul & start """" http://127.0.0.1:8000"

".venv\Scripts\python.exe" -m uvicorn main:app --host 127.0.0.1 --port 8000
if errorlevel 1 (
    echo.
    echo [ERROR] Server failed to start. If dependencies are missing, run setup.bat again.
    echo.
    pause
)
endlocal
