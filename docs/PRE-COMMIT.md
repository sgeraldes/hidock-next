# Pre-commit Hooks Setup

This project uses pre-commit hooks to ensure code quality before commits.

## Quick Setup

### Windows
```bash
.\setup-precommit.bat
```

### Linux/Mac
```bash
./setup-precommit.sh
```

## What Gets Checked

Before each commit, the following checks run automatically:

### Python Code (Desktop App)
- **Flake8**: Code style and error checking (120 char line length, E203/W503 exceptions for Black)
- **Black**: Automatic formatting (120 char line length)
- **isort**: Import sorting with Black profile
- **pytest**: Run Python tests on pre-push (optional if tests exist)

**Note**: Pylint is available via VS Code tasks but not included in pre-commit hooks to keep commits fast.
Use `Ctrl+Shift+P` → "Tasks: Run Task" → "Pylint Python Code" for comprehensive analysis.

### JavaScript/TypeScript (Web Apps)
- **ESLint**: Code style and error checking for both web apps
- **TypeScript**: Type checking on pre-push
- **Tests**: Run web app tests on pre-push (optional if tests exist)
- **Build**: Validate TypeScript compilation on pre-push

### General Files
- Remove trailing whitespace
- Ensure files end with newline
- Validate YAML/JSON files
- Prevent large files (>1MB)
- Check for merge conflicts
- Detect private keys

## Usage

### Run Manually
```bash
# Check all files
pre-commit run --all-files

# Check specific hook
pre-commit run flake8-desktop-app
```

### Skip Hooks (Emergency Only!)
```bash
git commit --no-verify -m "Emergency fix"
```

## Fixing Issues

### Python Issues
```bash
cd hidock-desktop-app
# Auto-format
black .
isort .
# Check remaining issues
flake8 .
```

### JavaScript Issues
```bash
cd hidock-web-app
# Some issues can be auto-fixed
npx eslint . --fix
# Check remaining issues
npm run lint
```

## Troubleshooting

**"No .venv found"**: Run setup script first (`setup-windows.bat` or `setup-unix.sh`)

**"No node_modules found"**: Run `npm install` in the web app directories

**Import order conflicts**: Let isort handle imports - it's configured to work with Black

**ESLint errors**: Many can be auto-fixed with `--fix` flag

**Test failures in test files**: Test-specific lint issues are ignored - only production code enforces strict linting

## Configuration Files

- **`.pre-commit-config.yaml`**: Main pre-commit configuration
- **`hidock-desktop-app/pyproject.toml`**: Python tool configuration (Black, isort, flake8)
- **`hidock-desktop-app/.flake8`**: Flake8 configuration with test file ignores
- **`hidock-web-app/.eslintrc.cjs`**: ESLint configuration with test overrides
