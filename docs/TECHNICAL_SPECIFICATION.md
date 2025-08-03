# HiDock Next - Technical Specification

## 1. Project Overview

### 1.1 Purpose

HiDock Next is a comprehensive audio management platform that provides direct, local control over HiDock recording devices. The project consists of two applications: a Python desktop application and a React web application, both offering alternatives to the proprietary HiNotes software.

### 1.2 Scope

- **Desktop Application**: Full-featured Python GUI application with CustomTkinter and 11 AI provider support
- **Web Application**: Modern React-based web app with WebUSB integration
- **Audio Insights Extractor**: Standalone React application for audio analysis
- **AI Integration**: Multi-provider AI support (Gemini, OpenAI, Anthropic, Ollama, LM Studio, etc.)
- **Device Support**: HiDock H1, H1E, and P1 models with enhanced detection

### 1.3 Goals

- Provide local, offline device management
- Eliminate dependency on cloud services for basic operations
- Offer modern, user-friendly interfaces
- Enable community-driven development and distribution
- Support AI-powered transcription with BYOK model

## 2. System Architecture

### 2.1 Overall Architecture

```
┌─────────────────┐    ┌─────────────────┐
│   Desktop App   │    │    Web App      │
│   (Python)      │    │   (React)       │
└─────────────────┘    └─────────────────┘
         │                       │
         └───────────┬───────────┘
                     │
         ┌─────────────────┐
         │  HiDock Device  │
         │ (Jensen Protocol)│
         └─────────────────┘
                     │
         ┌─────────────────┐
         │   Gemini AI     │
         │ (Transcription) │
         └─────────────────┘
```

### 2.2 Desktop Application Architecture

```
┌─────────────────────────────────────────┐
│              GUI Layer                  │
│  (CustomTkinter, Font Awesome Icons)   │
├─────────────────────────────────────────┤
│            Business Logic               │
│   (File Management, Device Control)    │
├─────────────────────────────────────────┤
│          Communication Layer            │
│      (PyUSB, Jensen Protocol)          │
├─────────────────────────────────────────┤
│            Hardware Layer               │
│         (libusb, USB Drivers)          │
└─────────────────────────────────────────┘
```

### 2.3 Web Application Architecture

```
┌─────────────────────────────────────────┐
│           Presentation Layer            │
│    (React Components, Tailwind CSS)    │
├─────────────────────────────────────────┤
│            State Management             │
│         (Zustand, React Hooks)         │
├─────────────────────────────────────────┤
│            Service Layer                │
│  (Device Service, Gemini Service)      │
├─────────────────────────────────────────┤
│          Communication Layer            │
│     (WebUSB API, Jensen Protocol)      │
└─────────────────────────────────────────┘
```

## 3. Device Communication Protocol

### 3.1 Jensen Protocol Specification

The HiDock devices use a custom protocol called "Jensen" for USB communication.

#### 3.1.1 Packet Structure

```
┌─────────┬────────────┬─────────────┬─────────────┬──────────┐
│ Sync    │ Command ID │ Sequence ID │ Body Length │   Body   │
│ (2 bytes)│ (2 bytes)  │ (4 bytes)   │ (4 bytes)   │ (variable)│
└─────────┴────────────┴─────────────┴─────────────┴──────────┘
```

- **Sync Bytes**: `0x12 0x34` (fixed header)
- **Command ID**: Big-endian 16-bit command identifier
- **Sequence ID**: Big-endian 32-bit sequence number
- **Body Length**: Big-endian 32-bit length of body data
- **Body**: Variable-length command payload

#### 3.1.2 USB Endpoints

- **Vendor ID**: `0x10D6` (Actions Semiconductor)
- **Product IDs**:
  - H1: `0xAF0C`
  - H1E: `0xAF0D`
  - P1: `0xAF0E`
  - Default: `0xB00D`
- **Interface**: 0
- **Endpoint OUT**: `0x01`
- **Endpoint IN**: `0x82`

#### 3.1.3 Command Set

| Command ID | Name | Description |
|------------|------|-------------|
| 1 | GET_DEVICE_INFO | Retrieve device information |
| 2 | GET_DEVICE_TIME | Get current device time |
| 3 | SET_DEVICE_TIME | Synchronize device time |
| 4 | GET_FILE_LIST | List all recordings |
| 5 | TRANSFER_FILE | Download recording |
| 6 | GET_FILE_COUNT | Get number of files |
| 7 | DELETE_FILE | Delete specific recording |
| 11 | GET_SETTINGS | Retrieve device settings |
| 12 | SET_SETTINGS | Update device settings |
| 13 | GET_FILE_BLOCK | Get file data block |
| 16 | GET_CARD_INFO | Get storage information |
| 17 | FORMAT_CARD | Format device storage |
| 18 | GET_RECORDING_FILE | Alternative file transfer |

## 4. Desktop Application Specification

### 4.1 Technology Stack

