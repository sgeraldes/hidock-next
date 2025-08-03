"""
Tests for settings persistence across the application.

This module tests that settings are properly saved and loaded in all scenarios:
1. Settings window apply/ok actions
2. Main window closing
3. Download directory changes
4. Configuration merging with defaults
"""

import json
import os
import tempfile
from pathlib import Path
from unittest.mock import Mock, mock_open, patch

import pytest

import config_and_logger
import gui_event_handlers
import gui_main_window
import settings_window


class TestSettingsPersistence:
    """Test settings persistence across different scenarios."""

    def setup_method(self):
        """Setup for each test method."""
        self.test_config = {  # pylint: disable=attribute-defined-outside-init
            "autoconnect": True,
            "download_directory": "/test/path",
            "log_level": "DEBUG",
            "selected_vid": 1234,
            "selected_pid": 5678,
            "appearance_mode": "Dark",
            "color_theme": "green",
            "treeview_sort_col_id": "name",
            "treeview_sort_descending": False,
        }

    @pytest.mark.unit
    def test_config_loading_merges_with_defaults(self):
        """Test that loading config merges loaded values with defaults."""

        # Mock file content with partial config
        partial_config = {"autoconnect": True, "log_level": "ERROR"}

        with patch("config_and_logger.open", mock_open(read_data=json.dumps(partial_config))):
            loaded_config = config_and_logger.load_config()

        # Should contain loaded values
        assert loaded_config["autoconnect"] is True
        assert loaded_config["log_level"] == "ERROR"

        # Should also contain default values for missing keys
        defaults = config_and_logger.get_default_config()
        for key, default_value in defaults.items():
            if key not in partial_config:
                assert key in loaded_config
                assert loaded_config[key] == default_value

    @pytest.mark.unit
    def test_config_loading_preserves_all_loaded_values(self):
        """Test that all values from config file are preserved."""
        with patch("config_and_logger.open", mock_open(read_data=json.dumps(self.test_config))):
            loaded_config = config_and_logger.load_config()

        # All original values should be preserved
        for key, value in self.test_config.items():
            assert loaded_config[key] == value

    @pytest.mark.unit
    def test_settings_window_saves_config_on_apply(self):
        """Test that settings window saves config when Apply is clicked."""

        # Create mock parent GUI with config
        mock_parent = Mock()
        mock_parent.config = self.test_config.copy()
        mock_parent.download_directory = "/test/path"

        # Mock all required attributes and methods
        mock_parent.apply_appearance_mode_theme_color.return_value = "#000000"
        mock_parent.apply_theme_and_color = Mock()
        mock_parent.logger_processing_level_var = Mock()
        mock_parent.suppress_console_output_var = Mock()
        mock_parent.suppress_gui_log_output_var = Mock()
        mock_parent.update_log_colors_gui = Mock()
        mock_parent.update_all_status_info = Mock()

        # Mock dock instance
        mock_dock = Mock()
        mock_dock.is_connected.return_value = False

        # Create dialog instance without calling __init__
        dialog = settings_window.SettingsDialog.__new__(settings_window.SettingsDialog)
        dialog.parent_gui = mock_parent
        dialog.dock = mock_dock
        dialog.local_vars = {}
        dialog.settings_changed_tracker = [True]
        # pylint: disable=protected-access
        dialog._fetched_device_settings_for_dialog = {}
        dialog.current_dialog_download_dir = ["/test/path"]
        dialog.initial_download_directory = "/test/path"

        # Mock the validation method to return True
        # pylint: disable=protected-access
        dialog._validate_numeric_settings = Mock(return_value=True)

        with patch("settings_window.save_config") as mock_save_config:
            # pylint: disable=protected-access
            dialog._perform_apply_settings_logic(update_dialog_baseline=False)

            # Should call save_config with parent's config
            mock_save_config.assert_called_once_with(mock_parent.config)

    @pytest.mark.unit
    def test_main_window_saves_config_on_closing(self):  # pylint: disable=too-many-statements
        """Test that main window saves config when closing."""
        # Mock the main window class
        with patch("gui_main_window.save_config") as mock_save_config:
            # Create a mock main window instance
            mock_window = Mock()
            mock_window.config = self.test_config.copy()

            # Mock all the variables that get saved
            mock_window.geometry.return_value = "800x600+100+100"
            mock_window.autoconnect_var.get.return_value = True
            mock_window.download_directory = "/test/path"
            mock_window.logger_processing_level_var.get.return_value = "DEBUG"
            mock_window.selected_vid_var.get.return_value = 1234
            mock_window.selected_pid_var.get.return_value = 5678
            mock_window.target_interface_var.get.return_value = 0
            mock_window.recording_check_interval_var.get.return_value = 3
            mock_window.default_command_timeout_ms_var.get.return_value = 5000
            mock_window.file_stream_timeout_s_var.get.return_value = 180
            mock_window.auto_refresh_files_var.get.return_value = False
            mock_window.auto_refresh_interval_s_var.get.return_value = 30
            mock_window.quit_without_prompt_var.get.return_value = False
            mock_window.appearance_mode_var.get.return_value = "Dark"
            mock_window.color_theme_var.get.return_value = "green"
            mock_window.suppress_console_output_var.get.return_value = False
            mock_window.suppress_gui_log_output_var.get.return_value = False
            mock_window.gui_log_filter_level_var.get.return_value = "DEBUG"
            mock_window.logs_visible_var.get.return_value = False
            mock_window.loop_playback_var.get.return_value = False
            mock_window.volume_var.get.return_value = 0.5
            mock_window.treeview_sort_column = "name"
            mock_window.saved_treeview_sort_column = "datetime"
            mock_window.treeview_sort_reverse = False
            mock_window.single_selection_mode_var.get.return_value = True

            # Mock file tree
            mock_window.file_tree = {"displaycolumns": ["name", "datetime", "size"]}

            # Mock device manager
            mock_window.device_manager.device_interface.is_connected.return_value = False
            mock_window.device_manager.device_interface.disconnect = Mock()

            # Mock log color variables
            for level in config_and_logger.Logger.LEVELS:
                level_lower = level.lower()
                light_var = Mock()
                light_var.get.return_value = "#000000"
                dark_var = Mock()
                dark_var.get.return_value = "#FFFFFF"
                setattr(mock_window, f"log_color_{level_lower}_light_var", light_var)
                setattr(mock_window, f"log_color_{level_lower}_dark_var", dark_var)

            # Mock other attributes
            mock_window.icon_pref_light_color = "black"
            mock_window.icon_pref_dark_color = "white"
            mock_window.icon_fallback_color_1 = "blue"
            mock_window.icon_fallback_color_2 = "default"
            mock_window.icon_size_str = "32"
            mock_window.current_playing_temp_file = None

            # Mock sys.exit to prevent actual exit
            with patch("sys.exit"):
                gui_main_window.HiDockToolGUI.on_closing(mock_window)

            # Should call save_config
            mock_save_config.assert_called_once()
            saved_config = mock_save_config.call_args[0][0]

            # Verify key settings were saved
            assert saved_config["window_geometry"] == "800x600+100+100"
            assert saved_config["autoconnect"] is True
            assert saved_config["download_directory"] == "/test/path"
            assert saved_config["appearance_mode"] == "Dark"
            assert saved_config["treeview_sort_col_id"] == "name"

    @pytest.mark.unit
    def test_download_directory_change_saves_config(self):
        """Test that changing download directory saves config."""
        # Create mock GUI instance
        mock_gui = Mock()
        mock_gui.config = self.test_config.copy()
        mock_gui.download_directory = "/old/path"

        mock_gui.file_operations_manager = Mock()
        mock_gui.file_operations_manager.download_dir = Path("/old/path")

        # Mock UI elements
        mock_gui.download_dir_button_header = Mock()
        mock_gui.download_dir_button_header.winfo_exists.return_value = True
        mock_gui.download_dir_button_header.configure = Mock()

        # Mock methods
        mock_gui.update_all_status_info = Mock()
        mock_gui.refresh_file_status_after_directory_change = Mock()

        # Mock the _prompt_for_directory method to avoid the actual dialog
        # pylint: disable=protected-access
        mock_gui._prompt_for_directory = Mock(return_value="/new/path")

        with patch("config_and_logger.save_config") as mock_save_config:
            # pylint: disable=protected-access
            gui_event_handlers.EventHandlersMixin._select_download_dir_from_header_button(mock_gui)

            # Should save config with new directory
            mock_save_config.assert_called_once_with(mock_gui.config)
            assert mock_gui.config["download_directory"] == "/new/path"
            assert mock_gui.download_directory == "/new/path"

    @pytest.mark.unit
    def test_config_save_function_writes_correctly(self):
        """Test that save_config function writes data correctly."""

        with patch("config_and_logger.open", mock_open()) as mock_file, patch(
            "config_and_logger.json.dump"
        ) as mock_json_dump, patch("config_and_logger.logger") as mock_logger:
            config_and_logger.save_config(self.test_config)

            # Should open file for writing
            mock_file.assert_called_once()
            call_args = mock_file.call_args
            assert call_args[0][1] == "w"
            assert call_args[1]["encoding"] == "utf-8"

            # Should dump JSON with proper formatting
            mock_json_dump.assert_called_once()
            json_call_args = mock_json_dump.call_args
            assert json_call_args[0][0] == self.test_config
            assert json_call_args[1]["indent"] == 4

            # Should log success
            mock_logger.info.assert_called_once()

    @pytest.mark.unit
    def test_sorting_preferences_persistence(self):
        """Test that sorting preferences are saved and loaded correctly."""

        # Test config with sorting preferences
        sort_config = {"treeview_sort_col_id": "name", "treeview_sort_descending": True}

        # Test saving
        with patch("config_and_logger.open", mock_open()), patch("config_and_logger.json.dump") as mock_json_dump:
            config_and_logger.save_config(sort_config)

            # Verify sorting settings are included
            saved_data = mock_json_dump.call_args[0][0]
            assert saved_data["treeview_sort_col_id"] == "name"
            assert saved_data["treeview_sort_descending"] is True

        # Test loading
        with patch("config_and_logger.open", mock_open(read_data=json.dumps(sort_config))):
            loaded_config = config_and_logger.load_config()

            # Should preserve sorting settings
            assert loaded_config["treeview_sort_col_id"] == "name"
            assert loaded_config["treeview_sort_descending"] is True

    @pytest.mark.unit
    def test_default_sort_column_name_consistency(self):
        """Test that default sort column name is consistent between save and load."""
        defaults = config_and_logger.get_default_config()

        # The default sort column should be "datetime" not "time"
        assert defaults["treeview_sort_col_id"] == "datetime"
        assert isinstance(defaults["treeview_sort_descending"], bool)

    @pytest.mark.integration
    def test_full_settings_persistence_cycle(self):
        """Integration test for complete settings persistence cycle."""

        # Create a temporary config file
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as temp_file:
            temp_path = temp_file.name
            json.dump(self.test_config, temp_file, indent=4)

        try:
            # Mock the config file path
            with patch("config_and_logger._CONFIG_FILE_PATH", temp_path):
                # Load config
                loaded_config = config_and_logger.load_config()

                # Verify all values loaded correctly
                for key, value in self.test_config.items():
                    assert loaded_config[key] == value

                # Modify some values
                loaded_config["autoconnect"] = False
                loaded_config["appearance_mode"] = "Light"
                loaded_config["treeview_sort_col_id"] = "size"

                # Save modified config
                config_and_logger.save_config(loaded_config)

                # Load again to verify persistence
                reloaded_config = config_and_logger.load_config()

                # Verify changes were saved
                assert reloaded_config["autoconnect"] is False
                assert reloaded_config["appearance_mode"] == "Light"
                assert reloaded_config["treeview_sort_col_id"] == "size"

                # Verify unchanged values are still there
                assert reloaded_config["selected_vid"] == 1234
                assert reloaded_config["selected_pid"] == 5678

        finally:
            # Clean up temp file
            if os.path.exists(temp_path):
                os.unlink(temp_path)

    @pytest.mark.unit
    def test_config_corruption_handling(self):
        """Test handling of corrupted config files."""

        # Test with corrupted JSON
        corrupted_json = '{"autoconnect": true, "invalid": }'

        with patch("config_and_logger.open", mock_open(read_data=corrupted_json)), patch(
            "builtins.print"
        ) as mock_print:
            loaded_config = config_and_logger.load_config()

            # Should fall back to defaults
            defaults = config_and_logger.get_default_config()
            for key, default_value in defaults.items():
                assert loaded_config[key] == default_value

            # Should print error message
            mock_print.assert_called_once()
            assert "Error decoding" in mock_print.call_args[0][0]

    @pytest.mark.unit
    def test_missing_config_file_handling(self):
        """Test handling when config file doesn't exist."""
        with patch("config_and_logger.open", side_effect=FileNotFoundError), patch("builtins.print") as mock_print:
            loaded_config = config_and_logger.load_config()

            # Should return defaults
            defaults = config_and_logger.get_default_config()
            for key, default_value in defaults.items():
                assert loaded_config[key] == default_value

            # Should print info message
            mock_print.assert_called_once()
            assert "not found, using defaults" in mock_print.call_args[0][0]
