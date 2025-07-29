# -*- coding: utf-8 -*-
"""
HTA Audio File Converter for HiDock Desktop Application

This module provides functionality to convert proprietary .hta audio files
from HiDock devices into standard .wav format for transcription and analysis.

Requirements: 4.3
"""

import os
import tempfile
import wave
import struct
from typing import Optional, Tuple
from config_and_logger import logger

class HTAConverter:
    """Converts proprietary HTA audio files to WAV format."""
    
    def __init__(self):
        self.temp_dir = tempfile.gettempdir()
    
    def convert_hta_to_wav(self, hta_file_path: str, output_path: Optional[str] = None) -> Optional[str]:
        """
        Convert HTA file to WAV format.
        
        Args:
            hta_file_path: Path to the input .hta file
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
        """Check if data matches HTA format 1 (hypothetical format)."""
        # This would check for specific HTA header signatures
        # For now, check for some common patterns
        if len(data) < 44:  # Minimum size for audio header
            return False
        
        # Check for potential audio indicators
        # This is speculative - real implementation would need HTA specification
        return True  # Placeholder
    
    def _parse_hta_format_1(self, data: bytes) -> Tuple[Optional[bytes], int, int]:
        """Parse HTA format 1 (hypothetical)."""
        try:
            # Assume common settings for HiDock devices
            sample_rate = 16000  # Common for voice recordings
            channels = 1  # Mono
            
            # Skip potential header (first 44 bytes is common for audio headers)
            header_size = 44
            if len(data) > header_size:
                audio_data = data[header_size:]
            else:
                audio_data = data
            
            return audio_data, sample_rate, channels
            
        except Exception as e:
            logger.error("HTAConverter", "_parse_hta_format_1", f"Error parsing HTA format 1: {e}")
            return None, 0, 0
    
    def _try_raw_pcm_conversion(self, data: bytes) -> Tuple[Optional[bytes], int, int]:
        """Try to convert raw PCM data with common settings."""
        try:
            # Try common voice recording settings
            sample_rate = 16000  # 16kHz is common for voice
            channels = 1  # Mono
            
            # Assume 16-bit PCM data
            if len(data) % 2 == 1:
                # Remove last byte if odd length
                data = data[:-1]
            
            logger.info("HTAConverter", "_try_raw_pcm_conversion", 
                       f"Trying raw PCM conversion: {len(data)} bytes, {sample_rate}Hz, {channels} channel(s)")
            
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