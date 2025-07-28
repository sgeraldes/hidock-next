# HiDock Next - Technical Specification

## 1. Project Overview

### 1.1 Purpose

HiDock Next is a comprehensive audio management platform that provides direct, local control over HiDock recording devices. The project consists of two applications: a Python desktop application and a React web application, both offering alternatives to the proprietary HiNotes software.

### 1.2 Scope

- **Desktop Application**: Full-featured Python GUI application with CustomTkinter
- **Web Application**: Modern React-based web app with WebUSB integration
- **AI Integration**: Gemini AI-powered transcription and insight extraction
- **Device Support**: HiDock H1, H1E, and P1 models

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

- Multi-file selection and batch operations
- Real-time device status monitoring
- Configurable themes and appearance
- Comprehensive logging system
- Offline operation capability

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

### 6.1 Gemini AI Integration

- **Model**: Gemini 1.5 Flash for both text and audio
- **Authentication**: API key-based authentication
- **Privacy**: BYOK model for user control

### 6.2 Transcription Features

- Audio file upload and processing
- Real-time browser-based recording
- Multi-language support
- Confidence scoring and language detection

### 6.3 Insight Extraction

- Automatic summary generation
- Key point identification
- Sentiment analysis
- Action item extraction
- Speaker identification (when available)

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
- **File List Loading**: < 2 seconds for 100+ files
- **File Transfer**: Full USB 2.0 speed utilization
- **Memory Usage**: < 100MB during normal operation

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

### 11.1 Unit Testing

- Component-level testing for React components
- Service layer testing for device communication
- Protocol testing with mock devices

### 11.2 Integration Testing

- End-to-end device communication testing
- Cross-browser compatibility testing
- AI service integration testing

### 11.3 User Acceptance Testing

- Real device testing with multiple HiDock models
- Performance testing with large file sets
- Usability testing with target user groups

## 12. Maintenance and Support

### 12.1 Version Control

- Git-based version control with semantic versioning
- Feature branch workflow for development
- Automated testing and deployment pipelines

### 12.2 Documentation

- Comprehensive API documentation
- User guides and tutorials
- Developer contribution guidelines

### 12.3 Community Support

- GitHub Issues for bug reports and feature requests
- Community-driven development model
- Regular release cycles with user feedback integration
