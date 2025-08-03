# Development Guide

This guide provides detailed information for developers working on the HiDock Community Platform.

## 🚀 Quick Start for Developers

**New to the project?** Get started immediately:

```bash
git clone https://github.com/sgeraldes/hidock-next.git
cd hidock-next
python setup.py
# Choose option 2 (Developer)
```

This automated setup handles:
- ✅ Environment setup (Python virtual envs, Node.js dependencies)
- ✅ Development tools (testing, linting, formatting)
- ✅ Pre-commit hooks (automated code quality)
- ✅ Git workflow (branch creation, commit guidelines)
- ✅ AI integration setup (optional API keys)
- ✅ Project guidance (features to work on, documentation)

**Manual setup?** See [SETUP.md](SETUP.md) for step-by-step instructions.

## Architecture Overview

The HiDock Next platform consists of three main applications:

1. **Desktop Application** (Python/CustomTkinter) - Full-featured with 11 AI providers
2. **Web Application** (React/TypeScript) - Browser-based interface
3. **Audio Insights Extractor** (React/TypeScript) - Standalone analysis tool

All applications communicate with HiDock devices using USB protocols (pyusb/WebUSB).

## Desktop Application Development

### Technology Stack

- **Python 3.12+** (minimum 3.8, configured in pyproject.toml)
- **CustomTkinter** - Modern GUI framework with dark/light themes
- **PyUSB** - USB device communication with libusb backend
- **Pygame** - Audio playback and processing
- **Pillow** - Image processing for GUI components
- **Google Generative AI** - AI transcription services
- **Cryptography** - Secure API key storage with Fernet encryption

### Key Components

#### Device Communication (`hidock_device.py`)

```python
class HiDockJensen:
    """Enhanced HiDock device communication with error handling and retry logic."""

    def connect(self, target_interface_number, vid, pid):
        """Connect to HiDock device with retry mechanism."""

    def get_recordings(self):
        """Get list of recordings from device with caching."""

    def download_recording(self, filename, timeout_s):
        """Download recording with progress tracking."""

    def get_connection_stats(self):
        """Get connection statistics and health metrics."""

    def perform_health_check(self):
        """Perform device health check with error recovery."""
```

#### GUI Components (`gui_main_window.py`, `settings_window.py`)

- **Main window** with enhanced file list and TreeView
- **Status bar** with real-time device information and caching
- **Audio playback controls** with variable speed (0.25x-2.0x)
- **Settings dialog** with comprehensive AI provider configuration
- **Enhanced device selector** with proper enable/disable functionality
- **Waveform visualization** with background loading and cancellation
- **Multi-file selection** with toggle between single/multi modes

#### Configuration (`config_and_logger.py`)

- **JSON-based configuration** with validation and error handling
- **Advanced logging system** with colored output and GUI integration
- **Settings validation** with comprehensive numeric range checking
- **Encrypted storage** for API keys using Fernet encryption
- **Configuration migration** and backward compatibility
- **Performance monitoring** with intelligent caching (30s device info, 60s storage)

### Development Workflow

1. **Setup environment (recommended):**

   ```bash
   cd hidock-desktop-app
   python -m venv .venv
   source .venv/bin/activate  # Windows: .venv\Scripts\activate
   pip install -e ".[dev]"  # Installs project + dev dependencies
   ```

2. **Run application:**

   ```bash
   python main.py
   ```

3. **Run tests (581 tests total):**

   ```bash
   # Run all tests with coverage
   pytest

   # Run specific test categories
   pytest -m unit          # Unit tests only
   pytest -m integration   # Integration tests
   pytest -m device        # Device tests (requires hardware)

   # Run specific test files
   pytest tests/test_settings_window.py -v
   ```

4. **Code quality (configured in pyproject.toml):**

   ```bash
   # Format code (120-char line length)
   black .
   isort .

   # Lint code
   flake8 .
   pylint .

   # Type checking (with exclusions for GUI modules)
   mypy .
   ```

5. **Pre-commit hooks** (automatically installed with developer setup):

   ```bash
   # Install hooks
   pre-commit install

   # Run manually on all files
   pre-commit run --all-files

   # Check specific hook
   pre-commit run black-desktop-app
   ```

## Code Quality Standards

### Line Length
- **120 characters** for all code (Python, TypeScript, JavaScript)
- Configured in all tools: Black, Flake8, ESLint, Prettier

