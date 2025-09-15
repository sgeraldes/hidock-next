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
    REM Resolve per-platform virtual environment using selector
    setlocal ENABLEDELAYEDEXPANSION
    for /f "usebackq delims=" %%I in (`python scripts\env\select_venv.py --print 2^>nul`) do set VENV_PATH=%%I

    if not defined VENV_PATH (
        echo Could not determine virtual environment path. Attempting to create...
        for /f "usebackq delims=" %%I in (`python scripts\env\select_venv.py --ensure --print 2^>nul`) do set VENV_PATH=%%I
    )

    if not defined VENV_PATH (
        echo Error: Failed to resolve virtual environment path.
        echo Run: python scripts\env\select_venv.py --ensure --print
        pause
        exit /b 1
    )

    if not exist "%VENV_PATH%" (
        echo Creating virtual environment at: %VENV_PATH%
        python scripts\env\select_venv.py --ensure >nul
    )

    REM Legacy migration warning
    if exist "apps\desktop\.venv" if not exist "%VENV_PATH%" (
        echo Detected legacy apps\desktop\.venv directory.
        echo New per-platform environments are documented in docs\VENV.md
    )

    REM Activate environment
    set ACTIVATE_PATH=%VENV_PATH%\Scripts\activate.bat
    if exist "%ACTIVATE_PATH%" (
        echo Activating environment: %VENV_PATH%
        call "%ACTIVATE_PATH%"
    ) else (
        echo Error: Activation script not found at %ACTIVATE_PATH%
        echo Environment may be corrupted. Recreating...
        python scripts\env\select_venv.py --ensure >nul
        if exist "%ACTIVATE_PATH%" (
            call "%ACTIVATE_PATH%"
        ) else (
            echo Failed to activate environment.
            echo See docs\VENV.md for manual recovery steps.
            pause
            exit /b 1
        )
    )

    REM Navigate to desktop app directory after activation (PYTHONPATH unaffected)
    cd apps\desktop
    echo   setup-windows.bat
    echo or
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
endlocal