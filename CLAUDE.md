# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

HiDock Next is a multi-platform application suite for managing HiDock recording devices locally with comprehensive AI-powered transcription and analysis capabilities. The project includes three main applications:

- **Desktop Application** (Python): Full-featured GUI application with 11 AI provider support
- **Web Application** (React/TypeScript): Modern browser-based interface with AI transcription  
- **Audio Insights Extractor** (React/TypeScript): Standalone audio analysis tool

## Architecture

### Desktop Application (`hidock-desktop-app/`)

The desktop application is the flagship component with advanced AI integration and professional-grade features.

#### Core Architecture
- **Main Entry**: `main.py` - Application entry point with enhanced error handling
- **GUI Architecture**:
  - `gui_main_window.py` - Main application window with AI transcription panels and advanced controls
  - `settings_window.py` - Comprehensive settings with multi-provider AI configuration
  - `gui_*.py` files - Modular GUI components (treeview, actions, event handlers, auxiliary functions)
- **Device Communication**: 
  - `hidock_device.py` - USB device interface using pyusb/libusb
  - `enhanced_device_selector.py` - Professional device selection UI with status indicators
- **Configuration**: `config_and_logger.py` - Centralized config and logging with encryption support
- **File Operations**: `file_operations_manager.py` - Local file management with HTA conversion support

#### AI Integration Layer
- **Unified AI Service**: `ai_service.py` - Central service managing 11 AI providers
  - **Cloud Providers**: Google Gemini, OpenAI, Anthropic, OpenRouter, Amazon Bedrock, Qwen, DeepSeek
  - **Local Providers**: Ollama, LM Studio  
  - **Mock Providers**: Development and testing support
- **Transcription Module**: `transcription_module.py` - Multi-provider audio transcription and analysis
- **HTA Converter**: `hta_converter.py` - Proprietary audio format conversion utility

#### Advanced Features
- **Audio Processing**:
  - `audio_player_enhanced.py` - Variable speed playback (0.25x-2.0x)
  - `audio_visualization.py` - Real-time waveform and spectrum analysis with pinned mode
- **Background Processing**: Non-blocking AI operations with progress tracking and cancellation
- **Security**: Encrypted API key storage using Fernet encryption
- **File Format Support**: Native .hda, .hta conversion, standard audio formats

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

- **Audio**: `.hda`, `.hta` (HiDock proprietary formats), `.wav`, `.mp3`, `.flac`, `.m4a`
- **Conversion**: 
  - **HTA Converter**: Proprietary format to WAV conversion
  - **Audio Processing**: pygame for playback, matplotlib for visualization
- **Storage**: Local downloads to user-configured directory with automatic conversion

## AI Integration

### Desktop Application - Multi-Provider Support

The desktop application supports **11 different AI providers** through a unified interface:

#### Cloud Providers (7)
- **Google Gemini**: 7 models including gemini-2.5-flash, gemini-2.5-pro, gemini-2.5-lite
- **OpenAI**: GPT-4o, Whisper-1 for transcription, GPT models for analysis
- **Anthropic**: Claude 3.5 Sonnet, Haiku, Opus for text analysis
- **OpenRouter**: Multi-provider access through single API
- **Amazon Bedrock**: Enterprise AI models (mock implementation)
- **Qwen**: Alibaba's multilingual models (mock implementation)
- **DeepSeek**: Coding-specialized models (mock implementation)

#### Local Providers (2)
- **Ollama**: Local model serving with LLaMA, Mistral, CodeLlama support
- **LM Studio**: GGUF model hosting with OpenAI-compatible API

#### Features
- **Unified Interface**: Single API for all providers through `ai_service.py`
- **Secure Storage**: Encrypted API key management with Fernet encryption
- **Provider Abstraction**: Abstract base class ensures consistent interfaces
- **Mock Support**: Development and testing without API keys
- **Background Processing**: Non-blocking transcription with progress tracking
- **Error Handling**: Comprehensive error reporting and fallback mechanisms

### Web Application

- Google Gemini API integration for real-time transcription
- BYOK (Bring Your Own Key) model
- Client-side processing to maintain privacy

## Dependencies

### Python (Desktop)

#### Core Dependencies
- `customtkinter` - Modern GUI framework with professional styling
- `pyusb` - USB device communication with libusb backend
- `pygame` - Audio playback and processing
- `matplotlib` - Real-time audio visualization and waveform display
- `cryptography` - Secure API key encryption with Fernet

#### AI Provider Dependencies
- `google-generativeai` - Google Gemini integration
- `openai` - OpenAI GPT and Whisper integration
- `anthropic` - Anthropic Claude integration
- `boto3` - Amazon Bedrock integration (optional)
- `requests` - HTTP client for OpenRouter, Ollama, LM Studio, other providers

#### Development Tools
- `pytest` - Testing framework with coverage reporting
- `black` - Code formatting (line length 88)
- `flake8` - Linting and style checking
- `isort` - Import sorting and organization
- `mypy` - Static type checking

### TypeScript (Web)

- `react` / `react-dom` - UI framework
- `zustand` - State management
- `@google/generative-ai` - AI services
- Development: `vite`, `vitest`, `eslint`, `typescript`

## Important Notes

### Desktop Application
- Always run from the `hidock-desktop-app/` directory to ensure proper icon and configuration file paths
- **AI Provider Setup**: Each provider requires specific configuration in settings
- **Local Models**: Ollama and LM Studio require separate server installation
- **API Keys**: Stored encrypted in `hidock_tool_config.json` - never commit plain text keys
- **HTA Files**: Automatically converted to WAV for AI processing
- **Background Processing**: Use progress bars and cancellation for long AI operations

### Development Guidelines
- **Testing**: Device tests require actual HiDock hardware (`@pytest.mark.device`)
- **AI Testing**: Mock providers available for development without API keys
- **Error Handling**: Always implement fallback mechanisms for AI operations
- **Configuration**: JSON format with validation before commits
- **Security**: Never log or expose API keys in debug output

### Web Application
- Requires HTTPS for WebUSB functionality
- Supports offline functionality for core device management

### Multi-Provider AI Architecture
- **Provider Registration**: Use `ai_service.configure_provider()` before operations
- **Unified Interface**: All providers implement `AIProvider` abstract base class
- **Error Handling**: Providers return consistent error response format
- **Mock Development**: Set empty API keys to trigger mock responses for testing
