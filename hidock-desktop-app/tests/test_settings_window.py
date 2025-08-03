"""
Comprehensive tests for settings_window.py module.
This file provides test coverage for the SettingsDialog class and its methods.
"""

import pytest
from unittest.mock import Mock, patch, MagicMock
import os
import tkinter as tk


class TestSettingsDialog:
    """Test the SettingsDialog class from settings_window.py"""

    def setup_method(self):
        """Setup method to ensure clean state for each test."""
        # Clear any previous imports to ensure coverage works
        import sys
        if 'settings_window' in sys.modules:
            del sys.modules['settings_window']

    @pytest.mark.unit
    def test_settings_dialog_import_and_class_exists(self):
        """Test that SettingsDialog class can be imported and exists."""
        import settings_window
        assert hasattr(settings_window, 'SettingsDialog')
        assert hasattr(settings_window, 'ENCRYPTION_AVAILABLE')

    @pytest.mark.unit
    def test_validate_numeric_settings_all_valid_values(self):
        """Test _validate_numeric_settings with all valid numeric values."""
        import settings_window
        
        # Create instance without calling __init__
        dialog = settings_window.SettingsDialog.__new__(settings_window.SettingsDialog)
        
        # Setup all required local_vars with valid values
        dialog.local_vars = {
            "selected_vid_var": Mock(),
            "selected_pid_var": Mock(),
            "target_interface_var": Mock(),
            "recording_check_interval_var": Mock(),
            "default_command_timeout_ms_var": Mock(),
            "file_stream_timeout_s_var": Mock(),
            "auto_refresh_interval_s_var": Mock()
        }
        
        # Set valid values within acceptable ranges
        dialog.local_vars["selected_vid_var"].get.return_value = "1234"  # VID: 0-65535
        dialog.local_vars["selected_pid_var"].get.return_value = "5678"  # PID: 0-65535
        dialog.local_vars["target_interface_var"].get.return_value = "0"  # Interface: 0-10
        dialog.local_vars["recording_check_interval_var"].get.return_value = "5"  # Interval: 1-3600
        dialog.local_vars["default_command_timeout_ms_var"].get.return_value = "1000"  # Timeout: 100-60000
        dialog.local_vars["file_stream_timeout_s_var"].get.return_value = "30"  # Stream: 1-300
        dialog.local_vars["auto_refresh_interval_s_var"].get.return_value = "10"  # Refresh: 1-3600
        
        # Test the validation method
        result = dialog._validate_numeric_settings()
        assert result is True

    @pytest.mark.unit
    def test_validate_numeric_settings_empty_value_fails(self):
        """Test _validate_numeric_settings fails with empty values."""
        import settings_window
        
        dialog = settings_window.SettingsDialog.__new__(settings_window.SettingsDialog)
        dialog.local_vars = {"selected_vid_var": Mock()}
        dialog.local_vars["selected_vid_var"].get.return_value = ""  # Empty string
        
        with patch('tkinter.messagebox.showerror') as mock_error:
            result = dialog._validate_numeric_settings()
            assert result is False
            mock_error.assert_called_once()

    @pytest.mark.unit
    def test_validate_numeric_settings_invalid_integer_fails(self):
        """Test _validate_numeric_settings fails with non-integer values."""
        import settings_window
        
        dialog = settings_window.SettingsDialog.__new__(settings_window.SettingsDialog)
        dialog.local_vars = {"selected_vid_var": Mock()}
        dialog.local_vars["selected_vid_var"].get.return_value = "abc"  # Non-integer
        
        with patch('tkinter.messagebox.showerror') as mock_error:
            result = dialog._validate_numeric_settings()
            assert result is False
            mock_error.assert_called_once()

    @pytest.mark.unit
    def test_validate_numeric_settings_out_of_range_fails(self):
        """Test _validate_numeric_settings fails with out-of-range values."""
        import settings_window
        
        dialog = settings_window.SettingsDialog.__new__(settings_window.SettingsDialog)
        dialog.local_vars = {"selected_vid_var": Mock()}
        dialog.local_vars["selected_vid_var"].get.return_value = "99999"  # Too large for VID (max 65535)
        
        with patch('tkinter.messagebox.showerror') as mock_error:
            result = dialog._validate_numeric_settings()
            assert result is False
            mock_error.assert_called_once()

    @pytest.mark.unit
    def test_update_model_list_gemini_provider(self):
        """Test _update_model_list with Gemini provider."""
        import settings_window
        
        dialog = settings_window.SettingsDialog.__new__(settings_window.SettingsDialog)
        dialog.local_vars = {
            "ai_api_provider_var": Mock(),
            "ai_model_var": Mock()
        }
        dialog.model_combobox = Mock()
        
        # Test Gemini provider
        dialog.local_vars["ai_api_provider_var"].get.return_value = "gemini"
        dialog.local_vars["ai_model_var"].get.return_value = "old-model"
        
        dialog._update_model_list()
        
        # Verify model combobox was configured with Gemini models
        dialog.model_combobox.configure.assert_called()
        call_args = dialog.model_combobox.configure.call_args[1]
        assert "gemini-2.5-flash" in call_args["values"]
        assert "gemini-1.5-pro" in call_args["values"]

    @pytest.mark.unit
    def test_update_model_list_openai_provider(self):
        """Test _update_model_list with OpenAI provider."""
        import settings_window
        
        dialog = settings_window.SettingsDialog.__new__(settings_window.SettingsDialog)
        dialog.local_vars = {
            "ai_api_provider_var": Mock(),
            "ai_model_var": Mock()
        }
        dialog.model_combobox = Mock()
        
        # Test OpenAI provider
        dialog.local_vars["ai_api_provider_var"].get.return_value = "openai"
        dialog.local_vars["ai_model_var"].get.return_value = "old-model"
        
        dialog._update_model_list()
        
        # Verify model combobox was configured with OpenAI models
        dialog.model_combobox.configure.assert_called()
        call_args = dialog.model_combobox.configure.call_args[1]
        assert "gpt-4o" in call_args["values"]
        assert "whisper-1" in call_args["values"]

    @pytest.mark.unit
    def test_update_temperature_label_various_values(self):
        """Test _update_temperature_label with various temperature values."""
        import settings_window
        
        dialog = settings_window.SettingsDialog.__new__(settings_window.SettingsDialog)
        dialog.local_vars = {"ai_temperature_var": Mock()}
        dialog.temperature_label = Mock()
        
        # Test different temperature values
        test_temperatures = [0.0, 0.3, 0.75, 1.0]
        
        for temp in test_temperatures:
            dialog.local_vars["ai_temperature_var"].get.return_value = temp
            dialog._update_temperature_label()
            dialog.temperature_label.configure.assert_called_with(text=f"{temp:.2f}")

    @pytest.mark.unit
    def test_encrypt_api_key_no_encryption_available(self):
        """Test _encrypt_api_key when encryption is not available."""
        import settings_window
        
        dialog = settings_window.SettingsDialog.__new__(settings_window.SettingsDialog)
        
        # Test with encryption unavailable
        with patch.object(settings_window, 'ENCRYPTION_AVAILABLE', False):
            result = dialog._encrypt_api_key("test-api-key")
            assert result == "test-api-key"  # Should return plaintext

    @pytest.mark.unit
    def test_decrypt_api_key_no_encryption_available(self):
        """Test _decrypt_api_key when encryption is not available."""
        import settings_window
        
        dialog = settings_window.SettingsDialog.__new__(settings_window.SettingsDialog)
        
        # Test with encryption unavailable
        with patch.object(settings_window, 'ENCRYPTION_AVAILABLE', False):
            result = dialog._decrypt_api_key("encrypted-data")
            assert result == "encrypted-data"  # Should return as-is

    @pytest.mark.unit
    def test_generate_encryption_key_no_encryption(self):
        """Test _generate_encryption_key when encryption is not available."""
        import settings_window
        
        dialog = settings_window.SettingsDialog.__new__(settings_window.SettingsDialog)
        
        # Test with encryption unavailable
        with patch.object(settings_window, 'ENCRYPTION_AVAILABLE', False):
            result = dialog._generate_encryption_key()
            assert result is None

    @pytest.mark.unit
    def test_ok_action_with_changes(self):
        """Test _ok_action when settings have changed."""
        import settings_window
        
        dialog = settings_window.SettingsDialog.__new__(settings_window.SettingsDialog)
        dialog.settings_changed_tracker = [True]  # Changes detected
        dialog.destroy = Mock()
        dialog._perform_apply_settings_logic = Mock()
        
        dialog._ok_action()
        
        # Should apply settings and destroy dialog
        dialog._perform_apply_settings_logic.assert_called_once_with(update_dialog_baseline=False)
        dialog.destroy.assert_called_once()

    @pytest.mark.unit
    def test_ok_action_no_changes(self):
        """Test _ok_action when no settings have changed."""
        import settings_window
        
        dialog = settings_window.SettingsDialog.__new__(settings_window.SettingsDialog)
        dialog.settings_changed_tracker = [False]  # No changes
        dialog.destroy = Mock()
        dialog._perform_apply_settings_logic = Mock()
        
        dialog._ok_action()
        
        # Should not apply settings but should destroy dialog
        dialog._perform_apply_settings_logic.assert_not_called()
        dialog.destroy.assert_called_once()

    @pytest.mark.unit
    def test_validation_complete_success(self):
        """Test _validation_complete with successful validation."""
        import settings_window
        
        dialog = settings_window.SettingsDialog.__new__(settings_window.SettingsDialog)
        dialog.api_key_status_label = Mock()
        dialog.validate_key_button = Mock()
        
        dialog._validation_complete(True)
        
        # Should show success status
        dialog.api_key_status_label.configure.assert_called_with(
            text="Status: Valid API key", text_color="green"
        )
        dialog.validate_key_button.configure.assert_called_with(state="normal")

    @pytest.mark.unit
    def test_validation_complete_failure(self):
        """Test _validation_complete with failed validation."""
        import settings_window
        
        dialog = settings_window.SettingsDialog.__new__(settings_window.SettingsDialog)
        dialog.api_key_status_label = Mock()
        dialog.validate_key_button = Mock()
        
        dialog._validation_complete(False)
        
        # Should show failure status
        dialog.api_key_status_label.configure.assert_called_with(
            text="Status: Invalid API key", text_color="red"
        )
        dialog.validate_key_button.configure.assert_called_with(state="normal")

    @pytest.mark.unit
    def test_update_color_preview_widget_valid_color(self):
        """Test _update_color_preview_widget with valid hex color."""
        import settings_window
        
        dialog = settings_window.SettingsDialog.__new__(settings_window.SettingsDialog)
        dialog.parent_gui = Mock()
        dialog.parent_gui.apply_appearance_mode_theme_color.return_value = "#808080"
        
        mock_frame = Mock()
        mock_frame.winfo_exists.return_value = True
        mock_color_var = Mock()
        mock_color_var.get.return_value = "#FF0000"  # Valid red color
        
        dialog._update_color_preview_widget(mock_frame, mock_color_var)
        
        # Should configure frame with the valid color
        mock_frame.configure.assert_called_with(fg_color="#FF0000")

    @pytest.mark.unit
    def test_update_color_preview_widget_invalid_color(self):
        """Test _update_color_preview_widget with invalid color."""
        import settings_window
        
        dialog = settings_window.SettingsDialog.__new__(settings_window.SettingsDialog)
        dialog.parent_gui = Mock()
        dialog.parent_gui.apply_appearance_mode_theme_color.return_value = "#808080"
        
        mock_frame = Mock()
        mock_frame.winfo_exists.return_value = True
        mock_color_var = Mock()
        mock_color_var.get.return_value = "invalid-color"  # Invalid color
        
        dialog._update_color_preview_widget(mock_frame, mock_color_var)
        
        # Should configure frame with fallback color
        mock_frame.configure.assert_called_with(fg_color="#808080")

    @pytest.mark.unit
    def test_update_provider_config_ollama(self):
        """Test _update_provider_config with Ollama provider."""
        import settings_window
        
        dialog = settings_window.SettingsDialog.__new__(settings_window.SettingsDialog)
        dialog.local_vars = {"ai_api_provider_var": Mock()}
        
        # Mock all provider frames
        dialog.openrouter_frame = Mock()
        dialog.amazon_frame = Mock()
        dialog.qwen_frame = Mock()
        dialog.deepseek_frame = Mock()
        dialog.ollama_frame = Mock()
        dialog.lmstudio_frame = Mock()
        
        # Test Ollama provider
        dialog.local_vars["ai_api_provider_var"].get.return_value = "ollama"
        
        dialog._update_provider_config()
        
        # Should show Ollama frame and hide others
        dialog.ollama_frame.pack.assert_called()
        dialog.openrouter_frame.pack_forget.assert_called()
        dialog.amazon_frame.pack_forget.assert_called()

    @pytest.mark.unit
    def test_select_download_dir_action_success(self):
        """Test _select_download_dir_action with successful directory selection."""
        import settings_window
        
        dialog = settings_window.SettingsDialog.__new__(settings_window.SettingsDialog)
        dialog.current_dialog_download_dir = ["/old/path"]
        dialog.current_dl_dir_label_settings = Mock()
        dialog.current_dl_dir_label_settings.winfo_exists.return_value = True
        dialog._auto_save_settings = Mock()
        
        # Mock successful directory selection
        with patch('tkinter.filedialog.askdirectory', return_value="/new/path"):
            dialog._select_download_dir_action()
            
            # Should update directory and UI
            assert dialog.current_dialog_download_dir[0] == "/new/path"
            dialog.current_dl_dir_label_settings.configure.assert_called_with(text="/new/path")
            dialog._auto_save_settings.assert_called_once()

    @pytest.mark.unit
    def test_select_download_dir_action_cancelled(self):
        """Test _select_download_dir_action when user cancels."""
        import settings_window
        
        dialog = settings_window.SettingsDialog.__new__(settings_window.SettingsDialog)
        dialog.current_dialog_download_dir = ["/old/path"]
        dialog.current_dl_dir_label_settings = Mock()
        dialog._update_button_states_on_change = Mock()
        
        # Mock cancelled directory selection
        with patch('tkinter.filedialog.askdirectory', return_value=""):
            dialog._select_download_dir_action()
            
            # Should not change directory
            assert dialog.current_dialog_download_dir[0] == "/old/path"
            dialog._update_button_states_on_change.assert_not_called()

    @pytest.mark.unit
    def test_reset_download_dir_action(self):
        """Test _reset_download_dir_action."""
        import settings_window
        
        dialog = settings_window.SettingsDialog.__new__(settings_window.SettingsDialog)
        dialog.current_dialog_download_dir = ["/old/path"]
        dialog.current_dl_dir_label_settings = Mock()
        dialog.current_dl_dir_label_settings.winfo_exists.return_value = True
        dialog._auto_save_settings = Mock()
        
        # Mock current working directory
        with patch('os.getcwd', return_value="/default/path"):
            dialog._reset_download_dir_action()
            
            # Should reset to default directory
            assert dialog.current_dialog_download_dir[0] == "/default/path"
            dialog.current_dl_dir_label_settings.configure.assert_called_with(text="/default/path")
            dialog._auto_save_settings.assert_called_once()

    @pytest.mark.unit
    def test_validate_api_key_empty_key(self):
        """Test _validate_api_key with empty API key."""
        import settings_window
        
        dialog = settings_window.SettingsDialog.__new__(settings_window.SettingsDialog)
        dialog.api_key_entry = Mock()
        dialog.api_key_status_label = Mock()
        dialog.validate_key_button = Mock()
        dialog.local_vars = {"ai_api_provider_var": Mock()}
        
        # Mock empty API key
        dialog.api_key_entry.get.return_value = ""
        
        dialog._validate_api_key()
        
        # Should show error status
        dialog.api_key_status_label.configure.assert_called_with(
            text="Status: Please enter an API key", text_color="red"
        )

    @pytest.mark.unit
    def test_validate_api_key_with_key(self):
        """Test _validate_api_key with valid API key."""
        import settings_window
        
        dialog = settings_window.SettingsDialog.__new__(settings_window.SettingsDialog)
        dialog.api_key_entry = Mock()
        dialog.api_key_status_label = Mock()
        dialog.validate_key_button = Mock()
        dialog.local_vars = {"ai_api_provider_var": Mock()}
        
        # Mock valid API key
        dialog.api_key_entry.get.return_value = "test-api-key"
        dialog.local_vars["ai_api_provider_var"].get.return_value = "gemini"
        
        with patch('threading.Thread') as mock_thread:
            dialog._validate_api_key()
            
            # Should start validation thread and disable button
            mock_thread.assert_called_once()
            dialog.validate_key_button.configure.assert_called_with(state="disabled")
            dialog.api_key_status_label.configure.assert_called_with(
                text="Status: Validating...", text_color="blue"
            )

    @pytest.mark.unit
    def test_on_device_selected_enhanced(self):
        """Test _on_device_selected_enhanced method."""
        import settings_window
        
        dialog = settings_window.SettingsDialog.__new__(settings_window.SettingsDialog)
        dialog.local_vars = {
            "selected_vid_var": Mock(),
            "selected_pid_var": Mock()
        }
        dialog._auto_save_settings = Mock()
        
        # Mock device info
        mock_device_info = Mock()
        mock_device_info.name = "Test HiDock Device"
        mock_device_info.vendor_id = 1234
        mock_device_info.product_id = 5678
        
        with patch('settings_window.logger'):
            dialog._on_device_selected_enhanced(mock_device_info)
            
            # Should update VID/PID and auto-save
            dialog.local_vars["selected_vid_var"].set.assert_called_with("1234")
            dialog.local_vars["selected_pid_var"].set.assert_called_with("5678")
            dialog._auto_save_settings.assert_called_once()


if __name__ == "__main__":
    pytest.main([__file__, "-v"])