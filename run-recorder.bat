@echo off
setlocal
cd /d "%~dp0"

if not exist "apps\meeting-recorder" (
    echo Error: apps\meeting-recorder directory not found!
    pause
    exit /b 1
)

cd apps\meeting-recorder

if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo Failed to install dependencies.
        pause
        exit /b 1
    )
)

call npm run dev

if errorlevel 1 (
    echo Application exited with an error.
    pause
)
endlocal
