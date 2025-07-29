# HiDock Desktop Application 🖥️

**Professional Desktop Audio Management with 11 AI Provider Support**

The HiDock Desktop Application is a full-featured Python desktop GUI for managing HiDock recording devices with advanced AI transcription capabilities. Built with CustomTkinter, it provides comprehensive local control over your HiDock devices while supporting both cloud and local AI providers for audio transcription and analysis.

[![Python 3.8+](https://img.shields.io/badge/python-3.8+-blue.svg)](https://www.python.org/downloads/)
[![CustomTkinter](https://img.shields.io/badge/GUI-CustomTkinter-green.svg)](https://github.com/TomSchimansky/CustomTkinter)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 🌟 Key Features

### 🤖 Advanced AI Integration

- **11 AI Providers**: Gemini, OpenAI, Anthropic, OpenRouter, Amazon Bedrock, Qwen, DeepSeek, Ollama, LM Studio
- **Local & Cloud Support**: Complete offline capability with Ollama/LM Studio or cloud-based processing
- **Secure Key Management**: Fernet-encrypted API key storage
- **Background Processing**: Non-blocking transcription with progress tracking

### 🎵 Professional Audio Management

- **Enhanced Playback**: Variable speed control (0.25x-2.0x) with real-time audio adjustment
- **Advanced Visualization**: Real-time waveform display and spectrum analyzer
- **Format Support**: Native .hda conversion, plus .wav, .mp3, .flac support
- **Audio Processing**: Normalization, format conversion, and optimization utilities

### 🔌 Device Communication

- **USB Protocol**: Direct device communication via pyusb/libusb
- **Enhanced Detection**: Professional device selector with status indicators
- **Real-time Sync**: Live device information and storage monitoring
- **Batch Operations**: Multi-file download, delete, and management

### 🎨 Modern GUI Experience

- **CustomTkinter Interface**: Professional dark/light theme support
- **Responsive Design**: Adaptive layout with collapsible panels
- **Icon Integration**: Font Awesome icons throughout the interface
- **Settings Management**: Comprehensive configuration with persistent state

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

- Python 3.8 or higher
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

### Running Tests

```bash
# Run all tests
pytest

# Run with coverage
pytest --cov=. --cov-report=html

# Run specific test categories
pytest -m unit        # Unit tests
pytest -m integration # Integration tests
pytest -m device      # Device tests (requires hardware)
```

### Code Quality

```bash
# Format code
black .

# Sort imports
isort .

# Lint code
flake8 .

# Type checking
mypy .
```

### Development Dependencies

The `requirements.txt` includes both runtime and development dependencies:

- **Testing**: pytest, pytest-cov, pytest-mock
- **Code Quality**: black, flake8, isort, pylint, mypy
- **Runtime**: All production dependencies

## 📊 Configuration

### Application Settings

Settings are stored in `hidock_tool_config.json`:

- **AI Provider Configurations**: Encrypted API keys and endpoints
- **Audio Preferences**: Default volume, speed, visualization settings
- **Device Settings**: Connection preferences and file paths
- **UI State**: Window positions, panel visibility, theme selection

### Logging

Comprehensive logging system via `config_and_logger.py`:

- **Levels**: DEBUG, INFO, WARNING, ERROR
- **Modules**: Component-specific logging
- **Output**: Console and file logging support

## 🔒 Security Features

### API Key Management

- **Fernet Encryption**: Military-grade symmetric encryption for API keys
- **Secure Storage**: No plain-text keys in configuration files
- **Memory Safety**: Keys decrypted only when needed
- **Zero Hardcoding**: No API keys in source code

### Local Processing

- **Offline Capability**: Complete functionality with local AI models
- **Data Privacy**: No external data transmission with local providers
- **User Control**: Choice between cloud and local processing

## 🛠️ Troubleshooting

### Common Issues

**USB Device Not Detected:**

```bash
# Windows: Install Zadig driver or ensure libusb-1.0.dll is present
# macOS: Install libusb via Homebrew
# Linux: Install libusb development packages and check permissions
```

**Audio Playback Issues:**

```bash
# Ensure pygame and pydub are properly installed
pip install pygame pydub

# Check audio system compatibility
python -c "import pygame; pygame.mixer.init(); print('Audio system OK')"
```

**AI Provider Connection Issues:**

- Verify API keys in Settings → AI Providers
- Check network connectivity for cloud providers
- Ensure local AI servers are running (Ollama/LM Studio)

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

- **Threading**: Non-blocking audio operations
- **Buffering**: Optimized audio buffer sizes
- **Caching**: Temporary file management for speed control

### GUI Responsiveness

- **Async Operations**: Background transcription processing
- **Progressive Loading**: Incremental file list updates
- **Memory Management**: Efficient waveform data handling

## 📝 Contributing

See the main project [CONTRIBUTING.md](../CONTRIBUTING.md) for contribution guidelines.

### Development Setup

1. Fork and clone the repository
2. Create virtual environment and install dependencies
3. Run tests to ensure everything works
4. Make changes and add tests
5. Submit pull request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](../LICENSE) file for details.

---

**Ready to get started?** Run `python main.py` from this directory to launch the HiDock Desktop Application!

For additional help, check the [docs/](docs/) folder or open an issue on GitHub.
