#!/usr/bin/env python3
"""
Test Isolation Verification Script

This script can be run to verify that the test isolation system is working correctly.
It performs a series of checks to ensure no production data contamination can occur.

Usage:
    python tests/verify_isolation.py
"""

import os
import sys
import tempfile
from pathlib import Path

# Add parent directory to path so we can import modules
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def check_isolation():
    """Check if isolation is properly configured."""
    print("🔍 Verifying Test Data Isolation System...")
    print("=" * 60)

    # Check if we're in test mode
    if os.getenv("TESTING") == "1":
        print("✅ TESTING environment variable is set")
    else:
        print("❌ TESTING environment variable not set - isolation may not be active")
        return False

    # Check test directory environment variables
    test_dirs = {
        "HIDOCK_TEST_CONFIG_DIR": "Config directory",
        "HIDOCK_TEST_CACHE_DIR": "Cache directory",
        "HIDOCK_TEST_DOWNLOADS_DIR": "Downloads directory",
        "HIDOCK_TEST_HOME_DIR": "Home directory",
    }

    for env_var, description in test_dirs.items():
        path = os.getenv(env_var)
        if path:
            if "tmp" in path.lower() or "temp" in path.lower():
                print(f"✅ {description}: {path}")
            else:
                print(f"⚠️  {description}: {path} (doesn't appear to be temporary)")
        else:
            print(f"❌ {env_var} not set")
            return False

    print("\n🔧 Testing Module Isolation...")
    print("-" * 40)

    try:
        # Test config isolation
        import config_and_logger

        config_path = config_and_logger._CONFIG_FILE_PATH
        if "tmp" in config_path.lower() or "temp" in config_path.lower():
            print(f"✅ Config file path isolated: {config_path}")
        else:
            print(f"❌ Config file path not isolated: {config_path}")
            return False

        # Test home directory patching
        home_path = str(Path.home())
        if "tmp" in home_path.lower() or "temp" in home_path.lower():
            print(f"✅ Path.home() isolated: {home_path}")
        else:
            print(f"❌ Path.home() not isolated: {home_path}")
            return False

        # Test expanduser patching
        expanded = os.path.expanduser("~")
        if "tmp" in expanded.lower() or "temp" in expanded.lower():
            print(f"✅ os.path.expanduser isolated: {expanded}")
        else:
            print(f"❌ os.path.expanduser not isolated: {expanded}")
            return False

    except Exception as e:
        print(f"❌ Error testing module isolation: {e}")
        return False

    print("\n💾 Testing File Operations...")
    print("-" * 40)

    try:
        # Test config save/load
        test_config = {"test_verification": True, "download_directory": "/test"}
        config_and_logger.save_config(test_config)
        loaded_config = config_and_logger.load_config()

        if loaded_config.get("test_verification"):
            print("✅ Config save/load operations isolated")
        else:
            print("❌ Config save/load operations not working properly")
            return False

    except Exception as e:
        print(f"❌ Error testing file operations: {e}")
        return False

    print("\n🚫 Testing Production File Protection...")
    print("-" * 50)

    # Check that no production files exist that shouldn't
    real_home = Path("/tmp") if os.name != "nt" else Path.home()  # Use /tmp on Unix to avoid confusion

    production_files = [
        Path("hidock_config.json"),
    ]

    # Only check if they don't exist or warn if they do
    found_production_files = []
    for prod_file in production_files:
        if prod_file.exists():
            found_production_files.append(str(prod_file))

    if found_production_files:
        print(f"⚠️  Found production files in current directory: {found_production_files}")
        print("   These files should be backed up before running tests")
    else:
        print("✅ No production files found in current directory")

    print("\n" + "=" * 60)
    print("🎉 Test Isolation System Verification Complete!")
    print("✅ All checks passed - your tests are properly isolated")
    print("📁 Test data will be stored in temporary directories")
    print("🛡️  Your production data is protected from contamination")

    return True


def main():
    """Main verification function."""
    if not check_isolation():
        print("\n❌ ISOLATION VERIFICATION FAILED!")
        print("Some checks did not pass. Please review the output above.")
        print("Tests may contaminate production data if run in this state.")
        sys.exit(1)

    print("\n✅ ISOLATION VERIFICATION SUCCESSFUL!")
    print("It's safe to run tests - they won't affect your production data.")
    sys.exit(0)


if __name__ == "__main__":
    main()
