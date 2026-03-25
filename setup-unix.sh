#!/bin/sh
# HiDock Next - Simple Linux/Mac Setup
# Run: chmod +x setup-unix.sh && ./setup-unix.sh

set -e  # Exit on any error

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
SELECT_VENV_SCRIPT="$ROOT_DIR/scripts/env/select_venv.py"

echo ""
echo "================================"
echo "   HiDock Next - Quick Setup"
echo "================================"
echo ""
echo "This will set up HiDock apps for immediate use."
echo ""

# Check Python
echo "[1/4] Checking Python..."
if command -v python3 > /dev/null 2>&1; then
    PYTHON_CMD="python3"
    echo "✓ Python3 found!"
elif command -v python > /dev/null 2>&1; then
    PYTHON_CMD="python"
    echo "✓ Python found!"
else
    echo "❌ Python not found. Installing Python 3.12..."
    echo "Continue? (y/N)"
    read -r response
    if case "$response" in [Yy]*) true;; *) false;; esac; then
        if command -v apt > /dev/null 2>&1; then
            sudo apt update && sudo apt install -y python3.12 python3.12-venv python3.12-pip
            PYTHON_CMD="python3.12"
        elif command -v dnf > /dev/null 2>&1; then
            sudo dnf install -y python3.12 python3.12-pip python3.12-venv
            PYTHON_CMD="python3.12"
        else
            echo "❌ Cannot auto-install. Please install Python 3.12+ manually."
            exit 1
        fi
        echo "✓ Python 3.12 installed!"
    else
        echo "Setup cancelled."
        exit 1
    fi
fi

# Check Python version
PYTHON_VERSION=$($PYTHON_CMD --version 2>&1 | cut -d' ' -f2 | cut -d'.' -f1,2)
# Convert version to comparable number (e.g., 3.8 -> 38, 3.12 -> 312)
PYTHON_MAJOR=$(echo "$PYTHON_VERSION" | cut -d'.' -f1)
PYTHON_MINOR=$(echo "$PYTHON_VERSION" | cut -d'.' -f2)
PYTHON_VER_NUM=$((PYTHON_MAJOR * 10 + PYTHON_MINOR))
if [ "$PYTHON_VER_NUM" -lt 38 ]; then
    echo "❌ Python 3.8+ required, found $PYTHON_VERSION. Upgrading to 3.12..."
    echo "Continue? (y/N)"
    read -r response
    if case "$response" in [Yy]*) true;; *) false;; esac; then
        if command -v apt > /dev/null 2>&1; then
            sudo apt update && sudo apt install -y python3.12 python3.12-venv python3.12-pip
            PYTHON_CMD="python3.12"
        elif command -v dnf > /dev/null 2>&1; then
            sudo dnf install -y python3.12 python3.12-pip python3.12-venv
            PYTHON_CMD="python3.12"
        else
            echo "❌ Cannot auto-upgrade. Please install Python 3.12+ manually."
            exit 1
        fi
        echo "✓ Python 3.12 installed!"
    else
        echo "Setup cancelled."
        exit 1
    fi
fi

# Set up Desktop App
echo ""
echo "[2/4] Setting up Desktop App..."

# Install system dependencies first
echo "Installing system dependencies..."
echo "Continue? (y/N)"
read -r response
if [ "$response" = "y" ] || [ "$response" = "Y" ]; then
    if command -v apt > /dev/null; then
        # Ubuntu/Debian
        sudo apt update && sudo apt install -y \
            libusb-1.0-0-dev \
            python3-tk
    elif command -v dnf > /dev/null; then
        # Fedora/RHEL 8+
        sudo dnf install -y \
            libusb1-devel \
            tkinter
    elif command -v yum > /dev/null; then
        # CentOS/RHEL 7
        sudo yum install -y \
            libusb1-devel \
            tkinter
    elif command -v brew > /dev/null; then
        # macOS
        brew install libusb
        # tkinter comes with Python on macOS
    elif command -v pacman > /dev/null; then
        # Arch Linux
        sudo pacman -S --noconfirm \
            libusb \
            python-tkinter
    else
        echo "⚠️  Cannot auto-install system packages. Please install manually:"
        echo "  - libusb development libraries (for USB device access)"
        echo "  - tkinter/python3-tk (for GUI)"
    fi
    echo "✅ System dependencies installed!"
else
    echo "⚠️  Skipping system dependencies. Some features may not work."
fi

cd "$ROOT_DIR/apps/desktop" || {
    echo "❌ Failed to navigate to apps/desktop directory"
    exit 1
}

echo "Resolving per-platform virtual environment (selector)..."
VENV_PATH=$("$PYTHON_CMD" "$SELECT_VENV_SCRIPT" --print 2>/dev/null || true)
if [ -z "$VENV_PATH" ]; then
  echo "Creating/ensuring environment..."
  VENV_PATH=$("$PYTHON_CMD" "$SELECT_VENV_SCRIPT" --ensure --print 2>/dev/null || true)
fi

if [ -z "$VENV_PATH" ]; then
  echo "❌ Failed to resolve virtual environment path."
  echo "Run manually: $PYTHON_CMD $SELECT_VENV_SCRIPT --ensure --print"
  exit 1
fi

