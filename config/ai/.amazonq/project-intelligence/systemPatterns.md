# HiDock Next - System Patterns

## Architecture Overview

### Multi-Application Suite
- **Desktop App (Python)**: Main application with CustomTkinter GUI
- **Web App (React)**: Browser-based interface with WebUSB
- **Audio Insights (React)**: Standalone analysis tool

### Core Design Patterns

#### Configuration Management
- **Pattern**: JSON-based configuration with defaults merging
- **Implementation**: `config_and_logger.py` with `load_config()`, `save_config()`
- **Key Insight**: GUI variable names don't always match config keys directly
- **Encryption**: Fernet encryption for API keys with per-provider storage

#### Device Communication
- **Pattern**: Adapter pattern for device abstraction
- **Layers**: 
  - `HiDockJensen` (USB protocol implementation)
  - `DesktopDeviceAdapter` (unified interface)
  - `gui_actions_device.py` (GUI integration)
- **Error Handling**: Automatic retry with device reset on communication failures

#### GUI Architecture
- **Framework**: CustomTkinter with Font Awesome icons
- **Pattern**: Separation of concerns with dedicated action modules
- **Threading**: Background processing for non-blocking operations
- **State Management**: Configuration-driven with persistent preferences

#### AI Provider Integration
- **Pattern**: Strategy pattern for multiple AI providers
- **Providers**: 11 total (7 cloud, 2 local, 2 hybrid)
- **Abstraction**: Unified interface for transcription and analysis
- **Security**: Encrypted API key storage with validation

### Data Flow Patterns

#### Settings Persistence Flow
```
GUI Variables → Settings Window → Key Mapping → Config JSON → Disk Storage
```

#### Device Communication Flow
```
GUI Action → Device Adapter → USB Protocol → Device Hardware
```

#### Audio Processing Flow
```
HDA File → Conversion → WAV → AI Provider → Transcription/Analysis
```

#### Offline Audio Functionality Requirements
- **Get Insights**: Works when audio file is downloaded locally, regardless of device connection status
- **Play Audio (Downloaded)**: Works when audio file is downloaded locally, regardless of device connection status  
- **Play Audio (On Device, Connected)**: When device is connected, can play non-downloaded files (downloads first, then plays)
- **Cannot Play**: Non-downloaded files when device is disconnected (can't download)
- **Implementation**: Menu states and button states reflect file availability and connection status

### Error Recovery Patterns

#### USB Communication Recovery
- **Detection**: Timeout and health check failures
- **Recovery**: Automatic device reset with buffer clearing
- **Fallback**: Manual disconnect/reconnect guidance

#### Configuration Recovery
- **Detection**: Missing or corrupted config files
- **Recovery**: Merge with defaults and regenerate
- **Validation**: Type checking and range validation

### Testing Patterns

#### Test Organization
- **Structure**: Tests mirror source code organization
- **Categories**: Unit, integration, device-specific with pytest markers
- **Coverage**: 80%+ requirement with comprehensive test suites
- **Mocking**: Device communication mocked for CI/CD environments

#### Quality Assurance
- **Pre-commit**: Black, isort, flake8, pylint, mypy
- **Type Safety**: Full type hints with strict mypy configuration
- **Documentation**: Google-style docstrings for all public APIs

### Performance Patterns

#### Background Processing
- **Threading**: Non-blocking operations with progress tracking
- **Cancellation**: Proper cleanup and thread termination
- **Caching**: Intelligent caching for device info (30s) and storage (60s)

#### Memory Management
- **Audio Processing**: Downsampling to ~2000 points for visualization
- **File Handling**: Streaming for large audio files
- **Resource Cleanup**: Proper disposal of USB resources and threads