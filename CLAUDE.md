# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**HiDock Next** is a **universal knowledge hub** - an integrated suite of applications that extracts insights, manages information, and produces results from ANY knowledge source (recordings, PDFs, PPTX, DOCX, MD, notes, calendar, email, Slack, and more).

### The Suite Evolution

The project evolved through four iterations, each building toward the ultimate vision:

1. **Desktop App** (`apps/desktop/`) - **First iteration: Device management focused**
   - Python/CustomTkinter GUI for managing HiDock® devices (H1, H1E, P1 models)
   - USB communication via Jensen protocol (PyUSB)
   - File sync, device settings, storage management
   - **Entry point**: Where users typically discover HiDock Next
   - **Focus**: Hardware management and basic file operations

2. **Web App** (`apps/web/`) - **Second iteration: Transcription focused**
   - React/TypeScript browser interface using WebUSB
   - AI transcription with multiple providers (Gemini, OpenAI, etc.)
   - Web-based device access (no drivers needed)
   - **Focus**: Making recordings accessible and transcribable anywhere

3. **Audio Insights** (`apps/audio-insights/`) - **Third iteration: Insights prototype**
   - AI-powered audio analysis tool
   - Extracting insights from transcriptions
   - **Focus**: Proving the concept of knowledge extraction from audio

4. **Electron App** (`apps/electron/`) - **Fourth iteration: The integrated hub** ⭐ **CURRENT FOCUS**
   - **Vision**: Universal knowledge hub integrating all previous capabilities
   - **Scope**: Not just audio, but ANY artifact as a knowledge source
   - Knowledge sources: recordings, PDFs, presentations, documents, markdown, notes, calendar events, emails, Slack messages, etc.
   - **Capabilities**: Extract data, create chunks, generate insights, manage information, produce results
   - Unified library with advanced search, filtering, and organization
   - AI-powered analysis across all knowledge sources
   - **Goal**: The central intelligence system for all your information

### Current Architecture

**Monorepo Structure:**
- `apps/desktop/` - Device management (Python/CustomTkinter) - Original entry point
- `apps/web/` - Transcription focus (React/TypeScript/WebUSB)
- `apps/audio-insights/` - Insights prototype (AI analysis)
- `apps/electron/` - **Universal knowledge hub** (integration of all capabilities)

**Shared Protocols:**
- Jensen protocol for USB communication with HiDock devices
- Common device interface abstraction across desktop/web
- Shared transcription service architecture

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
# Electron app (Universal Knowledge Hub) ⭐ PRIMARY APPLICATION
cd apps/electron && npm run dev

# Desktop app (Device Management - Original entry point)
./run-desktop.sh        # Unix/macOS
run-desktop.bat         # Windows

# Web app (Transcription Focus)
./run-web.sh            # Unix/macOS
run-web.bat             # Windows

# Or manually:
cd apps/web && npm run dev

# Audio Insights (Prototype)
cd apps/audio-insights && npm run dev
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

### Electron App (`apps/electron/`) - **Universal Knowledge Hub** ⭐

**Vision:** The central intelligence system that transforms any information source into actionable insights.

**Entry Point:** `apps/electron/electron/main/index.ts` → Electron main process

**What Makes It Different:**
- **Not just audio**: Handles recordings, PDFs, presentations, documents, markdown, notes, calendar, email, Slack, etc.
- **Universal extraction**: Extracts data and insights from ANY artifact type
- **Integrated capabilities**: Combines device management, transcription, and AI analysis from all previous iterations
- **Knowledge-first**: Organized around insights and information, not just files

**Current Focus (Wave 4 Refactor):**
We're currently implementing a comprehensive UI/UX redesign and auto-refresh system for the Knowledge Library:
- **Auto-refresh**: Real-time updates when new recordings/artifacts are detected
- **Waveform loading**: Immediate audio visualization on selection
- **Enhanced UI**: Clear labels, location badges, responsive layout
- **Accessibility**: WCAG 2.1 AA compliance with keyboard navigation and screen reader support
- **Universal library**: Preparing architecture for multi-artifact-type support

