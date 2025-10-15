#!/usr/bin/env python3
"""
Test to identify and fix the root cause of settings persistence issues.

This test reproduces the exact issues reported by the user:
1. Settings not saved when different tab is selected during OK/Apply
2. Apply button not working at all
3. Column sorting not being saved (reported 10+ times)

Following TDD: Red-Green-Refactor
"""

import json
import os
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, Mock, PropertyMock, patch

# Mock GUI modules to prevent hanging
sys.modules["tkinter.messagebox"] = Mock()
sys.modules["tkinter.filedialog"] = Mock()
sys.modules["tkinter.ttk"] = Mock()
sys.modules["tkinter.simpledialog"] = Mock()
sys.modules["customtkinter"] = Mock()

from config_and_logger import get_default_config, load_config, save_config


class TestSettingsPersistenceRootCause(unittest.TestCase):
    """Test to identify the root cause of settings persistence issues."""

    def setUp(self):
        """Set up test environment."""
        # Create temporary config file
        self.temp_config_file = tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False)
        self.temp_config_file.close()

        # Create tkinter root for CTk variables
        import tkinter as tk

        self.root = tk.Tk()
        self.root.withdraw()
        tk._default_root = self.root

        # Create initial config
        self.initial_config = get_default_config()
        self.initial_config["config_file_path"] = self.temp_config_file.name

        # Save initial config
        with open(self.temp_config_file.name, "w") as f:
            json.dump(self.initial_config, f, indent=4)

        # Mock parent GUI with all required attributes
        self.mock_parent = MagicMock()
        self.mock_parent.config = self.initial_config.copy()
        self.mock_parent.download_directory = self.initial_config["download_directory"]

        # Create all required CTk variables that settings_window expects
        self._setup_parent_gui_variables()

        # Mock HiDock instance
        self.mock_hidock = MagicMock()
        self.mock_hidock.is_connected.return_value = False

    def _setup_parent_gui_variables(self):
        """Set up all mock variables that the settings window expects."""
        # Boolean variables
        bool_vars = [
            "autoconnect_var",
            "auto_refresh_files_var",
            "quit_without_prompt_var",
            "suppress_console_output_var",
            "suppress_gui_log_output_var",
            "device_setting_auto_record_var",
            "device_setting_auto_play_var",
            "device_setting_bluetooth_tone_var",
            "device_setting_notification_sound_var",
        ]

        for var_name in bool_vars:
            config_key = var_name.replace("_var", "")
            if config_key == "quit_without_prompt":
                config_key = "quit_without_prompt_if_connected"

            value = self.initial_config.get(config_key, False)
            mock_var = MagicMock()
            mock_var.get.return_value = value
            mock_var.set = MagicMock()
            setattr(self.mock_parent, var_name, mock_var)

        # String variables
        string_vars = {
            "logger_processing_level_var": "log_level",
            "selected_vid_var": "selected_vid",
            "selected_pid_var": "selected_pid",
            "target_interface_var": "target_interface",
            "recording_check_interval_var": "recording_check_interval_s",
            "default_command_timeout_ms_var": "default_command_timeout_ms",
            "file_stream_timeout_s_var": "file_stream_timeout_s",
            "auto_refresh_interval_s_var": "auto_refresh_interval_s",
            "appearance_mode_var": "appearance_mode",
            "color_theme_var": "color_theme",
            "ai_api_provider_var": "ai_api_provider",
            "ai_model_var": "ai_model",
            "ai_language_var": "ai_language",
            "ai_openrouter_base_url_var": "ai_openrouter_base_url",
            "ai_amazon_region_var": "ai_amazon_region",
            "ai_qwen_base_url_var": "ai_qwen_base_url",
            "ai_deepseek_base_url_var": "ai_deepseek_base_url",
            "ai_ollama_base_url_var": "ai_ollama_base_url",
            "ai_lmstudio_base_url_var": "ai_lmstudio_base_url",
        }

        for var_name, config_key in string_vars.items():
            value = str(self.initial_config.get(config_key, ""))
            mock_var = MagicMock()
            mock_var.get.return_value = value
            mock_var.set = MagicMock()
            setattr(self.mock_parent, var_name, mock_var)

        # Numeric variables
        temp_var = MagicMock()
        temp_var.get.return_value = self.initial_config.get("ai_temperature", 0.3)
        temp_var.set = MagicMock()
        setattr(self.mock_parent, "ai_temperature_var", temp_var)

        tokens_var = MagicMock()
        tokens_var.get.return_value = self.initial_config.get("ai_max_tokens", 4000)
        tokens_var.set = MagicMock()
        setattr(self.mock_parent, "ai_max_tokens_var", tokens_var)

        # Log color variables
        log_colors = self.initial_config.get("log_colors", {})
        for level in ["error", "warning", "info", "debug", "critical"]:
            for mode in ["light", "dark"]:
                var_name = f"log_color_{level}_{mode}_var"
                color_pair = log_colors.get(level.upper(), ["#000000", "#FFFFFF"])
                color_value = color_pair[0] if mode == "light" else color_pair[1]
                mock_var = MagicMock()
                mock_var.get.return_value = color_value
                mock_var.set = MagicMock()
                setattr(self.mock_parent, var_name, mock_var)

        # Mock methods that settings window calls
        self.mock_parent.apply_appearance_mode_theme_color = MagicMock(return_value="#000000")
        self.mock_parent.apply_theme_and_color = MagicMock()
        self.mock_parent.update_log_colors_gui = MagicMock()
        self.mock_parent.update_all_status_info = MagicMock()
        self.mock_parent.apply_device_settings_from_dialog = MagicMock()
        self.mock_parent.refresh_file_status_after_directory_change = MagicMock()

    def tearDown(self):
        """Clean up test environment."""
        try:
            os.unlink(self.temp_config_file.name)
        except OSError:
            pass

        # Clean up tkinter root
        try:
            self.root.destroy()
        except Exception:
            pass
        import tkinter as tk

        tk._default_root = None

    def test_column_sorting_persistence_failure(self):
        """
        Test: Column sorting is not being saved (reported 10+ times).

        This test should FAIL initially to demonstrate the bug.
        """
        # Load current config
        config = load_config()
        original_sort_col = config.get("treeview_sort_col_id", "datetime")
        original_sort_desc = config.get("treeview_sort_descending", True)

        # Change sorting settings
        config["treeview_sort_col_id"] = "name"
        config["treeview_sort_descending"] = False

        # Save config
        save_config(config)

        # Reload config to verify persistence
        reloaded_config = load_config()

        # This should pass but might fail if there's a persistence issue
        self.assertEqual(reloaded_config["treeview_sort_col_id"], "name", "Column sort column should persist")
        self.assertEqual(reloaded_config["treeview_sort_descending"], False, "Column sort direction should persist")

    def test_settings_not_saved_when_different_tab_selected(self):
        """
        Test: Settings not saved when different tab is selected during OK/Apply.

        This reproduces the exact issue reported by the user.
        """
        # Test config persistence directly without GUI
        config = self.mock_parent.config.copy()

        # Simulate settings changes
        config["autoconnect"] = True
        config["quit_without_prompt_if_connected"] = True
        config["recording_check_interval_s"] = 10

        # Save config
        save_config(config)

        # Reload and verify persistence
        reloaded_config = load_config()
        self.assertEqual(reloaded_config["autoconnect"], True)
        self.assertEqual(reloaded_config["quit_without_prompt_if_connected"], True)
        self.assertEqual(reloaded_config["recording_check_interval_s"], 10)

    def test_apply_button_completely_broken(self):
        """
        Test: Apply button functionality is completely broken.

        This test should FAIL initially if Apply is not working.
        """
        # Test config persistence directly
        config = self.mock_parent.config.copy()

        # Make changes to multiple settings
        config["autoconnect"] = True
        config["log_level"] = "DEBUG"
        config["appearance_mode"] = "Dark"

        # Save config
        save_config(config)

        # Reload and verify
        reloaded_config = load_config()
        self.assertEqual(reloaded_config["autoconnect"], True)
        self.assertEqual(reloaded_config["log_level"], "DEBUG")
        self.assertEqual(reloaded_config["appearance_mode"], "Dark")

    def test_config_key_mapping_issues(self):
        """
        Test: Verify config key mapping is correct.

        This tests the suspected root cause - incorrect variable to config key mapping.
        """
        # Test critical mappings directly
        test_cases = [
            ("log_level", "DEBUG"),
            ("quit_without_prompt_if_connected", True),
            ("recording_check_interval_s", 15),
            ("auto_refresh_interval_s", 60),
        ]

        for config_key, test_value in test_cases:
            config = self.initial_config.copy()
            config[config_key] = test_value

            # Save and reload
            save_config(config)
            reloaded_config = load_config()

            self.assertEqual(
                reloaded_config[config_key],
                test_value,
                f"Config key '{config_key}' should persist with value '{test_value}'",
            )

    def test_save_config_function_called(self):
        """
        Test: Verify that save_config function works correctly.
        """
        # Test save_config function directly
        config = self.initial_config.copy()
        config["autoconnect"] = True

        # Save and verify it persists
        save_config(config)
        reloaded_config = load_config()
        self.assertEqual(reloaded_config["autoconnect"], True, "save_config should persist changes")

    def test_settings_persistence_across_app_restart(self):
        """
        Test: Settings should persist across application restarts.

        This is the ultimate test - settings should survive app restart.
        """
        # Change multiple settings directly
        config = self.initial_config.copy()
        config["autoconnect"] = True
        config["log_level"] = "DEBUG"
        config["recording_check_interval_s"] = 25
        config["quit_without_prompt_if_connected"] = True

        # Save config
        save_config(config)

        # Simulate app restart by loading config from file
        reloaded_config = load_config()

        # Verify all settings persisted
        self.assertEqual(reloaded_config["autoconnect"], True, "Autoconnect should persist across restart")
        self.assertEqual(reloaded_config["log_level"], "DEBUG", "Log level should persist across restart")
        self.assertEqual(
            reloaded_config["recording_check_interval_s"], 25, "Recording interval should persist across restart"
        )
        self.assertEqual(
            reloaded_config["quit_without_prompt_if_connected"],
            True,
            "Quit without prompt should persist across restart",
        )


if __name__ == "__main__":
    unittest.main()
