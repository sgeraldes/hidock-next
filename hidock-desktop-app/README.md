# HiDock Desktop Application 🖥️

**Professional Desktop Audio Management with 11 AI Provider Support**

The HiDock Desktop Application is a full-featured Python desktop GUI for managing HiDock recording devices with advanced AI transcription capabilities. Built with CustomTkinter, it provides comprehensive local control over your HiDock devices while supporting both cloud and local AI providers for audio transcription and analysis.

[![Python 3.12+](https://img.shields.io/badge/python-3.12+-blue.svg)](https://www.python.org/downloads/)
[![CustomTkinter](https://img.shields.io/badge/GUI-CustomTkinter-green.svg)](https://github.com/TomSchimansky/CustomTkinter)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 🌟 Key Features

### 🤖 Advanced AI Integration

- **11 AI Providers**: Gemini, OpenAI, Anthropic, OpenRouter, Amazon Bedrock, Qwen, DeepSeek, Ollama, LM Studio
- **Local & Cloud Support**: Complete offline capability with Ollama/LM Studio or cloud-based processing
- **Secure Key Management**: Fernet-encrypted API key storage with per-provider configuration
- **Background Processing**: Non-blocking transcription with progress tracking and cancellation
- **Provider Validation**: Built-in API key testing and validation for all providers
- **Unified Interface**: Consistent API across all providers with error handling and fallback mechanisms

### 🎵 Professional Audio Management

- **Enhanced Playback**: Variable speed control (0.25x-2.0x) with real-time audio adjustment
- **Advanced Visualization**: Real-time waveform display and spectrum analyzer with background loading
- **Performance Optimized**: Background audio processing with smart cancellation and intelligent caching
- **Format Support**: Native .hda conversion, plus .wav, .mp3, .flac support with validation
- **Audio Processing**: Normalization, format conversion, and optimization utilities
- **Memory Efficient**: Downsampling to ~2000 points for optimal visualization performance
- **Threading**: Non-blocking audio operations with proper resource management

### 🔌 Device Communication

- **USB Protocol**: Direct device communication via pyusb/libusb with retry logic
- **Enhanced Detection**: Professional device selector with status indicators and proper enable/disable functionality
- **Intelligent Caching**: Device and storage information cached (30s device info, 60s storage) with staleness detection
- **Selection Modes**: Toggle between single and multi-file selection with persistent state and deferred updates
- **Health Monitoring**: Connection statistics and device health checks with automatic recovery
- **Performance Optimized**: 150ms debouncing for file selection to prevent excessive device communication

## 🚀 Quick Start

**From the main project directory:**

### **👤 End Users - Just Run the App**
```bash
# Option 1: Run automated setup
python setup.py  # Choose option 1

# Option 2: Manual setup (recommended for development)
cd hidock-desktop-app
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -e ".[dev]"  # Installs project + dev dependencies
python main.py
```

### **👨‍💻 Developers - Full Setup**
```bash
python setup.py  # Choose option 2 (includes pre-commit hooks and testing setup)
```

**Running the Application:**
```bash
cd hidock-desktop-app
source .venv/bin/activate  # Windows: .venv\Scripts\activate
python main.py
```

**Running Tests (581 comprehensive tests):**
```bash
# Run all tests with coverage
pytest

# Run specific test categories
pytest -m unit          # Unit tests only
pytest -m integration   # Integration tests
pytest -m device        # Device tests (requires hardware)
```
- **Real-time Sync**: Live device information and storage monitoring
- **Batch Operations**: Multi-file download, delete, and management

### 🎨 Modern GUI Experience

- **CustomTkinter Interface**: Professional dark/light theme support with dynamic theming
- **Responsive Design**: Adaptive layout with collapsible panels and proper state management
- **Performance Optimized**: Deferred updates and background processing for smooth interaction
- **Icon Integration**: Font Awesome icons throughout the interface with theme compatibility
- **Settings Management**: Comprehensive configuration with persistent state and validation
- **Enhanced Settings Dialog**: Comprehensive AI provider configuration with encrypted storage
- **Device Selector**: Professional device selector with proper component state management

## 🚀 Quick Start

### Prerequisites

**Required System Dependencies:**

```bash
# Windows
# libusb-1.0.dll is included in the repository

# macOS
brew install libusb

# Linux (Ubuntu/Debian)
sudo apt-get install libusb-1.0-0-dev

# Linux (Fedora/RHEL)
sudo dnf install libusb1-devel
```

**Python Requirements:**

- Python 3.12+ recommended (minimum 3.8)
- pip package manager

### Installation

1. **Navigate to Desktop App Directory**

   ```bash
   cd hidock-desktop-app
   ```

2. **Create Virtual Environment** (Recommended)

   ```bash
   python -m venv venv
   source venv/bin/activate  # Windows: venv\Scripts\activate
   ```

3. **Install Dependencies**

   ```bash
   pip install -r requirements.txt
   ```

4. **Run Application**
   ```bash
   python main.py
   ```

## 📁 Project Structure

```
hidock-desktop-app/
├── main.py                      # Application entry point
├── requirements.txt             # Python dependencies
├── pyproject.toml               # Project configuration
├── pytest.ini                   # Test configuration
│
├── gui_main_window.py           # Main application window
├── settings_window.py           # Settings dialog
├── gui_*.py                     # Modular GUI components
│
├── audio_player_enhanced.py     # Advanced audio playback
├── audio_visualization.py       # Waveform & spectrum analysis
├── audio_processing_advanced.py # Audio processing utilities
│
├── ai_service.py                # Multi-provider AI integration
├── transcription_module.py      # Audio transcription engine
│
├── hidock_device.py             # USB device communication
├── desktop_device_adapter.py    # Device interface layer
├── device_interface.py          # Device protocol implementation
│
├── file_operations_manager.py   # File management
├── hta_converter.py             # HiDock format conversion
├── storage_management.py        # Storage operations
│
├── config_and_logger.py         # Configuration & logging
├── constants.py                 # Application constants
├── ctk_custom_widgets.py        # Custom UI components
│
├── tests/                       # Test suite
├── docs/                        # Documentation
├── icons/                       # UI icons (Font Awesome)
└── themes/                      # CustomTkinter themes
```

## 🎛️ Core Components

### Audio System (`audio_*.py`)

- **Enhanced Player**: Professional audio playback with threading
- **Visualization**: Real-time waveform and FFT spectrum analysis
- **Processing**: Audio format conversion, normalization, speed control

### AI Integration (`ai_service.py`, `transcription_module.py`)

- **Multi-Provider Support**: Unified interface for 11 AI providers
- **Local Models**: Ollama and LM Studio integration
- **Cloud Services**: Gemini, OpenAI, Anthropic, and more
- **Background Processing**: Non-blocking transcription workflow

### Device Communication (`hidock_device.py`, `device_interface.py`)

- **USB Protocol**: Direct communication via libusb
- **Device Detection**: Automatic HiDock device discovery
- **File Operations**: Download, upload, delete, format operations
- **Real-time Monitoring**: Live device status and storage info

### GUI Framework (`gui_*.py`)

- **Main Window**: Central application interface
- **Modular Design**: Separated concerns for maintainability
- **Event Handling**: Comprehensive user interaction management
- **Theme Support**: Dark/light mode with icon theming

## 🤖 AI Provider Configuration

### Cloud Providers

Configure API keys in Settings → AI Providers:

1. **Google Gemini** - Get API key from [Google AI Studio](https://makersuite.google.com/app/apikey)
2. **OpenAI** - API key from [OpenAI Platform](https://platform.openai.com/api-keys)
3. **Anthropic** - API key from [Anthropic Console](https://console.anthropic.com/)
4. **OpenRouter** - API key from [OpenRouter](https://openrouter.ai/keys)
5. **Amazon Bedrock** - AWS credentials configuration
6. **Qwen/DeepSeek** - Provider-specific API keys

### Local Providers

Setup local AI servers:

```bash
# Ollama Setup
curl -fsSL https://ollama.ai/install.sh | sh
ollama pull llama3.2
ollama serve  # Default: http://localhost:11434

# LM Studio Setup
# Download from https://lmstudio.ai
# Start local server (default: http://localhost:1234/v1)
```

## 🎵 Audio Features

### Playback Controls

- **Speed Control**: 0.25x to 2.0x with real-time audio processing
- **Seek/Position**: Precise position control with visual feedback
- **Volume/Mute**: Professional audio level management
- **Repeat Modes**: Single track, playlist, shuffle support

### Visualization

- **Waveform Display**: Real-time audio waveform with zoom controls
- **Spectrum Analyzer**: Live FFT analysis with frequency visualization
- **Position Tracking**: Visual playback progress indicator
- **Theme Integration**: Dark/light mode compatibility

### Format Support

- **Native**: .hda (HiDock proprietary) with automatic conversion
- **Standard**: .wav, .mp3, .flac, .m4a
- **Processing**: Automatic format conversion for AI processing

## 🔧 Development

### Running Tests (581 Total Tests)

```bash
# Run all tests with coverage (80% minimum required)
pytest

# Run with HTML coverage report
pytest --cov=. --cov-report=html

# Run specific test categories
pytest -m unit        # Unit tests (~400 tests)
pytest -m integration # Integration tests (~150 tests)
pytest -m device      # Device tests (~30 tests, requires hardware)
pytest -m slow        # Slow running tests

# Run specific test files
pytest tests/test_settings_window.py -v  # Settings dialog tests (24 tests)
pytest tests/test_device_selector_*.py   # Device selector tests
```

### Code Quality (Configured in pyproject.toml)

```bash
# Format code (120-char line length)
black .

# Sort imports (Black profile)
isort .

# Lint code (with E203 exceptions)
flake8 .
pylint .

# Type checking (with GUI module exclusions)
mypy .

# Run all quality checks
black . && isort . && flake8 . && pylint . && mypy .

# Pre-commit hooks (run automatically on commit)
pre-commit run --all-files
```

### Development Dependencies (pyproject.toml)

Install with development dependencies using:
```bash
pip install -e ".[dev]"
```

**Development Tools:**
- **Testing**: pytest, pytest-cov, pytest-mock, pytest-asyncio
- **Code Quality**: black, flake8, isort, pylint, mypy
- **Runtime**: All production dependencies

**Key Configuration:**
- **Line Length**: 120 characters (consistent across all tools)
- **Test Coverage**: 80% minimum requirement (enforced)
- **Type Checking**: Strict mypy with GUI module exclusions
- **Import Sorting**: Black-compatible isort configuration

## 📊 Configuration

### Application Settings

Settings are stored in `hidock_tool_config.json` with comprehensive validation:

- **AI Provider Configurations**: Encrypted API keys and endpoints with per-provider storage
- **Audio Preferences**: Default volume, speed, visualization settings with validation
- **Device Settings**: Connection preferences and file paths with intelligent caching
- **UI State**: Window positions, panel visibility, theme selection with persistent state
- **Performance Settings**: Caching intervals, debouncing delays, background processing options
- **Validation Rules**: Temperature (0.0-2.0), Max Tokens (1-32000), numeric range checking

### Logging

Comprehensive logging system via `config_and_logger.py`:

- **Levels**: DEBUG, INFO, WARNING, ERROR, CRITICAL
- **Modules**: Component-specific logging with colored output
- **Output**: Console and GUI logging support with suppression options
- **Configuration**: Customizable log colors for light/dark themes
- **Integration**: GUI log callback system with real-time updates
- **Performance**: Efficient logging with level-based filtering

## 🔒 Security Features

### API Key Management

- **Fernet Encryption**: Military-grade symmetric encryption for API keys
- **Per-Provider Storage**: Separate encrypted keys for each AI provider
- **Secure Storage**: No plain-text keys in configuration files
- **Memory Safety**: Keys decrypted only when needed with automatic cleanup
- **Zero Hardcoding**: No API keys in source code or version control
- **Key Validation**: Built-in API key testing and validation before storage
- **Error Handling**: Graceful fallback when encryption is unavailable

### Local Processing

- **Offline Capability**: Complete functionality with local AI models
- **Data Privacy**: No external data transmission with local providers
- **User Control**: Choice between cloud and local processing

## 🛠️ Troubleshooting

### Common Issues

**USB Device Not Detected:**

```bash
# Windows: Install Zadig driver or ensure libusb-1.0.dll is present
# macOS: Install libusb via Homebrew (brew install libusb)
# Linux: Install libusb development packages and check permissions
sudo apt-get install libusb-1.0-0-dev  # Ubuntu/Debian
sudo usermod -a -G dialout $USER        # Add user to dialout group
```

**Settings Dialog Issues:**

- Ensure all GUI variables are properly initialized
- Check that device selector uses `set_enabled()` method, not `configure(state=...)`
- Verify encryption dependencies are available for API key storage
- Validate numeric settings are within proper ranges

**Test Failures:**

```bash
# Install with development dependencies
pip install -e ".[dev]"

# Check specific test categories
pytest -m unit -v          # Unit tests
pytest -m integration -v   # Integration tests

# Check coverage
pytest --cov=. --cov-report=html
```

**AI Provider Connection Issues:**

- Verify API keys in Settings → AI Providers → Validate button
- Check network connectivity for cloud providers
- Ensure local AI servers are running (Ollama: localhost:11434, LM Studio: localhost:1234/v1)
- Check provider-specific configuration (base URLs, regions, etc.)

### Debug Mode

Enable detailed logging by setting environment variable:

```bash
export HIDOCK_DEBUG=1  # Linux/macOS
set HIDOCK_DEBUG=1     # Windows
```

## 📄 File Dependencies

### Core Dependencies

- **pyusb**: USB device communication
- **customtkinter**: Modern GUI framework
- **pygame**: Audio playback system
- **pydub**: Audio processing and conversion
- **matplotlib**: Visualization and plotting
- **numpy/scipy**: Numerical computing
- **google-generativeai**: Gemini API integration
- **Pillow**: Image processing for GUI

### Optional Dependencies

- **librosa**: Advanced audio analysis (if needed)
- **cryptography**: Secure API key storage (included in AI service)

## 🚀 Performance Optimization

### Audio Processing

- **Threading**: Non-blocking audio operations with proper resource management
- **Buffering**: Optimized audio buffer sizes with memory efficiency
- **Caching**: Temporary file management for speed control with cleanup
- **Downsampling**: Waveform data optimized to ~2000 points for visualization
- **Background Loading**: Smart cancellation on selection changes

### GUI Responsiveness

- **Async Operations**: Background transcription processing with progress tracking
- **Progressive Loading**: Incremental file list updates with intelligent caching
- **Memory Management**: Efficient waveform data handling with cleanup
- **Deferred Updates**: 150ms debouncing for file selection to prevent excessive communication
- **Intelligent Caching**: 30s device info, 60s storage data caching with staleness detection
- **Settings Optimization**: Validation caching and change detection for responsive UI

## 📝 Contributing

See the main project [CONTRIBUTING.md](../CONTRIBUTING.md) for contribution guidelines.

### Development Setup

1. Fork and clone the repository
2. Create virtual environment and install with dev dependencies: `pip install -e ".[dev]"`
3. Run comprehensive test suite to ensure everything works: `pytest`
4. Make changes following TDD approach (Red-Green-Refactor)
5. Add tests for new functionality (maintain 80% coverage)
6. Run code quality checks: `black . && isort . && flake8 . && pylint .`
7. Submit pull request with comprehensive test coverage

### Recent Improvements

- **Comprehensive Settings Testing**: 24+ tests covering settings dialog functionality
- **Device Selector Bug Fix**: Proper enable/disable functionality implemented
- **Enhanced Error Handling**: Improved validation and error recovery
- **Performance Optimizations**: Background processing and intelligent caching
- **Test-Driven Development**: 581 comprehensive tests with 80% coverage requirement

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](../LICENSE) file for details.

---

**Ready to get started?** Run `python main.py` from this directory to launch the HiDock Desktop Application!

For additional help, check the [docs/](docs/) folder or open an issue on GitHub.
