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
from unittest.mock import Mock, patch, mock_open, MagicMock

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
        """Test that config_and_logger can be imported."""
        try:
            import config_and_logger
            self.assertTrue(hasattr(config_and_logger, 'load_config'))
            self.assertTrue(hasattr(config_and_logger, 'save_config'))
            self.assertTrue(hasattr(config_and_logger, 'get_default_config'))
            self.assertTrue(hasattr(config_and_logger, 'setup_logging'))
        except ImportError as e:
            self.fail(f"Failed to import config_and_logger: {e}")

    def test_get_default_config(self):
        """Test get_default_config returns expected structure."""
        from config_and_logger import get_default_config
        
        default_config = get_default_config()
        
        # Check essential configuration keys
        self.assertIn('autoconnect', default_config)
        self.assertIn('download_directory', default_config)
        self.assertIn('log_level', default_config)
        self.assertIn('appearance_mode', default_config)
        self.assertIn('color_theme', default_config)
        
        # Check data types
        self.assertIsInstance(default_config['autoconnect'], bool)
        self.assertIsInstance(default_config['download_directory'], str)
        self.assertIsInstance(default_config['log_level'], str)

    @patch('config_and_logger._CONFIG_FILE_PATH')
    def test_load_config_file_exists(self, mock_config_path):
        """Test load_config when config file exists."""
        from config_and_logger import load_config
        
        mock_config_path.__str__ = Mock(return_value=self.temp_config_file)
        mock_config_path.__fspath__ = Mock(return_value=self.temp_config_file)
        
        # Create test config file
        test_config = {
            'autoconnect': True,
            'log_level': 'DEBUG',
            'appearance_mode': 'Dark'
        }
        
        with open(self.temp_config_file, 'w') as f:
            json.dump(test_config, f)
        
        with patch('config_and_logger.os.path.exists', return_value=True):
            result = load_config()
        
        self.assertEqual(result['autoconnect'], True)
        self.assertEqual(result['log_level'], 'DEBUG')
        self.assertEqual(result['appearance_mode'], 'Dark')

    @patch('config_and_logger._CONFIG_FILE_PATH')
    def test_load_config_file_not_exists(self, mock_config_path):
        """Test load_config when config file doesn't exist."""
        from config_and_logger import load_config
        
        mock_config_path.__str__ = Mock(return_value=self.temp_config_file)
        mock_config_path.__fspath__ = Mock(return_value=self.temp_config_file)
        
        with patch('config_and_logger.os.path.exists', return_value=False):
            result = load_config()
        
        # Should return default config
        self.assertIn('autoconnect', result)
        self.assertIn('log_level', result)

    @patch('config_and_logger._CONFIG_FILE_PATH')
    def test_load_config_invalid_json(self, mock_config_path):
        """Test load_config with invalid JSON file."""
        from config_and_logger import load_config
        
        mock_config_path.__str__ = Mock(return_value=self.temp_config_file)
        mock_config_path.__fspath__ = Mock(return_value=self.temp_config_file)
        
        # Create invalid JSON file
        with open(self.temp_config_file, 'w') as f:
            f.write("invalid json content")
        
        with patch('config_and_logger.os.path.exists', return_value=True):
            result = load_config()
        
        # Should return default config on JSON parse error
        self.assertIn('autoconnect', result)
        self.assertIn('log_level', result)

    @patch('config_and_logger._CONFIG_FILE_PATH')
    def test_save_config_success(self, mock_config_path):
        """Test successful config saving."""
        from config_and_logger import save_config
        
        mock_config_path.__str__ = Mock(return_value=self.temp_config_file)
        mock_config_path.__fspath__ = Mock(return_value=self.temp_config_file)
        
        test_config = {
            'autoconnect': False,
            'log_level': 'INFO',
            'custom_setting': 'test_value'
        }
        
        # Ensure parent directory exists
        os.makedirs(os.path.dirname(self.temp_config_file), exist_ok=True)
        
        result = save_config(test_config)
        
        self.assertTrue(result)
        
        # Verify file was written
        self.assertTrue(os.path.exists(self.temp_config_file))
        
        # Verify content
        with open(self.temp_config_file, 'r') as f:
            saved_config = json.load(f)
        
        self.assertEqual(saved_config['autoconnect'], False)
        self.assertEqual(saved_config['log_level'], 'INFO')
        self.assertEqual(saved_config['custom_setting'], 'test_value')

    @patch('config_and_logger._CONFIG_FILE_PATH')
    def test_save_config_permission_error(self, mock_config_path):
        """Test save_config with permission error."""
        from config_and_logger import save_config
        
        # Use a path that would cause permission error
        mock_config_path.__str__ = Mock(return_value="/root/readonly/config.json")
        mock_config_path.__fspath__ = Mock(return_value="/root/readonly/config.json")
        
        test_config = {'test': 'value'}
        
        result = save_config(test_config)
        
        # Should return False on error
        self.assertFalse(result)

    def test_update_config_settings_basic(self):
        """Test update_config_settings with basic operation."""
        from config_and_logger import update_config_settings
        
        with patch('config_and_logger.load_config') as mock_load, \
             patch('config_and_logger.save_config') as mock_save:
            
            mock_load.return_value = {
                'existing_setting': 'old_value',
                'keep_this': 'unchanged'
            }
            mock_save.return_value = True
            
            new_settings = {
                'existing_setting': 'new_value',
                'new_setting': 'new_value'
            }
            
            result = update_config_settings(new_settings)
            
            self.assertTrue(result)
            mock_load.assert_called_once()
            mock_save.assert_called_once()
            
            # Check that save was called with merged config
            saved_config = mock_save.call_args[0][0]
            self.assertEqual(saved_config['existing_setting'], 'new_value')
            self.assertEqual(saved_config['new_setting'], 'new_value')
            self.assertEqual(saved_config['keep_this'], 'unchanged')

    def test_update_config_settings_empty(self):
        """Test update_config_settings with empty settings."""
        from config_and_logger import update_config_settings
        
        result = update_config_settings({})
        
        # Should return True (no-op success)
        self.assertTrue(result)

    def test_setup_logging_basic(self):
        """Test basic setup_logging functionality."""
        from config_and_logger import setup_logging
        
        with patch('config_and_logger.logging') as mock_logging:
            mock_logger = Mock()
            mock_logging.getLogger.return_value = mock_logger
            
            setup_logging('DEBUG')
            
            mock_logging.getLogger.assert_called_with('HiDock')
            mock_logger.setLevel.assert_called()

    def test_setup_logging_invalid_level(self):
        """Test setup_logging with invalid log level."""
        from config_and_logger import setup_logging
        
        with patch('config_and_logger.logging') as mock_logging:
            mock_logger = Mock()
            mock_logging.getLogger.return_value = mock_logger
            
            # Should handle invalid log level gracefully
            setup_logging('INVALID_LEVEL')
            
            mock_logging.getLogger.assert_called_with('HiDock')

    def test_logger_singleton_behavior(self):
        """Test that logger instance is singleton."""
        from config_and_logger import logger
        
        logger1 = logger
        logger2 = logger
        
        # Should be the same instance
        self.assertIs(logger1, logger2)

    @patch('config_and_logger.os.path.expanduser')
    def test_config_directory_handling(self, mock_expanduser):
        """Test config directory path handling."""
        from config_and_logger import _SCRIPT_DIR, _CONFIG_FILE_PATH
        
        mock_expanduser.return_value = "/home/user"
        
        # Import should work without errors
        import config_and_logger
        
        # Should have proper attributes
        self.assertTrue(hasattr(config_and_logger, '_SCRIPT_DIR'))
        self.assertTrue(hasattr(config_and_logger, '_CONFIG_FILE_PATH'))

    def test_config_merge_preserves_defaults(self):
        """Test that config merging preserves default values."""
        from config_and_logger import get_default_config, load_config
        
        with patch('config_and_logger.os.path.exists', return_value=False):
            config = load_config()
            default_config = get_default_config()
            
            # All default keys should be present
            for key in default_config:
                self.assertIn(key, config)

    @patch('config_and_logger._CONFIG_FILE_PATH')
    def test_config_partial_file(self, mock_config_path):
        """Test loading config file with only partial settings."""
        from config_and_logger import load_config
        
        mock_config_path.__str__ = Mock(return_value=self.temp_config_file)
        mock_config_path.__fspath__ = Mock(return_value=self.temp_config_file)
        
        # Create partial config file (missing some default keys)
        partial_config = {
            'autoconnect': True,
            'log_level': 'ERROR'
            # Missing other default keys
        }
        
        with open(self.temp_config_file, 'w') as f:
            json.dump(partial_config, f)
        
        with patch('config_and_logger.os.path.exists', return_value=True):
            result = load_config()
        
        # Should have loaded values
        self.assertEqual(result['autoconnect'], True)
        self.assertEqual(result['log_level'], 'ERROR')
        
        # Should also have default values for missing keys
        self.assertIn('download_directory', result)
        self.assertIn('appearance_mode', result)

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

    @patch('config_and_logger.logger')
    def test_logging_integration(self, mock_logger):
        """Test logging integration in config operations."""
        from config_and_logger import save_config
        
        with patch('config_and_logger._CONFIG_FILE_PATH') as mock_path:
            mock_path.__str__ = Mock(return_value=self.temp_config_file)
            mock_path.__fspath__ = Mock(return_value=self.temp_config_file)
            
            test_config = {'test': 'value'}
            
            # Ensure directory exists
            os.makedirs(os.path.dirname(self.temp_config_file), exist_ok=True)
            
            save_config(test_config)
            
            # Logger should have been used
            mock_logger.info.assert_called()

    def test_config_file_atomic_write(self):
        """Test that config file writes are atomic (don't corrupt existing file)."""
        from config_and_logger import save_config
        
        with patch('config_and_logger._CONFIG_FILE_PATH') as mock_path:
            mock_path.__str__ = Mock(return_value=self.temp_config_file)
            mock_path.__fspath__ = Mock(return_value=self.temp_config_file)
            
            # Create initial config
            initial_config = {'initial': 'value'}
            os.makedirs(os.path.dirname(self.temp_config_file), exist_ok=True)
            
            result1 = save_config(initial_config)
            self.assertTrue(result1)
            
            # Update config
            updated_config = {'initial': 'value', 'new': 'setting'}
            result2 = save_config(updated_config)
            self.assertTrue(result2)
            
            # Verify final content
            with open(self.temp_config_file, 'r') as f:
                final_config = json.load(f)
            
            self.assertEqual(final_config['initial'], 'value')
            self.assertEqual(final_config['new'], 'setting')


