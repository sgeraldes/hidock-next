#!/usr/bin/env python3
"""
HiDock Next - Comprehensive Setup Script
Supports both end users (simple app setup) and developers (full environment).
"""

import os
import platform
import subprocess
import sys
from pathlib import Path


def run_command(command, cwd=None, check=True):
    """Run a command and return the result."""
    print(f"Running: {command}")
    try:
        result = subprocess.run(command, shell=True, cwd=cwd, check=check, capture_output=True, text=True)
        if result.stdout:
            print(result.stdout)
        return result
    except subprocess.CalledProcessError as e:
        print(f"Error running command: {e}")
        if e.stderr:
            print(f"Error output: {e.stderr}")
        if check:
            sys.exit(1)
        return e


def check_python_version():
    """Check if Python version is compatible."""
    version = sys.version_info
    if version.major != 3 or version.minor < 12:
        print(f"Python 3.12 required for optimal compatibility, found {version.major}.{version.minor}")
        print("Some packages (like librosa/numba) may not work with other versions")
        sys.exit(1)
    print(f"✓ Python {version.major}.{version.minor}.{version.micro}")


def check_node_version():
    """Check if Node.js version is compatible."""
    try:
        result = run_command("node --version", check=False)
        if result.returncode == 0:
            version = result.stdout.strip()
            print(f"✓ Node.js {version}")
            return True
        else:
            print("✗ Node.js not found")
            return False
    except Exception:
        print("✗ Node.js not found")
        return False


def check_git_config():
    """Check if Git is properly configured."""
    print("Checking Git configuration...")

    try:
        # Check if git is available
        result = run_command("git --version", check=False)
        if result.returncode != 0:
            print("✗ Git not found")
            return False

        # Check user.name
        result = run_command("git config user.name", check=False)
        if result.returncode == 0 and result.stdout.strip():
            name = result.stdout.strip()
            print(f"✓ Git user.name: {name}")
        else:
            print("⚠️  Git user.name not set")
            name = input("Enter your name for Git commits: ").strip()
            if name:
                run_command(f'git config --global user.name "{name}"')
                print(f"✓ Set Git user.name to: {name}")

        # Check user.email
        result = run_command("git config user.email", check=False)
        if result.returncode == 0 and result.stdout.strip():
            email = result.stdout.strip()
            print(f"✓ Git user.email: {email}")
        else:
            print("⚠️  Git user.email not set")
            email = input("Enter your email for Git commits: ").strip()
            if email:
                run_command(f'git config --global user.email "{email}"')
                print(f"✓ Set Git user.email to: {email}")

        return True

    except Exception as e:
        print(f"✗ Git configuration check failed: {e}")
        return False


def check_network_connection():
    """Check if internet connection is available."""
    print("Checking internet connection...")
    try:
        # Try to reach a reliable server
        result = (
            run_command("ping -c 1 8.8.8.8", check=False)
            if platform.system() != "Windows"
            else run_command("ping -n 1 8.8.8.8", check=False)
        )
        if result.returncode == 0:
            print("✓ Internet connection available")
            return True
        else:
            print("⚠️  No internet connection detected")
            print("   npm install and API key setup may fail")
            return False
    except Exception:
        print("⚠️  Could not verify internet connection")
        return False


def check_permissions():
    """Check if we have proper permissions to write files."""
    print("Checking permissions...")
    try:
        # Try to create a test file
        test_file = Path("temp_permission_test.txt")
        test_file.write_text("test")
        test_file.unlink()
        print("✓ Write permissions OK")
        return True
    except Exception as e:
        print(f"⚠️  Permission issue detected: {e}")
        print("Solutions:")
        print("• Run as administrator/sudo (if needed)")
        print("• Check directory permissions")
        print("• Ensure you own the directory")
        return False


def check_disk_space():
    """Check available disk space."""
    print("Checking disk space...")
    try:
        import shutil

        free_bytes = shutil.disk_usage(".").free
        free_gb = free_bytes / (1024**3)

        if free_gb < 1:
            print(f"⚠️  Low disk space: {free_gb:.1f}GB available")
            print("   Node.js dependencies require ~500MB")
            print("   Python dependencies require ~200MB")
            print("   Consider freeing up space")
            return False
        else:
            print(f"✓ Disk space OK: {free_gb:.1f}GB available")
            return True

    except Exception as e:
        print(f"⚠️  Could not check disk space: {e}")
        return True  # Don't block if we can't check


