"""
Enhanced Audio Player Module for HiDock Desktop Application

This module provides advanced audio playback capabilities including:
- Full-featured audio player with seek, volume, and speed controls
- Playlist functionality and sequential playback support
- Audio format conversion and optimization utilities
- Audio visualization and waveform display

Requirements: 9.3, 9.1, 9.2
"""

import os
import queue
import struct
import sys
import tempfile
import threading
import time
import wave
from dataclasses import dataclass
from enum import Enum
from typing import Callable, Dict, List, Optional, Tuple

import customtkinter as ctk
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg
from scipy import signal
from scipy.io import wavfile

try:
    import pygame
    import pygame.mixer

    PYGAME_AVAILABLE = True
except ImportError:
    pygame = None
    PYGAME_AVAILABLE = False

try:
    import pydub
    from pydub import AudioSegment

    PYDUB_AVAILABLE = True
except ImportError:
    pydub = None
    PYDUB_AVAILABLE = False

from config_and_logger import logger


class PlaybackState(Enum):
    """Enumeration for playback states"""

    STOPPED = "stopped"
    PLAYING = "playing"
    PAUSED = "paused"
    LOADING = "loading"


class RepeatMode(Enum):
    """Enumeration for repeat modes"""

    OFF = "off"
    ONE = "one"
    ALL = "all"


@dataclass
class AudioTrack:
    """Data class representing an audio track"""

    filepath: str
    title: str
    duration: float = 0.0
    size: int = 0
    format: str = ""
    sample_rate: int = 0
    channels: int = 0
    bitrate: int = 0


@dataclass
class PlaybackPosition:
    """Data class representing playback position"""

    current_time: float
    total_time: float
    percentage: float


