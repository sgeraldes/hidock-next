#!/usr/bin/env python3
"""
Test for the new update_config_settings function.

This tests the new approach where we have separate functions for:
- save_config: Full config saves (overwrites file)
- update_config_settings: Partial updates (preserves existing settings)
"""

import json
import os
import tempfile
import unittest
from unittest.mock import patch

from config_and_logger import get_default_config, save_config, update_config_settings


class TestConfigUpdateFunction(unittest.TestCase):
    """Test the new update_config_settings function."""

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

    def test_update_config_settings_preserves_existing(self):
        """
        Test: update_config_settings should preserve existing settings.

        This is the key functionality to fix the settings persistence issue.
        """
        with patch("config_and_logger._CONFIG_FILE_PATH", self.temp_config_path):
            # First, save some settings using the full save
            full_config = self.initial_config.copy()
            full_config["autoconnect"] = True
            full_config["treeview_sort_col_id"] = "name"
            full_config["treeview_sort_descending"] = False
            save_config(full_config)

            # Then, update only specific settings
            partial_update = {
                "log_level": "DEBUG",
                "appearance_mode": "Dark",
            }
            update_config_settings(partial_update)

            # Verify ALL settings are preserved
            with open(self.temp_config_path, "r") as f:
                final_config = json.load(f)

            # Original settings should be preserved
            self.assertEqual(final_config["autoconnect"], True, "Original autoconnect setting should be preserved")
            self.assertEqual(final_config["treeview_sort_col_id"], "name", "Column sorting should be preserved")
            self.assertEqual(
                final_config["treeview_sort_descending"], False, "Column sort direction should be preserved"
            )

            # New settings should be applied
            self.assertEqual(final_config["log_level"], "DEBUG", "New log level should be applied")
            self.assertEqual(final_config["appearance_mode"], "Dark", "New appearance mode should be applied")

            # Default settings should still be there
            self.assertEqual(final_config["color_theme"], "blue", "Default settings should be preserved")

    def test_update_config_settings_handles_missing_file(self):
        """
        Test: update_config_settings should work even if config file doesn't exist.
        """
        # Use a non-existent file path
        non_existent_path = self.temp_config_path + "_missing"

        with patch("config_and_logger._CONFIG_FILE_PATH", non_existent_path):
            # Update settings on non-existent file
            settings = {
                "autoconnect": True,
                "log_level": "DEBUG",
            }
            update_config_settings(settings)

            # Verify file was created with defaults + updates
            with open(non_existent_path, "r") as f:
                config = json.load(f)

            # Updated settings should be there
            self.assertEqual(config["autoconnect"], True, "Updated settings should be saved")
            self.assertEqual(config["log_level"], "DEBUG", "Updated settings should be saved")

            # Default settings should also be there
            self.assertEqual(config["color_theme"], "blue", "Default settings should be included")

            # Clean up
            os.unlink(non_existent_path)

    def test_column_sorting_fix_with_update_function(self):
        """
        Test: Column sorting should persist when using update_config_settings.

        This specifically tests the user's main complaint.
        """
        with patch("config_and_logger._CONFIG_FILE_PATH", self.temp_config_path):
            # Simulate main GUI saving column sorting
            update_config_settings(
                {
                    "treeview_sort_col_id": "size",
                    "treeview_sort_descending": True,
                }
            )

            # Simulate settings dialog saving other settings
            update_config_settings(
                {
                    "autoconnect": True,
                    "log_level": "DEBUG",
                }
            )

            # Simulate another part saving more settings
            update_config_settings(
                {
                    "appearance_mode": "Dark",
                    "color_theme": "green",
                }
            )

            # Verify column sorting was NOT overwritten
            with open(self.temp_config_path, "r") as f:
                config = json.load(f)

            self.assertEqual(
                config["treeview_sort_col_id"], "size", "Column sorting should persist through multiple updates"
            )
            self.assertEqual(
                config["treeview_sort_descending"],
                True,
                "Column sort direction should persist through multiple updates",
            )

            # All other settings should also be there
            self.assertEqual(config["autoconnect"], True, "Settings dialog changes should be saved")
            self.assertEqual(config["log_level"], "DEBUG", "Settings dialog changes should be saved")
            self.assertEqual(config["appearance_mode"], "Dark", "Appearance changes should be saved")
            self.assertEqual(config["color_theme"], "green", "Theme changes should be saved")

    def test_save_config_still_works_for_full_configs(self):
        """
        Test: save_config should still work for full configuration saves.

        This ensures backward compatibility.
        """
        with patch("config_and_logger._CONFIG_FILE_PATH", self.temp_config_path):
            # Create a full config
            full_config = get_default_config()
            full_config["autoconnect"] = True
            full_config["log_level"] = "DEBUG"
            full_config["treeview_sort_col_id"] = "name"

            # Save full config
            save_config(full_config)

            # Verify it was saved correctly
            with open(self.temp_config_path, "r") as f:
                saved_config = json.load(f)

            self.assertEqual(saved_config["autoconnect"], True, "Full config save should work")
            self.assertEqual(saved_config["log_level"], "DEBUG", "Full config save should work")
            self.assertEqual(saved_config["treeview_sort_col_id"], "name", "Full config save should work")

    def test_mixed_save_and_update_operations(self):
        """
        Test: Mixed save_config and update_config_settings operations.

        This tests the real-world scenario where both functions are used.
        """
        with patch("config_and_logger._CONFIG_FILE_PATH", self.temp_config_path):
            # Start with a full config save (like main app initialization)
            full_config = get_default_config()
            full_config["autoconnect"] = True
            save_config(full_config)

            # User changes column sorting (should use update)
            update_config_settings(
                {
                    "treeview_sort_col_id": "name",
                    "treeview_sort_descending": False,
                }
            )

            # Settings dialog saves changes (should use update)
            update_config_settings(
                {
                    "log_level": "DEBUG",
                    "appearance_mode": "Dark",
                }
            )

            # App saves full config again (like on shutdown)
            final_full_config = get_default_config()
            final_full_config["autoconnect"] = True
            final_full_config["treeview_sort_col_id"] = "name"  # Include sorting
            final_full_config["treeview_sort_descending"] = False
            final_full_config["log_level"] = "DEBUG"  # Include log level
            final_full_config["appearance_mode"] = "Dark"  # Include appearance
            save_config(final_full_config)

            # Verify final state
            with open(self.temp_config_path, "r") as f:
                config = json.load(f)

            self.assertEqual(config["autoconnect"], True, "Autoconnect should be preserved")
            self.assertEqual(config["treeview_sort_col_id"], "name", "Column sorting should be preserved")
            self.assertEqual(config["treeview_sort_descending"], False, "Column sort direction should be preserved")
            self.assertEqual(config["log_level"], "DEBUG", "Log level should be preserved")
            self.assertEqual(config["appearance_mode"], "Dark", "Appearance mode should be preserved")


if __name__ == "__main__":
    unittest.main()