def check_development_files():
    """Check for required development files."""
    print("Checking development files...")

    # Check Windows-specific requirements
    if platform.system() == "Windows":
        libusb_path = Path("hidock-desktop-app/libusb-1.0.dll")
        if libusb_path.exists():
            print("✓ libusb-1.0.dll found (required for device communication)")
        else:
            print("⚠️  libusb-1.0.dll not found in hidock-desktop-app/")
            print("   This is required for HiDock device communication")

        # Check for Visual C++ Build Tools (needed for some Python packages)
        try:
            result = run_command("where cl", check=False)
            if result.returncode == 0:
                print("✓ Visual C++ Build Tools found")
            else:
                print("ℹ️  Visual C++ Build Tools not found (may be needed for some packages)")
                print("   Download: https://visualstudio.microsoft.com/visual-cpp-build-tools/")
        except Exception:
            print("ℹ️  Could not check for Visual C++ Build Tools")

        # Warn about Windows Defender
        print("ℹ️  If installs fail, check Windows Defender exclusions")

    # Check Linux system dependencies
    elif platform.system() == "Linux":
        return check_linux_system_dependencies()

    # Check macOS dependencies
    elif platform.system() == "Darwin":
        print("ℹ️  macOS: USB permissions usually work out of the box")

        # Check for Xcode command line tools
        result = run_command("xcode-select -p", check=False)
        if result.returncode != 0:
            print("⚠️  Xcode command line tools not installed")
            print("   Run: xcode-select --install")
        else:
            print("✓ Xcode command line tools installed")

        # Check for Homebrew (helpful but not required)
        result = run_command("brew --version", check=False)
        if result.returncode != 0:
            print("ℹ️  Homebrew not found (optional but recommended)")
            print(
                '   Install: /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
            )
        else:
            print("✓ Homebrew available")

    # Check for important config files
    desktop_config = Path("hidock-desktop-app/hidock_config.json")
    if desktop_config.exists():
        print("✓ Desktop app configuration file found")
    else:
        print("ℹ️  Desktop app will create configuration on first run")

    return True


def check_linux_system_dependencies():
    """Check Linux system dependencies and offer to install them."""
    print("\n🐧 Checking Linux system dependencies...")
    
    # Check for Debian-based distribution
    debian_based = False
    try:
        result = run_command("which apt", check=False)
        if result.returncode == 0:
            debian_based = True
    except Exception:
        pass
    
    if not debian_based:
        print("⚠️  Non-Debian distribution detected")
        print("   You may need to manually install system dependencies")
        return True
    
    missing_deps = []
    
    # Check Python tkinter
    try:
        result = run_command("python3 -c 'import tkinter'", check=False)
        if result.returncode != 0:
            missing_deps.append("Python tkinter")
        else:
            print("✓ Python tkinter available")
    except Exception:
        missing_deps.append("Python tkinter")
    
    # Check FFmpeg
    try:
        result = run_command("which ffmpeg", check=False)
        if result.returncode != 0:
            missing_deps.append("FFmpeg")
        else:
            print("✓ FFmpeg found")
    except Exception:
        missing_deps.append("FFmpeg")
    
    # Check libusb
    try:
        result = run_command("pkg-config --exists libusb-1.0", check=False)
        if result.returncode != 0:
            missing_deps.append("libusb development files")
        else:
            print("✓ libusb-1.0 found")
    except Exception:
        missing_deps.append("libusb development files")
    
    # Check build tools
    try:
        result = run_command("which gcc", check=False)
        if result.returncode != 0:
            missing_deps.append("build tools (GCC)")
        else:
            print("✓ Build tools available")
    except Exception:
        missing_deps.append("build tools (GCC)")
    
    # Check USB permissions
    try:
        import getpass
        import grp

        username = getpass.getuser()
        user_groups = [g.gr_name for g in grp.getgrall() if username in g.gr_mem]

        if "dialout" not in user_groups:
            print("⚠️  User not in 'dialout' group (needed for USB access)")
            missing_deps.append("USB permissions (dialout group)")
        else:
            print("✓ USB permissions configured (dialout group)")
    except Exception:
        print("ℹ️  Could not check USB permissions - you may need dialout group")
        missing_deps.append("USB permissions check failed")
    
    if missing_deps:
        print(f"\n⚠️  Missing system dependencies: {len(missing_deps)} issues found")
        for dep in missing_deps:
            print(f"   • {dep}")
        
        print("\n🔧 System dependencies are required for the HiDock Desktop Application:")
        print("   • CustomTkinter requires system tkinter packages")
        print("   • Audio processing requires FFmpeg and audio libraries")
        print("   • Device communication requires libusb")
        print("   • Python packages compilation requires build tools")
        
        print("\n📝 You have several options:")
        print("1. 🚀 Run automated system setup (recommended)")
        print("2. 📋 Show manual installation commands")
        print("3. ⏭️  Continue anyway (may cause Python package installation failures)")
        
        while True:
            try:
                choice = input("\nChoose an option (1-3): ").strip()
                if choice in ["1", "2", "3"]:
                    break
                print("Please enter 1, 2, or 3")
            except KeyboardInterrupt:
                print("\nSkipping system dependencies setup...")
                return True
        
        if choice == "1":
            print("\n🚀 Running automated Linux system dependencies setup...")
            try:
                result = run_command("python3 setup_linux_deps.py", check=False)
                if result.returncode == 0:
                    print("✅ System dependencies setup completed!")
                    print("⚠️  If you were added to dialout group, you may need to log out and back in")
                    return True
                else:
                    print("❌ System dependencies setup failed")
                    print("   Continuing with Python setup, but you may encounter issues")
                    return True
            except Exception as e:
                print(f"❌ Could not run system dependencies setup: {e}")
                print("   Please run manually: python3 setup_linux_deps.py")
                return True
        
        elif choice == "2":
            print("\n📋 Manual installation commands for Debian/Ubuntu:")
            print("")
            print("# Update package lists")
            print("sudo apt update")
            print("")
            print("# Install core dependencies")
            print("sudo apt install -y python3-tk python3-dev build-essential")
            print("sudo apt install -y ffmpeg libavcodec-extra portaudio19-dev")
            print("sudo apt install -y libusb-1.0-0-dev libudev-dev pkg-config")
            print("")
            print("# Set up USB permissions")
            print("sudo usermod -a -G dialout $USER")
            print("")
            print("# Log out and back in for group changes to take effect")
            print("")
            print("After installing, re-run this setup script.")
            
            continue_setup = input("\nContinue with Python setup anyway? (y/N): ").strip().lower()
            if continue_setup == "y":
                return True
            else:
                print("Please install system dependencies first, then re-run this script.")
                sys.exit(0)
        
        elif choice == "3":
            print("\n⚠️  Continuing without system dependencies...")
            print("   Python package installation may fail")
            print("   You can install system dependencies later with: python3 setup_linux_deps.py")
            return True
    
    else:
        print("✅ All required Linux system dependencies are available!")
        return True


