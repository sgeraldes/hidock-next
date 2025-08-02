"""
Comprehensive tests for audio_processing_advanced.py

Following TDD principles to achieve 80% test coverage as mandated by .amazonq/rules/PYTHON.md
"""

import os
import tempfile
import unittest.mock as mock
from unittest.mock import MagicMock, Mock, patch

import numpy as np
import pytest

from audio_processing_advanced import (
    ADVANCED_AUDIO_AVAILABLE,
    NOISEREDUCE_AVAILABLE,
    PYDUB_AVAILABLE,
    AudioEnhancer,
    AudioFormatConverter,
    AudioProcessingSettings,
    NoiseReductionMethod,
    ProcessingQuality,
    ProcessingResult,
    convert_audio_format,
    enhance_audio_file,
    get_audio_analysis,
)


class TestProcessingQuality:
    """Test ProcessingQuality enum"""

    def test_processing_quality_values(self):
        """Test ProcessingQuality enum has correct values"""
        assert ProcessingQuality.FAST.value == "fast"
        assert ProcessingQuality.BALANCED.value == "balanced"
        assert ProcessingQuality.HIGH_QUALITY.value == "high_quality"


class TestNoiseReductionMethod:
    """Test NoiseReductionMethod enum"""

    def test_noise_reduction_method_values(self):
        """Test NoiseReductionMethod enum has correct values"""
        assert NoiseReductionMethod.SPECTRAL_SUBTRACTION.value == "spectral_subtraction"
        assert NoiseReductionMethod.WIENER_FILTER.value == "wiener_filter"
        assert NoiseReductionMethod.ADAPTIVE_FILTER.value == "adaptive_filter"
        assert NoiseReductionMethod.DEEP_LEARNING.value == "deep_learning"


class TestAudioProcessingSettings:
    """Test AudioProcessingSettings dataclass"""

    def test_default_settings(self):
        """Test default AudioProcessingSettings values"""
        settings = AudioProcessingSettings()
        assert settings.quality == ProcessingQuality.BALANCED
        assert settings.preserve_dynamics is True
        assert settings.target_sample_rate is None
        assert settings.target_bit_depth == 16
        assert settings.normalize_audio is True
        assert settings.target_lufs == -23.0
        assert settings.noise_reduction_strength == 0.5
        assert settings.silence_threshold == -40.0
        assert settings.silence_min_duration == 0.5

    def test_custom_settings(self):
        """Test custom AudioProcessingSettings values"""
        settings = AudioProcessingSettings(
            quality=ProcessingQuality.HIGH_QUALITY,
            preserve_dynamics=False,
            target_sample_rate=48000,
            target_bit_depth=24,
            normalize_audio=False,
            target_lufs=-16.0,
            noise_reduction_strength=0.8,
            silence_threshold=-50.0,
            silence_min_duration=1.0,
        )
        assert settings.quality == ProcessingQuality.HIGH_QUALITY
        assert settings.preserve_dynamics is False
        assert settings.target_sample_rate == 48000
        assert settings.target_bit_depth == 24
        assert settings.normalize_audio is False
        assert settings.target_lufs == -16.0
        assert settings.noise_reduction_strength == 0.8
        assert settings.silence_threshold == -50.0
        assert settings.silence_min_duration == 1.0


class TestProcessingResult:
    """Test ProcessingResult dataclass"""

    def test_default_processing_result(self):
        """Test default ProcessingResult values"""
        result = ProcessingResult(success=True)
        assert result.success is True
        assert result.output_path is None
        assert result.original_duration == 0.0
        assert result.processed_duration == 0.0
        assert result.noise_reduction_db == 0.0
        assert result.silence_removed_seconds == 0.0
        assert result.dynamic_range_db == 0.0
        assert result.peak_level_db == 0.0
        assert result.rms_level_db == 0.0
        assert result.error_message is None

    def test_custom_processing_result(self):
        """Test custom ProcessingResult values"""
        result = ProcessingResult(
            success=False,
            output_path="/test/output.wav",
            original_duration=10.5,
            processed_duration=9.2,
            noise_reduction_db=3.5,
            silence_removed_seconds=1.3,
            dynamic_range_db=15.2,
            peak_level_db=-6.1,
            rms_level_db=-18.4,
            error_message="Test error message",
        )
        assert result.success is False
        assert result.output_path == "/test/output.wav"
        assert result.original_duration == 10.5
        assert result.processed_duration == 9.2
        assert result.noise_reduction_db == 3.5
        assert result.silence_removed_seconds == 1.3
        assert result.dynamic_range_db == 15.2
        assert result.peak_level_db == -6.1
        assert result.rms_level_db == -18.4
        assert result.error_message == "Test error message"


