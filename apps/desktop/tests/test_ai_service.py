"""
Tests for the AI Service Module.

This test suite covers the unified AI service interface and provider implementations,
focusing on core functionality, error handling, and provider availability.
"""

import json
from unittest.mock import Mock, mock_open, patch

import pytest

# Import the module under test
import ai_service
from ai_service import AIProvider, AIServiceManager, AnthropicProvider, GeminiProvider, OpenAIProvider


class TestAIProviderAvailability:
    """Test AI provider availability flags."""

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
            AIProvider("test_key")  # pylint: disable=abstract-class-instantiated

    def test_ai_provider_has_required_methods(self):
        """Test that AIProvider defines all required abstract methods."""
        required_methods = ["transcribe_audio", "analyze_text", "is_available", "validate_api_key"]

        for method_name in required_methods:
            assert hasattr(AIProvider, method_name)
            method = getattr(AIProvider, method_name)
            assert getattr(method, "__isabstractmethod__", False), f"{method_name} should be abstract"


class TestGeminiProvider:
    """Test the Google Gemini AI provider."""

    def setup_method(self):
        """Set up test fixtures."""
        self.test_api_key = "test_gemini_key"
        self.test_config = {"model": "gemini-pro"}

    @patch("ai_service.GEMINI_AVAILABLE", True)
    @patch("ai_service.genai")
    def test_gemini_provider_initialization_success(self, mock_genai):
        """Test successful GeminiProvider initialization."""
        provider = GeminiProvider(self.test_api_key, self.test_config)

        assert provider.api_key == self.test_api_key
        assert provider.config == self.test_config
        # google-genai SDK: __init__ builds a Client and retains it on the provider.
        mock_genai.Client.assert_called_once_with(api_key=self.test_api_key)
        assert provider.client is mock_genai.Client.return_value

    @patch("ai_service.GEMINI_AVAILABLE", False)
    def test_gemini_provider_initialization_unavailable(self):
        """Test GeminiProvider initialization when Gemini is unavailable."""
        provider = GeminiProvider(self.test_api_key)

        assert provider.api_key == self.test_api_key
        assert not provider.is_available()
        assert provider.client is None

    @patch("ai_service.GEMINI_AVAILABLE", True)
    @patch("ai_service.genai")
    def test_gemini_provider_is_available_true(self, mock_genai):
        """Test is_available returns True when Gemini is available."""
        provider = GeminiProvider(self.test_api_key)

        assert provider.is_available() is True

    @patch("ai_service.GEMINI_AVAILABLE", False)
    def test_gemini_provider_is_available_false(self):
        """Test is_available returns False when Gemini is unavailable."""
        provider = GeminiProvider(self.test_api_key)

        assert provider.is_available() is False

    @patch("ai_service.GEMINI_AVAILABLE", True)
    @patch("ai_service.genai")
    def test_gemini_validate_api_key_success(self, mock_genai):
        """Test successful API key validation."""
        mock_client = mock_genai.Client.return_value
        mock_client.models.generate_content.return_value = Mock(text="test response")

        provider = GeminiProvider(self.test_api_key)

        assert provider.validate_api_key() is True
        # No config supplied, so the provider falls back to its default model.
        mock_client.models.generate_content.assert_called_once_with(
            model="gemini-2.0-flash-exp", contents="Test validation message"
        )

    @patch("ai_service.GEMINI_AVAILABLE", True)
    @patch("ai_service.genai")
    def test_gemini_validate_api_key_normalizes_legacy_model(self, mock_genai):
        """Test that a legacy configured model name is normalized before the API call."""
        mock_client = mock_genai.Client.return_value
        mock_client.models.generate_content.return_value = Mock(text="test response")

        provider = GeminiProvider(self.test_api_key, {"model": "gemini-1.5-flash"})

        assert provider.validate_api_key() is True
        mock_client.models.generate_content.assert_called_once_with(
            model="gemini-2.0-flash-exp", contents="Test validation message"
        )

    @patch("ai_service.GEMINI_AVAILABLE", True)
    @patch("ai_service.genai")
    def test_gemini_validate_api_key_failure(self, mock_genai):
        """Test API key validation failure."""
        mock_client = mock_genai.Client.return_value
        mock_client.models.generate_content.side_effect = Exception("Invalid API key")

        provider = GeminiProvider(self.test_api_key)

        assert provider.validate_api_key() is False
        mock_client.models.generate_content.assert_called_once()

    @patch("ai_service.GEMINI_AVAILABLE", True)
    @patch("ai_service.genai")
    def test_gemini_validate_api_key_empty_response(self, mock_genai):
        """Test API key validation when the API returns a response with no text."""
        mock_client = mock_genai.Client.return_value
        mock_client.models.generate_content.return_value = Mock(text="")

        provider = GeminiProvider(self.test_api_key)

        assert provider.validate_api_key() is False

    @patch("ai_service.GEMINI_AVAILABLE", False)
    def test_gemini_validate_api_key_unavailable(self):
        """Test API key validation when Gemini is unavailable."""
        provider = GeminiProvider(self.test_api_key)

        assert provider.validate_api_key() is False