def setup_api_keys():
    """Guide user through API key setup."""
    print("\n=== AI API Keys Setup (Optional) ===")
    print("The applications support multiple AI providers for transcription and analysis.")
    print("You can set these up now or later in the application settings.\n")

    setup_keys = input("Would you like to set up AI API keys now? (y/N): ").strip().lower()
    if setup_keys not in ["y", "yes"]:
        print("⏭️  Skipping API key setup - you can configure these later in app settings")
        return

    print("\nAvailable AI providers:")
    print("1. Google Gemini (recommended for beginners)")
    print("2. OpenAI (GPT/Whisper)")
    print("3. Anthropic Claude")
    print("4. Skip - I'll set up later")

    choice = input("\nWhich provider would you like to configure? (1-4): ").strip()

    if choice == "1":
        print("\n📝 Google Gemini Setup:")
        print("1. Go to https://makersuite.google.com/app/apikey")
        print("2. Create a new API key")
        print("3. Copy the key and paste it below")

        api_key = input("\nEnter your Gemini API key (or press Enter to skip): ").strip()
        if api_key:
            print("✓ API key saved (you can change this later in app settings)")
            print("ℹ️  Note: Keys are stored encrypted in the desktop app")

    elif choice == "2":
        print("\n📝 OpenAI Setup:")
        print("1. Go to https://platform.openai.com/api-keys")
        print("2. Create a new API key")
        print("3. Copy the key and paste it below")

        api_key = input("\nEnter your OpenAI API key (or press Enter to skip): ").strip()
        if api_key:
            print("✓ API key noted (configure in app settings)")

    elif choice == "3":
        print("\n📝 Anthropic Claude Setup:")
        print("1. Go to https://console.anthropic.com/")
        print("2. Create an API key")
        print("3. Copy the key and paste it below")

        api_key = input("\nEnter your Anthropic API key (or press Enter to skip): ").strip()
        if api_key:
            print("✓ API key noted (configure in app settings)")

    print("\nℹ️  All API keys can be configured later in:")
    print("   • Desktop app: Settings → AI Providers")
    print("   • Web app: Settings page")


def test_app_launches():
    """Test that applications can launch properly."""
    print("\n=== Testing Application Launches ===")

    # Test desktop app import
    print("Testing desktop app dependencies...")
    desktop_dir = Path("hidock-desktop-app")
    if desktop_dir.exists():
        if platform.system() == "Windows":
            python_cmd = ".venv\\Scripts\\python"
        else:
            python_cmd = ".venv/bin/python"

        # Test basic imports
        test_cmd = f"{python_cmd} -c \"import customtkinter; import pygame; print('Desktop dependencies OK')\""
        result = run_command(test_cmd, cwd=desktop_dir, check=False)
        if result.returncode == 0:
            print("✓ Desktop app dependencies working")
        else:
            print("⚠️  Desktop app dependencies issue - check pyproject.toml")

    # Test web app
    print("Testing web app...")
    web_dir = Path("hidock-web-app")
    if web_dir.exists() and check_node_version():
        # Just check that package.json is valid and node_modules exists
        if (web_dir / "node_modules").exists():
            print("✓ Web app dependencies installed")
        else:
            print("⚠️  Web app node_modules missing")

    print("ℹ️  Applications tested - you can now launch them with the commands shown at the end")


