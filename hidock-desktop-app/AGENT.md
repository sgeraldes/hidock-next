# AI Assistant Operational Rules: HiDock Desktop Application

This document contains the mandatory, non-negotiable rules and procedures for all Python GUI development on the HiDock Desktop Application. As an AI assistant, you must adhere to these rules without exception. All project configurations are defined in `pyproject.toml`. For general Python rules, refer to `.amazonq/rules/PYTHON.md`.

---

## 1. Core Directives

- **Python Rules Apply:** You must follow all rules in `.amazonq/rules/PYTHON.md` including TDD, validation suite, and quality gates.

- **CustomTkinter GUI Standards:** All GUI components must use `customtkinter.CTk*` prefixed components. Never use standard tkinter widgets except for specialized cases.

- **USB Thread Safety Mandatory:** All USB operations must be performed in background threads using `threading.Thread` or `asyncio`. Never block the GUI thread with USB operations.

- **Audio Memory Management:** You must properly dispose of audio resources after use. Call `.quit()` on pygame mixer and close all audio file handles explicitly.

- **Privacy-First Implementation:** Never send data to external services without explicit user consent. All core functionality must work offline.

## 2. Technology Stack Requirements

### Required Dependencies

You must use these exact dependencies as defined in `requirements.txt`:

```python
# Core GUI and device communication - MANDATORY
customtkinter>=5.0.0      # Modern UI components
pyusb>=1.2.0             # USB device interface
Pillow>=8.0.0            # Image processing for UI

# Audio processing stack - MANDATORY
pygame>=2.0.0            # Audio playback engine
pydub>=0.25.0           # Audio format conversion
librosa>=0.8.0          # Audio analysis and processing
numpy>=1.21.0,<2.0.0    # Numerical computing
scipy>=1.7.0,<1.12.0    # Scientific computing
matplotlib>=3.5.0,<3.8.0 # Audio visualization
```

### Forbidden Substitutions

- **Never use** standard `tkinter` widgets when `customtkinter` equivalents exist
- **Never use** `threading.Timer` for USB operations - use proper threading
- **Never use** `os.system()` or `subprocess` for USB communication
- **Never use** global variables for device state - use proper class attributes

## 3. Mandatory GUI Development Workflow

### Step 1: CustomTkinter Component Structure

All GUI components must follow this exact pattern:

```python
import customtkinter as ctk
from typing import Optional, Callable

class ComponentName(ctk.CTkFrame):
    def __init__(self, parent: ctk.CTkWidget, **kwargs):
        super().__init__(parent, **kwargs)

        # Configure grid weights
        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(0, weight=1)

        # Create UI elements
        self._create_widgets()
        self._setup_bindings()

    def _create_widgets(self) -> None:
        """Create all GUI widgets. Must be private method."""
        pass

    def _setup_bindings(self) -> None:
        """Setup event bindings. Must be private method."""
        pass
```

### Step 2: USB Device Communication Pattern

All USB operations must follow this exact pattern:

```python
import usb.core
import usb.util
import threading
from typing import Optional, Callable
from queue import Queue

class USBDeviceManager:
    def __init__(self, vendor_id: int, product_id: int):
        self.vendor_id = vendor_id
        self.product_id = product_id
        self.device: Optional[usb.core.Device] = None
        self._response_queue = Queue()
        self._stop_event = threading.Event()

    def connect(self, callback: Callable[[bool], None]) -> None:
        """Connect to device in background thread."""
        thread = threading.Thread(target=self._connect_worker, args=(callback,))
        thread.daemon = True
        thread.start()

    def _connect_worker(self, callback: Callable[[bool], None]) -> None:
        """Private worker method for USB connection."""
        try:
            self.device = usb.core.find(idVendor=self.vendor_id,
                                       idProduct=self.product_id)
            callback(self.device is not None)
        except usb.core.USBError as e:
            callback(False)
```

### Step 3: Audio Processing Requirements

All audio operations must follow these patterns:

```python
import pygame.mixer
import librosa
import numpy as np
from pathlib import Path
from typing import Optional

class AudioManager:
    def __init__(self):
        # Initialize pygame mixer with specific settings
        pygame.mixer.init(frequency=44100, size=-16, channels=2, buffer=2048)
        self.current_audio: Optional[np.ndarray] = None
        self.sample_rate: int = 44100

    def load_hda_file(self, file_path: Path) -> bool:
        """Load HDA file with proper error handling."""
        try:
            # Convert HDA to WAV first
            wav_data = self._convert_hda_to_wav(file_path)
            self.current_audio, self.sample_rate = librosa.load(wav_data, sr=44100)
            return True
        except Exception as e:
            return False

    def cleanup(self) -> None:
        """Mandatory cleanup method - MUST be called."""
        pygame.mixer.quit()
        self.current_audio = None
```

## 4. Mandatory Testing Patterns

