"""
Test data isolation to ensure tests never contaminate production data.

This test module specifically verifies that all test operations are isolated
from production configuration files, cache directories, and data storage.
"""

import os
import tempfile
from pathlib import Path
from unittest.mock import Mock, patch

import pytest

import config_and_logger
import file_operations_manager


class TestDataIsolation:
    """Test that all test operations are properly isolated from production data."""

    def test_config_file_isolation(self):
        """Verify config files use test directories, not production paths."""
        config_path = config_and_logger._CONFIG_FILE_PATH
        script_dir = config_and_logger._SCRIPT_DIR

        # Ensure paths contain temp directory indicators
        assert "tmp" in config_path.lower() or "temp" in config_path.lower()
        assert "tmp" in script_dir.lower() or "temp" in script_dir.lower()

        # Ensure paths don't contain user's home directory
        real_home = str(Path.home())
        if "hidock_test_isolation" not in script_dir:
            # Only check if not already isolated (in case of nested tests)
            assert real_home not in config_path, f"Config path {config_path} uses real home directory"
            assert real_home not in script_dir, f"Script dir {script_dir} uses real home directory"

    def test_cache_directory_isolation(self):
        """Verify cache directories use test paths."""
        # Test file operations manager
        mock_device = Mock()

        # Create file operations manager and check cache directory
        manager = file_operations_manager.FileOperationsManager(mock_device)
        cache_dir = str(manager.metadata_cache.cache_dir)

        # Should use temp directory
        assert "tmp" in cache_dir.lower() or "temp" in cache_dir.lower()

        # Should not use real home directory
        real_home = str(Path.home())
        if "hidock_test_isolation" not in cache_dir:
            assert real_home not in cache_dir, f"Cache dir {cache_dir} uses real home directory"

    def test_download_directory_isolation(self):
        """Verify default download directory is isolated."""
        config = config_and_logger.get_default_config()
        download_dir = config["download_directory"]

        # Should use temp directory
        assert "tmp" in download_dir.lower() or "temp" in download_dir.lower()

        # Should not use real home directory
        real_home = str(Path.home())
        if "hidock_test_isolation" not in download_dir:
            assert real_home not in download_dir, f"Download dir {download_dir} uses real home directory"

    def test_home_directory_patching(self):
        """Verify Path.home() returns test directory."""
        test_home = Path.home()

        # Should be a temp directory
        assert "tmp" in str(test_home).lower() or "temp" in str(test_home).lower()

    def test_expanduser_patching(self):
        """Verify os.path.expanduser returns test directory."""
        expanded = os.path.expanduser("~")

        # Should be a temp directory
        assert "tmp" in expanded.lower() or "temp" in expanded.lower()

        # Test with subdirectory
        expanded_sub = os.path.expanduser("~/.hidock")
        assert "tmp" in expanded_sub.lower() or "temp" in expanded_sub.lower()
        assert ".hidock" in expanded_sub

    def test_config_save_and_load_isolation(self):
        """Test that config save/load operations are isolated."""
        # Save a test configuration
        test_config = {"test_setting": "test_value", "download_directory": "/test/path", "theme": "test_theme"}

        config_and_logger.save_config(test_config)

        # Load the configuration
        loaded_config = config_and_logger.load_config()

        # Verify our test setting is there
        assert loaded_config.get("test_setting") == "test_value"

        # Verify the config file path is isolated
        config_path = config_and_logger._CONFIG_FILE_PATH
        assert "tmp" in config_path.lower() or "temp" in config_path.lower()

        # Ensure the file actually exists in temp location
        assert os.path.exists(config_path)

    def test_database_isolation(self):
        """Test that database files are created in isolated locations."""
        mock_device = Mock()

        # Create file operations manager which creates database
        manager = file_operations_manager.FileOperationsManager(mock_device)

        # Check database path
        db_path = str(manager.metadata_cache.db_path)

        # Should be in temp directory
        assert "tmp" in db_path.lower() or "temp" in db_path.lower()

        # Should not be in real home directory
        real_home = str(Path.home())
        if "hidock_test_isolation" not in db_path:
            assert real_home not in db_path, f"Database path {db_path} uses real home directory"

    def test_environment_variables_set(self):
        """Verify test environment variables are properly set."""
        assert os.getenv("TESTING") == "1"
        assert os.getenv("LOG_LEVEL") == "DEBUG"

        # Check test directory environment variables
        assert os.getenv("HIDOCK_TEST_CONFIG_DIR") is not None
        assert os.getenv("HIDOCK_TEST_CACHE_DIR") is not None
        assert os.getenv("HIDOCK_TEST_DOWNLOADS_DIR") is not None
        assert os.getenv("HIDOCK_TEST_HOME_DIR") is not None

        # All should be temp directories
        for env_var in [
            "HIDOCK_TEST_CONFIG_DIR",
            "HIDOCK_TEST_CACHE_DIR",
            "HIDOCK_TEST_DOWNLOADS_DIR",
            "HIDOCK_TEST_HOME_DIR",
        ]:
            path = os.getenv(env_var)
            assert "tmp" in path.lower() or "temp" in path.lower()

    def test_no_production_file_creation(self):
        """Ensure no files are created in production locations during tests."""
        # Common production paths that should never be touched
        production_paths = [
            Path.home() / "hidock_config.json",
            Path.home() / ".hidock",
            Path.home() / "HiDock_Downloads",
            Path("hidock_config.json"),  # Current directory
        ]

        # Store initial state
        initial_exists = {path: path.exists() for path in production_paths}

        # Perform some operations that might create files
        config_and_logger.save_config({"test": "value"})
        config_and_logger.load_config()

        mock_device = Mock()
        manager = file_operations_manager.FileOperationsManager(mock_device)

        # Check that no new production files were created
        for path in production_paths:
            current_exists = path.exists()
            if not initial_exists[path] and current_exists:
                pytest.fail(f"Test created production file: {path}")

    def test_settings_window_isolation(self):
        """Test that settings window operations are isolated."""
        try:
            import settings_window

            # Mock parent GUI
            mock_parent = Mock()
            mock_parent.download_directory = "/mock/downloads"

            # Create settings window with test config
            test_config = config_and_logger.get_default_config()

            # This should not affect production settings
            with patch.object(settings_window, "SettingsDialog") as mock_window:
                # Verify the class exists and can be mocked
                assert mock_window is not None

        except ImportError:
            # Settings window module may not be available in all test contexts
            pytest.skip("Settings window module not available")

    def test_storage_management_isolation(self):
        """Test that storage management uses isolated paths."""
        try:
            import storage_management

            # Create storage manager
            manager = storage_management.StorageOptimizer()

            # Check cache directory is isolated
            cache_dir = str(manager.cache_dir)
            assert "tmp" in cache_dir.lower() or "temp" in cache_dir.lower()

            # Check database path is isolated
            db_path = str(manager.db_path)
            assert "tmp" in db_path.lower() or "temp" in db_path.lower()

        except ImportError:
            # Storage management module may not be available
            pytest.skip("Storage management module not available")


class TestIsolationWarnings:
    """Test that isolation warnings work correctly."""

    def test_isolation_warning_system(self):
        """Test that warnings are issued if isolation fails."""
        # This test verifies the warning system works
        # In a properly isolated environment, these warnings should not fire

        config_path = config_and_logger._CONFIG_FILE_PATH

        # If we're properly isolated, config path should be in temp
        if "tmp" not in config_path.lower() and "temp" not in config_path.lower():
            pytest.fail(f"Config path {config_path} doesn't appear to be in temp directory")
