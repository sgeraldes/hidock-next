# HiDock Desktop Application 🖥️

**Transform your HiDock recordings with reliable device management and local audio control**

![HiDock Desktop Screenshot](../docs/assets/hidock-desktop-screenshot.png)

[![Python 3.12+](https://img.shields.io/badge/python-3.12+-blue.svg)](https://www.python.org/downloads/)
[![CustomTkinter](https://img.shields.io/badge/GUI-CustomTkinter-green.svg)](https://github.com/TomSchimansky/CustomTkinter)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 🎯 What is HiDock Desktop?

HiDock Desktop is a **free, open-source application** that connects to your **HiDock recording device** via USB, giving you complete control over your audio recordings:

- **📁 Manage recordings** - Download, organize, and play your audio files locally
- **🎵 Audio Playback** - Basic playback controls with waveform visualization
- **🔒 Privacy-first** - Everything stays on your device, no internet required
- **💾 Your data, your control** - You own the hardware, you own the files

**Perfect for:** Conference calls, meetings, interviews, lectures, and any audio recording needs where you want
complete control and privacy.

## ✨ Current Features

### 🎵 **Audio Playback** *(Work in Progress)*
- **Basic Playback:** Play, pause, stop controls with volume adjustment
- **Visual Analysis:** Real-time waveform display and spectrum analyzer
- **Format Support:** Native HiDock .hda files, plus .wav, .mp3, .flac
- **⚠️ Known Issues:** Speed control has bugs (pitch changes, occasional failures)

### 🔌 **Reliable Device Management**
- **Direct USB Connection:** Stable communication with your HiDock device
- **File Operations:** Download, delete, and manage files reliably
- **Live Monitoring:** Real-time device status and storage information
- **Batch Operations:** Multi-file download and delete operations
- **Smart Caching:** Efficient data handling for responsive interface

### 🎨 **Modern Interface**
- **Intuitive Design:** Clean, professional interface that's easy to use
- **Dark/Light Themes:** Choose your preferred visual style
- **Responsive Layout:** Adapts to your screen size and preferences
- **Font Awesome Icons:** Professional iconography throughout

### 🔒 **Privacy & Control**
- **Completely Local:** No internet connection required
- **Your Data:** Files stay on your device, you control everything
- **Open Source:** Full transparency, modify as needed
- **No Telemetry:** Zero data collection or tracking

## 🗺️ Roadmap

### 🎯 **Phase 1: Audio Improvements (Next Release)**
- **🔧 Fix Speed Control:** Resolve pitch changes and playback failures
- **⏯️ Enhanced Playback:** Reliable variable speed (0.25x-2.0x) without pitch distortion
- **⏱️ Precise Seeking:** Accurate position control and timeline navigation

### 🎯 **Phase 2: Smart Organization**
- **📝 File Tagging:** Add custom tags to organize recordings by topic, project, or type
- **🔍 Smart Search:** Find recordings by tags, date, duration, or filename
- **📊 Recording Insights:** See recording statistics, duration trends, storage usage

### 🎯 **Phase 3: Calendar Integration** *(Windows Only)*
- **📅 Outlook Calendar Integration:** Automatically correlate recordings with calendar meetings
- **🪟 Windows Platform:** Uses Outlook COM API - works with installed Outlook
- **🔒 Secure Authentication:** OAuth2 integration with Microsoft Graph API
- **📋 Future Enhancement:** Cross-platform .ics file import planned

### 🎯 **Phase 4: AI-Powered Features**
- **🤖 Local AI Transcription:** Convert speech to text with offline models
- **📋 Smart Summaries:** Generate meeting summaries and action items
- **🔍 Content Search:** Search within transcribed audio content
- **🏷️ Auto-Tagging:** AI-suggested tags based on audio content

### 🎯 **Phase 5: Advanced Collaboration (Future)**
- **📤 Secure Sharing:** Share recordings with encrypted links
- **👥 Team Workspaces:** Collaborate on recordings with team members
- **📝 Collaborative Notes:** Add shared notes and comments to recordings
- **🔄 Version Control:** Track changes and annotations over time

### 🎯 **Future Enhancements**
- **🌐 Web Dashboard:** Browser-based interface for remote access
- **📱 Mobile Companion:** iOS/Android app for remote control
- **🔗 API Access:** Integrate with other tools and workflows
- **🎙️ Live Streaming:** Real-time audio streaming capabilities

## 🚀 Quick Start

### **Prerequisites: Install Python First**

**Don't have Python?** No problem! Here's how to get it:

1. **Visit the Python website:** [python.org/downloads](https://www.python.org/downloads/)
2. **Download Python 3.12** (the version this application is built for)
3. **During installation:**
   - ✅ **Check "Add Python to PATH"** (very important!)
   - ✅ Use default settings for everything else
4. **Verify installation:** Open terminal/command prompt and type:
   ```bash
   python --version
   ```
   You should see something like "Python 3.12.x"

**Already have Python?** Make sure it's version 3.12 with the command above.

### **Option 1: Easy Installation (Recommended for most users)**

1. **Download** the project and open a terminal/command prompt
2. **Run the automated setup:**
   ```bash
   python setup.py
   ```
   Choose **Option 1** for standard installation
   
   **Linux users:** The setup will automatically detect missing system dependencies and offer to install them.

3. **Launch the application:**
   ```bash
   cd hidock-desktop-app
   python main.py
   ```

### **Option 2: Manual Installation (For developers)**

```bash
# Navigate to the desktop app directory
cd hidock-desktop-app

# Create a virtual environment (recommended)
python -m venv .venv

# Activate the environment
.venv\Scripts\activate  # Windows
# source .venv/bin/activate  # Linux/macOS

# Install the application with development tools
pip install -e ".[dev]"

# Note: Calendar integration dependencies are included by default
# Works on Windows only (uses Outlook COM API)

# Run the application
python main.py
```

## 📋 System Requirements

- **Operating System:** Windows 10+, macOS 10.14+, or Linux (Ubuntu 20.04+)
- **Python:** Version 3.12 specifically *(see installation steps above)*
- **USB:** Available USB port for HiDock device connection
- **Storage:** ~200MB for application and dependencies
- **Internet:** Only needed for initial Python/dependency download

### **System Dependencies**

#### **🪟 Windows**
Usually works out of the box - libusb is included with the Python dependencies.

#### **🍎 macOS** 
Install Homebrew, then run: `brew install libusb`

#### **🐧 Linux (Recommended: Automated Setup)**
**Best Option - Automated Script:**
```bash
python3 setup_linux_deps.py
```

**What this script does:**
- ✅ **System Packages**: Installs tkinter, ffmpeg, libusb, audio libs, build tools
- ✅ **USB Permissions**: Adds user to `dialout` group automatically
- ✅ **Udev Rules**: Creates and installs device-specific USB access rules
- ✅ **Dependency Verification**: Tests all components after installation
- ✅ **Smart Package Manager**: Uses `nala` if available, falls back to `apt`
- ✅ **User Guidance**: Provides troubleshooting tips and next steps

**Manual Installation (Advanced Users):**
```bash
# Core system dependencies
sudo apt update
sudo apt install -y python3-tk python3-dev build-essential
sudo apt install -y ffmpeg libavcodec-extra portaudio19-dev
sudo apt install -y libusb-1.0-0-dev libudev-dev pkg-config

# Set up USB permissions for device access
sudo usermod -a -G dialout $USER
# Create udev rule for HiDock device (replace VID:PID as needed)
echo 'SUBSYSTEM=="usb", ATTR{idVendor}=="10d6", ATTR{idProduct}=="b00d", GROUP="dialout", MODE="0664"' | sudo tee /etc/udev/rules.d/99-hidock.rules
sudo udevadm control --reload-rules
sudo udevadm trigger
# Log out and back in for group changes to take effect
```

## 🎯 Getting Started

1. **Connect your HiDock device** via USB
2. **Launch the application** using the quick start instructions above
3. **Download your recordings** from the device to your computer
4. **Start organizing and playing** your audio files with basic controls

## ⚙️ Configuration

The application uses `hidock_config.json` to store your preferences, device settings, and encrypted API keys.

**🔒 Security Note:** This file contains encrypted sensitive data and is automatically excluded from version control.

**📁 Location:** The config file is created in the application directory on first run.

**🔧 Setup:**
- Copy `hidock_config.json.example` to `hidock_config.json` to get started
- The application will create default settings if no config file exists
- All API keys are encrypted using Fernet encryption before storage

## 📚 Documentation & Support

**For detailed information:**
- [📖 Complete Documentation](../docs/) - Installation guides, troubleshooting, advanced features
- [👨‍💻 Development Guide](../CONTRIBUTING.md) - Contributing, code standards, development setup

**Need help?** Check our documentation or open an issue on GitHub.

## 🔒 Privacy & Security

- **Completely Local:** All operations happen on your device, no cloud required
- **No Data Collection:** Zero telemetry, tracking, or data transmission
- **Your Hardware, Your Files:** You own and control everything
- **Open Source:** Full transparency - inspect and modify the code
- **Offline First:** Core functionality works without internet connection

## 📄 License

This project is licensed under the MIT License - free for personal and commercial use.

---

**Ready to transform your HiDock experience?** [⬆️ Follow the Quick Start guide](#-quick-start) to begin!

*Part of the HiDock Next ecosystem. See [main README](../README.md) for the complete project overview.*
