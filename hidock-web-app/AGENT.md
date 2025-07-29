# HiDock Web App

## Overview

The HiDock Web App is a modern, community-driven web application for HiDock device management and AI-powered audio transcription. This React-based application combines local device control with cloud-based AI transcription services. This document outlines the mandatory standards and procedures for its development. Adherence to these rules is not optional.

## Development Environment

A compliant development environment is critical for maintaining code quality and consistency.

1.  **Node.js and npm:** This project requires Node.js 18+ and npm 9+.
2.  **Dependencies:** Project and development dependencies are managed via `package.json`.
    ```bash
    # Install all required packages
    npm install
    ```
    The `package.json` file must be updated with any new dependencies.

## Code Style

A consistent code style is enforced to ensure readability and maintainability.

- **Tooling:** The project uses **ESLint** for linting and **Prettier** for formatting.
- **Line Limit:** Code lines must not exceed **100 characters**.
- **Naming Conventions:** For acronyms in variable names, use uppercase (e.g., `fetchURL`, `userAPI`, `itemID`).
- **Docstrings:** All exported types, interfaces, and functions must have a JSDoc docstring explaining their purpose and usage.
- **Type Safety:** **NEVER** use `@ts-expect-error` or `@ts-ignore` to suppress type errors. Address the underlying type issue.

## Quality Assurance: Linting, Formatting, and Testing

These checks must pass before any code is submitted.

1.  **Code Style & Formatting:**
    ```bash
    # Check for linting errors
    npm run lint
    # Automatically format all files
    npx prettier --write .
    ```
2.  **Testing:** The project uses **Vitest**. All tests are in the `src/` directory with a `.test.ts(x)` extension.
    - Test names must be descriptive and omit the word "should" (e.g., `it("validates input")`, not `it("should validate input")`).
    - All new features must be accompanied by corresponding tests. Code coverage must not decrease.
    ```bash
    # Run the full test suite
    npm run test
    # Run tests with a coverage report
    npm run test:coverage
    ```

## Architecture

The application employs a modular architecture based on the principle of separation of concerns.

- `src/components`: Reusable UI components.
- `src/pages`: Main application pages.
- `src/services`: API and device communication.
- `src/store`: State management (Zustand).
- `src/types`: TypeScript type definitions.
- `src/utils`: Helper functions.
- `src/constants`: Application constants.

## Security

- **Principle of Least Privilege:** Code should only have the permissions necessary to perform its function.
- **Dependency Scanning:** Regularly scan for vulnerabilities with **npm audit**. Any discovered vulnerabilities must be addressed immediately.
  ```bash
  npm audit
  ```
- **API Key Management:** Secrets must be loaded from `.env.local` and never hardcoded.
- **Input Validation:** All data from external sources (UI, API) must be rigorously validated on both the client and server.
- **Cross-Site Scripting (XSS):** Sanitize all user-generated content with a library like `dompurify` before rendering it.

## Git Workflow

A standardized Git workflow is enforced to maintain a clean history.

1.  **Pre-Commit Check:** Before committing, **ALWAYS** run the full quality suite. It must pass without errors.
    ```bash
    npm run lint && npx prettier --check . && npm run test
    ```
2.  **Branching:** All work must be on a feature branch, named `feature/descriptive-name`.
3.  **Commits:** Commit messages must follow the **Conventional Commits** specification.
4.  **Pushing:** Never use `git push --force`. If a force-push is necessary on a feature branch, **ALWAYS** use `git push --force-with-lease`.
5.  **Pull Requests (PRs):**
    - A PR must be created to merge into `main`.
    - The PR description must clearly explain the "what" and "why."
    - PRs require one review and must pass all CI checks before merging.
6.  **Merging:** Use "Squash and Merge." Delete the feature branch after merging.

## Configuration

When adding a new configuration option:

1.  Add the new key to `.env.example`.
2.  Update any configuration schemas (e.g., in `src/config/`).
3.  Update any related documentation to explain the new setting.
4.  Ensure the application handles the absence of the new key gracefully.
