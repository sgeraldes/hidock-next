@echo off
REM setlocal enabledelayedexpansion
REM HiDock Next - Windows Setup Script
REM Creates Windows-specific virtual environment (per-platform naming via selector)
REM Double-click this file to set up HiDock apps

echo:
echo ================================
echo   HiDock Next - Quick Setup
echo ================================
echo:
echo This will set up HiDock apps for immediate use.
echo:
pause

REM Ensure we're in the correct directory
if not exist "apps\desktop" goto dirfail

echo:
echo [1/4] Checking Python 3.12...
py -3.12 --version >nul 2>&1
if errorlevel 1 goto pyfail
echo Python 3.12 found!
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
pause
exit /b 1

:afterpy

echo:
echo [2/4] Setting up Desktop App...
REM Resolve per-platform venv path (will not create yet)
for /f "usebackq delims=" %%I in (`python scripts\env\select_venv.py --print`) do set VENV_PATH=%%I
if not defined VENV_PATH (
    echo Resolving environment path ^(creating^)...
    for /f "usebackq delims=" %%I in (`python scripts\env\select_venv.py --ensure --print`) do set VENV_PATH=%%I
)
if not defined VENV_PATH (
    echo ERROR: Could not resolve/create virtual environment.
    echo Run manually: python scripts\env\select_venv.py --ensure --print
    pause
    exit /b 1
)

echo Using environment: %VENV_PATH%
if not exist "%VENV_PATH%" (
    echo Creating environment directory...
    python scripts\env\select_venv.py --ensure || goto venvfail
)

REM Determine python inside venv
set VENV_PY=%VENV_PATH%\Scripts\python.exe
if not exist "%VENV_PY%" (
    echo ERROR: python.exe not found in %VENV_PATH%\Scripts
    goto venvfail
)

echo Upgrading pip and build tools...
"%VENV_PY%" -m pip install --upgrade pip setuptools wheel >nul 2>&1
if errorlevel 1 (
    echo WARNING: pip/setuptools/wheel upgrade failed (continuing)
)

echo Installing desktop dependencies (editable with dev extras)...
"%VENV_PY%" -m pip install -e "apps/desktop[dev]"
if errorlevel 1 goto depfail

echo Desktop app setup complete!

echo:
echo [3/4] Checking Node.js for Web Apps...
node --version >nul 2>&1
if errorlevel 1 goto njsfail
echo Node.js found! Setting up web apps...
echo.
echo Setting up HiDock Web App...
cd apps\web
if errorlevel 1 goto webfail
call npm install --silent
if errorlevel 1 (
    echo WARNING: Web app setup failed
) else (
    echo Web app setup complete!
)
cd ..\..
echo.
echo Setting up Audio Insights Extractor...
cd apps\audio-insights
if errorlevel 1 goto audiofail
call npm install --silent
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

:dirfail
echo ERROR: Cannot find apps\desktop directory!
echo Please run this script from the hidock-next root directory.
echo.
pause
exit /b 1

:navfail
echo ERROR: Failed to navigate to apps\desktop directory!
echo Make sure you're running this from the hidock-next root directory.
pause
exit /b 1

:venvfail
echo ERROR: Failed to create virtual environment!
echo Make sure Python 3.12 is properly installed.
pause
exit /b 1

:depfail
echo.
echo ERROR: Failed to install dependencies!
echo Check your internet connection and try again.
echo You may also try running: .venv.win\Scripts\pip install -e "." (without dev deps)
echo.
pause
exit /b 1

:webfail
echo WARNING: Failed to navigate to apps\web - skipping web app setup
cd ..\..
goto afterweb

:audiofail
echo WARNING: Failed to navigate to apps\audio-insights - skipping
cd ..\..
goto afterweb

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
echo ADVANCED SETUP: Run "python setup.py" for comprehensive configuration
echo:
echo:
echo Enjoy using HiDock!
echo:
pause
