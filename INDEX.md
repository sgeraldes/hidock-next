# HiDock Next - Complete Repository Index

This document provides a comprehensive overview of the entire HiDock Next repository structure. Each file and directory is documented with its purpose, technology stack, and functionality to assist both human developers and LLM agents in understanding the codebase.

## 🗂️ Repository Overview

HiDock Next is a multi-platform audio device management system consisting of:
- **Desktop Application**: Python GUI (CustomTkinter) for device management
- **Web Application**: React TypeScript app with WebUSB integration
- **Audio Insights Extractor**: React TypeScript app for AI-powered audio analysis
- **Comprehensive Documentation**: Operational procedures and technical guides

---

## 📁 Root Directory Structure

```text
hidock-next/
├── 🔧 Configuration Files
│   ├── .env                           # Environment variables (API keys, settings)
│   ├── .gitignore                     # Git ignore patterns for all project components
│   ├── .markdownlint.json             # Markdown linting rules (MD013 disabled for GitHub formatting)
│   ├── .pre-commit-config.yaml        # Pre-commit hooks configuration (Python linting, formatting)
│   ├── .pylintrc                      # Pylint configuration for Python code quality
│   ├── pyproject.toml                 # Python project configuration (Black, isort, flake8, pylint)
│   ├── setup.py                       # Python package installation script
│   └── LICENSE                        # MIT License for open source distribution
│
├── 🤖 AI Configuration
│   ├── .amazonq/                      # Amazon Q AI assistant rules
│   │   └── rules/
│   │       ├── ARCHITECTURE.md        # System architecture guidelines for AI
│   │       ├── MARKDOWN.md            # Markdown formatting standards
│   │       └── PYTHON.md              # Python development operational procedures
│   ├── .claude/                       # Claude AI configuration directory
│   ├── .gemini/                       # Google Gemini AI configuration
│   └── .kiro/                         # Kiro AI assistant configuration
│
├── 📋 Agent Documentation
│   ├── AGENT.md                       # Root operational procedures for multi-platform development
│   ├── INDEX_AGENTS.md                # Comprehensive index of all AGENT files with summaries
│   └── [Component]/AGENT.md           # Component-specific operational procedures (see below)
│
├── 📚 Documentation
│   ├── README.md                      # Main project overview with 2-week feature history
│   ├── QUICK_START.md                 # Quick setup guide for all components
│   ├── CONTRIBUTING.md                # Contribution guidelines and development workflow
│   ├── DOCUMENTATION_INDEX.md         # Master index of all documentation files
│   └── docs/                          # Detailed documentation (see docs section below)
│
├── 🔄 Setup Scripts
│   ├── setup-windows.bat              # Windows development environment setup
│   ├── setup-unix.sh                  # Unix/Linux development environment setup
│   ├── install-prerequisites.bat      # Windows automatic Python/Node.js installer
│   ├── install-prerequisites.sh       # Unix automatic Python/Node.js installer
│   ├── setup-precommit.bat            # Windows pre-commit hooks installation
│   ├── setup-precommit.sh             # Unix pre-commit hooks installation
│   ├── cleanup.bat                    # Windows cleanup utility for temporary files
│   └── cleanup.sh                     # Unix cleanup utility for temporary files
│
├── 🗃️ Archive
│   ├── archive/                       # Historical and temporary files archive
│   │   ├── temp-scripts/              # Temporary utility scripts (moved from active development)
│   │   └── testing-docs/              # Historical testing documentation and achievements
│   └── audio/                         # Audio sample files for testing (.hda, .wav formats)
│
├── 💻 Applications
│   ├── hidock-desktop-app/            # Python GUI application for device management
│   ├── hidock-web-app/                # React TypeScript web application
│   └── audio-insights-extractor/      # React TypeScript audio analysis application
│
├── 🛠️ Development Tools
│   ├── .vscode/                       # VS Code workspace configuration
│   ├── .github/                       # GitHub workflows and templates
│   └── .pytest_cache/                 # Pytest cache directory
```

---

## 🖥️ HiDock Desktop Application

