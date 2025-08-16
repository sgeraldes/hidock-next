# Cross-Platform libusb Initialization Fix

## Issue Description

The original libusb initialization code in `gui_actions_device.py` only supported Windows paths, causing connection failures on macOS and Linux systems. Users reported problems specifically with macOS systems using Homebrew, where libusb is installed in different locations for Apple Silicon (`/opt/homebrew/lib/`) vs Intel Macs (`/usr/local/lib/`).

## Root Cause

The `_initialize_backend_early()` method was hardcoded to only look for Windows DLL files:
- `libusb-1.0.dll` in script directory
- `MS64/dll/libusb-1.0.dll` 
- `MS32/dll/libusb-1.0.dll`

It did not account for:
- Different library file extensions on different platforms (`.dylib` on macOS, `.so` on Linux)
- Platform-specific installation paths
- Architecture differences (Apple Silicon vs Intel on macOS)

## Solution

Implemented a comprehensive cross-platform libusb initialization system that:

### 1. Platform Detection
Uses `platform.system()` to detect the operating system and choose appropriate library paths.

### 2. Platform-Specific Path Lists

**macOS (Darwin):**
- `/opt/homebrew/lib/libusb-1.0.dylib` - Apple Silicon Homebrew
- `/usr/local/lib/libusb-1.0.dylib` - Intel Mac Homebrew  
- `/opt/local/lib/libusb-1.0.dylib` - MacPorts
- `/usr/lib/libusb-1.0.dylib` - System location

**Linux:**
- `/usr/lib/x86_64-linux-gnu/libusb-1.0.so` - Ubuntu/Debian x64
- `/usr/lib/aarch64-linux-gnu/libusb-1.0.so` - Ubuntu/Debian ARM64
- `/usr/lib64/libusb-1.0.so` - RHEL/CentOS/Fedora x64
- `/usr/lib/libusb-1.0.so` - Generic location
- `/usr/local/lib/libusb-1.0.so` - Compiled from source

**Windows:**
- Original paths plus additional fallback locations
- `lib/libusb-1.0.dll` - Additional local path

### 3. Graceful Fallback
If no platform-specific paths are found, falls back to system path detection using `usb.backend.libusb1.get_backend()` without explicit library paths.

### 4. Enhanced Error Reporting
Provides platform-specific error messages to help users understand what went wrong and how to fix it.

## Code Changes

### Modified Files
- `gui_actions_device.py` - Updated `_initialize_backend_early()` method

### New Files
- `tests/test_libusb_cross_platform.py` - Comprehensive test suite

## Testing

Created extensive test coverage including:
- macOS Apple Silicon path detection
- macOS Intel path detection  
- Linux Ubuntu/Debian path detection
- Windows local DLL detection
- Fallback to system paths
- Complete failure scenarios
- Exception handling
- Unknown operating system handling
- Path coverage verification

All tests pass, ensuring the fix works correctly across platforms.

## Installation Instructions

### macOS Users
The fix automatically detects Homebrew installations. If you don't have libusb installed:

**Apple Silicon Macs:**
```bash
brew install libusb
```

**Intel Macs:**
```bash
brew install libusb
```

**MacPorts (alternative):**
```bash
sudo port install libusb
```

### Linux Users
The fix supports multiple Linux distributions:

**Ubuntu/Debian:**
```bash
sudo apt update && sudo apt install libusb-1.0-0-dev
```

**RHEL/CentOS/Fedora:**
```bash
sudo yum install libusb1-devel  # RHEL/CentOS
sudo dnf install libusb1-devel  # Fedora
```

### Windows Users
No changes needed - existing functionality is preserved and enhanced.

## Benefits

1. **Universal Compatibility** - Works across macOS (both architectures), Linux distributions, and Windows
2. **Automatic Detection** - No manual configuration required
3. **Robust Fallback** - Multiple fallback mechanisms ensure maximum compatibility
4. **Better Error Messages** - Platform-specific error reporting helps users troubleshoot
5. **Future-Proof** - Easily extensible for new platforms or path locations

## Backward Compatibility

The fix is fully backward compatible:
- All existing Windows functionality is preserved
- No breaking changes to the API
- Existing configurations continue to work

## User Impact

Users on macOS and Linux systems should now be able to connect to HiDock devices without manual libusb configuration, resolving the connection issues reported in the bug report.