class TestAudioEnhancer:
    """Test AudioEnhancer class"""

    def test_initialization_default_settings(self):
        """Test AudioEnhancer initialization with default settings"""
        enhancer = AudioEnhancer()
        assert isinstance(enhancer.settings, AudioProcessingSettings)
        assert enhancer.settings.quality == ProcessingQuality.BALANCED
        assert enhancer.temp_files == []

    def test_initialization_custom_settings(self):
        """Test AudioEnhancer initialization with custom settings"""
        custom_settings = AudioProcessingSettings(quality=ProcessingQuality.HIGH_QUALITY)
        enhancer = AudioEnhancer(custom_settings)
        assert enhancer.settings == custom_settings
        assert enhancer.settings.quality == ProcessingQuality.HIGH_QUALITY
        assert enhancer.temp_files == []

    @patch("os.path.exists")
    @patch("os.remove")
    def test_cleanup_temp_files_success(self, mock_remove, mock_exists):
        """Test successful cleanup of temporary files"""
        enhancer = AudioEnhancer()
        enhancer.temp_files = ["/tmp/test1.wav", "/tmp/test2.wav"]
        mock_exists.return_value = True

        enhancer.cleanup_temp_files()

        assert mock_remove.call_count == 2
        mock_remove.assert_any_call("/tmp/test1.wav")
        mock_remove.assert_any_call("/tmp/test2.wav")
        assert enhancer.temp_files == []

    @patch("os.path.exists")
    @patch("os.remove")
    def test_cleanup_temp_files_with_missing_files(self, mock_remove, mock_exists):
        """Test cleanup when some temporary files don't exist"""
        enhancer = AudioEnhancer()
        enhancer.temp_files = ["/tmp/test1.wav", "/tmp/test2.wav"]
        mock_exists.side_effect = [True, False]

        enhancer.cleanup_temp_files()

        assert mock_remove.call_count == 1
        mock_remove.assert_called_once_with("/tmp/test1.wav")
        assert enhancer.temp_files == []

    @patch("os.path.exists")
    @patch("os.remove")
    @patch("audio_processing_advanced.logger")
    def test_cleanup_temp_files_with_errors(self, mock_logger, mock_remove, mock_exists):
        """Test cleanup with file removal errors"""
        enhancer = AudioEnhancer()
        enhancer.temp_files = ["/tmp/test1.wav"]
        mock_exists.return_value = True
        mock_remove.side_effect = OSError("Permission denied")

        enhancer.cleanup_temp_files()

        mock_logger.warning.assert_called_once()
        assert enhancer.temp_files == []

    @patch("os.path.exists")
    def test_process_audio_file_missing_input(self, mock_exists):
        """Test process_audio_file with missing input file"""
        enhancer = AudioEnhancer()
        mock_exists.return_value = False

        result = enhancer.process_audio_file("/nonexistent/input.wav", "/tmp/output.wav")

        assert result.success is False
        assert "Failed to load audio file" in result.error_message

    @patch("os.path.exists")
    def test_process_audio_file_load_error(self, mock_exists):
        """Test process_audio_file with audio loading error"""
        enhancer = AudioEnhancer()
        mock_exists.return_value = True

        with patch.object(enhancer, "_load_audio", side_effect=Exception("Failed to load audio")):
            result = enhancer.process_audio_file("/test/input.wav", "/tmp/output.wav")

        assert result.success is False
        assert "Failed to load audio" in result.error_message

    @patch("os.path.exists")
    def test_process_audio_file_success(self, mock_exists):
        """Test successful audio file processing"""
        enhancer = AudioEnhancer()
        mock_exists.return_value = True
        mock_audio_data = np.array([0.1, 0.2, 0.3, 0.4])
        mock_sample_rate = 44100

        with patch.object(enhancer, "_load_audio", return_value=(mock_audio_data, mock_sample_rate)), patch.object(
            enhancer, "_save_audio"
        ) as mock_save:
            result = enhancer.process_audio_file("/test/input.wav", "/tmp/output.wav")

        assert result.success is True
        assert result.output_path == "/tmp/output.wav"
        assert result.original_duration > 0

    @patch("os.path.exists")
    def test_load_audio_with_librosa(self, mock_exists):
        """Test _load_audio method with librosa available"""
        enhancer = AudioEnhancer()
        mock_exists.return_value = True
        mock_audio_data = np.array([0.1, 0.2, 0.3, 0.4])
        mock_sample_rate = 44100

        with patch("audio_processing_advanced.librosa") as mock_librosa:
            mock_librosa.load.return_value = (mock_audio_data, mock_sample_rate)

            audio_data, sample_rate = enhancer._load_audio("/test/input.wav")

            assert np.array_equal(audio_data, mock_audio_data)
            assert sample_rate == mock_sample_rate
            mock_librosa.load.assert_called_once_with("/test/input.wav", sr=None, mono=False)

    @patch("os.path.exists")
    def test_load_audio_wav_fallback(self, mock_exists):
        """Test _load_audio fallback to scipy for WAV files"""
        enhancer = AudioEnhancer()
        mock_exists.return_value = True
        mock_audio_data = np.array([1000, 2000, 3000, 4000], dtype=np.int16)
        mock_sample_rate = 44100

        with patch("audio_processing_advanced.librosa", None), patch(
            "audio_processing_advanced.wavfile.read"
        ) as mock_wavfile_read:
            mock_wavfile_read.return_value = (mock_sample_rate, mock_audio_data)

            audio_data, sample_rate = enhancer._load_audio("/test/input.wav")

            assert sample_rate == mock_sample_rate
            # Should be converted to float and normalized
            expected_data = mock_audio_data.astype(np.float32) / 32768.0
            assert np.allclose(audio_data, expected_data)

    def test_load_audio_unsupported_format(self):
        """Test _load_audio with unsupported format"""
        enhancer = AudioEnhancer()

        with patch("audio_processing_advanced.librosa", None):
            with pytest.raises(Exception, match="Unsupported audio format"):
                enhancer._load_audio("/test/input.mp3")

    def test_save_audio_with_soundfile(self):
        """Test _save_audio method with soundfile available"""
        enhancer = AudioEnhancer()
        mock_audio_data = np.array([0.1, 0.2, 0.3, 0.4])
        mock_sample_rate = 44100

        with patch("audio_processing_advanced.sf") as mock_sf:
            enhancer._save_audio(mock_audio_data, mock_sample_rate, "/test/output.wav")

            mock_sf.write.assert_called_once_with(
                "/test/output.wav", mock_audio_data, mock_sample_rate, subtype="PCM_16"
            )

    def test_save_audio_scipy_fallback(self):
        """Test _save_audio fallback to scipy wavfile"""
        enhancer = AudioEnhancer()
        mock_audio_data = np.array([0.1, 0.2, 0.3, 0.4])
        mock_sample_rate = 44100

        with patch("audio_processing_advanced.sf", None), patch(
            "audio_processing_advanced.wavfile.write"
        ) as mock_wavfile_write:
            enhancer._save_audio(mock_audio_data, mock_sample_rate, "/test/output.wav")

            # Should convert to int16
            expected_data = (mock_audio_data * 32767).astype(np.int16)
            mock_wavfile_write.assert_called_once()
            args, kwargs = mock_wavfile_write.call_args
            assert args[0] == "/test/output.wav"
            assert args[1] == mock_sample_rate
            assert np.array_equal(args[2], expected_data)

    def test_analyze_audio_success(self):
        """Test _analyze_audio method with valid audio data"""
        enhancer = AudioEnhancer()
        mock_audio_data = np.array([0.1, -0.2, 0.3, -0.4, 0.5])
        mock_sample_rate = 44100

        with patch("audio_processing_advanced.signal.welch") as mock_welch:
            mock_welch.return_value = (np.array([100, 200, 300]), np.array([0.1, 0.2, 0.3]))

            result = enhancer._analyze_audio(mock_audio_data, mock_sample_rate)

            assert "peak_level_db" in result
            assert "rms_level_db" in result
            assert "dynamic_range_db" in result
            assert "spectral_centroid" in result
            assert "duration" in result
            assert result["duration"] == len(mock_audio_data) / mock_sample_rate

    def test_analyze_audio_error_handling(self):
        """Test _analyze_audio error handling"""
        enhancer = AudioEnhancer()
        mock_audio_data = np.array([0.1, 0.2, 0.3])

        with patch("audio_processing_advanced.signal.welch", side_effect=Exception("Analysis failed")):
            result = enhancer._analyze_audio(mock_audio_data, 44100)

            # Should return default values on error
            assert result["peak_level_db"] == 0
            assert result["rms_level_db"] == 0
            assert result["dynamic_range_db"] == 0
            assert result["spectral_centroid"] == 0
            assert result["duration"] == 0

    def test_reduce_noise_with_noisereduce(self):
        """Test _reduce_noise with noisereduce library"""
        enhancer = AudioEnhancer()
        mock_audio_data = np.array([0.1, 0.2, 0.3, 0.4])
        mock_reduced_audio = np.array([0.05, 0.15, 0.25, 0.35])

        with patch("audio_processing_advanced.NOISEREDUCE_AVAILABLE", True), patch(
            "audio_processing_advanced.nr", create=True
        ) as mock_nr:
            mock_nr.reduce_noise.return_value = mock_reduced_audio

            result_audio, reduction_db = enhancer._reduce_noise(mock_audio_data, 44100, 0.5)

            assert np.array_equal(result_audio, mock_reduced_audio)
            assert reduction_db >= 0  # Should calculate some reduction
            mock_nr.reduce_noise.assert_called_once()

    def test_reduce_noise_fallback_spectral_subtraction(self):
        """Test _reduce_noise fallback to spectral subtraction"""
        enhancer = AudioEnhancer()
        mock_audio_data = np.array([0.1, 0.2, 0.3, 0.4])

        with patch("audio_processing_advanced.NOISEREDUCE_AVAILABLE", False), patch.object(
            enhancer, "_spectral_subtraction"
        ) as mock_spectral:
            mock_spectral.return_value = (mock_audio_data, 3.0)

            result_audio, reduction_db = enhancer._reduce_noise(mock_audio_data, 44100, 0.5)

            mock_spectral.assert_called_once_with(mock_audio_data, 44100, 0.5)
            assert reduction_db == 3.0

    def test_spectral_subtraction(self):
        """Test _spectral_subtraction method"""
        enhancer = AudioEnhancer()
        # Create longer audio data for proper STFT
        mock_audio_data = np.random.random(4096) * 0.1

        with patch("scipy.signal.stft") as mock_stft, patch("scipy.signal.istft") as mock_istft:
            # Mock STFT response
            mock_freqs = np.linspace(0, 22050, 513)
            mock_times = np.linspace(0, 1, 10)
            mock_stft_data = np.random.random((513, 10)).astype(np.complex128)
            mock_stft.return_value = (mock_freqs, mock_times, mock_stft_data)

            # Mock ISTFT response - return tuple with correct structure
            mock_istft.return_value = (mock_times, mock_audio_data)

            result_audio, reduction_db = enhancer._spectral_subtraction(mock_audio_data, 44100, 0.5)

            mock_stft.assert_called_once()
            mock_istft.assert_called_once()
            assert len(result_audio) == len(mock_audio_data)
            assert isinstance(reduction_db, (int, float))

    def test_remove_silence(self):
        """Test _remove_silence method"""
        enhancer = AudioEnhancer()
        # Create audio with silence (low values) and speech (higher values)
        silence = np.random.random(1000) * 0.001  # Very quiet
        speech = np.random.random(1000) * 0.1  # Louder
        mock_audio_data = np.concatenate([silence, speech, silence])

        result_audio, silence_removed = enhancer._remove_silence(mock_audio_data, 44100, -40.0, 0.01)

        # Should remove some silence
        assert len(result_audio) <= len(mock_audio_data)
        assert silence_removed >= 0

    def test_enhance_audio_quality(self):
        """Test _enhance_audio_quality method"""
        enhancer = AudioEnhancer()
        mock_audio_data = np.random.random(1000) * 0.1

        with patch("audio_processing_advanced.signal.butter") as mock_butter, patch(
            "audio_processing_advanced.signal.sosfilt"
        ) as mock_sosfilt, patch.object(enhancer, "_apply_compression") as mock_compression, patch.object(
            enhancer, "_apply_deemphasis"
        ) as mock_deemphasis:

            mock_butter.return_value = np.array([[1, 2, 3, 4, 5, 6]])
            mock_sosfilt.return_value = mock_audio_data
            mock_compression.return_value = mock_audio_data
            mock_deemphasis.return_value = mock_audio_data

            enhancer.settings.quality = ProcessingQuality.HIGH_QUALITY
            result = enhancer._enhance_audio_quality(mock_audio_data, 44100)

            # Should call filters and processing
            assert mock_butter.call_count >= 1  # High and low pass filters
            assert mock_sosfilt.call_count >= 1
            mock_compression.assert_called_once()
            mock_deemphasis.assert_called_once()

    def test_apply_compression(self):
        """Test _apply_compression method"""
        enhancer = AudioEnhancer()
        # Create audio with peaks above threshold
        mock_audio_data = np.array([-0.8, -0.1, 0.0, 0.1, 0.8])

        result = enhancer._apply_compression(mock_audio_data, ratio=2.0, threshold=-20.0)

        # Should compress loud parts
        assert len(result) == len(mock_audio_data)
        # Peaks should be reduced
        assert np.max(np.abs(result)) <= np.max(np.abs(mock_audio_data))

    def test_apply_deemphasis(self):
        """Test _apply_deemphasis method"""
        enhancer = AudioEnhancer()
        mock_audio_data = np.array([0.1, 0.2, 0.3, 0.4, 0.5])

        result = enhancer._apply_deemphasis(mock_audio_data, 44100)

        assert len(result) == len(mock_audio_data)
        assert result[0] == mock_audio_data[0]  # First sample unchanged

    def test_normalize_audio(self):
        """Test _normalize_audio method"""
        enhancer = AudioEnhancer()
        mock_audio_data = np.array([0.01, 0.02, 0.03, 0.04])

        result = enhancer._normalize_audio(mock_audio_data, -20.0)

        # Should amplify the audio
        assert np.max(np.abs(result)) > np.max(np.abs(mock_audio_data))
        # Should not clip
        assert np.max(np.abs(result)) <= 0.95

    def test_normalize_audio_zero_rms(self):
        """Test _normalize_audio with zero RMS (silent audio)"""
        enhancer = AudioEnhancer()
        mock_audio_data = np.zeros(100)

        result = enhancer._normalize_audio(mock_audio_data, -20.0)

        # Should return original silent audio
        assert np.array_equal(result, mock_audio_data)

    def test_convert_format_success(self):
        """Test convert_format method with pydub"""
        enhancer = AudioEnhancer()

        with patch("audio_processing_advanced.PYDUB_AVAILABLE", True), patch(
            "audio_processing_advanced.AudioSegment.from_file"
        ) as mock_from_file:

            mock_audio = Mock()
            mock_audio.frame_rate = 44100
            mock_audio.set_frame_rate.return_value = mock_audio
            mock_audio.set_sample_width.return_value = mock_audio
            mock_from_file.return_value = mock_audio

            result = enhancer.convert_format("/input.wav", "/output.mp3", "mp3", 48000, 16)

            assert result is True
            mock_from_file.assert_called_once_with("/input.wav")
            mock_audio.export.assert_called_once_with("/output.mp3", format="mp3")

    def test_convert_format_fallback(self):
        """Test convert_format fallback without pydub"""
        enhancer = AudioEnhancer()
        mock_audio_data = np.array([0.1, 0.2, 0.3])

        with patch("audio_processing_advanced.PYDUB_AVAILABLE", False), patch.object(
            enhancer, "_load_audio"
        ) as mock_load, patch.object(enhancer, "_save_audio") as mock_save:

            mock_load.return_value = (mock_audio_data, 44100)

            result = enhancer.convert_format("/input.wav", "/output.wav", "wav")

            assert result is True
            mock_load.assert_called_once_with("/input.wav")
            mock_save.assert_called_once_with(mock_audio_data, 44100, "/output.wav")

    def test_batch_process(self):
        """Test batch_process method"""
        enhancer = AudioEnhancer()
        input_files = ["/file1.wav", "/file2.wav"]

        with patch.object(enhancer, "process_audio_file") as mock_process:
            mock_result1 = ProcessingResult(success=True, output_path="/out1.wav")
            mock_result2 = ProcessingResult(success=True, output_path="/out2.wav")
            mock_process.side_effect = [mock_result1, mock_result2]

            results = enhancer.batch_process(input_files, "/output")

            assert len(results) == 2
            assert results[0].success
            assert results[1].success
            assert mock_process.call_count == 2


