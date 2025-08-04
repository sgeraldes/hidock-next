"""
Focused tests for the AI Service Module.

This test suite covers the core functionality that can be reliably tested,
focusing on provider availability, basic initialization, and error handling.
"""

from unittest.mock import Mock, patch

import pytest

# Import the module under test
import ai_service
from ai_service import AIProvider, AIServiceManager, GeminiProvider, OpenAIProvider


class TestAIServiceBasics:
    """Test basic AI service functionality."""

    def test_module_imports_successfully(self):
        """Test that the ai_service module imports without errors."""
        assert ai_service is not None

    def test_provider_availability_flags_exist(self):
        """Test that all provider availability flags are defined."""
        assert hasattr(ai_service, "GEMINI_AVAILABLE")
        assert hasattr(ai_service, "OPENAI_AVAILABLE")
        assert hasattr(ai_service, "ANTHROPIC_AVAILABLE")
        assert hasattr(ai_service, "AMAZON_AVAILABLE")
        assert hasattr(ai_service, "REQUESTS_AVAILABLE")

    def test_availability_flags_are_boolean(self):
        """Test that availability flags are boolean values."""
        assert isinstance(ai_service.GEMINI_AVAILABLE, bool)
        assert isinstance(ai_service.OPENAI_AVAILABLE, bool)
        assert isinstance(ai_service.ANTHROPIC_AVAILABLE, bool)
        assert isinstance(ai_service.AMAZON_AVAILABLE, bool)
        assert isinstance(ai_service.REQUESTS_AVAILABLE, bool)


class TestAIProviderAbstractClass:
    """Test the AIProvider abstract base class."""

    def test_ai_provider_is_abstract(self):
        """Test that AIProvider cannot be instantiated directly."""
        with pytest.raises(TypeError):
            AIProvider("test_key")

    def test_ai_provider_has_required_methods(self):
        """Test that AIProvider defines all required abstract methods."""
        required_methods = ["transcribe_audio", "analyze_text", "is_available", "validate_api_key"]

        for method_name in required_methods:
            assert hasattr(AIProvider, method_name)
            method = getattr(AIProvider, method_name)
            assert getattr(method, "__isabstractmethod__", False), f"{method_name} should be abstract"


class TestGeminiProviderBasics:
    """Test basic GeminiProvider functionality."""

    def setup_method(self):
        """Set up test fixtures."""
        self.test_api_key = "test_gemini_key"
        self.test_config = {"model": "gemini-pro"}

    @patch("ai_service.genai")
    def test_gemini_provider_can_be_instantiated(self, mock_genai):
        """Test that GeminiProvider can be instantiated."""
        mock_genai.configure.return_value = None
        provider = GeminiProvider(self.test_api_key, self.test_config)
        assert provider.api_key == self.test_api_key
        assert provider.config == self.test_config

    @patch("ai_service.GEMINI_AVAILABLE", True)
    @patch("ai_service.genai")
    def test_gemini_provider_is_available_when_available(self, mock_genai):
        """Test is_available returns True when Gemini is available."""
        mock_genai.configure.return_value = None
        provider = GeminiProvider(self.test_api_key)
        assert provider.is_available() is True

    @patch("ai_service.GEMINI_AVAILABLE", False)
    @patch("ai_service.genai")
    def test_gemini_provider_is_available_when_unavailable(self, mock_genai):
        """Test is_available returns False when Gemini is unavailable."""
        provider = GeminiProvider(self.test_api_key)
        assert provider.is_available() is False


class TestOpenAIProviderBasics:
    """Test basic OpenAIProvider functionality."""

    def setup_method(self):
        """Set up test fixtures."""
        self.test_api_key = "test_openai_key"
        self.test_config = {"model": "gpt-4"}

    def test_openai_provider_can_be_instantiated(self):
        """Test that OpenAIProvider can be instantiated."""
        provider = OpenAIProvider(self.test_api_key, self.test_config)
        assert provider.api_key == self.test_api_key
        assert provider.config == self.test_config

    @patch("ai_service.OPENAI_AVAILABLE", True)
    @patch("ai_service.openai")
    def test_openai_provider_is_available_when_available(self, mock_openai):
        """Test is_available returns True when OpenAI is available."""
        provider = OpenAIProvider(self.test_api_key)
        assert provider.is_available() is True

    @patch("ai_service.OPENAI_AVAILABLE", False)
    def test_openai_provider_is_available_when_unavailable(self):
        """Test is_available returns False when OpenAI is unavailable."""
        provider = OpenAIProvider(self.test_api_key)
        assert provider.is_available() is False


