# test_settings_persistence_critical_bugs.py
"""
Critical bug tests for settings persistence issues.

This test file identifies and tests the root causes of:
1. Settings not being saved when different tab is selected during OK/Apply
2. Apply button not working at all
3. Column sorting not being saved (reported multiple times)

Following TDD principles: Red-Green-Refactor
"""

import os
import tempfile
import unittest
from unittest.mock import MagicMock, patch

import customtkinter as ctk

from config_and_logger import load_config, save_config
from settings_window import SettingsDialog


class TestSettingsPersistenceCriticalBugs(unittest.TestCase):
    """Test critical settings persistence bugs."""

    def setUp(self):
        """Set up test environment."""
        # Create temporary config file
        self.temp_config_file = tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False)
        self.temp_config_file.close()

        # Mock parent GUI
        self.mock_parent = MagicMock()
        self.mock_parent.config = {
            "config_file_path": self.temp_config_file.name,
            "autoconnect": False,
            "log_level": "INFO",
            "appearance_mode": "System",
            "color_theme": "blue",
            "treeview_sort_col_id": "datetime",
            "treeview_sort_descending": True,
        }

        # Mock parent GUI variables
        self.mock_parent.autoconnect_var = ctk.BooleanVar(value=False)
        self.mock_parent.logger_processing_level_var = ctk.StringVar(value="INFO")
        self.mock_parent.appearance_mode_var = ctk.StringVar(value="System")
        self.mock_parent.color_theme_var = ctk.StringVar(value="blue")
        self.mock_parent.download_directory = os.getcwd()

        # Mock HiDock instance
        self.mock_hidock = MagicMock()
        self.mock_hidock.is_connected.return_value = False

    def tearDown(self):
        """Clean up test environment."""
        try:
            os.unlink(self.temp_config_file.name)
        except OSError:
            pass

    def test_settings_not_saved_when_different_tab_selected_during_ok(self):
        """
        Test: Settings are not saved if different tab is selected when OK is pressed.

        This is a critical bug - settings should be saved regardless of which tab
        is currently selected when OK/Apply is pressed.
        """
        # Create settings dialog
        dialog = SettingsDialog(self.mock_parent, self.mock_parent.config.copy(), self.mock_hidock)

        # Simulate user changing a setting in General tab
        dialog.local_vars["autoconnect_var"].set(True)

        # Simulate user switching to Connection tab (different from where change was made)
        # This should NOT prevent the setting from being saved

        # Simulate clicking OK
        dialog._ok_action()

        # Verify the setting was saved to parent config
        # This test should FAIL initially (Red phase)
        self.assertTrue(
            self.mock_parent.autoconnect_var.set.called,
            "Settings should be saved regardless of which tab is selected during OK",
        )

        dialog.destroy()

    def test_apply_button_not_working(self):
        """
        Test: Apply button functionality is completely broken.

        The Apply button should:
        1. Save all changed settings
        2. Update the parent GUI
        3. Reset the dialog's change tracking
        4. Disable OK/Apply buttons after successful apply
        """
        # Create settings dialog
        dialog = SettingsDialog(self.mock_parent, self.mock_parent.config.copy(), self.mock_hidock)

        # Simulate user making changes
        dialog.local_vars["autoconnect_var"].set(True)
        dialog.local_vars["logger_processing_level_var"].set("DEBUG")

        # Trigger change detection
        dialog.settings_changed_tracker[0] = True

        # Simulate clicking Apply
        dialog._apply_action_ui_handler()

        # Verify Apply functionality works
        # This test should FAIL initially (Red phase)
        self.assertTrue(self.mock_parent.autoconnect_var.set.called, "Apply should save autoconnect setting")
        self.assertTrue(
            self.mock_parent.logger_processing_level_var.set.called, "Apply should save logger level setting"
        )

        # Verify change tracking is reset after Apply
        self.assertFalse(dialog.settings_changed_tracker[0], "Change tracking should be reset after Apply")

        dialog.destroy()

    def test_column_sorting_not_saved(self):
        """
        Test: Column sorting preferences are not being saved.

        This has been reported "more than 10 times" and is a critical UX issue.
        The treeview sort column and direction should persist between sessions.
        """
        # Mock the main GUI with treeview sorting state
        mock_main_gui = MagicMock()
        mock_main_gui.treeview_sort_column = "name"
        mock_main_gui.treeview_sort_reverse = False
        mock_main_gui.saved_treeview_sort_column = "name"
        mock_main_gui.saved_treeview_sort_reverse = False
        mock_main_gui.config = {}

        # Simulate user changing sort order
        mock_main_gui.sort_treeview_column("size", True)

        # Simulate application closing (should save sort state)
        mock_main_gui.on_closing()

        # Verify sort state was saved to config
        # This test should FAIL initially (Red phase)
        self.assertEqual(
            mock_main_gui.config.get("treeview_sort_col_id"), "size", "Column sort column should be saved to config"
        )
        self.assertEqual(
            mock_main_gui.config.get("treeview_sort_descending"),
            False,  # First click should be ascending
            "Column sort direction should be saved to config",
        )

    def test_settings_persistence_across_all_tabs(self):
        """
        Test: Settings from all tabs should be saved regardless of current tab.

        This is a comprehensive test to ensure the root cause is identified.
        """
        # Create settings dialog
        dialog = SettingsDialog(self.mock_parent, self.mock_parent.config.copy(), self.mock_hidock)

        # Make changes in different tabs
        # General tab
        dialog.local_vars["autoconnect_var"].set(True)
        dialog.local_vars["appearance_mode_var"].set("Dark")

        # Connection tab
        dialog.local_vars["selected_vid_var"].set("1234")

        # Operation tab
        dialog.local_vars["recording_check_interval_var"].set("5")

        # Simulate being on a different tab when OK is pressed
        # This should NOT matter - all changes should be saved

        # Apply changes
        dialog._perform_apply_settings_logic(update_dialog_baseline=False)

        # Verify ALL settings were applied regardless of current tab
        # These tests should FAIL initially (Red phase)
        self.assertTrue(self.mock_parent.autoconnect_var.set.called, "General tab settings should be saved")
        self.assertTrue(self.mock_parent.appearance_mode_var.set.called, "General tab settings should be saved")

        dialog.destroy()

    def test_apply_vs_ok_behavior_difference(self):
        """
        Test: Apply and OK should have identical save behavior.

        The only difference should be that OK closes the dialog.
        """
        # Test Apply behavior
        dialog1 = SettingsDialog(self.mock_parent, self.mock_parent.config.copy(), self.mock_hidock)
        dialog1.local_vars["autoconnect_var"].set(True)
        dialog1.settings_changed_tracker[0] = True

        # Reset mock calls
        self.mock_parent.reset_mock()

        # Apply changes
        dialog1._apply_action_ui_handler()
        apply_calls = self.mock_parent.autoconnect_var.set.call_count

        dialog1.destroy()

        # Test OK behavior
        dialog2 = SettingsDialog(self.mock_parent, self.mock_parent.config.copy(), self.mock_hidock)
        dialog2.local_vars["autoconnect_var"].set(True)
        dialog2.settings_changed_tracker[0] = True

        # Reset mock calls
        self.mock_parent.reset_mock()

        # OK changes (should not close dialog in test)
        dialog2._perform_apply_settings_logic(update_dialog_baseline=False)
        ok_calls = self.mock_parent.autoconnect_var.set.call_count

        # Verify identical behavior
        # This test should FAIL initially if Apply is broken (Red phase)
        self.assertEqual(apply_calls, ok_calls, "Apply and OK should have identical save behavior")

        dialog2.destroy()

    def test_config_key_mapping_correctness(self):
        """
        Test: Verify that GUI variable names map correctly to config keys.

        This tests the root cause of settings not being saved - incorrect key mapping.
        """
        dialog = SettingsDialog(self.mock_parent, self.mock_parent.config.copy(), self.mock_hidock)

        # Test critical mappings that are likely broken
        test_mappings = {
            "logger_processing_level_var": "log_level",
            "quit_without_prompt_var": "quit_without_prompt_if_connected",
            "recording_check_interval_var": "recording_check_interval_s",
            "auto_refresh_interval_s_var": "auto_refresh_interval_s",
        }

        for var_name, expected_config_key in test_mappings.items():
            if var_name in dialog.local_vars:
                # Change the value
                if isinstance(dialog.local_vars[var_name], ctk.BooleanVar):
                    dialog.local_vars[var_name].set(True)
                elif isinstance(dialog.local_vars[var_name], ctk.StringVar):
                    dialog.local_vars[var_name].set("test_value")
                elif isinstance(dialog.local_vars[var_name], ctk.IntVar):
                    dialog.local_vars[var_name].set(999)

                # Apply settings
                dialog._perform_apply_settings_logic(update_dialog_baseline=False)

                # Verify the config key was set correctly
                # This test should FAIL initially if key mapping is wrong (Red phase)
                self.assertIn(
                    expected_config_key,
                    self.mock_parent.config,
                    f"Config key '{expected_config_key}' should be set for variable '{var_name}'",
                )

        dialog.destroy()


if __name__ == "__main__":
    unittest.main()
