# HiDock Next - Technical Context

## Technology Stack

### Desktop Application (Python)
- **Framework**: CustomTkinter for modern GUI with native look
- **Python Version**: 3.12+ with type hints and modern features
- **USB Communication**: libusb via Python bindings for device control
- **Audio Processing**: librosa, soundfile for audio analysis and conversion
- **Encryption**: Fernet (cryptography library) for API key security
- **Configuration**: JSON-based with validation and defaults merging

### Web Application (React)
- **Framework**: React 18 + TypeScript + Vite
- **State Management**: Zustand for lightweight state handling
- **Device Communication**: WebUSB API for browser-based device control
- **Build System**: Vite with hot module replacement
- **Styling**: Modern CSS with component-based architecture

### Audio Insights Extractor (React)
- **Framework**: React 19 + TypeScript
- **AI Integration**: Google GenAI for audio analysis
- **Purpose**: Standalone tool for audio insights extraction

## Development Environment

### Quality Assurance Tools
- **Formatting**: Black (120-char line length), isort for imports
- **Linting**: flake8, pylint for code quality
- **Type Checking**: mypy with strict configuration
- **Testing**: pytest with markers (unit, integration, device)
- **Pre-commit**: Automated quality checks on commit

### Project Structure
```
hidock-next/
├── hidock-desktop-app/     # Python desktop application
├── hidock-web-app/         # React web application  
├── hidock-audio-insights/  # React audio analysis tool
├── .amazonq/              # AI assistant configuration
│   ├── rules/             # Development rules and standards
│   └── project-intelligence/ # Project documentation
└── setup scripts/         # Cross-platform setup automation
```

### Dependencies Management
- **Python**: pyproject.toml with editable installation (`pip install -e ".[dev]"`)
- **Node.js**: package.json with npm/yarn for React applications
- **System**: libusb for USB communication across platforms

## Platform Support

### Operating Systems
- **Windows**: 10/11 with libusb drivers
- **macOS**: 10.14+ with Homebrew libusb
- **Linux**: Ubuntu/Debian with libusb-dev package

### Hardware Requirements
- **USB**: USB 2.0+ for device communication
- **Memory**: 4GB+ RAM (application uses <100MB typically)
- **Storage**: 500MB+ for installation and audio files
- **Audio**: Standard audio output for playback features

## AI Provider Integration

### Cloud Providers (7)
- **Google Gemini**: 7 models with multimodal capabilities
- **OpenAI**: 6 models including Whisper for transcription
- **Anthropic**: 5 Claude models for analysis
- **OpenRouter**: Multi-provider access with 8+ models
- **Amazon Bedrock**: Enterprise AWS integration
- **Qwen**: Alibaba's multilingual models
- **DeepSeek**: Coding-specialized models

### Local Providers (2)
- **Ollama**: localhost:11434 with LLaMA, Mistral, CodeLlama
- **LM Studio**: localhost:1234/v1 with custom GGUF models

### Integration Architecture
- **Unified Interface**: Common API abstraction across all providers
- **Authentication**: Encrypted API key storage per provider
- **Validation**: Built-in connectivity testing and model validation
- **Error Handling**: Provider-specific error recovery and fallbacks

## Performance Characteristics

### Application Metrics
- **Startup Time**: <3 seconds on modern hardware
- **Memory Usage**: <100MB during normal operation
- **File Processing**: Real-time for audio files up to 2GB
- **Response Time**: <10ms for UI interactions with 150ms debouncing

### Optimization Strategies
- **Background Processing**: Threading for non-blocking operations
- **Intelligent Caching**: 30s device info, 60s storage data
- **Audio Downsampling**: ~2000 points for visualization efficiency
- **Resource Management**: Proper cleanup of USB and thread resources

## Security & Privacy

### Data Protection
- **Local Processing**: Ollama/LM Studio never send data externally
- **Encryption**: Fernet encryption for all stored API keys
- **No Telemetry**: Zero tracking or data collection
- **Offline Capability**: Full functionality without internet connection

### Development Security
- **Secret Management**: No hardcoded credentials in source code
- **Input Validation**: Comprehensive validation for all user inputs
- **Error Handling**: Secure error messages without sensitive data exposure
- **Dependency Scanning**: Regular security updates for all dependencies