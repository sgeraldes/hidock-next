#!/bin/bash

echo ""
echo "================================"
echo "   Setting up Pre-commit Hooks"
echo "================================"
echo ""

# Check if Python is available
if ! command -v python &> /dev/null && ! command -v python3 &> /dev/null; then
    echo "ERROR: Python not found!"
    echo "Please install Python first."
    exit 1
fi

# Determine Python command
if command -v python3 &> /dev/null; then
    PYTHON_CMD="python3"
else
    PYTHON_CMD="python"
fi

# Install pre-commit
echo "Installing pre-commit..."
$PYTHON_CMD -m pip install pre-commit

if [ $? -ne 0 ]; then
    echo "ERROR: Failed to install pre-commit!"
    exit 1
fi

# Install the git hooks
echo ""
echo "Installing git hooks..."
pre-commit install
pre-commit install --hook-type pre-push

if [ $? -ne 0 ]; then
    echo "ERROR: Failed to install git hooks!"
    exit 1
fi

echo ""
echo "✅ Pre-commit hooks installed successfully!"
echo ""
echo "The following checks will run before each commit:"
echo "- Flake8 (Python linting) for desktop app"
echo "- ESLint (JS/TS linting) for web apps"
echo "- Black (Python formatting)"
echo "- isort (Python import sorting)"
echo "- General file checks (trailing whitespace, large files, etc.)"
echo ""
echo "To run hooks manually: pre-commit run --all-files"
echo "To skip hooks once: git commit --no-verify"
echo ""
