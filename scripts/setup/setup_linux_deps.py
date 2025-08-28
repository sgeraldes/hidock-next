#!/usr/bin/env python3
"""
HiDock Next - Linux System Dependencies Setup
Handles installation of system-level packages required for the HiDock Desktop Application.
"""

import os
import platform
import subprocess
import sys
from pathlib import Path


def run_command(command, check=True, capture_output=True):
    """Run a command and return the result."""
    print(f"Running: {command}")
    try:
        result = subprocess.run(
            command, 
            shell=True, 
            check=check, 
            capture_output=capture_output, 
            text=True
        )
        if result.stdout and capture_output:
            print(result.stdout)
        return result
    except subprocess.CalledProcessError as e:
        print(f"Error running command: {e}")
        if e.stderr and capture_output:
            print(f"Error output: {e.stderr}")
        if check:
            return e
        return e


def check_linux_distribution():
    """Check if we're on a supported Linux distribution."""
    if platform.system() != "Linux":
        print("❌ This script is only for Linux systems")
        return False
    
    # Check for Debian-based distribution
    debian_based = False
    try:
        # Check for apt package manager
        result = run_command("which apt", check=False)
        if result.returncode == 0:
            debian_based = True
        
        # Check /etc/os-release for additional info
        if Path("/etc/os-release").exists():
            with open("/etc/os-release", "r") as f:
                content = f.read()
                if any(distro in content.lower() for distro in ["ubuntu", "debian", "mint", "elementary", "pop", "zorin"]):
                    debian_based = True
                    
    except Exception as e:
        print(f"⚠️  Could not detect distribution: {e}")
    
    if debian_based:
        print("✓ Detected Debian-based Linux distribution")
        return True
    else:
        print("⚠️  This script is optimized for Debian-based distributions (Ubuntu, Debian, Mint, etc.)")
        print("   System dependencies may need to be installed manually on other distributions")
        return False


def check_package_manager():
    """Check which package manager is available and prefer nala over apt."""
    # Check for nala first (faster, better output)
    try:
        result = run_command("which nala", check=False)
        if result.returncode == 0:
            print("✓ Found nala package manager (preferred)")
            return "nala"
    except Exception:
        pass
    
    # Fall back to apt
    try:
        result = run_command("which apt", check=False)
        if result.returncode == 0:
            print("✓ Found apt package manager")
            return "apt"
    except Exception:
        pass
    
    print("❌ No supported package manager found (apt/nala)")
    return None


def check_sudo_access():
    """Check if user has sudo access."""
    try:
        result = run_command("sudo -n true", check=False, capture_output=False)
        if result.returncode == 0:
            print("✓ Sudo access available")
            return True
        else:
            print("⚠️  Sudo access required for system package installation")
            print("   You may be prompted for your password")
            return True  # We'll let sudo prompt for password
    except Exception:
        print("❌ Cannot check sudo access")
        return False


def update_package_lists(pkg_manager):
    """Update package lists."""
    print("\n📦 Updating package lists...")
    
    try:
        if pkg_manager == "nala":
            result = run_command("sudo nala update", capture_output=False)
        else:
            result = run_command("sudo apt update", capture_output=False)
        
        if result.returncode == 0:
            print("✓ Package lists updated successfully")
            return True
        else:
            print("⚠️  Package list update failed, continuing anyway...")
            return False
    except Exception as e:
        print(f"⚠️  Could not update package lists: {e}")
        return False


def install_python_tkinter(pkg_manager):
    """Install Python tkinter system package."""
    print("\n🐍 Installing Python tkinter...")
    
    # Python tkinter is typically provided by python3-tk
    packages = ["python3-tk", "python3-dev"]
    
    try:
        if pkg_manager == "nala":
            cmd = f"sudo nala install -y {' '.join(packages)}"
        else:
            cmd = f"sudo apt install -y {' '.join(packages)}"
        
        result = run_command(cmd, capture_output=False)
        
        if result.returncode == 0:
            print("✓ Python tkinter installed successfully")
            return True
        else:
            print("❌ Failed to install Python tkinter")
            return False
    except Exception as e:
        print(f"❌ Error installing Python tkinter: {e}")
        return False


