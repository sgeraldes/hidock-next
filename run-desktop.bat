@echo off
echo Starting HiDock Desktop Application...
echo.

@REM REM Navigate to project root (two levels up from scripts/run)
@REM cd /d "%~dp0\..\.."

REM Check if we're in the correct directory
if not exist "apps\desktop" (
    echo Error: apps\desktop directory not found!
    echo Make sure the hidock-next project structure is intact.
    echo Current directory: %CD%
    pause
    exit /b 1
)

REM Navigate to desktop app directory
cd apps\desktop

REM Check if virtual environment exists (Windows-specific .venv.win)
if not exist ".venv.win" (
    echo Error: Virtual environment not found!
    echo Please run setup first:
    echo   python setup.py
    echo or
    echo   setup-windows.bat
    pause
    exit /b 1
)

REM Activate the virtual environment
echo Activating virtual environment...
call .venv.win\Scripts\activate.bat
if errorlevel 1 (
    echo Error: Failed to activate virtual environment!
    echo Try running setup again: setup-windows.bat
    pause
    exit /b 1
)

echo Checking if main.py exists...
if not exist "main.py" (
    echo Error: main.py not found in hidock-desktop-app directory!
    pause
    exit /b 1
)

echo Launching HiDock Desktop Application...
echo.
echo ================================
echo HiDock Desktop Application
echo ================================
echo.
echo To stop the application, close the GUI window or press Ctrl+C here.
echo.

echo Set UTF-8 encoding to handle emoji characters
set PYTHONIOENCODING=utf-8

REM Use Python from the activated virtual environment
python main.py

REM Keep window open if there's an error
if errorlevel 1 (
    echo.
    echo Application exited with an error.
    pause
)