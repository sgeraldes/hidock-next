# 🚀 Quick Start Guide

**Get HiDock Next running in under 5 minutes!**

Choose the setup method that works best for you:

## 🚀 Super Simple Setup (End Users)

**Just want to use HiDock apps? Pick your platform:**

### 🪟 Windows (Easiest)
```cmd
# Clone first:
git clone https://github.com/sgeraldes/hidock-next.git
cd hidock-next

# If you need Python/Node.js installed:
scripts\setup\install-prerequisites.bat

# Then run the main setup:
setup-windows.bat
```

### 🐧 Linux (Automated System Setup)
```bash
git clone https://github.com/sgeraldes/hidock-next.git
cd hidock-next

# Step 1: Install system dependencies (automated)
python3 scripts/setup/setup_linux_deps.py

# Step 2: Run main application setup
chmod +x setup-unix.sh && ./setup-unix.sh
```
*Automatically handles system packages, USB permissions, and udev rules*

### 🍎 Mac (One Command)
```bash
git clone https://github.com/sgeraldes/hidock-next.git
cd hidock-next

# If you need Python/Node.js installed:
chmod +x scripts/setup/install-prerequisites.sh && ./scripts/setup/install-prerequisites.sh

# Then run the main setup:
chmod +x setup-unix.sh && ./setup-unix.sh
```

### 🐍 Any Platform (Interactive)
```bash
git clone https://github.com/sgeraldes/hidock-next.git
cd hidock-next
python setup.py
# Choose option 1 (End User)
```

**Requirements:** Python 3.12+ recommended (minimum 3.8)

## 👨‍💻 Developer Setup

**Want to contribute code?**

### Platform-Specific Setup (Recommended)
```bash
# Windows:
setup-windows.bat

# Linux/Mac:
./setup-unix.sh

# Any Platform (Interactive):
python setup.py
# Choose option 2 (Developer)
```

### Manual Setup
```bash
# Desktop app
cd hidock-desktop-app
python -m venv .venv
# Windows: .venv\Scripts\activate
source .venv/bin/activate
pip install -e ".[dev]"

# Web app
cd hidock-web-app
npm install
```

This includes:
- Full development environment with virtual environments
- Pre-commit hooks for automated code quality
- Git workflow setup with proper branching
- Testing tools (pytest, vitest) with coverage
- AI API key configuration and validation
- Code formatting tools (Black, ESLint) with 120-char line length

## 📱 What You Get

After setup, you can run:

### Desktop Application
```bash
# Option 1: Use convenience launcher from root
.\run-desktop.bat    # Windows
./run-desktop.sh     # Linux/Mac (if available)

# Option 2: Manual launch
cd hidock-desktop-app
# Windows:
.venv\Scripts\activate
# Linux/Mac:
source .venv/bin/activate

python main.py
```

### Web Application
```bash
# Option 1: Use convenience launcher from root
.\run-web.bat        # Windows
./run-web.sh         # Linux/Mac (if available)

# Option 2: Manual launch
cd hidock-web-app
npm run dev
# Open: http://localhost:5173
```

## ❓ Need Help?

- **Problems during setup?** → [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)
- **How to use the apps?** → [README.md](README.md)
- **Want to contribute?** → [CONTRIBUTING.md](CONTRIBUTING.md)
- **Pre-commit issues?** → [docs/PRE-COMMIT.md](docs/PRE-COMMIT.md)

## 🎯 Quick Tips

- **Desktop app**: Best for full features and local AI models
- **Web app**: Great for quick access and device management
- **AI providers**: Configure in app Settings for transcription
- **HiDock device**: Connect via USB for device management
- **Code quality**: Pre-commit hooks run automatically on commit
- **Line length**: 120 characters standard across all code

## 🔧 Developer Quick Commands

After developer setup:

```bash
# Activate environment first
cd hidock-desktop-app
# Windows: .venv\Scripts\activate
source .venv/bin/activate

# Test everything
python -m pytest tests/ -v

# Check code quality
pre-commit run --all-files

# Format code
black . && isort .

# Web app testing
cd ../hidock-web-app
npm test
npm run lint
```
