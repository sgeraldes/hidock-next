"""
Advanced Audio Processing Module for HiDock Desktop Application

This module provides advanced audio processing and enhancement features:
- Noise reduction and audio enhancement algorithms
- Automatic silence detection and removal
- Audio normalization and quality improvement filters
- Support for multiple audio formats and codec conversion

Requirements: 9.3, 3.1, 3.2
"""

import os
import sys
import numpy as np
import scipy.signal as signal
import scipy.fft as fft
from scipy.io import wavfile
from scipy.ndimage import median_filter
import librosa
import soundfile as sf
from typing import Tuple, Optional, Dict, List, Union
from dataclasses import dataclass
from enum import Enum
import tempfile
import threading
import queue

try:
    import noisereduce as nr
    NOISEREDUCE_AVAILABLE = True
except ImportError:
    NOISEREDUCE_AVAILABLE = False

try:
    import pydub
    from pydub import AudioSegment
    from pydub.effects import normalize, compress_dynamic_range
    PYDUB_AVAILABLE = True
except ImportError:
    PYDUB_AVAILABLE = False

from config_and_logger import logger


class ProcessingQuality(Enum):
    """Audio processing quality levels"""
    FAST = "fast"
    BALANCED = "balanced"
    HIGH_QUALITY = "high_quality"


class NoiseReductionMethod(Enum):
    """Noise reduction methods"""
    SPECTRAL_SUBTRACTION = "spectral_subtraction"
    WIENER_FILTER = "wiener_filter"
    ADAPTIVE_FILTER = "adaptive_filter"
    DEEP_LEARNING = "deep_learning"


@dataclass
class AudioProcessingSettings:
    """Settings for audio processing operations"""
    quality: ProcessingQuality = ProcessingQuality.BALANCED
    preserve_dynamics: bool = True
    target_sample_rate: Optional[int] = None
    target_bit_depth: int = 16
    normalize_audio: bool = True
    target_lufs: float = -23.0  # EBU R128 standard
    noise_reduction_strength: float = 0.5  # 0.0 to 1.0
    silence_threshold: float = -40.0  # dB
    silence_min_duration: float = 0.5  # seconds


@dataclass
class ProcessingResult:
    """Result of audio processing operation"""
    success: bool
    output_path: Optional[str] = None
    original_duration: float = 0.0
    processed_duration: float = 0.0
    noise_reduction_db: float = 0.0
    silence_removed_seconds: float = 0.0
    dynamic_range_db: float = 0.0
    peak_level_db: float = 0.0
    rms_level_db: float = 0.0
    error_message: Optional[str] = None


