"""
Tests for settings optimization features.

Following TDD Red-Green-Refactor cycle:
1. Window geometry auto-save
2. Theme auto-save
3. Settings dialog immediate save
4. Reset to defaults functionality
"""

import json
import os
import tempfile
import tkinter as tk
from unittest.mock import MagicMock, Mock, patch

import customtkinter as ctk
import pytest


class TestWindowGeometryAutoSave:
    """Test window geometry auto-save functionality."""

    def test_window_configure_event_triggers_debounced_save(self):
        """Test that window configure events trigger debounced geometry save."""
        # RED: This should fail initially
        with patch("gui_main_window.update_config_settings") as mock_save:
            from gui_main_window import HiDockToolGUI

            # Create minimal GUI instance
            root = tk.Tk()
            gui = HiDockToolGUI()

            # Simulate window configure event
            event = Mock()
            event.widget = gui
            gui._on_window_configure(event)

            # Should schedule save with debouncing
            assert gui._geometry_save_timer is not None

            # Trigger the debounced save
            gui._save_window_geometry()

            # Should call update_config_settings with geometry
            mock_save.assert_called_once()
            args = mock_save.call_args[0][0]
            assert "window_geometry" in args

            root.destroy()

    def test_geometry_save_debouncing_cancels_previous_timer(self):
        """Test that rapid window changes cancel previous save timers."""
        # RED: This should fail initially
        with patch("gui_main_window.update_config_settings"):
            from gui_main_window import HiDockToolGUI

            root = tk.Tk()
            gui = HiDockToolGUI()

            # First configure event
            event = Mock()
            event.widget = gui
            gui._on_window_configure(event)
            first_timer = gui._geometry_save_timer

            # Second configure event should cancel first timer
            gui._on_window_configure(event)
            second_timer = gui._geometry_save_timer

            assert first_timer != second_timer
            root.destroy()


class TestThemeAutoSave:
    """Test theme auto-save functionality."""

    def test_appearance_mode_change_saves_immediately(self):
        """Test that appearance mode changes save immediately."""
        # RED: This should fail initially
        with patch("settings_window.update_config_settings") as mock_save:
            from settings_window import SettingsDialog

            # Create mock parent GUI
            parent_gui = Mock()
            parent_gui.appearance_mode_var = Mock()
            parent_gui.apply_theme_and_color = Mock()

            dialog = SettingsDialog(parent_gui, {}, Mock())

            # Simulate appearance mode change
            dialog._on_appearance_change("Dark")

            # Should save immediately
            mock_save.assert_called_once_with({"appearance_mode": "Dark"})
            parent_gui.appearance_mode_var.set.assert_called_with("Dark")
            parent_gui.apply_theme_and_color.assert_called_once()

    def test_color_theme_change_saves_immediately(self):
        """Test that color theme changes save immediately."""
        # RED: This should fail initially
        with patch("settings_window.update_config_settings") as mock_save:
            from settings_window import SettingsDialog

            parent_gui = Mock()
            parent_gui.color_theme_var = Mock()
            parent_gui.apply_theme_and_color = Mock()

            dialog = SettingsDialog(parent_gui, {}, Mock())

            # Simulate theme change
            dialog._on_theme_change("green")

            # Should save immediately
            mock_save.assert_called_once_with({"color_theme": "green"})
            parent_gui.color_theme_var.set.assert_called_with("green")
            parent_gui.apply_theme_and_color.assert_called_once()


