#!/usr/bin/env python3
"""
Test to verify the settings persistence fix.

This test verifies that the fix for settings being overwritten works correctly.
The fix ensures that save_config preserves existing settings by merging.

Following TDD: Red-Green-Refactor (Green phase - verifying the fix works)
"""

import json
import os
import tempfile
import unittest
from unittest.mock import patch

from config_and_logger import get_default_config, save_config


class TestSettingsPersistenceFix(unittest.TestCase):
    """Test that the settings persistence fix works correctly."""

    def setUp(self):
        """Set up test environment with isolated config."""
        # Create temporary config file
        self.temp_config_fd, self.temp_config_path = tempfile.mkstemp(suffix=".json")
        os.close(self.temp_config_fd)

        # Create initial config
        self.initial_config = get_default_config()
        with open(self.temp_config_path, "w") as f:
            json.dump(self.initial_config, f, indent=4)

    def tearDown(self):
        """Clean up test environment."""
        try:
            os.unlink(self.temp_config_path)
        except OSError:
            pass

    def test_save_config_preserves_existing_settings(self):
        """
        Test: save_config should preserve existing settings when saving new ones.

        This is the core fix - settings should not be overwritten.
        """
        # Patch the config file path to use our temp file
        with patch("config_and_logger._CONFIG_FILE_PATH", self.temp_config_path):
            # First, save some settings
            first_settings = {
                "autoconnect": True,
                "treeview_sort_col_id": "name",
                "treeview_sort_descending": False,
            }
            save_config(first_settings)

            # Then, save different settings (simulating another part of the app)
            second_settings = {
                "log_level": "DEBUG",
                "appearance_mode": "Dark",
            }
            save_config(second_settings)

            # Verify ALL settings are preserved
            with open(self.temp_config_path, "r") as f:
                final_config = json.load(f)

            # First settings should still be there
            self.assertEqual(final_config["autoconnect"], True, "First batch of settings should be preserved")
            self.assertEqual(final_config["treeview_sort_col_id"], "name", "Column sorting should be preserved")
            self.assertEqual(
                final_config["treeview_sort_descending"], False, "Column sort direction should be preserved"
            )

            # Second settings should also be there
            self.assertEqual(final_config["log_level"], "DEBUG", "Second batch of settings should be saved")
            self.assertEqual(final_config["appearance_mode"], "Dark", "Appearance mode should be saved")

            # Default settings should still be there
            self.assertEqual(final_config["color_theme"], "blue", "Default settings should be preserved")

    def test_save_config_overwrites_duplicate_keys(self):
        """
        Test: save_config should overwrite settings with the same key.

        When the same setting is saved twice, the latest value should win.
        """
        with patch("config_and_logger._CONFIG_FILE_PATH", self.temp_config_path):
            # Save initial setting
            save_config({"log_level": "INFO"})

            # Save same setting with different value
            save_config({"log_level": "DEBUG"})

            # Verify the latest value is used
            with open(self.temp_config_path, "r") as f:
                config = json.load(f)

            self.assertEqual(config["log_level"], "DEBUG", "Latest value should overwrite previous value")

    def test_save_config_handles_missing_file(self):
        """
        Test: save_config should work even if config file doesn't exist.

        This handles the case where the config file is missing or corrupted.
        """
        # Use a non-existent file path
        non_existent_path = self.temp_config_path + "_missing"

        with patch("config_and_logger._CONFIG_FILE_PATH", non_existent_path):
            # Save settings to non-existent file
            settings = {
                "autoconnect": True,
                "log_level": "DEBUG",
            }
            save_config(settings)

            # Verify file was created with merged defaults
            with open(non_existent_path, "r") as f:
                config = json.load(f)

            # New settings should be there
            self.assertEqual(config["autoconnect"], True, "New settings should be saved")
            self.assertEqual(config["log_level"], "DEBUG", "New settings should be saved")

            # Default settings should also be there
            self.assertEqual(config["color_theme"], "blue", "Default settings should be included")

            # Clean up
            os.unlink(non_existent_path)

    def test_save_config_handles_corrupted_file(self):
        """
        Test: save_config should handle corrupted config files gracefully.

        If the existing config file is corrupted, it should start with defaults.
        """
        # Create corrupted config file
        with open(self.temp_config_path, "w") as f:
            f.write("{ invalid json content")

        with patch("config_and_logger._CONFIG_FILE_PATH", self.temp_config_path):
            # Save settings despite corrupted file
            settings = {
                "autoconnect": True,
                "log_level": "DEBUG",
            }
            save_config(settings)

            # Verify file was recreated with defaults + new settings
            with open(self.temp_config_path, "r") as f:
                config = json.load(f)

            # New settings should be there
            self.assertEqual(config["autoconnect"], True, "New settings should be saved")
            self.assertEqual(config["log_level"], "DEBUG", "New settings should be saved")

            # Default settings should be there
            self.assertEqual(config["color_theme"], "blue", "Default settings should be included")

    def test_column_sorting_persistence_fix(self):
        """
        Test: Column sorting should now persist correctly.

        This specifically tests the user's main complaint about column sorting.
        """
        with patch("config_and_logger._CONFIG_FILE_PATH", self.temp_config_path):
            # Simulate main GUI saving column sorting
            save_config(
                {
                    "treeview_sort_col_id": "size",
                    "treeview_sort_descending": True,
                }
            )

            # Simulate settings dialog saving other settings
            save_config(
                {
                    "autoconnect": True,
                    "log_level": "DEBUG",
                }
            )

            # Verify column sorting was NOT overwritten
            with open(self.temp_config_path, "r") as f:
                config = json.load(f)

            self.assertEqual(
                config["treeview_sort_col_id"], "size", "Column sorting should persist after other settings are saved"
            )
            self.assertEqual(
                config["treeview_sort_descending"],
                True,
                "Column sort direction should persist after other settings are saved",
            )

            # Other settings should also be there
            self.assertEqual(config["autoconnect"], True, "Settings dialog changes should be saved")
            self.assertEqual(config["log_level"], "DEBUG", "Settings dialog changes should be saved")

    def test_multiple_save_operations_preserve_all_settings(self):
        """
        Test: Multiple save operations should preserve all settings.

        This simulates the real-world scenario where different parts of the app
        save settings at different times.
        """
        with patch("config_and_logger._CONFIG_FILE_PATH", self.temp_config_path):
            # Simulate different parts of the app saving settings

            # 1. User changes column sorting
            save_config(
                {
                    "treeview_sort_col_id": "name",
                    "treeview_sort_descending": False,
                }
            )

            # 2. User changes appearance in settings dialog
            save_config(
                {
                    "appearance_mode": "Dark",
                    "color_theme": "green",
                }
            )

            # 3. User changes connection settings
            save_config(
                {
                    "autoconnect": True,
                    "selected_vid": 1234,
                    "selected_pid": 5678,
                }
            )

            # 4. User changes logging settings
            save_config(
                {
                    "log_level": "DEBUG",
                    "suppress_console_output": True,
                }
            )

            # Verify ALL settings are preserved
            with open(self.temp_config_path, "r") as f:
                final_config = json.load(f)

            # All settings should be there
            self.assertEqual(final_config["treeview_sort_col_id"], "name", "Column sorting should be preserved")
            self.assertEqual(
                final_config["treeview_sort_descending"], False, "Column sort direction should be preserved"
            )
            self.assertEqual(final_config["appearance_mode"], "Dark", "Appearance mode should be preserved")
            self.assertEqual(final_config["color_theme"], "green", "Color theme should be preserved")
            self.assertEqual(final_config["autoconnect"], True, "Autoconnect should be preserved")
            self.assertEqual(final_config["selected_vid"], 1234, "VID should be preserved")
            self.assertEqual(final_config["selected_pid"], 5678, "PID should be preserved")
            self.assertEqual(final_config["log_level"], "DEBUG", "Log level should be preserved")
            self.assertEqual(
                final_config["suppress_console_output"], True, "Console output setting should be preserved"
            )


if __name__ == "__main__":
    unittest.main()
