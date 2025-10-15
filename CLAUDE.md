# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

HiDock Next is a suite of applications for managing HiDock® devices. It's a monorepo containing:
- **Desktop App** (`apps/desktop/`) - Python/CustomTkinter GUI for device management
- **Web App** (`apps/web/`) - React/TypeScript browser interface using WebUSB
- **Audio Insights** (`apps/audio-insights/`) - AI-powered audio analysis tool

The project implements the Jensen protocol for USB communication with HiDock devices (H1, H1E, P1 models).

## Essential Commands

### Initial Setup

```bash
# Interactive setup (prompts for developer/end-user mode)
python setup.py

# Non-interactive developer setup (recommended for automated workflows)
python setup.py --non-interactive

# Force recreation of virtual environment
python setup.py --force-new-env

# Skip specific features during setup
python setup.py --skip-web --skip-audio
```

### Running Applications

```bash
# Desktop app
./run-desktop.sh        # Unix/macOS
run-desktop.bat         # Windows

# Web app
./run-web.sh            # Unix/macOS
run-web.bat             # Windows

# Or manually:
cd apps/web && npm run dev
```

### Testing

```bash
# Fast unit tests (default - skips integration/gui/slow)
pytest

# Run all tests (including integration, GUI, slow)
pytest -m ""

# Specific test markers
pytest -m unit              # Unit tests only
pytest -m integration       # Integration tests
pytest -m "unit or slow"    # Combine markers

# Web app tests
cd apps/web && npm test
```

Test markers are defined in `pytest.ini`:
- `unit` - Fast, pure-Python tests
- `integration` - External system dependencies
- `gui` - Requires display/GUI toolkit
- `slow` - Long-running tests
- `optional` - Requires optional heavy dependencies

### Code Quality

```bash
# Format Python code
black apps/desktop --line-length 120
isort apps/desktop --profile black --line-length 120

# Lint Python
ruff check apps/desktop --fix
flake8 apps/desktop --max-line-length 120

# Lint TypeScript/JavaScript
cd apps/web && npm run lint

# Pre-commit hooks (runs automatically on commit)
pre-commit run --all-files
```

Line length is **120 characters** for all languages.

### Building

```bash
# Desktop app distribution build
python scripts/build/build_desktop.py
```

## Architecture

### Desktop App (`apps/desktop/`)

**Entry Point:** `apps/desktop/main.py` → `gui_main_window.py`

**Core Components:**

1. **Device Communication Layer**
   - `hidock_device.py` - `HiDockJensen` class implements Jensen protocol over USB (PyUSB)
   - `device_interface.py` - Abstract device interface defining common operations
   - `desktop_device_adapter.py` - Adapter bridging `HiDockJensen` to `DeviceInterface`
   - `constants.py` - USB IDs, command codes, protocol constants

2. **GUI Architecture** (Mixin Pattern)
   - `gui_main_window.py` - `HiDockToolGUI` class (inherits from `customtkinter.CTk`)
   - Mixins for modular functionality:
     - `TreeViewMixin` - File list display
     - `DeviceActionsMixin` - Device operations (connect, settings, format)
     - `FileActionsMixin` - File operations (download, delete, transcribe)
     - `EventHandlersMixin` - UI event handling
     - `AuxiliaryMixin` - Helper methods
     - `AsyncCalendarMixin` - Calendar integration
     - `AudioMetadataMixin` - Audio metadata management

3. **Feature Modules**
   - `audio_player_enhanced.py` - Audio playback with waveform visualization
   - `audio_visualization.py` - Waveform rendering
   - `transcription_module.py` - AI transcription (11+ providers)
   - `ai_service.py` - AI provider abstraction
   - `calendar_service.py` - Calendar integration (Windows Outlook)
   - `file_operations_manager.py` - Batch file operations
   - `storage_management.py` - Storage monitoring
   - `settings_window.py` - Settings dialog

4. **Configuration & Logging**
   - `config_and_logger.py` - Centralized config/logging (`hidock_config.json`)
   - Settings persisted in JSON with automatic save on change

**Device Protocol:**
- Jensen protocol commands defined in `constants.py` (CMD_GET_FILE_LIST, CMD_TRANSFER_FILE, etc.)
- USB endpoints: OUT=0x01, IN=0x82
- Vendor ID: 0x10D6 (Actions Semiconductor)
- Product IDs: 0xAF0C (H1), 0xAF0D/0xB00D (H1E), 0xAF0E/0xB00E (P1)

### Web App (`apps/web/`)

**Technology Stack:**
- React 18 + TypeScript
- Vite (build tool)
- Tailwind CSS (styling)
- Zustand (state management)
- WebUSB API (device communication)

**Key Files:**
- `src/interfaces/deviceInterface.ts` - TypeScript device interface (mirrors Python)
- `src/adapters/webDeviceAdapter.ts` - WebUSB implementation
- `src/services/deviceService.ts` - Device operations
- `src/services/geminiService.ts` - AI transcription
- `src/store/useAppStore.ts` - Global state

**Commands:**
```bash
cd apps/web
npm install          # Install dependencies
npm run dev          # Development server
npm run build        # Production build
npm test             # Run tests (Vitest)
npm run lint         # ESLint
```

### Shared Concepts

Both desktop and web apps implement the same device interface abstraction:
- `DeviceModel` enum (H1, H1E, P1, UNKNOWN)
- `DeviceCapability` enum (file operations, time sync, settings, etc.)
- `ConnectionStatus` enum (disconnected, connecting, connected, error)

## Virtual Environment Strategy

**Critical:** This project uses **platform-specific virtual environments** in `apps/desktop/`:

