"""
Tests for the test utilities module.

Meta-testing to ensure our test helpers work correctly.
"""

import tempfile
from pathlib import Path
from unittest.mock import Mock

import pytest

from .test_utils import AsyncTestUtils, FileSystemTestUtils, MockValidators, TestFixtures


class TestTestFixtures:
    """Test the TestFixtures utility class."""

    def test_create_sample_file_metadata_single(self):
        """Test creating a single FileMetadata object."""
        metadata_list = TestFixtures.create_sample_file_metadata(1)

        assert len(metadata_list) == 1
        metadata = metadata_list[0]
        assert metadata.filename == "test_file_0.wav"
        assert metadata.size == 1024
        assert metadata.duration == 30.0
        assert metadata.device_path == "/device/test_file_0.wav"

    def test_create_sample_file_metadata_multiple(self):
        """Test creating multiple FileMetadata objects."""
        metadata_list = TestFixtures.create_sample_file_metadata(3)

        assert len(metadata_list) == 3

        # Check that each has unique properties
        for i, metadata in enumerate(metadata_list):
            assert metadata.filename == f"test_file_{i}.wav"
            assert metadata.size == 1024 * (i + 1)
            assert metadata.duration == 30.0 + (i * 10)

    def test_create_sample_file_metadata_with_overrides(self):
        """Test creating FileMetadata with custom overrides."""
        metadata_list = TestFixtures.create_sample_file_metadata(1, file_type="custom_audio", download_count=5)

        metadata = metadata_list[0]
        assert metadata.file_type == "custom_audio"
        assert metadata.download_count == 5

    def test_create_mock_device_adapter_defaults(self):
        """Test creating mock device adapter with defaults."""
        adapter = TestFixtures.create_mock_device_adapter()

        assert adapter.connect() is True
        assert adapter.disconnect() is True
        assert adapter.is_connected() is True

        device_info = adapter.get_device_info()
        assert device_info["model"] == "hidock-h1"
        assert device_info["version"] == "1.0.0"
        assert device_info["serial"] == "TEST123"

    def test_create_mock_device_adapter_custom(self):
        """Test creating mock device adapter with custom values."""
        adapter = TestFixtures.create_mock_device_adapter(
            connected=False, model="hidock-p1", version="2.0.0", serial="CUSTOM456"
        )

        assert adapter.is_connected() is False

        device_info = adapter.get_device_info()
        assert device_info["model"] == "hidock-p1"
        assert device_info["version"] == "2.0.0"
        assert device_info["serial"] == "CUSTOM456"

    def test_create_test_config_defaults(self):
        """Test creating test config with defaults."""
        config = TestFixtures.create_test_config()

        assert config["autoconnect"] is False
        assert config["log_level"] == "INFO"
        assert config["selected_vid"] == 0x10D6
        assert config["selected_pid"] == 0xB00D
        assert config["appearance_mode"] == "System"

    def test_create_test_config_with_overrides(self):
        """Test creating test config with overrides."""
        overrides = {"autoconnect": True, "log_level": "DEBUG", "custom_setting": "test_value"}

        config = TestFixtures.create_test_config(overrides)

        assert config["autoconnect"] is True
        assert config["log_level"] == "DEBUG"
        assert config["custom_setting"] == "test_value"
        # Ensure defaults are preserved
        assert config["appearance_mode"] == "System"


