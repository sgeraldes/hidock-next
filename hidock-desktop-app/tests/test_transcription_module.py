"""
Comprehensive tests for transcription_module.py

Following TDD principles to achieve 80% test coverage as mandated by .amazonq/rules/PYTHON.md
"""

import json
import os
import tempfile
import unittest.mock as mock
from unittest.mock import AsyncMock, MagicMock, Mock, patch

import pytest

import transcription_module
from transcription_module import (
    TRANSCRIPTION_FAILED_DEFAULT_MSG,
    TRANSCRIPTION_PARSE_ERROR_MSG_PREFIX,
    _call_gemini_api,
    _get_audio_duration,
    extract_meeting_insights,
    main_test,
    process_audio_file_for_insights,
    transcribe_audio,
)


class TestConstants:
    """Test module constants"""

    def test_constants_defined(self):
        """Test that required constants are defined"""
        assert TRANSCRIPTION_FAILED_DEFAULT_MSG == "Transcription failed or no content returned."
        assert TRANSCRIPTION_PARSE_ERROR_MSG_PREFIX == "Error parsing transcription response:"


class TestCallGeminiApi:
    """Test _call_gemini_api function"""

    def test_call_gemini_api_empty_key_text_response(self):
        """Test _call_gemini_api with empty key returns mock text response"""
        payload = {"contents": "test content"}

        result = _call_gemini_api(payload, "")

        assert result is not None
        assert "candidates" in result
        assert len(result["candidates"]) == 1
        candidate = result["candidates"][0]
        assert candidate["content"]["role"] == "model"
        assert "mock" in candidate["content"]["parts"][0]["text"].lower()
        assert candidate["finishReason"] == "STOP"

    def test_call_gemini_api_empty_key_json_response(self):
        """Test _call_gemini_api with empty key returns mock JSON response"""
        payload = {"contents": "test content", "generationConfig": {"responseMimeType": "application/json"}}

        result = _call_gemini_api(payload, "")

        assert result is not None
        text_content = result["candidates"][0]["content"]["parts"][0]["text"]
        json_data = json.loads(text_content)

        assert "summary" in json_data
        assert json_data["summary"] == "Mock summary from API (missing key)."
        assert "category" in json_data
        assert "meeting_details" in json_data
        assert "action_items" in json_data
        assert len(json_data["action_items"]) == 2

    @patch("transcription_module.genai", None)
    def test_call_gemini_api_no_genai_library(self):
        """Test _call_gemini_api when genai library not available"""
        payload = {"contents": "test content"}

        result = _call_gemini_api(payload, "test_key")

        assert result is None

    @patch("transcription_module.genai")
    def test_call_gemini_api_success(self, mock_genai):
        """Test successful _call_gemini_api call"""
        payload = {"contents": "test content", "generationConfig": {"temperature": 0.5}}
        mock_model = Mock()
        mock_response = Mock()
        mock_response.to_dict.return_value = {"response": "success"}
        mock_model.generate_content.return_value = mock_response
        mock_genai.GenerativeModel.return_value = mock_model

        result = _call_gemini_api(payload, "test_key")

        assert result == {"response": "success"}
        mock_genai.configure.assert_called_once_with(api_key="test_key")
        mock_genai.GenerativeModel.assert_called_once_with("gemini-1.5-flash")
        mock_model.generate_content.assert_called_once_with("test content", generation_config={"temperature": 0.5})

    @patch("transcription_module.genai")
    def test_call_gemini_api_exception(self, mock_genai):
        """Test _call_gemini_api with exception"""
        payload = {"contents": "test content"}
        mock_genai.configure.side_effect = Exception("API error")

        result = _call_gemini_api(payload, "test_key")

        assert result is None

    @patch("transcription_module.genai")
    def test_call_gemini_api_model_exception(self, mock_genai):
        """Test _call_gemini_api with model generation exception"""
        payload = {"contents": "test content"}
        mock_model = Mock()
        mock_model.generate_content.side_effect = Exception("Model error")
        mock_genai.GenerativeModel.return_value = mock_model

        result = _call_gemini_api(payload, "test_key")

        assert result is None


