# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Architecture

HiDock Next is a multi-platform application suite for HiDock device management with AI transcription capabilities:

- **Desktop App** (`hidock-desktop-app/`): Python 3.12+ GUI using CustomTkinter, handles USB device communication via PyUSB, audio processing with pygame/pydub, and comprehensive AI provider integration
- **Web App** (`hidock-web-app/`): React 18 + TypeScript + Vite SPA with WebUSB device access, Zustand state management, and Tailwind CSS
- **Audio Insights Extractor** (`audio-insights-extractor/`): Standalone React 19 + TypeScript tool for batch audio analysis with Google GenAI

### Key Architectural Patterns

**Desktop App (Python):**
- **Device Communication**: USB operations run in background threads with proper lock management and collision prevention
- **AI Service Architecture**: Unified interface supporting 11 providers (OpenAI, Anthropic, Google, etc.) with encrypted API key storage
- **Audio Processing**: Real-time waveform/spectrum visualization with FFT, variable speed playback, background loading with smart cancellation
- **Settings Management**: JSON-based configuration with encrypted API keys, cached device info (30s) and storage data (60s)
- **File Operations**: HTA-to-WAV conversion, batch processing queues, persistent metadata cache

**Web App (React):**
- **State Management**: Zustand stores for device, audio, and AI state
- **Device Access**: WebUSB API for direct browser-device communication
- **Routing**: React Router DOM for SPA navigation
- **Styling**: Tailwind CSS with responsive design patterns

**Cross-Component Standards:**
- All components support the same AI provider interface and configuration format
- Shared audio format support: HDA (native), WAV (primary), MP3, FLAC, M4A
- Consistent error handling and user feedback patterns

## Essential Commands

### Setup Commands

```bash
# End user setup (just run apps)
python setup.py  # Choose option 1

# Developer setup (full environment with tests/linting)
python setup.py  # Choose option 2

# Platform-specific automated setup
# Windows:
setup-windows.bat

# Linux (with system dependencies):
python3 scripts/setup/setup_linux_deps.py
chmod +x setup-unix.sh && ./setup-unix.sh

# Mac:
chmod +x setup-unix.sh && ./setup-unix.sh
```

### Development Commands

**Desktop App:**
```bash
cd hidock-desktop-app

# Activate environment
source .venv/bin/activate  # Linux/Mac
.venv\Scripts\activate     # Windows

# Run application
python main.py

# Run comprehensive test suite (600+ tests)
python -m pytest
pytest -m unit          # Unit tests only (~400 tests)
pytest -m integration   # Integration tests (~150 tests)
pytest -m device        # Device tests (~30 tests, requires hardware)
pytest -m slow         # Long-running tests
pytest -m gui          # GUI tests (no parallel)
pytest -m fileio       # File I/O tests

# Run single test file
python -m pytest tests/test_ai_service.py -v
python -m pytest tests/test_audio_visualization.py::TestAudioVisualization::test_basic_functionality -v

# Code quality checks
black . && isort . && flake8 . && pylint .
pre-commit run --all-files  # Run all quality checks

# Coverage report (80% minimum requirement)
pytest --cov=. --cov-report=html --cov-report=term-missing
```

**Web App:**
```bash
cd hidock-web-app

# Install dependencies
npm install

# Development server
npm run dev  # http://localhost:5173

# Build for production
npm run build

# Run tests
npm test
npm run test:watch    # Watch mode
npm run test:ui       # Visual test runner
npm run test:coverage # Coverage report

# Linting
npm run lint
```

**Audio Insights Extractor:**
```bash
cd audio-insights-extractor

# Development
npm run dev  # Vite dev server

# Build
npm run build

# Preview production build
npm run preview
```

### Testing Strategy

The desktop app uses **Test-Driven Development (TDD)** with comprehensive mocking:

- **580+ tests** with 80% minimum coverage requirement enforced by pytest
- **Mock-first strategy**: External dependencies (USB, AI APIs, file system) are extensively mocked
- **Test categories**: Use pytest markers for organized test execution
- **CustomTkinter mocking**: GUI components use `unittest.mock.patch` for testing without GUI rendering
- **Background processing tests**: Thread-safe testing with proper cleanup and cancellation

Key test files to understand patterns:
- `tests/test_settings_*.py`: Settings dialog testing with validation
- `tests/test_device_*.py`: USB device communication with mocking
- `tests/test_audio_*.py`: Audio processing and visualization
- `tests/test_ai_service*.py`: AI provider integration

### Build and Deployment

```bash
# Desktop app packaging (if configured)
cd hidock-desktop-app
python -m build

# Web app deployment build
cd hidock-web-app
npm run build
# Outputs to dist/ directory

# Audio insights build
cd audio-insights-extractor
npm run build
```

## Code Quality Standards

### Python Code (Desktop App)
- **Line length**: 120 characters (enforced by Black/Flake8)
- **Formatting**: Black with `line-length = 120` and `target-version = ['py38', 'py39', 'py310', 'py311']`
- **Import sorting**: isort with Black profile
- **Linting**: Flake8 with E203, W503 ignored for Black compatibility
- **Type checking**: MyPy configured for strict typing (excludes GUI files due to complexity)
- **Testing**: pytest with comprehensive markers and 80% coverage requirement

