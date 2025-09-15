"""
Comprehensive tests for audio_player_enhanced.py

Following TDD principles to achieve 80% test coverage as mandated by .amazonq/rules/PYTHON.md
"""

import os
import tempfile
import unittest.mock as mock
from unittest.mock import MagicMock, Mock, patch

import pytest

# Mark as GUI test for architectural separation
pytestmark = pytest.mark.gui
from tests.helpers.optional import require
require("numpy", marker="gui")

import numpy as np

from audio_player_enhanced import (
    PYDUB_AVAILABLE,
    PYGAME_AVAILABLE,
    AudioPlaylist,
    AudioProcessor,
    AudioTrack,
    EnhancedAudioPlayer,
    PlaybackPosition,
    PlaybackState,
    RepeatMode,
)


class TestPlaybackState:
    """Test PlaybackState enum"""

    def test_playback_state_values(self):
        """Test PlaybackState enum has correct values"""
        assert PlaybackState.STOPPED.value == "stopped"
        assert PlaybackState.PLAYING.value == "playing"
        assert PlaybackState.PAUSED.value == "paused"
        assert PlaybackState.LOADING.value == "loading"


class TestRepeatMode:
    """Test RepeatMode enum"""

    def test_repeat_mode_values(self):
        """Test RepeatMode enum has correct values"""
        assert RepeatMode.OFF.value == "off"
        assert RepeatMode.ONE.value == "one"
        assert RepeatMode.ALL.value == "all"


class TestAudioTrack:
    """Test AudioTrack dataclass"""

    def test_default_audio_track(self):
        """Test default AudioTrack values"""
        track = AudioTrack(filepath="/test/file.wav", title="Test Track")
        assert track.filepath == "/test/file.wav"
        assert track.title == "Test Track"
        assert track.duration == 0.0
        assert track.size == 0
        assert track.format == ""
        assert track.sample_rate == 0
        assert track.channels == 0
        assert track.bitrate == 0

    def test_custom_audio_track(self):
        """Test custom AudioTrack values"""
        track = AudioTrack(
            filepath="/test/file.wav",
            title="Test Track",
            duration=120.5,
            size=1024000,
            format=".wav",
            sample_rate=44100,
            channels=2,
            bitrate=1411200,
        )
        assert track.filepath == "/test/file.wav"
        assert track.title == "Test Track"
        assert track.duration == 120.5
        assert track.size == 1024000
        assert track.format == ".wav"
        assert track.sample_rate == 44100
        assert track.channels == 2
        assert track.bitrate == 1411200


class TestPlaybackPosition:
    """Test PlaybackPosition dataclass"""

    def test_playback_position(self):
        """Test PlaybackPosition creation"""
        position = PlaybackPosition(current_time=30.0, total_time=120.0, percentage=25.0)
        assert position.current_time == 30.0
        assert position.total_time == 120.0
        assert position.percentage == 25.0


