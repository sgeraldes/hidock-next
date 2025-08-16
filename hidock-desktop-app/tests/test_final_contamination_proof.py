"""
Final Contamination Proof Test

This test comprehensively verifies that no test operations can contaminate production data.
It runs actual operations that would be dangerous in production and verifies they are isolated.
"""

import os
import shutil
import tempfile
from pathlib import Path
from unittest.mock import Mock

import pytest

import config_and_logger
import file_operations_manager


class TestFinalContaminationProof:
    """Comprehensive tests to prove no production data contamination can occur."""

    def test_config_operations_are_isolated(self):
        """Test that all config operations are completely isolated."""
        # Store original production paths for comparison
        original_home = Path("/tmp") if os.name == "posix" else Path.home()

        # Perform dangerous config operations
        dangerous_config = {
            "autoconnect": False,  # This would break user's setting
            "log_level": "ERROR",  # This would hide important logs
            "download_directory": "/dev/null",  # This would lose downloads
            "theme": "broken_theme",  # This would break UI
            "dangerous_test_marker": True,  # This should never appear in production
        }

        # Save dangerous config
        config_and_logger.save_config(dangerous_config)

        # Load it back
        loaded_config = config_and_logger.load_config()

        # Verify our dangerous settings are there (proving save/load works)
        assert loaded_config.get("dangerous_test_marker") is True
        assert loaded_config.get("theme") == "broken_theme"

        # Verify config file is in isolated location
        config_path = config_and_logger._CONFIG_FILE_PATH
        assert "tmp" in config_path.lower() or "temp" in config_path.lower()

        # Verify no production config files were created
        production_configs = [
            Path("hidock_config.json"),
            original_home / "hidock_config.json",
            original_home / ".hidock" / "hidock_config.json",
        ]

        for prod_config in production_configs:
            if prod_config.exists():
                # If it exists, verify it doesn't contain our dangerous marker
                try:
                    import json

                    with open(prod_config, "r") as f:
                        prod_data = json.load(f)
                    assert (
                        prod_data.get("dangerous_test_marker") is not True
                    ), f"Production config {prod_config} was contaminated!"
                except (json.JSONDecodeError, IOError):
                    # File exists but is not valid JSON or unreadable - that's OK
                    pass

    def test_database_operations_are_isolated(self):
        """Test that database operations don't affect production databases."""
        mock_device = Mock()

        # Create file operations manager (which creates databases)
        manager = file_operations_manager.FileOperationsManager(mock_device)

        # Verify database is in isolated location
        db_path = str(manager.metadata_cache.db_path)
        assert "tmp" in db_path.lower() or "temp" in db_path.lower()

        # Perform database operations
        from datetime import datetime

        from file_operations_manager import FileMetadata

        dangerous_metadata = FileMetadata(
            filename="dangerous_test_file.wav",
            size=12345,
            duration=120.5,
            date_created=datetime.fromisoformat("2025-01-01T00:00:00"),
            device_path="/device/dangerous_test_file.wav",
        )

        # Store dangerous data
        manager.metadata_cache.set_metadata(dangerous_metadata)

        # Verify it was stored
        retrieved = manager.metadata_cache.get_metadata("dangerous_test_file.wav")
        assert retrieved is not None
        assert retrieved.filename == "dangerous_test_file.wav"
        assert retrieved.size == 12345

        # Verify no production databases were created/modified
        original_home = Path("/tmp") if os.name == "posix" else Path.home()
        production_dbs = [
            Path("file_metadata.db"),
            Path("storage_optimization.db"),
            original_home / ".hidock" / "cache" / "file_metadata.db",
            original_home / ".hidock" / "cache" / "storage_optimization.db",
        ]

        for prod_db in production_dbs:
            if prod_db.exists():
                # If database exists, it should not contain our test data
                try:
                    import sqlite3

                    with sqlite3.connect(str(prod_db)) as conn:
                        cursor = conn.cursor()
                        cursor.execute("SELECT * FROM file_metadata WHERE filename = ?", ("dangerous_test_file.wav",))
                        result = cursor.fetchone()
                        assert result is None, f"Production database {prod_db} was contaminated!"
                except sqlite3.Error:
                    # Database error is OK - means it's not a valid database or table doesn't exist
                    pass

    def test_home_directory_isolation(self):
        """Test that home directory operations are completely isolated."""
        # Get what the application thinks is the home directory
        app_home = Path.home()

        # It should be a temporary directory
        assert "tmp" in str(app_home).lower() or "temp" in str(app_home).lower()

        # Test expanduser as well
        expanded_home = os.path.expanduser("~")
        assert "tmp" in expanded_home.lower() or "temp" in expanded_home.lower()

        # Verify they point to the same isolated location
        assert str(app_home) == expanded_home

    def test_storage_management_isolation(self):
        """Test that storage management operations are isolated."""
        try:
            import storage_management

            # Create storage optimizer
            optimizer = storage_management.StorageOptimizer()

            # Verify cache directory is isolated
            cache_dir = str(optimizer.cache_dir)
            assert "tmp" in cache_dir.lower() or "temp" in cache_dir.lower()

            # Verify database path is isolated
            db_path = str(optimizer.db_path)
            assert "tmp" in db_path.lower() or "temp" in db_path.lower()

        except ImportError:
            pytest.skip("Storage management module not available")

    def test_environment_variables_are_set(self):
        """Test that all isolation environment variables are properly set."""
        required_env_vars = [
            "TESTING",
            "HIDOCK_TEST_CONFIG_DIR",
            "HIDOCK_TEST_CACHE_DIR",
            "HIDOCK_TEST_DOWNLOADS_DIR",
            "HIDOCK_TEST_HOME_DIR",
        ]

        for env_var in required_env_vars:
            value = os.getenv(env_var)
            assert value is not None, f"Environment variable {env_var} not set"

            # All test directories should be in temp locations
            if env_var != "TESTING":
                assert (
                    "tmp" in value.lower() or "temp" in value.lower()
                ), f"Environment variable {env_var} not in temp location: {value}"

    def test_no_production_files_created(self, verify_no_production_contamination):
        """Test using contamination detection fixture."""
        # This test uses the contamination detection fixture
        # Any production file creation will cause the fixture to fail the test

        # Perform operations that could create files
        config_and_logger.save_config({"test": "contamination_test"})
        config_and_logger.load_config()

        mock_device = Mock()
        manager = file_operations_manager.FileOperationsManager(mock_device)

        # If any production files were created, the fixture will catch it

    def test_temp_file_cleanup_safety(self):
        """Test that temp files are being created in safe locations."""
        # Create some temporary files like tests might do
        with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
            temp_path = f.name

        try:
            # Verify temp file is in a safe location
            assert "tmp" in temp_path.lower() or "temp" in temp_path.lower()

            # Verify it's not in current directory or home directory
            assert not temp_path.startswith(os.getcwd())

            original_home = Path.home()
            if "tmp" not in str(original_home).lower():
                # Only check this if we can determine the real home directory
                assert not temp_path.startswith(str(original_home))

        finally:
            # Clean up
            try:
                os.unlink(temp_path)
            except OSError:
                pass

    def test_mock_operations_dont_create_files(self):
        """Test that mocked operations don't accidentally create real files."""
        mock_device = Mock()

        # Configure mock to return fake data
        mock_device.list_files.return_value = ["fake_file1.wav", "fake_file2.wav"]
        mock_device.get_file_info.return_value = {"size": 12345, "date": "2025-01-01"}

        # Create manager and perform operations
        manager = file_operations_manager.FileOperationsManager(mock_device)

        # Queue some downloads (these should be mocked and not create real files)
        manager.queue_download("fake_file1.wav")
        manager.queue_download("fake_file2.wav")

        # Wait a moment for operations to process
        import time

        time.sleep(0.1)

        # Verify no real files were created in current directory
        current_dir_files = list(Path(".").glob("fake_file*.wav"))
        assert len(current_dir_files) == 0, f"Mock operations created real files: {current_dir_files}"


