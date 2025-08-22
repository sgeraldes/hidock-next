@echo off
echo Starting HiDock Desktop Application...
echo.

REM Check if we're in the correct directory
if not exist "hidock-desktop-app" (
    echo Error: hidock-desktop-app directory not found!
    echo Make sure you're running this from the hidock-next root directory.
    pause
    exit /b 1
)

REM Navigate to desktop app directory
cd hidock-desktop-app

REM Check if virtual environment exists
if not exist ".venv" (
    echo Error: Virtual environment not found!
    echo Please run setup first:
    echo   python setup.py
    echo or
    echo   setup-windows.bat
    pause
    exit /b 1
)

REM Check which type of virtual environment we have
if exist ".venv\Scripts\activate.bat" (
    echo Activating Windows virtual environment...
    call .venv\Scripts\activate.bat
) else if exist ".venv\bin\activate" (
    echo Detected Unix-style virtual environment in Windows.
    echo Using Python directly from .venv/bin/python
    set "PYTHON_EXE=.venv/bin/python"
) else (
    echo Error: Virtual environment activation script not found!
    echo Virtual environment appears corrupted.
    echo Please run setup again:
    echo   python setup.py
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

REM Set UTF-8 encoding to handle emoji characters
set PYTHONIOENCODING=utf-8

REM Use the appropriate Python executable
if defined PYTHON_EXE (
    "%PYTHON_EXE%" main.py
) else (
    echo Trying python3...
    python3 main.py
    if errorlevel 1 (
        echo python3 failed, trying python...
        python main.py
    )
)

REM Keep window open if there's an error
if errorlevel 1 (
    echo.
    echo Application exited with an error.
    pause
)