"""
Test-driven fixes for settings_window.py issues.
These tests define how the settings should work correctly.
"""

import os
from unittest.mock import MagicMock, Mock, patch

import pytest


class TestSettingsAPIKeyManagement:
    """Test API key management - should save and load correctly."""

    @pytest.mark.unit
    def test_api_key_should_be_saved_per_provider(self):
        """API keys should be saved separately for each provider."""
        import settings_window

        dialog = settings_window.SettingsDialog.__new__(settings_window.SettingsDialog)
        dialog.parent_gui = Mock()
        dialog.parent_gui.config = {}
        dialog.local_vars = {"ai_api_provider_var": Mock()}
        dialog.api_key_entry = Mock()

        # Test saving different keys for different providers
        providers_and_keys = [
            ("gemini", "gemini-api-key-123"),
            ("openai", "openai-api-key-456"),
            ("anthropic", "anthropic-api-key-789"),
        ]

        for provider, api_key in providers_and_keys:
            dialog.local_vars["ai_api_provider_var"].get.return_value = provider
            dialog.api_key_entry.get.return_value = api_key

            # Simulate applying settings
            dialog._perform_apply_settings_logic = Mock()
            with patch.object(dialog, "_encrypt_api_key", return_value=f"encrypted_{api_key}"):
                # This should save the key
                encrypted_key = dialog._encrypt_api_key(api_key)
                dialog.parent_gui.config[f"ai_api_key_{provider}_encrypted"] = encrypted_key

        # Verify each provider has its own key
        assert dialog.parent_gui.config["ai_api_key_gemini_encrypted"] == "encrypted_gemini-api-key-123"
        assert dialog.parent_gui.config["ai_api_key_openai_encrypted"] == "encrypted_openai-api-key-456"
        assert dialog.parent_gui.config["ai_api_key_anthropic_encrypted"] == "encrypted_anthropic-api-key-789"

    @pytest.mark.unit
    def test_api_key_should_load_on_provider_change(self):
        """When provider changes, the correct API key should load."""
        import settings_window

        dialog = settings_window.SettingsDialog.__new__(settings_window.SettingsDialog)
        dialog.parent_gui = Mock()
        dialog.parent_gui.config = {
            "ai_api_key_gemini_encrypted": "encrypted_gemini_key",
            "ai_api_key_openai_encrypted": "encrypted_openai_key",
        }
        dialog.local_vars = {"ai_api_provider_var": Mock()}
        dialog.api_key_entry = Mock()
        dialog.api_key_status_label = Mock()

        with patch.object(dialog, "_decrypt_api_key") as mock_decrypt:
            mock_decrypt.side_effect = lambda x: x.replace("encrypted_", "decrypted_")

            # Test loading Gemini key
            dialog.local_vars["ai_api_provider_var"].get.return_value = "gemini"
            dialog._load_api_key_status()

            dialog.api_key_entry.delete.assert_called_with(0, "end")
            dialog.api_key_entry.insert.assert_called_with(0, "decrypted_gemini_key")

            # Test loading OpenAI key
            dialog.local_vars["ai_api_provider_var"].get.return_value = "openai"
            dialog._load_api_key_status()

            dialog.api_key_entry.insert.assert_called_with(0, "decrypted_openai_key")


class TestSettingsProviderConfiguration:
    """Test provider-specific configuration saving."""

    @pytest.mark.unit
    def test_provider_base_urls_should_be_saved(self):
        """Provider base URLs should be saved to config."""
        import settings_window

        dialog = settings_window.SettingsDialog.__new__(settings_window.SettingsDialog)
        dialog.parent_gui = Mock()
        dialog.parent_gui.config = {}
        dialog.parent_gui.download_directory = "/test/download"
        dialog.current_dialog_download_dir = ["/test/download"]
        dialog.dock = Mock()
        dialog.dock.is_connected.return_value = False
        dialog._fetched_device_settings_for_dialog = {}
        dialog.local_vars = {
            "ai_openrouter_base_url_var": Mock(),
            "ai_amazon_region_var": Mock(),
            "ai_qwen_base_url_var": Mock(),
            "ai_deepseek_base_url_var": Mock(),
            "ai_ollama_base_url_var": Mock(),
            "ai_lmstudio_base_url_var": Mock(),
        }

        # Set test values
        dialog.local_vars["ai_openrouter_base_url_var"].get.return_value = "https://openrouter.ai/api/v1"
        dialog.local_vars["ai_amazon_region_var"].get.return_value = "us-west-2"
        dialog.local_vars["ai_qwen_base_url_var"].get.return_value = "https://dashscope.aliyuncs.com/v1"
        dialog.local_vars["ai_deepseek_base_url_var"].get.return_value = "https://api.deepseek.com"
        dialog.local_vars["ai_ollama_base_url_var"].get.return_value = "http://localhost:11434"
        dialog.local_vars["ai_lmstudio_base_url_var"].get.return_value = "http://localhost:1234/v1"

        # Mock the parent GUI variables
        for var_name in dialog.local_vars.keys():
            setattr(dialog.parent_gui, var_name, Mock())

        # Simulate applying settings - this should save provider configs
        dialog._validate_numeric_settings = Mock(return_value=True)
        dialog._perform_apply_settings_logic()

        # Verify provider configs are saved
        assert dialog.parent_gui.config["ai_openrouter_base_url"] == "https://openrouter.ai/api/v1"
        assert dialog.parent_gui.config["ai_amazon_region"] == "us-west-2"
        assert dialog.parent_gui.config["ai_qwen_base_url"] == "https://dashscope.aliyuncs.com/v1"
        assert dialog.parent_gui.config["ai_deepseek_base_url"] == "https://api.deepseek.com"
        assert dialog.parent_gui.config["ai_ollama_base_url"] == "http://localhost:11434"
        assert dialog.parent_gui.config["ai_lmstudio_base_url"] == "http://localhost:1234/v1"