def install_audio_dependencies(pkg_manager):
    """Install audio-related system dependencies."""
    print("\n🎵 Installing audio dependencies...")
    
    # FFmpeg and audio libraries
    packages = [
        "ffmpeg",           # Audio/video processing
        "libavcodec-extra", # Extra codecs
        "libavformat-dev",  # Audio format support
        "libavcodec-dev",   # Audio codec development files
        "libavutil-dev",    # Audio utilities
        "libswresample-dev", # Audio resampling
        "portaudio19-dev",  # PortAudio for pygame/audio
        "libasound2-dev",   # ALSA development files
        "libpulse-dev",     # PulseAudio development files
        "libjack-jackd2-dev", # JACK audio development files (optional)
    ]
    
    try:
        if pkg_manager == "nala":
            cmd = f"sudo nala install -y {' '.join(packages)}"
        else:
            cmd = f"sudo apt install -y {' '.join(packages)}"
        
        result = run_command(cmd, capture_output=False)
        
        if result.returncode == 0:
            print("✓ Audio dependencies installed successfully")
            return True
        else:
            print("❌ Failed to install some audio dependencies")
            print("   The application might still work with basic audio functionality")
            return False
    except Exception as e:
        print(f"❌ Error installing audio dependencies: {e}")
        return False


def install_usb_dependencies(pkg_manager):
    """Install USB communication dependencies."""
    print("\n🔌 Installing USB dependencies...")
    
    # USB libraries for device communication
    packages = [
        "libusb-1.0-0-dev",  # USB development library
        "libudev-dev",       # Device management
        "pkg-config",        # Package configuration
    ]
    
    try:
        if pkg_manager == "nala":
            cmd = f"sudo nala install -y {' '.join(packages)}"
        else:
            cmd = f"sudo apt install -y {' '.join(packages)}"
        
        result = run_command(cmd, capture_output=False)
        
        if result.returncode == 0:
            print("✓ USB dependencies installed successfully")
            return True
        else:
            print("❌ Failed to install USB dependencies")
            return False
    except Exception as e:
        print(f"❌ Error installing USB dependencies: {e}")
        return False


def install_gui_dependencies(pkg_manager):
    """Install GUI-related dependencies."""
    print("\n🖥️  Installing GUI dependencies...")
    
    # GUI and display libraries
    packages = [
        "python3-tk",        # tkinter (if not already installed)
        "libxcb1-dev",       # X11 protocol library
        "libxcb-render0-dev", # X11 rendering
        "libxcb-shape0-dev", # X11 shape extension
        "libxcb-xfixes0-dev", # X11 fixes extension
        "libcairo2-dev",     # Cairo graphics library
        "libgirepository1.0-dev", # GObject introspection
        "gir1.2-gtk-3.0",    # GTK3 introspection data
    ]
    
    try:
        if pkg_manager == "nala":
            cmd = f"sudo nala install -y {' '.join(packages)}"
        else:
            cmd = f"sudo apt install -y {' '.join(packages)}"
        
        result = run_command(cmd, capture_output=False)
        
        if result.returncode == 0:
            print("✓ GUI dependencies installed successfully")
            return True
        else:
            print("⚠️  Some GUI dependencies failed to install")
            print("   Basic GUI functionality should still work")
            return False
    except Exception as e:
        print(f"⚠️  Error installing GUI dependencies: {e}")
        return False


def install_build_dependencies(pkg_manager):
    """Install build tools needed for Python package compilation."""
    print("\n🔨 Installing build dependencies...")
    
    # Build tools for compiling Python packages
    packages = [
        "build-essential",   # GCC and basic build tools
        "python3-dev",       # Python development headers
        "python3-venv",      # Python virtual environment
        "python3-pip",       # Python package installer
        "git",              # Version control (if not installed)
        "curl",             # For downloading
        "wget",             # Alternative downloader
        "cmake",            # Build system (needed by some packages)
        "ninja-build",      # Fast build system
    ]
    
    try:
        if pkg_manager == "nala":
            cmd = f"sudo nala install -y {' '.join(packages)}"
        else:
            cmd = f"sudo apt install -y {' '.join(packages)}"
        
        result = run_command(cmd, capture_output=False)
        
        if result.returncode == 0:
            print("✓ Build dependencies installed successfully")
            return True
        else:
            print("⚠️  Some build dependencies failed to install")
            return False
    except Exception as e:
        print(f"⚠️  Error installing build dependencies: {e}")
        return False