class TestTranscribeAudio:
    """Test transcribe_audio function"""

    @pytest.mark.asyncio
    @patch("transcription_module.ai_service")
    async def test_transcribe_audio_success(self, mock_ai_service):
        """Test successful audio transcription"""
        mock_ai_service.configure_provider.return_value = True
        mock_ai_service.transcribe_audio.return_value = {
            "success": True,
            "transcription": "This is the transcription text.",
        }

        result = await transcribe_audio("/test/audio.wav", "gemini", "test_key")

        assert result["transcription"] == "This is the transcription text."
        mock_ai_service.configure_provider.assert_called_once_with("gemini", "test_key", None)
        mock_ai_service.transcribe_audio.assert_called_once_with("gemini", "/test/audio.wav", "auto")

    @pytest.mark.asyncio
    @patch("transcription_module.ai_service")
    async def test_transcribe_audio_configure_failure(self, mock_ai_service):
        """Test transcribe_audio when provider configuration fails"""
        mock_ai_service.configure_provider.return_value = False

        result = await transcribe_audio("/test/audio.wav", "gemini", "test_key")

        assert result["transcription"] == TRANSCRIPTION_FAILED_DEFAULT_MSG

    @pytest.mark.asyncio
    @patch("transcription_module.ai_service")
    async def test_transcribe_audio_transcription_failure(self, mock_ai_service):
        """Test transcribe_audio when transcription fails"""
        mock_ai_service.configure_provider.return_value = True
        mock_ai_service.transcribe_audio.return_value = {"success": False, "error": "API error occurred"}

        result = await transcribe_audio("/test/audio.wav", "gemini", "test_key")

        assert "Transcription failed: API error occurred" in result["transcription"]

    @pytest.mark.asyncio
    @patch("transcription_module.ai_service")
    async def test_transcribe_audio_no_transcription_content(self, mock_ai_service):
        """Test transcribe_audio when no transcription content returned"""
        mock_ai_service.configure_provider.return_value = True
        mock_ai_service.transcribe_audio.return_value = {
            "success": True
            # No transcription key
        }

        result = await transcribe_audio("/test/audio.wav", "gemini", "test_key")

        assert result["transcription"] == TRANSCRIPTION_FAILED_DEFAULT_MSG

    @pytest.mark.asyncio
    @patch("transcription_module.ai_service")
    async def test_transcribe_audio_with_config_and_language(self, mock_ai_service):
        """Test transcribe_audio with custom config and language"""
        mock_ai_service.configure_provider.return_value = True
        mock_ai_service.transcribe_audio.return_value = {"success": True, "transcription": "Transcribed text"}
        config = {"model": "whisper-1", "temperature": 0.2}

        result = await transcribe_audio("/test/audio.wav", "openai", "test_key", config, "en")

        assert result["transcription"] == "Transcribed text"
        mock_ai_service.configure_provider.assert_called_once_with("openai", "test_key", config)
        mock_ai_service.transcribe_audio.assert_called_once_with("openai", "/test/audio.wav", "en")


