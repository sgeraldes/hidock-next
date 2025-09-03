# Changelog

All notable changes to HiDock Next will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0-RC1] - 2025-09-01

### Added
- Complete USB device management with hot-plug support
- AI transcription support for 11+ providers
- Calendar integration for Windows Outlook
- Advanced audio player with waveform visualization
- Toast notifications with multi-monitor support
- Batch file operations with progress tracking
- Web application with React/TypeScript
- Audio Insights standalone tool
- Comprehensive documentation and guides
- Cross-platform support (Windows, macOS, Linux)

### Changed
- Complete repository reorganization for better structure
- Migrated from monolithic to modular architecture
- Improved USB communication protocol
- Enhanced error handling and recovery
- Optimized file listing performance (3-5x faster)
- Streamlined user interface with modern design

### Fixed
- USB buffer corruption on reconnection
- Application freezing during disconnect
- Toast notifications appearing on wrong monitor
- Settings not persisting between sessions
- Race conditions in file operations
- Memory leaks in long-running sessions
- Sequence ID synchronization issues
- Log level noise in normal operations

### Security
- Added input validation for all user inputs
- Implemented secure API key storage
- Enhanced USB communication security
- Added rate limiting for API calls

## [Beta 2] - 2025-08-15

### Added
- Initial AI transcription support
- Basic calendar integration
- File management features
- Audio playback capabilities

### Changed
- Updated UI framework to CustomTkinter
- Improved device detection

### Fixed
- Connection stability issues
- File transfer errors

## [Beta 1] - 2025-07-01

### Added
- Initial release
- Basic device connectivity
- File listing and download
- Simple audio player

### Known Issues
- Connection drops after extended use
- Limited AI provider support
- No calendar integration

## [Alpha] - 2025-06-01

### Added
- Proof of concept
- Basic USB communication
- File enumeration

---

[1.0-RC1]: https://github.com/sgeraldes/hidock-next/releases/tag/v1.0-RC1
[Beta 2]: https://github.com/sgeraldes/hidock-next/releases/tag/beta-2
[Beta 1]: https://github.com/sgeraldes/hidock-next/releases/tag/beta-1
[Alpha]: https://github.com/sgeraldes/hidock-next/releases/tag/alpha