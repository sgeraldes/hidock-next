"""
Pytest configuration and fixtures for HiDock Next testing.
"""

import os
import tempfile
import threading
import time
from pathlib import Path
from unittest.mock import MagicMock, Mock

import pytest


@pytest.fixture
def temp_dir():
    """Create a temporary directory for testing."""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield Path(tmpdir)


@pytest.fixture
def mock_usb_device():
    """Mock USB device for testing device communication."""
    device = Mock()
    device.idVendor = 0x1234
    device.idProduct = 0x5678
    device.serial_number = "TEST123456"
    device.manufacturer = "HiDock"
    device.product = "H1"
    return device


@pytest.fixture
def mock_hidock_device():
    """Mock HiDock device instance for testing."""
    from hidock_device import HiDockJensen

    device = Mock(spec=HiDockJensen)
    device.is_connected = True
    device.device_info = {"model": "H1", "serial": "TEST123456", "firmware": "1.0.0"}
    device.storage_info = {"total": 1000000, "used": 500000, "free": 500000}
    return device


@pytest.fixture
def sample_audio_file(temp_dir):
    """Create a sample audio file for testing."""
    audio_file = temp_dir / "test_audio.wav"
    # Create a minimal WAV file header
    with open(audio_file, "wb") as f:
        # WAV header (44 bytes)
        f.write(b"RIFF")
        f.write((36).to_bytes(4, "little"))  # File size - 8
        f.write(b"WAVE")
        f.write(b"fmt ")
        f.write((16).to_bytes(4, "little"))  # Subchunk1Size
        f.write((1).to_bytes(2, "little"))  # AudioFormat (PCM)
        f.write((1).to_bytes(2, "little"))  # NumChannels
        f.write((44100).to_bytes(4, "little"))  # SampleRate
        f.write((88200).to_bytes(4, "little"))  # ByteRate
        f.write((2).to_bytes(2, "little"))  # BlockAlign
        f.write((16).to_bytes(2, "little"))  # BitsPerSample
        f.write(b"data")
        f.write((0).to_bytes(4, "little"))  # Subchunk2Size

    return audio_file


@pytest.fixture
def mock_config():
    """Mock configuration for testing."""
    return {
        "download_directory": "/tmp/downloads",
        "theme": "blue",
        "appearance_mode": "dark",
        "auto_connect": True,
        "log_level": "INFO",
        "device_vid": 0x1234,
        "device_pid": 0x5678,
        "target_interface": 0,
    }


@pytest.fixture(autouse=True)
def setup_test_environment(monkeypatch):
    """Set up test environment variables."""
    monkeypatch.setenv("TESTING", "1")
    monkeypatch.setenv("LOG_LEVEL", "DEBUG")


@pytest.fixture
def mock_tkinter_root():
    """Create a mock tkinter root for CTk variable creation."""
    import tkinter as tk

    import customtkinter as ctk

    # Create a temporary root window
    root = tk.Tk()
    root.withdraw()  # Hide the window

    # Set as default root for variable creation
    tk._default_root = root

    yield root

    # Cleanup
    try:
        root.destroy()
    except tk.TclError:
        pass
    tk._default_root = None


@pytest.fixture
def database_cleanup():
    """Ensure database connections are properly closed after tests."""
    import gc
    import sqlite3

    # Store original connections
    original_connections = []

    yield

    # Force garbage collection to close any lingering connections
    gc.collect()

    # Additional cleanup for Windows file locking issues
    import time

    time.sleep(0.1)  # Small delay to allow file handles to close


# Global lock for device test isolation
_DEVICE_TEST_LOCK = threading.RLock()


@pytest.fixture(autouse=True)
def auto_database_cleanup():
    """Automatically clean up database connections for all tests."""
    import gc
    import sqlite3

    yield

    # Force cleanup of any database connections
    gc.collect()

    # Close any remaining sqlite connections
    for obj in gc.get_objects():
        if isinstance(obj, sqlite3.Connection):
            try:
                obj.close()
            except Exception:
                pass


@pytest.fixture(scope="function")
def device_test_isolation(request):
    """Fixture to ensure device tests don't interfere with each other."""
    # Only apply to tests marked with @pytest.mark.device
    if request.node.get_closest_marker("device"):
        with _DEVICE_TEST_LOCK:
            test_name = request.node.name
            print(f"[DeviceTestIsolation] Starting: {test_name}")
            yield
            print(f"[DeviceTestIsolation] Completed: {test_name}")
            # Add small delay between device tests
            time.sleep(0.2)
    else:
        yield


@pytest.fixture
def mock_gemini_service():
    """Mock Gemini AI service for testing."""
    service = Mock()
    service.transcribe_audio.return_value = {"text": "This is a test transcription.", "confidence": 0.95}
    service.extract_insights.return_value = {
        "summary": "Test summary",
        "key_points": ["Point 1", "Point 2"],
        "sentiment": "Positive",
    }
    return service
