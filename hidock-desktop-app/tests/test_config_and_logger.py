"""
Comprehensive tests for config_and_logger.py

Following TDD principles to achieve 80% test coverage as mandated by .amazonq/rules/PYTHON.md
"""

import json
import os
import sys
import tempfile
import unittest.mock as mock
from unittest.mock import Mock, mock_open, patch

import pytest

import config_and_logger
from config_and_logger import Logger, get_default_config, load_config, save_config


class TestGetDefaultConfig:
    """Test get_default_config function"""

    def test_get_default_config_returns_dict(self):
        """Test that get_default_config returns a dictionary"""
        config = get_default_config()

        assert isinstance(config, dict)
        assert len(config) > 0

    def test_get_default_config_contains_required_keys(self):
        """Test that default config contains all required keys"""
        config = get_default_config()

        required_keys = [
            "autoconnect",
            "download_directory",
            "log_level",
            "selected_vid",
            "selected_pid",
            "target_interface",
            "recording_check_interval_s",
            "default_command_timeout_ms",
            "file_stream_timeout_s",
            "auto_refresh_files",
            "auto_refresh_interval_s",
            "quit_without_prompt_if_connected",
            "appearance_mode",
            "color_theme",
            "suppress_console_output",
            "suppress_gui_log_output",
            "window_geometry",
            "treeview_columns_display_order",
            "logs_pane_visible",
            "gui_log_filter_level",
            "loop_playback",
            "playback_volume",
            "treeview_sort_col_id",
            "treeview_sort_descending",
            "log_colors",
            "icon_theme_color_light",
            "icon_theme_color_dark",
            "icon_fallback_color_1",
            "icon_fallback_color_2",
            "icon_size_str",
        ]

        for key in required_keys:
            assert key in config, f"Missing required key: {key}"

    def test_get_default_config_values(self):
        """Test that default config values are correct"""
        config = get_default_config()

        assert config["autoconnect"] is False
        assert config["log_level"] == "INFO"
        assert config["target_interface"] == 0
        assert config["recording_check_interval_s"] == 3
        assert config["appearance_mode"] == "System"
        assert config["color_theme"] == "blue"
        assert config["playback_volume"] == 0.5
        assert isinstance(config["log_colors"], dict)

    def test_get_default_config_download_directory_exists(self):
        """Test that default download directory is properly constructed"""
        config = get_default_config()

        assert "download_directory" in config
        assert "HiDock_Downloads" in config["download_directory"]
        # Should contain user home directory path
        assert os.path.expanduser("~") in config["download_directory"]


class TestLoadConfig:
    """Test load_config function"""

    @patch("config_and_logger.open", new_callable=mock_open, read_data='{"test_key": "test_value"}')
    def test_load_config_success(self, mock_file):
        """Test successful config loading merges with defaults"""
        result = load_config()

        # Should contain the loaded value
        assert "test_key" in result
        assert result["test_key"] == "test_value"
        # Should also contain default values
        assert "treeview_sort_col_id" in result
        assert "treeview_sort_descending" in result
        # Check that open was called with the expected parameters
        mock_file.assert_called_once()
        call_args = mock_file.call_args
        assert call_args[0][1] == "r"
        assert call_args[1]["encoding"] == "utf-8"

    @patch("config_and_logger.open", side_effect=FileNotFoundError)
    @patch("config_and_logger.get_default_config")
    def test_load_config_file_not_found(self, mock_get_default, mock_file):
        """Test load_config when file doesn't exist"""
        mock_get_default.return_value = {"default": "config"}

        with patch("builtins.print") as mock_print:
            result = load_config()

        assert result == {"default": "config"}
        mock_get_default.assert_called_once()
        mock_print.assert_called_once()
        assert "not found, using defaults" in mock_print.call_args[0][0]

    @patch("config_and_logger.open", new_callable=mock_open, read_data="invalid json")
    @patch("config_and_logger.get_default_config")
    def test_load_config_json_decode_error(self, mock_get_default, mock_file):
        """Test load_config when JSON is invalid"""
        mock_get_default.return_value = {"default": "config"}

        with patch("builtins.print") as mock_print:
            result = load_config()

        assert result == {"default": "config"}
        mock_get_default.assert_called_once()
        mock_print.assert_called_once()
        assert "Error decoding" in mock_print.call_args[0][0]


class TestSaveConfig:
    """Test save_config function"""

    @patch("config_and_logger.open", new_callable=mock_open)
    @patch("config_and_logger.json.dump")
    @patch("config_and_logger.logger")
    def test_save_config_success(self, mock_logger, mock_json_dump, mock_file):
        """Test successful config saving"""
        test_config = {"test": "data"}

        save_config(test_config)

        mock_file.assert_called_once()
        mock_json_dump.assert_called_once_with(test_config, mock_file.return_value.__enter__.return_value, indent=4)
        mock_logger.info.assert_called_once()

    @patch("config_and_logger.open", side_effect=IOError("Permission denied"))
    @patch("config_and_logger.logger")
    def test_save_config_io_error(self, mock_logger, mock_file):
        """Test save_config when IOError occurs"""
        test_config = {"test": "data"}

        save_config(test_config)

        mock_logger.error.assert_called_once()
        error_call_args = mock_logger.error.call_args[0]
        assert "Error writing to" in error_call_args[2]

    @patch("config_and_logger.open", side_effect=Exception("Unexpected error"))
    @patch("config_and_logger.logger")
    def test_save_config_unexpected_error(self, mock_logger, mock_file):
        """Test save_config when unexpected error occurs"""
        test_config = {"test": "data"}

        save_config(test_config)

        mock_logger.error.assert_called_once()
        error_call_args = mock_logger.error.call_args[0]
        assert "Unexpected error saving config" in error_call_args[2]


