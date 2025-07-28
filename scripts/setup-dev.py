#!/usr/bin/env python3
"""
Development environment setup script for HiDock Community Platform.
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
        result = subprocess.run(
            command, shell=True, cwd=cwd, check=check, capture_output=True, text=True
        )
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
    if version.major != 3 or version.minor < 8:
        print(f"Python 3.8+ required, found {version.major}.{version.minor}")
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


def setup_python_env():
    """Set up Python virtual environment."""
    print("\n=== Setting up Python environment ===")

    venv_path = Path(".venv")

    if venv_path.exists():
        print("Virtual environment already exists")
    else:
        print("Creating virtual environment...")
        run_command(f"{sys.executable} -m venv .venv")

    # Determine activation script
    if platform.system() == "Windows":
        activate_script = ".venv\\Scripts\\activate"
        pip_cmd = ".venv\\Scripts\\pip"
    else:
        activate_script = ".venv/bin/activate"
        pip_cmd = ".venv/bin/pip"

    print("Installing Python dependencies...")
    run_command(f"{pip_cmd} install --upgrade pip")
    run_command(f"{pip_cmd} install -r requirements.txt")

    print("✓ Python environment ready")
    print(f"  Activate with: {activate_script}")


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
    run_command("npm install", cwd=web_dir)

    print("✓ Web environment ready")


def run_tests():
    """Run tests to verify setup."""
    print("\n=== Running tests ===")

    # Python tests
    if platform.system() == "Windows":
        python_cmd = ".venv\\Scripts\\python"
    else:
        python_cmd = ".venv/bin/python"

    print("Running Python tests...")
    result = run_command(f"{python_cmd} -m pytest tests/ -v", check=False)
    if result.returncode == 0:
        print("✓ Python tests passed")
    else:
        print("✗ Python tests failed")

    # Web tests
    web_dir = Path("hidock-web-app")
    if web_dir.exists() and check_node_version():
        print("Running web tests...")
        result = run_command("npm run test", cwd=web_dir, check=False)
        if result.returncode == 0:
            print("✓ Web tests passed")
        else:
            print("✗ Web tests failed")


def main():
    """Main setup function."""
    print("HiDock Community Platform - Development Setup")
    print("=" * 50)

    # Check prerequisites
    print("Checking prerequisites...")
    check_python_version()
    check_node_version()

    # Setup environments
    setup_python_env()
    setup_web_env()

    # Run tests
    run_tests()

    print("\n" + "=" * 50)
    print("Setup complete!")
    print("\nNext steps:")
    print("1. Activate Python environment:")
    if platform.system() == "Windows":
        print("   .venv\\Scripts\\activate")
    else:
        print("   source .venv/bin/activate")
    print("2. Run desktop app: python main.py")
    print("3. Run web app: cd hidock-web-app && npm run dev")
    print("4. Read docs/DEVELOPMENT.md for more information")


if __name__ == "__main__":
    main()