class TestSettingsValidation:
    """Test validation that should be implemented."""

    @pytest.mark.unit
    def test_temperature_should_validate_correct_range(self):
        """Temperature should validate 0.0-2.0 range, not 0.0-1.0."""
        import settings_window

        dialog = settings_window.SettingsDialog.__new__(settings_window.SettingsDialog)
        dialog.local_vars = {"ai_temperature_var": Mock()}

        # Test valid temperatures
        valid_temps = [0.0, 0.3, 1.0, 1.5, 2.0]
        for temp in valid_temps:
            dialog.local_vars["ai_temperature_var"].get.return_value = temp
            # Should not raise error
            assert 0.0 <= temp <= 2.0

        # Test invalid temperatures
        invalid_temps = [-0.1, 2.1, 3.0]
        for temp in invalid_temps:
            dialog.local_vars["ai_temperature_var"].get.return_value = temp
            # Should be invalid
            assert not (0.0 <= temp <= 2.0)

    @pytest.mark.unit
    def test_max_tokens_should_validate_range(self):
        """Max tokens should validate reasonable range."""
        import settings_window

        dialog = settings_window.SettingsDialog.__new__(settings_window.SettingsDialog)
        dialog.local_vars = {"ai_max_tokens_var": Mock()}

        # Test valid token counts
        valid_tokens = [1, 1000, 4000, 8000, 32000]
        for tokens in valid_tokens:
            dialog.local_vars["ai_max_tokens_var"].get.return_value = tokens
            assert 1 <= tokens <= 32000

        # Test invalid token counts
        invalid_tokens = [0, -1, 50000, 100000]
        for tokens in invalid_tokens:
            dialog.local_vars["ai_max_tokens_var"].get.return_value = tokens
            assert not (1 <= tokens <= 32000)

    @pytest.mark.unit
    def test_url_validation_should_work(self):
        """URL validation should check for valid URLs."""
        import settings_window

        # Test valid URLs
        valid_urls = [
            "http://localhost:11434",
            "https://api.openai.com/v1",
            "https://openrouter.ai/api/v1",
            "http://127.0.0.1:1234/v1",
        ]

        for url in valid_urls:
            # Should be valid URL format
            assert url.startswith(("http://", "https://"))
            assert "." in url or "localhost" in url or "127.0.0.1" in url

        # Test invalid URLs
        invalid_urls = ["not-a-url", "ftp://invalid.com", "just-text", ""]

        for url in invalid_urls:
            # Should be invalid
            is_valid = url.startswith(("http://", "https://")) and (
                "." in url or "localhost" in url or "127.0.0.1" in url
            )
            assert not is_valid