### Python Standards
- **Black** formatting with 120-char line length
- **Flake8** linting with E203 (slice whitespace) exceptions
- **isort** import sorting with Black profile
- **mypy** type checking (when configured)

### TypeScript/JavaScript Standards
- **ESLint** with React hooks rules
- **TypeScript** strict mode
- **Test files** have relaxed linting rules for test-specific code

### Testing Strategy

- **581 comprehensive tests** across all components
- **Unit tests** for individual functions (400+ tests)
- **Integration tests** for component interactions (150+ tests)
- **Performance tests** for background processing, caching, and UI responsiveness (20+ tests)
- **Device tests** for hardware validation (30+ tests, require actual hardware)
- **Settings tests** with comprehensive coverage of dialog functionality
- **Mock-first approach** with sophisticated mocking of USB devices and AI services
- **TDD workflow** with Red-Green-Refactor cycle
- **80% minimum coverage** requirement enforced by pytest configuration

## Web Application Development

### Technology Stack

- **React 18** with TypeScript
- **Vite** - Build tool and dev server
- **Tailwind CSS** - Styling framework
- **Zustand** - State management
- **WebUSB API** - Device communication

### Key Components

#### Device Service (`src/services/DeviceService.ts`)

```typescript
class DeviceService {
  async requestDevice(): Promise<HiDockDevice | null>
  async connectToDevice(usbDevice: USBDevice): Promise<HiDockDevice>
  async getRecordings(): Promise<AudioRecording[]>
  async downloadRecording(recordingId: string): Promise<ArrayBuffer>
}
```

#### State Management (`src/store/`)

```typescript
interface AppStore {
  device: HiDockDevice | null
  recordings: AudioRecording[]
  settings: AppSettings

  setDevice: (device: HiDockDevice | null) => void
  setRecordings: (recordings: AudioRecording[]) => void
}
```

#### Components (`src/components/`)

- Device connection interface
- File management components
- Audio player and recorder
- Transcription interface

### Development Workflow

1. **Setup environment:**

   ```bash
   cd hidock-web-app
   npm install
   ```

2. **Start dev server:**

   ```bash
   npm run dev
   ```

3. **Run tests:**

   ```bash
   npm run test
   npm run test:watch
   ```

4. **Build for production:**

   ```bash
   npm run build
   ```

### Testing Strategy

- **Component tests** with Testing Library
- **Service tests** with mocked APIs
- **Integration tests** for user workflows
- **E2E tests** for critical paths

## Device Communication Protocol

### Jensen Protocol

The Jensen protocol is used for communication with HiDock devices:

#### Packet Structure

```
Header (12 bytes):
- Magic bytes (4): 0x4A, 0x45, 0x4E, 0x53
- Sequence ID (2): Incremental counter
- Command ID (2): Operation identifier
- Body length (4): Size of payload

Body (variable):
- Command-specific data
```

#### Command Set

| Command ID | Name | Description |
|------------|------|-------------|
| 0x0001 | GET_DEVICE_INFO | Get device information |
| 0x0002 | GET_RECORDINGS | List recordings |
| 0x0003 | DOWNLOAD_FILE | Download recording |
| 0x0004 | DELETE_FILE | Delete recording |
| 0x0005 | FORMAT_DEVICE | Format storage |

### Implementation Differences

#### Desktop (Python)

```python
def send_command(self, command_id, body_bytes, timeout_ms):
    """Send command to device using PyUSB."""
    packet = self.build_packet(command_id, body_bytes)
    self.device.write(self.endpoint_out, packet, timeout_ms)
```

#### Web (TypeScript)

```typescript
async sendCommand(commandId: number, bodyBytes: Uint8Array): Promise<number> {
  const packet = this.buildPacket(commandId, bodyBytes)
  await this.device.transferOut(this.endpointOut, packet)
}
```

## AI Integration

### Gemini API Integration

Both applications support AI-powered transcription using Google's Gemini API:

#### Service Implementation

```typescript
class GeminiService {
  async transcribeAudio(audioBase64: string, mimeType: string): Promise<TranscriptionResult>
  async extractInsights(transcriptionText: string): Promise<InsightData>
}
```

#### Privacy Considerations

- BYOK (Bring Your Own Key) model
- Local storage of API keys
- Optional local-only processing
- Data retention controls

## Build and Deployment

### Desktop Application

#### PyInstaller Configuration

