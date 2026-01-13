#!/bin/bash
# HiDock Meeting Intelligence - Build Script

echo "Building HiDock Meeting Intelligence..."
echo

# Navigate to script directory (project root)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Check if electron app directory exists
if [ ! -d "apps/electron" ]; then
    echo "Error: apps/electron directory not found!"
    echo "Make sure the hidock-next project structure is intact."
    echo "Current directory: $(pwd)"
    exit 1
fi

# Navigate to electron app directory
cd apps/electron

# Install/update dependencies
echo "Installing dependencies..."
npm install
if [ $? -ne 0 ]; then
    echo
    echo "Failed to install dependencies."
    exit 1
fi
echo "Dependencies installed successfully."
echo

echo
echo "================================"
echo "Building Electron App"
echo "================================"
echo "Compiling main process (backend) and renderer (frontend)..."
echo

# Build the electron app (compiles both frontend and backend)
npm run build

if [ $? -eq 0 ]; then
    echo
    echo "================================"
    echo "Build completed successfully!"
    echo "================================"
    echo "Output directory: apps/electron/out/"
    echo "  - Main process: out/main/"
    echo "  - Renderer: out/renderer/"
    echo "  - Preload: out/preload/"
    echo
else
    echo
    echo "Build failed. Please check the error messages above."
    exit 1
fi