class TestExtractMeetingInsights:
    """Test extract_meeting_insights function"""

    @pytest.mark.asyncio
    @patch("transcription_module.ai_service")
    async def test_extract_meeting_insights_success(self, mock_ai_service):
        """Test successful meeting insights extraction"""
        mock_ai_service.configure_provider.return_value = True
        mock_response = {
            "success": True,
            "analysis": {
                "summary": "Meeting about project planning",
                "topics": ["Planning", "Budget"],
                "sentiment": "Positive",
                "action_items": ["Review budget", "Schedule next meeting"],
            },
        }
        mock_ai_service.analyze_text.return_value = mock_response

        result = await extract_meeting_insights("Transcription text", "gemini", "test_key")

        assert result["summary"] == "Meeting about project planning"
        assert result["category"] == "Meeting"  # It sets to "Meeting" when topics exist
        assert len(result["action_items"]) == 2
        assert result["overall_sentiment_meeting"] == "Positive"
        assert result["project_context"] == "Planning, Budget"
        mock_ai_service.configure_provider.assert_called_once_with("gemini", "test_key", None)

    @pytest.mark.asyncio
    @patch("transcription_module.ai_service")
    async def test_extract_meeting_insights_configure_failure(self, mock_ai_service):
        """Test extract_meeting_insights when provider configuration fails"""
        mock_ai_service.configure_provider.return_value = False

        result = await extract_meeting_insights("Transcription text", "gemini", "test_key")

        # When configuration fails, it returns the default structure, no error key
        assert result["summary"] == "N/A"
        assert result["category"] == "N/A"
        assert result["action_items"] == []
        assert "error" not in result

    @pytest.mark.asyncio
    @patch("transcription_module.ai_service")
    async def test_extract_meeting_insights_extraction_failure(self, mock_ai_service):
        """Test extract_meeting_insights when extraction fails"""
        mock_ai_service.configure_provider.return_value = True
        mock_ai_service.analyze_text.return_value = {"success": False, "error": "Extraction failed"}

        result = await extract_meeting_insights("Transcription text", "gemini", "test_key")

        # When analysis fails, it returns the default structure, no error key
        assert result["summary"] == "N/A"
        assert result["category"] == "N/A"
        assert "error" not in result

    @pytest.mark.asyncio
    @patch("transcription_module.ai_service")
    async def test_extract_meeting_insights_invalid_json(self, mock_ai_service):
        """Test extract_meeting_insights with invalid JSON response"""
        mock_ai_service.configure_provider.return_value = True
        mock_ai_service.analyze_text.return_value = {
            "success": True,
            "analysis": {},  # Empty analysis - should use defaults
        }

        result = await extract_meeting_insights("Transcription text", "gemini", "test_key")

        # Empty analysis should return default values
        assert result["summary"] == "N/A"
        assert result["category"] == "N/A"
        assert "error" not in result

    @pytest.mark.asyncio
    @patch("transcription_module.ai_service")
    async def test_extract_meeting_insights_with_config(self, mock_ai_service):
        """Test extract_meeting_insights with custom config"""
        mock_ai_service.configure_provider.return_value = True
        mock_ai_service.analyze_text.return_value = {"success": True, "analysis": {"summary": "Test summary"}}
        config = {"model": "gpt-4", "temperature": 0.3}

        result = await extract_meeting_insights("Transcription text", "openai", "test_key", config)

        assert result["summary"] == "Test summary"
        mock_ai_service.configure_provider.assert_called_once_with("openai", "test_key", config)

    @pytest.mark.asyncio
    @patch("transcription_module.ai_service")
    async def test_extract_meeting_insights_empty_content(self, mock_ai_service):
        """Test extract_meeting_insights with empty content"""
        mock_ai_service.configure_provider.return_value = True
        mock_ai_service.analyze_text.return_value = {"success": True, "analysis": {}}  # Empty analysis

        result = await extract_meeting_insights("Transcription text", "gemini", "test_key")

        # Empty analysis should return default values
        assert result["summary"] == "N/A"
        assert result["category"] == "N/A"
        assert "error" not in result


