"""
Implementation tests for settings_window.py - testing actual methods with proper setup.
This file tests the core business logic and identifies issues that need fixing.
"""

import os
import tkinter as tk
from unittest.mock import MagicMock, Mock, patch

import pytest


class TestSettingsImplementation:
    """Test actual implementation methods from settings_window.py"""

    @pytest.mark.unit
    def test_validate_numeric_settings_all_valid(self):
        """Test _validate_numeric_settings with all valid values."""
        from settings_window import SettingsDialog

        with patch.object(SettingsDialog, "__init__", return_value=None):
            dialog = SettingsDialog.__new__(SettingsDialog)

            # Setup all required numeric variables with valid values
            dialog.local_vars = {
                "selected_vid_var": Mock(),
                "selected_pid_var": Mock(),
                "target_interface_var": Mock(),
                "recording_check_interval_var": Mock(),
                "default_command_timeout_ms_var": Mock(),
                "file_stream_timeout_s_var": Mock(),
                "auto_refresh_interval_s_var": Mock(),
            }

            # Set valid values within ranges
            dialog.local_vars["selected_vid_var"].get.return_value = "1234"  # 0-65535
            dialog.local_vars["selected_pid_var"].get.return_value = "5678"  # 0-65535
            dialog.local_vars["target_interface_var"].get.return_value = "0"  # 0-10
            dialog.local_vars["recording_check_interval_var"].get.return_value = "5"  # 1-3600
            dialog.local_vars["default_command_timeout_ms_var"].get.return_value = "1000"  # 100-60000
            dialog.local_vars["file_stream_timeout_s_var"].get.return_value = "30"  # 1-300
            dialog.local_vars["auto_refresh_interval_s_var"].get.return_value = "10"  # 1-3600

            result = dialog._validate_numeric_settings()
            assert result is True

    @pytest.mark.unit
    def test_validate_numeric_settings_invalid_range(self):
        """Test _validate_numeric_settings with out-of-range values."""
        from settings_window import SettingsDialog

        with patch.object(SettingsDialog, "__init__", return_value=None):
            dialog = SettingsDialog.__new__(SettingsDialog)
            dialog.local_vars = {"selected_vid_var": Mock()}
            dialog.local_vars["selected_vid_var"].get.return_value = "99999"  # Too large for VID

            with patch("tkinter.messagebox.showerror") as mock_error:
                result = dialog._validate_numeric_settings()
                assert result is False
                mock_error.assert_called_once()

    @pytest.mark.unit
    def test_update_model_list_all_providers(self):
        """Test _update_model_list for all supported providers."""
        from settings_window import SettingsDialog

        with patch.object(SettingsDialog, "__init__", return_value=None):
            dialog = SettingsDialog.__new__(SettingsDialog)
            dialog.local_vars = {"ai_api_provider_var": Mock(), "ai_model_var": Mock()}
            dialog.model_combobox = Mock()

            # Test each provider
            providers = [
                "gemini",
                "openai",
                "anthropic",
                "openrouter",
                "amazon",
                "qwen",
                "deepseek",
                "ollama",
                "lmstudio",
            ]

            for provider in providers:
                dialog.local_vars["ai_api_provider_var"].get.return_value = provider
                dialog.local_vars["ai_model_var"].get.return_value = "old-model"

                dialog._update_model_list()

                # Verify model combobox was configured
                dialog.model_combobox.configure.assert_called()
                args = dialog.model_combobox.configure.call_args[1]
                assert len(args["values"]) > 0  # Should have models

    @pytest.mark.unit
    def test_update_temperature_label_formatting(self):
        """Test _update_temperature_label with different values."""
        from settings_window import SettingsDialog

        with patch.object(SettingsDialog, "__init__", return_value=None):
            dialog = SettingsDialog.__new__(SettingsDialog)
            dialog.local_vars = {"ai_temperature_var": Mock()}
            dialog.temperature_label = Mock()

            # Test different temperature values
            test_values = [0.0, 0.3, 0.75, 1.0]

            for temp in test_values:
                dialog.local_vars["ai_temperature_var"].get.return_value = temp
                dialog._update_temperature_label()
                dialog.temperature_label.configure.assert_called_with(text=f"{temp:.2f}")

    @pytest.mark.unit
    def test_encrypt_decrypt_api_key_cycle(self):
        """Test API key encryption/decryption cycle."""
        from settings_window import SettingsDialog

        with patch.object(SettingsDialog, "__init__", return_value=None):
            dialog = SettingsDialog.__new__(SettingsDialog)
            dialog.parent_gui = Mock()
            dialog.parent_gui.config = {"config_file_path": "/test/config.json"}

            test_key = "test-api-key-12345"

            # Test without encryption
            with patch("settings_window.ENCRYPTION_AVAILABLE", False):
                encrypted = dialog._encrypt_api_key(test_key)
                decrypted = dialog._decrypt_api_key(encrypted)
                assert encrypted == test_key
                assert decrypted == test_key

    @pytest.mark.unit
    def test_update_color_preview_widget_error_handling(self):
        """Test _update_color_preview_widget error handling."""
        from settings_window import SettingsDialog

        with patch.object(SettingsDialog, "__init__", return_value=None):
            dialog = SettingsDialog.__new__(SettingsDialog)
            dialog.parent_gui = Mock()
            dialog.parent_gui.apply_appearance_mode_theme_color.return_value = "#808080"

            mock_frame = Mock()
            mock_frame.winfo_exists.return_value = True
            # Set up the mock to raise TclError on first call, then succeed on second
            mock_frame.configure.side_effect = [tk.TclError("Invalid color"), None]
            mock_color_var = Mock()
            mock_color_var.get.return_value = "#INVALID"

            # Should handle error gracefully
            dialog._update_color_preview_widget(mock_frame, mock_color_var)

            # Should try to configure twice (once with original color, once with fallback)
            assert mock_frame.configure.call_count == 2

    @pytest.mark.unit
    def test_update_provider_config_all_providers(self):
        """Test _update_provider_config for all providers."""
        from settings_window import SettingsDialog

        with patch.object(SettingsDialog, "__init__", return_value=None):
            dialog = SettingsDialog.__new__(SettingsDialog)
            dialog.local_vars = {"ai_api_provider_var": Mock()}

            # Mock all provider frames
            provider_frames = ["openrouter", "amazon", "qwen", "deepseek", "ollama", "lmstudio"]
            for provider in provider_frames:
                frame_name = f"{provider}_frame"
                setattr(dialog, frame_name, Mock())

            # Test each provider
            for provider in provider_frames:
                dialog.local_vars["ai_api_provider_var"].get.return_value = provider
                dialog._update_provider_config()

                # Verify correct frame is shown
                frame = getattr(dialog, f"{provider}_frame")
                frame.pack.assert_called()

    @pytest.mark.unit
    def test_directory_management_methods(self):
        """Test directory selection and reset methods."""
        from settings_window import SettingsDialog

        with patch.object(SettingsDialog, "__init__", return_value=None):
            dialog = SettingsDialog.__new__(SettingsDialog)
            dialog.current_dialog_download_dir = ["/test/current"]
            dialog.current_dl_dir_label_settings = Mock()
            dialog.current_dl_dir_label_settings.winfo_exists.return_value = True
            dialog._update_button_states_on_change = Mock()

            # Test successful directory selection
            with patch("tkinter.filedialog.askdirectory", return_value="/test/new"):
                dialog._select_download_dir_action()
                assert dialog.current_dialog_download_dir[0] == "/test/new"
                dialog.current_dl_dir_label_settings.configure.assert_called_with(text="/test/new")
                dialog._update_button_states_on_change.assert_called()

            # Test directory reset
            with patch("os.getcwd", return_value="/test/default"):
                dialog._reset_download_dir_action()
                assert dialog.current_dialog_download_dir[0] == "/test/default"
                dialog.current_dl_dir_label_settings.configure.assert_called_with(text="/test/default")

    @pytest.mark.unit
    def test_button_action_methods(self):
        """Test button action methods."""
        from settings_window import SettingsDialog

        with patch.object(SettingsDialog, "__init__", return_value=None):
            dialog = SettingsDialog.__new__(SettingsDialog)
            dialog.settings_changed_tracker = [True]
            dialog.destroy = Mock()
            dialog._perform_apply_settings_logic = Mock()

            # Test OK action with changes
            dialog._ok_action()
            dialog._perform_apply_settings_logic.assert_called_once_with(update_dialog_baseline=False)
            dialog.destroy.assert_called_once()

            # Reset mocks
            dialog.destroy.reset_mock()
            dialog._perform_apply_settings_logic.reset_mock()

            # Test OK action without changes
            dialog.settings_changed_tracker = [False]
            dialog._ok_action()
            dialog._perform_apply_settings_logic.assert_not_called()
            dialog.destroy.assert_called_once()

    @pytest.mark.unit
    def test_api_key_validation_methods(self):
        """Test API key validation methods."""
        from settings_window import SettingsDialog

        with patch.object(SettingsDialog, "__init__", return_value=None):
            dialog = SettingsDialog.__new__(SettingsDialog)
            dialog.api_key_entry = Mock()
            dialog.api_key_status_label = Mock()
            dialog.validate_key_button = Mock()
            dialog.local_vars = {"ai_api_provider_var": Mock()}

            # Test empty API key
            dialog.api_key_entry.get.return_value = ""
            dialog._validate_api_key()
            dialog.api_key_status_label.configure.assert_called_with(
                text="Status: Please enter an API key", text_color="red"
            )

            # Test with API key
            dialog.api_key_entry.get.return_value = "test-key"
            dialog.local_vars["ai_api_provider_var"].get.return_value = "gemini"

            with patch("threading.Thread") as mock_thread:
                dialog._validate_api_key()
                mock_thread.assert_called_once()
                dialog.validate_key_button.configure.assert_called_with(state="disabled")

    @pytest.mark.unit
    def test_validation_complete_both_cases(self):
        """Test _validation_complete for both success and failure."""
        from settings_window import SettingsDialog

        with patch.object(SettingsDialog, "__init__", return_value=None):
            dialog = SettingsDialog.__new__(SettingsDialog)
            dialog.api_key_status_label = Mock()
            dialog.validate_key_button = Mock()

            # Test success
            dialog._validation_complete(True)
            dialog.api_key_status_label.configure.assert_called_with(text="Status: Valid API key", text_color="green")
            dialog.validate_key_button.configure.assert_called_with(state="normal")

            # Reset mocks
            dialog.api_key_status_label.reset_mock()
            dialog.validate_key_button.reset_mock()

            # Test failure
            dialog._validation_complete(False)
            dialog.api_key_status_label.configure.assert_called_with(text="Status: Invalid API key", text_color="red")
            dialog.validate_key_button.configure.assert_called_with(state="normal")

    @pytest.mark.unit
    def test_device_selection_methods(self):
        """Test device selection methods."""
        from settings_window import SettingsDialog

        with patch.object(SettingsDialog, "__init__", return_value=None):
            dialog = SettingsDialog.__new__(SettingsDialog)
            dialog.local_vars = {"selected_vid_var": Mock(), "selected_pid_var": Mock()}
            dialog.settings_changed_tracker = [False]
            dialog._update_button_states_on_change = Mock()

            # Mock device info
            mock_device_info = Mock()
            mock_device_info.name = "Test Device"
            mock_device_info.vendor_id = 1234
            mock_device_info.product_id = 5678

            with patch("settings_window.logger"):
                dialog._on_device_selected_enhanced(mock_device_info)

                dialog.local_vars["selected_vid_var"].set.assert_called_with("1234")
                dialog.local_vars["selected_pid_var"].set.assert_called_with("5678")
                assert dialog.settings_changed_tracker[0] is True
                dialog._update_button_states_on_change.assert_called_once()

    @pytest.mark.unit
    def test_generate_encryption_key_no_encryption(self):
        """Test _generate_encryption_key when encryption unavailable."""
        from settings_window import SettingsDialog

        with patch.object(SettingsDialog, "__init__", return_value=None):
            dialog = SettingsDialog.__new__(SettingsDialog)

            with patch("settings_window.ENCRYPTION_AVAILABLE", False):
                result = dialog._generate_encryption_key()
                assert result is None


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
