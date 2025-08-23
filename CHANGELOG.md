# Changelog

All notable changes to HiDock Next will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Enhanced HTA Audio Conversion** - New `convert_hta_for_transcription()` function for AI-optimized MP3 output
- **P1 Device Variant Support** - Added support for HiDock P1 variant (PID: 0xB00E) devices
- **Smart Audio Resampling** - Automatic sample rate optimization for transcription services (16kHz for speech)
- **Enhanced Audio Duration Calculation** - Support for both WAV and MP3 formats with pydub integration
- **Cross-Platform USB Improvements** - Better kernel driver handling for macOS and Linux systems

### Changed
- **HTA Converter Architecture** - Refactored to support both WAV and MP3 output formats
- **Transcription Module** - Now automatically uses MP3 format for better AI service compatibility
- **USB Error Handling** - Improved error messages and graceful handling of permission issues
- **Audio Processing Pipeline** - Enhanced with transcription-optimized settings (16-bit, compatible sample rates)

### Fixed
- **macOS USB Driver Issues** - Better handling of kernel driver detachment on macOS systems
- **Linux Permission Errors** - Enhanced error messages with actionable guidance for USB access
- **Audio Format Compatibility** - Improved support for various audio formats in transcription pipeline

### Technical Details
- Enhanced `HTAConverter` class with dual-format support (WAV/MP3)
- Added `_convert_to_mp3_direct()` method for optimal transcription compatibility
- Implemented `_get_compatible_sample_rate()` for automatic audio optimization
- Enhanced USB backend initialization with better cross-platform error handling
- Added P1 variant device recognition in `EnhancedDeviceSelector`

### Contributors
- **[@Averus89](https://github.com/Averus89)** - First contributor, provided the foundation for enhanced HTA conversion and cross-platform USB improvements

---

## [Previous Releases]

### [0.1.0] - Initial Release
- Basic HTA to WAV conversion
- Multi-provider AI transcription support
- Desktop GUI with CustomTkinter
- Cross-platform USB device communication
- Comprehensive Linux setup automation
- 11 AI provider integrations
- Encrypted API key storage
- Real-time audio visualization
