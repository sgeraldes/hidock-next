#!/bin/bash
echo "Starting HiDock Desktop Application..."
echo

# Navigate to project root (two levels up from scripts/run)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/../.."

# Check if we're in the correct directory
if [ ! -d "hidock-desktop-app" ]; then
    echo "Error: hidock-desktop-app directory not found!"
    echo "Make sure the hidock-next project structure is intact."
    echo "Current directory: $(pwd)"
    read -p "Press Enter to continue..."
    exit 1
fi

# Navigate to desktop app directory
cd hidock-desktop-app

# Check if virtual environment exists
if [ ! -d ".venv" ]; then
    echo "Error: Virtual environment not found!"
    echo "Please run setup first:"
    echo "  python3 setup.py"
    echo "or"
    echo "  ./setup-unix.sh"
    read -p "Press Enter to continue..."
    exit 1
fi

# Check virtual environment activation script
if [ -f ".venv/bin/activate" ]; then
    echo "Activating virtual environment..."
    source .venv/bin/activate
elif [ -f ".venv/Scripts/activate" ]; then
    echo "Detected Windows-style virtual environment."
    echo "Using Python directly from .venv/Scripts/python"
    PYTHON_EXE=".venv/Scripts/python"
else
    echo "Error: Virtual environment activation script not found!"
    echo "Virtual environment appears corrupted."
    echo "Please run setup again:"
    echo "  python3 setup.py"
    read -p "Press Enter to continue..."
    exit 1
fi

echo "Checking if main.py exists..."
if [ ! -f "main.py" ]; then
    echo "Error: main.py not found in hidock-desktop-app directory!"
    read -p "Press Enter to continue..."
    exit 1
fi

echo "Launching HiDock Desktop Application..."
echo
echo "================================"
echo "HiDock Desktop Application"
echo "================================"
echo
echo "To stop the application, close the GUI window or press Ctrl+C here."
echo

# Set UTF-8 encoding to handle emoji characters
export PYTHONIOENCODING=utf-8

# Use the appropriate Python executable
if [ -n "$PYTHON_EXE" ]; then
    "$PYTHON_EXE" main.py
else
    # Try python3 first, then python
    if command -v python3 >/dev/null 2>&1; then
        python3 main.py
    elif command -v python >/dev/null 2>&1; then
        python main.py
    else
        echo "Error: Python not found!"
        echo "Please ensure Python is installed and in your PATH."
        read -p "Press Enter to continue..."
        exit 1
    fi
fi

# Check exit status
if [ $? -ne 0 ]; then
    echo
    echo "Application exited with an error."
    read -p "Press Enter to continue..."
fi