class TestAudioProcessor:
    """Test AudioProcessor static methods"""

    @patch("os.path.exists")
    @patch("os.path.getsize")
    def test_get_audio_info_file_not_exists(self, mock_getsize, mock_exists):
        """Test get_audio_info with non-existent file"""
        mock_exists.return_value = False

        result = AudioProcessor.get_audio_info("/nonexistent/file.wav")

        assert result == {}

    @patch("os.path.exists")
    @patch("os.path.getsize")
    @patch("os.path.splitext")
    def test_get_audio_info_basic(self, mock_splitext, mock_getsize, mock_exists):
        """Test get_audio_info basic functionality"""
        mock_exists.return_value = True
        mock_getsize.return_value = 1024000
        mock_splitext.return_value = ("/test/file", ".wav")

        with patch("audio_player_enhanced.PYDUB_AVAILABLE", False):
            result = AudioProcessor.get_audio_info("/test/file.wav")

        assert result["filepath"] == "/test/file.wav"
        assert result["size"] == 1024000
        assert result["format"] == ".wav"
        assert result["duration"] == 0.0

    @patch("os.path.exists")
    @patch("os.path.getsize")
    @patch("os.path.splitext")
    def test_get_audio_info_with_pydub(self, mock_splitext, mock_getsize, mock_exists):
        """Test get_audio_info with pydub available"""
        mock_exists.return_value = True
        mock_getsize.return_value = 1024000
        mock_splitext.return_value = ("/test/file", ".wav")

        with patch("audio_player_enhanced.PYDUB_AVAILABLE", True), patch(
            "audio_player_enhanced.AudioSegment"
        ) as mock_audio_segment:
            mock_from_file = mock_audio_segment.from_file

            mock_audio = Mock()
            mock_audio.frame_rate = 44100
            mock_audio.channels = 2
            mock_audio.sample_width = 2
            mock_audio.__len__ = Mock(return_value=120000)  # 2 minutes in ms
            mock_from_file.return_value = mock_audio

            result = AudioProcessor.get_audio_info("/test/file.wav")

        assert result["duration"] == 120.0  # Should convert ms to seconds
        assert result["sample_rate"] == 44100
        assert result["channels"] == 2
        assert result["bitrate"] == 44100 * 2 * 8 * 2  # sample_rate * sample_width * 8 * channels

    @patch("os.path.exists")
    @patch("os.path.getsize")
    @patch("os.path.splitext")
    def test_get_audio_info_wav_fallback(self, mock_splitext, mock_getsize, mock_exists):
        """Test get_audio_info WAV fallback when pydub fails"""
        mock_exists.return_value = True
        mock_getsize.return_value = 1024000
        mock_splitext.return_value = ("/test/file", ".wav")

        with patch("audio_player_enhanced.PYDUB_AVAILABLE", True), patch(
            "audio_player_enhanced.AudioSegment"
        ) as mock_audio_segment, patch("audio_player_enhanced.wave.open") as mock_wave_open:
            mock_audio_segment.from_file.side_effect = Exception("Pydub failed")

            mock_wav_file = Mock()
            mock_wav_file.getnframes.return_value = 88200  # 2 seconds at 44.1kHz
            mock_wav_file.getframerate.return_value = 44100
            mock_wav_file.getnchannels.return_value = 2
            mock_wav_file.getsampwidth.return_value = 2
            mock_wave_open.return_value.__enter__.return_value = mock_wav_file

            result = AudioProcessor.get_audio_info("/test/file.wav")

        assert result["duration"] == 2.0  # frames / sample_rate
        assert result["sample_rate"] == 44100
        assert result["channels"] == 2

    def test_convert_audio_format_no_pydub(self):
        """Test convert_audio_format without pydub"""
        with patch("audio_player_enhanced.PYDUB_AVAILABLE", False):
            result = AudioProcessor.convert_audio_format("/input.wav", "/output.mp3", "mp3")

        assert result is False

    def test_convert_audio_format_success(self):
        """Test successful audio format conversion"""
        with patch("audio_player_enhanced.PYDUB_AVAILABLE", True), patch(
            "audio_player_enhanced.AudioSegment"
        ) as mock_audio_segment:
            mock_from_file = mock_audio_segment.from_file

            mock_audio = Mock()
            mock_from_file.return_value = mock_audio

            result = AudioProcessor.convert_audio_format("/input.wav", "/output.mp3", "mp3")

        assert result is True
        mock_from_file.assert_called_once_with("/input.wav")
        mock_audio.export.assert_called_once_with("/output.mp3", format="mp3")

    def test_convert_audio_format_error(self):
        """Test audio format conversion with error"""
        with patch("audio_player_enhanced.PYDUB_AVAILABLE", True), patch(
            "audio_player_enhanced.AudioSegment"
        ) as mock_audio_segment:
            mock_audio_segment.from_file.side_effect = Exception("Conversion failed")

            result = AudioProcessor.convert_audio_format("/input.wav", "/output.mp3", "mp3")

        assert result is False

    def test_normalize_audio_no_pydub(self):
        """Test normalize_audio without pydub"""
        with patch("audio_player_enhanced.PYDUB_AVAILABLE", False):
            result = AudioProcessor.normalize_audio("/input.wav", "/output.wav", -20.0)

        assert result is False

    def test_normalize_audio_success(self):
        """Test successful audio normalization"""
        with patch("audio_player_enhanced.PYDUB_AVAILABLE", True), patch(
            "audio_player_enhanced.AudioSegment"
        ) as mock_audio_segment:
            mock_from_file = mock_audio_segment.from_file

            mock_audio = Mock()
            mock_normalized = Mock()
            mock_with_gain = Mock()
            mock_normalized.dBFS = -15.0
            mock_audio.normalize.return_value = mock_normalized
            mock_normalized.apply_gain.return_value = mock_with_gain
            mock_from_file.return_value = mock_audio

            result = AudioProcessor.normalize_audio("/input.wav", "/output.wav", -20.0)

        assert result is True
        mock_audio.normalize.assert_called_once()
        mock_normalized.apply_gain.assert_called_once_with(-5.0)  # -20.0 - (-15.0)
        mock_with_gain.export.assert_called_once_with("/output.wav", format="wav")

    def test_normalize_audio_error(self):
        """Test audio normalization with error"""
        with patch("audio_player_enhanced.PYDUB_AVAILABLE", True), patch(
            "audio_player_enhanced.AudioSegment"
        ) as mock_audio_segment:
            mock_audio_segment.from_file.side_effect = Exception("Normalization failed")

            result = AudioProcessor.normalize_audio("/input.wav", "/output.wav", -20.0)

        assert result is False

    def test_extract_waveform_data_wav_file(self):
        """Test extract_waveform_data for WAV files"""
        mock_sample_rate = 44100
        mock_data = np.array([1000, 2000, 3000, 4000], dtype=np.int16)

        with patch("audio_player_enhanced.wavfile.read") as mock_wavfile_read:
            mock_wavfile_read.return_value = (mock_sample_rate, mock_data)

            waveform, sample_rate = AudioProcessor.extract_waveform_data("/test/file.wav", 1000)

        assert sample_rate == mock_sample_rate
        # Should be normalized to float32 in range [-1, 1]
        expected_data = mock_data.astype(np.float32) / 32768.0
        assert np.allclose(waveform, expected_data)

    def test_extract_waveform_data_wav_stereo(self):
        """Test extract_waveform_data for stereo WAV files"""
        mock_sample_rate = 44100
        mock_data = np.array([[1000, 1500], [2000, 2500]], dtype=np.int16)  # Stereo

        with patch("audio_player_enhanced.wavfile.read") as mock_wavfile_read:
            mock_wavfile_read.return_value = (mock_sample_rate, mock_data)

            waveform, sample_rate = AudioProcessor.extract_waveform_data("/test/file.wav", 1000)

        assert sample_rate == mock_sample_rate
        # Should be converted to mono by averaging channels
        # np.mean converts to float64, and normalization only applies to int16/int32
        # So the output is the raw mean values as float64, then cast to array
        expected_mono = np.mean(mock_data, axis=1)  # This is [1250.0, 2250.0] as float64
        assert np.allclose(waveform, expected_mono)

    def test_extract_waveform_data_with_pydub(self):
        """Test extract_waveform_data with pydub for non-WAV files"""
        with patch("audio_player_enhanced.PYDUB_AVAILABLE", True), patch(
            "audio_player_enhanced.AudioSegment"
        ) as mock_audio_segment:
            mock_from_file = mock_audio_segment.from_file

            mock_audio = Mock()
            mock_audio.channels = 1
            mock_audio.sample_width = 2
            mock_audio.frame_rate = 44100
            mock_audio.get_array_of_samples.return_value = [1000, 2000, 3000, 4000]
            mock_from_file.return_value = mock_audio

            waveform, sample_rate = AudioProcessor.extract_waveform_data("/test/file.mp3", 1000)

        assert sample_rate == 44100
        # Should normalize based on sample width
        expected_data = np.array([1000, 2000, 3000, 4000], dtype=np.float32) / (2 ** (2 * 8 - 1))
        assert np.allclose(waveform, expected_data)

    def test_extract_waveform_data_no_libraries(self):
        """Test extract_waveform_data when no libraries available"""
        with patch("audio_player_enhanced.PYDUB_AVAILABLE", False):
            waveform, sample_rate = AudioProcessor.extract_waveform_data("/test/file.mp3", 1000)

        assert len(waveform) == 0
        assert sample_rate == 0

    def test_extract_waveform_data_error(self):
        """Test extract_waveform_data with error"""
        with patch("audio_player_enhanced.wavfile.read", side_effect=Exception("Read failed")):
            waveform, sample_rate = AudioProcessor.extract_waveform_data("/test/file.wav", 1000)

        assert len(waveform) == 0
        assert sample_rate == 0

    def test_extract_waveform_data_wave_module_fallback(self):
        """Test extract_waveform_data using wave module when scipy fails with numba circular import"""
        # Simulate numba circular import error from scipy
        numba_error = Exception(
            "cannot import name 'ComplexModel' from partially initialized module 'numba.core.datamodel.models'"
        )

        with patch("audio_player_enhanced.wave.open") as mock_wave_open:
            mock_wav_file = Mock()
            mock_wav_file.readframes.return_value = b"\x00\x10\x00\x20\x00\x30\x00\x40"  # 4 int16 samples
            mock_wav_file.getframerate.return_value = 44100
            mock_wav_file.getnchannels.return_value = 1
            mock_wav_file.getsampwidth.return_value = 2
            mock_wave_open.return_value.__enter__.return_value = mock_wav_file

            # Make scipy.io.wavfile.read fail with numba error, forcing wave module fallback
            with patch("audio_player_enhanced.wavfile.read", side_effect=numba_error):
                waveform, sample_rate = AudioProcessor.extract_waveform_data("/test/file.wav", 1000)

        assert sample_rate == 44100
        assert len(waveform) == 4
        # Should be normalized int16 values
        expected = np.array([0x1000, 0x2000, 0x3000, 0x4000], dtype=np.float32) / 32768.0
        assert np.allclose(waveform, expected)

    def test_extract_waveform_data_downsampling(self):
        """Test extract_waveform_data with downsampling for large files"""
        mock_sample_rate = 44100
        # Create large data array that needs downsampling
        mock_data = np.random.randint(-1000, 1000, size=10000, dtype=np.int16)

        with patch("audio_player_enhanced.wavfile.read") as mock_wavfile_read:
            mock_wavfile_read.return_value = (mock_sample_rate, mock_data)

            waveform, sample_rate = AudioProcessor.extract_waveform_data("/test/file.wav", 1000)

        assert sample_rate == mock_sample_rate
        # Should be downsampled to max_points
        assert len(waveform) <= 1000


