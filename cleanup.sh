#!/bin/bash
# HiDock Next - Cleanup Script for Testing
# Removes all build artifacts and dependencies for fresh testing

echo ""
echo "================================"
echo "   HiDock Next - Cleanup Script"
echo "================================"
echo ""
echo "This will remove all build artifacts and dependencies."
echo "Use this before testing setup scripts."
echo ""
read -p "Press Enter to continue..."

echo ""
echo "Cleaning up Desktop App..."
cd hidock-desktop-app

if [ -d ".venv" ]; then
    echo "Removing Python virtual environment..."
    rm -rf .venv
    echo "✓ .venv removed"
else
    echo "ℹ️  No .venv found"
fi

if [ -d "__pycache__" ]; then
    echo "Removing Python cache..."
    rm -rf __pycache__
    echo "✓ __pycache__ removed"
fi

# Remove all __pycache__ directories recursively
find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true

# Remove .pyc files
find . -name "*.pyc" -delete 2>/dev/null || true

cd ..

echo ""
echo "Cleaning up Web App..."
cd hidock-web-app

if [ -d "node_modules" ]; then
    echo "Removing node_modules..."
    rm -rf node_modules
    echo "✓ node_modules removed"
else
    echo "ℹ️  No node_modules found"
fi

if [ -f "package-lock.json" ]; then
    echo "Removing package-lock.json..."
    rm -f package-lock.json
    echo "✓ package-lock.json removed"
else
    echo "ℹ️  No package-lock.json found"
fi

if [ -d "dist" ]; then
    echo "Removing dist folder..."
    rm -rf dist
    echo "✓ dist removed"
fi

if [ -d ".vite" ]; then
    echo "Removing .vite cache..."
    rm -rf .vite
    echo "✓ .vite removed"
fi

cd ..

echo ""
echo "Cleaning up Audio Insights Extractor..."
cd audio-insights-extractor

if [ -d "node_modules" ]; then
    echo "Removing node_modules..."
    rm -rf node_modules
    echo "✓ node_modules removed"
else
    echo "ℹ️  No node_modules found"
fi

if [ -f "package-lock.json" ]; then
    echo "Removing package-lock.json..."
    rm -f package-lock.json
    echo "✓ package-lock.json removed"
else
    echo "ℹ️  No package-lock.json found"
fi

if [ -d "dist" ]; then
    echo "Removing dist folder..."
    rm -rf dist
    echo "✓ dist removed"
fi

if [ -d ".vite" ]; then
    echo "Removing .vite cache..."
    rm -rf .vite
    echo "✓ .vite removed"
fi

cd ..

echo ""
echo "✅ Cleanup Complete!"
echo ""
echo "All build artifacts and dependencies removed."
echo "Ready for fresh setup testing."
echo ""
