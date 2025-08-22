@echo off
echo Starting HiDock Web Application...
echo.

REM Check if we're in the correct directory
if not exist "hidock-web-app" (
    echo Error: hidock-web-app directory not found!
    echo Make sure you're running this from the hidock-next root directory.
    pause
    exit /b 1
)

REM Navigate to web app directory
cd hidock-web-app

REM Check if node_modules exists
if not exist "node_modules" (
    echo Error: Node modules not found!
    echo Please run setup first:
    echo   python setup.py
    echo or
    echo   setup-windows.bat
    echo.
    echo Or install manually:
    echo   npm install
    pause
    exit /b 1
)

REM Check if package.json exists
if not exist "package.json" (
    echo Error: package.json not found in hidock-web-app directory!
    pause
    exit /b 1
)

echo Starting development server...
echo.
echo ================================
echo HiDock Web Application
echo ================================
echo.
echo The web application will open in your default browser.
echo Server will run on: http://localhost:5173
echo.
echo To stop the server, press Ctrl+C in this window.
echo.
echo Note: For device connection, you need:
echo - Chrome, Edge, or Opera browser (WebUSB support)
echo - HTTPS connection (may require additional setup for local dev)
echo.

npm run dev

REM Keep window open if there's an error
if errorlevel 1 (
    echo.
    echo Development server exited with an error.
    echo Common issues:
    echo - Node.js not installed or wrong version
    echo - Dependencies not installed (run: npm install)
    echo - Port 5173 already in use
    pause
)