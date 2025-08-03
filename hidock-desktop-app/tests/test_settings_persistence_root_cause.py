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
import tempfile
import unittest
from unittest.mock import MagicMock, PropertyMock, patch

import customtkinter as ctk

from config_and_logger import get_default_config, load_config, save_config
from settings_window import SettingsDialog


class TestSettingsPersistenceRootCause(unittest.TestCase):
    """Test to identify the root cause of settings persistence issues."""

    def setUp(self):
        """Set up test environment."""
        # Create temporary config file
        self.temp_config_file = tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False)
        self.temp_config_file.close()

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
        """Set up all CTk variables that the settings window expects."""
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
            setattr(self.mock_parent, var_name, ctk.BooleanVar(value=value))

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
            setattr(self.mock_parent, var_name, ctk.StringVar(value=value))

        # Numeric variables
        setattr(
            self.mock_parent, "ai_temperature_var", ctk.DoubleVar(value=self.initial_config.get("ai_temperature", 0.3))
        )
        setattr(self.mock_parent, "ai_max_tokens_var", ctk.IntVar(value=self.initial_config.get("ai_max_tokens", 4000)))

        # Log color variables
        log_colors = self.initial_config.get("log_colors", {})
        for level in ["error", "warning", "info", "debug", "critical"]:
            for mode in ["light", "dark"]:
                var_name = f"log_color_{level}_{mode}_var"
                color_pair = log_colors.get(level.upper(), ["#000000", "#FFFFFF"])
                color_value = color_pair[0] if mode == "light" else color_pair[1]
                setattr(self.mock_parent, var_name, ctk.StringVar(value=color_value))

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
        # Create settings dialog
        with patch("settings_window.threading.Thread"):
            dialog = SettingsDialog(self.mock_parent, self.mock_parent.config.copy(), self.mock_hidock)

        # Simulate user changing settings in General tab
        dialog.local_vars["autoconnect_var"].set(True)
        dialog.local_vars["quit_without_prompt_var"].set(True)

        # Simulate user changing settings in Operation tab
        dialog.local_vars["recording_check_interval_var"].set("10")

        # Mark settings as changed
        dialog.settings_changed_tracker[0] = True

        # Simulate user switching to a different tab (e.g., AI Transcription)
        # This should NOT affect the ability to save settings

        # Apply settings (this is what OK button does)
        dialog._perform_apply_settings_logic(update_dialog_baseline=False)

        # Verify ALL settings were saved regardless of current tab
        self.assertTrue(
            self.mock_parent.autoconnect_var.set.called, "Autoconnect setting should be saved regardless of current tab"
        )
        self.assertTrue(
            self.mock_parent.quit_without_prompt_var.set.called,
            "Quit without prompt setting should be saved regardless of current tab",
        )
        self.assertTrue(
            self.mock_parent.recording_check_interval_var.set.called,
            "Recording interval setting should be saved regardless of current tab",
        )

        dialog.destroy()

    def test_apply_button_completely_broken(self):
        """
        Test: Apply button functionality is completely broken.

        This test should FAIL initially if Apply is not working.
        """
        # Create settings dialog
        with patch("settings_window.threading.Thread"):
            dialog = SettingsDialog(self.mock_parent, self.mock_parent.config.copy(), self.mock_hidock)

        # Make changes to multiple settings
        dialog.local_vars["autoconnect_var"].set(True)
        dialog.local_vars["logger_processing_level_var"].set("DEBUG")
        dialog.local_vars["appearance_mode_var"].set("Dark")

        # Mark settings as changed
        dialog.settings_changed_tracker[0] = True

        # Simulate Apply button click
        dialog._apply_action_ui_handler()

        # Verify Apply worked
        self.assertTrue(self.mock_parent.autoconnect_var.set.called, "Apply should save autoconnect setting")
        self.assertTrue(
            self.mock_parent.logger_processing_level_var.set.called, "Apply should save logger level setting"
        )
        self.assertTrue(self.mock_parent.appearance_mode_var.set.called, "Apply should save appearance mode setting")

        # Verify config was saved
        self.assertEqual(self.mock_parent.config["autoconnect"], True, "Apply should update config dictionary")

        dialog.destroy()

    def test_config_key_mapping_issues(self):
        """
        Test: Verify config key mapping is correct.

        This tests the suspected root cause - incorrect variable to config key mapping.
        """
        # Create settings dialog
        with patch("settings_window.threading.Thread"):
            dialog = SettingsDialog(self.mock_parent, self.mock_parent.config.copy(), self.mock_hidock)

        # Test critical mappings that are likely broken
        test_cases = [
            ("logger_processing_level_var", "log_level", "DEBUG"),
            ("quit_without_prompt_var", "quit_without_prompt_if_connected", True),
            ("recording_check_interval_var", "recording_check_interval_s", "15"),
            ("auto_refresh_interval_s_var", "auto_refresh_interval_s", "60"),
        ]

        for var_name, expected_config_key, test_value in test_cases:
            if var_name in dialog.local_vars:
                # Reset parent config
                self.mock_parent.config.clear()
                self.mock_parent.config.update(self.initial_config.copy())

                # Change the setting
                dialog.local_vars[var_name].set(test_value)

                # Apply settings
                dialog._perform_apply_settings_logic(update_dialog_baseline=False)

                # Verify the correct config key was set
                self.assertIn(
                    expected_config_key,
                    self.mock_parent.config,
                    f"Config key '{expected_config_key}' should exist for variable '{var_name}'",
                )

                actual_value = self.mock_parent.config[expected_config_key]
                if isinstance(test_value, str) and test_value.isdigit():
                    expected_value = int(test_value)
                else:
                    expected_value = test_value

                self.assertEqual(
                    actual_value,
                    expected_value,
                    f"Config key '{expected_config_key}' should have value '{expected_value}' but got '{actual_value}'",
                )

        dialog.destroy()

    def test_save_config_function_called(self):
        """
        Test: Verify that save_config is actually called when settings are applied.
        """
        # Create settings dialog
        with patch("settings_window.threading.Thread"):
            dialog = SettingsDialog(self.mock_parent, self.mock_parent.config.copy(), self.mock_hidock)

        # Make a change
        dialog.local_vars["autoconnect_var"].set(True)
        dialog.settings_changed_tracker[0] = True

        # Mock save_config to verify it's called
        with patch("settings_window.save_config") as mock_save_config:
            dialog._perform_apply_settings_logic(update_dialog_baseline=False)

            # Verify save_config was called
            self.assertTrue(mock_save_config.called, "save_config should be called when settings are applied")

            # Verify it was called with the updated config
            called_config = mock_save_config.call_args[0][0]
            self.assertEqual(called_config["autoconnect"], True, "save_config should be called with updated config")

        dialog.destroy()

    def test_settings_persistence_across_app_restart(self):
        """
        Test: Settings should persist across application restarts.

        This is the ultimate test - settings should survive app restart.
        """
        # Create settings dialog and change settings
        with patch("settings_window.threading.Thread"):
            dialog = SettingsDialog(self.mock_parent, self.mock_parent.config.copy(), self.mock_hidock)

        # Change multiple settings
        dialog.local_vars["autoconnect_var"].set(True)
        dialog.local_vars["logger_processing_level_var"].set("DEBUG")
        dialog.local_vars["recording_check_interval_var"].set("25")
        dialog.local_vars["quit_without_prompt_var"].set(True)

        # Apply settings (this should save to file)
        dialog._perform_apply_settings_logic(update_dialog_baseline=False)

        dialog.destroy()

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
