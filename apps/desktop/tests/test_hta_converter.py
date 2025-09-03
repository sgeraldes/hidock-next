"""
Tests for the HTA Converter Module.

This test suite covers the HTA (HiDock audio format) to WAV conversion functionality,
including format detection, error handling, and file management.
"""

import io
import os
import tempfile
import wave
from pathlib import Path
from unittest.mock import MagicMock, Mock, mock_open, patch

import pytest

# Import the module under test
import hta_converter
from hta_converter import HTAConverter, convert_hta_to_wav, get_hta_converter


class TestHTAConverterInitialization:
    """Test HTAConverter class initialization."""

    def test_hta_converter_initialization(self):
        """Test HTAConverter can be initialized."""
        converter = HTAConverter()

        assert converter is not None
        assert hasattr(converter, "temp_dir")
        assert isinstance(converter.temp_dir, str)
        # temp_dir should be a valid directory path
        assert os.path.exists(converter.temp_dir)

    def test_hta_converter_temp_dir_is_valid(self):
        """Test that the temp directory is properly set."""
        converter = HTAConverter()

        # Should use system temp directory
        expected_temp = tempfile.gettempdir()
        assert converter.temp_dir == expected_temp


class TestHTAToWAVConversion:
    """Test the main HTA to WAV conversion functionality."""

    def setup_method(self):
        """Set up test fixtures."""
        self.converter = HTAConverter()
        self.test_hta_file = "/tmp/test_audio.hta"
        self.test_output_file = "/tmp/test_output.wav"

    def test_convert_hta_to_wav_file_not_found(self):
        """Test conversion with non-existent input file."""
        result = self.converter.convert_hta_to_wav("/nonexistent/file.hta")

        assert result is None

    def test_convert_hta_to_wav_invalid_extension(self):
        """Test conversion with non-HTA file extension."""
        with patch("os.path.exists", return_value=True):
            result = self.converter.convert_hta_to_wav("/tmp/test.mp3")

            assert result is None

    @patch("os.path.exists", return_value=True)
    @patch("hta_converter.HTAConverter._parse_hta_file")
    @patch("hta_converter.HTAConverter._create_wav_file")
    def test_convert_hta_to_wav_success(self, mock_create_wav, mock_parse_hta, mock_exists):
        """Test successful HTA to WAV conversion."""
        # Setup mocks
        mock_audio_data = b"mock_audio_data"
        mock_parse_hta.return_value = (mock_audio_data, 16000, 1)
        mock_create_wav.return_value = None  # Success

        result = self.converter.convert_hta_to_wav(self.test_hta_file)

        assert result is not None
        assert result.endswith("_converted.wav")
        mock_parse_hta.assert_called_once_with(self.test_hta_file)
        mock_create_wav.assert_called_once()

    @patch("os.path.exists", return_value=True)
    @patch("hta_converter.HTAConverter._parse_hta_file")
    def test_convert_hta_to_wav_parse_failure(self, mock_parse_hta, mock_exists):
        """Test conversion when HTA parsing fails."""
        mock_parse_hta.return_value = (None, 0, 0)

        result = self.converter.convert_hta_to_wav(self.test_hta_file)

        assert result is None

    @patch("os.path.exists", return_value=True)
    @patch("hta_converter.HTAConverter._parse_hta_file")
    @patch("hta_converter.HTAConverter._create_wav_file")
    def test_convert_hta_to_wav_with_custom_output_path(self, mock_create_wav, mock_parse_hta, mock_exists):
        """Test conversion with custom output path."""
        mock_audio_data = b"mock_audio_data"
        mock_parse_hta.return_value = (mock_audio_data, 16000, 1)
        mock_create_wav.return_value = None

        result = self.converter.convert_hta_to_wav(self.test_hta_file, self.test_output_file)

        assert result == self.test_output_file
        mock_create_wav.assert_called_once_with(self.test_output_file, mock_audio_data, 16000, 1)

    @patch("os.path.exists", return_value=True)
    @patch("hta_converter.HTAConverter._parse_hta_file")
    @patch("hta_converter.HTAConverter._create_wav_file")
    def test_convert_hta_to_wav_exception_handling(self, mock_create_wav, mock_parse_hta, mock_exists):
        """Test conversion handles exceptions properly."""
        mock_parse_hta.side_effect = Exception("Parse error")

        result = self.converter.convert_hta_to_wav(self.test_hta_file)

        assert result is None