class TestOpenAIProvider:
    """Test the OpenAI GPT provider."""

    def setup_method(self):
        """Set up test fixtures."""
        self.test_api_key = "test_openai_key"
        self.test_config = {"model": "gpt-4"}

    @patch("ai_service.OPENAI_AVAILABLE", True)
    @patch("ai_service.openai")
    def test_openai_provider_initialization_success(self, mock_openai):
        """Test successful OpenAIProvider initialization."""
        provider = OpenAIProvider(self.test_api_key, self.test_config)

        assert provider.api_key == self.test_api_key
        assert provider.config == self.test_config
        assert provider.client is not None

    @patch("ai_service.OPENAI_AVAILABLE", False)
    def test_openai_provider_initialization_unavailable(self):
        """Test OpenAIProvider initialization when OpenAI is unavailable."""
        provider = OpenAIProvider(self.test_api_key)

        assert provider.api_key == self.test_api_key
        assert not provider.is_available()

    @patch("ai_service.OPENAI_AVAILABLE", True)
    @patch("ai_service.openai")
    def test_openai_provider_is_available_true(self, mock_openai):
        """Test is_available returns True when OpenAI is available."""
        provider = OpenAIProvider(self.test_api_key)

        assert provider.is_available() is True

    @patch("ai_service.OPENAI_AVAILABLE", False)
    def test_openai_provider_is_available_false(self):
        """Test is_available returns False when OpenAI is unavailable."""
        provider = OpenAIProvider(self.test_api_key)

        assert provider.is_available() is False


class TestAnthropicProvider:
    """Test the Anthropic Claude provider."""

    def setup_method(self):
        """Set up test fixtures."""
        self.test_api_key = "test_anthropic_key"
        self.test_config = {"model": "claude-3-sonnet"}

    @patch("ai_service.ANTHROPIC_AVAILABLE", True)
    @patch("ai_service.anthropic")
    def test_anthropic_provider_initialization_success(self, mock_anthropic):
        """Test successful AnthropicProvider initialization."""
        provider = AnthropicProvider(self.test_api_key, self.test_config)

        assert provider.api_key == self.test_api_key
        assert provider.config == self.test_config
        assert provider.client is not None

    @patch("ai_service.ANTHROPIC_AVAILABLE", False)
    def test_anthropic_provider_initialization_unavailable(self):
        """Test AnthropicProvider initialization when Anthropic is unavailable."""
        provider = AnthropicProvider(self.test_api_key)

        assert provider.api_key == self.test_api_key
        assert not provider.is_available()

    @patch("ai_service.ANTHROPIC_AVAILABLE", True)
    @patch("ai_service.anthropic")
    def test_anthropic_provider_is_available_true(self, mock_anthropic):
        """Test is_available returns True when Anthropic is available."""
        provider = AnthropicProvider(self.test_api_key)

        assert provider.is_available() is True

    @patch("ai_service.ANTHROPIC_AVAILABLE", False)
    def test_anthropic_provider_is_available_false(self):
        """Test is_available returns False when Anthropic is unavailable."""
        provider = AnthropicProvider(self.test_api_key)

        assert provider.is_available() is False