### GUI Component Testing

All GUI components must be tested using this pattern:

```python
import pytest
import customtkinter as ctk
from unittest.mock import Mock, patch
from src.gui.component_name import ComponentName

class TestComponentName:
    @pytest.fixture
    def root_window(self):
        """Create test window."""
        root = ctk.CTk()
        yield root
        root.destroy()

    def test_component_creation(self, root_window):
        """Test component can be created without errors."""
        component = ComponentName(root_window)
        assert component is not None

    @patch('src.gui.component_name.some_dependency')
    def test_component_behavior(self, mock_dependency, root_window):
        """Test specific component behavior."""
        component = ComponentName(root_window)
        # Test implementation
        assert component.some_method() == expected_result
```

### USB Device Testing

All USB operations must be tested with proper mocking:

```python
import pytest
from unittest.mock import Mock, patch
import usb.core
from src.device.usb_manager import USBDeviceManager

class TestUSBDeviceManager:
    @pytest.fixture
    def usb_manager(self):
        return USBDeviceManager(vendor_id=0x1234, product_id=0x5678)

    @patch('usb.core.find')
    def test_device_connection_success(self, mock_find, usb_manager):
        """Test successful device connection."""
        mock_device = Mock()
        mock_find.return_value = mock_device

        result_callback = Mock()
        usb_manager.connect(result_callback)

        # Wait for thread completion
        import time
        time.sleep(0.1)

        result_callback.assert_called_once_with(True)
```

## 5. Quality Gates for Desktop Application

In addition to the standard Python quality gates, these rules apply:

### GUI-Specific Requirements

1. **No GUI Blocking:** No operation that takes >100ms may run on the main thread
2. **Resource Cleanup:** All GUI components must implement proper cleanup methods
3. **Error Recovery:** GUI must remain functional if USB device is disconnected
4. **Memory Management:** Audio resources must be explicitly freed after use

### USB Communication Requirements

1. **Thread Safety:** All USB operations must be thread-safe
2. **Error Handling:** USB errors must not crash the application
3. **Reconnection:** Application must support device reconnection without restart
4. **Timeout Handling:** All USB operations must have configurable timeouts

## 6. Local Validation Commands

Before committing any GUI code, run these additional commands:

```bash
# Standard Python validation (from PYTHON.md)
python -m black .
isort .
python -m flake8 .
python -m pylint .
mypy .
python -m pytest

# GUI-specific validation
python -c "import customtkinter; print('CustomTkinter OK')"
python -c "import pygame; print('Pygame OK')"
python -c "import usb.core; print('PyUSB OK')"

# Test GUI components specifically
python -m pytest tests/test_gui_components.py -v
```

## 7. Mandatory File Structure

All desktop application code must follow this structure:

```text
hidock-desktop-app/
├── src/
│   ├── main.py              # Application entry point
│   ├── gui/
│   │   ├── __init__.py
│   │   ├── main_window.py   # Main application window
│   │   └── components/      # Individual GUI components
│   ├── device/
│   │   ├── __init__.py
│   │   ├── usb_manager.py   # USB device communication
│   │   └── hidock_device.py # HiDock-specific device interface
│   ├── audio/
│   │   ├── __init__.py
│   │   ├── player.py        # Audio playback
│   │   ├── converter.py     # HDA format conversion
│   │   └── visualizer.py    # Audio visualization
│   └── config/
│       ├── __init__.py
│       └── settings.py      # Application configuration
├── tests/
│   ├── test_gui_components.py
│   ├── test_device.py
│   └── test_audio.py
└── requirements.txt
```

## 8. Error Handling Requirements

### Custom Exception Classes

You must define and use these specific exception classes:

```python
class HiDockDesktopError(Exception):
    """Base exception for desktop application."""
    pass

class USBDeviceError(HiDockDesktopError):
    """USB device communication error."""
    pass

class AudioProcessingError(HiDockDesktopError):
    """Audio processing operation error."""
    pass

class GUIError(HiDockDesktopError):
    """GUI operation error."""
    pass
```

### Mandatory Error Handling Pattern

All public methods must use this error handling pattern:

```python
def public_method(self, param: str) -> bool:
    """Public method with mandatory error handling."""
    try:
        # Implementation
        return True
    except SpecificError as e:
        logger.error(f"Specific error in {self.__class__.__name__}: {e}")
        return False
    except Exception as e:
        logger.error(f"Unexpected error in {self.__class__.__name__}: {e}")
        raise HiDockDesktopError(f"Operation failed: {e}") from e
```

## 9. Performance Requirements

- **Startup Time:** Application must start within 3 seconds
- **USB Response:** Device operations must complete within 5 seconds
- **Audio Loading:** Audio files must load within 2 seconds
- **Memory Usage:** Application must not exceed 200MB RAM under normal operation

These requirements are non-negotiable and must be maintained across all changes.
