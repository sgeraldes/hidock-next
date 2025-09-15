#!/bin/bash
echo "Starting HiDock Desktop Application..."
echo

# Navigate to project root (two levels up from scripts/run)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# cd "$SCRIPT_DIR/../.."

# Check if we're in the correct directory
if [ ! -d "apps/desktop" ]; then
    echo "Error: apps/desktop directory not found!"
    echo "Make sure the hidock-next project structure is intact."
    echo "Current directory: $(pwd)"
    printf "Press Enter to continue..."; read
    exit 1
fi

VENV_PATH=$(python scripts/env/select_venv.py --print 2>/dev/null || true)
if [ -z "$VENV_PATH" ]; then
    echo "Resolving virtual environment (creating if needed)..."
    VENV_PATH=$(python scripts/env/select_venv.py --ensure --print 2>/dev/null || true)
fi

if [ -z "$VENV_PATH" ]; then
    echo "Error: Failed to resolve/ensure virtual environment."
    echo "Run: python scripts/env/select_venv.py --ensure --print"
    printf "Press Enter to continue..."; read
    exit 1
fi

if [ ! -d "$VENV_PATH" ]; then
    echo "Creating environment at $VENV_PATH ..."
    python scripts/env/select_venv.py --ensure || {
        echo "Error: creation failed"; printf "Press Enter to continue..."; read; exit 1; }
fi

# Legacy migration notice
if [ -d "apps/desktop/.venv" ] && [ ! -d "$VENV_PATH" ]; then
    echo "Detected legacy apps/desktop/.venv. See docs/VENV.md for migration." 
fi

# Activate
if [ -f "$VENV_PATH/bin/activate" ]; then
    echo "Activating environment: $VENV_PATH"
    # shellcheck disable=SC1090
    . "$VENV_PATH/bin/activate"
else
    echo "Activation script missing ($VENV_PATH/bin/activate). Recreating..."
    python scripts/env/select_venv.py --ensure || {
        echo "Failed to recreate environment."; printf "Press Enter to continue..."; read; exit 1; }
    if [ -f "$VENV_PATH/bin/activate" ]; then
        . "$VENV_PATH/bin/activate"
    else
        echo "Still missing activation script. See docs/VENV.md"; printf "Press Enter to continue..."; read; exit 1;
    fi
fi

# Navigate to desktop app directory after activation
cd apps/desktop

echo "Checking if main.py exists..."
if [ ! -f "main.py" ]; then
    echo "Error: main.py not found in apps/desktop directory!"
    printf "Press Enter to continue..."; read
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

# Use Python from the activated virtual environment
python main.py

# Check exit status
if [ $? -ne 0 ]; then
    echo
    echo "Application exited with an error."
    printf "Press Enter to continue..."; read
fi