class TestLogger:
    """Test Logger class"""

    def test_logger_initialization_default(self):
        """Test Logger initialization with default config"""
        logger = Logger()

        assert logger.config == {}
        assert logger.level == Logger.LEVELS["INFO"]
        assert logger.gui_log_callback is None

    def test_logger_initialization_with_config(self):
        """Test Logger initialization with custom config"""
        config = {"log_level": "DEBUG", "suppress_console_output": True}
        logger = Logger(config)

        assert logger.config == config
        assert logger.level == Logger.LEVELS["DEBUG"]

    def test_logger_set_gui_log_callback(self):
        """Test setting GUI log callback"""
        logger = Logger()
        callback = Mock()

        logger.set_gui_log_callback(callback)

        assert logger.gui_log_callback == callback

    def test_logger_set_level_valid(self):
        """Test setting valid log level"""
        logger = Logger()

        with patch.object(logger, "_log") as mock_log:
            logger.set_level("ERROR")

        assert logger.level == Logger.LEVELS["ERROR"]
        mock_log.assert_called_once()

    def test_logger_set_level_invalid(self):
        """Test setting invalid log level defaults to INFO"""
        logger = Logger()
        initial_level = logger.level

        with patch.object(logger, "_log") as mock_log:
            logger.set_level("INVALID")

        assert logger.level == Logger.LEVELS["INFO"]
        # Should log since level changed from initial to INFO (if they were different)
        if initial_level != Logger.LEVELS["INFO"]:
            mock_log.assert_called_once()
        else:
            # If already INFO, no change so no log
            mock_log.assert_not_called()

    def test_logger_set_level_case_insensitive(self):
        """Test that log level setting is case insensitive"""
        logger = Logger()

        with patch.object(logger, "_log"):
            logger.set_level("debug")

        assert logger.level == Logger.LEVELS["DEBUG"]

    def test_logger_set_level_no_change(self):
        """Test that setting same level doesn't log"""
        logger = Logger()
        logger.level = Logger.LEVELS["INFO"]

        with patch.object(logger, "_log") as mock_log:
            logger.set_level("INFO")

        # Should not log if level didn't change
        mock_log.assert_not_called()

    def test_logger_update_config(self):
        """Test updating logger config"""
        logger = Logger({"initial": "config"})
        new_config = {"log_level": "WARNING", "new_key": "new_value"}

        with patch.object(logger, "set_level") as mock_set_level:
            logger.update_config(new_config)

        assert logger.config["initial"] == "config"
        assert logger.config["log_level"] == "WARNING"
        assert logger.config["new_key"] == "new_value"
        mock_set_level.assert_called_once_with("WARNING")

    def test_logger_update_config_no_log_level(self):
        """Test updating config without log_level"""
        logger = Logger()
        new_config = {"new_key": "new_value"}

        with patch.object(logger, "set_level") as mock_set_level:
            logger.update_config(new_config)

        assert logger.config["new_key"] == "new_value"
        mock_set_level.assert_not_called()

    def test_logger_internal_log_below_level(self):
        """Test that messages below log level are ignored"""
        logger = Logger()
        logger.level = Logger.LEVELS["ERROR"]

        with patch("builtins.print") as mock_print:
            logger._log("info", "module", "procedure", "message")

        mock_print.assert_not_called()

    def test_logger_internal_log_console_output(self):
        """Test console output for different log levels"""
        logger = Logger({"suppress_console_output": False})
        logger.level = Logger.LEVELS["DEBUG"]

        with patch("builtins.print") as mock_print:
            logger._log("info", "TestModule", "test_proc", "Test message")

        mock_print.assert_called_once()
        call_args = mock_print.call_args[0][0]
        assert "TestModule::test_proc" in call_args
        assert "Test message" in call_args
        assert "[INFO]" in call_args

    def test_logger_internal_log_error_to_stderr(self):
        """Test that ERROR and CRITICAL messages go to stderr"""
        logger = Logger()
        logger.level = Logger.LEVELS["DEBUG"]

        with patch("sys.stderr") as mock_stderr:
            logger._log("error", "TestModule", "test_proc", "Error message")

        mock_stderr.write.assert_called_once()
        mock_stderr.flush.assert_called_once()

    def test_logger_internal_log_suppress_console(self):
        """Test suppressing console output"""
        logger = Logger({"suppress_console_output": True})

        with patch("builtins.print") as mock_print:
            logger._log("info", "module", "procedure", "message")

        mock_print.assert_not_called()

    def test_logger_internal_log_gui_callback(self):
        """Test GUI callback functionality"""
        logger = Logger({"suppress_gui_log_output": False})
        callback = Mock()
        logger.set_gui_log_callback(callback)

        logger._log("info", "TestModule", "test_proc", "Test message")

        callback.assert_called_once()
        call_args = callback.call_args[0]
        assert "TestModule::test_proc" in call_args[0]
        assert "Test message" in call_args[0]
        assert call_args[1] == "INFO"

    def test_logger_internal_log_suppress_gui(self):
        """Test suppressing GUI output"""
        logger = Logger({"suppress_gui_log_output": True})
        callback = Mock()
        logger.set_gui_log_callback(callback)

        logger._log("info", "module", "procedure", "message")

        callback.assert_not_called()

    def test_logger_internal_log_force_level(self):
        """Test force_level parameter"""
        logger = Logger()
        logger.level = Logger.LEVELS["ERROR"]

        with patch("builtins.print") as mock_print:
            # This would normally be ignored due to level, but force_level should override
            logger._log("info", "module", "procedure", "message", force_level=Logger.LEVELS["INFO"])

        mock_print.assert_called_once()

    def test_logger_convenience_methods(self):
        """Test convenience logging methods"""
        logger = Logger()

        with patch.object(logger, "_log") as mock_log:
            logger.info("TestModule", "test_method", "Info message")
            logger.debug("TestModule", "test_method", "Debug message")
            logger.error("TestModule", "test_method", "Error message")
            logger.warning("TestModule", "test_method", "Warning message")

        assert mock_log.call_count == 4

        calls = mock_log.call_args_list
        assert calls[0][0][:4] == ("info", "TestModule", "test_method", "Info message")
        assert calls[1][0][:4] == ("debug", "TestModule", "test_method", "Debug message")
        assert calls[2][0][:4] == ("error", "TestModule", "test_method", "Error message")
        assert calls[3][0][:4] == ("warning", "TestModule", "test_method", "Warning message")

    def test_logger_levels_constant(self):
        """Test that LEVELS constant is correct"""
        expected_levels = {"DEBUG": 10, "INFO": 20, "WARNING": 30, "ERROR": 40, "CRITICAL": 50}

        assert Logger.LEVELS == expected_levels

    def test_logger_color_constants(self):
        """Test that color constants are defined"""
        assert hasattr(Logger, "COLOR_RED")
        assert hasattr(Logger, "COLOR_YELLOW")
        assert hasattr(Logger, "COLOR_GREY")
        assert hasattr(Logger, "COLOR_WHITE")
        assert hasattr(Logger, "COLOR_RESET")

        # Colors should be ANSI escape sequences
        assert Logger.COLOR_RED.startswith("\033[")
        assert Logger.COLOR_RESET == "\033[0m"


