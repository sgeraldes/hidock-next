@echo off
REM HiDock Next - Simple Windows Setup
REM Double-click this file to set up HiDock apps

echo:
echo ================================
echo   HiDock Next - Quick Setup
echo ================================
echo:
echo This will set up HiDock apps for immediate use.
echo:
pause

echo:
echo [1/4] Checking Python...
py -3.12 --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Python 3.12 not found!
    echo:
    echo HiDock requires Python 3.12 for optimal compatibility.
    echo:
    echo INSTALL PYTHON 3.12:
    echo 1. Go to: https://python.org/downloads/
    echo 2. Download Python 3.12.x for Windows
    echo 3. Run installer and CHECK "Add Python to PATH"
    echo 4. Restart this script
    echo:
    echo Available Python versions on your system:
    py -0 2>nul || echo   (None found - please install Python)
    echo:
    pause
    exit /b 1
) else (
    echo Python 3.12 found!
)

echo:
echo [2/4] Setting up Desktop App...
cd hidock-desktop-app
if not exist .venv (
    echo Creating Python environment...
    py -3.12 -m venv .venv
)

echo Upgrading pip and installing build tools...
.venv\Scripts\python -m pip install --upgrade pip setuptools wheel

echo Installing dependencies (this may take a few minutes)...
.venv\Scripts\pip install -e ".[dev]"
if %errorlevel% neq 0 (
    echo:
    echo ERROR: Failed to install dependencies!
    echo Check your internet connection and try again.
    echo:
    pause
    exit /b 1
)

echo Desktop app setup complete!

cd ..

echo:
echo [3/4] Checking Node.js for Web Apps...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Node.js not found - skipping web apps setup
    echo:
    echo OPTIONAL: Install Node.js for Web Apps
    echo 1. Go to: https://nodejs.org/
    echo 2. Download LTS version (18+)
    echo 3. Run installer with default settings
    echo 4. Restart this script to set up web apps
    echo:
    echo (Desktop app will work without Node.js)
    echo:
) else (
    echo Node.js found! Setting up web apps...

    echo Setting up HiDock Web App...
    cd hidock-web-app
    call npm install
    if %errorlevel% neq 0 (
        echo WARNING: Web app setup failed
    ) else (
        echo Web app setup complete!
    )
    cd ..

    echo Setting up Audio Insights Extractor...
    cd audio-insights-extractor
    call npm install
    if %errorlevel% neq 0 (
        echo WARNING: Audio Insights Extractor setup failed
    ) else (
        echo Audio Insights Extractor setup complete!
    )
    cd ..
)

echo:
echo [4/4] Setup Complete!
echo ================================
echo:
echo HOW TO RUN:
echo:
echo Desktop App:
echo   1. cd hidock-desktop-app
echo   2. .venv\Scripts\activate
echo   3. python main.py
echo:
echo Web App (if Node.js installed):
echo   1. cd hidock-web-app
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
pause