class TestAudioTranscription:
    """Test audio transcription functionality across providers."""

    def setup_method(self):
        """Set up test fixtures."""
        self.test_audio_file = "/tmp/test_audio.wav"
        self.sample_audio_data = b"mock audio data"

    @patch("ai_service.GEMINI_AVAILABLE", True)
    @patch("ai_service.genai")
    def test_gemini_transcribe_audio_success(self, mock_genai):
        """Test successful audio transcription with Gemini."""
        # google-genai SDK: the file is uploaded, passed alongside the prompt, then deleted.
        mock_client = mock_genai.Client.return_value
        mock_uploaded_file = Mock(uri="https://generativelanguage.googleapis.com/v1beta/files/abc123")
        mock_uploaded_file.name = "files/abc123"  # `name` cannot be passed to the Mock constructor
        mock_client.files.upload.return_value = mock_uploaded_file
        # transcribe_audio returns the raw response text, it does not parse JSON.
        mock_client.models.generate_content.return_value = Mock(
            text="  [00:00] Speaker 1: Transcribed text from audio\n"
        )

        provider = GeminiProvider("test_key")
        result = provider.transcribe_audio(self.test_audio_file)

        assert result["success"] is True
        assert result["transcription"] == "[00:00] Speaker 1: Transcribed text from audio"
        assert result["language"] == "auto"
        assert result["confidence"] == 0.9
        assert result["provider"] == "gemini"

        mock_client.files.upload.assert_called_once_with(file=self.test_audio_file)
        mock_client.models.generate_content.assert_called_once()
        call_kwargs = mock_client.models.generate_content.call_args.kwargs
        assert call_kwargs["model"] == "gemini-2.0-flash-exp"
        assert isinstance(call_kwargs["contents"][0], str)
        assert call_kwargs["contents"][1] is mock_uploaded_file
        # The uploaded file must be cleaned up after a successful transcription.
        mock_client.files.delete.assert_called_once_with(name="files/abc123")

    @patch("ai_service.GEMINI_AVAILABLE", True)
    @patch("ai_service.genai")
    def test_gemini_transcribe_audio_file_not_found(self, mock_genai):
        """Test audio transcription with missing file."""
        # The implementation never calls open(); it hands the path to client.files.upload().
        mock_client = mock_genai.Client.return_value
        mock_client.files.upload.side_effect = FileNotFoundError("No such file: /nonexistent/file.wav")

        provider = GeminiProvider("test_key")
        result = provider.transcribe_audio("/nonexistent/file.wav")

        assert result["success"] is False
        assert "error" in result
        assert "/nonexistent/file.wav" in result["error"]
        assert result["provider"] == "gemini"
        # Nothing was uploaded, so no cleanup call should be attempted.
        mock_client.files.delete.assert_not_called()

    @patch("ai_service.GEMINI_AVAILABLE", True)
    @patch("ai_service.genai")
    def test_gemini_transcribe_and_analyze_returns_every_requested_field(self, mock_genai):
        """The combined call must surface every field its prompt asks the model to produce.

        conversation_segments was dropped when the analysis dict was rebuilt, which killed
        the multiple-conversation-detection feature end to end: the model produced the data
        and transcription_module consumed it, but nothing in between passed it along.
        """
        mock_client = mock_genai.Client.return_value
        mock_uploaded_file = Mock(uri="https://generativelanguage.googleapis.com/v1beta/files/abc123")
        mock_uploaded_file.name = "files/abc123"
        mock_client.files.upload.return_value = mock_uploaded_file

        analysis = {
            "summary": "Two separate conversations were recorded.",
            "key_points": ["Nova Sonic demo went well"],
            "action_items": ["Task: send the deck (assigned to: Sebastian)"],
            "topics": ["demo", "interview"],
            "sentiment": "professional",
            "participants": ["Sebastian", "Ceci"],
            "conversation_segments": [
                {
                    "segment_number": 1,
                    "start_time": "00:00",
                    "end_time": "45:30",
                    "participants": ["Sebastian"],
                    "topic": "Nova Sonic bot demo",
                    "summary": "Demo walkthrough",
                },
                {
                    "segment_number": 2,
                    "start_time": "45:30",
                    "end_time": "66:00",
                    "participants": ["Ceci"],
                    "topic": "Technical interview",
                    "summary": "Interview",
                },
            ],
        }
        mock_client.models.generate_content.return_value = Mock(
            text="[00:00] Sebastian: hello\n" + json.dumps(analysis)
        )

        provider = GeminiProvider("test_key")
        result = provider.transcribe_and_analyze_audio(self.test_audio_file)

        assert result["success"] is True
        assert result["transcription"] == "[00:00] Sebastian: hello"

        returned = result["analysis"]
        for field, expected in analysis.items():
            assert returned[field] == expected, f"{field} was dropped by transcribe_and_analyze_audio"

        mock_client.files.delete.assert_called_once_with(name="files/abc123")

    @patch("ai_service.OPENAI_AVAILABLE", True)
    @patch("ai_service.openai")
    @patch("builtins.open", mock_open(read_data=b"mock audio data"))
    def test_openai_transcribe_audio_success(self, mock_openai):
        """Test successful audio transcription with OpenAI."""
        # Setup mocks
        mock_client = Mock()
        mock_transcription = Mock()
        mock_transcription.text = "OpenAI transcribed text"
        mock_client.audio.transcriptions.create.return_value = mock_transcription
        mock_openai.OpenAI.return_value = mock_client

        provider = OpenAIProvider("test_key")
        result = provider.transcribe_audio(self.test_audio_file)

        assert result["success"] is True
        assert "OpenAI transcribed text" in result["transcription"]