**Technology**: Python 3.11+, CustomTkinter, PyUSB, threading, pytest
**Purpose**: Desktop GUI application for HiDock device management, audio processing, and file operations

```text
hidock-desktop-app/
├── 📱 Core Application
│   ├── main.py                        # Application entry point with exception handling and GUI initialization
│   ├── gui_main_window.py             # Main window class (CustomTkinter) with device management interface
│   ├── settings_window.py             # Settings dialog with device selection, audio config, and preferences
│   ├── constants.py                   # Application constants, file extensions, and configuration values
│   └── _version.py                    # Version information and release metadata
│
├── 🔌 Device Management
│   ├── hidock_device.py               # Core HiDock device communication class with USB protocol
│   ├── device_interface.py            # Abstract device interface for pluggable device types
│   ├── desktop_device_adapter.py      # Adapter pattern for desktop-specific device operations
│   ├── enhanced_device_selector.py    # Advanced device selection with auto-detection and fallback
│   └── libusb-1.0.dll                 # Windows USB library for device communication
│
├── 🎵 Audio Processing
│   ├── audio_player_enhanced.py       # Advanced audio player with visualization and effects
│   ├── audio_visualization.py         # Real-time audio visualization (waveform, spectrum, VU meters)
│   └── transcription_module.py        # AI-powered audio transcription with multiple provider support
│
├── 🤖 AI Integration
│   ├── ai_service.py                  # Multi-provider AI service (OpenAI, Anthropic, Google, etc.)
│   └── transcription_module.py        # Speech-to-text with provider fallback and error handling
│
├── 📁 File Operations
│   ├── file_operations_manager.py     # File system operations, device sync, and batch processing
│   ├── storage_management.py          # Storage quota management and cleanup operations
│   ├── hta_converter.py               # HiDock proprietary format converter (.hda to .wav)
│   └── offline_mode_manager.py        # Offline functionality and local file caching
│
├── 🎨 GUI Components
│   ├── gui_actions_device.py          # Device action handlers (connect, sync, configure)
│   ├── gui_actions_file.py            # File operation handlers (upload, download, convert)
│   ├── gui_auxiliary.py               # Helper functions for GUI state management
│   ├── gui_event_handlers.py          # Event handling system for user interactions
│   ├── gui_treeview.py                # Custom treeview widget for file/device browsing
│   ├── enhanced_gui_integration.py    # Advanced GUI integration with threading and progress
│   └── ctk_custom_widgets.py          # Custom CustomTkinter widgets and styling
│
├── ⚙️ Configuration
│   ├── config_and_logger.py           # Configuration management and structured logging
│   ├── hidock_config.json             # Application configuration (user preferences, device settings) - NOT COMMITTED
│   └── hidock_config.json.example     # Configuration template with all available options
│
├── 🎨 Resources
│   ├── icons/                         # Application icons and UI graphics
│   └── themes/                        # CustomTkinter theme definitions and color schemes
│
├── 🧪 Testing
│   ├── tests/                         # Comprehensive test suite (>90% coverage)
│   │   ├── conftest.py                # Pytest configuration and shared fixtures
│   │   ├── test_*.py                  # Unit and integration tests for all modules
│   │   └── test_utils.py              # Testing utilities and mock objects
│   ├── .coveragerc                    # Test coverage configuration
│   ├── pytest.ini                     # Pytest configuration and test discovery
│   └── htmlcov/                       # Coverage reports in HTML format
│
├── 🔧 Development Configuration
│   ├── AGENT.md                       # AI assistant operational procedures for Python GUI development
│   ├── README.md                      # Component-specific setup and development guide
│   ├── requirements.txt               # Python dependencies with version pinning
│   ├── pyproject.toml                 # Python project metadata and tool configuration
│   ├── .flake8                        # Flake8 linter configuration
│   ├── mypy.ini                       # MyPy type checker configuration
│   └── docs/                          # Component documentation (architecture, testing, features)
```

### Key Desktop Application Files (Technical Details)