if [ ! -d "$VENV_PATH" ]; then
  echo "Environment directory missing, creating..."
  "$PYTHON_CMD" "$SELECT_VENV_SCRIPT" --ensure || {
    echo "❌ Environment creation failed"; exit 1; }
fi

echo "Using environment: $VENV_PATH"
if [ ! -f "$VENV_PATH/bin/python" ]; then
  echo "❌ python executable missing inside venv (corrupted). Recreating..."
  rm -rf "$VENV_PATH"
  "$PYTHON_CMD" "$SELECT_VENV_SCRIPT" --ensure || { echo "❌ Recreate failed"; exit 1; }
fi

echo "Upgrading pip and build tooling..."
"$VENV_PATH/bin/python" -m pip install --upgrade pip setuptools wheel || echo "⚠️  pip upgrade failed (continuing)"

echo "Installing desktop dependencies (editable, dev extras)..."
"$VENV_PATH/bin/python" -m pip install -e "$ROOT_DIR/apps/desktop[dev]" || {
  echo "❌ Failed to install desktop dependencies"; exit 1; }

echo "✅ Desktop app setup complete!"


# Check Node.js for Web Apps
echo ""
echo "[3/4] Checking Node.js for Web Apps..."
if command -v node > /dev/null 2>&1; then
    NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -ge 18 ]; then
        echo "✓ Node.js found! Setting up web apps..."
        WEB_APP_READY=true

        echo "Setting up HiDock Web App..."
        cd ../web || {
            echo "⚠️  WARNING: Failed to navigate to apps/web"
            WEB_APP_READY=false
        }
        if [ "$WEB_APP_READY" != false ]; then
            npm install || {
                echo "⚠️  WARNING: Web app setup failed"
                WEB_APP_READY=false
            }
            echo "✅ Web app setup complete!"
            cd ../desktop
        fi

        echo "Setting up Audio Insights Extractor..."
        cd ../audio-insights || {
            echo "⚠️  WARNING: Failed to navigate to apps/audio-insights"
            WEB_APP_READY=false
        }
        if [ "$WEB_APP_READY" != false ]; then
            npm install || {
                echo "⚠️  WARNING: Audio Insights Extractor setup failed"
                WEB_APP_READY=false
            }
            echo "✅ Audio Insights Extractor setup complete!"
            cd ../desktop
        fi
    else
        echo "⚠️  Node.js version $NODE_VERSION found, but 18+ required"
        echo "Update Node.js if you want the web apps"
        WEB_APP_READY=false
    fi
else
    echo "ℹ️  Node.js not found. Installing Node.js 18+ for web apps..."
    echo "Continue? (y/N)"
    read -r response
    if case "$response" in [Yy]*) true;; *) false;; esac; then
        if command -v apt > /dev/null 2>&1; then
            curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
            sudo apt-get install -y nodejs
        elif command -v dnf > /dev/null 2>&1; then
            sudo dnf install -y nodejs npm
        else
            echo "❌ Cannot auto-install Node.js. Please install manually."
            WEB_APP_READY=false
        fi
        
        # Check if installation succeeded
        if command -v node > /dev/null 2>&1; then
            NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
            if [ "$NODE_VERSION" -ge 18 ]; then
                echo "✓ Node.js installed! Setting up web apps..."
                WEB_APP_READY=true
                
                echo "Setting up HiDock Web App..."
                cd ../web || {
                    echo "⚠️  WARNING: Failed to navigate to apps/web"
                    WEB_APP_READY=false
                }
                if [ "$WEB_APP_READY" != false ]; then
                    npm install || {
                        echo "⚠️  WARNING: Web app setup failed"
                        WEB_APP_READY=false
                    }
                    echo "✅ Web app setup complete!"
                    cd ../desktop
                fi

                echo "Setting up Audio Insights Extractor..."
                cd ../audio-insights || {
                    echo "⚠️  WARNING: Failed to navigate to apps/audio-insights"
                    WEB_APP_READY=false
                }
                if [ "$WEB_APP_READY" != false ]; then
                    npm install || {
                        echo "⚠️  WARNING: Audio Insights Extractor setup failed"
                        WEB_APP_READY=false
                    }
                    echo "✅ Audio Insights Extractor setup complete!"
                    cd ../desktop
                fi
            else
                echo "⚠️  Node.js installation failed or version too old"
                WEB_APP_READY=false
            fi
        else
            echo "⚠️  Node.js installation failed"
            WEB_APP_READY=false
        fi
    else
        echo "(Desktop app will work without Node.js)"
        WEB_APP_READY=false
    fi
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
echo "  2. . .venv.nix/bin/activate"
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
        echo "⚠️  Setting up USB permissions for HiDock device access..."
        echo "Continue? (y/N)"
        read -r response
        if case "$response" in [Yy]*) true;; *) false;; esac; then
            sudo usermod -a -G dialout $USER
            echo "✅ USB permissions configured. Please log out and back in for changes to take effect."
        else
            echo "⚠️  USB permissions not configured. You may need to run manually:"
            echo "  sudo usermod -a -G dialout \$USER"
        fi
    fi
fi

echo ""
echo "🔧 NEED MORE? Run: python setup.py (comprehensive setup)"
echo ""
echo "Enjoy using HiDock! 🎵"
echo ""
