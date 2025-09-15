# Troubleshooting Guide

This guide helps resolve common issues when working with the HiDock Next project.

## Table of Contents

- [General Issues](#general-issues)
- [Desktop Application Issues](#desktop-application-issues)
- [Web Application Issues](#web-application-issues)
- [Audio Insights Extractor Issues](#audio-insights-extractor-issues)
- [Device Connection Issues](#device-connection-issues)
- [AI Integration Issues](#ai-integration-issues)
- [Linux System Dependency Issues](#linux-system-dependency-issues)

## General Issues

### Python Virtual Environment Issues

#### Problem: Virtual environment activation fails

```bash
# Windows
.venv\Scripts\activate : File not found

# Solution: Recreate the virtual environment
python -m venv --clear .venv

# Or completely recreate:
rm -rf .venv  # Windows: rmdir /s .venv
python -m venv .venv
```

#### Problem: Module import errors

```bash
# Solution 1: Ensure virtual environment is activated
# Windows:
.venv\Scripts\activate
# Mac/Linux:
source .venv/bin/activate

# Solution 2: Reinstall dependencies
pip install -r requirements.txt

# Solution 3: Set PYTHONPATH
# Windows:
set PYTHONPATH=%PYTHONPATH%;%cd%
# Mac/Linux:
export PYTHONPATH="${PYTHONPATH}:$(pwd)"
```

### Node.js/npm Issues

#### Problem: npm install fails

```bash
# Clear npm cache
npm cache clean --force

# Delete node_modules and reinstall
rm -rf node_modules package-lock.json
npm install

# Use different npm registry
npm install --registry https://registry.npmjs.org/
```

#### Problem: Wrong Node.js version

```bash
# Check current version
node --version

# Should be 18 or higher. If not:
# Windows: Download from nodejs.org
# Mac: brew upgrade node
# Linux: Use NodeSource repositories
```

### pygame Installation Issues (Windows)

#### Problem: pygame fails to install with compilation errors

```bash
# Error: ModuleNotFoundError: No module named 'setuptools._distutils.msvccompiler'
# Error: Getting requirements to build wheel did not run successfully

# Solution 1: Install pre-compiled binary only
pip install pygame --only-binary=:all:

# Solution 2: Force reinstall with no cache
pip install pygame --force-reinstall --no-cache-dir --only-binary=:all:

# Solution 3: Use specific pygame version
pip install pygame==2.5.2 --only-binary=:all:

# Solution 4: Install prerequisites first
pip install --upgrade setuptools wheel
pip install pygame --only-binary=:all:
```

#### Problem: pygame still fails after binary installation

```bash
# Alternative: Install from conda-forge
conda install pygame -c conda-forge

# Or: Skip pygame for now (audio features won't work)
# Comment out pygame in requirements.txt temporarily
```

## Desktop Application Issues

### Problem: Application won't start

1. **Check Python version:**

   ```bash
   python --version  # Should be 3.12 for optimal compatibility
   # Windows: py -0 to see all versions, py -3.12 to use specific version
   ```

2. **Verify all dependencies installed:**

   ```bash
   pip list  # Check if customtkinter, pygame, etc. are listed
   ```

3. **Run with verbose logging:**

   ```bash
   python main.py --debug
   ```

### Problem: GUI rendering issues

- **Windows:** Update graphics drivers
- **Linux:** Install required system packages:

  ```bash
  sudo apt-get install python3-tk
  ```

- **All platforms:** Try setting environment variable:

  ```bash
  export TK_SILENCE_DEPRECATION=1
  ```

### Problem: libusb-1.0.dll not found (Windows)

1. Download from [libusb.info](https://libusb.info/)
2. Extract `libusb-1.0.dll` to `hidock-desktop-app/` directory
3. Ensure it's the correct architecture (32-bit vs 64-bit)

### Problem: Audio playback issues

- **All platforms:** Ensure pygame is properly installed:

  ```bash
  pip uninstall pygame
  pip install pygame
  ```

- **Linux:** Install audio libraries:

  ```bash
  sudo apt-get install libsdl2-mixer-2.0-0
  ```

## Web Application Issues

### Problem: Vite dev server won't start

1. **Check port 5173 is free:**

   ```bash
   # Windows:
   netstat -ano | findstr :5173
   # Mac/Linux:
   lsof -i :5173
   ```

2. **Try different port:**

   ```bash
   npm run dev -- --port 3000
   ```

### Problem: WebUSB not working

- **Requirement:** HTTPS is required for WebUSB in production
- **Chrome/Edge:** Check chrome://flags/#enable-experimental-web-platform-features
- **Permissions:** Ensure browser has permission to access USB devices

### Problem: TypeScript errors

```bash
# Clear TypeScript cache
rm -rf node_modules/.cache
npm run build
```

## Audio Insights Extractor Issues

### Problem: Google Gemini API errors

1. **Check API key is set:**
   - Verify in Settings page
   - Ensure key has proper permissions

2. **Rate limiting:**
   - Free tier has limits
   - Implement exponential backoff

### Problem: Audio file upload fails

- **File size:** Check if file exceeds browser limits
- **Format:** Ensure audio format is supported (WAV, MP3, M4A)
- **Memory:** Large files may cause browser memory issues

## Device Connection Issues

### Problem: HiDock device not detected

#### Windows

1. **Install WinUSB driver using Zadig:**
   - Download [Zadig](https://zadig.akeo.ie/)
   - Run as Administrator
   - Select HiDock device
   - Choose WinUSB driver
   - Click Install Driver

2. **Run application as Administrator**

#### Linux

1. **Add user to dialout group:**

   ```bash
   sudo usermod -a -G dialout $USER
   # Log out and back in
   ```

2. **Create udev rule:**

   ```bash
   # Create file: /etc/udev/rules.d/99-hidock.rules
   SUBSYSTEM=="usb", ATTR{idVendor}=="1234", ATTR{idProduct}=="5678", MODE="0666"

   # Reload rules
   sudo udevadm control --reload-rules
   sudo udevadm trigger
   ```

#### macOS

- Usually works without additional setup
- If issues, check System Preferences > Security & Privacy

### Problem: USB permission denied

- **All platforms:** Try running with elevated permissions (temporary test only)
- **Linux:** Ensure proper udev rules are set
- **Windows:** May need to reinstall device driver

## AI Integration Issues

### Problem: AI transcription fails

1. **Check API keys:**
   - Verify keys are correctly entered in Settings
   - Test with provider's playground/console

2. **Network issues:**
   - Check internet connectivity
   - Verify firewall/proxy settings

3. **Audio format issues:**
   - Convert HTA files to WAV first
   - Ensure audio is not corrupted

### Problem: Mock providers not working

- Mock providers require empty API keys
- Check `ai_service.py` for mock implementation details

### Problem: Specific provider errors

#### Google Gemini

- File size limit: 20MB
- Supported formats: WAV, MP3, FLAC, M4A

#### OpenAI Whisper

- File size limit: 25MB
- Requires API key with Whisper access

#### Local providers (Ollama/LM Studio)

- Ensure server is running
- Check port configuration
- Verify model is loaded

## Linux System Dependency Issues

### Problem: Setup script reports missing system dependencies (Linux)

You may see a block like:

```text
⚠️  Missing system dependencies: 3 issue(s) found
   • Python tkinter
   • FFmpeg
   • libusb development files (pc file)
```

#### Solution Path 1: Debian/Ubuntu Auto-Install

If you're on Debian/Ubuntu (apt available) you can let the script attempt installation:

```bash
python setup.py --auto-install-missing
# Or non-interactive:
HIDOCK_AUTO_INSTALL_MISSING=1 python setup.py --non-interactive
```

This will attempt:

- python3-tk / python3-dev
- ffmpeg / libavcodec-extra
- libusb-1.0-0-dev / libudev-dev / pkg-config
- build-essential

If user group 'dialout' is required you may need to log out/in after installation.

#### Solution Path 2: Use Bundled Automated Script

Choose option 1 in the prompt or run directly:

```bash
python3 scripts/setup/setup_linux_deps.py
```

#### Solution Path 3: Manual Installation Examples

Debian/Ubuntu:

```bash
sudo apt update
sudo apt install -y python3-tk python3-dev build-essential \
    ffmpeg libavcodec-extra portaudio19-dev \
    libusb-1.0-0-dev libudev-dev pkg-config
sudo usermod -a -G dialout $USER
```

Fedora / RHEL:

```bash
sudo dnf groupinstall -y "Development Tools"
sudo dnf install -y python3-tkinter ffmpeg libusbx-devel systemd-devel
sudo usermod -a -G dialout $USER
```

Arch / Manjaro:

```bash
sudo pacman -Syu --needed base-devel python tk ffmpeg libusb systemd
sudo usermod -a -G uucp $USER
```

openSUSE:

```bash
sudo zypper install -t pattern devel_basis
sudo zypper install -y python311-tk ffmpeg libusb-1_0-devel systemd-devel
```

Alpine:

```bash
sudo apk add --no-cache python3 py3-tkinter ffmpeg libusb-dev build-base linux-headers
```

Homebrew (generic multi-platform helper):

```bash
brew install python-tk ffmpeg libusb pkg-config
```

#### libusb not detected but headers present

If you installed libusb but the script still reports an issue, ensure `pkg-config` is installed. The script uses it for reliable detection. Example:

```bash
sudo apt install -y pkg-config
```

#### Can't check USB permissions

If the script prints:

```text
ℹ️  Could not check USB permissions - dialout group may be needed
```

Add your user to the appropriate group (dialout, plugdev, or uucp depending on distro) and re-login.

### Continuing Without Dependencies

You can choose option 3 (continue anyway) but Python dependency installation (e.g. packages compiling native extensions) may fail until system requirements are satisfied.

---

## Getting Help

If these solutions don't resolve your issue:

1. **Check existing issues:** [GitHub Issues](https://github.com/sgeraldes/hidock-next/issues)
2. **Enable debug logging:**

   ```python
   # In config_and_logger.py, set:
   logging.basicConfig(level=logging.DEBUG)
   ```

3. **Create detailed bug report with:**
   - Operating system and version
   - Python/Node.js versions
   - Complete error messages
   - Steps to reproduce
   - Debug logs

## Common Error Messages

### "No HiDock device found"

- Device not connected
- Driver not installed (Windows)
- USB permissions issue (Linux)

### "Failed to initialize audio system"

- pygame not properly installed
- Audio drivers issue
- No audio output device

### "AI provider not configured"

- Missing API key
- Invalid API key
- Provider not selected in settings

### "WebUSB not supported"

- Using HTTP instead of HTTPS
- Browser doesn't support WebUSB
- Experimental features not enabled
