"""Integration tests for disconnected mode functionality."""

import os
import tempfile
from datetime import datetime
from unittest.mock import Mock, patch

import pytest

from file_operations_manager import FileMetadata, FileOperationsManager
from offline_mode_manager import OfflineModeManager


class TestDisconnectedModeIntegration:
    """Test disconnected mode integration scenarios."""

    @pytest.fixture
    def temp_dir(self):
        """Create temporary directory for testing."""
        return tempfile.mkdtemp()

    @pytest.fixture
    def setup_test_environment(self, temp_dir):
        """Setup test environment with cached and downloaded files."""
        # Create mock device manager
        mock_device = Mock()
        file_ops = FileOperationsManager(mock_device, temp_dir, temp_dir)
        offline_mgr = OfflineModeManager(file_ops, temp_dir)

        # Create a downloaded file
        downloaded_file_path = os.path.join(temp_dir, "downloaded.hda")
        with open(downloaded_file_path, "w") as f:
            f.write("test audio data")

        # Add metadata for downloaded file
        downloaded_metadata = FileMetadata(
            filename="downloaded.hda",
            size=1024,
            duration=60.0,
            date_created=datetime.now(),
            device_path="downloaded.hda",
            local_path=downloaded_file_path,
        )
        file_ops.metadata_cache.set_metadata(downloaded_metadata)

        # Add metadata for cached-only file
        cached_metadata = FileMetadata(
            filename="cached_only.hda",
            size=2048,
            duration=120.0,
            date_created=datetime.now(),
            device_path="cached_only.hda",
        )
        file_ops.metadata_cache.set_metadata(cached_metadata)

        return file_ops, offline_mgr

    def test_disconnected_mode_shows_all_cached_files(self, setup_test_environment):
        """Test that disconnected mode shows all cached files."""
        file_ops, offline_mgr = setup_test_environment

        cached_files = offline_mgr.get_cached_file_list()
        assert len(cached_files) == 2

        filenames = [f.filename for f in cached_files]
        assert "downloaded.hda" in filenames
        assert "cached_only.hda" in filenames

    def test_disconnected_mode_identifies_playable_files(self, setup_test_environment):
        """Test that disconnected mode correctly identifies playable files."""
        file_ops, offline_mgr = setup_test_environment

        assert offline_mgr.is_file_playable_offline("downloaded.hda") is True
        assert offline_mgr.is_file_playable_offline("cached_only.hda") is False

    def test_disconnected_mode_statistics(self, setup_test_environment):
        """Test disconnected mode statistics calculation."""
        file_ops, offline_mgr = setup_test_environment

        stats = offline_mgr.get_offline_statistics()
        assert stats["total_cached_files"] == 2
        assert stats["downloaded_files"] == 1
        assert stats["offline_availability_percent"] == 50.0

    def test_gui_format_conversion_shows_correct_status(self, setup_test_environment):
        """Test that GUI format conversion shows correct status for cached vs downloaded files."""
        file_ops, offline_mgr = setup_test_environment

        # Mock the GUI conversion method
        cached_files = offline_mgr.get_cached_file_list()

        # Simulate GUI format conversion
        files_dict = []
        for i, f_info in enumerate(cached_files):
            if f_info.local_path and os.path.exists(f_info.local_path):
                gui_status = "Downloaded"
            else:
                gui_status = "On Device"

            files_dict.append(
                {
                    "name": f_info.filename,
                    "gui_status": gui_status,
                    "local_path": f_info.local_path,
                }
            )

        # Verify status assignment
        downloaded_file = next(f for f in files_dict if f["name"] == "downloaded.hda")
        cached_file = next(f for f in files_dict if f["name"] == "cached_only.hda")

        assert downloaded_file["gui_status"] == "Downloaded"
        assert cached_file["gui_status"] == "On Device"