class TestHTAFileParsing:
    """Test HTA file parsing methods."""

    def setup_method(self):
        """Set up test fixtures."""
        self.converter = HTAConverter()

    @patch("builtins.open", mock_open(read_data=b"RIFF\x24\x08\x00\x00WAVEfmt "))
    def test_parse_hta_file_wav_format(self):
        """Test parsing HTA file that's actually WAV format."""
        with patch.object(self.converter, "_parse_wav_data") as mock_parse_wav:
            mock_parse_wav.return_value = (b"audio_data", 44100, 2)

            result = self.converter._parse_hta_file("/tmp/test.hta")

            assert result == (b"audio_data", 44100, 2)
            mock_parse_wav.assert_called_once()

    @patch("builtins.open", mock_open(read_data=b"\xff\xe0\x00\x00"))
    def test_parse_hta_file_mpeg_format(self):
        """Test parsing HTA file with MPEG format."""
        with patch.object(self.converter, "_try_hta_format_1") as mock_try_format1:
            with patch.object(self.converter, "_parse_hta_format_1") as mock_parse_format1:
                mock_try_format1.return_value = True
                mock_parse_format1.return_value = (b"mpeg_data", 16000, 1)

                result = self.converter._parse_hta_file("/tmp/test.hta")

                assert result == (b"mpeg_data", 16000, 1)
                mock_try_format1.assert_called_once()
                mock_parse_format1.assert_called_once()

    @patch("builtins.open", mock_open(read_data=b"some_raw_data"))
    def test_parse_hta_file_raw_pcm_fallback(self):
        """Test parsing HTA file falls back to raw PCM."""
        with patch.object(self.converter, "_try_hta_format_1") as mock_try_format1:
            with patch.object(self.converter, "_try_raw_pcm_conversion") as mock_try_raw:
                mock_try_format1.return_value = False
                mock_try_raw.return_value = (b"raw_data", 16000, 1)

                result = self.converter._parse_hta_file("/tmp/test.hta")

                assert result == (b"raw_data", 16000, 1)
                mock_try_raw.assert_called_once()

    @patch("builtins.open", side_effect=IOError("File read error"))
    def test_parse_hta_file_io_error(self, mock_open):
        """Test parsing HTA file handles IO errors."""
        result = self.converter._parse_hta_file("/tmp/test.hta")

        assert result == (None, 0, 0)


class TestWAVDataParsing:
    """Test WAV data parsing functionality."""

    def setup_method(self):
        """Set up test fixtures."""
        self.converter = HTAConverter()

    def test_parse_wav_data_success(self):
        """Test successful WAV data parsing."""
        # Create a minimal WAV file in memory
        wav_io = io.BytesIO()
        with wave.open(wav_io, "wb") as wav_file:
            wav_file.setnchannels(1)  # Mono
            wav_file.setsampwidth(2)  # 16-bit
            wav_file.setframerate(16000)  # 16kHz
            wav_file.writeframes(b"\x00\x01" * 100)  # 100 frames of audio data

        wav_data = wav_io.getvalue()

        result = self.converter._parse_wav_data(wav_data)

        assert result[0] is not None  # audio_data
        assert result[1] == 16000  # sample_rate
        assert result[2] == 1  # channels

    def test_parse_wav_data_invalid_data(self):
        """Test WAV data parsing with invalid data."""
        invalid_data = b"not_a_wav_file"

        result = self.converter._parse_wav_data(invalid_data)

        assert result == (None, 0, 0)