class TestAudioFormatConverter:
    """Test AudioFormatConverter class"""

    def test_initialization(self):
        """Test AudioFormatConverter initialization"""
        converter = AudioFormatConverter()
        assert converter.temp_files == []
        assert "wav" in converter.SUPPORTED_FORMATS
        assert "mp3" in converter.SUPPORTED_FORMATS

    def test_convert_with_pydub_mp3_high_quality(self):
        """Test convert method with pydub for MP3 high quality"""
        converter = AudioFormatConverter()

        with patch("audio_processing_advanced.PYDUB_AVAILABLE", True), patch(
            "audio_processing_advanced.AudioSegment.from_file"
        ) as mock_from_file:

            mock_audio = Mock()
            mock_from_file.return_value = mock_audio

            result = converter.convert("/input.wav", "/output.mp3", "mp3", "high")

            assert result is True
            mock_audio.export.assert_called_once()
            export_args = mock_audio.export.call_args
            assert export_args[0] == ("/output.mp3",)
            assert export_args[1]["format"] == "mp3"
            assert export_args[1]["bitrate"] == "320k"

    def test_convert_unsupported_format(self):
        """Test convert with unsupported format"""
        converter = AudioFormatConverter()

        result = converter.convert("/input.wav", "/output.xyz", "xyz")

        assert result is False

    def test_convert_basic_wav_only(self):
        """Test _convert_basic method (WAV only)"""
        converter = AudioFormatConverter()

        with patch("audio_processing_advanced.AudioEnhancer") as mock_enhancer_class:
            mock_enhancer = Mock()
            mock_enhancer._load_audio.return_value = (np.array([0.1, 0.2]), 44100)
            mock_enhancer_class.return_value = mock_enhancer

            result = converter._convert_basic("/input.wav", "/output.wav", "wav")

            assert result is True
            mock_enhancer._load_audio.assert_called_once_with("/input.wav")
            mock_enhancer._save_audio.assert_called_once()

    def test_convert_basic_unsupported(self):
        """Test _convert_basic with unsupported format"""
        converter = AudioFormatConverter()

        result = converter._convert_basic("/input.wav", "/output.mp3", "mp3")

        assert result is False

    def test_get_supported_formats(self):
        """Test get_supported_formats method"""
        converter = AudioFormatConverter()

        formats = converter.get_supported_formats()

        assert isinstance(formats, list)
        assert "wav" in formats
        assert "mp3" in formats
        assert "flac" in formats

    def test_cleanup_temp_files(self):
        """Test cleanup_temp_files method"""
        converter = AudioFormatConverter()
        converter.temp_files = ["/tmp/test1.wav", "/tmp/test2.wav"]

        with patch("os.path.exists") as mock_exists, patch("os.remove") as mock_remove:
            mock_exists.return_value = True

            converter.cleanup_temp_files()

            assert mock_remove.call_count == 2
            assert converter.temp_files == []