class TestAudioPlaylist:
    """Test AudioPlaylist class"""

    def test_initialization(self):
        """Test AudioPlaylist initialization"""
        playlist = AudioPlaylist()
        assert playlist.tracks == []
        assert playlist.current_index == -1
        assert playlist.repeat_mode == RepeatMode.OFF
        assert playlist.shuffle_enabled is False
        assert playlist._shuffle_history == []

    @patch.object(AudioProcessor, "get_audio_info")
    def test_add_track_success(self, mock_get_info):
        """Test successful track addition"""
        playlist = AudioPlaylist()
        mock_info = {
            "duration": 120.0,
            "size": 1024000,
            "format": ".wav",
            "sample_rate": 44100,
            "channels": 2,
            "bitrate": 1411200,
        }
        mock_get_info.return_value = mock_info

        result = playlist.add_track("/test/file.wav")

        assert result is True
        assert len(playlist.tracks) == 1
        track = playlist.tracks[0]
        assert track.filepath == "/test/file.wav"
        assert track.title == "file.wav"
        assert track.duration == 120.0

    @patch.object(AudioProcessor, "get_audio_info")
    def test_add_track_failure(self, mock_get_info):
        """Test track addition failure"""
        playlist = AudioPlaylist()
        mock_get_info.return_value = {}  # Empty info indicates failure

        result = playlist.add_track("/test/file.wav")

        assert result is False
        assert len(playlist.tracks) == 0

    def test_remove_track_success(self):
        """Test successful track removal"""
        playlist = AudioPlaylist()
        # Manually add tracks for testing
        track1 = AudioTrack("/test/file1.wav", "Track 1")
        track2 = AudioTrack("/test/file2.wav", "Track 2")
        playlist.tracks = [track1, track2]
        playlist.current_index = 1

        result = playlist.remove_track(0)

        assert result is True
        assert len(playlist.tracks) == 1
        assert playlist.tracks[0].title == "Track 2"
        assert playlist.current_index == 0  # Adjusted after removal

    def test_remove_track_invalid_index(self):
        """Test track removal with invalid index"""
        playlist = AudioPlaylist()
        track = AudioTrack("/test/file.wav", "Track")
        playlist.tracks = [track]

        result = playlist.remove_track(5)  # Invalid index

        assert result is False
        assert len(playlist.tracks) == 1

    def test_remove_current_track(self):
        """Test removing currently selected track"""
        playlist = AudioPlaylist()
        track1 = AudioTrack("/test/file1.wav", "Track 1")
        track2 = AudioTrack("/test/file2.wav", "Track 2")
        playlist.tracks = [track1, track2]
        playlist.current_index = 1

        result = playlist.remove_track(1)

        assert result is True
        assert len(playlist.tracks) == 1
        assert playlist.current_index == -1  # Reset when current track removed

    def test_get_current_track(self):
        """Test get_current_track method"""
        playlist = AudioPlaylist()
        track = AudioTrack("/test/file.wav", "Track")
        playlist.tracks = [track]
        playlist.current_index = 0

        current = playlist.get_current_track()

        assert current == track

    def test_get_current_track_invalid_index(self):
        """Test get_current_track with invalid index"""
        playlist = AudioPlaylist()
        track = AudioTrack("/test/file.wav", "Track")
        playlist.tracks = [track]
        playlist.current_index = -1

        current = playlist.get_current_track()

        assert current is None

    def test_next_track_repeat_one(self):
        """Test next_track with repeat one mode"""
        playlist = AudioPlaylist()
        track = AudioTrack("/test/file.wav", "Track")
        playlist.tracks = [track]
        playlist.current_index = 0
        playlist.repeat_mode = RepeatMode.ONE

        next_track = playlist.next_track()

        assert next_track == track
        assert playlist.current_index == 0

    def test_next_track_sequential(self):
        """Test next_track in sequential mode"""
        playlist = AudioPlaylist()
        track1 = AudioTrack("/test/file1.wav", "Track 1")
        track2 = AudioTrack("/test/file2.wav", "Track 2")
        playlist.tracks = [track1, track2]
        playlist.current_index = 0

        next_track = playlist.next_track()

        assert next_track == track2
        assert playlist.current_index == 1

    def test_next_track_end_of_playlist_repeat_all(self):
        """Test next_track at end of playlist with repeat all"""
        playlist = AudioPlaylist()
        track1 = AudioTrack("/test/file1.wav", "Track 1")
        track2 = AudioTrack("/test/file2.wav", "Track 2")
        playlist.tracks = [track1, track2]
        playlist.current_index = 1
        playlist.repeat_mode = RepeatMode.ALL

        next_track = playlist.next_track()

        assert next_track == track1
        assert playlist.current_index == 0

    def test_next_track_end_of_playlist_no_repeat(self):
        """Test next_track at end of playlist without repeat"""
        playlist = AudioPlaylist()
        track1 = AudioTrack("/test/file1.wav", "Track 1")
        track2 = AudioTrack("/test/file2.wav", "Track 2")
        playlist.tracks = [track1, track2]
        playlist.current_index = 1

        next_track = playlist.next_track()

        assert next_track is None

    def test_next_track_shuffle(self):
        """Test next_track with shuffle enabled"""
        playlist = AudioPlaylist()
        track1 = AudioTrack("/test/file1.wav", "Track 1")
        track2 = AudioTrack("/test/file2.wav", "Track 2")
        track3 = AudioTrack("/test/file3.wav", "Track 3")
        playlist.tracks = [track1, track2, track3]
        playlist.current_index = 0
        playlist.shuffle_enabled = True

        with patch("random.choice", return_value=2):
            next_track = playlist.next_track()

        assert next_track == track3
        assert playlist.current_index == 2
        assert 0 in playlist._shuffle_history  # Previous index added to history

    def test_previous_track_sequential(self):
        """Test previous_track in sequential mode"""
        playlist = AudioPlaylist()
        track1 = AudioTrack("/test/file1.wav", "Track 1")
        track2 = AudioTrack("/test/file2.wav", "Track 2")
        playlist.tracks = [track1, track2]
        playlist.current_index = 1

        prev_track = playlist.previous_track()

        assert prev_track == track1
        assert playlist.current_index == 0

    def test_previous_track_shuffle_with_history(self):
        """Test previous_track with shuffle and history"""
        playlist = AudioPlaylist()
        track1 = AudioTrack("/test/file1.wav", "Track 1")
        track2 = AudioTrack("/test/file2.wav", "Track 2")
        playlist.tracks = [track1, track2]
        playlist.current_index = 1
        playlist.shuffle_enabled = True
        playlist._shuffle_history = [0]  # Previous track was index 0

        prev_track = playlist.previous_track()

        assert prev_track == track1
        assert playlist.current_index == 0
        assert playlist._shuffle_history == []

    def test_set_current_track(self):
        """Test set_current_track method"""
        playlist = AudioPlaylist()
        track1 = AudioTrack("/test/file1.wav", "Track 1")
        track2 = AudioTrack("/test/file2.wav", "Track 2")
        playlist.tracks = [track1, track2]

        result = playlist.set_current_track(1)

        assert result == track2
        assert playlist.current_index == 1

    def test_set_current_track_invalid_index(self):
        """Test set_current_track with invalid index"""
        playlist = AudioPlaylist()
        track = AudioTrack("/test/file.wav", "Track")
        playlist.tracks = [track]

        result = playlist.set_current_track(5)

        assert result is None
        assert playlist.current_index == -1  # Unchanged

    def test_clear(self):
        """Test clear method"""
        playlist = AudioPlaylist()
        track = AudioTrack("/test/file.wav", "Track")
        playlist.tracks = [track]
        playlist.current_index = 0
        playlist._shuffle_history = [1, 2]

        playlist.clear()

        assert playlist.tracks == []
        assert playlist.current_index == -1
        assert playlist._shuffle_history == []

    def test_get_total_duration(self):
        """Test get_total_duration method"""
        playlist = AudioPlaylist()
        track1 = AudioTrack("/test/file1.wav", "Track 1", duration=120.0)
        track2 = AudioTrack("/test/file2.wav", "Track 2", duration=180.0)
        playlist.tracks = [track1, track2]

        total = playlist.get_total_duration()

        assert total == 300.0


