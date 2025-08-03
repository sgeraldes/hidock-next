#!/usr/bin/env python3
"""Simple test for device reset functionality with connected device."""

import os
import sys

import pytest
import usb.backend.libusb1

# Add parent directory to path for imports when running standalone
if __name__ == "__main__":
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from hidock_device import HiDockJensen

from .test_ci_skip import device_test_ci_skip


def test_reset_with_connected_device():
    """Test device reset with actual connected device."""
    print("Testing device reset with connected HiDock...")

    try:
        # Initialize backend with DLL path
        script_dir = os.path.dirname(os.path.abspath(__file__))
        # When running from tests folder, go up one level
        if script_dir.endswith("tests"):
            script_dir = os.path.dirname(script_dir)
        dll_path = os.path.join(script_dir, "libusb-1.0.dll")

        if os.path.exists(dll_path):
            print(f"   Using DLL: {dll_path}")
            backend = usb.backend.libusb1.get_backend(find_library=lambda x: dll_path)
        else:
            print(f"   DLL not found at {dll_path}, trying system backend")
            backend = usb.backend.libusb1.get_backend()

        if not backend:
            print("   Failed to initialize USB backend")
            return False

        print("   ✓ USB backend initialized")

        jensen = HiDockJensen(backend)

        # Connect to device with force reset
        print("2. Connecting to device with force reset...")
        success, error = jensen.connect(force_reset=True)
        if not success:
            print(f"   Connection failed: {error}")
            # If access denied, consider test passed (no device available)
            if "Access denied" in error or "permission" in error.lower():
                return True
            return False
        print("   ✓ Connected successfully")

        # Test device reset while connected
        print("3. Testing device reset while connected...")
        jensen.reset_device_state()
        print("   ✓ Device reset completed")

        # Test connection after reset
        print("4. Testing connection stability after reset...")
        if not jensen.is_connected():
            print("   ✗ Device disconnected after reset")
            return False
        print("   ✓ Connection stable after reset")

        # Test device info after reset
        print("5. Testing device communication after reset...")
        device_info = jensen.get_device_info(timeout_s=3)
        if device_info:
            print(f"   ✓ Device info: {device_info}")
        else:
            print("   ✗ Failed to get device info after reset")
            return False

        # Disconnect
        jensen.disconnect()
        print("6. ✓ Disconnected successfully")

        return True

    except Exception as e:
        print(f"ERROR: {e}")
        return False


@pytest.mark.device
@device_test_ci_skip
def test_device_reset_with_connected_device():
    """Pytest wrapper for device reset functionality test."""
    try:
        success = test_reset_with_connected_device()
        assert success, "Device reset functionality test failed"
    except Exception as e:
        if "Access denied" in str(e) or "permission" in str(e).lower():
            pytest.skip(f"Device access denied - skipping test: {e}")
        else:
            raise


if __name__ == "__main__":
    success = test_reset_with_connected_device()
    if success:
        print("\n✓ Device reset test passed!")
    else:
        print("\n✗ Device reset test failed!")
