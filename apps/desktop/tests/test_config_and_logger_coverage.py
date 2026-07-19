#!/usr/bin/env python3
"""
Tests for config_and_logger.py
Covers configuration management, logging setup, and file operations.
"""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

# Add the parent directory to sys.path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))


class TestConfigAndLogger(unittest.TestCase):
    """Test config_and_logger functionality."""

    def setUp(self):
        """Set up test fixtures."""
        self.temp_dir = tempfile.mkdtemp()
        self.temp_config_file = os.path.join(self.temp_dir, "test_config.json")

    def tearDown(self):
        """Clean up test fixtures."""
        import shutil

        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_import_config_and_logger(self):
        """Test that config_and_logger exposes its public API."""
        try:
            import config_and_logger

            self.assertTrue(hasattr(config_and_logger, "load_config"))
            self.assertTrue(hasattr(config_and_logger, "save_config"))
            self.assertTrue(hasattr(config_and_logger, "get_default_config"))
            self.assertTrue(hasattr(config_and_logger, "update_config_settings"))
            # Logging is provided by the Logger class and the module-level `logger`
            # singleton, not by a setup_logging() function.
            self.assertTrue(hasattr(config_and_logger, "Logger"))
            self.assertTrue(hasattr(config_and_logger, "logger"))
        except ImportError as e:
            self.fail(f"Failed to import config_and_logger: {e}")

    def test_get_default_config(self):
        """Test get_default_config returns expected structure."""
        from config_and_logger import get_default_config

        default_config = get_default_config()

        # Check essential configuration keys
        self.assertIn("autoconnect", default_config)
        self.assertIn("download_directory", default_config)
        self.assertIn("log_level", default_config)
        self.assertIn("appearance_mode", default_config)
        self.assertIn("color_theme", default_config)

        # Check data types
        self.assertIsInstance(default_config["autoconnect"], bool)
        self.assertIsInstance(default_config["download_directory"], str)
        self.assertIsInstance(default_config["log_level"], str)

    def test_load_config_file_exists(self):
        """Test load_config when config file exists."""
        from config_and_logger import load_config

        # Create test config file
        test_config = {"autoconnect": True, "log_level": "DEBUG", "appearance_mode": "Dark"}

        with open(self.temp_config_file, "w") as f:
            json.dump(test_config, f)

        with patch("config_and_logger._CONFIG_FILE_PATH", self.temp_config_file):
            result = load_config()

        self.assertEqual(result["autoconnect"], True)
        self.assertEqual(result["log_level"], "DEBUG")
        self.assertEqual(result["appearance_mode"], "Dark")

    def test_load_config_file_not_exists(self):
        """Test load_config when config file doesn't exist."""
        from config_and_logger import get_default_config, load_config

        missing_path = os.path.join(self.temp_dir, "does_not_exist.json")

        with patch("config_and_logger._CONFIG_FILE_PATH", missing_path):
            result = load_config()

        # Should return the default config verbatim
        self.assertEqual(result, get_default_config())

    def test_load_config_invalid_json(self):
        """Test load_config with invalid JSON file."""
        from config_and_logger import get_default_config, load_config

        # Create invalid JSON file
        with open(self.temp_config_file, "w") as f:
            f.write("invalid json content")

        with patch("config_and_logger._CONFIG_FILE_PATH", self.temp_config_file):
            result = load_config()

        # Should return default config on JSON parse error
        self.assertEqual(result, get_default_config())

    def test_save_config_success(self):
        """Test successful config saving."""
        from config_and_logger import save_config

        test_config = {"autoconnect": False, "log_level": "INFO", "custom_setting": "test_value"}

        with patch("config_and_logger._CONFIG_FILE_PATH", self.temp_config_file):
            save_config(test_config)

        # Verify file was written
        self.assertTrue(os.path.exists(self.temp_config_file))

        # Verify content
        with open(self.temp_config_file, "r") as f:
            saved_config = json.load(f)

        self.assertEqual(saved_config["autoconnect"], False)
        self.assertEqual(saved_config["log_level"], "INFO")
        self.assertEqual(saved_config["custom_setting"], "test_value")

    def test_save_config_creates_missing_directory(self):
        """save_config creates the config directory rather than failing the write."""
        from config_and_logger import save_config

        nested_path = os.path.join(self.temp_dir, "nested", "config", "hidock_config.json")

        with patch("config_and_logger._CONFIG_FILE_PATH", nested_path):
            save_config({"autoconnect": True})

        self.assertTrue(os.path.exists(nested_path))
        with open(nested_path, "r") as f:
            self.assertEqual(json.load(f)["autoconnect"], True)

    def test_save_config_write_error_is_reported_not_raised(self):
        """An unwritable config path must be logged, not raised, and must not write."""
        from config_and_logger import save_config

        # Occupy the parent directory slot with a regular file so both makedirs and the
        # write fail. This is portable, unlike relying on a privileged absolute path.
        blocker = os.path.join(self.temp_dir, "blocker")
        with open(blocker, "w") as f:
            f.write("not a directory")
        unwritable = os.path.join(blocker, "hidock_config.json")

        with patch("config_and_logger._CONFIG_FILE_PATH", unwritable):
            with patch("config_and_logger.logger") as mock_logger:
                save_config({"test": "value"})

        mock_logger.error.assert_called()
        self.assertFalse(os.path.exists(unwritable))

    def test_update_config_settings_merges_into_existing_file(self):
        """update_config_settings writes only the changed keys and preserves the rest."""
        from config_and_logger import update_config_settings

        with open(self.temp_config_file, "w") as f:
            json.dump({"existing_setting": "old_value", "keep_this": "unchanged"}, f)

        new_settings = {"existing_setting": "new_value", "new_setting": "new_value"}

        with patch("config_and_logger._CONFIG_FILE_PATH", self.temp_config_file):
            update_config_settings(new_settings)

        with open(self.temp_config_file, "r") as f:
            saved_config = json.load(f)

        self.assertEqual(saved_config["existing_setting"], "new_value")
        self.assertEqual(saved_config["new_setting"], "new_value")
        self.assertEqual(saved_config["keep_this"], "unchanged")

    def test_update_config_settings_refreshes_the_logger(self):
        """update_config_settings also pushes the new settings into the live logger."""
        from config_and_logger import update_config_settings

        with patch("config_and_logger._CONFIG_FILE_PATH", self.temp_config_file):
            with patch("config_and_logger.logger") as mock_logger:
                update_config_settings({"log_level": "DEBUG"})

        mock_logger.update_config.assert_called_once_with({"log_level": "DEBUG"})

    def test_update_config_settings_empty(self):
        """An empty update is a no-op that still leaves the existing config intact."""
        from config_and_logger import update_config_settings

        with open(self.temp_config_file, "w") as f:
            json.dump({"keep_this": "unchanged"}, f)

        with patch("config_and_logger._CONFIG_FILE_PATH", self.temp_config_file):
            update_config_settings({})

        with open(self.temp_config_file, "r") as f:
            self.assertEqual(json.load(f)["keep_this"], "unchanged")

    def test_logger_configures_level_from_initial_config(self):
        """A Logger picks up log_level from the config it is constructed with."""
        from config_and_logger import Logger

        log = Logger(initial_config={"log_level": "DEBUG", "enable_file_logging": False})

        self.assertEqual(log.level, Logger.LEVELS["DEBUG"])

    def test_logger_invalid_level_falls_back_to_info(self):
        """An unrecognised level name must not raise; it falls back to INFO."""
        from config_and_logger import Logger

        log = Logger(initial_config={"enable_file_logging": False})
        log.set_level("INVALID_LEVEL")

        self.assertEqual(log.level, Logger.LEVELS["INFO"])

    def test_logger_singleton_behavior(self):
        """Test that logger instance is singleton."""
        from config_and_logger import logger

        logger1 = logger
        logger2 = logger

        # Should be the same instance
        self.assertIs(logger1, logger2)

    @patch("config_and_logger.os.path.expanduser")
    def test_config_directory_handling(self, mock_expanduser):
        """Test config directory path handling."""

        mock_expanduser.return_value = "/home/user"

        # Import should work without errors
        import config_and_logger

        # Should have proper attributes
        self.assertTrue(hasattr(config_and_logger, "_SCRIPT_DIR"))
        self.assertTrue(hasattr(config_and_logger, "_CONFIG_FILE_PATH"))

    def test_config_merge_preserves_defaults(self):
        """Test that config merging preserves default values."""
        from config_and_logger import get_default_config, load_config

        with patch("config_and_logger.os.path.exists", return_value=False):
            config = load_config()
            default_config = get_default_config()

            # All default keys should be present
            for key in default_config:
                self.assertIn(key, config)

    def test_config_partial_file(self):
        """Test loading config file with only partial settings."""
        from config_and_logger import load_config

        # Create partial config file (missing some default keys)
        partial_config = {
            "autoconnect": True,
            "log_level": "ERROR",
            # Missing other default keys
        }

        with open(self.temp_config_file, "w") as f:
            json.dump(partial_config, f)

        with patch("config_and_logger._CONFIG_FILE_PATH", self.temp_config_file):
            result = load_config()

        # Should have loaded values
        self.assertEqual(result["autoconnect"], True)
        self.assertEqual(result["log_level"], "ERROR")

        # Should also have default values for missing keys
        self.assertIn("download_directory", result)
        self.assertIn("appearance_mode", result)

    def test_json_serialization_compatibility(self):
        """Test that config values are JSON serializable."""
        from config_and_logger import get_default_config

        default_config = get_default_config()

        try:
            # Should be able to serialize and deserialize without errors
            json_str = json.dumps(default_config)
            parsed_config = json.loads(json_str)

            self.assertEqual(default_config, parsed_config)
        except (TypeError, ValueError) as e:
            self.fail(f"Config not JSON serializable: {e}")

    @patch("config_and_logger.logger")
    def test_logging_integration(self, mock_logger):
        """A successful save reports the specific settings it wrote."""
        from config_and_logger import save_config

        with patch("config_and_logger._CONFIG_FILE_PATH", self.temp_config_file):
            save_config({"test": "value"})

        mock_logger.info.assert_called()
        logged_message = mock_logger.info.call_args[0][2]
        self.assertIn("test=value", logged_message)

    def test_config_file_repeated_writes_preserve_earlier_settings(self):
        """A second save must merge with, not clobber, the settings already on disk."""
        from config_and_logger import save_config

        with patch("config_and_logger._CONFIG_FILE_PATH", self.temp_config_file):
            save_config({"initial": "value"})
            save_config({"new": "setting"})

        with open(self.temp_config_file, "r") as f:
            final_config = json.load(f)

        self.assertEqual(final_config["initial"], "value")
        self.assertEqual(final_config["new"], "setting")


