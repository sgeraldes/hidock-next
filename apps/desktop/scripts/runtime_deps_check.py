#!/usr/bin/env python3
"""
HiDock Desktop - Runtime Dependencies Check
Detects missing dependencies when the application starts and offers solutions.
"""

import os
import platform
import subprocess
import sys
from pathlib import Path


def run_command(command, check=False):
    """Run a command and return the result."""
    try:
        result = subprocess.run(
            command, 
            shell=True, 
            check=check, 
            capture_output=True, 
            text=True
        )
        return result
    except subprocess.CalledProcessError as e:
        return e


def check_ffmpeg():
    """Check if FFmpeg is available."""
    try:
        result = run_command("which ffmpeg", check=False)
        if result.returncode == 0:
            return True, result.stdout.strip()
        else:
            return False, None
    except Exception:
        return False, None


def check_system_dependencies():
    """Check critical system dependencies."""
    missing_deps = []
    
    # Check FFmpeg
    ffmpeg_available, ffmpeg_path = check_ffmpeg()
    if not ffmpeg_available:
        missing_deps.append("ffmpeg")
    
    return missing_deps, ffmpeg_available


def suggest_ffmpeg_install_without_sudo():
    """Suggest FFmpeg installation methods that don't require sudo."""
    print("\n🔧 FFmpeg Installation Options (No Admin Rights Required):")
    print()
    print("1. 📦 Using Snap (if available):")
    print("   snap install ffmpeg")
    print()
    print("2. 🏠 Using Flatpak (if available):")
    print("   flatpak install flathub org.ffmpeg.FFmpeg")
    print()
    print("3. 📥 Download Static Binary (Manual):")
    print("   • Visit: https://johnvansickle.com/ffmpeg/")
    print("   • Download the static build for Linux")
    print("   • Extract to ~/bin/ or add to PATH")
    print()
    print("4. 🐍 Using Conda/Mamba (if you have it):")
    print("   conda install -c conda-forge ffmpeg")
    print()
    print("5. 🔧 Ask system admin to install:")
    print("   sudo apt install ffmpeg")
    print()


def check_snap_available():
    """Check if snap is available."""
    try:
        result = run_command("which snap", check=False)
        return result.returncode == 0
    except Exception:
        return False


def check_flatpak_available():
    """Check if flatpak is available."""
    try:
        result = run_command("which flatpak", check=False)
        return result.returncode == 0
    except Exception:
        return False


def try_install_ffmpeg_without_sudo():
    """Try to install FFmpeg without sudo privileges."""
    print("\n🚀 Attempting to install FFmpeg without admin rights...")
    
    # Try snap first
    if check_snap_available():
        print("\n📦 Trying snap installation...")
        result = run_command("snap install ffmpeg", check=False)
        if result.returncode == 0:
            print("✅ FFmpeg installed successfully via snap!")
            return True
        else:
            print("❌ Snap installation failed (may require admin rights)")
    
    # Try flatpak
    if check_flatpak_available():
        print("\n🏠 Trying Flatpak installation...")
        result = run_command("flatpak install --user -y flathub org.ffmpeg.FFmpeg", check=False)
        if result.returncode == 0:
            print("✅ FFmpeg installed successfully via Flatpak!")
            # Add flatpak binaries to PATH for this session
            os.environ["PATH"] = f"{os.environ['PATH']}:{os.path.expanduser('~/.local/share/flatpak/exports/bin')}"
            return True
        else:
            print("❌ Flatpak installation failed")
    
    print("\n⚠️  Automatic installation not possible without admin rights.")
    return False


def handle_missing_dependencies(missing_deps):
    """Handle missing dependencies interactively."""
    if not missing_deps:
        return True
    
    print("\n⚠️  Missing Dependencies Detected")
    print("=" * 40)
    print("The following required dependencies are missing:")
    for dep in missing_deps:
        print(f"   • {dep}")
    
    if "ffmpeg" in missing_deps:
        print("\n🎵 FFmpeg is required for:")
        print("   • Audio format conversion")
        print("   • Audio processing features") 
        print("   • Importing various audio formats")
        
        print("\n📝 What would you like to do?")
        print("1. 🚀 Try automatic installation (no admin rights)")
        print("2. 📋 Show manual installation options")
        print("3. ⏭️  Continue anyway (limited functionality)")
        print("4. ❌ Exit application")
        
        while True:
            try:
                choice = input("\nChoose an option (1-4): ").strip()
                if choice in ["1", "2", "3", "4"]:
                    break
                print("Please enter 1, 2, 3, or 4")
            except KeyboardInterrupt:
                print("\nExiting...")
                return False
        
        if choice == "1":
            success = try_install_ffmpeg_without_sudo()
            if success:
                # Re-check FFmpeg
                ffmpeg_available, _ = check_ffmpeg()
                if ffmpeg_available:
                    print("✅ FFmpeg is now available!")
                    return True
                else:
                    print("⚠️  FFmpeg installation may need a shell restart")
                    print("   Please restart the application or your terminal")
                    return False
            else:
                suggest_ffmpeg_install_without_sudo()
                return False
        
        elif choice == "2":
            suggest_ffmpeg_install_without_sudo()
            return False
        
        elif choice == "3":
            print("\n⚠️  Continuing with limited functionality...")
            print("   Audio conversion features will be disabled")
            return True
        
        elif choice == "4":
            print("Exiting application...")
            return False
    
    return True


def check_and_handle_runtime_deps():
    """Main function to check and handle runtime dependencies."""
    if platform.system() != "Linux":
        return True  # Only handle Linux for now
    
    missing_deps, ffmpeg_available = check_system_dependencies()
    
    if missing_deps:
        return handle_missing_dependencies(missing_deps)
    else:
        return True


if __name__ == "__main__":
    # Run as standalone script
    success = check_and_handle_runtime_deps()
    if not success:
        sys.exit(1)
    else:
        print("✅ All runtime dependencies are available!")
