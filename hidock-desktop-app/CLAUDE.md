# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

HiDock Desktop Application is a Python-based GUI application that provides device management and audio processing capabilities for HiDock recording devices. It's built with CustomTkinter for the modern UI and uses PyUSB for direct USB device communication.

## Development Commands

### Environment Setup
```bash
# Create virtual environment
python -m venv .venv

# Activate environment
.venv\Scripts\activate  # Windows
source .venv/bin/activate  # Linux/macOS

# Install with development dependencies
pip install -e ".[dev]"
```

### Running the Application
```bash
python main.py
```

### Testing
```bash
# Run all tests with coverage
python -m pytest

# Run specific test categories
python -m pytest -m unit          # Unit tests only
python -m pytest -m integration   # Integration tests only
python -m pytest -m "not slow"    # Exclude slow tests
python -m pytest tests/test_gui_components.py -v  # GUI components specifically
```

### Code Quality
```bash
# Format code
python -m black .
isort .

# Lint code
python -m flake8 .
python -m pylint .

# Type checking
mypy .

# Test dependencies are available
python -c "import customtkinter; print('CustomTkinter OK')"
python -c "import pygame; print('Pygame OK')"
python -c "import usb.core; print('PyUSB OK')"
```

## Architecture Overview

### Core Components
- **main.py**: Application entry point with error handling
- **gui_main_window.py**: Main GUI window using CustomTkinter
- **hidock_device.py**: USB device communication using PyUSB (Jensen protocol)
- **config_and_logger.py**: Configuration management and centralized logging
- **constants.py**: Application constants including USB commands and device IDs

### Key Modules
- **Audio System**: Enhanced audio player with visualization (pygame, librosa, matplotlib)
  - `audio_player_enhanced.py`: Core playback functionality
  - `audio_visualization.py`: Real-time audio visualization
  - `audio_processing_advanced.py`: Audio analysis and processing
- **Device Management**: USB communication and device control
  - `desktop_device_adapter.py`: Device adapter layer
  - `enhanced_device_selector.py`: Device selection UI
- **GUI Components**: CustomTkinter-based interface
  - `gui_*.py` files: Various GUI modules and event handlers
  - `ctk_custom_widgets.py`: Custom UI components
  - `settings_window.py`: Application settings dialog

### Configuration
- **pyproject.toml**: Complete project configuration including build, dependencies, and tool settings
- **hidock_config.json**: Runtime application configuration
- **pytest.ini**: Comprehensive test configuration with markers for different test types
- **mypy.ini**: Type checking configuration (relaxed for GUI modules)

## Development Standards

### Technology Stack
- **GUI Framework**: CustomTkinter (not standard tkinter)
- **USB Communication**: PyUSB with threading for non-blocking operations
- **Audio Processing**: pygame, librosa, pydub, numpy, scipy
- **Testing**: pytest with comprehensive coverage and mocking

### Critical Requirements
1. **Thread Safety**: All USB operations must run in background threads
2. **Resource Management**: Proper cleanup of audio resources (call pygame.mixer.quit())
3. **Privacy-First**: Core functionality must work offline
4. **Error Handling**: USB errors must not crash the application
5. **CustomTkinter Only**: Use CTk* components, not standard tkinter widgets

### Quality Gates
- Test coverage: 80% minimum
- No operations >100ms on main GUI thread
- Memory usage <200MB under normal operation
- Application startup <3 seconds

### Testing Strategy
- Extensive use of pytest markers: unit, integration, slow, device, core, enhanced
- GUI components tested with proper mocking
- USB operations tested with mock devices
- Audio processing tested with sample data

## Common Patterns

### USB Device Operations
All USB communication follows a threaded pattern with callbacks to avoid blocking the GUI thread.

### GUI Component Structure
All GUI components inherit from CTkFrame and follow a consistent initialization pattern with private setup methods.

### Error Handling
Centralized logging through config_and_logger.py with structured error messages and fallback mechanisms.

### Audio Processing
Audio operations use pygame for playback and librosa/numpy for analysis, with proper resource cleanup.

## Important Notes
- The application supports offline operation as a core requirement
- Device communication uses the Jensen protocol over USB endpoints
- Audio visualization uses matplotlib for real-time waveform display
- Settings persistence handled through JSON configuration files
- Comprehensive test suite covers core functionality with 80%+ coverage target

## Platform-Specific Notes

### macOS/Apple Silicon
- USB backend automatically uses system libusb (installed via Homebrew)
- Kernel driver detachment gracefully handles permission denied errors
- No sudo required for normal operation
- Device PID: `0xB00E` for HiDock_P1, `0xB00D` for HiDock_H1E

### Cross-Platform USB Support
- Windows: Uses bundled libusb DLL files with fallback to system paths
- macOS/Linux: Uses system libusb backend directly
- Automatic platform detection in `gui_actions_device.py`