class AudioProcessor:
    """Utility class for audio processing and conversion"""

    @staticmethod
    def get_audio_info(filepath: str) -> Dict:
        """Get detailed information about an audio file"""
        try:
            if not os.path.exists(filepath):
                return {}

            info = {
                "filepath": filepath,
                "size": os.path.getsize(filepath),
                "format": os.path.splitext(filepath)[1].lower(),
                "duration": 0.0,
                "sample_rate": 0,
                "channels": 0,
                "bitrate": 0,
            }

            # Try to get detailed info using pydub if available
            if PYDUB_AVAILABLE:
                try:
                    audio = AudioSegment.from_file(filepath)
                    info.update(
                        {
                            "duration": len(audio) / 1000.0,  # Convert ms to seconds
                            "sample_rate": audio.frame_rate,
                            "channels": audio.channels,
                            "bitrate": audio.frame_rate
                            * audio.sample_width
                            * 8
                            * audio.channels,
                        }
                    )
                except Exception as e:
                    logger.warning(
                        "AudioProcessor",
                        "get_audio_info",
                        f"Pydub failed for {filepath}: {e}",
                    )

            # Fallback for WAV files using wave module
            if info["format"] == ".wav" and info["duration"] == 0.0:
                try:
                    with wave.open(filepath, "rb") as wav_file:
                        frames = wav_file.getnframes()
                        sample_rate = wav_file.getframerate()
                        info.update(
                            {
                                "duration": frames / sample_rate,
                                "sample_rate": sample_rate,
                                "channels": wav_file.getnchannels(),
                                "bitrate": sample_rate
                                * wav_file.getsampwidth()
                                * 8
                                * wav_file.getnchannels(),
                            }
                        )
                except Exception as e:
                    logger.warning(
                        "AudioProcessor",
                        "get_audio_info",
                        f"Wave module failed for {filepath}: {e}",
                    )

            return info

        except Exception as e:
            logger.error(
                "AudioProcessor",
                "get_audio_info",
                f"Error getting audio info for {filepath}: {e}",
            )
            return {}

    @staticmethod
    def convert_audio_format(
        input_path: str, output_path: str, target_format: str = "wav"
    ) -> bool:
        """Convert audio file to target format"""
        if not PYDUB_AVAILABLE:
            logger.error(
                "AudioProcessor",
                "convert_audio_format",
                "Pydub not available for conversion",
            )
            return False

        try:
            audio = AudioSegment.from_file(input_path)
            audio.export(output_path, format=target_format)
            logger.info(
                "AudioProcessor",
                "convert_audio_format",
                f"Converted {input_path} to {output_path}",
            )
            return True
        except Exception as e:
            logger.error(
                "AudioProcessor", "convert_audio_format", f"Conversion failed: {e}"
            )
            return False

    @staticmethod
    def normalize_audio(
        input_path: str, output_path: str, target_dBFS: float = -20.0
    ) -> bool:
        """Normalize audio to target dBFS level"""
        if not PYDUB_AVAILABLE:
            logger.error(
                "AudioProcessor",
                "normalize_audio",
                "Pydub not available for normalization",
            )
            return False

        try:
            audio = AudioSegment.from_file(input_path)
            normalized_audio = audio.normalize()

            # Adjust to target dBFS
            change_in_dBFS = target_dBFS - normalized_audio.dBFS
            normalized_audio = normalized_audio.apply_gain(change_in_dBFS)

            normalized_audio.export(output_path, format="wav")
            logger.info(
                "AudioProcessor",
                "normalize_audio",
                f"Normalized {input_path} to {target_dBFS} dBFS",
            )
            return True
        except Exception as e:
            logger.error(
                "AudioProcessor", "normalize_audio", f"Normalization failed: {e}"
            )
            return False

    @staticmethod
    def extract_waveform_data(
        filepath: str, max_points: int = 1000
    ) -> Tuple[np.ndarray, int]:
        """Extract waveform data for visualization"""
        try:
            if filepath.lower().endswith(".wav"):
                sample_rate, data = wavfile.read(filepath)

                # Convert to mono if stereo
                if len(data.shape) > 1:
                    data = np.mean(data, axis=1)

                # Downsample for visualization if needed
                if len(data) > max_points:
                    step = len(data) // max_points
                    data = data[::step]

                # Normalize to [-1, 1]
                if data.dtype == np.int16:
                    data = data.astype(np.float32) / 32768.0
                elif data.dtype == np.int32:
                    data = data.astype(np.float32) / 2147483648.0

                return data, sample_rate

            elif PYDUB_AVAILABLE:
                audio = AudioSegment.from_file(filepath)

                # Convert to numpy array
                samples = audio.get_array_of_samples()
                data = np.array(samples, dtype=np.float32)

                # Convert to mono if stereo
                if audio.channels == 2:
                    data = data.reshape((-1, 2))
                    data = np.mean(data, axis=1)

                # Normalize
                data = data / (2 ** (audio.sample_width * 8 - 1))

                # Downsample for visualization
                if len(data) > max_points:
                    step = len(data) // max_points
                    data = data[::step]

                return data, audio.frame_rate

            else:
                logger.error(
                    "AudioProcessor",
                    "extract_waveform_data",
                    "No audio processing library available",
                )
                return np.array([]), 0

        except Exception as e:
            logger.error(
                "AudioProcessor",
                "extract_waveform_data",
                f"Error extracting waveform: {e}",
            )
            return np.array([]), 0