class TestFileSystemTestUtils:
    """Test the FileSystemTestUtils utility class."""

    def test_create_temp_file_default(self):
        """Test creating temporary file with default content."""
        file_path = FileSystemTestUtils.create_temp_file()

        try:
            assert Path(file_path).exists()
            assert Path(file_path).suffix == ".txt"

            with open(file_path, "r") as f:
                content = f.read()
            assert content == "test content"
        finally:
            FileSystemTestUtils.cleanup_temp_files([file_path])

    def test_create_temp_file_custom(self):
        """Test creating temporary file with custom content and suffix."""
        custom_content = "This is custom test content"
        file_path = FileSystemTestUtils.create_temp_file(content=custom_content, suffix=".log")

        try:
            assert Path(file_path).exists()
            assert Path(file_path).suffix == ".log"

            with open(file_path, "r") as f:
                content = f.read()
            assert content == custom_content
        finally:
            FileSystemTestUtils.cleanup_temp_files([file_path])

    def test_create_temp_audio_file(self):
        """Test creating temporary audio file."""
        file_path = FileSystemTestUtils.create_temp_audio_file(duration_seconds=60)

        try:
            assert Path(file_path).exists()
            assert Path(file_path).suffix == ".wav"

            with open(file_path, "r") as f:
                content = f.read()
            assert "MOCK_AUDIO_DATA_DURATION_60" in content
        finally:
            FileSystemTestUtils.cleanup_temp_files([file_path])

    def test_cleanup_temp_files(self):
        """Test cleanup of temporary files."""
        # Create multiple temp files
        files = [
            FileSystemTestUtils.create_temp_file("content1"),
            FileSystemTestUtils.create_temp_file("content2"),
            FileSystemTestUtils.create_temp_file("content3"),
        ]

        # Verify they exist
        for file_path in files:
            assert Path(file_path).exists()

        # Clean them up
        FileSystemTestUtils.cleanup_temp_files(files)

        # Verify they're gone
        for file_path in files:
            assert not Path(file_path).exists()

    def test_cleanup_temp_files_missing_ok(self):
        """Test cleanup handles missing files gracefully."""
        # This should not raise an exception
        FileSystemTestUtils.cleanup_temp_files(["/nonexistent/file.txt"])


class TestMockValidators:
    """Test the MockValidators utility class."""

    def test_assert_mock_called_with_pattern_success(self):
        """Test pattern matching when pattern is found."""
        mock_obj = Mock()
        mock_obj("test_pattern_here", "other_arg")
        mock_obj("another_call")

        # This should not raise an exception
        MockValidators.assert_mock_called_with_pattern(mock_obj, "pattern")

    def test_assert_mock_called_with_pattern_failure(self):
        """Test pattern matching when pattern is not found."""
        mock_obj = Mock()
        mock_obj("no_match_here", "other_arg")

        with pytest.raises(AssertionError, match="Mock was not called with pattern"):
            MockValidators.assert_mock_called_with_pattern(mock_obj, "missing_pattern")

    def test_assert_mock_called_n_times_success(self):
        """Test call count validation when count matches."""
        mock_obj = Mock()
        mock_obj()
        mock_obj()
        mock_obj()

        # This should not raise an exception
        MockValidators.assert_mock_called_n_times(mock_obj, 3)

    def test_assert_mock_called_n_times_failure(self):
        """Test call count validation when count doesn't match."""
        mock_obj = Mock()
        mock_obj()
        mock_obj()

        with pytest.raises(AssertionError, match="Expected 5 calls, got 2"):
            MockValidators.assert_mock_called_n_times(mock_obj, 5)


class TestAsyncTestUtils:
    """Test the AsyncTestUtils utility class."""

    def test_run_with_timeout_success(self):
        """Test running function that completes within timeout."""

        def quick_function():
            return "success"

        result = AsyncTestUtils.run_with_timeout(quick_function, timeout=1.0)
        assert result == "success"

    def test_run_with_timeout_exception(self):
        """Test handling function that raises exception."""

        def failing_function():
            raise ValueError("Test error")

        with pytest.raises(ValueError, match="Test error"):
            AsyncTestUtils.run_with_timeout(failing_function, timeout=1.0)

    def test_run_with_timeout_timeout_error(self):
        """Test timeout when function takes too long."""

        def slow_function():
            import time

            time.sleep(2.0)  # Sleep longer than timeout
            return "too_late"

        with pytest.raises(TimeoutError, match="Function did not complete within"):
            AsyncTestUtils.run_with_timeout(slow_function, timeout=0.1)


# Integration test to verify fixtures work
def test_pytest_fixtures_integration(temp_dir):
    """Test that pytest fixtures work correctly."""
    # Test temp_dir fixture
    temp_path = Path(temp_dir)
    assert temp_path.exists()
    assert temp_path.is_dir()

    # Create a file in temp directory
    test_file = temp_path / "test.txt"
    test_file.write_text("test content")
    assert test_file.exists()