| Platform | Directory | Reason |
|----------|-----------|--------|
| Windows | `.venv.win` | Native Windows |
| WSL | `.venv.wsl` | Windows Subsystem for Linux |
| Linux | `.venv.linux` | Bare metal Linux |
| macOS | `.venv.mac` | macOS |

**Why?** Binary wheels (pygame, psutil, etc.) are platform-specific. Cross-platform sharing breaks imports.

**Automatic selection:** `scripts/env/select_venv.py` detects platform and selects correct environment.

**Migration from legacy `.venv`:**
```bash
python setup.py --migrate=copy      # Copy packages to tagged env
python setup.py --migrate=rebuild   # Rebuild from scratch
python setup.py --migrate=skip      # Keep legacy
```

See `docs/VENV.md` for detailed documentation.

## Development Workflow

### Making Changes

1. **Setup dev environment:** `python setup.py` (choose developer mode)
2. **Install pre-commit hooks:** Done automatically during setup
3. **Make changes** in appropriate app directory
4. **Run fast tests:** `pytest` (or `cd apps/web && npm test`)
5. **Commit:** Pre-commit hooks run automatically (black, isort, ruff, pytest-fast)

### Pre-commit Hooks

Configured in `.pre-commit-config.yaml`:
- Code formatting (black, isort, ruff-format)
- Linting (ruff, bandit for security)
- YAML/whitespace checks
- Fast pytest suite (unit tests only)

**Skip tests in commit:** `SKIP_TESTS=1 git commit`

### Test Organization

- Desktop tests: `apps/desktop/tests/`
- Web tests: `apps/web/src/test/`
- Root-level tests: `tests/` (core infrastructure only)

By default, `pytest` only discovers tests in `tests/` (see `pytest.ini` `testpaths`).
To test desktop app: `pytest apps/desktop/tests`

### Key Files to Know

- `setup.py` - Thin wrapper delegating to `hidock_bootstrap.py`
- `hidock_bootstrap.py` - Multi-phase setup logic (venv creation, dependency installation)
- `pyproject.toml` - Python project metadata, optional dependencies, tool configs
- `pytest.ini` - Test configuration, markers, default filter
- `conftest.py` - Global pytest configuration

## Common Patterns

### Adding a New AI Provider

1. Add provider credentials to `config_and_logger.py` default config
2. Implement provider in `ai_service.py` (follow OpenAI/Gemini pattern)
3. Add UI selector in `settings_window.py`
4. Update `transcription_module.py` to route to new provider

### Adding a New Device Command

1. Define command ID in `constants.py`
2. Implement protocol method in `hidock_device.py`
3. Add high-level method in `desktop_device_adapter.py`
4. Expose in UI via appropriate mixin (`DeviceActionsMixin`, etc.)

### Modifying GUI

- Main window structure in `gui_main_window.py.__init__()`
- Add UI elements in relevant mixin (e.g., new file action → `FileActionsMixin`)
- Keep business logic in separate modules (not in GUI code)
- Use `self.run_async()` for background operations to prevent UI freeze

## Dependencies

**Python (Desktop):**
- customtkinter 5.2+ (GUI framework)
- pyusb 1.2+ (USB communication)
- pygame 2.5+ (audio playback)
- numpy, pydub (audio processing)
- requests (HTTP, AI APIs)

**JavaScript/TypeScript (Web):**
- React 18
- Vite
- Zustand (state)
- Tailwind CSS
- Vitest (testing)

**Optional dependencies** (can skip with `--skip-web`, `--skip-audio`):
- Web app dependencies (Node.js 18+)
- Audio processing dependencies (ffmpeg system package)

## Platform-Specific Notes

### Linux
System dependencies may be required:
```bash
sudo apt install python3-tk python3-dev ffmpeg libusb-1.0-0-dev libudev-dev build-essential
sudo usermod -a -G dialout $USER  # USB access
```

Or use automated installer: `python setup.py --auto-install-missing`

### Windows
- Calendar integration uses Windows Outlook COM automation
- USB drivers auto-installed by Windows for HiDock devices

### macOS
- Calendar integration not supported (Windows-only)
- libusb installed via Homebrew if needed

## Important Conventions

- **Line length:** 120 characters (Python & TypeScript)
- **Import sorting:** isort with black profile
- **Type hints:** Required for new Python code
- **Docstrings:** Google style preferred
- **Logging:** Use `logger` from `config_and_logger.py`, not print statements
- **Error handling:** Catch specific exceptions, log with context

## Testing Philosophy

- Fast feedback loop: default `pytest` runs only fast unit tests
- Integration tests require explicit opt-in: `pytest -m integration`
- GUI tests skipped by default (need display)
- Maintain 80%+ coverage for critical paths
- Mock external dependencies (USB devices, AI APIs, calendar)

## Configuration

Application config stored in `hidock_config.json` (auto-created):
- Device connection settings (VID/PID)
- AI provider API keys
- Download directory
- Calendar sync settings
- UI preferences (theme, geometry)

## Troubleshooting

### Common Issues

1. **"No backend available" (PyUSB error)**
   - Solution: Install libusb (`--auto-install-missing` on Linux)

2. **Import errors after switching platforms**
   - Solution: Use correct `.venv.<platform>` or recreate with `--force-new-env`

3. **Tests failing on commit**
   - Solution: Run `pytest` manually to see failures, or `SKIP_TESTS=1 git commit`

4. **Web app not connecting to device**
   - Check browser supports WebUSB (Chrome/Edge/Opera)
   - HTTPS required (or localhost for dev)

See `docs/TROUBLESHOOTING.md` for detailed guide.