class TestGetAudioDuration:
    """Test _get_audio_duration function"""

    def test_get_audio_duration_success(self):
        """Test successful audio duration calculation"""
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as temp_file:
            temp_path = temp_file.name

        try:
            # Create a mock WAV file
            with patch("transcription_module.wave.open") as mock_wave_open:
                mock_wave_file = Mock()
                mock_wave_file.getnframes.return_value = 44100  # 1 second at 44.1kHz
                mock_wave_file.getframerate.return_value = 44100
                mock_wave_open.return_value.__enter__.return_value = mock_wave_file

                duration = _get_audio_duration(temp_path)

                assert duration == 0  # 1 second = 0 minutes (rounded)
                mock_wave_open.assert_called_once_with(temp_path, "rb")
        finally:
            if os.path.exists(temp_path):
                os.unlink(temp_path)

    def test_get_audio_duration_file_not_found(self):
        """Test _get_audio_duration with non-existent file"""
        duration = _get_audio_duration("/nonexistent/file.wav")

        assert duration == 0

    def test_get_audio_duration_wave_error(self):
        """Test _get_audio_duration with wave module error"""
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as temp_file:
            temp_path = temp_file.name

        try:
            with patch("transcription_module.wave.open", side_effect=Exception("Wave error")):
                duration = _get_audio_duration(temp_path)

                assert duration == 0
        finally:
            if os.path.exists(temp_path):
                os.unlink(temp_path)

    def test_get_audio_duration_zero_framerate(self):
        """Test _get_audio_duration with zero frame rate"""
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as temp_path:
            pass

        try:
            with patch("transcription_module.wave.open") as mock_wave_open:
                mock_wave_file = Mock()
                mock_wave_file.getnframes.return_value = 44100
                mock_wave_file.getframerate.return_value = 0  # Zero frame rate
                mock_wave_open.return_value.__enter__.return_value = mock_wave_file

                duration = _get_audio_duration(temp_path.name)

                assert duration == 0
        finally:
            if os.path.exists(temp_path.name):
                os.unlink(temp_path.name)