class TestEnhancedAudioPlayer:
    """Test EnhancedAudioPlayer class"""

    def test_initialization(self):
        """Test EnhancedAudioPlayer initialization"""
        with patch.object(EnhancedAudioPlayer, "_initialize_audio_backend"):
            player = EnhancedAudioPlayer()

        assert isinstance(player.playlist, AudioPlaylist)
        assert player.state == PlaybackState.STOPPED
        assert player.current_position == 0.0
        assert player.volume == 0.7
        assert player.playback_speed == 1.0
        assert player.is_muted is False
        assert player.previous_volume == 0.7

    def test_initialization_with_parent(self):
        """Test EnhancedAudioPlayer initialization with parent widget"""
        mock_parent = Mock()
        with patch.object(EnhancedAudioPlayer, "_initialize_audio_backend"):
            player = EnhancedAudioPlayer(mock_parent)

        assert player.parent == mock_parent

    @patch("audio_player_enhanced.PYGAME_AVAILABLE", False)
    def test_initialize_audio_backend_no_pygame(self):
        """Test _initialize_audio_backend without pygame"""
        player = EnhancedAudioPlayer()
        # Should complete without error even when pygame not available

    @patch("audio_player_enhanced.PYGAME_AVAILABLE", True)
    @patch("audio_player_enhanced.pygame")
    def test_initialize_audio_backend_success(self, mock_pygame):
        """Test successful _initialize_audio_backend"""
        mock_pygame.mixer.get_init.return_value = None  # Not initialized

        player = EnhancedAudioPlayer()

        mock_pygame.mixer.init.assert_called_once_with(frequency=44100, size=-16, channels=2, buffer=1024)

    @patch("audio_player_enhanced.PYGAME_AVAILABLE", True)
    @patch("audio_player_enhanced.pygame")
    def test_initialize_audio_backend_already_initialized(self, mock_pygame):
        """Test _initialize_audio_backend when already initialized"""
        mock_pygame.mixer.get_init.return_value = (44100, -16, 2)  # Already initialized

        player = EnhancedAudioPlayer()

        mock_pygame.mixer.init.assert_not_called()

    @patch.object(EnhancedAudioPlayer, "_initialize_audio_backend")
    @patch.object(AudioPlaylist, "add_track")
    def test_load_track_success(self, mock_add_track, mock_init_backend):
        """Test successful track loading"""
        player = EnhancedAudioPlayer()
        mock_add_track.return_value = True

        with patch.object(player, "stop") as mock_stop:
            result = player.load_track("/test/file.wav")

        assert result is True
        mock_stop.assert_called_once()
        mock_add_track.assert_called_once_with("/test/file.wav")
        assert player.current_position == 0.0

    @patch.object(EnhancedAudioPlayer, "_initialize_audio_backend")
    @patch.object(AudioPlaylist, "add_track")
    def test_load_track_failure(self, mock_add_track, mock_init_backend):
        """Test track loading failure"""
        player = EnhancedAudioPlayer()
        mock_add_track.return_value = False

        with patch.object(player, "stop"):
            result = player.load_track("/test/file.wav")

        assert result is False

    @patch.object(EnhancedAudioPlayer, "_initialize_audio_backend")
    @patch.object(AudioPlaylist, "add_track")
    def test_load_playlist_success(self, mock_add_track, mock_init_backend):
        """Test successful playlist loading"""
        player = EnhancedAudioPlayer()
        mock_add_track.side_effect = [True, True, False]  # 2 succeed, 1 fails

        with patch.object(player, "stop"):
            result = player.load_playlist(["/file1.wav", "/file2.wav", "/file3.wav"])

        assert result == 2
        assert mock_add_track.call_count == 3

    @patch.object(EnhancedAudioPlayer, "_initialize_audio_backend")
    def test_set_volume(self, mock_init_backend):
        """Test set_volume method"""
        player = EnhancedAudioPlayer()

        with patch("audio_player_enhanced.PYGAME_AVAILABLE", True), patch(
            "audio_player_enhanced.pygame"
        ) as mock_pygame:
            mock_pygame.mixer.get_init.return_value = (44100, -16, 2)

            result = player.set_volume(0.8)

        assert result is True
        assert player.volume == 0.8
        mock_pygame.mixer.music.set_volume.assert_called_once_with(0.8)

    @patch.object(EnhancedAudioPlayer, "_initialize_audio_backend")
    def test_set_volume_clamping(self, mock_init_backend):
        """Test set_volume with value clamping"""
        player = EnhancedAudioPlayer()

        # Test upper bound
        result1 = player.set_volume(1.5)
        assert result1 is True
        assert player.volume == 1.0

        # Test lower bound
        result2 = player.set_volume(-0.5)
        assert result2 is True
        assert player.volume == 0.0

    @patch.object(EnhancedAudioPlayer, "_initialize_audio_backend")
    def test_toggle_mute(self, mock_init_backend):
        """Test toggle_mute method"""
        player = EnhancedAudioPlayer()
        player.volume = 0.7

        with patch("audio_player_enhanced.PYGAME_AVAILABLE", True), patch(
            "audio_player_enhanced.pygame"
        ) as mock_pygame:
            mock_pygame.mixer.get_init.return_value = (44100, -16, 2)

            # Test muting
            result1 = player.toggle_mute()
            assert result1 is True
            assert player.is_muted is True
            assert player.previous_volume == 0.7
            mock_pygame.mixer.music.set_volume.assert_called_with(0.0)

            # Test unmuting
            result2 = player.toggle_mute()
            assert result2 is True
            assert player.is_muted is False
            assert player.volume == 0.7

    @patch.object(EnhancedAudioPlayer, "_initialize_audio_backend")
    def test_set_repeat_mode(self, mock_init_backend):
        """Test set_repeat_mode method"""
        player = EnhancedAudioPlayer()

        player.set_repeat_mode(RepeatMode.ALL)

        assert player.playlist.repeat_mode == RepeatMode.ALL

    @patch.object(EnhancedAudioPlayer, "_initialize_audio_backend")
    def test_set_shuffle(self, mock_init_backend):
        """Test set_shuffle method"""
        player = EnhancedAudioPlayer()

        player.set_shuffle(True)

        assert player.playlist.shuffle_enabled is True

    @patch.object(EnhancedAudioPlayer, "_initialize_audio_backend")
    def test_get_current_track(self, mock_init_backend):
        """Test get_current_track method"""
        player = EnhancedAudioPlayer()
        mock_track = AudioTrack("/test/file.wav", "Test Track")

        with patch.object(player.playlist, "get_current_track", return_value=mock_track):
            result = player.get_current_track()

        assert result == mock_track

    @patch.object(EnhancedAudioPlayer, "_initialize_audio_backend")
    def test_get_position(self, mock_init_backend):
        """Test get_position method"""
        player = EnhancedAudioPlayer()
        player.current_position = 30.0
        mock_track = AudioTrack("/test/file.wav", "Test Track", duration=120.0)

        with patch.object(player.playlist, "get_current_track", return_value=mock_track):
            position = player.get_position()

        assert position.current_time == 30.0
        assert position.total_time == 120.0
        assert position.percentage == 25.0

    @patch.object(EnhancedAudioPlayer, "_initialize_audio_backend")
    def test_get_position_no_track(self, mock_init_backend):
        """Test get_position with no current track"""
        player = EnhancedAudioPlayer()
        player.current_position = 30.0

        with patch.object(player.playlist, "get_current_track", return_value=None):
            position = player.get_position()

        assert position.current_time == 30.0
        assert position.total_time == 0.0
        assert position.percentage == 0.0

    @patch.object(EnhancedAudioPlayer, "_initialize_audio_backend")
    def test_cleanup(self, mock_init_backend):
        """Test cleanup method"""
        player = EnhancedAudioPlayer()

        with patch.object(player, "stop") as mock_stop, patch.object(
            player, "_stop_position_thread"
        ) as mock_stop_thread, patch("audio_player_enhanced.PYGAME_AVAILABLE", True), patch(
            "audio_player_enhanced.pygame"
        ) as mock_pygame:
            mock_pygame.mixer.get_init.return_value = (44100, -16, 2)

            player.cleanup()

        mock_stop.assert_called_once()
        mock_stop_thread.assert_called_once()
        mock_pygame.mixer.quit.assert_called_once()