class TestModuleIntegration:
    """Test module-level integration"""

    def test_global_logger_exists(self):
        """Test that global logger instance exists"""
        assert hasattr(config_and_logger, "logger")
        assert isinstance(config_and_logger.logger, Logger)

    def test_module_constants(self):
        """Test that module has required constants"""
        # These should be imported from constants.py
        assert hasattr(config_and_logger, "_CONFIG_FILE_PATH")
        assert hasattr(config_and_logger, "_SCRIPT_DIR")

    def test_global_logger_initialization(self):
        """Test that global logger is initialized properly"""
        # The global logger should already be initialized when the module is imported
        assert config_and_logger.logger is not None
        assert isinstance(config_and_logger.logger, Logger)

        # Test that the logger has a reasonable initial configuration
        assert config_and_logger.logger.level >= Logger.LEVELS["DEBUG"]

    def test_script_dir_calculation(self):
        """Test that script directory is calculated correctly"""
        assert config_and_logger._SCRIPT_DIR.endswith("hidock-desktop-app")
        assert os.path.isabs(config_and_logger._SCRIPT_DIR)

    def test_config_file_path_construction(self):
        """Test that config file path is constructed correctly"""
        assert config_and_logger._CONFIG_FILE_PATH.endswith(".json")
        assert os.path.isabs(config_and_logger._CONFIG_FILE_PATH)


class TestErrorScenarios:
    """Test error handling scenarios"""

    def test_logger_with_none_config(self):
        """Test Logger with None config"""
        logger = Logger(None)

        assert logger.config == {}
        assert logger.level == Logger.LEVELS["INFO"]

    def test_logger_internal_log_invalid_level(self):
        """Test _log with invalid level string"""
        logger = Logger()

        with patch("builtins.print") as mock_print:
            logger._log("INVALID_LEVEL", "module", "procedure", "message")

        # Should not print anything for invalid level
        mock_print.assert_not_called()

    def test_logger_internal_log_none_level(self):
        """Test _log with None level (edge case)"""
        logger = Logger()

        with patch("builtins.print") as mock_print:
            # This should handle the case gracefully by not crashing
            try:
                logger._log(None, "module", "procedure", "message")
            except AttributeError:
                # This is expected since None doesn't have upper() method
                pass

        # Should not print anything for None level
        mock_print.assert_not_called()
