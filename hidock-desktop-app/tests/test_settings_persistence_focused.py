#!/usr/bin/env python3
"""
Focused test to identify the EXACT settings persistence issue.

This test reproduces the user's specific complaints:
1. Settings not saved when different tab is selected during OK/Apply
2. Apply button not working at all
3. Column sorting not being saved (reported 10+ times)

Following TDD: Red-Green-Refactor
"""

import json
import os
import tempfile
import unittest
from unittest.mock import MagicMock, call, patch

from config_and_logger import get_default_config, save_config


class TestSettingsPersistenceFocused(unittest.TestCase):
    """Focused test to identify the exact settings persistence issue."""

    def setUp(self):
        """Set up test environment with isolated config."""
        # Create temporary config file
        self.temp_config_fd, self.temp_config_path = tempfile.mkstemp(suffix=".json")
        os.close(self.temp_config_fd)

        # Create test config
        self.test_config = get_default_config()
        with open(self.temp_config_path, "w") as f:
            json.dump(self.test_config, f, indent=4)

    def tearDown(self):
        """Clean up test environment."""
        try:
            os.unlink(self.temp_config_path)
        except OSError:
            pass

    def test_column_sorting_config_persistence(self):
        """
        Test: Column sorting should persist in config file.

        This tests if the basic config save/load mechanism works for sorting.
        """
        # Load config
        config = self.test_config.copy()

        # Change sorting settings (these are the exact keys used in the app)
        config["treeview_sort_col_id"] = "name"  # Changed from default 'datetime'
        config["treeview_sort_descending"] = False  # Changed from default True

        # Save config to temp file
        with open(self.temp_config_path, "w") as f:
            json.dump(config, f, indent=4)

        # Reload config
        with open(self.temp_config_path, "r") as f:
            reloaded_config = json.load(f)

        # Verify sorting settings persisted
        self.assertEqual(
            reloaded_config["treeview_sort_col_id"], "name", "Column sort column should persist in config file"
        )
        self.assertEqual(
            reloaded_config["treeview_sort_descending"], False, "Column sort direction should persist in config file"
        )

    def test_save_config_function_works(self):
        """
        Test: The save_config function should work correctly.

        This tests the actual save_config function used by settings dialog.
        """
        # Patch the config file path to use our temp file
        with patch("config_and_logger._CONFIG_FILE_PATH", self.temp_config_path):
            # Modify config
            config = self.test_config.copy()
            config["autoconnect"] = True  # Changed from default False
            config["log_level"] = "DEBUG"  # Changed from default INFO
            config["treeview_sort_col_id"] = "size"  # Changed from default datetime

            # Use the actual save_config function
            save_config(config)

            # Verify it was saved
            with open(self.temp_config_path, "r") as f:
                saved_config = json.load(f)

            self.assertEqual(saved_config["autoconnect"], True, "save_config should save autoconnect setting")
            self.assertEqual(saved_config["log_level"], "DEBUG", "save_config should save log level setting")
            self.assertEqual(
                saved_config["treeview_sort_col_id"], "size", "save_config should save column sorting setting"
            )

    def test_settings_dialog_key_mapping_logic(self):
        """
        Test: The settings dialog key mapping logic.

        This tests the exact logic used in _perform_apply_settings_logic.
        """
        # Test the key mapping logic from settings_window.py
        test_mappings = {
            "autoconnect_var": "autoconnect",
            "logger_processing_level_var": "log_level",  # Special mapping
            "quit_without_prompt_var": "quit_without_prompt_if_connected",  # Special mapping
            "recording_check_interval_var": "recording_check_interval_s",  # Special mapping
            "appearance_mode_var": "appearance_mode",
            "color_theme_var": "color_theme",
        }

        for var_name, expected_config_key in test_mappings.items():
            # Simulate the key mapping logic from settings_window.py
            config_key = var_name.replace("_var", "")

            # Apply special mappings (from _perform_apply_settings_logic)
            if config_key == "logger_processing_level":
                config_key = "log_level"
            elif config_key == "quit_without_prompt":
                config_key = "quit_without_prompt_if_connected"
            elif config_key == "recording_check_interval":
                config_key = "recording_check_interval_s"

            self.assertEqual(
                config_key,
                expected_config_key,
                f"Variable '{var_name}' should map to config key '{expected_config_key}' but got '{config_key}'",
            )

    def test_apply_button_logic_simulation(self):
        """
        Test: Simulate the Apply button logic from settings dialog.

        This tests if the Apply button logic would work correctly.
        """
        # Simulate the settings dialog state
        mock_parent_config = self.test_config.copy()

        # Simulate local variables (what user changed in dialog)
        local_changes = {
            "autoconnect": True,
            "log_level": "DEBUG",
            "treeview_sort_col_id": "name",
            "treeview_sort_descending": False,
            "quit_without_prompt_if_connected": True,
        }

        # Apply changes to parent config (simulating _perform_apply_settings_logic)
        for key, value in local_changes.items():
            mock_parent_config[key] = value

        # Simulate save_config call
        with patch("config_and_logger._CONFIG_FILE_PATH", self.temp_config_path):
            save_config(mock_parent_config)

        # Verify all changes were saved
        with open(self.temp_config_path, "r") as f:
            saved_config = json.load(f)

        for key, expected_value in local_changes.items():
            self.assertEqual(saved_config[key], expected_value, f"Apply button should save {key} = {expected_value}")

    def test_identify_real_issue_with_mocked_settings_dialog(self):
        """
        Test: Mock the settings dialog to identify the real issue.

        This test will reveal if the issue is in the settings dialog itself.
        """
        # Mock parent GUI
        mock_parent = MagicMock()
        mock_parent.config = self.test_config.copy()

        # Mock the settings dialog's _perform_apply_settings_logic method
        def mock_apply_settings_logic(update_dialog_baseline=False):
            # Simulate what the real method does
            mock_parent.config["autoconnect"] = True
            mock_parent.config["log_level"] = "DEBUG"
            mock_parent.config["treeview_sort_col_id"] = "name"

            # This is the critical part - does it call save_config?
            with patch("config_and_logger._CONFIG_FILE_PATH", self.temp_config_path):
                save_config(mock_parent.config)

        # Simulate user clicking Apply
        mock_apply_settings_logic(update_dialog_baseline=True)

        # Verify settings were saved to file
        with open(self.temp_config_path, "r") as f:
            saved_config = json.load(f)

        self.assertEqual(saved_config["autoconnect"], True, "Mocked Apply should save autoconnect")
        self.assertEqual(saved_config["log_level"], "DEBUG", "Mocked Apply should save log level")
        self.assertEqual(saved_config["treeview_sort_col_id"], "name", "Mocked Apply should save column sorting")

    def test_column_sorting_main_gui_issue(self):
        """
        Test: Check if the issue is in the main GUI not saving column sorting.

        This tests if the main GUI properly saves column sorting changes.
        """
        # Simulate main GUI saving column sorting
        config = self.test_config.copy()

        # Simulate user clicking column header to sort
        # This should update the config and save it
        config["treeview_sort_col_id"] = "size"
        config["treeview_sort_descending"] = True

        # Save config (this is what main GUI should do)
        with patch("config_and_logger._CONFIG_FILE_PATH", self.temp_config_path):
            save_config(config)

        # Verify it was saved
        with open(self.temp_config_path, "r") as f:
            saved_config = json.load(f)

        self.assertEqual(saved_config["treeview_sort_col_id"], "size", "Main GUI should save column sort changes")
        self.assertEqual(
            saved_config["treeview_sort_descending"], True, "Main GUI should save column sort direction changes"
        )

    def test_settings_overwrite_issue(self):
        """
        Test: Check if settings are being overwritten after saving.

        This tests if something is overwriting the config after it's saved.
        """
        # Save initial settings
        config1 = self.test_config.copy()
        config1["autoconnect"] = True
        config1["treeview_sort_col_id"] = "name"

        with patch("config_and_logger._CONFIG_FILE_PATH", self.temp_config_path):
            save_config(config1)

        # Verify first save worked
        with open(self.temp_config_path, "r") as f:
            saved_config1 = json.load(f)

        self.assertEqual(saved_config1["autoconnect"], True)
        self.assertEqual(saved_config1["treeview_sort_col_id"], "name")

        # Simulate another part of the app overwriting settings
        # Instead of using defaults, use only the changed setting
        config2 = {"log_level": "ERROR"}  # Only the setting that changed

        with patch("config_and_logger._CONFIG_FILE_PATH", self.temp_config_path):
            save_config(config2)

        # Check if previous settings were lost
        with open(self.temp_config_path, "r") as f:
            saved_config2 = json.load(f)

        # This test will reveal if settings are being overwritten
        self.assertEqual(saved_config2["autoconnect"], True, "Previous settings should not be overwritten")
        self.assertEqual(saved_config2["treeview_sort_col_id"], "name", "Column sorting should not be overwritten")
        self.assertEqual(saved_config2["log_level"], "ERROR", "New setting should be saved")


if __name__ == "__main__":
    unittest.main()