class TestImportErrorHandling:
    """Test import error handling for optional dependencies"""

    def test_pygame_import_error_handling(self):
        """Test behavior when pygame is not available"""
        # Test the code paths when PYGAME_AVAILABLE is False
        with patch("audio_player_enhanced.PYGAME_AVAILABLE", False):
            with patch("audio_player_enhanced.pygame", None):
                # Test that EnhancedAudioPlayer handles missing pygame gracefully
                player = EnhancedAudioPlayer()

                # Test that initialization still works but audio backend fails
                # The player should handle missing pygame gracefully
                assert player.state == PlaybackState.STOPPED

    def test_pydub_import_error_handling(self):
        """Test behavior when pydub is not available"""
        with patch("audio_player_enhanced.PYDUB_AVAILABLE", False):
            with patch("audio_player_enhanced.pydub", None):
                # Test that AudioProcessor handles missing pydub gracefully
                processor = AudioProcessor()

                # Should handle missing pydub gracefully
                # Methods using format conversion should use fallbacks
                result = processor.convert_audio_format("/test/input.wav", "/test/output.mp3", "mp3")
                # Should return False when pydub is unavailable
                assert result is False

    def test_availability_flags_are_boolean(self):
        """Test that availability flags are boolean values"""
        assert isinstance(PYGAME_AVAILABLE, bool)
        assert isinstance(PYDUB_AVAILABLE, bool)


