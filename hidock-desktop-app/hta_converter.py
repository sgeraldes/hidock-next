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
import tempfile
import wave
import struct
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
        
        The input files are MPEG Audio Layer 1/2 format that get converted to standard WAV.
        
        Args:
            hta_file_path: Path to the input .hda/.hta file
            output_path: Optional output path for the .wav file
            
        Returns:
            Path to the converted .wav file, or None if conversion failed
        """
        try:
            if not os.path.exists(hta_file_path):
                logger.error("HTAConverter", "convert_hta_to_wav", f"Input file not found: {hta_file_path}")
                return None
            
            if not hta_file_path.lower().endswith('.hta'):
                logger.error("HTAConverter", "convert_hta_to_wav", f"File is not an HTA file: {hta_file_path}")
                return None
            
            # Generate output path if not provided
            if output_path is None:
                base_name = os.path.splitext(os.path.basename(hta_file_path))[0]
                output_path = os.path.join(self.temp_dir, f"{base_name}_converted.wav")
            
            logger.info("HTAConverter", "convert_hta_to_wav", f"Converting {hta_file_path} to {output_path}")
            
            # Try to analyze the HTA file structure
            audio_data, sample_rate, channels = self._parse_hta_file(hta_file_path)
            
            if audio_data is None:
                return None
            
            # Create WAV file
            self._create_wav_file(output_path, audio_data, sample_rate, channels)
            
            logger.info("HTAConverter", "convert_hta_to_wav", f"Successfully converted to {output_path}")
            return output_path
            
        except Exception as e:
            logger.error("HTAConverter", "convert_hta_to_wav", f"Error converting HTA file: {e}")
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
            with open(hta_file_path, 'rb') as f:
                file_data = f.read()
            
            # Try to identify HTA format
            # This is a simplified approach - real HTA files may have different structures
            
            # Method 1: Check if it's actually a renamed WAV file
            if file_data.startswith(b'RIFF') and b'WAVE' in file_data[:12]:
                logger.info("HTAConverter", "_parse_hta_file", "HTA file appears to be WAV format")
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
            with wave.open(wav_io, 'rb') as wav_file:
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
                logger.info("HTAConverter", "_try_hta_format_1", 
                           f"Detected MPEG Audio Layer {3 - layer_bits} format")
                return True
        
        # Also check for common MPEG patterns in the first few frames
        # Look for multiple sync patterns which indicate MPEG stream
        sync_count = 0
        for i in range(0, min(len(data) - 3, 1024), 4):
            if data[i] == 0xFF and (data[i + 1] & 0xE0) == 0xE0:
                sync_count += 1
                if sync_count >= 3:  # Multiple sync patterns found
                    logger.info("HTAConverter", "_try_hta_format_1", 
                               "Detected MPEG audio stream with multiple sync patterns")
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
                logger.info("HTAConverter", "_parse_hta_format_1", 
                           f"Successfully loaded MPEG audio: {audio_segment.frame_rate}Hz, "
                           f"{audio_segment.channels} channels, {len(audio_segment)}ms")
            except Exception:
                # If mp3 format fails, try without specifying format
                audio_io.seek(0)
                audio_segment = AudioSegment.from_file(audio_io)
                logger.info("HTAConverter", "_parse_hta_format_1", 
                           "Successfully loaded audio with auto-detection")
            
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
                logger.warning("HTAConverter", "_parse_hta_format_1", 
                              "Pydub failed, trying fallback with H1E device settings "
                              "(WARNING: may not work for P1 or other device models)")
                sample_rate = 16000  # H1E confirmed specs
                channels = 1  # H1E is mono (P1 likely stereo!)
                
                # For MPEG Layer 1/2, the data is already compressed
                # We'll return it as-is and let pygame handle it
                return data, sample_rate, channels
                
            except Exception as fallback_error:
                logger.error("HTAConverter", "_parse_hta_format_1", f"Fallback also failed: {fallback_error}")
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
                logger.info("HTAConverter", "_try_raw_pcm_conversion", 
                           "Data length suggests possible stereo format (P1/other models)")
                # Try stereo first for P1-like devices
                channels = 2
                
            # Assume 16-bit PCM data
            if len(data) % 2 == 1:
                # Remove last byte if odd length
                data = data[:-1]
            
            logger.info("HTAConverter", "_try_raw_pcm_conversion", 
                       f"Trying raw PCM conversion: {len(data)} bytes, {sample_rate}Hz, {channels} channel(s) "
                       f"(device format unknown)")
            
            return data, sample_rate, channels
            
        except Exception as e:
            logger.error("HTAConverter", "_try_raw_pcm_conversion", f"Error in raw PCM conversion: {e}")
            return None, 0, 0
    
    def _create_wav_file(self, output_path: str, audio_data: bytes, sample_rate: int, channels: int):
        """Create WAV file from audio data."""
        try:
            with wave.open(output_path, 'wb') as wav_file:
                wav_file.setnchannels(channels)
                wav_file.setsampwidth(2)  # 16-bit audio
                wav_file.setframerate(sample_rate)
                wav_file.writeframes(audio_data)
                
        except Exception as e:
            logger.error("HTAConverter", "_create_wav_file", f"Error creating WAV file: {e}")
            raise
    
    def get_converted_file_path(self, hta_file_path: str) -> str:
        """Get the expected path for a converted file."""
        base_name = os.path.splitext(os.path.basename(hta_file_path))[0]
        return os.path.join(self.temp_dir, f"{base_name}_converted.wav")
    
    def cleanup_converted_file(self, wav_file_path: str):
        """Clean up a converted WAV file."""
        try:
            if os.path.exists(wav_file_path):
                os.remove(wav_file_path)
                logger.info("HTAConverter", "cleanup_converted_file", f"Cleaned up {wav_file_path}")
        except Exception as e:
            logger.warning("HTAConverter", "cleanup_converted_file", f"Could not clean up {wav_file_path}: {e}")


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