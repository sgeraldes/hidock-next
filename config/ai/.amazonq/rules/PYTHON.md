# AI Assistant Operational Rules: hidock-next Project

This document contains the mandatory, non-negotiable rules and procedures for all Python development on this project. As an AI assistant, you must adhere to these rules without exception to ensure code quality, consistency, and maintainability. All project configurations are defined in `pyproject.toml`. For general contribution guidelines for human developers, refer to `CONTRIBUTING.md`.

---

## 1. Core Directives

- **Test-Driven Development (TDD) is Mandatory:** You must always follow the "Red-Green-Refactor" cycle for every change.
    1. **Red:** Write a failing test that precisely defines the new functionality or bug fix. The test must fail for the expected reason.
    2. **Green:** Write the simplest, most direct implementation code possible to make the test pass. Do not add any logic beyond what is required to satisfy the test.
    3. **Refactor:** Improve the implementation code's structure and clarity while ensuring all tests continue to pass.

- **Follow the Plan:** All development must follow the established plan in the `docs/` folder. Start with `design.md`, proceed to `development_approach.md`, and execute tasks sequentially from the `phaseN_tasks.md` files. Mark tasks as complete (`~~strikethrough~~` or `[Completed]`) as you finish them.

- **Adherence to Project Standards:** You must operate strictly within the established standards of this project. This includes the branching strategy, code style, and commit conventions detailed in this document and in `CONTRIBUTING.md`.

- **File Organization Compliance:** You must strictly follow the project structure documented in `INDEX.md`. Never create documents, tests, or code files outside their designated directories. Always consult `INDEX.md` before creating new files to ensure proper placement within the established architecture.

- **Integrity of Tooling:** You are strictly forbidden from modifying any configuration files (e.g., `.pre-commit-config.yaml`, `pyproject.toml`) to bypass or disable tests, linters, or any other quality checks.

---

## 2. Environment & Dependencies

- **Windows Command Execution:** When running commands that require virtual environment activation on Windows, ALWAYS use `call` for batch files:
    ```cmd
    call .venv\Scripts\activate.bat && python -m pytest
    ```
    NOT: `.venv\Scripts\activate && python -m pytest` (this will fail)

- After activating the virtual environment, you must install dependencies using the "editable" flag. This command is mandatory because it installs the project in a way that links directly to the source code and includes all development tools specified in `pyproject.toml`.

    ```bash
    # This is the only supported installation method for development.
    pip install -e ".[dev]"
    ```

- **Adding New Dependencies:** To add a new dependency, you must add it to the appropriate list (`dependencies` or `dev`) in the `pyproject.toml` file before running the installation command. Do not use `pip freeze`.

---

## 3. Mandatory Development Workflow

You must follow this exact sequence for every task. This workflow is designed to ensure quality at every step.

### Step 1: Write the Tests

- **Test Location Rules:**
  - Always place tests in the `tests/` directory as documented in INDEX.md
  - **MANDATORY: Integrate tests into existing test modules** - never create standalone test files unless absolutely necessary
  - Follow naming convention: `test_<module_name>.py` for the module being tested
  - **Consult INDEX.md for existing test file structure** before creating new files
  - Add to existing test classes when logical (e.g., `TestFileOperationsManager`, `TestDeviceInterface`)
  - Only create new test files when no appropriate existing file exists AND the functionality is substantial enough to warrant its own module
  - **File Organization Priority**: Follow the comprehensive test structure documented in INDEX.md under `hidock-desktop-app/tests/`

- **Test Structure:**
  - Add test methods to existing test classes when logical
  - Create new test classes using descriptive names (e.g., `TestDirectoryChange`)
  - Write clear, concise tests that cover all requirements of the task
  - A good test is isolated, repeatable, and validates a single behavior

- **Test Execution:**
  - Use the pytest markers defined in `pyproject.toml` (`@pytest.mark.unit`, `@pytest.mark.integration`, etc.) to correctly categorize tests
  - Run `pytest` and confirm that the new tests fail with an `AssertionError` as expected
  - Do not proceed until the test fails correctly

### Step 2: Write Implementation Code

- Write the minimum amount of code required to make the tests pass. Avoid adding any functionality not explicitly required by the tests.
- **All new code must be fully type-hinted.** You must adhere to the strict `mypy` rules defined in `pyproject.toml`. Untyped functions or classes are not permitted.

### Step 3: Run Local Validation Suite

- After the tests pass, and before creating a commit, you must run the full local validation suite. This step is a critical guard against broken commits and failed CI builds.

    ```bash
    # 1. Format code to ensure consistency
    python -m black .
    isort .

    # 2. Run all linters and type checks for code quality
    python -m flake8 .
    python -m pylint .
    mypy .

    # 3. Run all tests to confirm nothing has broken
    python -m pytest
    ```

---

## 4. Quality Gates (Definition of Done)

A task is considered complete if and only if it meets **all** of the following criteria. These are enforced by the CI pipeline and are non-negotiable.

1. **Formatting:** Code must be formatted by `black` and `isort` (120-character line length).
2. **Linting:** Code must pass `flake8` and `pylint` with zero errors.
3. **Type Safety:** Code must pass `mypy` with zero errors under its strict configuration.
4. **Tests:** All tests must pass.
5. **Coverage:** Test coverage must be **at or above 80%**.
6. **Security:** Code must not contain hardcoded secrets (API keys, passwords, etc.). Use configuration files or environment variables for sensitive data.

---

## 5. Submission Protocol

To maintain a clean and understandable project history, all contributions must follow these submission guidelines.

### 5.1. Branching Strategy

- **Main Branches:** `main` is for production-ready code. `develop` is the integration branch for new features. Direct commits to these branches are forbidden.
- **Feature Branches:** All development must occur on feature branches created from `develop`.
- **Branch Naming:** Branch names must be descriptive and follow the pattern `<type>/<short-description>`, for example:
  - `feature/add-user-authentication`
  - `fix/device-connection-timeout`
  - `docs/update-contribution-rules`

### 5.2. Commit Messages

- **Conventional Commits:** All commit messages must follow the [Conventional Commits v1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) specification. This is not optional.
- **Format:** `<type>: <description>`
- **Example:**
  - **Good:** `feat: add support for H1E device model`
  - **Bad:** `added new stuff`

### 5.3. Docstrings

- **Format:** All public modules, classes, and functions must have docstrings following the **Google Python Style Guide**.
- **Content:** Docstrings must describe the purpose of the code, all arguments (`Args:`), and all return values (`Returns:`).
- **Example:**

    ```python
    def connect_device(device_id: str, timeout: int = 5) -> bool:
        """Connects to a specified HiDock device.

        Args:
            device_id: The unique identifier of the device to connect to.
            timeout: The time in seconds to wait for a connection.

        Returns:
            True if the connection was successful, False otherwise.
        """
    ```

### 5.4. Error Handling

- **Clarity:** Implement clear and specific error handling. Do not suppress errors silently.
- **Custom Exceptions:** Use custom exception classes for application-specific errors where appropriate, rather than raising generic `Exception`. This allows for more precise error handling by callers.
