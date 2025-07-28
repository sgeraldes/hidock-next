# Contributing to HiDock Community Platform

Thank you for your interest in contributing to the HiDock Community Platform! This document provides guidelines and information for contributors.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Development Workflow](#development-workflow)
- [Testing](#testing)
- [Code Style](#code-style)
- [Submitting Changes](#submitting-changes)
- [Issue Reporting](#issue-reporting)

## Code of Conduct

This project adheres to a code of conduct that promotes a welcoming and inclusive environment. Please read and follow our community guidelines.

## Getting Started

### Prerequisites

- **Python 3.8+** for desktop application development
- **Node.js 18+** for web application development
- **Git** for version control
- **libusb** for USB device communication
- A **HiDock device** (H1, H1E, or P1) for testing

### Development Setup

1. **Clone the repository:**

   ```bash
   git clone https://github.com/sgeraldes/hidock-next.git
   cd hidock-next
   ```

2. **Set up Python environment:**

   ```bash
   python -m venv .venv
   source .venv/bin/activate  # On Windows: .venv\Scripts\activate
   pip install -r hidock_desktop_app/requirements.txt
   ```

3. **Set up web application:**

   ```bash
   cd hidock-web-app
   npm install
   cd ..
   ```

4. **Install development tools:**

   ```bash
   # Python tools
   pip install black flake8 mypy pytest

   # VS Code extensions (recommended)
   code --install-extension ms-python.python
   code --install-extension bradlc.vscode-tailwindcss
   ```

## Project Structure

```folder
hidock-next/
├── .github/               # GitHub Actions workflows
├── .vscode/               # VS Code configuration
├── hidock_desktop_app/    # Python desktop application (as a package)
│   ├── __init__.py
│   ├── main.py
│   ├── icons/
│   └── requirements.txt
├── hidock-web-app/        # React web application
│   ├── src/
│   └── package.json
├── tests/                 # Python tests
├── .gitignore
└── README.md
```

## Development Workflow

### Branch Strategy

- `main` - Production-ready code
- `develop` - Integration branch for features
- `feature/feature-name` - Feature development
- `bugfix/bug-description` - Bug fixes
- `hotfix/critical-fix` - Critical production fixes

### Making Changes

1. **Create a feature branch:**

   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes:**

   - Follow the coding standards
   - Add tests for new functionality
   - Update documentation as needed

3. **Test your changes:**

   ```bash
   # Python tests
   pytest tests/ -v

   # Web app tests
   cd hidock-web-app
   npm run test
   ```

4. **Commit your changes:**

   ```bash
   git add .
   git commit -m "feat: add new feature description"
   ```

5. **Push and create PR:**

   ```bash
   git push origin feature/your-feature-name
   ```

## Testing

### Python Testing

We use pytest for Python testing:

```bash
# Run all tests
pytest tests/ -v

# Run with coverage
pytest tests/ --cov=. --cov-report=html

# Run specific test categories
pytest tests/ -m unit
pytest tests/ -m integration
```

### Web Application Testing

We use Vitest and Testing Library for React testing:

```bash
cd hidock-web-app

# Run tests
npm run test

# Run with coverage
npm run test:coverage

# Run in watch mode
npm run test:watch
```

### Test Categories

- **Unit tests** (`@pytest.mark.unit`): Test individual functions/components
- **Integration tests** (`@pytest.mark.integration`): Test component interactions
- **Device tests** (`@pytest.mark.device`): Require actual hardware (optional)

## Code Style

### Python Code Style

- **Formatter**: Black (line length: 88)
- **Linter**: Flake8
- **Import sorting**: isort
- **Type checking**: mypy

```bash
# Format code
black .

# Check linting
flake8 .

# Sort imports
isort .

# Type check
mypy .
```

### TypeScript/React Code Style

- **Formatter**: Prettier
- **Linter**: ESLint
- **Style**: Functional components with hooks

```bash
cd hidock-web-app

# Lint code
npm run lint

# Format code (if configured)
npm run format
```

### Commit Message Format

Use conventional commits:

- `feat:` - New features
- `fix:` - Bug fixes
- `docs:` - Documentation changes
- `style:` - Code style changes
- `refactor:` - Code refactoring
- `test:` - Test additions/changes
- `chore:` - Maintenance tasks

## Submitting Changes

### Pull Request Process

1. **Ensure your PR:**

   - Has a clear title and description
   - References related issues
   - Includes tests for new functionality
   - Passes all CI checks
   - Updates documentation if needed

2. **PR Template:**

   ```markdown
   ## Description

   Brief description of changes

   ## Type of Change

   - [ ] Bug fix
   - [ ] New feature
   - [ ] Breaking change
   - [ ] Documentation update

   ## Testing

   - [ ] Unit tests pass
   - [ ] Integration tests pass
   - [ ] Manual testing completed

   ## Checklist

   - [ ] Code follows style guidelines
   - [ ] Self-review completed
   - [ ] Documentation updated
   ```

3. **Review Process:**
   - At least one maintainer review required
   - All CI checks must pass
   - Address feedback promptly

## Issue Reporting

### Bug Reports

Include:

- Clear description of the issue
- Steps to reproduce
- Expected vs actual behavior
- Environment details (OS, Python/Node version)
- Device information (if applicable)

### Feature Requests

Include:

- Clear description of the feature
- Use case and motivation
- Proposed implementation (if any)
- Acceptance criteria

### Issue Labels

- `bug` - Something isn't working
- `enhancement` - New feature request
- `documentation` - Documentation improvements
- `good first issue` - Good for newcomers
- `help wanted` - Extra attention needed

## Development Tips

### Desktop Application

- Use the VS Code debugger configuration for debugging
- Test with mock USB devices when hardware isn't available
- Follow the existing GUI patterns for consistency

### Web Application

- Use the browser's developer tools for debugging
- Test WebUSB functionality in supported browsers
- Follow React best practices and hooks patterns

### Device Communication

- Always test with actual hardware when possible
- Use mock devices for automated testing
- Handle connection errors gracefully

## Getting Help

- **GitHub Issues**: For bugs and feature requests
- **Discussions**: For questions and general discussion
- **Discord/Slack**: Real-time community chat (if available)

## Recognition

Contributors are recognized in:

- README.md contributors section
- Release notes
- GitHub contributors page

Thank you for contributing to the HiDock Community Platform!
