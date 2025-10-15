# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

HiDock Next is a comprehensive community-driven platform for HiDock device management and AI-powered audio transcription. The project consists of three main applications:

1. **Desktop Application** (hidock-desktop-app/) - Python/CustomTkinter with full device control and 11 AI providers
2. **Web Application** (hidock-web-app/) - React/TypeScript browser-based interface with WebUSB
3. **Audio Insights Extractor** (audio-insights-extractor/) - Standalone React audio analysis tool

## Essential Commands

### Development Setup
```bash
# Automated setup (recommended)
python setup.py  # Choose option 2 for developers

# Manual desktop app setup
cd hidock-desktop-app
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -e ".[dev]"

# Manual web app setup
cd hidock-web-app
npm install
```

### Running Applications
```bash
# Desktop Application
cd hidock-desktop-app
source .venv/bin/activate  # Windows: .venv\Scripts\activate
python main.py

# Web Application
cd hidock-web-app
npm run dev  # Serves on http://localhost:5173

# Audio Insights Extractor
cd audio-insights-extractor
npm run dev
```

### Testing and Quality
```bash
# Desktop app testing (581 comprehensive tests)
cd hidock-desktop-app
pytest                    # All tests with coverage
pytest -m unit          # Unit tests only (~400 tests)
pytest -m integration   # Integration tests (~150 tests)  
pytest -m device        # Device tests (~30 tests, requires hardware)

# Web app testing
cd hidock-web-app
npm test                 # Run test suite
npm run test:coverage    # With coverage report

# Code quality checks
pre-commit run --all-files   # All quality checks
black . && isort .          # Format Python code
npm run lint                # Lint TypeScript/JavaScript
```

### Build Commands
```bash
# Desktop app dependencies
pip install -e ".[dev]"     # Install with dev dependencies

# Web app build
npm run build               # Production build
npm run preview             # Preview production build

# TypeScript compilation
npm run build               # Includes TypeScript compilation (tsc && vite build)
```

## Architecture and Code Standards

### Project Structure
- **hidock-desktop-app/**: Main Python application with CustomTkinter GUI
- **hidock-web-app/**: React TypeScript web application  
- **audio-insights-extractor/**: Standalone React analysis tool
- **docs/**: Comprehensive documentation
- **setup.py**: Automated setup script for both end users and developers

### Technology Stack
- **Desktop**: Python 3.12+, CustomTkinter, PyUSB, Pygame, Cryptography
- **Web**: React 18, TypeScript, Vite, Tailwind CSS, Zustand, WebUSB API
- **AI**: 11 providers including Google Gemini, OpenAI, Anthropic, local models (Ollama, LM Studio)

### Code Quality Standards
- **Line Length**: 120 characters across all files (Python, TypeScript, JavaScript)
- **Python**: Black formatting, Flake8 linting, isort import sorting, mypy type checking
- **TypeScript**: ESLint with React hooks rules, strict TypeScript configuration
- **Testing**: 80% minimum coverage requirement, TDD approach with comprehensive test suite

### Key Components

#### Device Communication (hidock_device.py)
- Jensen protocol implementation for USB communication
- Supports H1, H1E, and P1 HiDock models
- Robust error handling with retry mechanisms and health checks
- Intelligent caching (30s device info, 60s storage data)

#### GUI Architecture (gui_main_window.py, settings_window.py)
- CustomTkinter-based modern interface with dark/light themes
- Enhanced device selector with proper enable/disable functionality  
- Audio visualization with real-time waveform and spectrum analysis
- Comprehensive settings dialog with encrypted API key storage

#### Configuration Management (config_and_logger.py)
- JSON-based configuration with validation and error handling
- Fernet encryption for secure API key storage
- Performance optimizations with intelligent settings caching
- Backward compatibility and migration support

### Development Workflow

#### Essential Development Guidelines
1. **Use pyproject.toml**: All Python dependencies defined here, never use requirements.txt
2. **Test-Driven Development**: Write failing tests first (Red-Green-Refactor cycle)
3. **Mock External Dependencies**: USB devices, AI services, GUI components properly mocked
4. **Settings Testing**: Use proper validation ranges (temperature: 0.0-2.0, tokens: 1-32000)
5. **Device Selector**: Use `set_enabled()` method, not `configure(state=...)`

#### Pre-commit Hooks
- Automatically installed with developer setup
- Includes Black, isort, Flake8, ESLint, security scanning
- Enforces 120-character line length across all code
- Runs on every commit to maintain code quality

#### Testing Strategy
- **581 comprehensive tests** in desktop application
- Unit tests for individual functions with sophisticated mocking
- Integration tests for component interactions
- Device tests for hardware validation (requires actual HiDock device)
- 80% minimum coverage requirement enforced by pytest configuration

### Performance Considerations
- **Background Processing**: Non-blocking operations with threading and progress tracking
- **Intelligent Caching**: Device info (30s), storage data (60s), file metadata persistence
- **UI Responsiveness**: 150ms debouncing for file selection, smart cancellation
- **Audio Optimization**: Downsampling to ~2000 points for visualization performance
- **Settings Performance**: Only save changed settings, not entire configuration

### Security and Privacy
- **Local-First Architecture**: Core functionality works offline
- **Encrypted Storage**: API keys secured with Fernet encryption  
- **No Telemetry**: Zero data collection or tracking
- **BYOK Model**: Bring Your Own Key for AI services

### Common Development Patterns

#### Adding New AI Providers
1. Study existing providers in `hidock-desktop-app/ai_service.py`
2. Implement provider class following the `AIProvider` interface
3. Add configuration to settings UI with proper validation
4. Write comprehensive tests with mock responses
5. Update documentation with setup instructions

#### GUI Component Development
- Use CustomTkinter components and themes consistently
- Proper state management with enable/disable patterns
- Mock GUI components in tests to avoid platform dependencies
- Follow established patterns for error handling and user feedback

#### Device Communication
- Use Jensen protocol implementation in `hidock_device.py`
- Implement proper error handling and retry mechanisms
- Include both unit and integration tests
- Consider caching strategies for performance

### Documentation
- **CONTRIBUTING.md**: Detailed contribution guidelines and development workflow
- **docs/DEVELOPMENT.md**: Technical development guide with architecture details
- **docs/TESTING.md**: Comprehensive testing documentation
- **docs/TROUBLESHOOTING.md**: Common issues and solutions
- **README.md files**: Application-specific documentation in each directory

### Important Notes for Claude Code
- Always use `pip install -e ".[dev]"` for Python development setup
- Run tests before making changes to understand existing functionality
- Follow TDD approach: write failing tests first, then implement
- Use existing test files as patterns for new tests
- Maintain 80% test coverage requirement
- Respect the 120-character line length standard
- Check pre-commit hooks pass before committing changes

### Environment and Shell Considerations
- **Bash Tool Execution**: Even when launched from PowerShell (pwsh), the Bash tool executes commands in a bash environment
- **Python Execution**: Use `python3` command rather than `python` in this environment
- **Virtual Environment**: May have Unix-style structure (.venv/bin/) even on Windows - dependencies installed globally work fine
- **Batch Files**: Windows batch files (.bat) need to handle multiple Python executable paths for cross-environment compatibility
- **Application Launch**: Desktop app runs successfully with `cd hidock-desktop-app && python3 main.py`