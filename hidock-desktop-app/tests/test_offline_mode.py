"""Tests for offline mode functionality."""

import os
import tempfile
import pytest
from datetime import datetime
from unittest.mock import Mock, patch

from offline_mode_manager import OfflineModeManager
from file_operations_manager import FileOperationsManager, FileMetadata


class TestOfflineModeManager:
    """Test offline mode manager functionality."""

    @pytest.fixture
    def temp_dir(self):
        """Create temporary directory for testing."""
        return tempfile.mkdtemp()

    @pytest.fixture
    def mock_file_ops_manager(self, temp_dir):
        """Create mock file operations manager."""
        mock_device = Mock()
        file_ops = FileOperationsManager(mock_device, temp_dir, temp_dir)
        return file_ops

    @pytest.fixture
    def offline_manager(self, mock_file_ops_manager, temp_dir):
        """Create offline mode manager for testing."""
        return OfflineModeManager(mock_file_ops_manager, temp_dir)

    def test_get_cached_file_list_empty(self, offline_manager):
        """Test getting cached file list when empty."""
        cached_files = offline_manager.get_cached_file_list()
        assert cached_files == []

    def test_get_cached_file_list_with_files(self, offline_manager, mock_file_ops_manager):
        """Test getting cached file list with files."""
        # Add test metadata
        test_file = FileMetadata(
            filename='test.hda',
            size=1024,
            duration=60.0,
            date_created=datetime.now(),
            device_path='test.hda'
        )
        mock_file_ops_manager.metadata_cache.set_metadata(test_file)
        
        cached_files = offline_manager.get_cached_file_list()
        assert len(cached_files) == 1
        assert cached_files[0].filename == 'test.hda'

    def test_get_downloaded_files_only(self, offline_manager, mock_file_ops_manager, temp_dir):
        """Test getting only downloaded files."""
        # Create a test file
        test_file_path = os.path.join(temp_dir, 'downloaded.hda')
        with open(test_file_path, 'w') as f:
            f.write('test')
        
        # Add metadata with local path
        test_file = FileMetadata(
            filename='downloaded.hda',
            size=1024,
            duration=60.0,
            date_created=datetime.now(),
            device_path='downloaded.hda',
            local_path=test_file_path
        )
        mock_file_ops_manager.metadata_cache.set_metadata(test_file)
        
        # Add metadata without local path
        test_file2 = FileMetadata(
            filename='not_downloaded.hda',
            size=2048,
            duration=120.0,
            date_created=datetime.now(),
            device_path='not_downloaded.hda'
        )
        mock_file_ops_manager.metadata_cache.set_metadata(test_file2)
        
        downloaded_files = offline_manager.get_downloaded_files_only()
        assert len(downloaded_files) == 1
        assert downloaded_files[0].filename == 'downloaded.hda'

    def test_is_file_playable_offline(self, offline_manager, mock_file_ops_manager, temp_dir):
        """Test checking if file is playable offline."""
        # Create a test file
        test_file_path = os.path.join(temp_dir, 'playable.hda')
        with open(test_file_path, 'w') as f:
            f.write('test')
        
        # Add metadata with local path
        test_file = FileMetadata(
            filename='playable.hda',
            size=1024,
            duration=60.0,
            date_created=datetime.now(),
            device_path='playable.hda',
            local_path=test_file_path
        )
        mock_file_ops_manager.metadata_cache.set_metadata(test_file)
        
        assert offline_manager.is_file_playable_offline('playable.hda') is True
        assert offline_manager.is_file_playable_offline('nonexistent.hda') is False

    def test_get_offline_statistics(self, offline_manager, mock_file_ops_manager, temp_dir):
        """Test getting offline statistics."""
        # Create a downloaded file
        test_file_path = os.path.join(temp_dir, 'downloaded.hda')
        with open(test_file_path, 'w') as f:
            f.write('test')
        
        # Add downloaded file metadata
        downloaded_file = FileMetadata(
            filename='downloaded.hda',
            size=1024,
            duration=60.0,
            date_created=datetime.now(),
            device_path='downloaded.hda',
            local_path=test_file_path
        )
        mock_file_ops_manager.metadata_cache.set_metadata(downloaded_file)
        
        # Add cached-only file metadata
        cached_file = FileMetadata(
            filename='cached.hda',
            size=2048,
            duration=120.0,
            date_created=datetime.now(),
            device_path='cached.hda'
        )
        mock_file_ops_manager.metadata_cache.set_metadata(cached_file)
        
        stats = offline_manager.get_offline_statistics()
        assert stats['total_cached_files'] == 2
        assert stats['downloaded_files'] == 1
        assert stats['offline_availability_percent'] == 50.0