class AudioEnhancer:
    """Advanced audio enhancement and processing"""
    
    def __init__(self, settings: AudioProcessingSettings = None):
        self.settings = settings or AudioProcessingSettings()
        self.temp_files = []
        
    def __del__(self):
        """Clean up temporary files"""
        self.cleanup_temp_files()
    
    def cleanup_temp_files(self):
        """Remove temporary files created during processing"""
        for temp_file in self.temp_files:
            try:
                if os.path.exists(temp_file):
                    os.remove(temp_file)
            except Exception as e:
                logger.warning("AudioEnhancer", "cleanup_temp_files", f"Failed to remove {temp_file}: {e}")
        self.temp_files.clear()
    
    def process_audio_file(self, input_path: str, output_path: str, 
                          progress_callback=None) -> ProcessingResult:
        """
        Process audio file with all enhancement features
        
        Args:
            input_path: Path to input audio file
            output_path: Path for output audio file
            progress_callback: Optional callback for progress updates
            
        Returns:
            ProcessingResult with operation details
        """
        try:
            logger.info("AudioEnhancer", "process_audio_file", f"Processing {input_path}")
            
            if progress_callback:
                progress_callback(0, "Loading audio file...")
            
            # Load audio
            audio_data, sample_rate = self._load_audio(input_path)
            original_duration = len(audio_data) / sample_rate
            
            if progress_callback:
                progress_callback(10, "Analyzing audio...")
            
            # Analyze audio characteristics
            analysis = self._analyze_audio(audio_data, sample_rate)
            
            if progress_callback:
                progress_callback(20, "Applying noise reduction...")
            
            # Apply noise reduction
            if self.settings.noise_reduction_strength > 0:
                audio_data, noise_reduction_db = self._reduce_noise(
                    audio_data, sample_rate, self.settings.noise_reduction_strength
                )
            else:
                noise_reduction_db = 0.0
            
            if progress_callback:
                progress_callback(40, "Detecting and removing silence...")
            
            # Remove silence
            audio_data, silence_removed = self._remove_silence(
                audio_data, sample_rate,
                threshold_db=self.settings.silence_threshold,
                min_duration=self.settings.silence_min_duration
            )
            
            if progress_callback:
                progress_callback(60, "Enhancing audio quality...")
            
            # Apply audio enhancement
            audio_data = self._enhance_audio_quality(audio_data, sample_rate)
            
            if progress_callback:
                progress_callback(80, "Normalizing audio levels...")
            
            # Normalize audio
            if self.settings.normalize_audio:
                audio_data = self._normalize_audio(audio_data, self.settings.target_lufs)
            
            if progress_callback:
                progress_callback(90, "Saving processed audio...")
            
            # Save processed audio
            self._save_audio(audio_data, sample_rate, output_path)
            
            # Calculate final metrics
            processed_duration = len(audio_data) / sample_rate
            final_analysis = self._analyze_audio(audio_data, sample_rate)
            
            if progress_callback:
                progress_callback(100, "Processing complete!")
            
            result = ProcessingResult(
                success=True,
                output_path=output_path,
                original_duration=original_duration,
                processed_duration=processed_duration,
                noise_reduction_db=noise_reduction_db,
                silence_removed_seconds=silence_removed,
                dynamic_range_db=final_analysis['dynamic_range_db'],
                peak_level_db=final_analysis['peak_level_db'],
                rms_level_db=final_analysis['rms_level_db']
            )
            
            logger.info("AudioEnhancer", "process_audio_file", 
                       f"Processing complete. Duration: {original_duration:.1f}s -> {processed_duration:.1f}s")
            
            return result
            
        except Exception as e:
            logger.error("AudioEnhancer", "process_audio_file", f"Processing failed: {e}")
            return ProcessingResult(
                success=False,
                error_message=str(e)
            )
    
    def _load_audio(self, file_path: str) -> Tuple[np.ndarray, int]:
        """Load audio file and return data and sample rate"""
        try:
            # Try librosa first (supports more formats)
            if librosa is not None:
                audio_data, sample_rate = librosa.load(file_path, sr=None, mono=False)
                
                # Convert to mono if stereo
                if audio_data.ndim > 1:
                    audio_data = np.mean(audio_data, axis=0)
                
                return audio_data, sample_rate
            
            # Fallback to scipy for WAV files
            elif file_path.lower().endswith('.wav'):
                sample_rate, audio_data = wavfile.read(file_path)
                
                # Convert to float and normalize
                if audio_data.dtype == np.int16:
                    audio_data = audio_data.astype(np.float32) / 32768.0
                elif audio_data.dtype == np.int32:
                    audio_data = audio_data.astype(np.float32) / 2147483648.0
                
                # Convert to mono if stereo
                if audio_data.ndim > 1:
                    audio_data = np.mean(audio_data, axis=1)
                
                return audio_data, sample_rate
            
            else:
                raise ValueError(f"Unsupported audio format: {file_path}")
                
        except Exception as e:
            raise Exception(f"Failed to load audio file {file_path}: {e}")
    
    def _save_audio(self, audio_data: np.ndarray, sample_rate: int, output_path: str):
        """Save audio data to file"""
        try:
            # Use soundfile if available (better format support)
            if sf is not None:
                sf.write(output_path, audio_data, sample_rate, subtype='PCM_16')
            else:
                # Fallback to scipy for WAV
                # Convert to 16-bit integer
                audio_int16 = (audio_data * 32767).astype(np.int16)
                wavfile.write(output_path, sample_rate, audio_int16)
                
        except Exception as e:
            raise Exception(f"Failed to save audio file {output_path}: {e}")
    
    def _analyze_audio(self, audio_data: np.ndarray, sample_rate: int) -> Dict:
        """Analyze audio characteristics"""
        try:
            # Calculate basic metrics
            peak_level = np.max(np.abs(audio_data))
            rms_level = np.sqrt(np.mean(audio_data ** 2))
            
            # Convert to dB
            peak_level_db = 20 * np.log10(peak_level) if peak_level > 0 else -np.inf
            rms_level_db = 20 * np.log10(rms_level) if rms_level > 0 else -np.inf
            
            # Calculate dynamic range (simplified)
            sorted_samples = np.sort(np.abs(audio_data))
            percentile_95 = sorted_samples[int(0.95 * len(sorted_samples))]
            percentile_10 = sorted_samples[int(0.10 * len(sorted_samples))]
            
            dynamic_range_db = 20 * np.log10(percentile_95 / percentile_10) if percentile_10 > 0 else 0
            
            # Spectral analysis
            freqs, psd = signal.welch(audio_data, sample_rate, nperseg=1024)
            spectral_centroid = np.sum(freqs * psd) / np.sum(psd)
            
            return {
                'peak_level_db': peak_level_db,
                'rms_level_db': rms_level_db,
                'dynamic_range_db': dynamic_range_db,
                'spectral_centroid': spectral_centroid,
                'duration': len(audio_data) / sample_rate
            }
            
        except Exception as e:
            logger.error("AudioEnhancer", "_analyze_audio", f"Analysis failed: {e}")
            return {
                'peak_level_db': 0,
                'rms_level_db': 0,
                'dynamic_range_db': 0,
                'spectral_centroid': 0,
                'duration': 0
            }
    
    def _reduce_noise(self, audio_data: np.ndarray, sample_rate: int, 
                     strength: float) -> Tuple[np.ndarray, float]:
        """Apply noise reduction to audio"""
        try:
            if NOISEREDUCE_AVAILABLE and strength > 0:
                # Use noisereduce library if available
                reduced_audio = nr.reduce_noise(
                    y=audio_data,
                    sr=sample_rate,
                    prop_decrease=strength,
                    stationary=False
                )
                
                # Calculate noise reduction amount
                original_noise = np.std(audio_data[:int(0.1 * len(audio_data))])  # First 10%
                reduced_noise = np.std(reduced_audio[:int(0.1 * len(reduced_audio))])
                
                noise_reduction_db = 20 * np.log10(original_noise / reduced_noise) if reduced_noise > 0 else 0
                
                return reduced_audio, noise_reduction_db
            
            else:
                # Fallback: Simple spectral subtraction
                return self._spectral_subtraction(audio_data, sample_rate, strength)
                
        except Exception as e:
            logger.warning("AudioEnhancer", "_reduce_noise", f"Noise reduction failed: {e}")
            return audio_data, 0.0
    
    def _spectral_subtraction(self, audio_data: np.ndarray, sample_rate: int, 
                            strength: float) -> Tuple[np.ndarray, float]:
        """Simple spectral subtraction noise reduction"""
        try:
            # Parameters
            frame_size = 1024
            hop_size = frame_size // 4
            alpha = strength * 2.0  # Oversubtraction factor
            
            # Estimate noise from first 0.5 seconds
            noise_frames = int(0.5 * sample_rate / hop_size)
            
            # STFT
            f, t, stft_data = signal.stft(audio_data, sample_rate, 
                                        nperseg=frame_size, noverlap=frame_size-hop_size)
            
            # Estimate noise spectrum (average of first frames)
            noise_spectrum = np.mean(np.abs(stft_data[:, :noise_frames]), axis=1, keepdims=True)
            
            # Apply spectral subtraction
            magnitude = np.abs(stft_data)
            phase = np.angle(stft_data)
            
            # Subtract noise
            enhanced_magnitude = magnitude - alpha * noise_spectrum
            
            # Apply spectral floor (prevent over-subtraction)
            spectral_floor = 0.1 * magnitude
            enhanced_magnitude = np.maximum(enhanced_magnitude, spectral_floor)
            
            # Reconstruct signal
            enhanced_stft = enhanced_magnitude * np.exp(1j * phase)
            _, enhanced_audio = signal.istft(enhanced_stft, sample_rate,
                                           nperseg=frame_size, noverlap=frame_size-hop_size)
            
            # Calculate noise reduction
            noise_reduction_db = 20 * np.log10(np.mean(noise_spectrum) / 
                                             np.mean(enhanced_magnitude[:, :noise_frames]))
            
            return enhanced_audio[:len(audio_data)], noise_reduction_db
            
        except Exception as e:
            logger.error("AudioEnhancer", "_spectral_subtraction", f"Spectral subtraction failed: {e}")
            return audio_data, 0.0
    
    def _remove_silence(self, audio_data: np.ndarray, sample_rate: int,
                       threshold_db: float = -40.0, min_duration: float = 0.5) -> Tuple[np.ndarray, float]:
        """Remove silence from audio"""
        try:
            # Convert threshold to linear scale
            threshold_linear = 10 ** (threshold_db / 20)
            
            # Calculate frame-based energy
            frame_size = int(0.025 * sample_rate)  # 25ms frames
            hop_size = int(0.010 * sample_rate)    # 10ms hop
            
            frames = []
            for i in range(0, len(audio_data) - frame_size, hop_size):
                frame = audio_data[i:i + frame_size]
                energy = np.sqrt(np.mean(frame ** 2))
                frames.append((i, energy > threshold_linear))
            
            # Find continuous speech segments
            speech_segments = []
            current_start = None
            
            for i, (frame_start, is_speech) in enumerate(frames):
                if is_speech and current_start is None:
                    current_start = frame_start
                elif not is_speech and current_start is not None:
                    # End of speech segment
                    segment_duration = (frame_start - current_start) / sample_rate
                    if segment_duration >= min_duration:
                        speech_segments.append((current_start, frame_start))
                    current_start = None
            
            # Handle case where speech continues to end
            if current_start is not None:
                segment_duration = (len(audio_data) - current_start) / sample_rate
                if segment_duration >= min_duration:
                    speech_segments.append((current_start, len(audio_data)))
            
            # Concatenate speech segments
            if speech_segments:
                processed_audio = []
                for start, end in speech_segments:
                    processed_audio.append(audio_data[start:end])
                
                result_audio = np.concatenate(processed_audio)
                silence_removed = (len(audio_data) - len(result_audio)) / sample_rate
                
                logger.info("AudioEnhancer", "_remove_silence", 
                           f"Removed {silence_removed:.1f}s of silence")
                
                return result_audio, silence_removed
            else:
                # No speech detected, return original
                return audio_data, 0.0
                
        except Exception as e:
            logger.error("AudioEnhancer", "_remove_silence", f"Silence removal failed: {e}")
            return audio_data, 0.0
    
    def _enhance_audio_quality(self, audio_data: np.ndarray, sample_rate: int) -> np.ndarray:
        """Apply audio quality enhancement"""
        try:
            enhanced_audio = audio_data.copy()
            
            # Apply gentle high-pass filter to remove low-frequency noise
            if sample_rate > 8000:  # Only for higher sample rates
                nyquist = sample_rate / 2
                high_cutoff = min(80, nyquist * 0.01)  # 80 Hz or 1% of Nyquist
                
                sos = signal.butter(2, high_cutoff / nyquist, btype='high', output='sos')
                enhanced_audio = signal.sosfilt(sos, enhanced_audio)
            
            # Apply gentle low-pass filter for anti-aliasing
            if sample_rate > 16000:
                nyquist = sample_rate / 2
                low_cutoff = min(8000, nyquist * 0.9)  # 8 kHz or 90% of Nyquist
                
                sos = signal.butter(4, low_cutoff / nyquist, btype='low', output='sos')
                enhanced_audio = signal.sosfilt(sos, enhanced_audio)
            
            # Apply gentle compression to even out dynamics
            enhanced_audio = self._apply_compression(enhanced_audio, ratio=2.0, threshold=-20.0)
            
            # Apply de-emphasis if needed (reverse pre-emphasis)
            if self.settings.quality == ProcessingQuality.HIGH_QUALITY:
                enhanced_audio = self._apply_deemphasis(enhanced_audio, sample_rate)
            
            return enhanced_audio
            
        except Exception as e:
            logger.error("AudioEnhancer", "_enhance_audio_quality", f"Enhancement failed: {e}")
            return audio_data
    
    def _apply_compression(self, audio_data: np.ndarray, ratio: float = 2.0, 
                          threshold: float = -20.0) -> np.ndarray:
        """Apply dynamic range compression"""
        try:
            # Convert threshold to linear scale
            threshold_linear = 10 ** (threshold / 20)
            
            # Simple compression algorithm
            compressed_audio = audio_data.copy()
            
            for i in range(len(compressed_audio)):
                sample_abs = abs(compressed_audio[i])
                
                if sample_abs > threshold_linear:
                    # Apply compression above threshold
                    excess = sample_abs - threshold_linear
                    compressed_excess = excess / ratio
                    new_amplitude = threshold_linear + compressed_excess
                    
                    # Preserve sign
                    compressed_audio[i] = new_amplitude * np.sign(compressed_audio[i])
            
            return compressed_audio
            
        except Exception as e:
            logger.error("AudioEnhancer", "_apply_compression", f"Compression failed: {e}")
            return audio_data
    
    def _apply_deemphasis(self, audio_data: np.ndarray, sample_rate: int) -> np.ndarray:
        """Apply de-emphasis filter"""
        try:
            # Standard de-emphasis filter (75 μs time constant)
            tau = 75e-6  # 75 microseconds
            alpha = np.exp(-1 / (sample_rate * tau))
            
            # First-order IIR filter: y[n] = alpha * y[n-1] + (1-alpha) * x[n]
            deemphasized = np.zeros_like(audio_data)
            deemphasized[0] = audio_data[0]
            
            for i in range(1, len(audio_data)):
                deemphasized[i] = alpha * deemphasized[i-1] + (1-alpha) * audio_data[i]
            
            return deemphasized
            
        except Exception as e:
            logger.error("AudioEnhancer", "_apply_deemphasis", f"De-emphasis failed: {e}")
            return audio_data
    
    def _normalize_audio(self, audio_data: np.ndarray, target_lufs: float = -23.0) -> np.ndarray:
        """Normalize audio to target LUFS level"""
        try:
            # Simple RMS-based normalization (approximation of LUFS)
            current_rms = np.sqrt(np.mean(audio_data ** 2))
            
            if current_rms > 0:
                # Convert target LUFS to linear scale (approximation)
                target_rms = 10 ** (target_lufs / 20)
                
                # Calculate gain needed
                gain = target_rms / current_rms
                
                # Apply gain with limiting to prevent clipping
                normalized_audio = audio_data * gain
                
                # Soft limiting
                peak = np.max(np.abs(normalized_audio))
                if peak > 0.95:  # Leave some headroom
                    normalized_audio = normalized_audio * (0.95 / peak)
                
                return normalized_audio
            else:
                return audio_data
                
        except Exception as e:
            logger.error("AudioEnhancer", "_normalize_audio", f"Normalization failed: {e}")
            return audio_data
    
    def convert_format(self, input_path: str, output_path: str, 
                      target_format: str, target_sample_rate: int = None,
                      target_bit_depth: int = 16) -> bool:
        """Convert audio file format"""
        try:
            logger.info("AudioEnhancer", "convert_format", 
                       f"Converting {input_path} to {target_format}")
            
            if PYDUB_AVAILABLE:
                # Use pydub for format conversion
                audio = AudioSegment.from_file(input_path)
                
                # Resample if needed
                if target_sample_rate and audio.frame_rate != target_sample_rate:
                    audio = audio.set_frame_rate(target_sample_rate)
                
                # Set bit depth
                if target_bit_depth == 16:
                    audio = audio.set_sample_width(2)
                elif target_bit_depth == 24:
                    audio = audio.set_sample_width(3)
                elif target_bit_depth == 32:
                    audio = audio.set_sample_width(4)
                
                # Export with format
                audio.export(output_path, format=target_format)
                
                logger.info("AudioEnhancer", "convert_format", "Conversion successful")
                return True
            
            else:
                # Fallback: Load and save with different format
                audio_data, sample_rate = self._load_audio(input_path)
                
                if target_sample_rate and sample_rate != target_sample_rate:
                    # Simple resampling
                    audio_data = signal.resample(
                        audio_data, 
                        int(len(audio_data) * target_sample_rate / sample_rate)
                    )
                    sample_rate = target_sample_rate
                
                self._save_audio(audio_data, sample_rate, output_path)
                return True
                
        except Exception as e:
            logger.error("AudioEnhancer", "convert_format", f"Format conversion failed: {e}")
            return False
    
    def batch_process(self, input_files: List[str], output_dir: str,
                     progress_callback=None) -> List[ProcessingResult]:
        """Process multiple audio files"""
        results = []
        total_files = len(input_files)
        
        for i, input_file in enumerate(input_files):
            try:
                if progress_callback:
                    progress_callback(i / total_files * 100, f"Processing {os.path.basename(input_file)}")
                
                # Generate output filename
                base_name = os.path.splitext(os.path.basename(input_file))[0]
                output_file = os.path.join(output_dir, f"{base_name}_enhanced.wav")
                
                # Process file
                result = self.process_audio_file(input_file, output_file)
                results.append(result)
                
            except Exception as e:
                logger.error("AudioEnhancer", "batch_process", f"Failed to process {input_file}: {e}")
                results.append(ProcessingResult(
                    success=False,
                    error_message=str(e)
                ))
        
        if progress_callback:
            progress_callback(100, "Batch processing complete!")
        
        return results


