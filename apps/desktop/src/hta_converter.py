# -*- coding: utf-8 -*-
"""
HDA/HTA Audio File Converter for HiDock Desktop Application

This module provides functionality to convert HiDock audio files (.hda/.hta)
into standard .wav format for transcription and analysis.

IMPORTANT: Audio format varies by device model:
- H1E: MPEG Audio Layer 1/2 format (Mono, 16000 Hz, 32 bits per sample, 64 kb/s)
- P1: Unknown format (likely stereo, different specs)
- Other models: Format unknown

This converter attempts multiple detection strategies to handle different formats.

Requirements: 4.3
"""

import os

# import struct  # Future: for binary data parsing if needed
import tempfile
import wave
from typing import Optional, Tuple

from config_and_logger import logger


class HTAConverter:
    """
    Converts HiDock audio files (.hda/.hta) to WAV format.

    Handles MPEG Audio Layer 1/2 format files from HiDock devices.
    """

    def __init__(self):
        self.temp_dir = tempfile.gettempdir()

    def convert_hta_to_wav(self, hta_file_path: str, output_path: Optional[str] = None) -> Optional[str]:
        """
        Convert HiDock audio file (.hda/.hta) to WAV format.
        
        For transcription use, consider using convert_hta_for_transcription() 
        which ensures better compatibility with AI services.
        """
        return self._convert_hta(hta_file_path, output_path, "wav")

    def convert_hta_for_transcription(self, hta_file_path: str, output_path: Optional[str] = None) -> Optional[str]:
        """
        Convert HiDock audio file (.hda/.hta) to format optimized for transcription services.
        
        This method ensures the output is compatible with OpenAI Whisper and other transcription APIs.
        Uses MP3 format which is more widely supported and has better compression.
        """
        if output_path is None:
            base_name = os.path.splitext(os.path.basename(hta_file_path))[0]
            output_path = os.path.join(self.temp_dir, f"{base_name}_transcription.mp3")
        
        return self._convert_hta(hta_file_path, output_path, "mp3")

    def _convert_hta(self, hta_file_path: str, output_path: Optional[str] = None, format_type: str = "wav") -> Optional[str]:
        """
        Convert HiDock audio file (.hda/.hta) to specified format.

        The input files are MPEG Audio Layer 1/2 format that get converted to the target format.

        Args:
            hta_file_path: Path to the input .hda/.hta file
            output_path: Optional output path for the converted file
            format_type: Target format ("wav" or "mp3")

        Returns:
            Path to the converted file, or None if conversion failed
        """
        try:
            if not os.path.exists(hta_file_path):
                logger.error(
                    "HTAConverter",
                    "_convert_hta",
                    f"Input file not found: {hta_file_path}",
                )
                return None

            if not hta_file_path.lower().endswith((".hta", ".hda")):
                logger.error(
                    "HTAConverter",
                    "_convert_hta",
                    f"File is not an HTA/HDA file: {hta_file_path}",
                )
                return None

            # Generate output path if not provided
            if output_path is None:
                base_name = os.path.splitext(os.path.basename(hta_file_path))[0]
                extension = "wav" if format_type == "wav" else "mp3"
                output_path = os.path.join(self.temp_dir, f"{base_name}_converted.{extension}")

            logger.info(
                "HTAConverter",
                "_convert_hta",
                f"Converting {hta_file_path} to {format_type.upper()}: {output_path}",
            )

            # For MP3 output, use direct pydub conversion for better compatibility
            if format_type == "mp3":
                return self._convert_to_mp3_direct(hta_file_path, output_path)
            
            # For WAV, use the existing pipeline
            audio_data, sample_rate, channels = self._parse_hta_file(hta_file_path)

            if audio_data is None:
                return None

            # Create output file
            if format_type == "wav":
                self._create_wav_file(output_path, audio_data, sample_rate, channels)
            else:
                logger.error("HTAConverter", "_convert_hta", f"Unsupported format: {format_type}")
                return None

            logger.info(
                "HTAConverter",
                "_convert_hta",
                f"Successfully converted to {output_path}",
            )
            return output_path

        except Exception as e:
            logger.error("HTAConverter", "_convert_hta", f"Error converting HTA file: {e}")
            return None

    def _parse_hta_file(self, hta_file_path: str) -> Tuple[Optional[bytes], int, int]:
        """
        Parse HTA file and extract audio data.

        This is a basic implementation that tries common HTA formats.
        In a real implementation, you would need the actual HTA specification.

        Returns:
            Tuple of (audio_data, sample_rate, channels) or (None, 0, 0) if failed
        """
        try:
            with open(hta_file_path, "rb") as f:
                file_data = f.read()

            # Try to identify HTA format
            # This is a simplified approach - real HTA files may have different structures

            # Method 1: Check if it's actually a renamed WAV file
            if file_data.startswith(b"RIFF") and b"WAVE" in file_data[:12]:
                logger.info(
                    "HTAConverter",
                    "_parse_hta_file",
                    "HTA file appears to be WAV format",
                )
                return self._parse_wav_data(file_data)

            # Method 2: Check for common HTA header patterns
            if self._try_hta_format_1(file_data):
                return self._parse_hta_format_1(file_data)

            # Method 3: Try raw PCM data with common settings
            return self._try_raw_pcm_conversion(file_data)

        except Exception as e:
            logger.error("HTAConverter", "_parse_hta_file", f"Error parsing HTA file: {e}")
            return None, 0, 0

    def _parse_wav_data(self, data: bytes) -> Tuple[Optional[bytes], int, int]:
        """Parse WAV data from bytes."""
        try:
            # Use wave module to parse if it's actually a WAV file
            import io

            wav_io = io.BytesIO(data)
            with wave.open(wav_io, "rb") as wav_file:
                sample_rate = wav_file.getframerate()
                channels = wav_file.getnchannels()
                audio_data = wav_file.readframes(wav_file.getnframes())
                return audio_data, sample_rate, channels
        except Exception as e:
            logger.error("HTAConverter", "_parse_wav_data", f"Error parsing WAV data: {e}")
            return None, 0, 0

    def _try_hta_format_1(self, data: bytes) -> bool:
        """
        Check if data matches MPEG Audio Layer 1/2 format.

        DEVICE-SPECIFIC: Based on user testing with H1E device:
        - H1E: MPEG Audio Layer 1/2 (Mono, 16000 Hz, 32 bits/sample, 64 kb/s)
        - P1: Different format (likely stereo, specs unknown)
        - Other models: Format unknown

        This method specifically detects MPEG audio headers.
        """
        if len(data) < 4:  # Need at least 4 bytes for MPEG header
            return False

        # Check for MPEG audio frame sync (11 bits of 1s at start)
        # MPEG frame header starts with sync pattern: 0xFFE, 0xFFF, etc.
        if data[0] == 0xFF and (data[1] & 0xE0) == 0xE0:
            # Parse MPEG header to verify it's Layer 1/2
            header = (data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3]

            # Extract layer bits (bits 17-18)
            layer_bits = (header >> 17) & 0x3
            # Layer 1 = 0b11, Layer 2 = 0b10
            if layer_bits in (0b10, 0b11):  # Layer 1 or 2
                logger.info(
                    "HTAConverter",
                    "_try_hta_format_1",
                    f"Detected MPEG Audio Layer {3 - layer_bits} format",
                )
                return True

        # Also check for common MPEG patterns in the first few frames
        # Look for multiple sync patterns which indicate MPEG stream
        sync_count = 0
        for i in range(0, min(len(data) - 3, 1024), 4):
            if data[i] == 0xFF and (data[i + 1] & 0xE0) == 0xE0:
                sync_count += 1
                if sync_count >= 3:  # Multiple sync patterns found
                    logger.info(
                        "HTAConverter",
                        "_try_hta_format_1",
                        "Detected MPEG audio stream with multiple sync patterns",
                    )
                    return True

        return False

    def _parse_hta_format_1(self, data: bytes) -> Tuple[Optional[bytes], int, int]:
        """
        Parse MPEG Audio Layer 1/2 format using pydub.

        DEVICE-SPECIFIC: H1E confirmed specs - Mono, 16000 Hz, 32 bits/sample, 64 kb/s.
        WARNING: P1 and other models may have different formats (stereo, different rates).
        """
        try:
            import io

            from pydub import AudioSegment

            # Create a BytesIO object from the data
            audio_io = io.BytesIO(data)

            # Try to load as MPEG audio using pydub
            # pydub can handle MPEG Layer 1/2 files
            try:
                audio_segment = AudioSegment.from_file(audio_io, format="mp3")
                logger.info(
                    "HTAConverter",
                    "_parse_hta_format_1",
                    f"Successfully loaded MPEG audio: {audio_segment.frame_rate}Hz, "
                    f"{audio_segment.channels} channels, {len(audio_segment)}ms",
                )
            except Exception:
                # If mp3 format fails, try without specifying format
                audio_io.seek(0)
                try:
                    audio_segment = AudioSegment.from_file(audio_io)
                    logger.info(
                        "HTAConverter",
                        "_parse_hta_format_1",
                        "Successfully loaded audio with auto-detection",
                    )
                except Exception as e:
                    logger.error(
                        "HTAConverter",
                        "_parse_hta_format_1", 
                        f"Failed to load audio with pydub: {e}"
                    )
                    raise

            # Normalize audio parameters for transcription compatibility
            # Convert to 16-bit, and ensure compatible sample rate
            audio_segment = audio_segment.set_sample_width(2)  # 16-bit
            
            # Ensure compatible sample rate for transcription
            target_rate = self._get_compatible_sample_rate(audio_segment.frame_rate)
            if audio_segment.frame_rate != target_rate:
                logger.info(
                    "HTAConverter",
                    "_parse_hta_format_1",
                    f"Resampling from {audio_segment.frame_rate}Hz to {target_rate}Hz",
                )
                audio_segment = audio_segment.set_frame_rate(target_rate)

            # Convert to raw audio data
            # Export as WAV to get raw PCM data
            wav_io = io.BytesIO()
            audio_segment.export(wav_io, format="wav")
            wav_data = wav_io.getvalue()

            # Parse the WAV data to extract raw audio
            return self._parse_wav_data(wav_data)

        except Exception as e:
            logger.error("HTAConverter", "_parse_hta_format_1", f"Error parsing MPEG audio: {e}")
            # Fallback: try with H1E device settings (may not work for P1/other models)
            try:
                logger.warning(
                    "HTAConverter",
                    "_parse_hta_format_1",
                    "Pydub failed, trying fallback with H1E device settings "
                    "(WARNING: may not work for P1 or other device models)",
                )
                sample_rate = 16000  # H1E confirmed specs
                channels = 1  # H1E is mono (P1 likely stereo!)

                # For MPEG Layer 1/2, the data is already compressed
                # We'll return it as-is and let pygame handle it
                return data, sample_rate, channels

            except Exception as fallback_error:
                logger.error(
                    "HTAConverter",
                    "_parse_hta_format_1",
                    f"Fallback also failed: {fallback_error}",
                )
                return None, 0, 0

    def _try_raw_pcm_conversion(self, data: bytes) -> Tuple[Optional[bytes], int, int]:
        """
        Try to convert raw PCM data with common settings.

        Attempts multiple configurations since format varies by device:
        - H1E: Likely mono 16kHz
        - P1: Likely stereo, possibly different sample rate
        """
        try:
            # Try H1E settings first (confirmed working)
            sample_rate = 16000  # H1E confirmed
            channels = 1  # H1E is mono

            # Check if data length suggests stereo (P1 and other models)
            total_samples = len(data) // 2  # Assuming 16-bit samples
            if total_samples % 2 == 0:  # Even number suggests possible stereo
                logger.info(
                    "HTAConverter",
                    "_try_raw_pcm_conversion",
                    "Data length suggests possible stereo format (P1/other models)",
                )
                # Try stereo first for P1-like devices
                channels = 2

            # Assume 16-bit PCM data
            if len(data) % 2 == 1:
                # Remove last byte if odd length
                data = data[:-1]

            logger.info(
                "HTAConverter",
                "_try_raw_pcm_conversion",
                f"Trying raw PCM conversion: {len(data)} bytes, {sample_rate}Hz, {channels} channel(s) "
                f"(device format unknown)",
            )

            return data, sample_rate, channels

        except Exception as e:
            logger.error(
                "HTAConverter",
                "_try_raw_pcm_conversion",
                f"Error in raw PCM conversion: {e}",
            )
            return None, 0, 0

    def _convert_to_mp3_direct(self, hta_file_path: str, output_path: str) -> Optional[str]:
        """
        Convert HTA file directly to MP3 using pydub for optimal transcription compatibility.
        
        This method bypasses the WAV conversion pipeline and uses pydub's built-in
        format detection and conversion capabilities.
        """
        try:
            from pydub import AudioSegment
            
            logger.info(
                "HTAConverter",
                "_convert_to_mp3_direct", 
                f"Direct MP3 conversion: {hta_file_path} -> {output_path}"
            )
            
            # Try to load the HTA file with pydub's format auto-detection
            audio_segment = None
            
            # First try as MPEG/MP3 format
            try:
                audio_segment = AudioSegment.from_file(hta_file_path, format="mp3")
                logger.info(
                    "HTAConverter",
                    "_convert_to_mp3_direct",
                    f"Loaded as MPEG: {audio_segment.frame_rate}Hz, {audio_segment.channels}ch"
                )
            except Exception as e1:
                logger.debug("HTAConverter", "_convert_to_mp3_direct", f"MP3 format failed: {e1}")
                
                # Try without format specification (auto-detect)
                try:
                    audio_segment = AudioSegment.from_file(hta_file_path)
                    logger.info(
                        "HTAConverter",
                        "_convert_to_mp3_direct",
                        f"Loaded with auto-detection: {audio_segment.frame_rate}Hz, {audio_segment.channels}ch"
                    )
                except Exception as e2:
                    logger.error(
                        "HTAConverter",
                        "_convert_to_mp3_direct", 
                        f"Failed to load HTA file: {e2}"
                    )
                    return None
            
            if audio_segment is None:
                return None
            
            # Optimize for transcription: normalize audio parameters
            # Ensure 16-bit depth and compatible sample rate
            audio_segment = audio_segment.set_sample_width(2)  # 16-bit
            
            # Use optimal sample rate for speech transcription
            target_rate = self._get_compatible_sample_rate(audio_segment.frame_rate)
            if audio_segment.frame_rate != target_rate:
                logger.info(
                    "HTAConverter",
                    "_convert_to_mp3_direct",
                    f"Resampling from {audio_segment.frame_rate}Hz to {target_rate}Hz for transcription"
                )
                audio_segment = audio_segment.set_frame_rate(target_rate)
            
            # Export as MP3 with settings optimized for transcription
            audio_segment.export(
                output_path,
                format="mp3",
                bitrate="128k",  # Good quality for transcription
                parameters=["-ar", str(target_rate), "-ac", str(audio_segment.channels)]
            )
            
            logger.info(
                "HTAConverter",
                "_convert_to_mp3_direct",
                f"MP3 conversion successful: {target_rate}Hz, {audio_segment.channels}ch, 128kbps"
            )
            
            return output_path
            
        except ImportError:
            logger.error(
                "HTAConverter", 
                "_convert_to_mp3_direct",
                "pydub not available. Cannot perform direct MP3 conversion."
            )
            return None
        except Exception as e:
            logger.error("HTAConverter", "_convert_to_mp3_direct", f"Direct MP3 conversion failed: {e}")
            return None

    def _create_wav_file(self, output_path: str, audio_data: bytes, sample_rate: int, channels: int):
        """Create WAV file from audio data with transcription service compatibility."""
        try:
            # Ensure sample rate is compatible with transcription services
            # OpenAI Whisper works best with common sample rates
            target_sample_rate = self._get_compatible_sample_rate(sample_rate)
            
            if target_sample_rate != sample_rate:
                logger.info(
                    "HTAConverter", 
                    "_create_wav_file", 
                    f"Adjusting sample rate from {sample_rate}Hz to {target_sample_rate}Hz for transcription compatibility"
                )
                audio_data = self._resample_audio(audio_data, sample_rate, target_sample_rate, channels)
                sample_rate = target_sample_rate

            with wave.open(output_path, "wb") as wav_file:  # pylint: disable=no-member
                wav_file.setnchannels(channels)  # pylint: disable=no-member
                wav_file.setsampwidth(2)  # 16-bit audio  # pylint: disable=no-member
                wav_file.setframerate(sample_rate)  # pylint: disable=no-member
                wav_file.writeframes(audio_data)  # pylint: disable=no-member

            # Verify the created file is valid
            self._verify_wav_file(output_path)
            logger.info(
                "HTAConverter", 
                "_create_wav_file", 
                f"Created WAV file: {channels} channel(s), {sample_rate}Hz, 16-bit PCM"
            )

        except Exception as e:
            logger.error("HTAConverter", "_create_wav_file", f"Error creating WAV file: {e}")
            raise

    def _get_compatible_sample_rate(self, sample_rate: int) -> int:
        """
        Get a sample rate compatible with transcription services.
        
        OpenAI Whisper and most transcription services work best with:
        - 16000Hz (recommended for speech)
        - 22050Hz, 44100Hz, 48000Hz (common rates)
        """
        # Common sample rates in order of preference for transcription
        compatible_rates = [16000, 22050, 44100, 48000, 8000]
        
        # If already compatible, use as-is
        if sample_rate in compatible_rates:
            return sample_rate
            
        # For rates close to 16kHz (ideal for speech), use 16kHz
        if 12000 <= sample_rate <= 20000:
            return 16000
            
        # For higher rates, use 44.1kHz (CD quality)
        if sample_rate > 20000:
            return 44100
            
        # For very low rates, use 8kHz (minimum acceptable)
        return 8000

    def _resample_audio(self, audio_data: bytes, original_rate: int, target_rate: int, channels: int) -> bytes:
        """
        Resample audio data to target sample rate using basic interpolation.
        
        Note: This is a simple resampling method. For production use, 
        consider using scipy.signal.resample or librosa for better quality.
        """
        try:
            import numpy as np
            
            # Convert bytes to numpy array (16-bit signed integers)
            if channels == 1:
                audio_array = np.frombuffer(audio_data, dtype=np.int16)
            else:
                audio_array = np.frombuffer(audio_data, dtype=np.int16).reshape(-1, channels)
            
            # Calculate resampling ratio
            ratio = target_rate / original_rate
            new_length = int(len(audio_array) * ratio)
            
            if channels == 1:
                # Mono resampling
                resampled = np.interp(
                    np.linspace(0, len(audio_array) - 1, new_length),
                    np.arange(len(audio_array)),
                    audio_array
                ).astype(np.int16)
            else:
                # Stereo resampling (resample each channel)
                resampled_channels = []
                for ch in range(channels):
                    resampled_ch = np.interp(
                        np.linspace(0, len(audio_array) - 1, new_length),
                        np.arange(len(audio_array)),
                        audio_array[:, ch]
                    ).astype(np.int16)
                    resampled_channels.append(resampled_ch)
                resampled = np.column_stack(resampled_channels)
            
            return resampled.tobytes()
            
        except ImportError:
            logger.warning(
                "HTAConverter", 
                "_resample_audio", 
                "NumPy not available for resampling. Using original audio data."
            )
            return audio_data
        except Exception as e:
            logger.error("HTAConverter", "_resample_audio", f"Resampling failed: {e}")
            return audio_data

    def _verify_wav_file(self, wav_path: str) -> bool:
        """
        Verify that the created WAV file is valid and can be read.
        """
        try:
            with wave.open(wav_path, "rb") as wav_file:
                frames = wav_file.getnframes()
                rate = wav_file.getframerate()
                channels = wav_file.getnchannels()
                sample_width = wav_file.getsampwidth()
                
                if frames == 0:
                    raise ValueError("WAV file has no audio frames")
                    
                logger.debug(
                    "HTAConverter",
                    "_verify_wav_file", 
                    f"WAV verification: {frames} frames, {rate}Hz, {channels}ch, {sample_width*8}-bit"
                )
                return True
                
        except Exception as e:
            logger.error("HTAConverter", "_verify_wav_file", f"WAV file verification failed: {e}")
            raise ValueError(f"Invalid WAV file created: {e}")

    def get_converted_file_path(self, hta_file_path: str) -> str:
        """Get the expected path for a converted file."""
        base_name = os.path.splitext(os.path.basename(hta_file_path))[0]
        return os.path.join(self.temp_dir, f"{base_name}_converted.wav")

    def cleanup_converted_file(self, wav_file_path: str):
        """Clean up a converted WAV file."""
        try:
            if os.path.exists(wav_file_path):
                os.remove(wav_file_path)
                logger.info(
                    "HTAConverter",
                    "cleanup_converted_file",
                    f"Cleaned up {wav_file_path}",
                )
        except Exception as e:
            logger.warning(
                "HTAConverter",
                "cleanup_converted_file",
                f"Could not clean up {wav_file_path}: {e}",
            )


