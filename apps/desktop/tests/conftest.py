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
def setup_test_environment(monkeypatch, tmp_path):
    """Set up comprehensive test environment isolation to prevent production data contamination."""
    # Set environment variables to indicate testing mode
    monkeypatch.setenv("TESTING", "1")
    monkeypatch.setenv("LOG_LEVEL", "DEBUG")

    # Create isolated test directories
    test_root = tmp_path / "hidock_test_isolation"
    test_config_dir = test_root / "config"
    test_cache_dir = test_root / "cache"
    test_downloads_dir = test_root / "downloads"
    test_home_dir = test_root / "home"

    # Create all test directories
    for dir_path in [test_config_dir, test_cache_dir, test_downloads_dir, test_home_dir]:
        dir_path.mkdir(parents=True, exist_ok=True)

    # === CONFIG FILE ISOLATION ===
    import config_and_logger

    monkeypatch.setattr(config_and_logger, "_SCRIPT_DIR", str(test_config_dir))
    monkeypatch.setattr(config_and_logger, "_CONFIG_FILE_PATH", str(test_config_dir / "hidock_config.json"))

    # === CACHE AND DATABASE ISOLATION ===
    # Patch file operations manager cache location
    import file_operations_manager

    original_init = file_operations_manager.FileOperationsManager.__init__

    def isolated_init(self, device_interface, download_dir=None, cache_dir=None, device_lock=None):
        # Force use of test directories
        download_dir = download_dir or str(test_downloads_dir)
        cache_dir = str(test_cache_dir)
        return original_init(self, device_interface, download_dir, cache_dir, device_lock)

    monkeypatch.setattr(file_operations_manager.FileOperationsManager, "__init__", isolated_init)

    # Patch storage management cache location
    try:
        import storage_management

        original_storage_init = storage_management.StorageOptimizer.__init__

        def isolated_storage_init(self, base_paths=None, cache_dir=None):
            # Force use of test cache directory
            cache_dir = str(test_cache_dir)
            # Provide default base_paths if not specified
            if base_paths is None:
                base_paths = [str(test_downloads_dir)]
            return original_storage_init(self, base_paths, cache_dir)

        monkeypatch.setattr(storage_management.StorageOptimizer, "__init__", isolated_storage_init)
    except ImportError:
        pass  # Module may not be available in all test contexts

    # === HOME DIRECTORY ISOLATION ===
    # Patch Path.home() to return test directory
    from pathlib import Path

    original_home = Path.home
    monkeypatch.setattr(Path, "home", lambda: Path(test_home_dir))

    # Patch os.path.expanduser to return test directory
    import os

    original_expanduser = os.path.expanduser

    def isolated_expanduser(path):
        # Convert to string if it's a Path object
        path_str = str(path) if hasattr(path, "__fspath__") or not isinstance(path, str) else path
        if path_str.startswith("~"):
            return str(test_home_dir / path_str[2:] if len(path_str) > 1 else test_home_dir)
        return original_expanduser(path)

    monkeypatch.setattr(os.path, "expanduser", isolated_expanduser)

    # === DEFAULT DOWNLOAD DIRECTORY ISOLATION ===
    # Patch the default config to use test download directory
    original_get_default_config = config_and_logger.get_default_config

    def isolated_get_default_config():
        config = original_get_default_config()
        config["download_directory"] = str(test_downloads_dir)
        return config

    monkeypatch.setattr(config_and_logger, "get_default_config", isolated_get_default_config)

    # === PREVENT SETTINGS WINDOW FROM AFFECTING PRODUCTION ===
    try:
        import settings_window

        # Mock the entire SettingsDialog class to prevent GUI initialization
        # This is safer than trying to monkey-patch __init__
        class MockSettingsDialog:
            def __init__(self, parent_gui, initial_config, hidock_instance, *args, **kwargs):
                self.parent_gui = parent_gui
                self.initial_config = initial_config or config_and_logger.load_config()
                self.hidock_instance = hidock_instance
                self.config_changed = False

            def open_settings_dialog(self):
                pass

            def apply_settings(self):
                self.config_changed = True
                return True

            def save_and_close(self):
                self.config_changed = True
                return True

        monkeypatch.setattr(settings_window, "SettingsDialog", MockSettingsDialog)
    except ImportError:
        pass

    # === CLEANUP WARNING ===
    # Add a prominent warning if isolation fails
    import warnings

    def check_isolation():
        """Verify test isolation is working correctly."""
        real_home = original_home()
        test_config_path = config_and_logger._CONFIG_FILE_PATH

        # Check if we're accidentally using real home directory
        if str(real_home) in test_config_path:
            warnings.warn(
                f"TEST ISOLATION FAILURE: Config path {test_config_path} "
                f"appears to use real home directory {real_home}. "
                "This could contaminate production data!",
                UserWarning,
                stacklevel=2,
            )

        # Ensure test cache directory is being used
        if str(real_home) in str(test_cache_dir):
            warnings.warn(
                f"TEST ISOLATION FAILURE: Cache directory appears to use real home directory. "
                "This could contaminate production data!",
                UserWarning,
                stacklevel=2,
            )

    # Run isolation check
    check_isolation()

    # Store test directories for potential use by individual tests
    monkeypatch.setenv("HIDOCK_TEST_CONFIG_DIR", str(test_config_dir))
    monkeypatch.setenv("HIDOCK_TEST_CACHE_DIR", str(test_cache_dir))
    monkeypatch.setenv("HIDOCK_TEST_DOWNLOADS_DIR", str(test_downloads_dir))
    monkeypatch.setenv("HIDOCK_TEST_HOME_DIR", str(test_home_dir))