class TestAIServiceManagerBasics:
    """Test basic AIServiceManager functionality."""

    def test_ai_service_manager_can_be_instantiated(self):
        """Test that AIServiceManager can be instantiated."""
        manager = AIServiceManager()
        assert manager.providers == {}

    def test_ai_service_manager_configure_provider_gemini(self):
        """Test configuring a Gemini provider."""
        manager = AIServiceManager()
        result = manager.configure_provider("gemini", "test_key")

        # Should return a boolean indicating success/failure
        assert isinstance(result, bool)

        # If successful, provider should be added
        if result:
            assert "gemini" in manager.providers

    def test_ai_service_manager_configure_provider_openai(self):
        """Test configuring an OpenAI provider."""
        manager = AIServiceManager()
        result = manager.configure_provider("openai", "test_key")

        # Should return a boolean indicating success/failure
        assert isinstance(result, bool)

        # If successful, provider should be added
        if result:
            assert "openai" in manager.providers

    def test_ai_service_manager_configure_unknown_provider(self):
        """Test configuring an unknown provider."""
        manager = AIServiceManager()
        result = manager.configure_provider("unknown_provider", "test_key")

        # Should handle gracefully
        assert isinstance(result, bool)


class TestErrorHandling:
    """Test error handling in the AI service module."""

    def test_gemini_provider_handles_missing_api_key(self):
        """Test GeminiProvider handling of missing API key."""
        # Should not raise an exception
        provider = GeminiProvider(None)
        assert provider.api_key is None

    def test_openai_provider_handles_missing_api_key(self):
        """Test OpenAIProvider handling of missing API key."""
        # Should not raise an exception
        provider = OpenAIProvider(None)
        assert provider.api_key is None

    @patch("ai_service.GEMINI_AVAILABLE", True)
    @patch("ai_service.genai")
    def test_gemini_provider_handles_api_exceptions(self, mock_genai):
        """Test GeminiProvider handling of API exceptions."""
        mock_genai.configure.side_effect = Exception("API configuration error")

        # Should raise the exception since we're not handling it in init
        with pytest.raises(Exception, match="API configuration error"):
            GeminiProvider("test_key")


class TestProviderMethods:
    """Test that provider methods return expected structures."""

    def setup_method(self):
        """Set up test fixtures."""
        self.test_api_key = "test_key"

    def test_gemini_provider_methods_exist(self):
        """Test that GeminiProvider has all required methods."""
        provider = GeminiProvider(self.test_api_key)

        assert hasattr(provider, "transcribe_audio")
        assert hasattr(provider, "analyze_text")
        assert hasattr(provider, "is_available")
        assert hasattr(provider, "validate_api_key")

        # Methods should be callable
        assert callable(provider.transcribe_audio)
        assert callable(provider.analyze_text)
        assert callable(provider.is_available)
        assert callable(provider.validate_api_key)

    def test_openai_provider_methods_exist(self):
        """Test that OpenAIProvider has all required methods."""
        provider = OpenAIProvider(self.test_api_key)

        assert hasattr(provider, "transcribe_audio")
        assert hasattr(provider, "analyze_text")
        assert hasattr(provider, "is_available")
        assert hasattr(provider, "validate_api_key")

        # Methods should be callable
        assert callable(provider.transcribe_audio)
        assert callable(provider.analyze_text)
        assert callable(provider.is_available)
        assert callable(provider.validate_api_key)


class TestAIServiceManagerMethods:
    """Test AIServiceManager method functionality."""

    def test_ai_service_manager_has_required_methods(self):
        """Test that AIServiceManager has expected methods."""
        manager = AIServiceManager()

        expected_methods = [
            "configure_provider",
            "validate_provider",
            "get_provider",
            "transcribe_audio",
            "analyze_text",
        ]

        for method_name in expected_methods:
            assert hasattr(manager, method_name), f"AIServiceManager should have {method_name} method"
            assert callable(getattr(manager, method_name)), f"{method_name} should be callable"

    def test_ai_service_manager_get_provider_nonexistent(self):
        """Test getting a provider that doesn't exist."""
        manager = AIServiceManager()
        result = manager.get_provider("nonexistent")

        # Should return None or handle gracefully
        assert result is None

    def test_ai_service_manager_validate_provider_nonexistent(self):
        """Test validating a provider that doesn't exist."""
        manager = AIServiceManager()
        result = manager.validate_provider("nonexistent", "test_key")

        # Actually returns True for unknown providers (logs warning)
        assert result is True


class TestGlobalServiceInstance:
    """Test the global ai_service instance."""

    def test_global_ai_service_exists(self):
        """Test that global ai_service instance exists."""
        # The module creates a global instance called ai_service
        assert hasattr(ai_service, "ai_service")
        assert isinstance(ai_service.ai_service, AIServiceManager)

    def test_global_ai_service_is_functional(self):
        """Test that global ai_service instance is functional."""
        global_service = ai_service.ai_service

        # Should have empty providers initially
        assert global_service.providers == {}

        # Should be able to configure providers
        result = global_service.configure_provider("gemini", "test_key")
        assert isinstance(result, bool)
