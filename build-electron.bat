@echo off
REM HiDock Meeting Intelligence - Build Script
setlocal
echo Building HiDock Meeting Intelligence...
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

REM Install/update dependencies
echo Installing dependencies...
REM Use npm ci for clean, reproducible installs from package-lock.json
REM Falls back to npm install if package-lock.json doesn't exist
if exist "package-lock.json" (
    call npm ci
) else (
    call npm install
)
if errorlevel 1 (
    echo.
    echo Failed to install dependencies.
    pause
    exit /b 1
)
echo Dependencies installed successfully.
echo.

echo.
echo ================================
echo Building Electron App
echo ================================
echo Compiling main process (backend) and renderer (frontend)...
echo.

REM Build the electron app (compiles both frontend and backend)
call npm run build

if errorlevel 1 (
    echo.
    echo Build failed. Please check the error messages above.
    pause
    exit /b 1
) else (
    echo.
    echo ================================
    echo Build completed successfully!
    echo ================================
    echo Output directory: apps\electron\out\
    echo   - Main process: out\main\
    echo   - Renderer: out\renderer\
    echo   - Preload: out\preload\
    echo.
)

pause
endlocal
