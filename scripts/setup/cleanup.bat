@echo off
REM HiDock Next - Cleanup Script for Testing
REM Removes all build artifacts and dependencies for fresh testing

echo.
echo ================================
echo   HiDock Next - Cleanup Script
echo ================================
echo.
echo This will remove all build artifacts and dependencies.
echo Use this before testing setup scripts.
echo.
pause

REM Navigate to project root (two levels up from scripts/setup)
cd /d "%~dp0\..\.."

echo.
echo Cleaning up Desktop App...
cd hidock-desktop-app
if exist .venv (
    echo Removing Python virtual environment...
    rmdir /s /q .venv
    echo Python venv removed
) else (
    echo No .venv found
)

if exist __pycache__ (
    echo Removing Python cache...
    rmdir /s /q __pycache__
    echo Python cache removed
)

for /d %%i in (*__pycache__*) do (
    if exist "%%i" (
        echo Removing %%i...
        rmdir /s /q "%%i"
    )
)

if exist *.pyc (
    echo Removing .pyc files...
    del /q *.pyc
)

cd ..

echo.
echo Cleaning up Web App...
cd hidock-web-app
if exist node_modules (
    echo Removing node_modules...
    rmdir /s /q node_modules
    echo node_modules removed
) else (
    echo No node_modules found
)

if exist package-lock.json (
    echo Removing package-lock.json...
    del /q package-lock.json
    echo package-lock.json removed
) else (
    echo No package-lock.json found
)

if exist dist (
    echo Removing dist folder...
    rmdir /s /q dist
    echo dist removed
)

if exist .vite (
    echo Removing .vite cache...
    rmdir /s /q .vite
    echo vite cache removed
)

cd ..

echo.
echo Cleaning up Audio Insights Extractor...
cd audio-insights-extractor
if exist node_modules (
    echo Removing node_modules...
    rmdir /s /q node_modules
    echo node_modules removed
) else (
    echo No node_modules found
)

if exist package-lock.json (
    echo Removing package-lock.json...
    del /q package-lock.json
    echo package-lock.json removed
) else (
    echo No package-lock.json found
)

if exist dist (
    echo Removing dist folder...
    rmdir /s /q dist
    echo dist removed
)

if exist .vite (
    echo Removing .vite cache...
    rmdir /s /q .vite
    echo vite cache removed
)

cd ..

echo.
echo Cleanup Complete!
echo.
echo All build artifacts and dependencies removed.
echo Ready for fresh setup testing.
echo.
pause
