# VS Code Configuration Guide

This document explains the VS Code configuration for the HiDock Next project, including linting, formatting, and extension setup.

## 🔧 Required Extensions

The project is configured to recommend the following extensions (see `.vscode/extensions.json`):

### Python Development
- **ms-python.python** - Core Python support with Pylance built-in for type checking
- **ms-python.flake8** - Fast style checking and linting
- **ms-python.black-formatter** - Code formatting (120-char line length)
- **ms-python.isort** - Import organization
- **ms-python.pylint** - Comprehensive code quality analysis

### TypeScript/JavaScript Development
- **esbenp.prettier-vscode** - Code formatting
- **dbaeumer.vscode-eslint** - Linting for TypeScript/JavaScript

## ⚙️ Workspace Settings

The project includes comprehensive workspace settings in `.vscode/settings.json`:

### Python Configuration

```jsonc
{
  // Python interpreter and formatting
  "python.defaultInterpreterPath": "${workspaceFolder}/hidock-desktop-app/.venv/Scripts/python.exe",
  "[python]": {
    "editor.defaultFormatter": "ms-python.black-formatter",
    "editor.formatOnSave": true,
    "editor.codeActionsOnSave": {
      "source.organizeImports": "explicit"
    }
  },

  // Flake8 configuration
  "flake8.args": ["--max-line-length=120", "--extend-ignore=E203,W503"],
  "flake8.path": ["${workspaceFolder}/hidock-desktop-app/.venv/Scripts/flake8.exe"],
  "flake8.cwd": "${workspaceFolder}/hidock-desktop-app",

  // Pylint configuration
  "pylint.args": ["--rcfile=${workspaceFolder}/.pylintrc"],
  "pylint.path": ["${workspaceFolder}/hidock-desktop-app/.venv/Scripts/pylint.exe"],
  "pylint.cwd": "${workspaceFolder}/hidock-desktop-app",

  // Pylance settings
  "python.analysis.typeCheckingMode": "basic",
  "python.analysis.autoImportCompletions": true
}
```

### Tool Configuration Files

#### pyproject.toml
Central configuration for Python tools:

```toml
[tool.black]
line-length = 120

[tool.isort]
profile = "black"
line_length = 120

[tool.flake8]
max-line-length = 120
extend-ignore = ["E203", "W503"]

[tool.pylint.format]
max-line-length = 120

[tool.pylint.messages_control]
disable = [
    "C0114",  # missing-module-docstring
    "C0115",  # missing-class-docstring
    "C0116",  # missing-function-docstring
    "R0903",  # too-few-public-methods
    "C0103",  # invalid-name (Black handles naming)
    "W0613",  # unused-argument (often needed for compatibility)
    "R0801",  # duplicate-code (often false positives)
    "C0301",  # line-too-long (handled by Black/Flake8)
]
```

#### .pylintrc
Dedicated pylint configuration file with project-specific settings.

## 🚀 Available VS Code Tasks

The project includes VS Code tasks for common operations:

### Python Tasks
- **Format Python Code** - Run Black formatter
- **Lint Python Code** - Run Flake8 linting
- **Pylint Python Code** - Run comprehensive Pylint analysis
- **Full Python Lint** - Run both Flake8 and Pylint sequentially
- **Run Python Tests** - Execute pytest

### Usage
1. Press `Ctrl+Shift+P`
2. Type "Tasks: Run Task"
3. Select the desired task

## 🔍 Linting Strategy

### Real-time Feedback (While Coding)
- **Pylance**: Type checking, IntelliSense, import suggestions
- **Flake8**: Fast style checking, PEP 8 compliance
- Both provide immediate feedback in VS Code Problems panel

### Comprehensive Analysis (On-demand)
- **Pylint**: Code complexity, design patterns, best practices
- Run via VS Code tasks when you need detailed analysis
- Not included in pre-commit hooks to keep commits fast

### Code Formatting (Automatic)
- **Black**: Opinionated code formatting on save
- **isort**: Import organization on save
- Both configured with 120-character line length

## 🛠️ Development Workflow

1. **Code**: Write Python code with real-time Pylance + Flake8 feedback
2. **Save**: Automatic formatting with Black + isort
3. **Analyze**: Run Pylint task for comprehensive quality checks
4. **Commit**: Pre-commit hooks ensure Flake8 + Black compliance
5. **Push**: Additional tests run automatically

## 🔧 Troubleshooting

### Extension Not Working
1. Ensure virtual environment is activated
2. Check extension paths in settings.json
3. Restart VS Code Python language server: `Ctrl+Shift+P` → "Python: Restart Language Server"

### Pylint Not Running
1. Verify `.pylintrc` file exists in project root
2. Check pylint path in settings.json
3. Run manually: `Ctrl+Shift+P` → "Tasks: Run Task" → "Pylint Python Code"

### Formatting Issues
1. Ensure Black extension is installed
2. Check that Python formatter is set to Black in settings
3. Verify format on save is enabled

## 📈 Benefits of This Setup

- **Fast Feedback**: Immediate error detection while typing
- **Consistent Style**: Automatic formatting prevents style debates
- **Comprehensive Analysis**: Deep code quality insights when needed
- **Team Consistency**: Shared configuration ensures uniform development experience
- **Modern Architecture**: Uses dedicated extensions for optimal performance
