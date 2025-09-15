# Gemini Project Context: HiDock Next

This document provides context for the HiDock Next project, a suite of applications for managing HiDock® devices.

## Project Overview

HiDock Next is a community-driven, open-source project that provides desktop and web applications for managing files on HiDock® devices. It is not affiliated with the official HiDock brand. The project is a monorepo containing a desktop application, a web application, and an audio analysis tool.

The core functionalities include:
-   **Device File Management**: Browse, download, and organize files from HiDock® devices.
-   **AI Transcription**: Integrated with over 11 AI providers, including Google Gemini.
-   **Advanced Audio Player**: Features waveform visualization.
-   **Calendar Integration**: Correlates audio files with meetings (Windows only).

### Applications

-   **Desktop App**: A full-featured desktop application built with Python and CustomTkinter for Windows, macOS, and Linux.
-   **Web App**: A modern, browser-based interface built with React and TypeScript, using the WebUSB API for device communication.
-   **Audio Insights**: A tool for AI-powered analysis and transcription of audio files.

## Building and Running

### Desktop Application

**Technology Stack:**
-   **Python**: 3.12+
-   **GUI**: CustomTkinter
-   **Device Communication**: PyUSB
-   **Audio**: Pygame
-   **Dependencies**: `pyproject.toml`

**Commands:**
-   **Setup (Windows):** `setup-windows.bat`
-   **Setup (macOS/Linux):** `./setup-unix.sh`
-   **Run (Windows):** `run-desktop.bat`
-   **Run (macOS/Linux):** `./run-desktop.sh`
-   **Run Tests:** `cd apps/desktop && pytest tests/`

### Web Application

**Technology Stack:**
-   **Framework**: React 18 with TypeScript
-   **Build Tool**: Vite
-   **Styling**: Tailwind CSS
-   **State Management**: Zustand
-   **Dependencies**: `package.json`

**Commands:**
-   **Install Dependencies:** `cd apps/web && npm install`
-   **Run Dev Server:** `npm run dev`
-   **Build:** `npm run build`
-   **Run Tests:** `npm run test`

## Development Conventions

### Code Style

-   **Line Length**: 120 characters for all languages.
-   **Python**:
    -   **Formatting**: Black
    -   **Linting**: Flake8, Pylint
    -   **Import Sorting**: isort
    -   **Type Checking**: mypy
-   **TypeScript/JavaScript**:
    -   **Linting**: ESLint with React hooks rules.

### Testing

-   The project has a strong emphasis on testing, with over 581 tests.
-   **Desktop App**:
    -   Uses `pytest` for unit, integration, performance, and device tests.
    -   Aims for 80% minimum test coverage.
-   **Web App**:
    -   Uses `vitest` and `React Testing Library` for component, service, and integration tests.

### Pre-commit Hooks

The project uses pre-commit hooks to automate code quality checks before commits. These are configured in `.pre-commit-config.yaml` and are installed as part of the developer setup.
