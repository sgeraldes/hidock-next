#!/bin/bash
echo "Starting HiDock Web Application..."
echo

# Navigate to project root (two levels up from scripts/run)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/../.."

# Check if we're in the correct directory
if [ ! -d "hidock-web-app" ]; then
    echo "Error: hidock-web-app directory not found!"
    echo "Make sure the hidock-next project structure is intact."
    echo "Current directory: $(pwd)"
    read -p "Press Enter to continue..."
    exit 1
fi

# Navigate to web app directory
cd hidock-web-app

# Check if package.json exists
if [ ! -f "package.json" ]; then
    echo "Error: package.json not found in hidock-web-app directory!"
    read -p "Press Enter to continue..."
    exit 1
fi

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "Error: Node modules not found!"
    echo "Please run setup first:"
    echo "  python3 setup.py"
    echo "or"
    echo "  ./setup-unix.sh"
    echo "or manually:"
    echo "  cd hidock-web-app && npm install"
    read -p "Press Enter to continue..."
    exit 1
fi

echo "Launching HiDock Web Application..."
echo
echo "================================"
echo "HiDock Web Application"
echo "================================"
echo
echo "The web application will start on http://localhost:5173"
echo "To stop the application, press Ctrl+C here."
echo

# Check if npm is available
if ! command -v npm >/dev/null 2>&1; then
    echo "Error: npm not found!"
    echo "Please ensure Node.js and npm are installed and in your PATH."
    read -p "Press Enter to continue..."
    exit 1
fi

# Start the development server
npm run dev

# Check exit status
if [ $? -ne 0 ]; then
    echo
    echo "Application exited with an error."
    read -p "Press Enter to continue..."
fi