class AudioFormatConverter:
    """Specialized audio format converter"""
    
    SUPPORTED_FORMATS = {
        'wav': {'extension': '.wav', 'codec': 'pcm_s16le'},
        'mp3': {'extension': '.mp3', 'codec': 'mp3'},
        'flac': {'extension': '.flac', 'codec': 'flac'},
        'ogg': {'extension': '.ogg', 'codec': 'vorbis'},
        'm4a': {'extension': '.m4a', 'codec': 'aac'},
        'aac': {'extension': '.aac', 'codec': 'aac'}
    }
    
    def __init__(self):
        self.temp_files = []
    
    def convert(self, input_path: str, output_path: str, 
               target_format: str, quality: str = 'high') -> bool:
        """Convert audio file to target format"""
        try:
            if target_format not in self.SUPPORTED_FORMATS:
                raise ValueError(f"Unsupported format: {target_format}")
            
            if PYDUB_AVAILABLE:
                return self._convert_with_pydub(input_path, output_path, target_format, quality)
            else:
                return self._convert_basic(input_path, output_path, target_format)
                
        except Exception as e:
            logger.error("AudioFormatConverter", "convert", f"Conversion failed: {e}")
            return False
    
    def _convert_with_pydub(self, input_path: str, output_path: str,
                           target_format: str, quality: str) -> bool:
        """Convert using pydub"""
        try:
            audio = AudioSegment.from_file(input_path)
            
            # Quality settings
            export_params = {}
            
            if target_format == 'mp3':
                if quality == 'high':
                    export_params['bitrate'] = '320k'
                elif quality == 'medium':
                    export_params['bitrate'] = '192k'
                else:
                    export_params['bitrate'] = '128k'
            
            elif target_format == 'ogg':
                if quality == 'high':
                    export_params['parameters'] = ['-q:a', '8']
                elif quality == 'medium':
                    export_params['parameters'] = ['-q:a', '5']
                else:
                    export_params['parameters'] = ['-q:a', '2']
            
            audio.export(output_path, format=target_format, **export_params)
            return True
            
        except Exception as e:
            logger.error("AudioFormatConverter", "_convert_with_pydub", f"Pydub conversion failed: {e}")
            return False
    
    def _convert_basic(self, input_path: str, output_path: str, target_format: str) -> bool:
        """Basic conversion for WAV files"""
        try:
            if target_format != 'wav':
                raise ValueError("Basic converter only supports WAV output")
            
            # Load and save as WAV
            enhancer = AudioEnhancer()
            audio_data, sample_rate = enhancer._load_audio(input_path)
            enhancer._save_audio(audio_data, sample_rate, output_path)
            
            return True
            
        except Exception as e:
            logger.error("AudioFormatConverter", "_convert_basic", f"Basic conversion failed: {e}")
            return False
    
    def get_supported_formats(self) -> List[str]:
        """Get list of supported output formats"""
        return list(self.SUPPORTED_FORMATS.keys())
    
    def cleanup_temp_files(self):
        """Clean up temporary files"""
        for temp_file in self.temp_files:
            try:
                if os.path.exists(temp_file):
                    os.remove(temp_file)
            except Exception as e:
                logger.warning("AudioFormatConverter", "cleanup_temp_files", 
                             f"Failed to remove {temp_file}: {e}")
        self.temp_files.clear()