class TestUtilityFunctions:
    """Test utility functions"""

    @patch("audio_processing_advanced.AudioEnhancer")
    def test_enhance_audio_file(self, mock_enhancer_class):
        """Test enhance_audio_file utility function"""
        mock_enhancer = Mock()
        mock_result = ProcessingResult(success=True, output_path="/test/output.wav")
        mock_enhancer.process_audio_file.return_value = mock_result
        mock_enhancer_class.return_value = mock_enhancer

        result = enhance_audio_file("/test/input.wav", "/test/output.wav")

        assert result == mock_result
        mock_enhancer_class.assert_called_once()
        mock_enhancer.process_audio_file.assert_called_once_with("/test/input.wav", "/test/output.wav", None)

    @pytest.mark.skipif(not PYDUB_AVAILABLE, reason="pydub not available")
    @patch("audio_processing_advanced.AudioSegment.from_file")
    def test_convert_audio_format_success(self, mock_from_file):
        """Test successful audio format conversion"""
        mock_audio = Mock()
        mock_from_file.return_value = mock_audio

        result = convert_audio_format("/test/input.mp3", "/test/output.wav", "wav")

        assert result is True
        mock_from_file.assert_called_once_with("/test/input.mp3")
        mock_audio.export.assert_called_once_with("/test/output.wav", format="wav")

    @pytest.mark.skipif(not PYDUB_AVAILABLE, reason="pydub not available")
    @patch("audio_processing_advanced.AudioSegment.from_file")
    def test_convert_audio_format_error(self, mock_from_file):
        """Test audio format conversion with error"""
        mock_from_file.side_effect = Exception("Conversion failed")

        result = convert_audio_format("/test/input.mp3", "/test/output.wav", "wav")

        assert result is False

    @pytest.mark.skipif(PYDUB_AVAILABLE, reason="Testing when pydub unavailable")
    def test_convert_audio_format_pydub_unavailable(self):
        """Test audio format conversion when pydub is not available"""
        result = convert_audio_format("/test/input.mp3", "/test/output.wav", "wav")
        assert result is False

    def test_get_audio_analysis_success(self):
        """Test successful audio analysis"""
        mock_audio_data = np.array([0.1, -0.2, 0.3, -0.4, 0.5])
        mock_sample_rate = 44100

        with patch("audio_processing_advanced.AudioEnhancer") as mock_enhancer_class:
            mock_enhancer = Mock()
            mock_enhancer._load_audio.return_value = (mock_audio_data, mock_sample_rate)
            mock_enhancer._analyze_audio.return_value = {
                "duration": 0.1,
                "sample_rate": mock_sample_rate,
                "channels": 1,
                "peak_level_db": -6.0,
                "rms_level_db": -12.0,
                "dynamic_range_db": 6.0,
            }
            mock_enhancer_class.return_value = mock_enhancer

            analysis = get_audio_analysis("/test/input.wav")

            assert analysis["duration"] > 0
            assert analysis["sample_rate"] == mock_sample_rate
            assert analysis["channels"] == 1
            assert "peak_level_db" in analysis
            assert "rms_level_db" in analysis
            assert "dynamic_range_db" in analysis

    def test_get_audio_analysis_error(self):
        """Test audio analysis with loading error"""
        with patch("audio_processing_advanced.AudioEnhancer") as mock_enhancer_class:
            mock_enhancer = Mock()
            mock_enhancer._load_audio.side_effect = Exception("Failed to load")
            mock_enhancer_class.return_value = mock_enhancer

            analysis = get_audio_analysis("/test/input.wav")

            assert analysis == {}


class TestModuleConstants:
    """Test module-level constants and availability flags"""

    def test_availability_flags_are_boolean(self):
        """Test that availability flags are boolean values"""
        assert isinstance(ADVANCED_AUDIO_AVAILABLE, bool)
        assert isinstance(NOISEREDUCE_AVAILABLE, bool)
        assert isinstance(PYDUB_AVAILABLE, bool)