# Global converter instance
_hta_converter = None


def get_hta_converter() -> HTAConverter:
    """Get global HTA converter instance."""
    global _hta_converter
    if _hta_converter is None:
        _hta_converter = HTAConverter()
    return _hta_converter


def convert_hta_to_wav(hta_file_path: str, output_path: Optional[str] = None) -> Optional[str]:
    """
    Convenience function to convert HTA file to WAV.

    Args:
        hta_file_path: Path to the input .hta file
        output_path: Optional output path for the .wav file

    Returns:
        Path to the converted .wav file, or None if conversion failed
    """
    converter = get_hta_converter()
    return converter.convert_hta_to_wav(hta_file_path, output_path)


def convert_hta_for_transcription(hta_file_path: str, output_path: Optional[str] = None) -> Optional[str]:
    """
    Convenience function to convert HTA file to transcription-optimized format.
    
    This method ensures compatibility with OpenAI Whisper and other transcription services
    by using MP3 format with optimal settings for speech recognition.

    Args:
        hta_file_path: Path to the input .hta/.hda file
        output_path: Optional output path for the converted file

    Returns:
        Path to the converted file, or None if conversion failed
    """
    converter = get_hta_converter()
    return converter.convert_hta_for_transcription(hta_file_path, output_path)


if __name__ == "__main__":
    # Test the converter
    import sys

    if len(sys.argv) > 1:
        hta_file = sys.argv[1]
        converted = convert_hta_to_wav(hta_file)
        if converted:
            print(f"Successfully converted {hta_file} to {converted}")
        else:
            print(f"Failed to convert {hta_file}")
    else:
        print("Usage: python hta_converter.py <hta_file_path>")
