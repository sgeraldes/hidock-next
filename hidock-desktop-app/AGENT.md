# HiDock Desktop App

## Overview

The HiDock Desktop App is a Python-based GUI application for managing audio recordings from HiDock devices, built with the CustomTkinter framework. This document outlines the mandatory standards and procedures for its development. Adherence to these rules is not optional.

## Initial Setup

A compliant development environment is critical for maintaining code quality and consistency. Follow these steps once to prepare your local environment.

The `requirements.txt` file must be updated with any new dependencies.

## Development Workflow

**IMPORTANT: Before running any command, ensure the virtual environment is activated.** You will see `(.venv)` at the beginning of your shell prompt.

### Running the Application

1. **Activate:** Activate the new environment.

   ```bash
   # Activate on Windows
   .venv\Scripts\activate

   # Activate on macOS/Linux
   source .venv/bin/activate
   ```

2. To run the application for development or testing:

```bash
python main.py
```

### Code Style

A consistent code style is enforced to ensure readability and maintainability.

- **Tooling:** The project uses **Ruff** for both linting and formatting.
- **Line Limit:** Code lines must not exceed **100 characters**.
- **Naming Conventions:** For acronyms in variable names, use uppercase (e.g., `api_client`, `user_id`).
- **Docstrings:** All public modules, classes, and functions must have a docstring explaining their purpose and usage.
- **Error Handling:** Do not use broad, silent exception handling. `except Exception:` must be used sparingly and should always log the error. Never use `except Exception: pass`.

### Quality Assurance: Linting, Formatting, and Testing

These checks must pass before any code is submitted.

1. **Code Style & Formatting:**

   ```bash
   # Check for linting errors
   ruff check .
   # Automatically format all files
   ruff format .
   ```

2. **Testing:** The project uses **pytest**. All tests are in the `tests/` directory.

   - Test names must be descriptive and omit the word "should" (e.g., `test_validates_input`, not `test_should_validate_input`).
   - All new features must be accompanied by corresponding tests. Code coverage must not decrease.

   ```bash
   # Run the full test suite
   pytest
   # Run tests with a coverage report
   pytest --cov=src --cov-report=term-missing
   ```

## Architecture

The application employs a modular architecture based on the principle of separation of concerns.

- `main.py`: Application entry point.
- `gui_*.py`: Presentation layer. Must only contain UI logic and delegate business logic.
- `*_module.py` / `*_manager.py`: Core business logic. Must be UI-agnostic.
- `device_interface.py`: Sole module for direct hardware communication.
- `constants.py`: Holds all static, project-wide constant values.

## Security

- **Principle of Least Privilege:** Code should only have the permissions necessary to perform its function.
- **Dependency Scanning:** Regularly scan for vulnerabilities with **pip-audit**. Any discovered vulnerabilities must be addressed immediately.

  ```bash
  pip-audit
  ```

- **API Key Management:** Secrets must be loaded from `hidock_config.json` or environment variables and never hardcoded.
- **Input Validation:** All data from external sources (UI, files, device) must be rigorously validated.

## Git Workflow

A standardized Git workflow is enforced to maintain a clean history.

1. **Pre-Commit Check:** Before committing, **ALWAYS** run the full quality suite. It must pass without errors.

   ```bash
   ruff check . && ruff format . && pytest
   ```

2. **Branching:** All work must be on a feature branch, named `feature/descriptive-name`.
3. **Commits:** Commit messages must follow the **Conventional Commits** specification.
4. **Pushing:** Never use `git push --force`. If a force-push is necessary on a feature branch, **ALWAYS** use `git push --force-with-lease`.
5. **Pull Requests (PRs):**
   - A PR must be created to merge into `main`.
   - The PR description must clearly explain the "what" and "why."
   - PRs require one review and must pass all CI checks before merging.
6. **Merging:** Use "Squash and Merge." Delete the feature branch after merging.

## Configuration

When adding a new configuration option:

1. Add the new key and a default value to `hidock_config.json`.
2. Update any related documentation to explain the new setting.
3. Ensure the application handles the absence of the new key gracefully.