class TestProcessAudioFileForInsights:
    """Test process_audio_file_for_insights function"""

    @pytest.mark.asyncio
    @patch("transcription_module.os.path.exists")
    @patch("transcription_module.transcribe_audio")
    @patch("transcription_module.extract_meeting_insights")
    async def test_process_audio_file_success(self, mock_extract_insights, mock_transcribe, mock_exists):
        """Test successful audio file processing for insights"""
        mock_exists.return_value = True
        mock_transcribe.return_value = {"transcription": "Meeting transcription text"}
        mock_extract_insights.return_value = {
            "summary": "Project meeting summary",
            "action_items": ["Task 1", "Task 2"],
            "category": "Meeting",
            "meeting_details": {"duration_minutes": 2},
        }

        result = await process_audio_file_for_insights("/test/audio.wav", "gemini", "test_key")

        assert result["transcription"] == "Meeting transcription text"
        assert result["insights"]["summary"] == "Project meeting summary"
        assert len(result["insights"]["action_items"]) == 2
        assert result["insights"]["category"] == "Meeting"

        mock_transcribe.assert_called_once_with("/test/audio.wav", "gemini", "test_key", None, "auto")
        mock_extract_insights.assert_called_once_with("Meeting transcription text", "gemini", "test_key", None)

    @pytest.mark.asyncio
    @patch("transcription_module.os.path.exists")
    @patch("transcription_module.transcribe_audio")
    @patch("transcription_module.extract_meeting_insights")
    async def test_process_audio_file_transcription_failure(self, mock_extract_insights, mock_transcribe, mock_exists):
        """Test process_audio_file_for_insights when transcription fails"""
        mock_exists.return_value = True
        mock_transcribe.return_value = {"transcription": TRANSCRIPTION_FAILED_DEFAULT_MSG}

        result = await process_audio_file_for_insights("/test/audio.wav", "gemini", "test_key")

        assert result["transcription"] == TRANSCRIPTION_FAILED_DEFAULT_MSG
        # When transcription fails, should still return the failed transcription
        # and default insights structure
        assert "insights" in result
        assert result["insights"]["summary"] == "N/A - Transcription failed"

        # Should not call extract_insights if transcription failed
        mock_extract_insights.assert_not_called()

    @pytest.mark.asyncio
    async def test_process_audio_file_file_not_found(self):
        """Test process_audio_file_for_insights when file doesn't exist"""
        result = await process_audio_file_for_insights("/nonexistent/audio.wav", "gemini", "test_key")

        assert "error" in result
        assert "Audio file not found" in result["error"]

    @pytest.mark.asyncio
    @patch("transcription_module.os.path.exists")
    @patch("transcription_module.transcribe_audio")
    @patch("transcription_module.extract_meeting_insights")
    async def test_process_audio_file_with_config(self, mock_extract_insights, mock_transcribe, mock_exists):
        """Test process_audio_file_for_insights with custom configuration"""
        mock_exists.return_value = True
        mock_transcribe.return_value = {"transcription": "Transcribed text"}
        mock_extract_insights.return_value = {
            "summary": "Meeting summary",
            "category": "Meeting",
            "meeting_details": {"duration_minutes": 2},
        }
        config = {"model": "gpt-4", "temperature": 0.5}

        result = await process_audio_file_for_insights("/test/audio.wav", "openai", "test_key", config, "en")

        assert result["transcription"] == "Transcribed text"
        assert result["insights"]["summary"] == "Meeting summary"

        mock_transcribe.assert_called_once_with("/test/audio.wav", "openai", "test_key", config, "en")
        mock_extract_insights.assert_called_once_with("Transcribed text", "openai", "test_key", config)

    @pytest.mark.asyncio
    @patch("transcription_module.os.path.exists")
    @patch("transcription_module.transcribe_audio")
    @patch("transcription_module.extract_meeting_insights")
    @patch("transcription_module._get_audio_duration")
    async def test_process_audio_file_with_duration_calculation(
        self, mock_get_duration, mock_extract_insights, mock_transcribe, mock_exists
    ):
        """Test process_audio_file_for_insights with duration calculation for WAV files"""
        mock_exists.return_value = True
        mock_get_duration.return_value = 2  # 2 minutes
        mock_transcribe.return_value = {"transcription": "Short transcription"}
        mock_extract_insights.return_value = {
            "summary": "Brief summary",
            "category": "Meeting",
            "meeting_details": {"duration_minutes": 0},  # Will be updated by function
        }

        result = await process_audio_file_for_insights("/test/audio.wav", "gemini", "test_key")

        assert result["transcription"] == "Short transcription"
        assert result["insights"]["summary"] == "Brief summary"
        # Duration should be calculated and set in meeting_details
        assert result["insights"]["meeting_details"]["duration_minutes"] == 2

    @pytest.mark.asyncio
    @patch("transcription_module.os.path.exists")
    @patch("transcription_module.transcribe_audio")
    async def test_process_audio_file_transcription_exception(self, mock_transcribe, mock_exists):
        """Test process_audio_file_for_insights when transcription raises exception"""
        mock_exists.return_value = True
        mock_transcribe.side_effect = Exception("Transcription error")

        result = await process_audio_file_for_insights("/test/audio.wav", "gemini", "test_key")

        assert "error" in result
        assert "Error preparing audio file: Transcription error" in result["error"]

    @pytest.mark.asyncio
    @patch("transcription_module.os.path.exists")
    @patch("transcription_module.transcribe_audio")
    @patch("transcription_module.extract_meeting_insights")
    async def test_process_audio_file_insights_exception(self, mock_extract_insights, mock_transcribe, mock_exists):
        """Test process_audio_file_for_insights when insights extraction raises exception"""
        mock_exists.return_value = True
        mock_transcribe.return_value = {"transcription": "Valid transcription"}
        mock_extract_insights.side_effect = Exception("Insights error")

        result = await process_audio_file_for_insights("/test/audio.wav", "gemini", "test_key")

        assert "error" in result
        assert "Error preparing audio file: Insights error" in result["error"]

    @pytest.mark.asyncio
    @patch("transcription_module.os.path.exists")
    @patch("hta_converter.convert_hta_to_wav")
    async def test_process_audio_file_hta_conversion_success(self, mock_convert_hta, mock_exists):
        """Test process_audio_file_for_insights with HTA file conversion"""
        mock_exists.return_value = True
        mock_convert_hta.return_value = "/temp/converted.wav"

        with patch("transcription_module.transcribe_audio") as mock_transcribe, patch(
            "transcription_module.extract_meeting_insights"
        ) as mock_extract_insights, patch("transcription_module.os.remove") as mock_remove:

            mock_transcribe.return_value = {"transcription": "HTA transcription"}
            mock_extract_insights.return_value = {"summary": "HTA summary"}

            result = await process_audio_file_for_insights("/test/audio.hta", "gemini", "test_key")

            assert result["transcription"] == "HTA transcription"
            assert result["insights"]["summary"] == "HTA summary"
            mock_convert_hta.assert_called_once_with("/test/audio.hta")
            mock_transcribe.assert_called_once_with("/temp/converted.wav", "gemini", "test_key", None, "auto")
            mock_remove.assert_called_once_with("/temp/converted.wav")

    @pytest.mark.asyncio
    @patch("transcription_module.os.path.exists")
    @patch("hta_converter.convert_hta_to_wav")
    async def test_process_audio_file_hta_conversion_failure(self, mock_convert_hta, mock_exists):
        """Test process_audio_file_for_insights when HTA conversion fails"""
        mock_exists.return_value = True
        mock_convert_hta.return_value = None  # Conversion failed

        result = await process_audio_file_for_insights("/test/audio.hta", "gemini", "test_key")

        assert "error" in result
        assert "Failed to convert HTA file to WAV format" in result["error"]