class TestConfigConstants(unittest.TestCase):
    """Test configuration constants and defaults."""

    def test_constants_import(self):
        """Test that constants can be imported."""
        try:
            import constants

            # Verify basic structure exists
            self.assertTrue(hasattr(constants, "__file__"))
        except ImportError:
            # If constants module doesn't exist, create a basic test
            pass

    def test_default_config_values(self):
        """Test default configuration values are reasonable."""
        from config_and_logger import get_default_config

        config = get_default_config()

        # Test reasonable defaults
        self.assertIsInstance(config["autoconnect"], bool)
        self.assertIn(config["log_level"], ["DEBUG", "INFO", "WARNING", "ERROR"])
        self.assertIn(config["appearance_mode"], ["System", "Light", "Dark"])
        self.assertIn(config["color_theme"], ["blue", "green", "dark-blue"])

        # Test numeric values
        self.assertIsInstance(config["recording_check_interval_s"], (int, float))
        self.assertGreater(config["recording_check_interval_s"], 0)

    def test_config_key_consistency(self):
        """Test that config keys are consistent (no typos/inconsistencies)."""
        from config_and_logger import get_default_config

        config = get_default_config()

        # Check for common typos or inconsistencies
        keys = list(config.keys())

        # Should not have duplicate-like keys
        lowercase_keys = [k.lower() for k in keys]
        self.assertEqual(len(lowercase_keys), len(set(lowercase_keys)), "Duplicate keys found")

        # Keys should follow naming conventions
        for key in keys:
            self.assertIsInstance(key, str)
            self.assertGreater(len(key), 0)
            # Should not contain spaces (use underscores)
            self.assertNotIn(" ", key, f"Key '{key}' contains spaces")


class TestLoggerFunctionality(unittest.TestCase):
    """Test logger setup and functionality."""

    def test_logger_creation(self):
        """Test that logger is created properly."""
        from config_and_logger import logger

        self.assertIsNotNone(logger)
        # Should have expected logger methods
        self.assertTrue(hasattr(logger, "debug"))
        self.assertTrue(hasattr(logger, "info"))
        self.assertTrue(hasattr(logger, "warning"))
        self.assertTrue(hasattr(logger, "error"))

    def test_set_level_accepts_every_supported_level(self):
        """set_level maps every documented level name, case-insensitively."""
        from config_and_logger import Logger

        log = Logger(initial_config={"enable_file_logging": False})

        for level in ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]:
            log.set_level(level)
            self.assertEqual(log.level, Logger.LEVELS[level])

            log.set_level(level.lower())
            self.assertEqual(log.level, Logger.LEVELS[level])

    def test_logger_instance_consistency(self):
        """Test that logger instance is consistent across imports."""
        # Import multiple times
        from config_and_logger import logger as logger1
        from config_and_logger import logger as logger2

        # Should be the same instance
        self.assertIs(logger1, logger2)


if __name__ == "__main__":
    unittest.main()
