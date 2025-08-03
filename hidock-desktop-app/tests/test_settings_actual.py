"""
Actual implementation tests for settings_window.py methods.
Tests the real methods with proper mocking.
"""

import tkinter as tk
from unittest.mock import MagicMock, Mock, patch

import pytest


class TestSettingsWindowMethods:
    """Test actual settings window methods."""

    @pytest.mark.unit
    def test_validate_numeric_settings_method(self):
        """Test the actual _validate_numeric_settings method."""
        # Import and create instance
        from settings_window import SettingsDialog

        # Mock the initialization to avoid GUI creation
        with patch.object(SettingsDialog, "__init__", return_value=None):
            dialog = SettingsDialog.__new__(SettingsDialog)

            # Mock required attributes
            dialog.local_vars = {}
            dialog.tk = Mock()  # For messagebox

            # Test with valid values - add all required numeric variables with valid ranges
            numeric_vars_with_values = {
                "selected_vid_var": "4310",  # Valid VID (0x10d6)
                "selected_pid_var": "45069",  # Valid PID (0xb00d)
                "target_interface_var": "0",  # Valid interface
                "recording_check_interval_var": "5",  # Valid interval
                "default_command_timeout_ms_var": "5000",  # Valid timeout
                "file_stream_timeout_s_var": "30",  # Valid timeout
                "auto_refresh_interval_s_var": "10",  # Valid interval
            }

            for var_name, value in numeric_vars_with_values.items():
                mock_var = Mock()
                mock_var.get.return_value = value
                dialog.local_vars[var_name] = mock_var

            # Add AI settings variables with valid values
            ai_temp_var = Mock()
            ai_temp_var.get.return_value = 0.7  # Valid temperature
            dialog.local_vars["ai_temperature_var"] = ai_temp_var

            ai_tokens_var = Mock()
            ai_tokens_var.get.return_value = 4000  # Valid max tokens
            dialog.local_vars["ai_max_tokens_var"] = ai_tokens_var

            # Mock messagebox to avoid GUI
            with patch("tkinter.messagebox"):
                result = dialog._validate_numeric_settings()
                assert result is True

    @pytest.mark.unit
    def test_validate_numeric_settings_empty_value(self):
        """Test validation with empty value."""
        from settings_window import SettingsDialog

        with patch.object(SettingsDialog, "__init__", return_value=None):
            dialog = SettingsDialog.__new__(SettingsDialog)
            dialog.local_vars = {"selected_vid_var": Mock()}
            dialog.local_vars["selected_vid_var"].get.return_value = ""
            dialog.tk = Mock()

            with patch("settings_window.messagebox.showerror") as mock_error:
                result = dialog._validate_numeric_settings()
                assert result is False
                mock_error.assert_called_once()

    @pytest.mark.unit
    def test_update_model_list_method(self):
        """Test the _update_model_list method."""
        from settings_window import SettingsDialog

        with patch.object(SettingsDialog, "__init__", return_value=None):
            dialog = SettingsDialog.__new__(SettingsDialog)

            # Mock required attributes
            dialog.local_vars = {"ai_api_provider_var": Mock(), "ai_model_var": Mock()}
            dialog.local_vars["ai_api_provider_var"].get.return_value = "gemini"
            dialog.local_vars["ai_model_var"].get.return_value = "old-model"

            dialog.model_combobox = Mock()

            # Call the method
            dialog._update_model_list()

            # Verify it was called with gemini models
            dialog.model_combobox.configure.assert_called()
            call_args = dialog.model_combobox.configure.call_args[1]
            assert "gemini-2.5-flash" in call_args["values"]

    @pytest.mark.unit
    def test_update_temperature_label_method(self):
        """Test the _update_temperature_label method."""
        from settings_window import SettingsDialog

        with patch.object(SettingsDialog, "__init__", return_value=None):
            dialog = SettingsDialog.__new__(SettingsDialog)

            dialog.local_vars = {"ai_temperature_var": Mock()}
            dialog.local_vars["ai_temperature_var"].get.return_value = 0.75
            dialog.temperature_label = Mock()

            dialog._update_temperature_label()

            dialog.temperature_label.configure.assert_called_with(text="0.75")

    @pytest.mark.unit
    def test_encrypt_api_key_no_encryption(self):
        """Test API key encryption when encryption is not available."""
        from settings_window import SettingsDialog

        with patch.object(SettingsDialog, "__init__", return_value=None):
            dialog = SettingsDialog.__new__(SettingsDialog)

            # Mock encryption not available
            with patch("settings_window.ENCRYPTION_AVAILABLE", False):
                result = dialog._encrypt_api_key("test-key")
                assert result == "test-key"

    @pytest.mark.unit
    def test_decrypt_api_key_no_encryption(self):
        """Test API key decryption when encryption is not available."""
        from settings_window import SettingsDialog

        with patch.object(SettingsDialog, "__init__", return_value=None):
            dialog = SettingsDialog.__new__(SettingsDialog)

            with patch("settings_window.ENCRYPTION_AVAILABLE", False):
                result = dialog._decrypt_api_key("encrypted-key")
                assert result == "encrypted-key"

    @pytest.mark.unit
    def test_update_color_preview_widget_valid_color(self):
        """Test color preview widget update with valid color."""
        from settings_window import SettingsDialog

        with patch.object(SettingsDialog, "__init__", return_value=None):
            dialog = SettingsDialog.__new__(SettingsDialog)

            # Mock parent GUI
            dialog.parent_gui = Mock()
            dialog.parent_gui.apply_appearance_mode_theme_color.return_value = "#808080"

            # Mock frame and color variable
            mock_frame = Mock()
            mock_frame.winfo_exists.return_value = True
            mock_color_var = Mock()
            mock_color_var.get.return_value = "#FF0000"

            dialog._update_color_preview_widget(mock_frame, mock_color_var)

            mock_frame.configure.assert_called_with(fg_color="#FF0000")

    @pytest.mark.unit
    def test_update_color_preview_widget_invalid_color(self):
        """Test color preview widget update with invalid color."""
        from settings_window import SettingsDialog

        with patch.object(SettingsDialog, "__init__", return_value=None):
            dialog = SettingsDialog.__new__(SettingsDialog)

            dialog.parent_gui = Mock()
            dialog.parent_gui.apply_appearance_mode_theme_color.return_value = "#808080"

            mock_frame = Mock()
            mock_frame.winfo_exists.return_value = True
            mock_color_var = Mock()
            mock_color_var.get.return_value = "invalid-color"

            dialog._update_color_preview_widget(mock_frame, mock_color_var)

            # Should fall back to default color
            mock_frame.configure.assert_called_with(fg_color="#808080")

    @pytest.mark.unit
    def test_update_provider_config_gemini(self):
        """Test provider config update for Gemini."""
        from settings_window import SettingsDialog

        with patch.object(SettingsDialog, "__init__", return_value=None):
            dialog = SettingsDialog.__new__(SettingsDialog)

            dialog.local_vars = {"ai_api_provider_var": Mock()}
            dialog.local_vars["ai_api_provider_var"].get.return_value = "gemini"

            # Mock all provider frames
            for provider in ["openrouter", "amazon", "qwen", "deepseek", "ollama", "lmstudio"]:
                frame = Mock()
                setattr(dialog, f"{provider}_frame", frame)

            dialog._update_provider_config()

            # Verify all frames are hidden for Gemini
            for provider in ["openrouter", "amazon", "qwen", "deepseek", "ollama", "lmstudio"]:
                frame = getattr(dialog, f"{provider}_frame")
                frame.pack_forget.assert_called()

    @pytest.mark.unit
    def test_update_provider_config_ollama(self):
        """Test provider config update for Ollama."""
        from settings_window import SettingsDialog

        with patch.object(SettingsDialog, "__init__", return_value=None):
            dialog = SettingsDialog.__new__(SettingsDialog)

            dialog.local_vars = {"ai_api_provider_var": Mock()}
            dialog.local_vars["ai_api_provider_var"].get.return_value = "ollama"

            # Mock provider frames
            for provider in ["openrouter", "amazon", "qwen", "deepseek", "ollama", "lmstudio"]:
                frame = Mock()
                setattr(dialog, f"{provider}_frame", frame)

            dialog._update_provider_config()

            # Verify Ollama frame is shown
            dialog.ollama_frame.pack.assert_called_with(fill="x", pady=2, padx=5)

    @pytest.mark.unit
    def test_ok_action_with_changes(self):
        """Test OK action when settings have changed."""
        from settings_window import SettingsDialog

        with patch.object(SettingsDialog, "__init__", return_value=None):
            dialog = SettingsDialog.__new__(SettingsDialog)

            dialog.settings_changed_tracker = [True]
            dialog._perform_apply_settings_logic = Mock()
            dialog.destroy = Mock()

            dialog._ok_action()

            dialog._perform_apply_settings_logic.assert_called_once_with(update_dialog_baseline=False)
            dialog.destroy.assert_called_once()

    @pytest.mark.unit
    def test_ok_action_without_changes(self):
        """Test OK action when no settings have changed."""
        from settings_window import SettingsDialog

        with patch.object(SettingsDialog, "__init__", return_value=None):
            dialog = SettingsDialog.__new__(SettingsDialog)

            dialog.settings_changed_tracker = [False]
            dialog._perform_apply_settings_logic = Mock()
            dialog.destroy = Mock()

            dialog._ok_action()

            dialog._perform_apply_settings_logic.assert_not_called()
            dialog.destroy.assert_called_once()

    @pytest.mark.unit
    def test_select_download_dir_action_success(self):
        """Test successful download directory selection."""
        from settings_window import SettingsDialog

        with patch.object(SettingsDialog, "__init__", return_value=None):
            dialog = SettingsDialog.__new__(SettingsDialog)

            dialog.current_dialog_download_dir = ["/test/current"]
            dialog.current_dl_dir_label_settings = Mock()
            dialog.current_dl_dir_label_settings.winfo_exists.return_value = True
            dialog._update_button_states_on_change = Mock()

            with patch("settings_window.filedialog.askdirectory", return_value="/test/new"):
                dialog._select_download_dir_action()

                assert dialog.current_dialog_download_dir[0] == "/test/new"
                dialog.current_dl_dir_label_settings.configure.assert_called_with(text="/test/new")
                dialog._update_button_states_on_change.assert_called_once()

    @pytest.mark.unit
    def test_select_download_dir_action_cancelled(self):
        """Test cancelled download directory selection."""
        from settings_window import SettingsDialog

        with patch.object(SettingsDialog, "__init__", return_value=None):
            dialog = SettingsDialog.__new__(SettingsDialog)

            original_dir = "/test/original"
            dialog.current_dialog_download_dir = [original_dir]
            dialog._update_button_states_on_change = Mock()

            with patch("settings_window.filedialog.askdirectory", return_value=""):
                dialog._select_download_dir_action()

                # Directory should not change
                assert dialog.current_dialog_download_dir[0] == original_dir
                dialog._update_button_states_on_change.assert_not_called()

    @pytest.mark.unit
    def test_reset_download_dir_action(self):
        """Test download directory reset."""
        from settings_window import SettingsDialog

        with patch.object(SettingsDialog, "__init__", return_value=None):
            dialog = SettingsDialog.__new__(SettingsDialog)

            dialog.current_dialog_download_dir = ["/test/current"]
            dialog.current_dl_dir_label_settings = Mock()
            dialog.current_dl_dir_label_settings.winfo_exists.return_value = True
            dialog._update_button_states_on_change = Mock()

            with patch("settings_window.os.getcwd", return_value="/test/default"):
                dialog._reset_download_dir_action()

                assert dialog.current_dialog_download_dir[0] == "/test/default"
                dialog.current_dl_dir_label_settings.configure.assert_called_with(text="/test/default")
                dialog._update_button_states_on_change.assert_called_once()

    @pytest.mark.unit
    def test_validation_complete_success(self):
        """Test API key validation completion with success."""
        from settings_window import SettingsDialog

        with patch.object(SettingsDialog, "__init__", return_value=None):
            dialog = SettingsDialog.__new__(SettingsDialog)

            dialog.api_key_status_label = Mock()
            dialog.validate_key_button = Mock()

            dialog._validation_complete(True)

            dialog.api_key_status_label.configure.assert_called_with(text="Status: Valid API key", text_color="green")
            dialog.validate_key_button.configure.assert_called_with(state="normal")

    @pytest.mark.unit
    def test_validation_complete_failure(self):
        """Test API key validation completion with failure."""
        from settings_window import SettingsDialog

        with patch.object(SettingsDialog, "__init__", return_value=None):
            dialog = SettingsDialog.__new__(SettingsDialog)

            dialog.api_key_status_label = Mock()
            dialog.validate_key_button = Mock()

            dialog._validation_complete(False)

            dialog.api_key_status_label.configure.assert_called_with(text="Status: Invalid API key", text_color="red")
            dialog.validate_key_button.configure.assert_called_with(state="normal")

    @pytest.mark.unit
    def test_validate_api_key_empty(self):
        """Test API key validation with empty key."""
        from settings_window import SettingsDialog

        with patch.object(SettingsDialog, "__init__", return_value=None):
            dialog = SettingsDialog.__new__(SettingsDialog)

            dialog.api_key_entry = Mock()
            dialog.api_key_entry.get.return_value = ""
            dialog.api_key_status_label = Mock()

            dialog._validate_api_key()

            dialog.api_key_status_label.configure.assert_called_with(
                text="Status: Please enter an API key", text_color="red"
            )

    @pytest.mark.unit
    def test_validate_api_key_with_key(self):
        """Test API key validation with actual key."""
        from settings_window import SettingsDialog

        with patch.object(SettingsDialog, "__init__", return_value=None):
            dialog = SettingsDialog.__new__(SettingsDialog)

            dialog.api_key_entry = Mock()
            dialog.api_key_entry.get.return_value = "test-api-key"
            dialog.api_key_status_label = Mock()
            dialog.validate_key_button = Mock()
            dialog.local_vars = {"ai_api_provider_var": Mock()}
            dialog.local_vars["ai_api_provider_var"].get.return_value = "gemini"

            with patch("settings_window.threading.Thread") as mock_thread:
                dialog._validate_api_key()

                # Verify validation thread was started
                mock_thread.assert_called_once()
                dialog.validate_key_button.configure.assert_called_with(state="disabled")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