# Utility functions for integration with main application

def enhance_audio_file(input_path: str, output_path: str, 
                      settings: AudioProcessingSettings = None,
                      progress_callback=None) -> ProcessingResult:
    """
    Convenience function to enhance a single audio file
    
    Args:
        input_path: Path to input audio file
        output_path: Path for enhanced output file
        settings: Processing settings (optional)
        progress_callback: Progress callback function (optional)
        
    Returns:
        ProcessingResult with operation details
    """
    enhancer = AudioEnhancer(settings)
    try:
        return enhancer.process_audio_file(input_path, output_path, progress_callback)
    finally:
        enhancer.cleanup_temp_files()


def convert_audio_format(input_path: str, output_path: str, 
                        target_format: str, quality: str = 'high') -> bool:
    """
    Convenience function to convert audio format
    
    Args:
        input_path: Path to input audio file
        output_path: Path for converted output file
        target_format: Target format (wav, mp3, flac, etc.)
        quality: Quality setting (high, medium, low)
        
    Returns:
        True if conversion successful, False otherwise
    """
    converter = AudioFormatConverter()
    try:
        return converter.convert(input_path, output_path, target_format, quality)
    finally:
        converter.cleanup_temp_files()


def get_audio_analysis(file_path: str) -> Dict:
    """
    Get detailed analysis of audio file
    
    Args:
        file_path: Path to audio file
        
    Returns:
        Dictionary with audio analysis results
    """
    enhancer = AudioEnhancer()
    try:
        audio_data, sample_rate = enhancer._load_audio(file_path)
        return enhancer._analyze_audio(audio_data, sample_rate)
    except Exception as e:
        logger.error("get_audio_analysis", "analysis", f"Analysis failed: {e}")
        return {}
    finally:
        enhancer.cleanup_temp_files()