**Technology Stack:**
- **Frontend**: React 18 + TypeScript + Tailwind CSS
- **State Management**: Zustand
- **Backend**: Electron main process (Node.js)
- **Database**: SQLite (better-sqlite3) for local knowledge storage
- **AI Integration**: Multiple transcription providers, future multi-modal analysis
- **Device Communication**: IPC bridge to device services

**Key Services:**
- **Recording Watcher** (`recording-watcher.ts`) - File system monitoring for auto-refresh
- **Device Service** - USB device communication (inherited from desktop app architecture)
- **Transcription Service** - Multi-provider AI transcription
- **Download Service** - 4-layer reconciliation for accurate sync status
- **Calendar Service** - Meeting correlation with recordings (future: all artifacts)
- **Metadata Service** - Unified metadata management across artifact types

**Core Components:**
- **Knowledge Library** (`pages/Library.tsx`) - Main unified view of all knowledge sources
  - Currently: Recordings with device/local/synced status
  - Future: PDFs, documents, presentations, notes, emails, etc.
- **Device Management** (`pages/Device.tsx`) - HiDock device sync and management
- **Unified Recordings Hook** (`hooks/useUnifiedRecordings.ts`) - Data aggregation and state management
- **Operation Controller** (`components/OperationController.tsx`) - Audio playback, waveform generation
- **Middle Panel** (`components/MiddlePanel.tsx`) - Action buttons and metadata display
- **Source Rows** (`components/SourceRow.tsx`) - Individual knowledge item display

**Future Architecture (Multi-Artifact Support):**
```
Knowledge Library
├── Recordings (current focus)
├── Documents (PDF, DOCX, PPTX)
├── Notes (MD, text)
├── Communications (Email, Slack)
├── Calendar Events
└── Web Artifacts (bookmarks, articles)

Each artifact type:
- Unified metadata schema
- AI-powered extraction and chunking
- Cross-artifact search and linking
- Insight generation and correlation
```

**Database Schema:**
- `recordings` - Audio file metadata
- `synced_files` - Sync status tracking
- `transcriptions` - AI-generated transcripts
- `meetings` - Calendar event correlation
- Future: `documents`, `notes`, `communications`, `insights`, `chunks`, `embeddings`

**IPC Architecture:**
- Main process: Device management, file watching, database operations
- Renderer process: React UI, user interactions
- IPC channels: `recording:new`, `download:complete`, `device:connected`, etc.
- Future: Generic artifact channels for all knowledge sources

---

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

### QA Logging Rules (Electron App)

**Context:** QA logs are development/debugging logs controlled by the QA Logs toggle in Settings sidebar.

**MUST:**
- Always respect `qaLogsEnabled` toggle from `useUIStore`
- Use consistent `[QA-MONITOR]` prefix for all QA logs
- For services/classes: Use `useUIStore.getState().qaLogsEnabled` check
- For React components: Use `const qaEnabled = useUIStore((s) => s.qaLogsEnabled)` selector
- For preload scripts: Read from localStorage bridge (context isolation prevents store access)

**MUST NOT:**
- Hardcode `DEBUG = true` constants (ties logs to runtime config instead)
- Use `console.log('[QA-MONITOR]')` directly without toggle check
- Bypass toggle with `if (true)` or `if (import.meta.env.DEV)` guards alone

**Preload Script Pattern** (context isolation workaround):
```typescript
// electron/preload/index.ts
let qaEnabled = false
try {
  const stored = localStorage.getItem('hidock-ui-store')
  if (stored) {
    const { state } = JSON.parse(stored)
    qaEnabled = state?.qaLogsEnabled ?? false
  }
} catch { /* fail silently */ }

if (qaEnabled) console.log('[QA-MONITOR] ...')
```

**Service/Class Pattern:**
```typescript
// src/services/*.ts, src/hooks/*.ts
import { useUIStore } from '@/store'

const qaEnabled = useUIStore.getState().qaLogsEnabled
if (qaEnabled) console.log('[QA-MONITOR] ...')
```