- **main.py**: Entry point with CustomTkinter initialization, theme setup, and global exception handling
- **gui_main_window.py**: Main application window using CustomTkinter framework with responsive layout
- **hidock_device.py**: USB device communication using PyUSB with protocol implementation for HiDock devices
- **audio_visualization.py**: Real-time audio visualization using matplotlib and numpy for spectrograms
- **ai_service.py**: Multi-provider AI integration supporting 11 different AI services with fallback logic
- **transcription_module.py**: Speech-to-text processing with async operations and provider rotation

---

## 🌐 HiDock Web Application

**Technology**: React 18, TypeScript, Vite, Zustand, WebUSB API, Tailwind CSS
**Purpose**: Browser-based device management with WebUSB integration and multi-provider AI support

```text
hidock-web-app/
├── 📱 Core Application
│   ├── index.html                     # Main HTML template with Vite integration
│   ├── package.json                   # NPM dependencies and build scripts
│   ├── package-lock.json              # Dependency lock file for reproducible builds
│   └── src/
│       ├── main.tsx                   # React 18 application entry point with StrictMode
│       ├── App.tsx                    # Root component with routing and global state setup
│       ├── index.css                  # Global styles and Tailwind CSS imports
│       └── vite-env.d.ts              # TypeScript definitions for Vite environment
│
├── 🔧 Build Configuration
│   ├── vite.config.ts                 # Vite build configuration with React plugin
│   ├── tsconfig.json                  # TypeScript compiler configuration (strict mode)
│   ├── tsconfig.node.json             # TypeScript config for Node.js build tools
│   ├── tailwind.config.js             # Tailwind CSS configuration with custom theme
│   ├── postcss.config.js              # PostCSS configuration for CSS processing
│   ├── .eslintrc.cjs                  # ESLint configuration for code quality
│   └── vitest.config.ts               # Vitest configuration for unit testing
│
├── 🧩 Components
│   └── src/components/
│       ├── ui/                        # Reusable UI components (buttons, modals, forms)
│       ├── device/                    # Device-specific components (connection, status)
│       ├── audio/                     # Audio player and visualization components
│       └── layout/                    # Layout components (header, sidebar, navigation)
│
├── 📱 Pages
│   └── src/pages/
│       ├── Dashboard/                 # Main dashboard with device overview
│       ├── Devices/                   # Device management and configuration
│       ├── Audio/                     # Audio processing and playback
│       └── Settings/                  # Application settings and preferences
│
├── 🔌 Device Integration
│   └── src/adapters/
│       ├── webusb/                    # WebUSB API integration for device communication
│       └── device-protocols/          # HiDock device protocol implementation
│
├── 🤖 AI Services
│   └── src/services/
│       ├── ai/                        # Multi-provider AI service integration
│       ├── transcription/             # Speech-to-text services
│       └── audio-analysis/            # Audio processing and analysis
│
├── 🗄️ State Management
│   └── src/store/
│       ├── device/                    # Device state management with Zustand
│       ├── audio/                     # Audio player state and controls
│       └── settings/                  # Application settings and preferences
│
├── 🔧 Utilities
│   └── src/utils/
│       ├── device/                    # Device utility functions
│       ├── audio/                     # Audio processing utilities
│       └── validation/                # Form validation and data validation
│
├── 🧪 Testing
│   └── src/test/
│       ├── components/                # Component unit tests
│       ├── hooks/                     # Custom hook tests
│       └── utils/                     # Utility function tests
│
├── 📚 Documentation
│   ├── AGENT.md                       # AI assistant operational procedures for React development
│   ├── README.md                      # Component setup and development guide
│   ├── SECURITY_LIST.md               # Security considerations and best practices
│   └── docs/                          # Component-specific documentation
│
└── 🔒 Security & Configuration
    ├── .env.example                   # Environment variables template
    ├── .npmrc                         # NPM configuration
    └── .gitignore                     # Git ignore patterns for Node.js/React
```

### Key Web Application Files (Technical Details)