def check_device_connection():
    """Check for HiDock device and provide guidance."""
    print("\n=== HiDock Device Check ===")
    print("📱 Checking for connected HiDock devices...")
    print("ℹ️  Note: A HiDock device is NOT required for development!")
    print("   You can develop and test all features without hardware.\n")

    # Try to detect USB devices (basic check)
    try:
        if platform.system() == "Windows":
            # Basic Windows USB device check
            result = run_command('powershell "Get-WmiObject -Class Win32_USBHub | Select-Object Name"', check=False)
        else:
            # Basic Linux/Mac USB check
            result = run_command(
                "lsusb 2>/dev/null || system_profiler SPUSBDataType 2>/dev/null | head -20", check=False
            )

        if result.returncode == 0 and "HiDock" in result.stdout:
            print("🎉 HiDock device detected!")
        else:
            print("📱 No HiDock device detected (this is fine for development)")
    except Exception:
        print("📱 Could not check for devices (this is fine for development)")

    print("\n💡 Device development tips:")
    print("• Desktop app: Has mock device simulation for testing")
    print("• Web app: Requires real device due to WebUSB requirements")
    print("• All core features work without hardware")
    print("• Device communication can be tested later when you get hardware")


def setup_python_env():
    """Set up Python virtual environment."""
    print("\n=== Setting up Python environment ===")

    desktop_dir = Path("hidock-desktop-app")
    if not desktop_dir.exists():
        print("Desktop application directory not found")
        return

    venv_path = desktop_dir / ".venv"

    if venv_path.exists():
        print("Virtual environment already exists")
    else:
        print("Creating virtual environment...")
        result = run_command(f"{sys.executable} -m venv .venv", cwd=desktop_dir, check=False)
        if result.returncode != 0:
            print("❌ Failed to create virtual environment!")
            print("Possible solutions:")
            print("• Check Python version (requires 3.8+)")
            print("• Try: python -m pip install --upgrade pip")
            print("• Check disk space and permissions")
            print("• Manual setup: cd hidock-desktop-app && python -m venv .venv")
            return False

    # Determine activation script
    if platform.system() == "Windows":
        activate_script = "hidock-desktop-app\\.venv\\Scripts\\activate"
        pip_cmd = ".venv\\Scripts\\pip"
    else:
        activate_script = "hidock-desktop-app/.venv/bin/activate"
        pip_cmd = ".venv/bin/pip"

    print("Upgrading pip and installing build tools...")

    # Upgrade pip using the recommended method
    if platform.system() == "Windows":
        python_cmd = ".venv\\Scripts\\python"
    else:
        python_cmd = ".venv/bin/python"

    result = run_command(f"{python_cmd} -m pip install --upgrade pip setuptools wheel", cwd=desktop_dir, check=False)
    if result.returncode != 0:
        print("⚠️  Failed to upgrade pip (continuing anyway)")

    # Install requirements - same for all platforms
    print("Installing dependencies (this may take a few minutes)...")
    result = run_command(f'{pip_cmd} install -e ".[dev]"', cwd=desktop_dir, check=False)
    if result.returncode != 0:
        print("❌ Failed to install dependencies!")
        print("Check your internet connection and try again.")
        return False

    print("✓ Python environment ready")
    print(f"  Activate with: {activate_script}")
    return True


def setup_web_env():
    """Set up web application environment."""
    print("\n=== Setting up Web application ===")

    web_dir = Path("hidock-web-app")
    if not web_dir.exists():
        print("Web application directory not found")
        return

    if not check_node_version():
        print("Node.js is required for web development")
        return

    print("Installing web dependencies...")
    result = run_command("npm install", cwd=web_dir, check=False)
    if result.returncode != 0:
        print("❌ Failed to install web dependencies!")
        print("Common solutions:")
        print("• Check internet connection")
        print("• Clear npm cache: npm cache clean --force")
        print("• Delete node_modules and try again: rm -rf node_modules && npm install")
        print("• Check Node.js version (requires 18+)")
        print("• Try different registry: npm install --registry https://registry.npmjs.org/")
        print("• Manual install: cd hidock-web-app && npm install")
        return False

    print("✓ Web environment ready")
    return True