@pytest.mark.contamination_check
class TestContaminationStressTest:
    """Stress test the isolation system with intensive operations."""

    def test_rapid_config_operations(self, verify_no_production_contamination):
        """Perform rapid config operations to stress test isolation."""
        for i in range(10):
            config = {
                f"stress_test_{i}": f"value_{i}",
                "download_directory": f"/stress/test/{i}",
                "theme": f"stress_theme_{i}",
            }
            config_and_logger.save_config(config)
            loaded = config_and_logger.load_config()
            assert loaded[f"stress_test_{i}"] == f"value_{i}"

    def test_multiple_database_operations(self, verify_no_production_contamination):
        """Create multiple database connections to stress test isolation."""
        managers = []

        try:
            for i in range(5):
                mock_device = Mock()
                manager = file_operations_manager.FileOperationsManager(mock_device)
                managers.append(manager)

                # Perform database operations
                from datetime import datetime

                from file_operations_manager import FileMetadata

                metadata = FileMetadata(
                    filename=f"stress_test_{i}.wav",
                    size=i * 1000,
                    duration=60.0 + i,
                    date_created=datetime.fromisoformat("2025-01-01T00:00:00"),
                    device_path=f"/device/stress_test_{i}.wav",
                )
                manager.metadata_cache.set_metadata(metadata)

        finally:
            # Clean up managers
            for manager in managers:
                try:
                    manager.shutdown()
                except:
                    pass