class TestErrorHandlingPaths:
    """Test error handling in various methods"""

    def test_enhanced_audio_player_load_audio_exception(self):
        """Test EnhancedAudioPlayer load_audio exception handling"""
        player = EnhancedAudioPlayer()

        # Test loading track with non-existent file
        result = player.load_track("/nonexistent/file.wav")

        # Should return False for non-existent file
        assert result is False

    def test_enhanced_audio_player_initialize_without_pygame(self):
        """Test audio system initialization without pygame"""
        with patch("audio_player_enhanced.PYGAME_AVAILABLE", False):
            player = EnhancedAudioPlayer()

            # Test that player handles missing pygame gracefully
            # The player should still initialize but audio backend won't work
            assert player.state == PlaybackState.STOPPED

    def test_audio_processor_extract_waveform_exception(self):
        """Test AudioProcessor waveform extraction exception handling"""
        processor = AudioProcessor()

        # Test with invalid file path
        result = processor.extract_waveform_data("/invalid/path.wav")

        # Should return empty array and default sample rate on error
        assert len(result[0]) == 0
        assert result[1] in [44100, 0]  # May return 0 or default

    def test_audio_processor_convert_format_exception(self):
        """Test AudioProcessor format conversion exception handling"""
        processor = AudioProcessor()

        # Test with invalid paths
        result = processor.convert_audio_format("/invalid/input.wav", "/invalid/output.mp3", "mp3")

        # Should return False on error
        assert result is False

    def test_audio_track_duration_calculation_exception(self):
        """Test AudioTrack duration calculation with invalid file"""
        # Test with non-existent file path
        track = AudioTrack(filepath="/nonexistent/file.wav", title="Test Track")

        # Duration should default to 0.0 for invalid files
        assert track.duration == 0.0

    def test_audio_playlist_error_handling(self):
        """Test AudioPlaylist error handling scenarios"""
        playlist = AudioPlaylist()

        # Test removing track that doesn't exist
        result = playlist.remove_track(999)  # Invalid index
        assert result is False

        # Test setting current track with invalid index
        result = playlist.set_current_track(-1)  # Invalid index
        assert result is None

        # Test next/previous on empty playlist
        next_track = playlist.next_track()
        assert next_track is None

        prev_track = playlist.previous_track()
        assert prev_track is None