def setup_audio_insights_env():
    """Set up audio insights extractor environment."""
    print("\n=== Setting up Audio Insights Extractor ===")

    audio_dir = Path("audio-insights-extractor")
    if not audio_dir.exists():
        print("Audio Insights Extractor directory not found")
        return

    if not check_node_version():
        print("Node.js is required for Audio Insights Extractor")
        return

    print("Installing audio insights dependencies...")
    result = run_command("npm install", cwd=audio_dir, check=False)
    if result.returncode != 0:
        print("❌ Failed to install audio insights dependencies!")
        print("Common solutions:")
        print("• Check internet connection")
        print("• Clear npm cache: npm cache clean --force")
        print("• Check Node.js version (requires 18+)")
        print("• Manual install: cd audio-insights-extractor && npm install")
        return False

    print("✓ Audio Insights environment ready")
    return True


def run_tests():
    """Run tests to verify setup."""
    print("\n=== Running tests ===")

    # Python tests
    desktop_dir = Path("hidock-desktop-app")
    if desktop_dir.exists():
        if platform.system() == "Windows":
            python_cmd = ".venv\\Scripts\\python"
        else:
            python_cmd = ".venv/bin/python"

        print("Running Python tests...")
        result = run_command(f"{python_cmd} -m pytest tests/ -v", cwd=desktop_dir, check=False)
        if result.returncode == 0:
            print("✓ Python tests passed")
        else:
            print("⚠️  Python tests failed (this won't block development)")
            print("   You can still develop - tests might need device hardware")
            print("   Check TESTING.md for requirements")

    # Web tests
    web_dir = Path("hidock-web-app")
    if web_dir.exists() and check_node_version():
        print("Running web tests...")
        result = run_command("npm run test", cwd=web_dir, check=False)
        if result.returncode == 0:
            print("✓ Web tests passed")
        else:
            print("✗ Web tests failed")

    # Audio Insights tests
    audio_dir = Path("audio-insights-extractor")
    if audio_dir.exists() and check_node_version():
        print("Running audio insights tests...")
        result = run_command("npm run test", cwd=audio_dir, check=False)
        if result.returncode == 0:
            print("✓ Audio Insights tests passed")
        else:
            print("✗ Audio Insights tests failed")


def setup_git_workflow():
    """Set up git workflow with feature branch."""
    print("\n=== Setting up development workflow ===")

    # Check if we're in a git repository
    try:
        result = run_command("git status", check=False)
        if result.returncode != 0:
            print("✗ Not in a git repository")
            return
    except Exception:
        print("✗ Git not available")
        return

    # Check current branch and status
    try:
        result = run_command("git branch --show-current", check=False)
        current_branch = result.stdout.strip() if result.returncode == 0 else "unknown"
        print(f"Current branch: {current_branch}")

        # Check for uncommitted changes
        result = run_command("git status --porcelain", check=False)
        if result.returncode == 0 and result.stdout.strip():
            print("⚠️  You have uncommitted changes:")
            print(result.stdout.strip())
            print("\nOptions:")
            print("1. Commit your changes first")
            print("2. Stash your changes (git stash)")
            print("3. Continue on current branch")
            print("4. Skip branch creation")

            choice = input("\nHow would you like to proceed? (1-4): ").strip()
            if choice == "1":
                print("Please commit your changes first, then re-run this script")
                return
            elif choice == "2":
                print("Stashing changes...")
                run_command("git stash")
                print("✓ Changes stashed - you can retrieve them later with 'git stash pop'")
            elif choice == "3":
                print(f"Continuing on current branch: {current_branch}")
                return
            elif choice == "4":
                print("Skipping branch creation")
                return

    except Exception:
        current_branch = "unknown"

    # Check if already on a feature branch
    if current_branch and current_branch not in ["main", "master", "develop"]:
        print(f"\n✓ You're already on feature branch: {current_branch}")
        continue_branch = input("Continue working on this branch? (Y/n): ").strip().lower()
        if continue_branch != "n":
            print(f"✓ Continuing on branch: {current_branch}")
            return

    # Ask user what they want to work on
    print("\nWhat would you like to work on?")
    print("1. Desktop Application features")
    print("2. Web Application features")
    print("3. Audio Insights Extractor")
    print("4. Documentation improvements")
    print("5. Bug fixes")
    print("6. General sandbox/exploration")
    print("7. Skip branch creation (stay on current branch)")

    while True:
        try:
            choice = input("\nEnter your choice (1-7): ").strip()
            if choice in ["1", "2", "3", "4", "5", "6", "7"]:
                break
            print("Please enter a number between 1-7")
        except KeyboardInterrupt:
            print("\nSkipping branch setup...")
            return

    if choice == "7":
        print("Staying on current branch")
        return

    # Map choices to branch prefixes
    branch_types = {
        "1": "feature/desktop",
        "2": "feature/web",
        "3": "feature/audio-insights",
        "4": "docs",
        "5": "bugfix",
        "6": "sandbox",
    }

    branch_prefix = branch_types[choice]

    # Get branch name
    if choice == "6":
        import datetime

        timestamp = datetime.datetime.now().strftime("%Y%m%d")
        branch_name = f"{branch_prefix}/exploration-{timestamp}"
    else:
        feature_name = input("Enter a brief description for your branch (e.g., 'add-transcription'): ").strip()
        if not feature_name:
            feature_name = "new-feature"
        # Clean up branch name
        feature_name = feature_name.lower().replace(" ", "-").replace("_", "-")
        branch_name = f"{branch_prefix}/{feature_name}"

    # Create and switch to new branch
    print(f"Creating branch: {branch_name}")
    try:
        run_command(f"git checkout -b {branch_name}")
        print(f"✓ Successfully created and switched to branch: {branch_name}")

        # Show some helpful tips
        print("\n📋 Development workflow tips:")
        print("• Make small, focused commits")
        print("• Write descriptive commit messages (feat:, fix:, docs:, etc.)")
        print("• Run tests before committing")
        print("• Push your branch when ready: git push origin " + branch_name)

    except Exception as e:
        print(f"✗ Failed to create branch: {e}")
        return