class TestTextAnalysis:
    """Test text analysis functionality across providers."""

    def setup_method(self):
        """Set up test fixtures."""
        self.sample_text = "This is a sample text for analysis."

    @patch("ai_service.GEMINI_AVAILABLE", True)
    @patch("ai_service.genai")
    def test_gemini_analyze_text_insights(self, mock_genai):
        """Test text analysis for insights with Gemini."""
        # google-genai SDK: analysis goes through client.models.generate_content.
        mock_client = mock_genai.Client.return_value
        mock_client.models.generate_content.return_value = Mock(
            text=(
                '{"summary": "Key insights: The text discusses sample analysis.", '
                '"key_points": ["point 1"], "action_items": ["action 1"], '
                '"sentiment": "neutral", "topics": ["analysis"]}'
            )
        )

        provider = GeminiProvider("test_key")
        result = provider.analyze_text(self.sample_text, "insights")

        assert result["success"] is True
        assert result["provider"] == "gemini"
        assert "insights" in result["analysis"]["summary"].lower()
        assert result["analysis"]["key_points"] == ["point 1"]
        assert result["analysis"]["action_items"] == ["action 1"]
        assert result["analysis"]["sentiment"] == "neutral"
        assert result["analysis"]["topics"] == ["analysis"]

        mock_client.models.generate_content.assert_called_once()
        call_kwargs = mock_client.models.generate_content.call_args.kwargs
        assert call_kwargs["model"] == "gemini-2.0-flash-exp"
        assert self.sample_text in call_kwargs["contents"]

    @patch("ai_service.GEMINI_AVAILABLE", True)
    @patch("ai_service.genai")
    def test_gemini_analyze_text_summary(self, mock_genai):
        """Test text analysis for summary with Gemini."""
        mock_client = mock_genai.Client.return_value
        mock_client.models.generate_content.return_value = Mock(
            text=(
                '{"summary": "Sample text analysis discussion.", '
                '"key_points": ["point 1"], "action_items": ["action 1"], '
                '"sentiment": "neutral", "topics": ["analysis"]}'
            )
        )

        provider = GeminiProvider("test_key")
        result = provider.analyze_text(self.sample_text, "summary")

        assert result["success"] is True
        assert "sample text analysis discussion" in result["analysis"]["summary"].lower()
        assert result["analysis"]["key_points"] == ["point 1"]
        assert result["analysis"]["topics"] == ["analysis"]

    @patch("ai_service.GEMINI_AVAILABLE", True)
    @patch("ai_service.genai")
    def test_gemini_analyze_text_strips_json_code_fence(self, mock_genai):
        """Test that a fenced ```json response is unwrapped before parsing."""
        mock_client = mock_genai.Client.return_value
        mock_client.models.generate_content.return_value = Mock(
            text='```json\n{"summary": "Fenced response.", "topics": ["analysis"]}\n```'
        )

        provider = GeminiProvider("test_key")
        result = provider.analyze_text(self.sample_text)

        assert result["success"] is True
        assert result["analysis"]["summary"] == "Fenced response."

    @patch("ai_service.GEMINI_AVAILABLE", True)
    @patch("ai_service.genai")
    def test_gemini_analyze_text_api_error(self, mock_genai):
        """Test text analysis with API error."""
        mock_client = mock_genai.Client.return_value
        mock_client.models.generate_content.side_effect = Exception("API Error")

        provider = GeminiProvider("test_key")
        result = provider.analyze_text(self.sample_text)

        assert result["success"] is False
        assert result["error"] == "API Error"
        assert result["provider"] == "gemini"