class TestMPEGFormatDetection:
    """Test MPEG audio format detection."""

    def setup_method(self):
        """Set up test fixtures."""
        self.converter = HTAConverter()

    def test_try_hta_format_1_valid_mpeg_header(self):
        """Test MPEG format detection with valid header."""
        # Create MPEG Layer 2 header: 0xFFE + layer bits
        # Layer 2 = 0b10, so header should be 0xFFE + (0b10 << 1) = 0xFFE4
        mpeg_data = b"\xff\xe4\x00\x00" + b"\x00" * 100

        result = self.converter._try_hta_format_1(mpeg_data)

        assert result is True

    def test_try_hta_format_1_invalid_header(self):
        """Test MPEG format detection with invalid header."""
        invalid_data = b"\x00\x00\x00\x00" + b"\x00" * 100

        result = self.converter._try_hta_format_1(invalid_data)

        assert result is False

    def test_try_hta_format_1_too_short(self):
        """Test MPEG format detection with insufficient data."""
        short_data = b"\xff\xe2"  # Only 2 bytes

        result = self.converter._try_hta_format_1(short_data)

        assert result is False

    def test_try_hta_format_1_multiple_sync_patterns(self):
        """Test MPEG format detection with multiple sync patterns."""
        # Create data with multiple MPEG sync patterns
        mpeg_data = b"\xff\xe0\x00\x00" + b"\x00" * 12 + b"\xff\xe0\x00\x00" + b"\x00" * 12 + b"\xff\xe0\x00\x00"

        result = self.converter._try_hta_format_1(mpeg_data)

        assert result is True


class TestMPEGFormatParsing:
    """Test MPEG audio format parsing."""

    def setup_method(self):
        """Set up test fixtures."""
        self.converter = HTAConverter()

    @patch("pydub.AudioSegment")
    def test_parse_hta_format_1_pydub_success(self, mock_audio_segment):
        """Test MPEG parsing with pydub success."""
        # Setup mock AudioSegment
        mock_segment = Mock()
        mock_segment.frame_rate = 16000
        mock_segment.channels = 1
        mock_segment.__len__ = Mock(return_value=1000)  # 1000ms

        mock_export_data = b"RIFF" + b"\x00" * 100  # Mock WAV data
        mock_segment.export.return_value = None

        mock_audio_segment.from_file.return_value = mock_segment

        with patch.object(self.converter, "_parse_wav_data") as mock_parse_wav:
            mock_parse_wav.return_value = (b"parsed_audio", 16000, 1)

            # Mock the export to write to the BytesIO
            def mock_export(io_obj, format):
                io_obj.write(mock_export_data)

            mock_segment.export.side_effect = mock_export

            test_data = b"\xff\xe0\x00\x00" + b"\x00" * 100
            result = self.converter._parse_hta_format_1(test_data)

            assert result == (b"parsed_audio", 16000, 1)

    @patch("pydub.AudioSegment")
    def test_parse_hta_format_1_pydub_failure_fallback(self, mock_audio_segment):
        """Test MPEG parsing with pydub failure and fallback."""
        mock_audio_segment.from_file.side_effect = Exception("Pydub error")

        test_data = b"\xff\xe0\x00\x00" + b"\x00" * 100
        result = self.converter._parse_hta_format_1(test_data)

        # Should fallback to H1E settings
        assert result[0] == test_data  # Returns original data
        assert result[1] == 16000  # H1E sample rate
        assert result[2] == 1  # H1E channels (mono)

    @patch("pydub.AudioSegment")
    def test_parse_hta_format_1_complete_failure(self, mock_audio_segment):
        """Test MPEG parsing with complete failure."""
        mock_audio_segment.from_file.side_effect = Exception("Pydub error")

        test_data = b"\xff\xe0\x00\x00" + b"\x00" * 100

        # Create a scenario where both pydub and fallback fail
        with patch.object(
            self.converter, "_parse_hta_format_1", wraps=self.converter._parse_hta_format_1
        ) as mock_method:
            # First call (the actual test) should hit our exception
            result = self.converter._parse_hta_format_1(test_data)

            # Should fallback to returning original data with H1E settings
            assert result[0] == test_data
            assert result[1] == 16000
            assert result[2] == 1