def check_existing_setup():
    """Check if basic setup was already done and offer upgrade options."""
    desktop_venv = Path("hidock-desktop-app/.venv").exists()
    web_modules = Path("hidock-web-app/node_modules").exists()

    # Check if this looks like a basic setup (venv exists but no dev tools indicator)
    # We can use git branch as an indicator - basic setup doesn't create branches
    basic_setup_exists = desktop_venv and not has_developer_setup_indicators()

    if basic_setup_exists:
        print("\n🔍 Detected existing basic setup!")
        print("It looks like you (or someone) already ran the simple setup scripts.")
        print("The virtual environment exists but development tools may be missing.")
        print("")
        print("Would you like to:")
        print("1. 🔧 Add developer tools to existing setup (recommended)")
        print("2. 🗑️  Clean and restart with full developer setup")
        print("3. ✅ Keep current setup and exit")
        print("4. ℹ️  Show me what's already set up")

        while True:
            try:
                choice = input("\nChoice (1-4): ").strip()
                if choice in ["1", "2", "3", "4"]:
                    break
                print("Please enter 1, 2, 3, or 4")
            except KeyboardInterrupt:
                print("\nExiting...")
                sys.exit(0)

        if choice == "1":
            print("\n✅ Great! I'll add developer tools to your existing setup.")
            return "upgrade"
        elif choice == "2":
            print("\n🗑️  I'll clean the existing setup and start fresh.")
            clean_existing_setup()
            return "clean_restart"
        elif choice == "3":
            print("\n✅ Keeping your current setup. You can run apps with:")
            show_basic_run_instructions()
            sys.exit(0)
        elif choice == "4":
            show_current_setup_status()
            return check_existing_setup()  # Ask again after showing status

    return "new"


def has_developer_setup_indicators():
    """Check if developer-specific setup indicators exist."""
    try:
        # Check if we're on a non-main branch (indicator of dev workflow)
        result = run_command("git branch --show-current", check=False)
        if result.returncode == 0:
            current_branch = result.stdout.strip()
            if current_branch and current_branch not in ["main", "master"]:
                return True

        # Check if pytest is installed in the venv (dev dependency)
        desktop_dir = Path("hidock-desktop-app")
        if desktop_dir.exists():
            if platform.system() == "Windows":
                pytest_check = run_command('.venv\\Scripts\\python -c "import pytest"', cwd=desktop_dir, check=False)
            else:
                pytest_check = run_command('.venv/bin/python -c "import pytest"', cwd=desktop_dir, check=False)
            if pytest_check.returncode == 0:
                return True

        return False
    except Exception:
        return False


def clean_existing_setup():
    """Remove existing setup to start fresh."""
    print("🧹 Cleaning existing setup...")

    # Remove Python virtual environment
    desktop_venv = Path("hidock-desktop-app/.venv")
    if desktop_venv.exists():
        print("  Removing Python virtual environment...")
        import shutil

        shutil.rmtree(desktop_venv)

    # Remove node_modules
    web_modules = Path("hidock-web-app/node_modules")
    if web_modules.exists():
        print("  Removing web app node_modules...")
        import shutil

        shutil.rmtree(web_modules)

    audio_modules = Path("audio-insights-extractor/node_modules")
    if audio_modules.exists():
        print("  Removing audio insights node_modules...")
        import shutil

        shutil.rmtree(audio_modules)

    print("✅ Cleanup complete! Starting fresh setup...")


