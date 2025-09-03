"""
Test offline mode manager.

Tests for OfflineModeManager class.
"""

import os
import tempfile
from datetime import datetime
from unittest.mock import Mock, patch

import pytest

from file_operations_manager import FileMetadata
from offline_mode_manager import OfflineModeManager


class TestOfflineModeManager:
    """Test OfflineModeManager class."""

    def setup_method(self):
        """Set up test fixtures."""
        self.mock_file_ops = Mock()
        self.temp_dir = tempfile.mkdtemp()
        self.manager = OfflineModeManager(self.mock_file_ops, self.temp_dir)

    def teardown_method(self):
        """Clean up test fixtures."""
        import shutil

        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_initialization(self):
        """Test OfflineModeManager initialization."""
        mock_file_ops = Mock()
        download_dir = "/test/download"

        with patch("offline_mode_manager.logger") as mock_logger:
            manager = OfflineModeManager(mock_file_ops, download_dir)

            assert manager.file_operations_manager == mock_file_ops
            assert manager.download_directory == download_dir
            assert manager.is_offline_mode is False

            mock_logger.info.assert_called_once_with("OfflineMode", "__init__", "Offline mode manager initialized")

    def test_enter_offline_mode(self):
        """Test entering offline mode."""

        with patch("offline_mode_manager.logger") as mock_logger:
            self.manager.enter_offline_mode()

            assert self.manager.is_offline_mode is True
            mock_logger.info.assert_called_once_with("OfflineMode", "enter_offline_mode", "Entered offline mode")

    def test_exit_offline_mode(self):
        """Test exiting offline mode."""
        self.manager.is_offline_mode = True

        with patch("offline_mode_manager.logger") as mock_logger:
            self.manager.exit_offline_mode()

            assert self.manager.is_offline_mode is False
            mock_logger.info.assert_called_once_with("OfflineMode", "exit_offline_mode", "Exited offline mode")

    def test_get_cached_file_list_success(self):
        """Test getting cached file list successfully."""

        # Mock file metadata
        mock_files = [
            FileMetadata("file1.wav", 1024, 60.0, datetime(2024, 1, 1, 12, 0, 0), "/device/file1.wav"),
            FileMetadata("file2.wav", 2048, 120.0, datetime(2024, 1, 2, 12, 0, 0), "/device/file2.wav"),
        ]
        self.mock_file_ops.metadata_cache.get_all_metadata.return_value = mock_files

        with patch("offline_mode_manager.logger") as mock_logger:
            result = self.manager.get_cached_file_list()

            assert result == mock_files
            assert len(result) == 2
            mock_logger.info.assert_called_once_with("OfflineMode", "get_cached_file_list", "Retrieved 2 cached files")

    def test_get_cached_file_list_error(self):
        """Test getting cached file list with error."""

        # Mock exception
        self.mock_file_ops.metadata_cache.get_all_metadata.side_effect = Exception("Cache error")

        with patch("offline_mode_manager.logger") as mock_logger:
            result = self.manager.get_cached_file_list()

            assert result == []
            mock_logger.error.assert_called_once_with(
                "OfflineMode", "get_cached_file_list", "Error retrieving cached files: Cache error"
            )

    def test_get_downloaded_files_only(self):
        """Test getting only downloaded files."""

        # Create test files with local_path set
        file1_path = os.path.join(self.temp_dir, "file1.wav")
        with open(file1_path, "w") as f:
            f.write("test content")

        # Mock cached files with local_path attributes
        mock_files = [
            FileMetadata(
                "file1.wav", 1024, 60.0, datetime(2024, 1, 1, 12, 0, 0), "/device/file1.wav", local_path=file1_path
            ),
            FileMetadata(
                "file2.wav", 2048, 120.0, datetime(2024, 1, 2, 12, 0, 0), "/device/file2.wav", local_path=None
            ),
            FileMetadata(
                "file3.wav",
                4096,
                180.0,
                datetime(2024, 1, 3, 12, 0, 0),
                "/device/file3.wav",
                local_path="/nonexistent/file3.wav",
            ),
        ]

        # Mock metadata cache to return the appropriate metadata for each file
        def mock_get_metadata(filename):
            for file_meta in mock_files:
                if file_meta.filename == filename:
                    mock_metadata = Mock()
                    mock_metadata.local_path = file_meta.local_path
                    return mock_metadata
            return None

        self.mock_file_ops.metadata_cache.get_metadata.side_effect = mock_get_metadata

        with patch.object(self.manager, "get_cached_file_list", return_value=mock_files), patch(
            "offline_mode_manager.logger"
        ) as mock_logger:
            result = self.manager.get_downloaded_files_only()

            # Only file1.wav should be returned as it exists locally
            assert len(result) == 1
            assert result[0].filename == "file1.wav"
            mock_logger.info.assert_called_with("OfflineMode", "get_downloaded_files_only", "Found 1 downloaded files")

    def test_is_file_playable_offline_true(self):
        """Test checking if file is playable offline - true case."""

        # Mock cached metadata with local path
        mock_metadata = Mock()
        mock_metadata.local_path = os.path.join(self.temp_dir, "test.wav")

        # Create the actual file
        with open(mock_metadata.local_path, "w") as f:
            f.write("test content")

        self.mock_file_ops.metadata_cache.get_metadata.return_value = mock_metadata

        assert self.manager.is_file_playable_offline("test.wav") is True

    def test_is_file_playable_offline_false(self):
        """Test checking if file is playable offline - false case."""

        # Mock no cached metadata
        self.mock_file_ops.metadata_cache.get_metadata.return_value = None

        assert self.manager.is_file_playable_offline("nonexistent.wav") is False

    def test_get_offline_statistics(self):
        """Test getting offline statistics."""

        # Create one test file
        file_path = os.path.join(self.temp_dir, "file1.wav")
        with open(file_path, "w") as f:
            f.write("test content")

        # Mock cached files
        mock_files = [
            FileMetadata("file1.wav", 1024, 60.0, datetime(2024, 1, 1, 12, 0, 0), "/device/file1.wav"),
            FileMetadata("file2.wav", 2048, 120.0, datetime(2024, 1, 2, 12, 0, 0), "/device/file2.wav"),
        ]

        # Mock only one downloaded file
        downloaded_files = [mock_files[0]]

        with patch.object(self.manager, "get_cached_file_list", return_value=mock_files), patch.object(
            self.manager, "get_downloaded_files_only", return_value=downloaded_files
        ), patch.object(self.manager, "_get_last_cache_update", return_value=datetime(2024, 1, 1)):
            stats = self.manager.get_offline_statistics()

            assert stats["total_cached_files"] == 2
            assert stats["downloaded_files"] == 1
            assert stats["offline_availability_percent"] == 50.0

    def test_get_offline_file_path_exists(self):
        """Test getting local file path when file exists."""

        # Create test file
        file_path = os.path.join(self.temp_dir, "test.wav")
        with open(file_path, "w") as f:
            f.write("test content")

        # Mock cached metadata with local path
        mock_metadata = Mock()
        mock_metadata.local_path = file_path
        self.mock_file_ops.metadata_cache.get_metadata.return_value = mock_metadata

        result = self.manager.get_offline_file_path("test.wav")
        assert result == file_path

    def test_get_offline_file_path_not_exists(self):
        """Test getting local file path when file doesn't exist."""

        # Mock cached metadata with non-existent local path
        mock_metadata = Mock()
        mock_metadata.local_path = "/nonexistent/file.wav"
        self.mock_file_ops.metadata_cache.get_metadata.return_value = mock_metadata

        result = self.manager.get_offline_file_path("test.wav")
        assert result is None

    def test_get_offline_file_path_no_metadata(self):
        """Test getting local file path when no metadata exists."""

        # Mock no cached metadata
        self.mock_file_ops.metadata_cache.get_metadata.return_value = None

        result = self.manager.get_offline_file_path("test.wav")
        assert result is None

    def test_update_offline_status_indicators(self):
        """Test updating offline status indicators."""

        # Create test file
        file_path = os.path.join(self.temp_dir, "available.wav")
        with open(file_path, "w") as f:
            f.write("test content")

        # Mock is_file_playable_offline behavior
        def mock_playable_offline(filename):
            return filename == "available.wav"

        files_dict = [{"name": "available.wav"}, {"name": "unavailable.wav"}]

        with patch.object(self.manager, "is_file_playable_offline", side_effect=mock_playable_offline):
            result = self.manager.update_offline_status_indicators(files_dict)

            assert result[0]["gui_status"] == "Downloaded"
            assert result[0]["offline_available"] is True
            assert result[1]["gui_status"] == "On Device (Offline)"
            assert result[1]["offline_available"] is False

    def test_enhanced_offline_file_discovery(self):
        """Test enhanced offline file discovery that checks download directory."""
        # Create test files in download directory
        file1_path = os.path.join(self.temp_dir, "2025Aug04-160656-Rec02.wav")
        file2_path = os.path.join(self.temp_dir, "2025Aug04-183011-Rec05.wav")
        
        with open(file1_path, "w") as f:
            f.write("test audio content 1")
        with open(file2_path, "w") as f:
            f.write("test audio content 2")

        # Mock cached files without local_path set
        mock_files = [
            FileMetadata("2025Aug04-160656-Rec02.hda", 1024, 60.0, datetime(2024, 1, 1, 12, 0, 0), "/device/file1.hda"),
            FileMetadata("2025Aug04-183011-Rec05.hda", 2048, 120.0, datetime(2024, 1, 2, 12, 0, 0), "/device/file2.hda"),
            FileMetadata("2025Aug04-999999-Rec99.hda", 4096, 180.0, datetime(2024, 1, 3, 12, 0, 0), "/device/file3.hda"),
        ]

        # Mock metadata cache to return None (no cached metadata with local_path)
        self.mock_file_ops.metadata_cache.get_metadata.return_value = None
        
        with patch.object(self.manager, "get_cached_file_list", return_value=mock_files):
            downloaded_files = self.manager.get_downloaded_files_only()
            
            # Should find 2 files that exist in download directory
            assert len(downloaded_files) == 2
            assert downloaded_files[0].filename == "2025Aug04-160656-Rec02.hda"
            assert downloaded_files[1].filename == "2025Aug04-183011-Rec05.hda"
            
            # Test individual file checking
            assert self.manager.is_file_playable_offline("2025Aug04-160656-Rec02.hda") is True
            assert self.manager.is_file_playable_offline("2025Aug04-183011-Rec05.hda") is True
            assert self.manager.is_file_playable_offline("2025Aug04-999999-Rec99.hda") is False
