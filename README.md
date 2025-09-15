# HiDock Next 🎵

Desktop & Web Applications for Managing Files on HiDock® Devices

> **Disclaimer:** This is an unofficial, third-party application not affiliated with or endorsed by HiDock or its manufacturers. HiDock® is a trademark of its respective owners.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![Python 3.12+](https://img.shields.io/badge/python-3.12+-blue.svg)](https://www.python.org/downloads/) [![TypeScript](https://img.shields.io/badge/typescript-5.0+-blue.svg)](https://www.typescriptlang.org/) [![Version](https://img.shields.io/badge/version-1.0--RC1-green.svg)](https://github.com/sgeraldes/hidock-next/releases)

![Desktop Application Screenshot](docs/hidock-desktop-app.png)
_Desktop file manager for HiDock® devices - Download, organize, and transcribe audio files_

## ✨ Features

- 🎙️ **Device File Management** - Browse, download, and organize files from HiDock® devices
- 🎵 **Advanced Audio Player** - Built-in player with waveform visualization
- 🤖 **AI Transcription** - Support for 11+ AI providers (OpenAI, Gemini, Claude, etc.)
- 📅 **Calendar Integration** - Automatic meeting correlation (Windows)
- 📁 **Smart File Management** - Batch operations, filtering, and organization
- 🌐 **Cross-Platform** - Windows, macOS, and Linux support
- 🚀 **High Performance** - Optimized for large file collections

## 🚀 Quick Start

### Windows

```cmd
git clone https://github.com/sgeraldes/hidock-next.git
cd hidock-next
setup-windows.bat
run-desktop.bat
```

### macOS / Linux

```bash
git clone https://github.com/sgeraldes/hidock-next.git
cd hidock-next
./setup-unix.sh
./run-desktop.sh
```

## 📦 Applications

### [Desktop App](apps/desktop/) - Full-Featured Management

- Complete USB device control
- Advanced audio playback with visualization
- AI transcription with multiple providers
- Calendar integration (Windows)
- Batch file operations

### [Web App](apps/web/) - Modern Web Interface

- React/TypeScript implementation
- Real-time device monitoring
- Responsive design
- Cross-browser support

### [Audio Insights](apps/audio-insights/) - AI Analysis Tool

- Audio file analysis
- Transcription extraction
- Insights generation

## 🛠️ Requirements

- **Python** 3.12 or higher
- **Node.js** 18 or higher (for web apps)
- **USB Driver** for HiDock devices
- **OS**: Windows 10+, macOS 12+, Ubuntu 20.04+

## 📊 Platform Support

| Feature              | Windows          | macOS            | Linux            |
| -------------------- | ---------------- | ---------------- | ---------------- |
| Device Management    | ✅ Full          | ✅ Full          | ✅ Full          |
| Audio Processing     | ✅ Full          | ✅ Full          | ✅ Full          |
| Calendar Integration | ✅ Outlook       | ❌               | ❌               |
| AI Transcription     | ✅ All Providers | ✅ All Providers | ✅ All Providers |

## 📂 Project Structure

```folder
hidock-next/
├── apps/               # Applications
│   ├── desktop/        # Desktop application (Python/Tkinter)
│   ├── web/            # Web application (React/TypeScript)
│   └── audio-insights/ # Audio analysis tool
├── research/           # Research and reverse engineering tools
├── firmware/           # Device firmware files
├── docs/               # Documentation
├── scripts/            # Utility scripts
└── config/             # Configuration files
```

## 🔧 Development

### Setup Development Environment

```bash
python setup.py
# Choose option 2 (Developer)
```

### Running Tests

```bash
cd apps/desktop
pytest tests/
```

#### Test Markers & Fast vs Full Suite

By default the repository defines markers to classify tests:

- `unit` – fast, pure-Python or lightweight logic
- `integration` – touches external systems, heavier setup
- `gui` – requires a display / GUI toolkits
- `slow` – long-running or large dataset processing

The default invocation (no args) in local dev or CI (fast lane) skips
`integration`, `gui`, and `slow` to keep feedback loops tight.

Fast subset (default behavior via `pytest.ini`):

```bash
pytest -q
```

Run only integration tests:

```bash
pytest -m integration
```

Run full test suite (all markers):

```bash
pytest -m "unit or integration or gui or slow"
```

Or simply clear filtering by overriding `-m`:

```bash
pytest -m ""
```

Run everything including verbose output:

```bash
pytest -vv -m ""
```

Example: run unit + slow (e.g., for a targeted performance check):

```bash
pytest -m "unit or slow"
```

If you maintain custom CI stages, you can mirror this split:

| Stage        | Command                                |
|--------------|-----------------------------------------|
| fast (default)| `pytest -q`                            |
| integration  | `pytest -m integration -q`             |
| gui          | `pytest -m gui`                        |
| full         | `pytest -m "unit or integration or gui or slow"` |

Tip: Keep the quick path green before running the heavier suites.

### Building for Distribution

```bash
python scripts/build/build_desktop.py
```

### Virtual Environments

See `docs/VENV.md` for the per-platform virtual environment strategy (separate `.venv.<tag>` per OS/WSL). The runtime scripts (`run-desktop.*`) and setup logic auto-select or create the correct one via `scripts/env/select_venv.py`.

Common setup flags:

```bash
# Non-interactive full developer setup (auto-skip migration unless specified)
python setup.py --non-interactive

# Force legacy migration strategy
python setup.py --migrate=copy      # or --migrate=rebuild / --migrate=skip

# Explicit end-user minimal mode
python setup.py --mode=end-user

# Recreate tagged environment even if it exists
python setup.py --force-new-env

# Diagnose virtual environment only (no installs)
python setup.py --diagnose-venv

# Auto-install missing Debian/Ubuntu system dependencies (tk, ffmpeg, libusb, build tools)
python setup.py --auto-install-missing
```

Environment variable alternative for migration:

```bash
HIDOCK_AUTO_MIGRATE=c python setup.py   # c=copy, r=rebuild, s=skip
```

Environment variable alternative for auto-install (CI / scripted):

```bash
HIDOCK_AUTO_INSTALL_MISSING=1 python setup.py --non-interactive
```

### Linux System Dependencies

On Debian/Ubuntu based systems the setup script can detect and help resolve missing packages:

- python3-tk / python3-dev (Tkinter UI)
- ffmpeg / libavcodec-extra (audio transcoding)
- libusb-1.0-0-dev / libudev-dev / pkg-config (device communications)
- build-essential (compilation toolchain)
- dialout group membership (USB access)

If you see a prompt listing missing dependencies you can:

1. Run the bundled automated installer
2. View manual apt commands
3. Continue anyway (not recommended)

To skip prompts and let the script attempt installation automatically:

```bash
python setup.py --auto-install-missing --non-interactive
```

If packages fail to install you will still be able to continue, but Python dependency installation may later fail until system requirements are met.

## 📝 Documentation

- [Getting Started](docs/getting-started/QUICK_START.md)
- [Desktop App Guide](apps/desktop/README.md)
- [Web App Guide](apps/web/README.md)
- [API Documentation](docs/api/)
- [Troubleshooting](docs/TROUBLESHOOTING.md)

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- HiDock hardware team for device specifications
- Open source community for libraries and tools
- All contributors and testers

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/sgeraldes/hidock-next/issues)
- **Discussions**: [GitHub Discussions](https://github.com/sgeraldes/hidock-next/discussions)
- **Documentation**: [Full Docs](docs/)

---

**HiDock Next v1.0-RC1** - Ready for production use!