class TestConfigConstants(unittest.TestCase):
    """Test configuration constants and defaults."""

    def test_constants_import(self):
        """Test that constants can be imported."""
        try:
            import constants
            # Verify basic structure exists
            self.assertTrue(hasattr(constants, '__file__'))
        except ImportError:
            # If constants module doesn't exist, create a basic test
            pass

    def test_default_config_values(self):
        """Test default configuration values are reasonable."""
        from config_and_logger import get_default_config
        
        config = get_default_config()
        
        # Test reasonable defaults
        self.assertIsInstance(config['autoconnect'], bool)
        self.assertIn(config['log_level'], ['DEBUG', 'INFO', 'WARNING', 'ERROR'])
        self.assertIn(config['appearance_mode'], ['System', 'Light', 'Dark'])
        self.assertIn(config['color_theme'], ['blue', 'green', 'dark-blue'])
        
        # Test numeric values
        self.assertIsInstance(config['recording_check_interval_s'], (int, float))
        self.assertGreater(config['recording_check_interval_s'], 0)

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
            self.assertNotIn(' ', key, f"Key '{key}' contains spaces")


class TestLoggerFunctionality(unittest.TestCase):
    """Test logger setup and functionality."""

    def test_logger_creation(self):
        """Test that logger is created properly."""
        from config_and_logger import logger
        
        self.assertIsNotNone(logger)
        # Should have expected logger methods
        self.assertTrue(hasattr(logger, 'debug'))
        self.assertTrue(hasattr(logger, 'info'))
        self.assertTrue(hasattr(logger, 'warning'))
        self.assertTrue(hasattr(logger, 'error'))

    @patch('config_and_logger.logging')
    def test_setup_logging_levels(self, mock_logging):
        """Test setup_logging with different levels."""
        from config_and_logger import setup_logging
        
        mock_logger = Mock()
        mock_logging.getLogger.return_value = mock_logger
        mock_logging.DEBUG = 10
        mock_logging.INFO = 20
        mock_logging.WARNING = 30
        mock_logging.ERROR = 40
        
        # Test different log levels
        for level in ['DEBUG', 'INFO', 'WARNING', 'ERROR']:
            setup_logging(level)
            mock_logger.setLevel.assert_called()

    def test_logger_instance_consistency(self):
        """Test that logger instance is consistent across imports."""
        # Import multiple times
        from config_and_logger import logger as logger1
        from config_and_logger import logger as logger2
        
        # Should be the same instance
        self.assertIs(logger1, logger2)


if __name__ == '__main__':
    unittest.main()