def create_hidock_udev_rule():
    """Create HiDock udev rule content."""
    rule_content = '''# HiDock USB Device udev rules
# This rule allows non-root users to access HiDock devices
# Place this file in /etc/udev/rules.d/ and reload rules

# HiDock H1E device - VID: 10d6, PID: b00d
# Allow access for users in dialout group
SUBSYSTEM=="usb", ATTR{idVendor}=="10d6", ATTR{idProduct}=="b00d", GROUP="dialout", MODE="0664", TAG+="uaccess"

# HiDock H1E device - USB interface access
# Ensure the device interface is accessible
SUBSYSTEM=="usb", ATTR{idVendor}=="10d6", ATTR{idProduct}=="b00d", GROUP="dialout", MODE="0664"

# Additional rule for device node access (if needed)
KERNEL=="hidraw*", ATTRS{idVendor}=="10d6", ATTRS{idProduct}=="b00d", GROUP="dialout", MODE="0664", TAG+="uaccess"

# Symlink rule for easier device identification
SUBSYSTEM=="usb", ATTR{idVendor}=="10d6", ATTR{idProduct}=="b00d", SYMLINK+="hidock_%n", GROUP="dialout", MODE="0664"

# Auto-suspend disable for HiDock devices to prevent connection issues
ACTION=="add", SUBSYSTEM=="usb", ATTR{idVendor}=="10d6", ATTR{idProduct}=="b00d", ATTR{power/autosuspend}="-1"
'''
    return rule_content


def setup_usb_permissions():
    """Set up USB permissions for HiDock device access."""
    print("\n🔐 Setting up USB permissions...")
    
    try:
        import getpass
        import grp
        
        username = getpass.getuser()
        
        # Check if user is in dialout group
        try:
            user_groups = [g.gr_name for g in grp.getgrall() if username in g.gr_mem]
            
            if "dialout" not in user_groups:
                print(f"Adding user '{username}' to 'dialout' group for USB access...")
                result = run_command(f"sudo usermod -a -G dialout {username}", capture_output=False)
                
                if result.returncode == 0:
                    print("✓ User added to dialout group")
                    print("⚠️  You need to log out and back in for this change to take effect")
                    print("   Or run: newgrp dialout")
                else:
                    print("❌ Failed to add user to dialout group")
                    return False
            else:
                print("✓ User already in dialout group")
                
        except Exception as e:
            print(f"⚠️  Could not check/modify user groups: {e}")
            print("   You may need to manually add yourself to the dialout group:")
            print(f"   sudo usermod -a -G dialout {username}")
            return False
        
        # Create and install HiDock udev rule
        print("Creating HiDock udev rule for device access...")
        
        # Look for existing udev rule file in project directory
        # Navigate to project root first (two levels up from scripts/setup)
        import os
        script_dir = Path(__file__).parent
        project_root = script_dir.parent.parent
        os.chdir(project_root)
        
        udev_rule_path = None
        possible_paths = [
            Path("99-hidock.rules"),
            Path("scripts/linux-monitoring/99-hidock.rules"),
            Path("hidock-desktop-app/99-hidock.rules")
        ]
        
        for path in possible_paths:
            if path.exists():
                udev_rule_path = path
                print(f"Found existing udev rule at: {path}")
                break
        
        if not udev_rule_path:
            # Create udev rule file
            print("Creating new udev rule file...")
            udev_rule_path = Path("99-hidock.rules")
            rule_content = create_hidock_udev_rule()
            
            try:
                with open(udev_rule_path, "w") as f:
                    f.write(rule_content)
                print(f"✓ Created udev rule file: {udev_rule_path}")
            except Exception as e:
                print(f"❌ Failed to create udev rule file: {e}")
                return False
        
        # Install the udev rule
        print("Installing HiDock udev rule to system...")
        result = run_command(f"sudo cp {udev_rule_path} /etc/udev/rules.d/", capture_output=False)
        if result.returncode == 0:
            print("✓ HiDock udev rule installed")
            
            # Reload udev rules
            print("Reloading udev rules...")
            result = run_command("sudo udevadm control --reload-rules", capture_output=False)
            if result.returncode == 0:
                result = run_command("sudo udevadm trigger", capture_output=False)
                if result.returncode == 0:
                    print("✓ Udev rules reloaded successfully")
                    return True
                else:
                    print("⚠️  Failed to trigger udev rules")
                    print("   You may need to replug your HiDock device")
                    return True  # Still consider success
            else:
                print("⚠️  Failed to reload udev rules")
                print("   You may need to reboot or replug your HiDock device")
                return True  # Still consider success
                
        else:
            print("⚠️  Failed to install udev rule")
            print("   You can install it manually with:")
            print(f"   sudo cp {udev_rule_path} /etc/udev/rules.d/")
            print("   sudo udevadm control --reload-rules")
            print("   sudo udevadm trigger")
            return False
        
    except Exception as e:
        print(f"⚠️  Could not set up USB permissions: {e}")
        return False


