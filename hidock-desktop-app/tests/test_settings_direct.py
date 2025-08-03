"""
Direct test of settings_window.py to ensure coverage is captured.
"""

import pytest
from unittest.mock import Mock, patch


@pytest.mark.unit
def test_settings_window_import():
    """Test that settings_window can be imported."""
    import settings_window
    assert hasattr(settings_window, 'SettingsDialog')


@pytest.mark.unit
def test_settings_dialog_validate_numeric_method():
    """Test the _validate_numeric_settings method directly."""
    import settings_window
    
    # Create instance without calling __init__
    dialog = settings_window.SettingsDialog.__new__(settings_window.SettingsDialog)
    
    # Mock the required attributes
    dialog.local_vars = {
        "selected_vid_var": Mock(),
        "selected_pid_var": Mock(),
        "target_interface_var": Mock(),
        "recording_check_interval_var": Mock(),
        "default_command_timeout_ms_var": Mock(),
        "file_stream_timeout_s_var": Mock(),
        "auto_refresh_interval_s_var": Mock()
    }
    
    # Set valid values
    dialog.local_vars["selected_vid_var"].get.return_value = "1234"
    dialog.local_vars["selected_pid_var"].get.return_value = "5678"
    dialog.local_vars["target_interface_var"].get.return_value = "0"
    dialog.local_vars["recording_check_interval_var"].get.return_value = "5"
    dialog.local_vars["default_command_timeout_ms_var"].get.return_value = "1000"
    dialog.local_vars["file_stream_timeout_s_var"].get.return_value = "30"
    dialog.local_vars["auto_refresh_interval_s_var"].get.return_value = "10"
    
    # Test the method
    result = dialog._validate_numeric_settings()
    assert result is True


@pytest.mark.unit
def test_settings_dialog_update_model_list():
    """Test the _update_model_list method."""
    import settings_window
    
    dialog = settings_window.SettingsDialog.__new__(settings_window.SettingsDialog)
    dialog.local_vars = {
        "ai_api_provider_var": Mock(),
        "ai_model_var": Mock()
    }
    dialog.model_combobox = Mock()
    
    # Test with gemini provider
    dialog.local_vars["ai_api_provider_var"].get.return_value = "gemini"
    dialog.local_vars["ai_model_var"].get.return_value = "old-model"
    
    dialog._update_model_list()
    
    # Verify the method was called
    dialog.model_combobox.configure.assert_called()


@pytest.mark.unit
def test_settings_dialog_encrypt_api_key():
    """Test the _encrypt_api_key method."""
    import settings_window
    
    dialog = settings_window.SettingsDialog.__new__(settings_window.SettingsDialog)
    
    # Test without encryption available
    with patch.object(settings_window, 'ENCRYPTION_AVAILABLE', False):
        result = dialog._encrypt_api_key("test-key")
        assert result == "test-key"


@pytest.mark.unit
def test_settings_dialog_decrypt_api_key():
    """Test the _decrypt_api_key method."""
    import settings_window
    
    dialog = settings_window.SettingsDialog.__new__(settings_window.SettingsDialog)
    
    # Test without encryption available
    with patch.object(settings_window, 'ENCRYPTION_AVAILABLE', False):
        result = dialog._decrypt_api_key("encrypted-key")
        assert result == "encrypted-key"


@pytest.mark.unit
def test_settings_dialog_ok_action():
    """Test the _ok_action method."""
    import settings_window
    
    dialog = settings_window.SettingsDialog.__new__(settings_window.SettingsDialog)
    dialog.settings_changed_tracker = [True]
    dialog.destroy = Mock()
    dialog._perform_apply_settings_logic = Mock()
    
    dialog._ok_action()
    
    dialog._perform_apply_settings_logic.assert_called_once_with(update_dialog_baseline=False)
    dialog.destroy.assert_called_once()


if __name__ == "__main__":
    pytest.main([__file__, "-v"])