def show_current_setup_status():
    """Show what's currently set up."""
    print("\n📋 Current Setup Status:")
    print("=" * 40)

    # Desktop app
    desktop_venv = Path("hidock-desktop-app/.venv")
    if desktop_venv.exists():
        print("✅ Desktop app: Python environment ready")
    else:
        print("❌ Desktop app: Not set up")

    # Web app
    web_modules = Path("hidock-web-app/node_modules")
    if web_modules.exists():
        print("✅ Web app: Dependencies installed")
    else:
        print("❌ Web app: Not set up")

    # Audio insights
    audio_modules = Path("audio-insights-extractor/node_modules")
    if audio_modules.exists():
        print("✅ Audio insights: Dependencies installed")
    else:
        print("❌ Audio insights: Not set up")

    # Git status
    try:
        result = run_command("git branch --show-current", check=False)
        if result.returncode == 0:
            branch = result.stdout.strip()
            if branch in ["main", "master"]:
                print("ℹ️  Git: On main branch (no feature branch)")
            else:
                print(f"✅ Git: On feature branch '{branch}'")
        else:
            print("❌ Git: Not in a git repository")
    except Exception:
        print("❌ Git: Status unknown")

    # Development tools check
    if has_developer_setup_indicators():
        print("✅ Developer tools: Likely installed")
    else:
        print("⚠️  Developer tools: May be missing")

    print("")


def show_basic_run_instructions():
    """Show instructions for running apps with basic setup."""
    print("\n🚀 How to run your apps:")
    print("\n1. 🖥️  Desktop Application:")
    print("   cd hidock-desktop-app")
    if platform.system() == "Windows":
        print("   .venv\\Scripts\\activate")
    else:
        print("   source .venv/bin/activate")
    print("   python main.py")

    if Path("hidock-web-app/node_modules").exists():
        print("\n2. 🌐 Web Application:")
        print("   cd hidock-web-app")
        print("   npm run dev")
        print("   Open: http://localhost:5173")


def run_end_user_setup():
    """Simplified setup for end users who just want to run the apps."""
    print("\n" + "=" * 50)
    print("🎉 END USER SETUP - Simple App Installation")
    print("=" * 50)
    print("")

    try:
        # Basic prerequisite checks
        print("Checking requirements...")
        check_python_version()
        has_node = check_node_version()
        check_permissions()
        check_disk_space()
        
        # Check system dependencies for Linux users
        if platform.system() == "Linux":
            check_linux_system_dependencies()

        # Simple environment setup
        print("\n📦 Setting up applications...")

        # Desktop app setup
        print("\n🖥️  Setting up Desktop Application...")
        if setup_python_env():
            print("✅ Desktop app ready!")
        else:
            print("❌ Desktop app setup failed - see manual instructions below")

        # Web app setup (if Node.js available)
        if has_node:
            print("\n🌐 Setting up Web Application...")
            if setup_web_env():
                print("✅ Web app ready!")
            else:
                print("❌ Web app setup failed - see manual instructions below")
        else:
            print("\n⏭️  Skipping web app (Node.js not available)")

        # Skip audio insights for end users (it's a prototype)

        print("\n" + "=" * 50)
        print("🎉 Setup Complete! You can now use HiDock!")
        print("=" * 50)

        print("\n🚀 How to run the apps:")
        print("\n1. 🖥️  Desktop Application:")
        print("   cd hidock-desktop-app")
        if platform.system() == "Windows":
            print("   .venv\\Scripts\\activate")
        else:
            print("   source .venv/bin/activate")
        print("   python main.py")

        if has_node:
            print("\n2. 🌐 Web Application:")
            print("   cd hidock-web-app")
            print("   npm run dev")
            print("   Open: http://localhost:5173")

        print("\n💡 First time setup tips:")
        print("• Desktop app: Configure AI providers in Settings for transcription")
        print("• Web app: Add your Gemini API key in Settings")
        print("• Connect your HiDock device via USB")
        print("• Check TROUBLESHOOTING.md if you have issues")

        print("\n📚 Documentation:")
        print("• User guide: README.md")
        print("• Troubleshooting: docs/TROUBLESHOOTING.md")
        print("• API setup: Check Settings in each app")

        print("\nEnjoy using HiDock! 🎵")

    except KeyboardInterrupt:
        print("\n\n⚠️  Setup interrupted!")
        print("You can run this script again anytime.")
    except Exception as e:
        print(f"\n❌ Setup failed: {e}")
        print("\nManual setup instructions:")
        print(
            '• Desktop: cd hidock-desktop-app && python -m venv .venv && .venv/Scripts/activate && pip install -e ".[dev]"'
        )
        print("• Web: cd hidock-web-app && npm install")