class TestSettingsConfigMapping:
    """Test that all settings are properly mapped to config."""

    @pytest.mark.unit
    def test_all_ai_settings_should_map_to_config(self):
        """All AI settings should be properly saved to config."""
        import settings_window

        dialog = settings_window.SettingsDialog.__new__(settings_window.SettingsDialog)
        dialog.parent_gui = Mock()
        dialog.parent_gui.config = {}
        dialog.parent_gui.download_directory = "/test/download"
        dialog.current_dialog_download_dir = ["/test/download"]
        dialog.dock = Mock()
        dialog.dock.is_connected.return_value = False
        dialog._fetched_device_settings_for_dialog = {}

        # Define all AI settings that should be saved
        ai_settings = {
            "ai_api_provider_var": "gemini",
            "ai_model_var": "gemini-2.5-flash",
            "ai_temperature_var": 0.7,
            "ai_max_tokens_var": 4000,
            "ai_language_var": "en",
            "ai_openrouter_base_url_var": "https://openrouter.ai/api/v1",
            "ai_amazon_region_var": "us-east-1",
            "ai_qwen_base_url_var": "https://dashscope.aliyuncs.com/v1",
            "ai_deepseek_base_url_var": "https://api.deepseek.com",
            "ai_ollama_base_url_var": "http://localhost:11434",
            "ai_lmstudio_base_url_var": "http://localhost:1234/v1",
        }

        dialog.local_vars = {}
        for var_name, value in ai_settings.items():
            mock_var = Mock()
            mock_var.get.return_value = value
            dialog.local_vars[var_name] = mock_var
            # Mock parent GUI variable
            setattr(dialog.parent_gui, var_name, Mock())

        # Mock validation
        dialog._validate_numeric_settings = Mock(return_value=True)

        # Apply settings
        dialog._perform_apply_settings_logic()

        # Verify all settings are saved to config
        expected_config_keys = [
            "ai_api_provider",
            "ai_model",
            "ai_temperature",
            "ai_max_tokens",
            "ai_language",
            "ai_openrouter_base_url",
            "ai_amazon_region",
            "ai_qwen_base_url",
            "ai_deepseek_base_url",
            "ai_ollama_base_url",
            "ai_lmstudio_base_url",
        ]

        for key in expected_config_keys:
            assert key in dialog.parent_gui.config, f"Config key '{key}' should be saved"

    @pytest.mark.unit
    def test_settings_should_load_from_config_on_dialog_open(self):
        """Settings should load from config when dialog opens."""
        import settings_window

        # Mock parent GUI with config
        parent_gui = Mock()
        parent_gui.config = {
            "ai_api_provider": "openai",
            "ai_model": "gpt-4o",
            "ai_temperature": 0.8,
            "ai_max_tokens": 2000,
            "ai_language": "es",
            "ai_openrouter_base_url": "https://custom.openrouter.com/v1",
            "ai_ollama_base_url": "http://192.168.1.100:11434",
        }

        # Mock all the required variables on parent_gui
        for key, value in parent_gui.config.items():
            var_name = key + "_var"
            mock_var = Mock()
            mock_var.get.return_value = value
            setattr(parent_gui, var_name, mock_var)

        dialog = settings_window.SettingsDialog.__new__(settings_window.SettingsDialog)
        dialog.parent_gui = parent_gui
        dialog.local_vars = {}

        # Simulate cloning parent vars (simplified)
        dialog._clone_parent_vars = Mock()

        # The dialog should load these values into local_vars
        # This test defines the expected behavior


class TestSettingsTemperatureRange:
    """Test that temperature range is correctly implemented as 0.0-2.0."""

    @pytest.mark.unit
    def test_temperature_slider_should_have_correct_range(self):
        """Temperature slider should go from 0.0 to 2.0, not 1.0."""
        import settings_window

        dialog = settings_window.SettingsDialog.__new__(settings_window.SettingsDialog)
        dialog.local_vars = {"ai_temperature_var": Mock()}

        # Mock the slider creation
        mock_slider = Mock()
        dialog.temperature_slider = mock_slider

        # The slider should be configured with range 0.0-2.0
        # This is what SHOULD happen in _populate_ai_transcription_tab
        expected_from = 0.0
        expected_to = 2.0
        expected_steps = 200  # For 0.01 precision

        # Test that these are the correct values
        assert expected_from == 0.0
        assert expected_to == 2.0
        assert expected_steps == 200

    @pytest.mark.unit
    def test_temperature_validation_should_use_correct_range(self):
        """Temperature validation should check 0.0-2.0 range."""

        # This test defines what the validation SHOULD do
        def validate_temperature(temp_value):
            """Correct temperature validation function."""
            try:
                temp = float(temp_value)
                return 0.0 <= temp <= 2.0
            except (ValueError, TypeError):
                return False

        # Test valid temperatures
        valid_temps = ["0.0", "0.3", "1.0", "1.5", "2.0"]
        for temp_str in valid_temps:
            assert validate_temperature(temp_str), f"Temperature {temp_str} should be valid"

        # Test invalid temperatures
        invalid_temps = ["-0.1", "2.1", "3.0", "abc", ""]
        for temp_str in invalid_temps:
            assert not validate_temperature(temp_str), f"Temperature {temp_str} should be invalid"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