@pytest.fixture
def isolated_dirs():
    """Provide access to isolated test directories for individual tests."""
    return {
        "config": os.getenv("HIDOCK_TEST_CONFIG_DIR"),
        "cache": os.getenv("HIDOCK_TEST_CACHE_DIR"),
        "downloads": os.getenv("HIDOCK_TEST_DOWNLOADS_DIR"),
        "home": os.getenv("HIDOCK_TEST_HOME_DIR"),
    }


@pytest.fixture
def verify_no_production_contamination():
    """Fixture to verify no production files are created during test."""
    from pathlib import Path

    # Production paths that should never be touched
    production_paths = [
        Path.home() / "hidock_config.json",
        Path.home() / ".hidock",
        Path.home() / "HiDock_Downloads",
        Path("hidock_config.json"),
    ]

    # Store initial state
    initial_state = {}
    for path in production_paths:
        try:
            initial_state[path] = {"exists": path.exists(), "mtime": path.stat().st_mtime if path.exists() else None}
        except (OSError, PermissionError):
            initial_state[path] = {"exists": False, "mtime": None}

    yield  # Run the test

    # Check for contamination after test
    contaminated_files = []
    for path in production_paths:
        try:
            current_exists = path.exists()
            current_mtime = path.stat().st_mtime if current_exists else None

            initial = initial_state[path]

            # Check if file was created
            if not initial["exists"] and current_exists:
                contaminated_files.append(f"Created: {path}")

            # Check if existing file was modified
            elif initial["exists"] and current_exists and initial["mtime"] != current_mtime:
                contaminated_files.append(f"Modified: {path}")

        except (OSError, PermissionError):
            continue

    if contaminated_files:
        raise AssertionError(
            f"Production data contamination detected:\n"
            + "\n".join(contaminated_files)
            + "\n\nTests must not modify production files!"
        )


# Architectural solution implemented via pytest markers
# GUI tests are marked with @pytest.mark.gui and excluded from parallel execution
# This eliminates thread conflicts without complex monkey-patching


@pytest.fixture
def mock_tkinter_root():
    """Create a mock tkinter root for CTk variable creation."""
    import tkinter as tk
    from unittest.mock import Mock

    import customtkinter as ctk

    # Create a mock root instead of real Tkinter window to avoid GUI resource contention
    root = Mock()
    root.withdraw = Mock()
    root.destroy = Mock()

    # Mock common Tkinter attributes that tests might expect
    root.winfo_screenwidth = Mock(return_value=1920)
    root.winfo_screenheight = Mock(return_value=1080)
    root.after = Mock()
    root.update = Mock()
    root.update_idletasks = Mock()

    # Set as default root for variable creation
    original_root = getattr(tk, "_default_root", None)
    tk._default_root = root

    yield root

    # Cleanup - restore original state
    tk._default_root = original_root


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