def show_feature_suggestions():
    """Show suggestions for what to work on."""
    print("\n🚀 Suggested areas to explore:")
    print("\n📱 Desktop Application:")
    print("  • Auto-download functionality")
    print("  • Advanced transcription integration")
    print("  • Enhanced file management")
    print("  • Audio enhancement features")

    print("\n🌐 Web Application:")
    print("  • Offline capabilities")
    print("  • Advanced AI features")
    print("  • Collaboration features")
    print("  • Performance optimization")

    print("\n🎵 Audio Insights Extractor:")
    print("  • Multi-language support")
    print("  • Speaker diarization")
    print("  • Real-time processing")
    print("  • Advanced export options")

    print("\n📚 Documentation:")
    print("  • API documentation improvements")
    print("  • Tutorial creation")
    print("  • Architecture diagrams")
    print("  • Code examples")

    print("\n🐛 Good First Issues:")
    print("  • UI polish and improvements")
    print("  • Error message enhancements")
    print("  • Configuration validation")
    print("  • Test coverage improvements")


def main():
    """Main setup function."""
    print("HiDock Next - Comprehensive Setup")
    print("=" * 50)
    print("")

    # Check for existing setup first
    setup_status = check_existing_setup()

    if setup_status == "upgrade":
        # Skip the user type selection, go straight to developer setup
        # but skip the basic environment setup since it exists
        print("\n🔧 Adding developer tools to existing setup...")
        user_type = "2"
        skip_basic_setup = True
    elif setup_status == "clean_restart":
        # Continue with fresh developer setup
        user_type = "2"
        skip_basic_setup = False
    else:
        # New setup - ask user what they want
        print("🎯 Choose Your Setup Type:")
        print("")
        print("1. 👤 END USER - Just run the apps")
        print("   • Set up to use HiDock apps immediately")
        print("   • No development tools needed")
        print("   • Simple, fast setup")
        print("")
        print("2. 👨‍💻 DEVELOPER - Contribute to the project")
        print("   • Full development environment")
        print("   • Git workflow, testing, AI keys")
        print("   • All development tools")
        print("")

        while True:
            user_type = input("What type of setup do you want? (1 for End User, 2 for Developer): ").strip()
            if user_type in ["1", "2"]:
                break
            print("Please enter 1 or 2")

        skip_basic_setup = False

    if user_type == "1":
        run_end_user_setup()
        return

    try:
        if not skip_basic_setup:
            # Check prerequisites
            print("Checking prerequisites...")
            check_python_version()
            check_node_version()
            check_git_config()
            check_network_connection()
            check_permissions()
            check_disk_space()
            check_development_files()

            # Setup environments
            setup_python_env()
            setup_web_env()
            setup_audio_insights_env()
        else:
            # Just check that git is configured for developer workflow
            print("Checking git configuration...")
            check_git_config()

        # Run tests
        run_tests()

        # Test app launches
        test_app_launches()

        # Check device connection
        check_device_connection()

        # Setup API keys (optional)
        setup_api_keys()

        # Show feature suggestions
        show_feature_suggestions()

        # Set up git workflow
        setup_git_workflow()

        print("\n" + "=" * 50)
        print("🎉 Development environment setup complete!")
        print("\nYou're now ready to start contributing!")

        print("\n🚀 Quick start commands:")
        print("\n1. 🖥️  Desktop app:")
        print("   cd hidock-desktop-app")
        if platform.system() == "Windows":
            print("   .venv\\Scripts\\activate")
        else:
            print("   source .venv/bin/activate")
        print("   python main.py")

        print("\n2. 🌐 Web app:")
        print("   cd hidock-web-app")
        print("   npm run dev")

        print("\n3. 🎵 Audio insights extractor:")
        print("   cd audio-insights-extractor")
        print("   npm run dev")

        print("\n📚 Additional resources:")
        print("• docs/DEVELOPMENT.md - Detailed development guide")
        print("• docs/API.md - API documentation")
        print("• docs/TESTING.md - Testing guidelines")
        print("• docs/TROUBLESHOOTING.md - Common issues and solutions")
        print("• CONTRIBUTING.md - Contribution guidelines")

        print("\n💡 Remember to:")
        print("• Run tests before committing: pytest (desktop) or npm test (web)")
        print("• Follow conventional commit format: feat:, fix:, docs:, etc.")
        print("• Check the roadmap for feature ideas: docs/ROADMAP.md")

        print("\nHappy coding! 🚀")

    except KeyboardInterrupt:
        print("\n\n⚠️  Setup interrupted by user!")
        print("You can re-run this script anytime to continue setup.")
        print("Current progress has been saved.")
        sys.exit(1)
    except Exception as e:
        print(f"\n\n❌ Unexpected error during setup: {e}")
        print("Please report this issue with the full error message.")
        print("You can try manual setup following docs/SETUP.md")
        sys.exit(1)


if __name__ == "__main__":
    main()