- **main.tsx**: React 18 entry point with createRoot API and StrictMode for development checks
- **App.tsx**: Root component with React Router setup and global error boundaries
- **src/adapters/webusb/**: WebUSB API integration for direct browser-to-device communication
- **src/store/**: Zustand state management for global application state without Redux complexity
- **vite.config.ts**: Vite configuration with hot reload, TypeScript support, and build optimization

---

## 🎧 Audio Insights Extractor

**Technology**: React 19, TypeScript, Vite, Google Gemini AI, Web Audio API
**Purpose**: Browser-based audio transcription and AI-powered insights extraction

```text
audio-insights-extractor/
├── 📱 Core Application
│   ├── index.html                     # HTML template for React 19 application
│   ├── index.tsx                      # React 19 entry point with concurrent features
│   ├── App.tsx                        # Main application component with file upload interface
│   ├── package.json                   # Dependencies for React 19 and Gemini AI
│   └── package-lock.json              # Dependency lock file
│
├── 🧩 Components
│   └── components/
│       ├── FileUpload/                # Drag-and-drop file upload with validation
│       ├── AudioProcessor/            # Audio file processing and visualization
│       ├── TranscriptionView/         # Display transcription results
│       └── InsightsPanel/             # AI-generated insights and analysis
│
├── 🤖 AI Services
│   └── services/
│       ├── gemini/                    # Google Gemini AI integration
│       └── audio/                     # Web Audio API utilities
│
├── 📊 Types & Constants
│   ├── types.ts                       # TypeScript interfaces for audio and AI data
│   ├── constants.ts                   # Application constants and configuration
│   └── metadata.json                  # Application metadata and versioning
│
├── 🔧 Configuration
│   ├── vite.config.ts                 # Vite configuration for React 19
│   ├── tsconfig.json                  # TypeScript strict mode configuration
│   ├── .npmrc                         # NPM configuration
│   └── .gitignore                     # Git ignore patterns
│
└── 📚 Documentation
    ├── AGENT.md                       # AI assistant operational procedures for React 19 development
    └── README.md                      # Setup and usage guide
```

### Key Audio Insights Files (Technical Details)

- **App.tsx**: React 19 component using concurrent features for audio processing
- **services/gemini/**: Google Gemini AI integration for transcription and insights generation
- **components/AudioProcessor/**: Web Audio API integration for browser-based audio processing
- **types.ts**: TypeScript definitions for audio files, transcription results, and AI insights

---

## 📚 Documentation Directory

```text
docs/
├── 🚀 Getting Started
│   ├── SETUP.md                       # Comprehensive setup guide for all components
│   ├── DEVELOPMENT.md                 # Development workflow and best practices
│   └── DEPLOYMENT.md                  # Production deployment instructions
│
├── 🏗️ Architecture
│   ├── TECHNICAL_SPECIFICATION.md     # System architecture and technical requirements
│   ├── API.md                         # API documentation and endpoint specifications
│   └── REFERENCE_HIDOCK.md            # HiDock device protocol reference
│
├── 🧪 Testing & Quality
│   ├── TESTING.md                     # Testing strategy and guidelines
│   ├── HIDOCK_DESKTOP_TEST_COVERAGE.md # Desktop application test coverage report
│   ├── ACCEPTANCE_CRITERIA.md         # User acceptance criteria and requirements
│   └── PRE-COMMIT.md                  # Pre-commit hooks and code quality gates
│
├── 🤖 AI Agent Documentation
│   ├── AGENT_DEFAULT.md               # Template for creating AI agent operational procedures
│   └── HIDOCK_DESKTOP_DEVELOPMENT.md  # Desktop development procedures and patterns
│
├── 🔧 Development Tools
│   ├── VSCODE_CONFIGURATION.md        # VS Code workspace setup and extensions
│   ├── SETTINGS_AND_TEST_IMPROVEMENTS.md # Development environment optimization
│   └── CLEANUP_REPORT.md              # Repository cleanup and organization report
│
├── 📋 Project Management
│   ├── ROADMAP.md                     # Project roadmap and future features
│   ├── TROUBLESHOOTING.md             # Common issues and solutions
│   └── DOCUMENTATION_REVIEW_REPORT.md # Documentation quality assessment
│
└── 🎨 Assets
    └── assets/                        # Documentation images, diagrams, and media files
```

---

## 🗃️ Archive Directory

Historical and temporary files organized for reference without cluttering active development.

```text
archive/
├── 🔧 Temporary Scripts
│   └── temp-scripts/                               # Utility scripts moved from active development
│       ├── audio_player.py                         # Basic audio player (superseded by enhanced version)
│       ├── audio_processing_advanced.py            # Advanced audio processing (unused, future feature)
│       ├── check_formatting.py                     # Code formatting validation script
│       ├── column_sorting_example.py               # GUI sorting implementation example
│       ├── run_audio_visualization_tests.py        # Audio visualization test runner
│       ├── run_tests.py                            # General test execution script
│       └── validate_project.py                     # Project validation and health check
│
└── 📊 Testing Documentation
    └── testing-docs/                               # Historical testing achievements and reports
        ├── AUDIO_VISUALIZATION_TEST_COVERAGE.md    # Audio testing coverage analysis
        ├── FINAL_GUI_TEST_REPORT.md                # Final GUI test resolution report  
        ├── GUI_TEST_COVERAGE_SUMMARY.md            # GUI test coverage summary
        ├── GUI_TEST_FIXES_SUMMARY.md               # GUI test fixes summary
        ├── PROFESSIONAL_TESTING_CERTIFICATION.md   # Testing methodology certification
        ├── PROJECT_COMPLETION_SUMMARY.md           # Project milestone summaries
        ├── TESTING_ACHIEVEMENTS.md                 # Testing accomplishments and metrics
        ├── TESTING_COVERAGE_ENHANCEMENT_SUMMARY.md # Coverage improvement reports
        ├── TESTING_COVERAGE_IMPROVEMENT.md         # Testing enhancement documentation
        └── detailed test plan(temporal).md         # Time-based testing strategy
```

---

## 🔧 Configuration Files (Root Level)

### Python Configuration
- **pyproject.toml**: Centralized Python tooling configuration (Black, isort, flake8, pylint)
- **.pylintrc**: Python code quality rules and complexity limits
- **setup.py**: Package installation and dependency management

### Development Tools
- **.pre-commit-config.yaml**: Automated code quality checks before commits
- **.markdownlint.json**: Markdown formatting rules with GitHub compatibility
- **.gitignore**: Comprehensive ignore patterns for all project components

### AI Assistant Configuration
- **AGENT.md**: Root operational procedures for multi-platform development
- **.amazonq/rules/**: Amazon Q AI assistant operational rules and guidelines

---

## 🎵 Audio Files Directory

```text
audio/
├── 2025*.hda                          # HiDock proprietary audio format test files
├── 2025*.wav                          # Standard WAV format audio samples
└── [Various dates and recording IDs]  # Organized by date and recording session
```

Test audio files in HiDock's proprietary .hda format and standard .wav format for testing audio processing, transcription, and device communication features.

---

## 🚀 Development Workflow

This repository supports multiple development environments:

1. **Python Desktop Development**: CustomTkinter GUI with comprehensive testing
2. **React Web Development**: Modern TypeScript with WebUSB integration
3. **AI Integration**: Multi-provider support with operational procedures
4. **Documentation-First**: Comprehensive guides for both humans and AI agents

## 🤖 AI Agent Integration

Each component includes `AGENT.md` files with precise operational procedures for AI-assisted development, following the format established in `.amazonq/rules/`. These files provide:

- Technology-specific development rules
- Code quality requirements
- Testing procedures
- Performance standards
- Error handling patterns

## 📊 Project Statistics

- **Total Components**: 3 (Desktop, Web, Audio Insights)
- **Programming Languages**: Python, TypeScript, JavaScript
- **Frameworks**: CustomTkinter, React 18/19, Vite
- **AI Providers**: 11 supported providers
- **Test Coverage**: >90% for Python components
- **Documentation Files**: 50+ comprehensive guides

This index provides the foundation for understanding the HiDock Next ecosystem and serves as a reference for both human developers and AI coding assistants.