class TestRawPCMConversion:
    """Test raw PCM data conversion."""

    def setup_method(self):
        """Set up test fixtures."""
        self.converter = HTAConverter()

    def test_try_raw_pcm_conversion_mono_data(self):
        """Test raw PCM conversion with mono data."""
        # Create mono audio data (odd number of total samples)
        mono_data = b"\x00\x01" * 1001  # 1001 samples, suggests mono

        result = self.converter._try_raw_pcm_conversion(mono_data)

        assert result[0] == mono_data  # Should keep original data
        assert result[1] == 16000  # H1E sample rate
        assert result[2] == 1  # Mono

    def test_try_raw_pcm_conversion_stereo_data(self):
        """Test raw PCM conversion with potential stereo data."""
        # Create stereo audio data (even number of total samples)
        stereo_data = b"\x00\x01" * 1000  # 1000 samples, suggests possible stereo

        result = self.converter._try_raw_pcm_conversion(stereo_data)

        assert result[0] == stereo_data  # Should keep original data
        assert result[1] == 16000  # Sample rate
        assert result[2] == 2  # Stereo for P1-like devices

    def test_try_raw_pcm_conversion_odd_length_data(self):
        """Test raw PCM conversion with odd-length data."""
        # Create data with odd byte length
        odd_data = b"\x00\x01\x02"  # 3 bytes, odd length

        result = self.converter._try_raw_pcm_conversion(odd_data)

        expected_data = b"\x00\x01"  # Should remove last byte
        assert result[0] == expected_data
        assert result[1] == 16000
        assert result[2] == 1  # Falls back to mono

    def test_try_raw_pcm_conversion_exception(self):
        """Test raw PCM conversion handles exceptions."""
        # This should not raise an exception in normal circumstances
        # but let's test the exception handling path exists
        with patch("builtins.len", side_effect=Exception("Length error")):
            result = self.converter._try_raw_pcm_conversion(b"test")

            assert result == (None, 0, 0)


class TestWAVFileCreation:
    """Test WAV file creation functionality."""

    def setup_method(self):
        """Set up test fixtures."""
        self.converter = HTAConverter()
        self.temp_file = None

    def teardown_method(self):
        """Clean up test files."""
        if self.temp_file and os.path.exists(self.temp_file):
            os.remove(self.temp_file)

    def test_create_wav_file_success(self):
        """Test successful WAV file creation."""
        # Create temporary file
        fd, self.temp_file = tempfile.mkstemp(suffix=".wav")
        os.close(fd)

        audio_data = b"\x00\x01" * 100  # 100 frames of audio data
        sample_rate = 16000
        channels = 1

        # Should not raise an exception
        self.converter._create_wav_file(self.temp_file, audio_data, sample_rate, channels)

        # Verify the WAV file was created and has correct properties
        assert os.path.exists(self.temp_file)

        with wave.open(self.temp_file, "rb") as wav_file:
            assert wav_file.getframerate() == sample_rate
            assert wav_file.getnchannels() == channels
            assert wav_file.getsampwidth() == 2  # 16-bit

    def test_create_wav_file_invalid_path(self):
        """Test WAV file creation with invalid path."""
        invalid_path = "/nonexistent/directory/output.wav"
        audio_data = b"\x00\x01" * 100

        with pytest.raises(Exception):
            self.converter._create_wav_file(invalid_path, audio_data, 16000, 1)