class AudioPlaylist:
    """Manages a playlist of audio tracks"""

    def __init__(self):
        self.tracks: List[AudioTrack] = []
        self.current_index: int = -1
        self.repeat_mode: RepeatMode = RepeatMode.OFF
        self.shuffle_enabled: bool = False
        self._shuffle_history: List[int] = []

    def add_track(self, filepath: str) -> bool:
        """Add a track to the playlist"""
        try:
            info = AudioProcessor.get_audio_info(filepath)
            if not info:
                return False

            track = AudioTrack(
                filepath=filepath,
                title=os.path.basename(filepath),
                duration=info.get("duration", 0.0),
                size=info.get("size", 0),
                format=info.get("format", ""),
                sample_rate=info.get("sample_rate", 0),
                channels=info.get("channels", 0),
                bitrate=info.get("bitrate", 0),
            )

            self.tracks.append(track)
            logger.info("AudioPlaylist", "add_track", f"Added track: {track.title}")
            return True

        except Exception as e:
            logger.error(
                "AudioPlaylist", "add_track", f"Error adding track {filepath}: {e}"
            )
            return False

    def remove_track(self, index: int) -> bool:
        """Remove a track from the playlist"""
        try:
            if 0 <= index < len(self.tracks):
                track = self.tracks.pop(index)

                # Adjust current index if necessary
                if index < self.current_index:
                    self.current_index -= 1
                elif index == self.current_index:
                    self.current_index = -1

                logger.info(
                    "AudioPlaylist", "remove_track", f"Removed track: {track.title}"
                )
                return True
            return False
        except Exception as e:
            logger.error(
                "AudioPlaylist",
                "remove_track",
                f"Error removing track at index {index}: {e}",
            )
            return False

    def get_current_track(self) -> Optional[AudioTrack]:
        """Get the currently selected track"""
        if 0 <= self.current_index < len(self.tracks):
            return self.tracks[self.current_index]
        return None

    def next_track(self) -> Optional[AudioTrack]:
        """Move to the next track based on repeat and shuffle settings"""
        if not self.tracks:
            return None

        if self.repeat_mode == RepeatMode.ONE:
            # Stay on current track
            return self.get_current_track()

        if self.shuffle_enabled:
            return self._next_shuffle_track()
        else:
            return self._next_sequential_track()

    def previous_track(self) -> Optional[AudioTrack]:
        """Move to the previous track"""
        if not self.tracks:
            return None

        if self.shuffle_enabled and self._shuffle_history:
            # Go back in shuffle history
            self.current_index = self._shuffle_history.pop()
        else:
            # Sequential previous
            self.current_index = (self.current_index - 1) % len(self.tracks)

        return self.get_current_track()

    def _next_sequential_track(self) -> Optional[AudioTrack]:
        """Get next track in sequential order"""
        if self.current_index < len(self.tracks) - 1:
            self.current_index += 1
        elif self.repeat_mode == RepeatMode.ALL:
            self.current_index = 0
        else:
            return None  # End of playlist

        return self.get_current_track()

    def _next_shuffle_track(self) -> Optional[AudioTrack]:
        """Get next track in shuffle mode"""
        if len(self.tracks) <= 1:
            return self.get_current_track()

        # Add current to history
        if self.current_index >= 0:
            self._shuffle_history.append(self.current_index)

        # Generate next random index (different from current)
        import random

        available_indices = list(range(len(self.tracks)))
        if self.current_index >= 0:
            available_indices.remove(self.current_index)

        self.current_index = random.choice(available_indices)
        return self.get_current_track()

    def set_current_track(self, index: int) -> Optional[AudioTrack]:
        """Set the current track by index"""
        if 0 <= index < len(self.tracks):
            self.current_index = index
            return self.get_current_track()
        return None

    def clear(self):
        """Clear the playlist"""
        self.tracks.clear()
        self.current_index = -1
        self._shuffle_history.clear()

    def get_total_duration(self) -> float:
        """Get total duration of all tracks in playlist"""
        return sum(track.duration for track in self.tracks)


