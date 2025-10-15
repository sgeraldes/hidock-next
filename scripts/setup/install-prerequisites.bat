@echo off
REM HiDock Next - Prerequisites Installer for Windows
REM This script can install Python and Node.js automatically

echo:
echo ========================================
echo   HiDock Next - Prerequisites Installer
echo ========================================
echo:
echo This script can automatically install:
echo - Python 3.12 (required)
echo - Node.js LTS (optional, for web apps)
echo:

REM Check if running as administrator
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo WARNING: Not running as administrator
    echo Some installations may require admin rights
    echo:
)

REM Check if winget is available (Windows 10 1709+ / Windows 11)
winget --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: winget not available
    echo:
    echo MANUAL INSTALLATION REQUIRED:
    echo 1. Python 3.12: https://python.org/downloads/
    echo 2. Node.js LTS: https://nodejs.org/
    echo:
    echo After installing, run: setup-windows.bat
    pause
    exit /b 1
)

echo Using Windows Package Manager (winget) for installation...
echo:

REM Check Python
echo [1/2] Checking Python 3.12...
py -3.12 --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Python 3.12 not found. Installing...
    winget install Python.Python.3.12 --accept-source-agreements --accept-package-agreements
    if %errorlevel% neq 0 (
        echo ERROR: Failed to install Python 3.12
        echo Please install manually from https://python.org/downloads/
        pause
        exit /b 1
    )
    echo Python 3.12 installed successfully!
    echo NOTE: You may need to restart your command prompt
) else (
    echo Python 3.12 already installed!
)

REM Check Node.js
echo:
echo [2/2] Checking Node.js...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Node.js not found. Installing...
    winget install OpenJS.NodeJS --accept-source-agreements --accept-package-agreements
    if %errorlevel% neq 0 (
        echo WARNING: Failed to install Node.js
        echo Web apps won't be available, but desktop app will work
        echo Install manually from https://nodejs.org/ if needed
    ) else (
        echo Node.js installed successfully!
    )
) else (
    echo Node.js already installed!
)

echo:
echo ========================================
echo Prerequisites installation complete!
echo ========================================
echo:
echo NEXT STEPS:
echo 1. Close this command prompt
echo 2. Open a new command prompt
echo 3. Run: setup-windows.bat
echo:
echo (The new command prompt is needed to refresh PATH)
echo:
pause