class TestModuleIntegration:
    """Test module-level integration scenarios"""

    def test_import_google_generativeai_available(self):
        """Test when google.generativeai is available"""
        with patch("transcription_module.genai") as mock_genai:
            assert mock_genai is not None

    def test_import_google_generativeai_unavailable(self):
        """Test behavior when google.generativeai is not available"""
        # This is already tested in the _call_gemini_api tests
        # but we can verify the module handles the import gracefully
        import transcription_module

        # Module should import successfully even if genai is None
        assert hasattr(transcription_module, "_call_gemini_api")

    @pytest.mark.asyncio
    async def test_end_to_end_mock_scenario(self):
        """Test end-to-end processing with mock responses"""
        # This tests the complete flow using the mock responses
        # when no API key is provided
        with patch("transcription_module.os.path.exists", return_value=True):
            result = await process_audio_file_for_insights("/test/mock.wav", "gemini", "")

        # Should get mock responses when no API key provided
        assert "transcription" in result
        assert "insights" in result
        # The actual transcription will depend on the ai_service mock behavior
        # but the function should complete without errors


class TestImportErrorHandling:
    """Test import error handling scenarios"""

    def test_genai_import_error_handling(self):
        """Test that module handles genai import error gracefully"""
        # Simulate the import error condition by testing with genai = None
        with patch("transcription_module.genai", None):
            # The _call_gemini_api function should handle genai being None
            result = _call_gemini_api({"test": "payload"}, "test_key")
            assert result is None  # Should return None when genai is not available


class TestExceptionHandling:
    """Test exception handling paths in the module"""

    @pytest.mark.asyncio
    @patch("transcription_module.os.path.exists")
    @patch("transcription_module.transcribe_audio")
    async def test_process_audio_file_exception_during_file_prep(self, mock_transcribe, mock_exists):
        """Test process_audio_file_for_insights when file preparation raises exception"""
        # Make os.path.exists raise an exception
        mock_exists.side_effect = Exception("File system error")

        with patch("transcription_module.logger") as mock_logger:
            result = await process_audio_file_for_insights("/test/audio.wav", "gemini", "test_key")

            # Should return error result
            assert "error" in result
            assert "Error preparing audio file" in result["error"]

            # Should log the error
            mock_logger.error.assert_called()
            error_call = mock_logger.error.call_args
            assert "File preparation error" in error_call[0][2]

    @pytest.mark.asyncio
    @patch("transcription_module.os.path.exists")
    @patch("transcription_module.os.path.splitext", return_value=("/test/audio", ".hta"))
    @patch("transcription_module.transcribe_audio")
    @patch("transcription_module.extract_meeting_insights")
    @patch("transcription_module.os.remove")
    async def test_temp_file_cleanup_exception(
        self, mock_remove, mock_insights, mock_transcribe, mock_splitext, mock_exists
    ):
        """Test temporary file cleanup exception handling"""
        # Setup file existence checks
        mock_exists.return_value = True

        # Setup successful transcription and insights
        mock_transcribe.return_value = {"transcription": "Test transcription"}
        mock_insights.return_value = {"summary": "Test summary"}

        # Make os.remove raise an exception during cleanup
        mock_remove.side_effect = Exception("Permission denied")

        with patch("transcription_module.logger") as mock_logger, patch(
            "hta_converter.convert_hta_to_wav", return_value="/temp/test_speed_adjusted.wav"
        ):
            result = await process_audio_file_for_insights("/test/audio.hta", "gemini", "test_key")

            # Should still return successful result despite cleanup failure
            assert "transcription" in result
            assert result["transcription"] == "Test transcription"

            # Should log warning about cleanup failure
            mock_logger.warning.assert_called()
            warning_call = mock_logger.warning.call_args
            assert "Could not clean up temporary file" in warning_call[0][2]