class EnhancedAudioPlayer:
    """Enhanced audio player with advanced features"""

    def __init__(self, parent_widget=None):
        self.parent = parent_widget
        self.playlist = AudioPlaylist()
        self.state = PlaybackState.STOPPED
        self.current_position = 0.0
        self.volume = 0.7
        self.playback_speed = 1.0
        self.is_muted = False
        self.previous_volume = self.volume

        # Threading and events
        self.position_update_thread = None
        self.stop_position_thread = threading.Event()
        self.position_queue = queue.Queue()

        # Callbacks
        self.on_position_changed: Optional[Callable[[PlaybackPosition], None]] = None
        self.on_state_changed: Optional[Callable[[PlaybackState], None]] = None
        self.on_track_changed: Optional[Callable[[Optional[AudioTrack]], None]] = None
        self.on_playlist_changed: Optional[Callable[[], None]] = None

        # Initialize pygame mixer if available
        self._initialize_audio_backend()

    def _initialize_audio_backend(self):
        """Initialize the audio backend (pygame)"""
        if not PYGAME_AVAILABLE:
            logger.error(
                "EnhancedAudioPlayer",
                "_initialize_audio_backend",
                "Pygame not available",
            )
            return

        try:
            if not pygame.mixer.get_init():
                pygame.mixer.init(frequency=44100, size=-16, channels=2, buffer=1024)
            logger.info(
                "EnhancedAudioPlayer",
                "_initialize_audio_backend",
                "Audio backend initialized",
            )
        except Exception as e:
            logger.error(
                "EnhancedAudioPlayer",
                "_initialize_audio_backend",
                f"Failed to initialize audio: {e}",
            )

    def load_track(self, filepath: str) -> bool:
        """Load a single track"""
        try:
            # Stop previous playback and reset position
            self.stop()
            self.current_position = 0.0
            self.playlist.clear()

            if self.playlist.add_track(filepath):
                self.playlist.set_current_track(0)
                # Reset position to zero when loading new track
                self.current_position = 0.0
                self._notify_position_changed()
                self._notify_track_changed()
                self._notify_playlist_changed()
                return True
            return False

        except Exception as e:
            logger.error(
                "EnhancedAudioPlayer",
                "load_track",
                f"Error loading track {filepath}: {e}",
            )
            return False

    def load_playlist(self, filepaths: List[str]) -> int:
        """Load multiple tracks into playlist"""
        try:
            self.stop()
            self.playlist.clear()

            loaded_count = 0
            for filepath in filepaths:
                if self.playlist.add_track(filepath):
                    loaded_count += 1

            if loaded_count > 0:
                self.playlist.set_current_track(0)
                self._notify_track_changed()
                self._notify_playlist_changed()

            return loaded_count

        except Exception as e:
            logger.error(
                "EnhancedAudioPlayer", "load_playlist", f"Error loading playlist: {e}"
            )
            return 0

    def play(self) -> bool:
        """Start or resume playback"""
        try:
            if not PYGAME_AVAILABLE:
                return False

            current_track = self.playlist.get_current_track()
            if not current_track:
                return False

            if self.state == PlaybackState.PAUSED:
                pygame.mixer.music.unpause()
                self._set_state(PlaybackState.PLAYING)
                self._start_position_thread()
                return True

            elif self.state == PlaybackState.STOPPED:
                self._set_state(PlaybackState.LOADING)

                # Always load the original file for simplicity
                # Speed adjustment will be handled by creating pre-processed files
                file_to_load = current_track.filepath
                
                if self.playback_speed != 1.0:
                    # Create speed-adjusted audio file
                    logger.info(
                        "EnhancedAudioPlayer",
                        "play",
                        f"Attempting to create speed-adjusted file at {self.playback_speed}x"
                    )
                    if self._create_speed_adjusted_audio(current_track.filepath, self.playback_speed):
                        file_to_load = self._get_temp_speed_file()
                        logger.info(
                            "EnhancedAudioPlayer",
                            "play",
                            f"Using speed-adjusted file: {file_to_load}"
                        )
                    else:
                        logger.warning(
                            "EnhancedAudioPlayer",
                            "play",
                            "Failed to create speed-adjusted file, using original"
                        )
                
                pygame.mixer.music.load(file_to_load)
                pygame.mixer.music.play(start=self.current_position)
                pygame.mixer.music.set_volume(self.volume if not self.is_muted else 0.0)

                self._set_state(PlaybackState.PLAYING)
                self._start_position_thread()
                return True

            return False

        except Exception as e:
            logger.error("EnhancedAudioPlayer", "play", f"Error starting playback: {e}")
            self._set_state(PlaybackState.STOPPED)
            return False

    def pause(self) -> bool:
        """Pause playback"""
        try:
            if self.state == PlaybackState.PLAYING and PYGAME_AVAILABLE:
                pygame.mixer.music.pause()
                self._set_state(PlaybackState.PAUSED)
                self._stop_position_thread()
                return True
            return False
        except Exception as e:
            logger.error("EnhancedAudioPlayer", "pause", f"Error pausing playback: {e}")
            return False

    def stop(self) -> bool:
        """Stop playback"""
        try:
            if PYGAME_AVAILABLE and pygame.mixer.get_init():
                pygame.mixer.music.stop()

            self._set_state(PlaybackState.STOPPED)
            self.current_position = 0.0
            self._stop_position_thread()
            self._notify_position_changed()
            return True
        except Exception as e:
            logger.error("EnhancedAudioPlayer", "stop", f"Error stopping playback: {e}")
            return False

    def seek(self, position: float) -> bool:
        """Seek to a specific position in seconds"""
        try:
            current_track = self.playlist.get_current_track()
            if not current_track:
                return False

            # Clamp position to valid range
            position = max(0.0, min(position, current_track.duration))

            was_playing = self.state == PlaybackState.PLAYING

            if PYGAME_AVAILABLE:
                pygame.mixer.music.stop()
                
                # Load appropriate file (speed-adjusted or original)  
                file_to_load = current_track.filepath
                if self.playback_speed != 1.0:
                    if self._create_speed_adjusted_audio(current_track.filepath, self.playback_speed):
                        file_to_load = self._get_temp_speed_file()
                
                pygame.mixer.music.load(file_to_load)

                if was_playing:
                    pygame.mixer.music.play(start=position)
                    self._set_state(PlaybackState.PLAYING)
                else:
                    self._set_state(PlaybackState.STOPPED)

            self.current_position = position
            self._notify_position_changed()
            return True

        except Exception as e:
            logger.error(
                "EnhancedAudioPlayer",
                "seek",
                f"Error seeking to position {position}: {e}",
            )
            return False

    def next_track(self) -> bool:
        """Skip to next track"""
        try:
            next_track = self.playlist.next_track()
            if next_track:
                was_playing = self.state == PlaybackState.PLAYING
                self.stop()
                self._notify_track_changed()

                if was_playing:
                    return self.play()
                return True
            return False
        except Exception as e:
            logger.error(
                "EnhancedAudioPlayer",
                "next_track",
                f"Error skipping to next track: {e}",
            )
            return False

    def previous_track(self) -> bool:
        """Skip to previous track"""
        try:
            prev_track = self.playlist.previous_track()
            if prev_track:
                was_playing = self.state == PlaybackState.PLAYING
                self.stop()
                self._notify_track_changed()

                if was_playing:
                    return self.play()
                return True
            return False
        except Exception as e:
            logger.error(
                "EnhancedAudioPlayer",
                "previous_track",
                f"Error skipping to previous track: {e}",
            )
            return False

    def set_volume(self, volume: float) -> bool:
        """Set playback volume (0.0 to 1.0)"""
        try:
            volume = max(0.0, min(1.0, volume))
            self.volume = volume

            if PYGAME_AVAILABLE and pygame.mixer.get_init():
                pygame.mixer.music.set_volume(volume if not self.is_muted else 0.0)

            return True
        except Exception as e:
            logger.error(
                "EnhancedAudioPlayer", "set_volume", f"Error setting volume: {e}"
            )
            return False

    def toggle_mute(self) -> bool:
        """Toggle mute state"""
        try:
            if self.is_muted:
                self.is_muted = False
                self.set_volume(self.previous_volume)
            else:
                self.previous_volume = self.volume
                self.is_muted = True
                if PYGAME_AVAILABLE and pygame.mixer.get_init():
                    pygame.mixer.music.set_volume(0.0)

            return True
        except Exception as e:
            logger.error(
                "EnhancedAudioPlayer", "toggle_mute", f"Error toggling mute: {e}"
            )
            return False

    def set_repeat_mode(self, mode: RepeatMode):
        """Set repeat mode"""
        self.playlist.repeat_mode = mode

    def set_shuffle(self, enabled: bool):
        """Enable or disable shuffle"""
        self.playlist.shuffle_enabled = enabled

    def set_playback_speed(self, speed: float) -> bool:
        """Set playback speed (0.25x to 2.0x)"""
        try:
            # Clamp speed to valid range
            speed = max(0.25, min(2.0, speed))
            old_speed = self.playback_speed
            self.playback_speed = speed
            
            logger.info(
                "EnhancedAudioPlayer",
                "set_playback_speed", 
                f"Playback speed changed from {old_speed}x to {speed}x"
            )
            
            # If we're currently playing, we need to restart with the new speed
            if self.state == PlaybackState.PLAYING:
                current_position = self.current_position
                logger.info(
                    "EnhancedAudioPlayer",
                    "set_playback_speed", 
                    f"Restarting playback at {current_position:.1f}s with new speed {speed}x"
                )
                
                # Stop current playback
                pygame.mixer.music.stop()
                
                # Create new speed-adjusted file if needed
                current_track = self.playlist.get_current_track()
                if current_track:
                    file_to_load = current_track.filepath
                    if speed != 1.0:
                        if self._create_speed_adjusted_audio(current_track.filepath, speed):
                            file_to_load = self._get_temp_speed_file()
                            logger.info(
                                "EnhancedAudioPlayer",
                                "set_playback_speed",
                                f"Created new speed-adjusted file: {file_to_load}"
                            )
                        else:
                            logger.warning(
                                "EnhancedAudioPlayer",
                                "set_playback_speed",
                                "Failed to create speed-adjusted file, using original"
                            )
                    
                    # Load and play with new speed
                    pygame.mixer.music.load(file_to_load)
                    pygame.mixer.music.play(start=current_position)
                    pygame.mixer.music.set_volume(self.volume if not self.is_muted else 0.0)
            
            return True
        except Exception as e:
            logger.error(
                "EnhancedAudioPlayer", 
                "set_playback_speed", 
                f"Error setting playback speed: {e}"
            )
            return False

    def get_playback_speed(self) -> float:
        """Get current playback speed"""
        return self.playback_speed

    def increase_speed(self) -> float:
        """Increase playback speed by 0.25x increments"""
        new_speed = min(2.0, self.playback_speed + 0.25)
        self.set_playback_speed(new_speed)
        return new_speed

    def decrease_speed(self) -> float:
        """Decrease playback speed by 0.25x increments"""
        new_speed = max(0.25, self.playback_speed - 0.25)
        self.set_playback_speed(new_speed)
        return new_speed

    def reset_speed(self) -> float:
        """Reset playback speed to normal (1.0x)"""
        self.set_playback_speed(1.0)
        return 1.0

    def get_current_track(self) -> Optional[AudioTrack]:
        """Get currently playing track"""
        return self.playlist.get_current_track()

    def get_position(self) -> PlaybackPosition:
        """Get current playback position"""
        current_track = self.playlist.get_current_track()
        total_time = current_track.duration if current_track else 0.0
        percentage = (
            (self.current_position / total_time * 100) if total_time > 0 else 0.0
        )

        return PlaybackPosition(
            current_time=self.current_position,
            total_time=total_time,
            percentage=percentage,
        )

    def _start_position_thread(self):
        """Start the position update thread"""
        self._stop_position_thread()
        self.stop_position_thread.clear()
        self.position_update_thread = threading.Thread(
            target=self._position_update_worker
        )
        self.position_update_thread.daemon = True
        self.position_update_thread.start()

    def _stop_position_thread(self):
        """Stop the position update thread"""
        self.stop_position_thread.set()
        if self.position_update_thread and self.position_update_thread.is_alive():
            self.position_update_thread.join(timeout=1.0)

    def _position_update_worker(self):
        """Worker thread for updating playback position"""
        logger.debug(
            "EnhancedAudioPlayer",
            "_position_update_worker",
            "Position update thread started",
        )

        # Track actual elapsed time for better accuracy
        import time

        last_update_time = time.time()

        while not self.stop_position_thread.is_set():
            try:
                if self.state == PlaybackState.PLAYING and PYGAME_AVAILABLE:
                    # Check if music is still playing
                    music_busy = pygame.mixer.music.get_busy()
                    
                    if music_busy:
                        # Use actual elapsed time for more accurate position tracking
                        current_time = time.time()
                        elapsed = current_time - last_update_time
                        last_update_time = current_time

                        # Update position based on actual elapsed time
                        # When using speed-adjusted files, position tracking is 1:1 with real time
                        self.current_position += elapsed

                        current_track = self.playlist.get_current_track()
                        if current_track:
                            # Use the actual audio file duration, not device metadata
                            actual_duration = current_track.duration

                            if self.current_position >= actual_duration:
                                # Track ended, move to next or stop
                                if self.playlist.repeat_mode == RepeatMode.ONE:
                                    self.current_position = 0.0
                                    self.seek(0.0)
                                    last_update_time = time.time()  # Reset timing
                                else:
                                    next_track = self.playlist.next_track()
                                    if next_track:
                                        self.current_position = 0.0
                                        self._notify_track_changed()
                                        self.play()
                                        last_update_time = time.time()  # Reset timing
                                    else:
                                        self.stop()
                                        break

                        self._notify_position_changed()
                    else:
                        # Music stopped playing - check if we've reached the end
                        current_track = self.playlist.get_current_track()
                        if current_track and self.current_position >= (current_track.duration - 0.5):  # 0.5s tolerance
                            # Track ended naturally
                            logger.info(
                                "EnhancedAudioPlayer",
                                "_position_update_worker",
                                f"Track ended at {self.current_position:.1f}s of {current_track.duration:.1f}s"
                            )
                            
                            if self.playlist.repeat_mode == RepeatMode.ONE:
                                self.current_position = 0.0
                                self.seek(0.0)
                                last_update_time = time.time()  # Reset timing
                            else:
                                next_track = self.playlist.next_track()
                                if next_track:
                                    self.current_position = 0.0
                                    self._notify_track_changed()
                                    self.play()
                                    last_update_time = time.time()  # Reset timing
                                else:
                                    # No more tracks - stop playback
                                    self.stop()
                                    break
                        else:
                            # Music stopped for other reasons (manual stop, error)
                            if self.state == PlaybackState.PLAYING:
                                self.stop()
                            break

                time.sleep(0.05)  # Update every 50ms for smoother tracking

            except Exception as e:
                logger.error(
                    "EnhancedAudioPlayer",
                    "_position_update_worker",
                    f"Error in position thread: {e}",
                )
                break
    
    def _create_speed_adjusted_audio(self, filepath: str, speed: float) -> bool:
        """Create a temporary audio file with adjusted playback speed"""
        try:
            if not PYDUB_AVAILABLE:
                logger.warning(
                    "EnhancedAudioPlayer",
                    "_create_speed_adjusted_audio",
                    "Pydub not available - cannot create speed-adjusted audio"
                )
                return False
            
            logger.info(
                "EnhancedAudioPlayer",
                "_create_speed_adjusted_audio",
                f"Creating speed-adjusted audio: {speed}x from {filepath}"
            )
            
            # Load audio with pydub
            audio = AudioSegment.from_file(filepath)
            
            # Change speed by manipulating sample rate
            if speed != 1.0:
                # This approach changes both speed and pitch (like old tape players)
                # First, we change the frame rate which effectively speeds up/slows down
                new_sample_rate = int(audio.frame_rate * speed)
                
                # Create new audio segment with modified frame rate
                # This actually changes the playback speed
                speed_adjusted_audio = audio._spawn(
                    audio.raw_data,
                    overrides={
                        "frame_rate": new_sample_rate
                    }
                )
                
                # Convert back to standard sample rate for pygame compatibility
                speed_adjusted_audio = speed_adjusted_audio.set_frame_rate(44100)
            else:
                # No speed change needed
                speed_adjusted_audio = audio.set_frame_rate(44100)
            
            # Get temporary file path
            temp_file = self._get_temp_speed_file()
            
            # Clean up any existing temp file
            if os.path.exists(temp_file):
                try:
                    os.remove(temp_file)
                    logger.debug(
                        "EnhancedAudioPlayer",
                        "_create_speed_adjusted_audio",
                        f"Removed existing temp file: {temp_file}"
                    )
                except Exception as e:
                    logger.warning(
                        "EnhancedAudioPlayer",
                        "_create_speed_adjusted_audio",
                        f"Could not remove existing temp file: {e}"
                    )
            
            # Export the speed-adjusted audio to WAV format
            speed_adjusted_audio.export(temp_file, format="wav")
            
            # Verify the file was created and has content
            if os.path.exists(temp_file) and os.path.getsize(temp_file) > 0:
                logger.info(
                    "EnhancedAudioPlayer",
                    "_create_speed_adjusted_audio",
                    f"Successfully created speed-adjusted audio at {speed}x: {temp_file} ({os.path.getsize(temp_file)} bytes)"
                )
                return True
            else:
                logger.error(
                    "EnhancedAudioPlayer",
                    "_create_speed_adjusted_audio",
                    f"Temp file was not created properly: {temp_file}"
                )
                return False
            
        except Exception as e:
            logger.error(
                "EnhancedAudioPlayer",
                "_create_speed_adjusted_audio",
                f"Error creating speed-adjusted audio: {e}"
            )
            return False
    
    def _get_temp_speed_file(self) -> str:
        """Get the path for temporary speed-adjusted audio file"""
        import tempfile
        return os.path.join(tempfile.gettempdir(), f"hidock_speed_adjusted_{self.playback_speed}x.wav")

        logger.debug(
            "EnhancedAudioPlayer",
            "_position_update_worker",
            "Position update thread stopped",
        )

    def _set_state(self, new_state: PlaybackState):
        """Set playback state and notify listeners"""
        if self.state != new_state:
            self.state = new_state
            self._notify_state_changed()

    def _notify_position_changed(self):
        """Notify position change listeners"""
        if self.on_position_changed:
            try:
                position = self.get_position()
                logger.debug(
                    "EnhancedAudioPlayer",
                    "_notify_position_changed",
                    f"Notifying position: {position.current_time:.1f}s",
                )
                self.on_position_changed(position)
            except Exception as e:
                logger.error(
                    "EnhancedAudioPlayer",
                    "_notify_position_changed",
                    f"Error in position callback: {e}",
                )
        else:
            logger.debug(
                "EnhancedAudioPlayer",
                "_notify_position_changed",
                "No position callback registered",
            )

    def _notify_state_changed(self):
        """Notify state change listeners"""
        if self.on_state_changed:
            try:
                self.on_state_changed(self.state)
            except Exception as e:
                logger.error(
                    "EnhancedAudioPlayer",
                    "_notify_state_changed",
                    f"Error in state callback: {e}",
                )

    def _notify_track_changed(self):
        """Notify track change listeners"""
        if self.on_track_changed:
            try:
                current_track = self.playlist.get_current_track()
                self.on_track_changed(current_track)
            except Exception as e:
                logger.error(
                    "EnhancedAudioPlayer",
                    "_notify_track_changed",
                    f"Error in track callback: {e}",
                )

    def _notify_playlist_changed(self):
        """Notify playlist change listeners"""
        if self.on_playlist_changed:
            try:
                self.on_playlist_changed()
            except Exception as e:
                logger.error(
                    "EnhancedAudioPlayer",
                    "_notify_playlist_changed",
                    f"Error in playlist callback: {e}",
                )

    def cleanup(self):
        """Clean up resources"""
        try:
            self.stop()
            self._stop_position_thread()

            if PYGAME_AVAILABLE and pygame.mixer.get_init():
                pygame.mixer.quit()

        except Exception as e:
            logger.error("EnhancedAudioPlayer", "cleanup", f"Error during cleanup: {e}")