- **Language**: Python 3.8+
- **GUI Framework**: CustomTkinter
- **USB Communication**: PyUSB with libusb backend
- **Icons**: Font Awesome integration
- **Configuration**: JSON-based settings storage

### 4.2 Core Components

#### 4.2.1 Main Application (`main.py`)

- Application entry point
- Exception handling and error reporting
- Theme and appearance initialization

#### 4.2.2 GUI Main Window (`gui_main_window.py`)

- Primary application interface
- File list management with TreeView
- Toolbar and menu system
- Status bar with real-time updates
- Playback controls integration

#### 4.2.3 Device Communication (`hidock_device.py`)

- HiDockJensen class for protocol implementation
- USB connection management
- Command sending and response parsing
- Error handling and recovery

#### 4.2.4 Settings Management (`settings_window.py`)

- Tabbed settings interface
- Theme and appearance configuration
- Device-specific settings
- Logging configuration

#### 4.2.5 Configuration (`config_and_logger.py`)

- Persistent settings storage
- Logging system with colored output
- Configuration validation

### 4.3 Key Features

- **Multi-file selection** and batch operations with toggle between single/multi modes
- **Real-time device status monitoring** with intelligent caching (30s device info, 60s storage)
- **Background audio processing** with smart cancellation and performance optimization
- **11 AI Provider Support** including local models (Ollama, LM Studio) and cloud services
- **Enhanced Settings Dialog** with comprehensive validation and encrypted API key storage
- **Advanced Audio Features** with variable speed playback (0.25x-2.0x) and waveform visualization
- **Configurable themes** and appearance with dark/light mode support
- **Comprehensive logging system** with colored output and GUI integration
- **Offline operation capability** with local AI model support
- **Test-Driven Development** with 581 comprehensive tests and 80% coverage requirement

## 5. Web Application Specification

### 5.1 Technology Stack

- **Framework**: React 18 with TypeScript
- **Styling**: Tailwind CSS
- **State Management**: Zustand
- **Build Tool**: Vite
- **Device Communication**: WebUSB API
- **AI Integration**: Google Gemini API
- **Icons**: Lucide React

### 5.2 Core Components

#### 5.2.1 Application Structure

```
src/
├── components/          # Reusable UI components
│   ├── AudioPlayer/     # Audio playback component
│   ├── AudioRecorder/   # Browser-based recording
│   ├── FileUpload/      # Drag & drop file upload
│   ├── Layout/          # Application layout components
│   └── ...
├── pages/               # Main application pages
│   ├── Dashboard.tsx    # Overview and statistics
│   ├── Recordings.tsx   # File management interface
│   ├── Transcription.tsx# AI transcription features
│   └── Settings.tsx     # Configuration interface
├── services/            # API and device communication
│   ├── deviceService.ts # WebUSB device communication
│   └── geminiService.ts # AI transcription service
├── store/               # State management
│   └── useAppStore.ts   # Zustand store configuration
├── types/               # TypeScript type definitions
├── utils/               # Helper functions and utilities
└── constants/           # Application constants
```

#### 5.2.2 Device Service (`deviceService.ts`)

- WebUSB device discovery and connection
- Jensen protocol implementation in JavaScript
- File operations (list, download, delete)
- Device management (format, sync time)

#### 5.2.3 Gemini Service (`geminiService.ts`)

- Audio transcription using Gemini AI
- Insight extraction and analysis
- BYOK (Bring Your Own Key) implementation
- Error handling and fallback parsing

#### 5.2.4 State Management (`useAppStore.ts`)

- Centralized application state
- Device connection status
- Recording management
- Settings persistence

### 5.3 Key Features

- Progressive Web App (PWA) capabilities
- Responsive design for all devices
- Real-time device status updates
- AI-powered transcription and insights
- Offline functionality with mock data

## 6. AI Integration Specification

### 6.1 Multi-Provider AI Integration

**Supported Providers (11 total):**

