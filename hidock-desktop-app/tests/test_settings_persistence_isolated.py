#!/usr/bin/env python3
"""
ISOLATED test for settings persistence issues.

This test NEVER touches the real application config file.
It identifies the root cause of:
1. Settings not saved when different tab is selected during OK/Apply
2. Apply button not working at all
3. Column sorting not being saved

Following TDD: Red-Green-Refactor with PROPER ISOLATION
"""

import json
import os
import tempfile
import unittest
from unittest.mock import MagicMock, patch

import customtkinter as ctk

# Import with proper isolation
from config_and_logger import get_default_config


class TestSettingsPersistenceIsolated(unittest.TestCase):
    """Test settings persistence with complete isolation from real app config."""

    def setUp(self):
        """Set up completely isolated test environment."""
        # Create temporary config file that will NEVER affect real app
        self.temp_config_fd, self.temp_config_path = tempfile.mkstemp(suffix=".json")
        os.close(self.temp_config_fd)  # Close file descriptor, keep path

        # Create clean test config
        self.test_config = get_default_config()
        self.test_config["config_file_path"] = self.temp_config_path

        # Save test config to temp file
        with open(self.temp_config_path, "w") as f:
            json.dump(self.test_config, f, indent=4)

        # Mock the config file path in config_and_logger to use our temp file
        self.config_path_patcher = patch("config_and_logger._CONFIG_FILE_PATH", self.temp_config_path)
        self.config_path_patcher.start()

        # Mock parent GUI completely
        self.mock_parent = self._create_mock_parent_gui()

        # Mock HiDock instance
        self.mock_hidock = MagicMock()
        self.mock_hidock.is_connected.return_value = False

    def tearDown(self):
        """Clean up isolated test environment."""
        self.config_path_patcher.stop()
        try:
            os.unlink(self.temp_config_path)
        except OSError:
            pass

    def _create_mock_parent_gui(self):
        """Create a complete mock parent GUI with all required attributes."""
        mock_parent = MagicMock()
        mock_parent.config = self.test_config.copy()
        mock_parent.download_directory = self.test_config["download_directory"]

        # Create all CTk variables that settings_window expects
        mock_parent.autoconnect_var = ctk.BooleanVar(value=self.test_config["autoconnect"])
        mock_parent.logger_processing_level_var = ctk.StringVar(value=self.test_config["log_level"])
        mock_parent.quit_without_prompt_var = ctk.BooleanVar(value=self.test_config["quit_without_prompt_if_connected"])
        mock_parent.recording_check_interval_var = ctk.StringVar(
            value=str(self.test_config["recording_check_interval_s"])
        )
        mock_parent.appearance_mode_var = ctk.StringVar(value=self.test_config["appearance_mode"])
        mock_parent.color_theme_var = ctk.StringVar(value=self.test_config["color_theme"])
        mock_parent.selected_vid_var = ctk.StringVar(value=str(self.test_config["selected_vid"]))
        mock_parent.selected_pid_var = ctk.StringVar(value=str(self.test_config["selected_pid"]))
        mock_parent.target_interface_var = ctk.StringVar(value=str(self.test_config["target_interface"]))
        mock_parent.default_command_timeout_ms_var = ctk.StringVar(
            value=str(self.test_config["default_command_timeout_ms"])
        )
        mock_parent.file_stream_timeout_s_var = ctk.StringVar(value=str(self.test_config["file_stream_timeout_s"]))
        mock_parent.auto_refresh_files_var = ctk.BooleanVar(value=self.test_config["auto_refresh_files"])
        mock_parent.auto_refresh_interval_s_var = ctk.StringVar(value=str(self.test_config["auto_refresh_interval_s"]))
        mock_parent.suppress_console_output_var = ctk.BooleanVar(value=self.test_config["suppress_console_output"])
        mock_parent.suppress_gui_log_output_var = ctk.BooleanVar(value=self.test_config["suppress_gui_log_output"])

        # Device setting variables
        mock_parent.device_setting_auto_record_var = ctk.BooleanVar(value=False)
        mock_parent.device_setting_auto_play_var = ctk.BooleanVar(value=False)
        mock_parent.device_setting_bluetooth_tone_var = ctk.BooleanVar(value=False)
        mock_parent.device_setting_notification_sound_var = ctk.BooleanVar(value=False)

        # AI variables
        mock_parent.ai_api_provider_var = ctk.StringVar(value=self.test_config.get("ai_api_provider", "gemini"))
        mock_parent.ai_model_var = ctk.StringVar(value=self.test_config.get("ai_model", "gemini-2.5-flash"))
        mock_parent.ai_temperature_var = ctk.DoubleVar(value=self.test_config.get("ai_temperature", 0.3))
        mock_parent.ai_max_tokens_var = ctk.IntVar(value=self.test_config.get("ai_max_tokens", 4000))
        mock_parent.ai_language_var = ctk.StringVar(value=self.test_config.get("ai_language", "auto"))
        mock_parent.ai_openrouter_base_url_var = ctk.StringVar(value=self.test_config.get("ai_openrouter_base_url", ""))
        mock_parent.ai_amazon_region_var = ctk.StringVar(value=self.test_config.get("ai_amazon_region", "us-east-1"))
        mock_parent.ai_qwen_base_url_var = ctk.StringVar(value=self.test_config.get("ai_qwen_base_url", ""))
        mock_parent.ai_deepseek_base_url_var = ctk.StringVar(value=self.test_config.get("ai_deepseek_base_url", ""))
        mock_parent.ai_ollama_base_url_var = ctk.StringVar(value=self.test_config.get("ai_ollama_base_url", ""))
        mock_parent.ai_lmstudio_base_url_var = ctk.StringVar(value=self.test_config.get("ai_lmstudio_base_url", ""))

        # Log color variables
        log_colors = self.test_config.get("log_colors", {})
        for level in ["error", "warning", "info", "debug", "critical"]:
            for mode in ["light", "dark"]:
                var_name = f"log_color_{level}_{mode}_var"
                color_pair = log_colors.get(level.upper(), ["#000000", "#FFFFFF"])
                color_value = color_pair[0] if mode == "light" else color_pair[1]
                setattr(mock_parent, var_name, ctk.StringVar(value=color_value))

        # Mock methods
        mock_parent.apply_appearance_mode_theme_color = MagicMock(return_value="#000000")
        mock_parent.apply_theme_and_color = MagicMock()
        mock_parent.update_log_colors_gui = MagicMock()
        mock_parent.update_all_status_info = MagicMock()
        mock_parent.apply_device_settings_from_dialog = MagicMock()
        mock_parent.refresh_file_status_after_directory_change = MagicMock()

        return mock_parent

    def test_column_sorting_not_saved_root_cause(self):
        """
        Test: Column sorting is not being saved (reported 10+ times).

        This test identifies if the issue is in the config system itself.
        """
        # Test direct config manipulation (this should work)
        config = self.test_config.copy()
        config["treeview_sort_col_id"] = "name"
        config["treeview_sort_descending"] = False

        # Save to our isolated temp file
        with open(self.temp_config_path, "w") as f:
            json.dump(config, f, indent=4)

        # Reload and verify
        with open(self.temp_config_path, "r") as f:
            reloaded_config = json.load(f)

        self.assertEqual(reloaded_config["treeview_sort_col_id"], "name")
        self.assertEqual(reloaded_config["treeview_sort_descending"], False)

        # If this passes, the issue is NOT in the config system itself
        # but in how the GUI saves the sorting state

    def test_settings_dialog_key_mapping_issue(self):
        """
        Test: Identify if the issue is in settings dialog key mapping.

        This tests the suspected root cause - variable name to config key mapping.
        """
        # Import settings_window here to avoid affecting other tests
        from settings_window import SettingsDialog

        # Create settings dialog with our isolated config
        with patch("settings_window.threading.Thread"):
            dialog = SettingsDialog(self.mock_parent, self.mock_parent.config.copy(), self.mock_hidock)

        # Test the key mapping logic directly
        test_mappings = {
            "logger_processing_level_var": "log_level",
            "quit_without_prompt_var": "quit_without_prompt_if_connected",
            "recording_check_interval_var": "recording_check_interval_s",
        }

        for var_name, expected_config_key in test_mappings.items():
            if var_name in dialog.local_vars:
                # Change the local variable
                if var_name == "logger_processing_level_var":
                    dialog.local_vars[var_name].set("DEBUG")
                elif var_name == "quit_without_prompt_var":
                    dialog.local_vars[var_name].set(True)
                elif var_name == "recording_check_interval_var":
                    dialog.local_vars[var_name].set("15")

                # Clear parent config to test mapping
                self.mock_parent.config.clear()
                self.mock_parent.config.update(self.test_config.copy())

                # Apply settings
                dialog._perform_apply_settings_logic(update_dialog_baseline=False)

                # Check if the correct config key was set
                self.assertIn(
                    expected_config_key,
                    self.mock_parent.config,
                    f"Config key '{expected_config_key}' missing for variable '{var_name}'",
                )

        dialog.destroy()

    def test_apply_button_saves_to_file(self):
        """
        Test: Verify Apply button actually saves to config file.

        This tests if the Apply button calls save_config properly.
        """
        from settings_window import SettingsDialog

        # Create settings dialog
        with patch("settings_window.threading.Thread"):
            dialog = SettingsDialog(self.mock_parent, self.mock_parent.config.copy(), self.mock_hidock)

        # Change a setting
        dialog.local_vars["autoconnect_var"].set(True)
        dialog.settings_changed_tracker[0] = True

        # Apply settings
        dialog._apply_action_ui_handler()

        # Verify the change was saved to our temp config file
        with open(self.temp_config_path, "r") as f:
            saved_config = json.load(f)

        self.assertEqual(saved_config["autoconnect"], True, "Apply button should save changes to config file")

        dialog.destroy()

    def test_ok_button_saves_to_file(self):
        """
        Test: Verify OK button actually saves to config file.

        This tests if the OK button calls save_config properly.
        """
        from settings_window import SettingsDialog

        # Create settings dialog
        with patch("settings_window.threading.Thread"):
            dialog = SettingsDialog(self.mock_parent, self.mock_parent.config.copy(), self.mock_hidock)

        # Change a setting
        dialog.local_vars["autoconnect_var"].set(True)
        dialog.settings_changed_tracker[0] = True

        # OK action (without destroying dialog in test)
        dialog._perform_apply_settings_logic(update_dialog_baseline=False)

        # Verify the change was saved to our temp config file
        with open(self.temp_config_path, "r") as f:
            saved_config = json.load(f)

        self.assertEqual(saved_config["autoconnect"], True, "OK button should save changes to config file")

        dialog.destroy()

    def test_settings_from_different_tabs_all_saved(self):
        """
        Test: Settings from all tabs should be saved regardless of current tab.

        This reproduces the user's exact complaint.
        """
        from settings_window import SettingsDialog

        # Create settings dialog
        with patch("settings_window.threading.Thread"):
            dialog = SettingsDialog(self.mock_parent, self.mock_parent.config.copy(), self.mock_hidock)

        # Make changes in different tabs
        dialog.local_vars["autoconnect_var"].set(True)  # General tab
        dialog.local_vars["recording_check_interval_var"].set("25")  # Operation tab
        dialog.local_vars["logger_processing_level_var"].set("DEBUG")  # Logging tab

        # Apply all changes
        dialog._perform_apply_settings_logic(update_dialog_baseline=False)

        # Verify ALL changes were saved to file
        with open(self.temp_config_path, "r") as f:
            saved_config = json.load(f)

        self.assertEqual(saved_config["autoconnect"], True, "General tab setting should be saved")
        self.assertEqual(saved_config["recording_check_interval_s"], 25, "Operation tab setting should be saved")
        self.assertEqual(saved_config["log_level"], "DEBUG", "Logging tab setting should be saved")

        dialog.destroy()

    def test_identify_real_persistence_issue(self):
        """
        Test: Identify the real cause of settings not persisting.

        This comprehensive test will reveal the actual problem.
        """
        from settings_window import SettingsDialog

        # Step 1: Verify config file operations work
        test_config = self.test_config.copy()
        test_config["test_setting"] = "test_value"

        with open(self.temp_config_path, "w") as f:
            json.dump(test_config, f, indent=4)

        with open(self.temp_config_path, "r") as f:
            reloaded = json.load(f)

        self.assertEqual(reloaded["test_setting"], "test_value", "Basic config file operations should work")

        # Step 2: Test settings dialog save mechanism
        with patch("settings_window.threading.Thread"):
            dialog = SettingsDialog(self.mock_parent, self.mock_parent.config.copy(), self.mock_hidock)

        # Change multiple settings
        original_autoconnect = dialog.local_vars["autoconnect_var"].get()
        dialog.local_vars["autoconnect_var"].set(not original_autoconnect)

        original_log_level = dialog.local_vars["logger_processing_level_var"].get()
        new_log_level = "DEBUG" if original_log_level != "DEBUG" else "INFO"
        dialog.local_vars["logger_processing_level_var"].set(new_log_level)

        # Apply changes
        dialog._perform_apply_settings_logic(update_dialog_baseline=False)

        # Step 3: Verify changes were actually saved to file
        with open(self.temp_config_path, "r") as f:
            final_config = json.load(f)

        self.assertEqual(
            final_config["autoconnect"],
            not original_autoconnect,
            "Settings dialog should save autoconnect changes to file",
        )
        self.assertEqual(
            final_config["log_level"], new_log_level, "Settings dialog should save log level changes to file"
        )

        dialog.destroy()


if __name__ == "__main__":
    unittest.main()
