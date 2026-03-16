@echo off
title F1 Telemetry App

cd /d "%~dp0"
set "BACKEND_DIR=%CD%\f1-telemetry-app\backend"
set "FRONTEND_DIR=%CD%\f1-telemetry-app\frontend"

echo ============================================
echo   F1 Telemetry Analysis App
echo ============================================
echo.

python --version
if errorlevel 1 goto :no_python

node --version
if errorlevel 1 goto :no_node

echo.

if exist "%BACKEND_DIR%\venv" goto :skip_venv
echo [1/4] Creating Python virtual environment...
python -m venv "%BACKEND_DIR%\venv"
if errorlevel 1 goto :venv_error
echo [2/4] Installing backend dependencies (first run, a few minutes)...
"%BACKEND_DIR%\venv\Scripts\pip.exe" install -r "%BACKEND_DIR%\requirements.txt"
if errorlevel 1 goto :pip_error
goto :venv_done
:skip_venv
echo [1/4] Backend venv found.
echo [2/4] Skipping install.
:venv_done

if exist "%FRONTEND_DIR%\node_modules" goto :skip_npm
echo [3/4] Installing frontend dependencies (first run, ~1 minute)...
pushd "%FRONTEND_DIR%"
npm install
popd
if errorlevel 1 goto :npm_error
goto :npm_done
:skip_npm
echo [3/4] Frontend node_modules found.
:npm_done

echo [4/4] Launching servers...
echo.

start "F1 Backend :8111" /d "%BACKEND_DIR%" cmd /k "call venv\Scripts\activate.bat && uvicorn main:app --host 0.0.0.0 --port 8111 --reload"
timeout /t 3 /nobreak >nul
start "F1 Frontend :3111" /d "%FRONTEND_DIR%" cmd /k "npm run dev"

echo ============================================
echo   Frontend : http://localhost:3111
echo   Backend  : http://localhost:8111
echo   API Docs : http://localhost:8111/docs
echo ============================================
echo.
echo Opening browser in 5 seconds...
timeout /t 5 /nobreak >nul
start "" "http://localhost:3111"
echo.
echo Close the Backend and Frontend windows to stop the servers.
pause
goto :eof

:no_python
echo [ERROR] Python not found. Install from https://www.python.org/downloads/
pause
goto :eof
:no_node
echo [ERROR] Node.js not found. Install from https://nodejs.org/
pause
goto :eof
:venv_error
echo [ERROR] Failed to create virtual environment.
pause
goto :eof
:pip_error
echo [ERROR] Failed to install backend packages.
pause
goto :eof
:npm_error
echo [ERROR] npm install failed.
pause
goto :eof
