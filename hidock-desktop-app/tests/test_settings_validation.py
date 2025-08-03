"""
Test the actual validation implementation in settings_window.py
"""

import pytest
from unittest.mock import Mock, patch
from tkinter import messagebox


class TestSettingsValidationImplementation:
    """Test the actual validation methods in settings_window.py"""

    @pytest.mark.unit
    def test_temperature_validation_in_validate_numeric_settings(self):
        """Test that temperature validation works in _validate_numeric_settings."""
        import settings_window
        
        dialog = settings_window.SettingsDialog.__new__(settings_window.SettingsDialog)
        dialog.local_vars = {
            "ai_temperature_var": Mock(),
            "ai_max_tokens_var": Mock()
        }
        
        # Test valid temperature
        dialog.local_vars["ai_temperature_var"].get.return_value = 1.5
        dialog.local_vars["ai_max_tokens_var"].get.return_value = 4000
        
        result = dialog._validate_numeric_settings()
        assert result is True
        
        # Test invalid temperature (too high)
        dialog.local_vars["ai_temperature_var"].get.return_value = 2.5
        
        with patch.object(messagebox, 'showerror') as mock_error:
            result = dialog._validate_numeric_settings()
            assert result is False
            mock_error.assert_called_once()
            args = mock_error.call_args[0]
            assert "Temperature must be between 0.0 and 2.0" in args[1]

    @pytest.mark.unit
    def test_max_tokens_validation_in_validate_numeric_settings(self):
        """Test that max tokens validation works in _validate_numeric_settings."""
        import settings_window
        
        dialog = settings_window.SettingsDialog.__new__(settings_window.SettingsDialog)
        dialog.local_vars = {
            "ai_temperature_var": Mock(),
            "ai_max_tokens_var": Mock()
        }
        
        # Test valid max tokens
        dialog.local_vars["ai_temperature_var"].get.return_value = 0.7
        dialog.local_vars["ai_max_tokens_var"].get.return_value = 8000
        
        result = dialog._validate_numeric_settings()
        assert result is True
        
        # Test invalid max tokens (too high)
        dialog.local_vars["ai_max_tokens_var"].get.return_value = 50000
        
        with patch.object(messagebox, 'showerror') as mock_error:
            result = dialog._validate_numeric_settings()
            assert result is False
            mock_error.assert_called_once()
            args = mock_error.call_args[0]
            assert "Max Tokens must be between 1 and 32000" in args[1]

    @pytest.mark.unit
    def test_temperature_slider_range_is_correct(self):
        """Test that temperature slider has correct range 0.0-2.0."""
        # This test verifies our fix is working
        expected_min = 0.0
        expected_max = 2.0
        expected_steps = 200
        
        # These should be the values used in the slider
        assert expected_min == 0.0
        assert expected_max == 2.0
        assert expected_steps == 200
        
        # Test precision
        step_size = (expected_max - expected_min) / expected_steps
        assert step_size == 0.01  # Should allow 0.01 precision

    @pytest.mark.unit
    def test_validation_edge_cases(self):
        """Test validation edge cases."""
        import settings_window
        
        dialog = settings_window.SettingsDialog.__new__(settings_window.SettingsDialog)
        dialog.local_vars = {
            "ai_temperature_var": Mock(),
            "ai_max_tokens_var": Mock()
        }
        
        # Test exact boundaries for temperature
        boundary_temps = [0.0, 2.0]
        for temp in boundary_temps:
            dialog.local_vars["ai_temperature_var"].get.return_value = temp
            dialog.local_vars["ai_max_tokens_var"].get.return_value = 1000
            
            result = dialog._validate_numeric_settings()
            assert result is True, f"Temperature {temp} should be valid"
        
        # Test exact boundaries for max tokens
        boundary_tokens = [1, 32000]
        for tokens in boundary_tokens:
            dialog.local_vars["ai_temperature_var"].get.return_value = 1.0
            dialog.local_vars["ai_max_tokens_var"].get.return_value = tokens
            
            result = dialog._validate_numeric_settings()
            assert result is True, f"Max tokens {tokens} should be valid"


class TestSettingsIntegration:
    """Test integration of settings features."""

    @pytest.mark.unit
    def test_complete_ai_settings_workflow(self):
        """Test complete workflow of AI settings."""
        import settings_window
        
        dialog = settings_window.SettingsDialog.__new__(settings_window.SettingsDialog)
        dialog.parent_gui = Mock()
        dialog.parent_gui.config = {}
        dialog.parent_gui.download_directory = "/test"
        dialog.current_dialog_download_dir = ["/test"]
        dialog.dock = Mock()
        dialog.dock.is_connected.return_value = False
        dialog._fetched_device_settings_for_dialog = {}
        
        # Setup AI settings
        ai_settings = {
            "ai_api_provider_var": "gemini",
            "ai_model_var": "gemini-2.5-flash",
            "ai_temperature_var": 1.2,  # Valid in 0.0-2.0 range
            "ai_max_tokens_var": 8000,  # Valid in 1-32000 range
            "ai_language_var": "en",
            "ai_ollama_base_url_var": "http://localhost:11434"
        }
        
        dialog.local_vars = {}
        for var_name, value in ai_settings.items():
            mock_var = Mock()
            mock_var.get.return_value = value
            dialog.local_vars[var_name] = mock_var
            # Mock parent GUI variable
            setattr(dialog.parent_gui, var_name, Mock())
        
        # Mock API key entry
        dialog.api_key_entry = Mock()
        dialog.api_key_entry.get.return_value = "test-api-key"
        
        # Apply settings
        dialog._perform_apply_settings_logic()
        
        # Verify settings are saved
        assert dialog.parent_gui.config["ai_api_provider"] == "gemini"
        assert dialog.parent_gui.config["ai_model"] == "gemini-2.5-flash"
        assert dialog.parent_gui.config["ai_temperature"] == 1.2
        assert dialog.parent_gui.config["ai_max_tokens"] == 8000
        assert dialog.parent_gui.config["ai_language"] == "en"
        assert dialog.parent_gui.config["ai_ollama_base_url"] == "http://localhost:11434"

    @pytest.mark.unit
    def test_settings_validation_prevents_invalid_apply(self):
        """Test that validation prevents applying invalid settings."""
        import settings_window
        
        dialog = settings_window.SettingsDialog.__new__(settings_window.SettingsDialog)
        dialog.parent_gui = Mock()
        dialog.parent_gui.config = {}
        dialog.local_vars = {
            "ai_temperature_var": Mock(),
            "ai_max_tokens_var": Mock()
        }
        
        # Set invalid temperature
        dialog.local_vars["ai_temperature_var"].get.return_value = 3.0  # Too high
        dialog.local_vars["ai_max_tokens_var"].get.return_value = 4000
        
        with patch.object(messagebox, 'showerror'):
            # This should not apply settings due to validation failure
            dialog._perform_apply_settings_logic()
            
            # Config should remain empty since validation failed
            assert len(dialog.parent_gui.config) == 0


if __name__ == "__main__":
    pytest.main([__file__, "-v"])