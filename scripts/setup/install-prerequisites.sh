#!/bin/bash
# HiDock Next - Prerequisites Installer for Linux/Mac
# Run: chmod +x install-prerequisites.sh && ./install-prerequisites.sh

set -e

echo ""
echo "========================================"
echo "  HiDock Next - Prerequisites Installer"
echo "========================================"
echo ""
echo "This script can automatically install:"
echo "- Python 3.12+ (required)"
echo "- Node.js LTS (optional, for web apps)"
echo ""

# Detect OS
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    OS="linux"
    if command -v apt &> /dev/null; then
        DISTRO="debian"
    elif command -v dnf &> /dev/null; then
        DISTRO="fedora"
    elif command -v yum &> /dev/null; then
        DISTRO="rhel"
    else
        DISTRO="unknown"
    fi
elif [[ "$OSTYPE" == "darwin"* ]]; then
    OS="macos"
else
    OS="unknown"
fi

echo "Detected OS: $OS"
if [ "$OS" = "linux" ]; then
    echo "Detected distribution: $DISTRO"
fi
echo ""

# Function to install Python
install_python() {
    echo "[1/2] Installing Python 3.12..."
    
    if [ "$OS" = "linux" ]; then
        if [ "$DISTRO" = "debian" ]; then
            echo "Installing Python 3.12 on Ubuntu/Debian..."
            sudo apt update
            sudo apt install -y software-properties-common
            sudo add-apt-repository -y ppa:deadsnakes/ppa
            sudo apt update
            sudo apt install -y python3.12 python3.12-venv python3.12-dev python3-pip
        elif [ "$DISTRO" = "fedora" ] || [ "$DISTRO" = "rhel" ]; then
            echo "Installing Python 3.12 on Fedora/RHEL..."
            sudo dnf install -y python3.12 python3.12-pip python3.12-devel
        else
            echo "❌ Unsupported Linux distribution"
            echo "Please install Python 3.12 manually"
            return 1
        fi
    elif [ "$OS" = "macos" ]; then
        if command -v brew &> /dev/null; then
            echo "Installing Python 3.12 via Homebrew..."
            brew install python@3.12
        else
            echo "❌ Homebrew not found"
            echo "Install Homebrew first: /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
            echo "Or download Python from https://python.org/downloads/"
            return 1
        fi
    fi
    
    echo "✅ Python installation complete!"
}

# Function to install Node.js
install_nodejs() {
    echo "[2/2] Installing Node.js LTS..."
    
    if [ "$OS" = "linux" ]; then
        if [ "$DISTRO" = "debian" ]; then
            echo "Installing Node.js on Ubuntu/Debian..."
            curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
            sudo apt-get install -y nodejs
        elif [ "$DISTRO" = "fedora" ] || [ "$DISTRO" = "rhel" ]; then
            echo "Installing Node.js on Fedora/RHEL..."
            sudo dnf install -y nodejs npm
        else
            echo "⚠️  Unsupported Linux distribution for Node.js"
            echo "Please install Node.js manually from https://nodejs.org/"
            return 1
        fi
    elif [ "$OS" = "macos" ]; then
        if command -v brew &> /dev/null; then
            echo "Installing Node.js via Homebrew..."
            brew install node
        else
            echo "⚠️  Homebrew not found"
            echo "Install from https://nodejs.org/ or install Homebrew first"
            return 1
        fi
    fi
    
    echo "✅ Node.js installation complete!"
}

# Check current installations
echo "Checking current installations..."

# Check Python
if command -v python3.12 &> /dev/null; then
    PYTHON_VERSION=$(python3.12 --version 2>&1 | cut -d' ' -f2)
    echo "✅ Python 3.12 already installed: $PYTHON_VERSION"
    PYTHON_NEEDED=false
elif command -v python3 &> /dev/null; then
    PYTHON_VERSION=$(python3 --version 2>&1 | cut -d' ' -f2 | cut -d'.' -f1,2)
    if [ "$(printf '%s\n' "3.8" "$PYTHON_VERSION" | sort -V | head -n1)" = "3.8" ]; then
        echo "✅ Python $PYTHON_VERSION found (compatible)"
        PYTHON_NEEDED=false
    else
        echo "⚠️  Python $PYTHON_VERSION found (too old, need 3.8+)"
        PYTHON_NEEDED=true
    fi
else
    echo "❌ Python not found"
    PYTHON_NEEDED=true
fi

# Check Node.js
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    echo "✅ Node.js already installed: $NODE_VERSION"
    NODE_NEEDED=false
else
    echo "❌ Node.js not found"
    NODE_NEEDED=false  # Optional
fi

echo ""

# Ask user what to install
if [ "$PYTHON_NEEDED" = true ]; then
    echo "Python installation is required."
    read -p "Install Python 3.12? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        install_python || {
            echo "❌ Python installation failed"
            echo "Please install manually and run setup-unix.sh"
            exit 1
        }
    else
        echo "❌ Python is required. Please install manually:"
        echo "• Ubuntu/Debian: sudo apt install python3 python3-venv python3-pip"
        echo "• Fedora/RHEL: sudo dnf install python3 python3-pip"
        echo "• macOS: brew install python3"
        exit 1
    fi
fi

if [ "$NODE_NEEDED" = true ]; then
    echo "Node.js is optional (needed for web apps)."
    read -p "Install Node.js LTS? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        install_nodejs || {
            echo "⚠️  Node.js installation failed"
            echo "Web apps won't be available, but desktop app will work"
        }
    fi
fi

echo ""
echo "========================================"
echo "Prerequisites installation complete!"
echo "========================================"
echo ""
echo "NEXT STEPS:"
echo "1. Run: ./setup-unix.sh"
echo "2. Or run: python setup.py"
echo ""
echo "The HiDock apps are now ready to install!"
echo ""