**React Component Pattern:**
```typescript
const qaEnabled = useUIStore((s) => s.qaLogsEnabled)

useEffect(() => {
  if (qaEnabled) console.log('[QA-MONITOR] ...')
}, [qaEnabled])
```

**Why this matters:** Without toggle checks, QA logs spam console even when user disables them. The QA Logging System Audit (2026-02-27) found 52+ log statements not respecting the toggle. See `apps/electron/QA_LOGGING_AUDIT.md` for full findings.

**Related:**
- Architecture decision: `LESSON-0014-evolutionary-agent-audit-with-validation.md`
- Audit report: `apps/electron/QA_LOGGING_AUDIT.md`

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

---

## Branding & Visual Identity

### App Icon Guidance (Electron App)

**What the Icon Should NOT Represent:**
- ❌ Audio waveforms or recording metaphors (that's the device's job, not the app)
- ❌ Microphones or recording hardware (this is not a recording app)
- ❌ Simple file management or folders (too generic, misses the intelligence aspect)
- ❌ Device hardware (that's just one entry point, not the vision)

**What the Icon SHOULD Represent:**
The Electron app icon should communicate that this is a **universal knowledge hub** - a central intelligence system for ALL information sources.

**Core Concepts to Convey:**
- **Central nexus/hub** - Where ALL information flows and connects
- **Universal connectivity** - Any source, any format (not just audio)
- **Intelligence/AI processing** - Extracting meaning from chaos
- **Knowledge synthesis** - Combining disparate sources into insights
- **Organized understanding** - Making information actionable

**Recommended Icon Directions:**

1. **The Knowledge Sphere** (Primary recommendation)
   - Central glowing sphere/orb representing core intelligence
   - Orbital rings or particles representing different data sources flowing in
   - Everything flows to the center, gets processed, outputs insights
   - Colors: Deep blue/purple core → bright cyan/white glow (intelligence/processing)
   - Feel: Sophisticated, AI-powered, universal, professional

2. **The Knowledge Nexus**
   - Central node with connections radiating outward
   - Different connection points for different sources (files, calendar, email, chat, audio)
   - Neural network hub aesthetic
   - Suggests: "Everything connects here"

3. **The Universal Dock**
   - Multiple "slots" or connection points (literal multi-port dock)
   - Modern, clean, professional
   - Central platform where everything plugs in
   - Literal interpretation of "docking" any information source

4. **The Insight Engine**
   - Geometric shape (hexagon/circle) with processing visual inside
   - Suggests transformation: raw data → insights
   - Glowing/gradient to suggest active intelligence
   - Subtle icons of different data types flowing in

**Design Principles:**
- **Scalable**: Must work at 16x16, 32x32, 256x256, 512x512 pixels
- **Strong silhouette**: Recognizable even without color
- **Avoid fine details**: Won't show at small sizes
- **Platform guidelines**: macOS rounded square, Windows flexible
- **Cross-platform**: Works on taskbar/dock

**Color Palette Suggestions:**
- **Primary**: Deep blue → cyan gradient (tech, intelligence, professional)
- **Alternative**: Purple → pink gradient (creative, modern, knowledge/insight)
- **Accent**: Orange/amber for active/processing states
- **Glow effects**: White/cyan for intelligence indicators

**Comparison to Similar Apps:**
- **Notion**: Organization + knowledge
- **Obsidian**: Knowledge graph + connections
- **Mem.ai**: AI-powered knowledge hub
- **HiDock Next**: Universal intelligence + multi-source insights

### Per-App Identity

While the Electron app is the unified vision, each app has its subset focus:

- **Desktop App**: Device-first, hardware management icon (USB device, dock connector)
- **Web App**: Transcription-first, accessibility icon (speech bubbles, text from audio)
- **Audio Insights**: Analysis-first, insight icon (magnifying glass + waveform)
- **Electron App**: **Knowledge hub** icon (nexus, sphere, universal connector)

---
