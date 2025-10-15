"""
Test utilities and helpers for HiDock Desktop Application testing.

This module provides common utilities and fixtures that can be reused
across multiple test files to ensure consistency and reduce code duplication.
"""

import tempfile
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List
from unittest.mock import Mock

import pytest

from file_operations_manager import FileMetadata


class TestFixtures:
    """Common test fixtures and data generators."""

    @staticmethod
    def create_sample_file_metadata(count: int = 1, **kwargs) -> List[FileMetadata]:
        """Create sample FileMetadata objects for testing."""
        base_time = datetime.now()
        files = []

        for i in range(count):
            defaults = {
                "filename": f"test_file_{i}.wav",
                "size": 1024 * (i + 1),
                "duration": 30.0 + (i * 10),
                "date_created": base_time - timedelta(days=i),
                "device_path": f"/device/test_file_{i}.wav",
                "local_path": None,
                "checksum": f"checksum_{i}",
                "file_type": "audio",
                "transcription_status": None,
                "last_accessed": None,
                "download_count": 0,
                "tags": [],
            }

            # Override with any provided kwargs
            defaults.update(kwargs)

            files.append(FileMetadata(**defaults))

        return files

    @staticmethod
    def create_mock_device_adapter(**kwargs) -> Mock:
        """Create a mock device adapter with common methods."""
        mock_adapter = Mock()

        # Set up common mock methods
        mock_adapter.connect.return_value = True
        mock_adapter.disconnect.return_value = True
        mock_adapter.is_connected.return_value = kwargs.get("connected", True)
        mock_adapter.get_device_info.return_value = {
            "model": kwargs.get("model", "hidock-h1"),
            "version": kwargs.get("version", "1.0.0"),
            "serial": kwargs.get("serial", "TEST123"),
        }
        mock_adapter.get_file_list.return_value = kwargs.get("files", [])

        return mock_adapter

    @staticmethod
    def create_test_config(overrides: Dict[str, Any] = None) -> Dict[str, Any]:
        """Create a test configuration dictionary."""
        config = {
            "autoconnect": False,
            "download_directory": "/tmp/test_downloads",
            "log_level": "INFO",
            "selected_vid": 0x10D6,
            "selected_pid": 0xB00D,
            "target_interface": 0,
            "recording_check_interval_s": 3,
            "default_command_timeout_ms": 5000,
            "file_stream_timeout_s": 180,
            "auto_refresh_files": False,
            "auto_refresh_interval_s": 30,
            "quit_without_prompt_if_connected": False,
            "appearance_mode": "System",
            "color_theme": "blue",
            "suppress_console_output": False,
            "suppress_gui_log_output": False,
        }

        if overrides:
            config.update(overrides)

        return config


class AsyncTestUtils:
    """Utilities for testing async operations."""

    @staticmethod
    def run_with_timeout(func, timeout: float = 5.0):
        """Run a function with a timeout."""
        result = {"value": None, "exception": None}

        def target():
            try:
                result["value"] = func()
            except Exception as e:
                result["exception"] = e

        thread = threading.Thread(target=target)
        thread.daemon = True
        thread.start()
        thread.join(timeout)

        if thread.is_alive():
            raise TimeoutError(f"Function did not complete within {timeout} seconds")

        if result["exception"]:
            raise result["exception"]

        return result["value"]


class FileSystemTestUtils:
    """Utilities for file system testing."""

    @staticmethod
    def create_temp_file(content: str = "test content", suffix: str = ".txt") -> str:
        """Create a temporary file with given content."""
        with tempfile.NamedTemporaryFile(mode="w", suffix=suffix, delete=False) as f:
            f.write(content)
            return f.name

    @staticmethod
    def create_temp_audio_file(duration_seconds: int = 30) -> str:
        """Create a temporary audio file (mock) with metadata."""
        # This creates a mock audio file for testing
        # In reality, you might want to create actual audio data
        content = f"MOCK_AUDIO_DATA_DURATION_{duration_seconds}"
        return FileSystemTestUtils.create_temp_file(content, ".wav")

    @staticmethod
    def cleanup_temp_files(file_paths: List[str]) -> None:
        """Clean up temporary files safely."""
        for file_path in file_paths:
            try:
                Path(file_path).unlink(missing_ok=True)
            except Exception:
                pass  # Ignore cleanup errors in tests


class MockValidators:
    """Common validators for mock objects in tests."""

    @staticmethod
    def assert_mock_called_with_pattern(mock_obj, pattern: str):
        """Assert that a mock was called with arguments matching a pattern."""
        called = False
        for call in mock_obj.call_args_list:
            args, kwargs = call
            if any(pattern in str(arg) for arg in args):
                called = True
                break
            if any(pattern in str(value) for value in kwargs.values()):
                called = True
                break

        assert called, f"Mock was not called with pattern '{pattern}'"

    @staticmethod
    def assert_mock_called_n_times(mock_obj, expected_count: int):
        """Assert that a mock was called exactly n times."""
        actual_count = mock_obj.call_count
        assert actual_count == expected_count, f"Expected {expected_count} calls, got {actual_count}"

    @staticmethod
    def assert_mock_call_order(mock_obj, expected_calls: List[str]):
        """Assert that mock calls happened in expected order."""
        actual_calls = [str(call) for call in mock_obj.call_args_list]
        for i, expected_call in enumerate(expected_calls):
            if i >= len(actual_calls):
                assert False, f"Expected call '{expected_call}' not found"

            assert expected_call in actual_calls[i], f"Call {i}: expected '{expected_call}' in '{actual_calls[i]}'"


# Pytest fixtures that can be imported by other test modules
@pytest.fixture
def sample_file_metadata():
    """Fixture providing sample FileMetadata objects."""
    return TestFixtures.create_sample_file_metadata(3)


@pytest.fixture
def mock_device_adapter():
    """Fixture providing a mock device adapter."""
    return TestFixtures.create_mock_device_adapter()


@pytest.fixture
def test_config():
    """Fixture providing a test configuration."""
    return TestFixtures.create_test_config()


@pytest.fixture
def temp_directory():
    """Fixture providing a temporary directory that's cleaned up after test."""
    temp_dir = tempfile.mkdtemp()
    yield temp_dir
    # Cleanup
    import shutil

    shutil.rmtree(temp_dir, ignore_errors=True)


# Example usage and validation
if __name__ == "__main__":
    # Example of how to use these utilities
    print("Test Utils Module - Example Usage")

    # Create sample metadata
    metadata_list = TestFixtures.create_sample_file_metadata(2)
    print(f"Created {len(metadata_list)} sample metadata objects")

    # Create mock adapter
    adapter = TestFixtures.create_mock_device_adapter(connected=True)
    print(f"Mock adapter connected: {adapter.is_connected()}")

    # Create test config
    config = TestFixtures.create_test_config({"log_level": "DEBUG"})
    print(f"Test config log level: {config['log_level']}")

    print("All utilities working correctly!")
