#!/bin/bash
# HiDock Meeting Recorder - Development Run Script

echo "Starting HiDock Meeting Recorder..."
echo

# Navigate to script directory (project root)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Check if meeting-recorder app directory exists
if [ ! -d "apps/meeting-recorder" ]; then
    echo "Error: apps/meeting-recorder directory not found!"
    echo "Make sure the hidock-next project structure is intact."
    echo "Current directory: $(pwd)"
    exit 1
fi

# Navigate to meeting-recorder app directory
cd apps/meeting-recorder

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "Node modules not found. Installing dependencies..."
    npm install
    if [ $? -ne 0 ]; then
        echo
        echo "Failed to install dependencies."
        exit 1
    fi
fi

echo
echo "================================"
echo "HiDock Meeting Recorder"
echo "================================"
echo
echo "To stop the application, close the window or press Ctrl+C here."
echo

# Run the meeting-recorder app in development mode
npm run dev
