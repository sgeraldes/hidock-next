@echo off
setlocal
echo Starting HiDock Meeting Intelligence...
echo.

REM Navigate to script directory (project root)
cd /d "%~dp0"

REM Check if electron app directory exists
if not exist "apps\electron" (
    echo Error: apps\electron directory not found!
    echo Make sure the hidock-next project structure is intact.
    echo Current directory: %CD%
    pause
    exit /b 1
)

REM Navigate to electron app directory
cd apps\electron

REM Check if node_modules exists
if not exist "node_modules" (
    echo Node modules not found. Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo.
        echo Failed to install dependencies.
        pause
        exit /b 1
    )
)

echo.
echo ================================
echo HiDock Meeting Intelligence
echo ================================
echo.
echo To stop the application, close the window or press Ctrl+C here.
echo.

REM Run the electron app in development mode
call npm run dev

REM Keep window open if there's an error
if errorlevel 1 (
    echo.
    echo Application exited with an error.
    pause
)
endlocal
