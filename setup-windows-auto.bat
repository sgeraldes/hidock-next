@echo off
setlocal enabledelayedexpansion
REM HiDock Next - Automated Windows Setup (no pauses)

echo:
echo ================================
echo   HiDock Next - Quick Setup
echo ================================
echo:
echo This will set up HiDock apps for immediate use.
echo:

echo:
echo [1/4] Checking Python 3.12...
py -3.12 --version >nul 2>&1
if errorlevel 1 goto pyfail
echo Python 3.12 found!
for /f "tokens=2" %%i in ('py -3.12 --version 2^>^&1') do set PYTHON_VERSION=%%i
echo Using Python %PYTHON_VERSION%
goto afterpy

:pyfail
echo ERROR: Python 3.12 not found!
echo.
echo HiDock requires Python 3.12 for optimal compatibility.
echo.
echo INSTALL PYTHON 3.12:
echo 1. Go to: https://python.org/downloads/
echo 2. Download Python 3.12.x for Windows
echo 3. Run installer and CHECK "Add Python to PATH"
echo 4. Restart this script
echo.
echo Available Python versions on your system:
py -0 2>nul || echo   (None found - please install Python)
echo.
exit /b 1

:afterpy

echo:
echo [2/4] Setting up Desktop App...
REM Resolve per-platform venv path
for /f "usebackq delims=" %%I in (`py -3.12 scripts\env\select_venv.py --print`) do set VENV_PATH=%%I
if not defined VENV_PATH (
    echo Creating environment...
    for /f "usebackq delims=" %%I in (`py -3.12 scripts\env\select_venv.py --ensure --print`) do set VENV_PATH=%%I
)
if not defined VENV_PATH (
    echo ERROR: Could not resolve/create virtual environment.
    exit /b 1
)

echo Using environment: %VENV_PATH%
if not exist "%VENV_PATH%" (
    py -3.12 scripts\env\select_venv.py --ensure || goto venvfail
)

REM Determine python inside venv
set VENV_PY=%VENV_PATH%\Scripts\python.exe
if not exist "%VENV_PY%" (
    echo ERROR: python.exe not found in %VENV_PATH%\Scripts
    goto venvfail
)

echo Upgrading pip and installing build tools...
"%VENV_PY%" -m pip install --upgrade pip setuptools wheel >nul 2>&1

echo Installing dependencies (this may take a few minutes)...
"%VENV_PY%" -m pip install --only-binary :all: pygame pillow numpy scipy 2>nul
"%VENV_PY%" -m pip install -e "apps/desktop[dev]"
if errorlevel 1 goto depfail

echo Desktop app setup complete!

echo:
echo [3/4] Checking Node.js for Web Apps...
node --version >nul 2>&1
if errorlevel 1 goto njsfail
echo Node.js found! Setting up web apps...
echo Setting up HiDock Web App...
cd apps\web
call npm install
if errorlevel 1 (
    echo WARNING: Web app setup failed
) else (
    echo Web app setup complete!
)
cd ..\..
echo Setting up Audio Insights Extractor...
cd apps\audio-insights
call npm install
if errorlevel 1 (
    echo WARNING: Audio Insights Extractor setup failed
) else (
    echo Audio Insights Extractor setup complete!
)
cd ..\..
goto afterweb

:njsfail
echo Node.js not found - skipping web apps setup
echo.
echo OPTIONAL: Install Node.js for Web Apps
echo 1. Go to: https://nodejs.org/
echo 2. Download LTS version (18+)
echo 3. Run installer with default settings
echo 4. Restart this script to set up web apps
echo.
echo (Desktop app will work without Node.js)
echo.

:afterweb
goto end

:venvfail
echo ERROR: Failed to create virtual environment!
echo Make sure Python 3.12 is properly installed.
exit /b 1

:depfail
echo.
echo ERROR: Failed to install dependencies!
echo Check your internet connection and try again.
echo.
echo TROUBLESHOOTING:
echo   1. Make sure you have Python 3.12 (not 3.14 or other versions)
echo   2. Try running: %VENV_PATH%\Scripts\pip install -e "apps\desktop" (without dev deps)
echo   3. Check internet connection
echo.
exit /b 1

:end

echo:
echo [4/4] Setup Complete!
echo ================================
echo:
echo HOW TO RUN:
echo:
echo Desktop App:
echo   1. cd apps\desktop
echo   2. %VENV_PATH%\Scripts\activate
echo   3. python main.py
echo:
echo Web App (if Node.js installed):
echo   1. cd apps\web
echo   2. npm run dev
echo   3. Open: http://localhost:5173
echo:
echo FIRST TIME TIPS:
echo - Configure AI providers in app Settings for transcription
echo - Connect your HiDock device via USB
echo - Check README.md and docs/TROUBLESHOOTING.md for help
echo:
echo NEED MORE? Run: python setup.py (comprehensive setup)
echo:
echo Enjoy using HiDock! 🎵
echo: