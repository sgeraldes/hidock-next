#!/bin/zsh
# HiDock Next - Simple Linux/Mac Setup
# Run: chmod +x setup-unix.sh && ./setup-unix.sh

# Ensure zsh behaves consistently with POSIX-style scripts
emulate -L zsh
setopt errexit pipefail  # Exit on any error, fail pipelines

SCRIPT_DIR=${0:A:h}
cd "$SCRIPT_DIR"
ROOT_DIR=$PWD

echo ""
echo "================================"
echo "   HiDock Next - Quick Setup"
echo "================================"
echo ""
echo "This will set up HiDock apps for immediate use."
echo ""

# Check Python
echo "[1/4] Checking Python..."
if command -v python3 &> /dev/null; then
    PYTHON_CMD="python3"
    echo "✓ Python3 found!"
elif command -v python &> /dev/null; then
    PYTHON_CMD="python"
    echo "✓ Python found!"
else
    echo "❌ ERROR: Python not found!"
    echo ""
    echo "INSTALL PYTHON FIRST:"
    echo ""
    echo "🐧 Ubuntu/Debian:"
    echo "   sudo apt update && sudo apt install python3 python3-venv python3-pip"
    echo ""
    echo "🎩 CentOS/RHEL/Fedora:"
    echo "   sudo dnf install python3 python3-pip python3-venv"
    echo ""
    echo "🍎 macOS:"
    echo "   brew install python3"
    echo "   (or download from https://python.org/downloads/)"
    echo ""
    echo "Then restart this script."
    exit 1
fi

# Check Python version
PYTHON_VERSION=$($PYTHON_CMD -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
IFS='.' read -r PY_MAJOR PY_MINOR <<< "$PYTHON_VERSION"
if (( PY_MAJOR < 3 || (PY_MAJOR == 3 && PY_MINOR < 12) )); then
    echo "❌ ERROR: Python 3.12 required for optimal compatibility, found $PY_MAJOR.$PY_MINOR"
    echo "Some packages may not work with other versions"
    exit 1
fi

# Set up Desktop App
echo ""
echo "[2/4] Setting up Desktop App..."
cd "$ROOT_DIR/apps/desktop"

if [ ! -d ".venv" ]; then
    echo "Creating Python environment..."
    $PYTHON_CMD -m venv .venv
fi

echo "Upgrading pip and installing dependencies..."
source .venv/bin/activate
python -m pip install --upgrade pip setuptools wheel

echo "Installing dependencies (this may take a few minutes)..."
if [ -f "pyproject.toml" ] || [ -f "setup.py" ]; then
    pip install -e ".[dev]" || {
        echo ""
        echo "❌ ERROR: Failed to install dependencies!"
        echo "Check your internet connection and try again."
        echo ""
        exit 1
    }
else
    pip install -r config/requirements.txt && pip install -r config/requirements-dev.txt || {
        echo ""
        echo "❌ ERROR: Failed to install dependencies!"
        echo "Check your internet connection and try again."
        echo ""
        exit 1
    }
fi

echo "✅ Desktop app setup complete!"
cd "$ROOT_DIR"

# Check Node.js for Web Apps
echo ""
echo "[3/4] Checking Node.js for Web Apps..."
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -ge 18 ]; then
        echo "✓ Node.js found! Setting up web apps..."

        echo "Setting up HiDock Web App..."
        cd "$ROOT_DIR/apps/web"
        npm install || {
            echo "⚠️  WARNING: Web app setup failed"
        }
        echo "✅ Web app setup complete!"
        cd "$ROOT_DIR"

        echo "Setting up Audio Insights Extractor..."
        cd "$ROOT_DIR/apps/audio-insights"
        npm install || {
            echo "⚠️  WARNING: Audio Insights Extractor setup failed"
        }
        echo "✅ Audio Insights Extractor setup complete!"
        cd "$ROOT_DIR"

        WEB_APP_READY=true
    else
        echo "⚠️  Node.js version $NODE_VERSION found, but 18+ required"
        echo "Update Node.js if you want the web apps"
        WEB_APP_READY=false
    fi
else
    echo "ℹ️  Node.js not found - skipping web apps setup"
    echo ""
    echo "OPTIONAL: Install Node.js for Web Apps"
    echo ""
    echo "🐧 Ubuntu/Debian:"
    echo "   curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -"
    echo "   sudo apt-get install -y nodejs"
    echo ""
    echo "🎩 CentOS/RHEL/Fedora:"
    echo "   sudo dnf install nodejs npm"
    echo ""
    echo "🍎 macOS:"
    echo "   brew install node"
    echo "   (or download from https://nodejs.org/)"
    echo ""
    echo "(Desktop app will work without Node.js)"
    echo ""
    WEB_APP_READY=false
fi

# Complete
echo ""
echo "[4/4] Setup Complete!"
echo "================================"
echo ""
echo "🚀 HOW TO RUN:"
echo ""
echo "Desktop App:"
echo "  1. cd apps/desktop"
echo "  2. source .venv/bin/activate"
echo "  3. python main.py"
echo ""

if [ "$WEB_APP_READY" = true ]; then
    echo "Web App:"
    echo "  1. cd apps/web"
    echo "  2. npm run dev"
    echo "  3. Open: http://localhost:5173"
    echo ""
fi

echo "💡 FIRST TIME TIPS:"
echo "• Configure AI providers in app Settings for transcription"
echo "• Connect your HiDock device via USB"
echo "• Check README.md and docs/TROUBLESHOOTING.md for help"

# Linux USB permissions check
if [ "$(uname)" = "Linux" ]; then
    if ! groups $USER | grep -q "dialout"; then
        echo ""
        echo "⚠️  USB Permission Setup (Linux):"
        echo "For HiDock device access, run:"
        echo "  sudo usermod -a -G dialout \$USER"
        echo "Then log out and back in."
    fi
fi

echo ""
echo "🔧 NEED MORE? Run: python setup.py (comprehensive setup)"
echo ""
echo "Enjoy using HiDock! 🎵"
echo ""