def install_optional_dependencies(pkg_manager):
    """Install optional but recommended dependencies."""
    print("\n🔧 Installing optional dependencies...")
    
    packages = [
        "v4l-utils",         # Video4Linux utilities
        "mediainfo",         # Media file analysis
        "sox",              # Sound processing
        "libsox-fmt-all",   # SoX format support
        "alsa-utils",       # ALSA utilities
        "pulseaudio-utils", # PulseAudio utilities
        "pavucontrol",      # PulseAudio volume control
    ]
    
    try:
        if pkg_manager == "nala":
            cmd = f"sudo nala install -y {' '.join(packages)}"
        else:
            cmd = f"sudo apt install -y {' '.join(packages)}"
        
        result = run_command(cmd, capture_output=False)
        
        if result.returncode == 0:
            print("✓ Optional dependencies installed successfully")
            return True
        else:
            print("⚠️  Some optional dependencies failed to install")
            print("   This won't affect core functionality")
            return False
    except Exception as e:
        print(f"⚠️  Error installing optional dependencies: {e}")
        return False


def verify_installation():
    """Verify that key dependencies are properly installed."""
    print("\n🔍 Verifying installation...")
    
    checks = []
    
    # Check Python tkinter
    try:
        result = run_command("python3 -c 'import tkinter; print(\"tkinter OK\")'", check=False)
        if result.returncode == 0:
            print("✓ Python tkinter working")
            checks.append(True)
        else:
            print("❌ Python tkinter not working")
            checks.append(False)
    except Exception:
        print("❌ Could not test Python tkinter")
        checks.append(False)
    
    # Check ffmpeg
    try:
        result = run_command("ffmpeg -version", check=False, capture_output=False)
        if result.returncode == 0:
            print("✓ FFmpeg installed")
            checks.append(True)
        else:
            print("❌ FFmpeg not found")
            checks.append(False)
    except Exception:
        print("❌ Could not test FFmpeg")
        checks.append(False)
    
    # Check USB library
    try:
        result = run_command("pkg-config --exists libusb-1.0", check=False)
        if result.returncode == 0:
            print("✓ libusb-1.0 found")
            checks.append(True)
        else:
            print("❌ libusb-1.0 not found")
            checks.append(False)
    except Exception:
        print("❌ Could not test libusb")
        checks.append(False)
    
    # Check build tools
    try:
        result = run_command("gcc --version", check=False, capture_output=False)
        if result.returncode == 0:
            print("✓ GCC compiler available")
            checks.append(True)
        else:
            print("❌ GCC compiler not found")
            checks.append(False)
    except Exception:
        print("❌ Could not test GCC")
        checks.append(False)
    
    success_rate = sum(checks) / len(checks) * 100
    print(f"\n📊 Installation verification: {success_rate:.0f}% successful")
    
    if success_rate >= 75:
        print("✅ System dependencies setup completed successfully!")
        return True
    else:
        print("⚠️  Some dependencies may not be properly installed")
        print("   The application might still work, but you may encounter issues")
        return False