class TestEnhancedAudioPlayerAdditionalCoverage:
    """Additional tests to improve coverage for EnhancedAudioPlayer"""

    def test_playback_controls_without_loaded_audio(self):
        """Test playback controls when no audio is loaded"""
        player = EnhancedAudioPlayer()

        # Test play without loaded audio
        result = player.play()
        assert result is False

        # Test pause without loaded audio
        result = player.pause()
        assert result is False

        # Test stop without loaded audio
        result = player.stop()
        assert result is True  # Stop should always succeed

        # Test seek without loaded audio
        result = player.seek(10.0)
        assert result is False

    def test_volume_and_speed_edge_cases(self):
        """Test volume and speed controls with edge cases"""
        player = EnhancedAudioPlayer()

        # Test volume with extreme values
        player.set_volume(-0.5)  # Negative volume
        assert player.volume >= 0.0

        player.set_volume(2.0)  # Volume > 1.0
        assert player.volume <= 1.0

        # Test speed reset functionality
        old_speed = player.playback_speed
        player.reset_speed()
        # Speed should be reset to default (1.0)
        assert player.playback_speed == 1.0

    def test_position_tracking_edge_cases(self):
        """Test position tracking edge cases"""
        player = EnhancedAudioPlayer()

        # Test position when no audio is loaded
        position = player.get_position()
        assert position.current_time == 0.0
        assert position.total_time == 0.0
        assert position.percentage == 0.0

    def test_audio_system_reinitialization(self):
        """Test audio system reinitialization scenarios"""
        with patch("audio_player_enhanced.PYGAME_AVAILABLE", True):
            with patch("audio_player_enhanced.pygame") as mock_pygame:
                # Test successful initialization
                mock_pygame.mixer.init.return_value = None
                mock_pygame.mixer.get_init.return_value = (44100, -16, 2)

                player = EnhancedAudioPlayer()
                # Player should initialize successfully with mocked pygame
                assert player.state == PlaybackState.STOPPED
                # Backend initialization should be called
                mock_pygame.mixer.get_init.assert_called()