```python
# build.spec
a = Analysis(['main.py'],
             pathex=['.'],
             binaries=[],
             datas=[('icons', 'icons'), ('themes', 'themes')],
             hiddenimports=[],
             hookspath=[],
             runtime_hooks=[],
             excludes=[],
             win_no_prefer_redirects=False,
             win_private_assemblies=False,
             cipher=block_cipher,
             noarchive=False)
```

#### Build Commands

```bash
# Windows
pyinstaller --onefile --windowed main.py

# macOS
pyinstaller --onefile --windowed main.py

# Linux
pyinstaller --onefile main.py
```

### Web Application

#### Vite Configuration

```typescript
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          ui: ['@headlessui/react', 'lucide-react']
        }
      }
    }
  }
})
```

#### Deployment Targets

- **Vercel** - Automatic deployment from GitHub
- **Netlify** - Static site hosting
- **Self-hosted** - Docker containers

## Performance Considerations

### Desktop Application

- **Threading** for USB operations and background audio processing
- **Intelligent Caching** for device information (30s) and storage data (60s) with staleness detection
- **Deferred Updates** with 150ms debouncing for file selection to prevent excessive device communication
- **Background Processing** for waveform loading with smart cancellation on selection changes
- **Audio Optimization** with downsampling to ~2000 points for visualization performance
- **Memory management** for large files with efficient buffer handling
- **Progress tracking** for long operations with non-blocking UI
- **Settings optimization** with validation caching and change detection
- **Device selector performance** with proper component state management
- **Error recovery** with retry mechanisms and connection health monitoring

### Web Application

- **Code splitting** for faster loading
- **Lazy loading** for components
- **Service workers** for offline support
- **WebUSB optimization** for device communication

## Security Considerations

### API Key Management

- Secure local storage
- Environment variable support
- Key rotation capabilities
- Audit logging

### Device Communication

- Input validation for all commands
- Timeout handling for operations
- Error recovery mechanisms
- Connection state management

## Debugging and Troubleshooting

### Common Issues

#### Desktop Application

1. **USB Permission Issues**
   - Windows: Use Zadig for driver installation or ensure libusb-1.0.dll is present
   - Linux: Add user to dialout group (`sudo usermod -a -G dialout $USER`)
   - macOS: Install libusb via Homebrew (`brew install libusb`)

2. **GUI Rendering Issues**
   - Check CustomTkinter version compatibility
   - Verify theme files are present in themes/ directory
   - Test with different appearance modes (Light/Dark/System)
   - Ensure Font Awesome icons are properly loaded

3. **Settings Dialog Issues**
   - Verify all GUI variables are properly initialized
   - Check that device selector uses `set_enabled()` method, not `configure(state=...)`
   - Ensure encryption dependencies are available for API key storage
   - Validate numeric settings are within proper ranges (temperature: 0.0-2.0, tokens: 1-32000)

4. **Test Failures**
   - Install dev dependencies: `pip install -e ".[dev]"`
   - Check that mocks are properly configured for GUI components
   - Ensure async tests use proper pytest-asyncio configuration
   - Verify coverage requirements are met (80% minimum)

#### Web Application

1. **WebUSB Not Working**
   - Ensure HTTPS is enabled
   - Check browser compatibility
   - Verify device permissions

2. **Build Issues**
   - Clear node_modules and reinstall
   - Check TypeScript configuration
   - Verify import paths

### Debugging Tools

- **VS Code Debugger** for Python and TypeScript
- **Browser DevTools** for web debugging
- **USB Analyzer** for protocol debugging
- **Network Monitor** for API calls

## Contributing Guidelines

See [CONTRIBUTING.md](../CONTRIBUTING.md) for detailed contribution guidelines.

### Recent Improvements

- **Comprehensive Settings Testing**: 24+ tests covering settings dialog functionality
- **Device Selector Bug Fix**: Proper enable/disable functionality implemented
- **Enhanced Error Handling**: Improved validation and error recovery
- **Performance Optimizations**: Background processing and intelligent caching
- **Test-Driven Development**: TDD approach with 581 comprehensive tests
- **Code Quality**: Strict linting, formatting, and type checking with pyproject.toml configuration

## Additional Resources

- [Testing Guide](./TESTING.md) - Comprehensive testing documentation with 581 tests
- [Technical Specification](./TECHNICAL_SPECIFICATION.md) - Detailed architecture and protocol documentation
- [Deployment Guide](./DEPLOYMENT.md) - Production deployment instructions
- [Project Configuration](../hidock-desktop-app/pyproject.toml) - Complete project configuration
- [Pre-commit Configuration](../.pre-commit-config.yaml) - Code quality automation