def show_post_install_instructions(pkg_manager):
    """Show instructions for after system dependencies are installed."""
    print("\n" + "="*60)
    print("🎉 Linux System Dependencies Setup Complete!")
    print("="*60)
    
    print("\n📋 What was installed:")
    print("• Python tkinter and development headers")
    print("• FFmpeg and audio processing libraries") 
    print("• USB communication libraries (libusb)")
    print("• GUI and display libraries")
    print("• Build tools and compilers")
    print("• Audio system integration (ALSA, PulseAudio)")
    print("• Optional multimedia tools")
    
    print("\n⚠️  Important Notes:")
    print("• If you were added to the dialout group, you need to:")
    print("  - Log out completely and log back in")
    print("  - Or run: newgrp dialout")
    print("  - This is required for USB device access")
    
    print("\n🚀 Next Steps:")
    print("1. Run the main setup script:")
    print("   python3 setup.py")
    print("")
    print("2. Or manually set up the Python environment:")
    print("   # From project root directory:")
    print("   cd hidock-desktop-app")
    print("   python3 -m venv .venv")
    print("   source .venv/bin/activate")
    print('   pip install -e ".[dev]"')
    print("")
    print("3. Test the application:")
    print("   # From project root directory:")
    print("   cd hidock-desktop-app")
    print("   source .venv/bin/activate")
    print("   python3 main.py")
    
    print("\n🔧 Troubleshooting:")
    print("• If CustomTkinter has issues: pip install --upgrade customtkinter")
    print("• If audio doesn't work: check PulseAudio/ALSA configuration")
    print("• If USB device not detected: verify dialout group membership")
    print("• For more help: check docs/TROUBLESHOOTING.md")
    
    print(f"\n💡 Package manager used: {pkg_manager}")
    if pkg_manager == "apt":
        print("   Consider installing 'nala' for better package management:")
        print("   sudo apt install nala")


def main():
    """Main function to set up Linux system dependencies."""
    print("HiDock Next - Linux System Dependencies Setup")
    print("=" * 50)
    print()
    
    # Check if we're on a supported system
    if not check_linux_distribution():
        print("\n❌ This script requires a Debian-based Linux distribution")
        print("   For other distributions, install these packages manually:")
        print("   • Python tkinter/tk development packages")
        print("   • FFmpeg and audio libraries") 
        print("   • libusb development packages")
        print("   • Build tools (gcc, cmake, etc.)")
        sys.exit(1)
    
    # Check for package manager
    pkg_manager = check_package_manager()
    if not pkg_manager:
        print("\n❌ No supported package manager found")
        print("   This script requires apt or nala")
        sys.exit(1)
    
    # Check sudo access
    if not check_sudo_access():
        print("\n❌ Sudo access is required to install system packages")
        sys.exit(1)
    
    try:
        print(f"\n🚀 Starting system dependencies installation using {pkg_manager}...")
        
        # Update package lists
        update_package_lists(pkg_manager)
        
        # Install core dependencies
        success = True
        success &= install_build_dependencies(pkg_manager)
        success &= install_python_tkinter(pkg_manager)
        success &= install_audio_dependencies(pkg_manager)
        success &= install_usb_dependencies(pkg_manager)
        success &= install_gui_dependencies(pkg_manager)
        
        # Set up permissions
        setup_usb_permissions()
        
        # Install optional dependencies (don't fail if these don't work)
        install_optional_dependencies(pkg_manager)
        
        # Verify installation
        verification_success = verify_installation()
        
        if success and verification_success:
            show_post_install_instructions(pkg_manager)
            print("\n✅ All system dependencies installed successfully!")
            sys.exit(0)
        else:
            print("\n⚠️  Some dependencies may have failed to install")
            print("   You can still try to run the main setup script")
            print("   Check the error messages above for details")
            show_post_install_instructions(pkg_manager)
            sys.exit(0)
    
    except KeyboardInterrupt:
        print("\n\n⚠️  Installation interrupted by user!")
        print("You can run this script again to continue.")
        sys.exit(1)
    
    except Exception as e:
        print(f"\n❌ Unexpected error: {e}")
        print("Please report this issue with the full error message.")
        sys.exit(1)


if __name__ == "__main__":
    main()