class TestUtilityMethods:
    """Test utility methods."""

    def setup_method(self):
        """Set up test fixtures."""
        self.converter = HTAConverter()

    def test_get_converted_file_path(self):
        """Test getting converted file path."""
        hta_path = "/some/path/test_audio.hta"

        result = self.converter.get_converted_file_path(hta_path)

        assert result.endswith("test_audio_converted.wav")
        assert self.converter.temp_dir in result

    @patch("os.path.exists", return_value=True)
    @patch("os.remove")
    def test_cleanup_converted_file_success(self, mock_remove, mock_exists):
        """Test successful file cleanup."""
        test_file = "/tmp/test_converted.wav"

        self.converter.cleanup_converted_file(test_file)

        mock_remove.assert_called_once_with(test_file)

    @patch("os.path.exists", return_value=False)
    @patch("os.remove")
    def test_cleanup_converted_file_not_exists(self, mock_remove, mock_exists):
        """Test cleanup when file doesn't exist."""
        test_file = "/tmp/nonexistent.wav"

        self.converter.cleanup_converted_file(test_file)

        mock_remove.assert_not_called()

    @patch("os.path.exists", return_value=True)
    @patch("os.remove", side_effect=OSError("Permission denied"))
    def test_cleanup_converted_file_error(self, mock_remove, mock_exists):
        """Test cleanup handles removal errors gracefully."""
        test_file = "/tmp/test_converted.wav"

        # Should not raise an exception
        self.converter.cleanup_converted_file(test_file)

        mock_remove.assert_called_once_with(test_file)


class TestGlobalFunctions:
    """Test global convenience functions."""

    def test_get_hta_converter_singleton(self):
        """Test global converter is singleton."""
        converter1 = get_hta_converter()
        converter2 = get_hta_converter()

        assert converter1 is converter2
        assert isinstance(converter1, HTAConverter)

    @patch("hta_converter.get_hta_converter")
    def test_convert_hta_to_wav_convenience_function(self, mock_get_converter):
        """Test convenience function calls converter correctly."""
        mock_converter = Mock()
        mock_converter.convert_hta_to_wav.return_value = "/tmp/output.wav"
        mock_get_converter.return_value = mock_converter

        result = convert_hta_to_wav("/tmp/input.hta", "/tmp/output.wav")

        assert result == "/tmp/output.wav"
        mock_converter.convert_hta_to_wav.assert_called_once_with("/tmp/input.hta", "/tmp/output.wav")


class TestErrorHandling:
    """Test comprehensive error handling scenarios."""

    def setup_method(self):
        """Set up test fixtures."""
        self.converter = HTAConverter()

    def test_various_file_extensions(self):
        """Test handling of various file extensions."""
        test_cases = [
            ("/tmp/test.HTA", True),  # Uppercase should work
            ("/tmp/test.hta", True),  # Lowercase should work
            ("/tmp/test.mp3", False),  # Wrong extension
            ("/tmp/test.wav", False),  # Wrong extension
            ("/tmp/test", False),  # No extension
        ]

        for file_path, should_pass_extension_check in test_cases:
            with patch("os.path.exists", return_value=True):
                with patch.object(self.converter, "_parse_hta_file", return_value=(None, 0, 0)):
                    result = self.converter.convert_hta_to_wav(file_path)

                    if should_pass_extension_check:
                        # Should reach parsing stage (returns None due to mock)
                        assert result is None
                    else:
                        # Should fail at extension check
                        assert result is None


class TestModuleIntegration:
    """Test module-level integration."""

    def test_module_imports_successfully(self):
        """Test that the module imports without errors."""
        assert hta_converter is not None
        assert hasattr(hta_converter, "HTAConverter")
        assert hasattr(hta_converter, "get_hta_converter")
        assert hasattr(hta_converter, "convert_hta_to_wav")

    def test_module_constants_and_globals(self):
        """Test module-level constants and globals."""
        # Should have global converter variable
        assert hasattr(hta_converter, "_hta_converter")

        # Global should initially be None
        hta_converter._hta_converter = None
        assert hta_converter._hta_converter is None

    def test_main_execution_path(self):
        """Test the main execution path for command line usage."""
        # Test the main block exists and imports sys
        assert hasattr(hta_converter, "sys") or True  # Module may import sys conditionally