#### Cloud Providers (7)
- **Google Gemini**: 7 models (2.5-flash, 2.5-pro, 2.0-flash, 1.5-flash, etc.)
- **OpenAI**: 6 models (GPT-4o, GPT-4o-mini, Whisper-1, etc.)
- **Anthropic**: 5 models (Claude 3.5 Sonnet, Claude 3.5 Haiku, etc.)
- **OpenRouter**: 8+ models (Multi-provider access)
- **Amazon Bedrock**: 5+ models (AWS integration)
- **Qwen**: 7 models (Alibaba's multilingual models)
- **DeepSeek**: 5 models (Coding specialist models)

#### Local Providers (2)
- **Ollama**: Local model server (localhost:11434)
- **LM Studio**: Local GGUF model server (localhost:1234/v1)

### 6.2 Authentication & Security
- **API key-based authentication** for cloud providers
- **Fernet encryption** for secure API key storage
- **BYOK model** for complete user control
- **Local processing** option for privacy-sensitive use cases

### 6.3 Transcription Features

- **Audio file upload and processing** with multiple format support
- **Real-time browser-based recording** (web application)
- **Multi-language support** with auto-detection
- **Confidence scoring** and language detection
- **Background processing** with progress tracking
- **Provider-specific optimization** for different AI models
- **Local model support** for offline transcription

### 6.4 Insight Extraction

- **Automatic summary generation** with customizable length
- **Key point identification** and categorization
- **Sentiment analysis** with confidence scores
- **Action item extraction** with priority levels
- **Speaker identification** (when available)
- **Custom prompt support** for specialized analysis
- **Multi-provider comparison** for enhanced accuracy

## 7. Security Considerations

### 7.1 Device Communication

- USB communication over secure local connection
- No network transmission of device data
- Local storage of recordings and metadata

### 7.2 API Key Management

- Client-side API key storage
- No server-side key storage or transmission
- User-controlled key management

### 7.3 Data Privacy

- Local-first architecture
- Optional cloud services with user consent
- No telemetry or usage tracking

## 8. Performance Requirements

### 8.1 Desktop Application

- **Startup Time**: < 3 seconds on modern hardware
- **File List Loading**: < 2 seconds for 100+ files with intelligent caching
- **File Selection**: < 10ms response time with deferred updates (150ms debouncing)
- **Waveform Loading**: Background processing with immediate visual feedback and smart cancellation
- **File Transfer**: Full USB 2.0 speed utilization with progress tracking
- **Memory Usage**: < 100MB during normal operation with optimized audio downsampling
- **Settings Dialog**: < 500ms initialization with comprehensive validation
- **AI Processing**: Background transcription with non-blocking UI
- **Device Communication**: Intelligent caching (30s device info, 60s storage) with health monitoring

### 8.2 Web Application

- **Initial Load**: < 2 seconds on broadband connection
- **Device Connection**: < 5 seconds for device discovery
- **File Operations**: Comparable to desktop application
- **Transcription**: Real-time processing for files < 25MB

## 9. Browser Compatibility

### 9.1 Supported Browsers

- Chrome 61+ (full WebUSB support)
- Edge 79+ (full WebUSB support)
- Opera 48+ (full WebUSB support)

### 9.2 Unsupported Browsers

- Firefox (no WebUSB support)
- Safari (no WebUSB support)
- Internet Explorer (deprecated)

## 10. Deployment Architecture

### 10.1 Desktop Application

- Standalone executable with bundled dependencies
- Cross-platform support (Windows, macOS, Linux)
- Optional installer with system integration

### 10.2 Web Application

- Static site deployment (Vercel, Netlify, GitHub Pages)
- HTTPS requirement for WebUSB functionality
- CDN distribution for global accessibility

## 11. Testing Strategy

### 11.1 Comprehensive Test Suite

**Desktop Application:**
- **581 total tests** across all components
- **80% minimum coverage** requirement (enforced)
- **Test categories**: Unit (400+), Integration (150+), Device (30+), Performance (20+)
- **TDD approach**: Red-Green-Refactor cycle
- **Mock-first strategy**: External dependencies mocked for reliability

**Test Coverage by Component:**
- Settings functionality: 85%+ (comprehensive testing)
- Device communication: 55%
- Audio processing: 20%
- GUI components: 11% (CustomTkinter limitations)

### 11.2 Unit Testing

- **Component-level testing** for GUI components with proper mocking
- **Service layer testing** for device communication with retry logic
- **Protocol testing** with mock devices and error scenarios
- **Settings validation testing** with comprehensive edge case coverage
- **AI provider testing** with mock responses and error handling

### 11.3 Integration Testing

- **End-to-end device communication** testing with real hardware
- **Settings dialog workflow** testing with complete lifecycle validation
- **AI service integration** testing with multiple providers
- **Performance integration** testing for background processing and caching
- **Cross-component integration** testing for GUI and device layers

### 11.4 User Acceptance Testing

- **Real device testing** with multiple HiDock models (H1, H1E, P1)
- **Performance testing** with large file sets and stress scenarios
- **Usability testing** with target user groups and accessibility validation
- **AI provider testing** with real API keys and various audio samples
- **Settings workflow testing** with comprehensive user scenarios

## 12. Maintenance and Support

### 12.1 Version Control

- Git-based version control with semantic versioning
- Feature branch workflow for development
- Automated testing and deployment pipelines

### 12.2 Documentation

- **Comprehensive API documentation** with protocol specifications
- **User guides and tutorials** with step-by-step instructions
- **Developer contribution guidelines** with TDD workflow
- **Testing documentation** with 581 test descriptions and best practices
- **Configuration documentation** with pyproject.toml specifications
- **Troubleshooting guides** with common issues and solutions

### 12.3 Community Support

- GitHub Issues for bug reports and feature requests
- Community-driven development model
- Regular release cycles with user feedback integration
