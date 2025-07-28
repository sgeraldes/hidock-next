# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

HiDock Next is a multi-platform application suite for managing HiDock recording devices locally. The project includes two main applications:

- **Desktop Application** (Python): Full-featured GUI application using CustomTkinter
- **Web Application** (React/TypeScript): Modern browser-based interface with AI transcription
- **Audio Insights Extractor** (React/TypeScript): Standalone audio analysis tool

## Architecture

### Desktop Application (`hidock-desktop-app/`)

- **Main Entry**: `main.py` - Application entry point
- **GUI Architecture**:
  - `gui_main_window.py` - Main application window and core UI logic
  - `settings_window.py` - Settings dialog and configuration management
  - `gui_*.py` files - Modular GUI components (treeview, actions, event handlers)
- **Device Communication**: `hidock_device.py` - USB device interface using pyusb/libusb
- **Configuration**: `config_and_logger.py` - Centralized config and logging system
- **File Operations**: `file_operations_manager.py` - Local file management and downloads

### Web Application (`hidock-web-app/`)

- **Framework**: React 18 with TypeScript and Vite
- **State Management**: Zustand store (`src/store/useAppStore.ts`)
- **Device Interface**: WebUSB API through `src/adapters/webDeviceAdapter.ts`
- **AI Integration**: Google Gemini API for transcription (`src/services/geminiService.ts`)
- **Routing**: React Router with pages for Dashboard, Recordings, Transcription, Settings

### Audio Insights Extractor (`audio-insights-extractor/`)

- **Purpose**: Standalone tool for audio analysis and insights
- **Framework**: React 19 with TypeScript and Vite
- **AI Integration**: Google GenAI for audio processing

## Common Development Commands

### Desktop Application

```bash
cd hidock-desktop-app

# Run the application
python main.py

# Run tests
pytest tests/ -v

# Run tests with coverage
pytest tests/ --cov=. --cov-report=html

# Code formatting and linting
black .
flake8 .
isort .
mypy .

# Install dependencies
pip install -r requirements.txt

# Install development dependencies
pip install -e .[dev]
```

### Web Application

```bash
cd hidock-web-app

# Development server
npm run dev

# Build for production
npm run build

# Run tests
npm run test

# Run tests with coverage
npm run test:coverage

# Run tests in watch mode
npm run test:watch

# Linting
npm run lint

# Install dependencies
npm install
```

### Audio Insights Extractor

```bash
cd audio-insights-extractor

# Development server
npm run dev

# Build for production
npm run build

# Preview built application
npm run preview

# Install dependencies
npm install
```

## Key Configuration Files

- **Python**: `hidock-desktop-app/pyproject.toml` - Project metadata, dependencies, and tool configuration
- **Desktop Config**: `hidock-desktop-app/hidock_tool_config.json` - Runtime application settings
- **Web Dependencies**: `hidock-web-app/package.json` - Web app dependencies and scripts
- **Test Configuration**: `hidock-desktop-app/pytest.ini` - Python test settings and markers

## Development Workflow

### Testing Strategy

- **Python**: pytest with markers for unit (`@pytest.mark.unit`), integration (`@pytest.mark.integration`), and device tests (`@pytest.mark.device`)
- **Web**: Vitest with Testing Library for React components
- **Coverage**: Minimum 80% coverage required for Python code

### Code Style

- **Python**: Black formatter (line length 88), Flake8 linting, isort for imports, mypy for type checking
- **TypeScript**: ESLint with React hooks rules, Prettier-compatible formatting

### Git Workflow

- Main branch: `main` (production-ready)
- Feature branches: `feature/feature-name`
- Bug fixes: `bugfix/bug-description`
- Conventional commits: `feat:`, `fix:`, `docs:`, `style:`, `refactor:`, `test:`, `chore:`

## Device Communication

### USB Protocol

- **Desktop**: Direct USB communication via pyusb/libusb
- **Web**: WebUSB API (requires HTTPS and user permission)
- **Device Types**: HiDock H1, H1E, P1 variants
- **Operations**: List recordings, download, play, delete, format storage, sync time

### File Formats

- **Audio**: `.hda` (HiDock proprietary format)
- **Conversion**: Uses pygame for audio playback, pydub for processing
- **Storage**: Local downloads to user-configured directory

## AI Integration

### Desktop Application

- Google Generative AI for future transcription features
- Configured through settings dialog
- API key management with secure storage

### Web Application

- Google Gemini API integration for real-time transcription
- BYOK (Bring Your Own Key) model
- Client-side processing to maintain privacy

## Dependencies

### Python (Desktop)

- `customtkinter` - Modern GUI framework
- `pyusb` - USB device communication
- `pygame` - Audio playback
- `google-generativeai` - AI integration
- Development: `pytest`, `black`, `flake8`, `mypy`

### TypeScript (Web)

- `react` / `react-dom` - UI framework
- `zustand` - State management
- `@google/generative-ai` - AI services
- Development: `vite`, `vitest`, `eslint`, `typescript`

## Important Notes

- Always run the desktop application from the `hidock-desktop-app/` directory to ensure proper icon and configuration file paths
- Web application requires HTTPS for WebUSB functionality
- Device tests require actual HiDock hardware and are marked with `@pytest.mark.device`
- Both applications support offline functionality for core device management features
- Configuration files use JSON format and should be validated before commits
