# Development Setup Guide

This guide will help you set up your development environment for the HiDock Community Platform.

## Prerequisites

Before you begin, ensure you have the following installed:

### Required Software

- **Python 3.8 or higher** - [Download Python](https://www.python.org/downloads/)
- **Node.js 18 or higher** - [Download Node.js](https://nodejs.org/)
- **Git** - [Download Git](https://git-scm.com/)

### System Dependencies

#### Windows

1. **Install libusb:**
   - Download libusb-1.0 from [libusb.info](https://libusb.info/)
   - Extract `libusb-1.0.dll` to your project directory
   - Optionally use [Zadig](https://zadig.akeo.ie/) to install WinUSB driver for HiDock device

2. **Install Visual C++ Build Tools:**
   - Download from [Microsoft](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
   - Required for some Python packages

#### macOS

```bash
# Install Homebrew if not already installed
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install libusb
brew install libusb
```

#### Linux (Ubuntu/Debian)

```bash
# Update package list
sudo apt-get update

# Install libusb development files
sudo apt-get install libusb-1.0-0-dev

# Install Python development files
sudo apt-get install python3-dev

# Add user to dialout group for USB access
sudo usermod -a -G dialout $USER
# Log out and back in for group changes to take effect
```

## Project Setup

### 1. Clone the Repository

```bash
git clone https://github.com/sgeraldes/hidock-next.git
cd hidock-next
```

### 2. Set Up Python Environment

#### Create Virtual Environment

```bash
# Create virtual environment
python -m venv .venv

# Activate virtual environment
# On Windows:
.venv\Scripts\activate
# On macOS/Linux:
source .venv/bin/activate
```

#### Install Python Dependencies

```bash
# Upgrade pip
python -m pip install --upgrade pip

# Install project dependencies
pip install -r requirements.txt
```

### 3. Set Up Web Application

```bash
# Navigate to web app directory
cd hidock-web-app

# Install dependencies
npm install

# Return to project root
cd ..
```

### 4. Configure VS Code (Recommended)

If you're using Visual Studio Code, the project includes pre-configured settings:

#### Install Recommended Extensions

VS Code will prompt you to install recommended extensions, or you can install them manually:

- Python
- Pylint
- Black Formatter
- ESLint
- Prettier
- Tailwind CSS IntelliSense

#### Verify Configuration

1. Open the project in VS Code
2. Check that Python interpreter is set to `.venv/Scripts/python.exe` (Windows) or `.venv/bin/python` (macOS/Linux)
3. Verify that formatting on save is enabled

### 5. Verify Installation

#### Test Desktop Application

```bash
# Ensure virtual environment is activated
# Run the desktop application
python main.py
```

The GUI should open. You don't need a HiDock device connected for the application to start.

#### Test Web Application

```bash
# Navigate to web app directory
cd hidock-web-app

# Start development server
npm run dev
```

Open your browser to `http://localhost:3000`. The web application should load.

#### Run Tests

```bash
# Test Python code
pytest tests/ -v

# Test web application
cd hidock-web-app
npm run test
```

## Development Workflow

### Daily Development

1. **Activate Python environment:**

   ```bash
   source .venv/bin/activate  # macOS/Linux
   .venv\Scripts\activate     # Windows
   ```

2. **Start development servers:**

   ```bash
   # Desktop app
   python main.py

   # Web app (in separate terminal)
   cd hidock-web-app
   npm run dev
   ```

3. **Run tests before committing:**

   ```bash
   # Python tests
   pytest tests/

   # Web tests
   cd hidock-web-app
   npm run test
   ```

### Code Formatting

The project uses automatic code formatting:

#### Python (Black)

```bash
# Format all Python files
black .

# Check formatting without making changes
black --check .
```

#### TypeScript/JavaScript (Prettier via ESLint)

```bash
cd hidock-web-app

# Lint and fix
npm run lint

# Check only
npm run lint -- --fix-dry-run
```

## Hardware Setup

### HiDock Device Connection

#### Windows

1. Connect your HiDock device
2. If Windows doesn't recognize it, use Zadig:
   - Download and run Zadig as administrator
   - Select your HiDock device
   - Install WinUSB driver
   - **Warning:** Only install WinUSB for the HiDock device

#### macOS

1. Connect your HiDock device
2. No additional drivers needed
3. Grant USB permissions when prompted

#### Linux

1. Connect your HiDock device
2. Ensure you're in the `dialout` group:

   ```bash
   groups $USER
   ```

3. If not in dialout group:

   ```bash
   sudo usermod -a -G dialout $USER
   # Log out and back in
   ```

### Device Testing

#### Desktop Application

1. Run the application: `python main.py`
2. Click "Connect" button
3. Device information should appear in status bar

#### Web Application

1. Start dev server: `npm run dev`
2. Open browser to `http://localhost:3000`
3. Click "Connect Device"
4. Select your HiDock device from browser dialog
5. **Note:** WebUSB requires HTTPS in production

## Troubleshooting

### Common Issues

#### Python Virtual Environment Issues

```bash
# If activation fails, try:
python -m venv --clear .venv

# Or recreate entirely:
rm -rf .venv
python -m venv .venv
```

#### USB Permission Issues

**Windows:**

- Use Zadig to install WinUSB driver
- Run application as administrator if needed

**Linux:**

- Check dialout group membership
- Try with sudo temporarily to test permissions

**macOS:**

- No special setup usually needed
- Check System Preferences > Security & Privacy

#### Node.js Issues

```bash
# Clear npm cache
npm cache clean --force

# Delete node_modules and reinstall
rm -rf node_modules package-lock.json
npm install
```

#### Import Errors

```bash
# Ensure PYTHONPATH includes project root
export PYTHONPATH="${PYTHONPATH}:$(pwd)"

# Or add to your shell profile
echo 'export PYTHONPATH="${PYTHONPATH}:$(pwd)"' >> ~/.bashrc
```

### Getting Help

If you encounter issues:

1. Check the [Troubleshooting Guide](./TROUBLESHOOTING.md)
2. Search existing [GitHub Issues](https://github.com/sgeraldes/hidock-next/issues)
3. Create a new issue with:
   - Your operating system
   - Python and Node.js versions
   - Complete error messages
   - Steps to reproduce

## Next Steps

Once your environment is set up:

1. Read the [Development Guide](./DEVELOPMENT.md)
2. Check out the [Contributing Guidelines](../CONTRIBUTING.md)
3. Look at [Good First Issues](https://github.com/sgeraldes/hidock-next/labels/good%20first%20issue)
4. Join the community discussions

Happy coding!