class TestAIServiceManager:
    """Test the AI Service Manager."""

    def setup_method(self):
        """Set up test fixtures."""
        self.test_config = {
            "gemini_api_key": "test_gemini_key",
            "openai_api_key": "test_openai_key",
            "anthropic_api_key": "test_anthropic_key",
        }

    def test_ai_service_manager_initialization(self):
        """Test AIServiceManager initialization."""
        manager = AIServiceManager()

        assert not manager.providers

    @patch("ai_service.GEMINI_AVAILABLE", True)
    @patch("ai_service.genai")
    def test_ai_service_manager_add_provider(self, mock_genai):
        """Test adding a provider to the manager."""
        manager = AIServiceManager()

        result = manager.configure_provider("gemini", "test_key")

        assert result is True
        assert "gemini" in manager.providers

    @patch("ai_service.GEMINI_AVAILABLE", True)
    @patch("ai_service.genai")
    def test_ai_service_manager_set_default_provider(self, mock_genai):
        """Test setting default provider."""
        manager = AIServiceManager()
        manager.configure_provider("gemini", "test_key")

        # Test that provider was configured successfully
        assert "gemini" in manager.providers
        provider = manager.get_provider("gemini")
        assert provider is not None

    def test_ai_service_manager_set_default_provider_not_found(self):
        """Test getting nonexistent provider returns None."""
        manager = AIServiceManager()

        provider = manager.get_provider("nonexistent")
        assert provider is None

    @patch("ai_service.GEMINI_AVAILABLE", True)
    @patch("ai_service.genai")
    def test_ai_service_manager_get_available_providers(self, mock_genai):
        """Test getting list of available providers."""
        manager = AIServiceManager()

        # Configure a provider
        result = manager.configure_provider("gemini", "test_key")
        assert result is True

        # Test that provider is configured
        provider = manager.get_provider("gemini")
        assert provider is not None


class TestErrorHandling:
    """Test error handling across the AI service module."""

    @patch("ai_service.GEMINI_AVAILABLE", True)
    @patch("ai_service.genai")
    def test_provider_handles_network_errors(self, mock_genai):
        """Test provider handling of network errors."""
        mock_client = mock_genai.Client.return_value
        mock_client.models.generate_content.side_effect = ConnectionError("Network error")

        provider = GeminiProvider("test_key")
        result = provider.analyze_text("test text")

        assert result["success"] is False
        assert result["error"] == "Network error"

    @patch("ai_service.GEMINI_AVAILABLE", True)
    @patch("ai_service.genai")
    def test_provider_handles_invalid_response(self, mock_genai):
        """Test provider handling of invalid API responses."""
        mock_client = mock_genai.Client.return_value
        mock_client.models.generate_content.return_value = Mock(text=None)  # Invalid response

        provider = GeminiProvider("test_key")
        result = provider.analyze_text("test text")

        # Should handle gracefully rather than raising.
        assert isinstance(result, dict)
        assert result["success"] is False
        assert "error" in result

    @patch("ai_service.GEMINI_AVAILABLE", True)
    @patch("ai_service.genai")
    def test_provider_handles_non_json_response(self, mock_genai):
        """Test provider handling of a response that is not valid JSON."""
        mock_client = mock_genai.Client.return_value
        mock_client.models.generate_content.return_value = Mock(text="I'm sorry, I cannot help with that.")

        provider = GeminiProvider("test_key")
        result = provider.analyze_text("test text")

        assert result["success"] is False
        assert "error" in result


class TestUtilityFunctions:
    """Test utility functions in the AI service module."""

    def test_module_imports(self):
        """Test that all required imports are available."""
        import ai_service

        # Test that the module can be imported successfully
        assert hasattr(ai_service, "AIProvider")
        assert hasattr(ai_service, "GeminiProvider")
        assert hasattr(ai_service, "AIServiceManager")

    def test_module_constants(self):
        """Test that module constants are properly defined."""
        import ai_service

        # Availability flags should be defined
        assert hasattr(ai_service, "GEMINI_AVAILABLE")
        assert hasattr(ai_service, "OPENAI_AVAILABLE")
        assert hasattr(ai_service, "ANTHROPIC_AVAILABLE")
        assert hasattr(ai_service, "AMAZON_AVAILABLE")
        assert hasattr(ai_service, "REQUESTS_AVAILABLE")


class TestProviderSelection:
    """Test provider selection and fallback logic."""

    @patch("ai_service.GEMINI_AVAILABLE", True)
    @patch("ai_service.OPENAI_AVAILABLE", True)
    @patch("ai_service.genai")
    @patch("ai_service.openai")
    def test_multiple_providers_available(self, mock_openai, mock_genai):
        """Test behavior when multiple providers are available."""
        manager = AIServiceManager()

        # Configure multiple providers
        result1 = manager.configure_provider("gemini", "test_key")
        result2 = manager.configure_provider("openai", "test_key")

        assert result1 is True
        assert result2 is True
        assert len(manager.providers) >= 2

    @patch("ai_service.GEMINI_AVAILABLE", False)
    @patch("ai_service.OPENAI_AVAILABLE", False)
    @patch("ai_service.ANTHROPIC_AVAILABLE", False)
    def test_no_providers_available(self):
        """Test behavior when no providers are available."""
        manager = AIServiceManager()

        # No providers configured
        assert len(manager.providers) == 0