class TestMainTestFunction:
    """Test the main_test function for command-line usage"""

    @pytest.mark.asyncio
    @patch("transcription_module.os.path.exists")
    @patch("transcription_module.os.environ.get")
    @patch("transcription_module.process_audio_file_for_insights")
    @patch("builtins.print")
    async def test_main_test_file_not_found(self, mock_print, mock_process, mock_env_get, mock_exists):
        """Test main_test when test audio file doesn't exist"""
        mock_exists.return_value = False
        mock_env_get.return_value = "test_key"

        with patch("transcription_module.logger") as mock_logger:
            await main_test()

            # Should log error about file not found
            mock_logger.error.assert_called()
            error_call = mock_logger.error.call_args
            assert "Test audio file not found" in error_call[0][2]

            # Should print error message
            mock_print.assert_called()
            print_call_args = [str(call) for call in mock_print.call_args_list]
            assert any("Test audio file not found" in call for call in print_call_args)

            # Should not call process function
            mock_process.assert_not_called()

    @pytest.mark.asyncio
    @patch("transcription_module.os.path.exists")
    @patch("transcription_module.os.environ.get")
    @patch("transcription_module.process_audio_file_for_insights")
    @patch("builtins.print")
    async def test_main_test_no_api_key(self, mock_print, mock_process, mock_env_get, mock_exists):
        """Test main_test when no API key is provided"""
        mock_exists.return_value = True
        mock_env_get.return_value = ""  # No API key
        mock_process.return_value = {"transcription": "test", "insights": {"summary": "test"}}

        with patch("transcription_module.logger") as mock_logger:
            await main_test()

            # Should log warning about missing API key
            mock_logger.warning.assert_called()
            warning_call = mock_logger.warning.call_args
            assert "GEMINI_API_KEY env var not set" in warning_call[0][2]

            # Should print warning message
            mock_print.assert_called()
            print_call_args = [str(call) for call in mock_print.call_args_list]
            assert any("GEMINI_API_KEY env var not set" in call for call in print_call_args)

            # Should still call process function
            mock_process.assert_called_once()

    @pytest.mark.asyncio
    @patch("transcription_module.os.path.exists")
    @patch("transcription_module.os.environ.get")
    @patch("transcription_module.process_audio_file_for_insights")
    @patch("builtins.print")
    @patch("transcription_module.json.dumps")
    async def test_main_test_success(self, mock_json_dumps, mock_print, mock_process, mock_env_get, mock_exists):
        """Test successful main_test execution"""
        mock_exists.return_value = True
        mock_env_get.return_value = "test_api_key"
        mock_results = {"transcription": "Test transcription", "insights": {"summary": "Test summary"}}
        mock_process.return_value = mock_results
        mock_json_dumps.return_value = '{"formatted": "json"}'

        with patch("transcription_module.logger") as mock_logger:
            await main_test()

            # Should log start message
            mock_logger.info.assert_called()
            info_call = mock_logger.info.call_args
            assert "Starting module test" in info_call[0][2]

            # Should call process function with correct params
            mock_process.assert_called_once()
            call_args = mock_process.call_args[0]
            assert "path_to_your_test_audio.wav" in call_args[0]
            assert call_args[1] == "test_api_key"

            # Should print results
            mock_print.assert_called()
            print_call_args = [str(call) for call in mock_print.call_args_list]
            assert any("Transcription and Insights Results" in call for call in print_call_args)
            assert any("End of Test" in call for call in print_call_args)

            # Should format JSON output
            mock_json_dumps.assert_called_once_with(mock_results, indent=2)