class TestSettingsDialogImmediateSave:
    """Test settings dialog immediate save functionality."""

    def test_settings_dialog_has_no_ok_apply_cancel_buttons(self):
        """Test that settings dialog only has Close and Reset buttons."""
        # RED: This should fail initially
        from settings_window import SettingsDialog

        parent_gui = Mock()
        dialog = SettingsDialog(parent_gui, {}, Mock())

        # Should not have OK/Apply/Cancel buttons
        assert not hasattr(dialog, "ok_button")
        assert not hasattr(dialog, "apply_button")
        assert not hasattr(dialog, "cancel_close_button")

        # Should have Close and Reset buttons
        assert hasattr(dialog, "close_button")
        assert hasattr(dialog, "reset_button")

    def test_setting_change_triggers_auto_save(self):
        """Test that any setting change triggers immediate auto-save."""
        # RED: This should fail initially
        with patch("settings_window.update_config_settings") as mock_save:
            from settings_window import SettingsDialog

            parent_gui = Mock()
            dialog = SettingsDialog(parent_gui, {}, Mock())
            dialog._settings_dialog_initializing = False

            # Simulate setting change
            dialog._on_setting_change()

            # Should trigger auto-save
            mock_save.assert_called_once()

    def test_auto_save_only_saves_changed_settings(self):
        """Test that auto-save only saves changed settings, not entire config."""
        # RED: This should fail initially
        with patch("settings_window.update_config_settings") as mock_save:
            from settings_window import SettingsDialog

            parent_gui = Mock()
            parent_gui.config = {"setting1": "value1", "setting2": "value2"}

            dialog = SettingsDialog(parent_gui, {}, Mock())
            dialog.local_vars = {"test_var": Mock()}
            dialog.local_vars["test_var"].get.return_value = "new_value"

            dialog._auto_save_settings()

            # Should call update_config_settings, not save_config
            mock_save.assert_called_once()
            # Should not save entire config
            args = mock_save.call_args[0][0]
            assert len(args) < 10  # Should be small subset, not entire config


class TestResetToDefaults:
    """Test reset to defaults functionality."""

    def test_reset_to_defaults_button_exists(self):
        """Test that reset to defaults button exists in settings dialog."""
        # RED: This should fail initially
        from settings_window import SettingsDialog

        parent_gui = Mock()
        dialog = SettingsDialog(parent_gui, {}, Mock())

        assert hasattr(dialog, "reset_button")
        assert dialog.reset_button.cget("text") == "Reset to Defaults"

    def test_reset_to_defaults_requires_confirmation(self):
        """Test that reset to defaults requires user confirmation."""
        # RED: This should fail initially
        with patch("settings_window.messagebox.askyesno", return_value=False) as mock_confirm:
            with patch("settings_window.update_config_settings") as mock_save:
                from settings_window import SettingsDialog

                parent_gui = Mock()
                dialog = SettingsDialog(parent_gui, {}, Mock())

                dialog._reset_to_defaults()

                # Should ask for confirmation
                mock_confirm.assert_called_once()
                # Should not save if user cancels
                mock_save.assert_not_called()

    def test_reset_to_defaults_saves_default_config(self):
        """Test that reset to defaults saves default configuration."""
        # RED: This should fail initially
        with patch("settings_window.messagebox.askyesno", return_value=True):
            with patch("settings_window.messagebox.showinfo"):
                with patch("settings_window.update_config_settings") as mock_save:
                    with patch("settings_window.DEFAULT_CONFIG", {"default": "config"}):
                        from settings_window import SettingsDialog

                        parent_gui = Mock()
                        parent_gui.config = {}
                        parent_gui._initialize_vars_from_config = Mock()
                        parent_gui.apply_theme_and_color = Mock()

                        dialog = SettingsDialog(parent_gui, {}, Mock())
                        dialog.destroy = Mock()

                        dialog._reset_to_defaults()

                        # Should save default config
                        mock_save.assert_called_once_with({"default": "config"})
                        # Should update parent GUI
                        parent_gui._initialize_vars_from_config.assert_called_once()
                        parent_gui.apply_theme_and_color.assert_called_once()


class TestNoFullConfigSaves:
    """Test that full config saves are eliminated."""

    def test_no_save_config_usage_in_settings_window(self):
        """Test that settings_window.py doesn't use save_config()."""
        # RED: This should fail initially
        with open("settings_window.py", "r") as f:
            content = f.read()

        # Should not contain save_config calls (except imports)
        lines = content.split("\n")
        save_config_calls = [
            line for line in lines if "save_config(" in line and "import" not in line and "def " not in line
        ]

        assert len(save_config_calls) == 0, f"Found save_config calls: {save_config_calls}"

    def test_settings_use_update_config_settings(self):
        """Test that all settings use update_config_settings for partial saves."""
        # RED: This should fail initially
        with patch("settings_window.update_config_settings") as mock_save:
            from settings_window import SettingsDialog

            parent_gui = Mock()
            dialog = SettingsDialog(parent_gui, {}, Mock())

            # Test directory change
            dialog.current_dialog_download_dir = ["new_dir"]
            dialog.current_dl_dir_label_settings = Mock()
            dialog.current_dl_dir_label_settings.winfo_exists.return_value = True
            dialog._select_download_dir_action()

            # Should use update_config_settings
            mock_save.assert_called()


if __name__ == "__main__":
    pytest.main([__file__])