### TypeScript/JavaScript (Web Apps)
- **Line length**: 120 characters
- **Framework**: React 18+ with TypeScript strict mode
- **State management**: Zustand for React state
- **Styling**: Tailwind CSS with responsive patterns
- **Testing**: Vitest with jsdom for component testing
- **Build tool**: Vite for fast development and optimized builds

### Git Workflow
- **Conventional commits**: Use `feat:`, `fix:`, `docs:`, `test:`, `refactor:` prefixes
- **Branch naming**: `feature/`, `bugfix/`, `docs/` prefixes
- **Pre-commit hooks**: Automatically run code quality checks
- **No direct main commits**: All changes via feature branches

## AI Provider Integration

The project supports 11 AI providers with unified interface:

**Cloud Providers**: Google Gemini, OpenAI (GPT/Whisper), Anthropic Claude, OpenRouter, Amazon Bedrock, Qwen, DeepSeek
**Local Providers**: Ollama (`localhost:11434`), LM Studio (`localhost:1234/v1`)

**Configuration Pattern:**
```python
# Desktop app: ai_service.py
class AIProvider:
    def __init__(self, provider_id: str, config: dict):
        self.provider_id = provider_id
        self.api_key = decrypt_api_key(config['api_key'])  # Fernet encryption
        
    async def transcribe_audio(self, audio_path: str) -> str:
        # Implementation with error handling and retry logic
```

**Key Implementation Details:**
- API keys stored encrypted using Fernet symmetric encryption
- Provider configurations cached and validated on startup
- Mock providers available for testing without API calls
- Unified error handling and fallback mechanisms

## Device Communication

**Desktop App (PyUSB):**
- USB operations use threading with proper lock management
- Device detection with vendor/product ID filtering
- Support for HiDock H1, H1E, and P1 models
- Automatic reconnection and error recovery
- Background operations with progress tracking and cancellation

**Web App (WebUSB):**
- Browser-based USB access with permission prompts
- Same device interface as desktop for consistency
- Real-time device status updates
- Cross-browser compatibility considerations

## Performance Optimization

**Desktop App:**
- **Intelligent caching**: Device info (30s), storage data (60s), file metadata (persistent)
- **Background processing**: Non-blocking AI operations with threading
- **Audio optimization**: Downsampling to ~2000 points for visualization (95% memory reduction)
- **File selection debouncing**: 150ms debouncing prevents excessive USB communication
- **Smart cancellation**: Audio operations cancel properly on selection changes

**Web App:**
- **Bundle optimization**: Vite code splitting and tree shaking
- **State management**: Efficient Zustand stores with selective updates
- **Asset optimization**: Optimized images and lazy loading

## Development Environment Setup

### Prerequisites
- **Python**: 3.12+ recommended (minimum 3.8)
- **Node.js**: 18+ required
- **Git**: Required for version control

### Linux System Dependencies
```bash
# Automated setup (recommended)
python3 scripts/setup/setup_linux_deps.py

# Manual installation (Ubuntu/Debian)
sudo apt update
sudo apt install -y python3-tk python3-dev build-essential
sudo apt install -y ffmpeg libavcodec-extra portaudio19-dev  
sudo apt install -y libusb-1.0-0-dev libudev-dev pkg-config
sudo usermod -a -G dialout $USER  # USB permissions
```

### VS Code Configuration
The project includes comprehensive VS Code setup:
- **Python extensions**: `ms-python.python`, `ms-python.flake8`, `ms-python.black-formatter`, `ms-python.isort`, `ms-python.pylint`
- **TypeScript/React**: ESLint, Prettier, TypeScript support
- **Testing**: pytest and vitest integration
- **Debugging**: Configured launch configurations for all components

## Troubleshooting

### Common Issues

**Test Failures:**
- Ensure virtual environment activated: `source .venv/bin/activate`
- Install dev dependencies: `pip install -e ".[dev]"` (NOT requirements.txt)
- CustomTkinter tests require proper mocking: `@patch('customtkinter.*')`

**Device Communication:**
- Linux: Check USB permissions (`dialout` group membership)
- Windows: Ensure `libusb-1.0.dll` in `hidock-desktop-app/`
- Mac: Usually works out-of-box, check USB port connection

**Dependencies:**
- **Desktop**: Never use `requirements.txt`, all deps in `pyproject.toml`
- **Web apps**: Clear `node_modules` and reinstall if issues: `rm -rf node_modules && npm install`

**Coverage Issues:**
- Use `pytest --cov=. --cov-report=html` to identify uncovered code
- 80% coverage minimum enforced - add tests for uncovered paths
- Mock external services properly to ensure consistent test coverage

### Performance Issues
- **Slow startup**: Check if device cache is working (should be ~3 seconds)
- **UI freezing**: Ensure background operations use proper threading
- **Memory usage**: Audio visualization should use downsampled data

For comprehensive troubleshooting, see `docs/TROUBLESHOOTING.md`.
