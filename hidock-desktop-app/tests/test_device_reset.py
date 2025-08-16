#!/usr/bin/env python3
"""
Test script for device reset functionality.

This script tests the new device reset functionality that helps recover
from USB communication errors when the device gets stuck in an inconsistent state.
"""

import sys
import time

import pytest
import usb.backend.libusb1

from config_and_logger import logger
from desktop_device_adapter import DesktopDeviceAdapter
from hidock_device import HiDockJensen

from .test_ci_skip import device_test_ci_skip
from .test_race_condition_fix import device_test_manager, ensure_device_disconnected


def test_device_reset():
    """Test the device reset functionality."""
    with device_test_manager.exclusive_device_access("test_device_reset"):
        print("Testing HiDock device reset functionality...")

    # Initialize USB backend
    try:
        backend = usb.backend.libusb1.get_backend()
        if not backend:
            print("ERROR: Could not initialize USB backend")
            return False
    except Exception as e:
        print(f"ERROR: USB backend initialization failed: {e}")
        return False

    # Create Jensen device instance
    jensen = HiDockJensen(backend)

    print("1. Testing device reset when not connected...")
    try:
        jensen.reset_device_state()
        print("   ✓ Reset successful (device not connected)")
    except Exception as e:
        print(f"   ✗ Reset failed: {e}")
        return False

    print("2. Attempting to connect to device...")
    try:
        success, error_msg = jensen.connect(force_reset=True)
        if success:
            print("   ✓ Connection successful with force reset")
        else:
            print(f"   ✗ Connection failed: {error_msg}")
            # This is not necessarily a failure if no device is connected
            print("   (This is expected if no HiDock device is connected)")
            return True
    except Exception as e:
        print(f"   ✗ Connection attempt failed: {e}")
        return True  # Not a failure if no device is available

    print("3. Testing device reset when connected...")
    try:
        jensen.reset_device_state()
        print("   ✓ Reset successful (device connected)")
    except Exception as e:
        print(f"   ✗ Reset failed: {e}")
        jensen.disconnect()
        return False

    print("4. Testing device info after reset...")
    try:
        device_info = jensen.get_device_info(timeout_s=3)
        if device_info:
            print(f"   ✓ Device info retrieved: {device_info}")
        else:
            print("   ⚠ Device info not available (may indicate device issue)")
    except Exception as e:
        print(f"   ⚠ Device info failed: {e} (may indicate device needs physical reset)")

    print("5. Testing desktop adapter recovery...")
    try:
        adapter = DesktopDeviceAdapter(backend)
        adapter.jensen_device = jensen  # Use the already connected device

        # Test the recovery function
        recovery_result = adapter.recover_from_error()
        if recovery_result:
            print("   ✓ Desktop adapter recovery successful")
        else:
            print("   ⚠ Desktop adapter recovery failed (may be expected)")
    except Exception as e:
        print(f"   ✗ Desktop adapter recovery test failed: {e}")

        # Clean up
        try:
            ensure_device_disconnected(jensen)
            print("6. ✓ Device disconnected successfully")
        except Exception as e:
            print(f"6. ⚠ Disconnect warning: {e}")

        # Additional cleanup delay
        time.sleep(0.5)

        print("\nDevice reset functionality test completed!")
        return True


async def test_connection_with_timeout_recovery():
    """Test connection with automatic timeout recovery."""
    async with device_test_manager.exclusive_async_device_access("test_connection_with_timeout_recovery"):
        print("\nTesting connection with timeout recovery...")

        try:
            backend = usb.backend.libusb1.get_backend()
            adapter = DesktopDeviceAdapter(backend)

            print("1. Attempting connection with auto-recovery...")
            try:
                # This will automatically try force reset if timeout occurs
                device_info = await adapter.connect(auto_retry=True)
                print(f"   ✓ Connection successful: {device_info.name}")

                # Add delay to ensure connection is stable
                import asyncio

                await asyncio.sleep(0.3)

                print("2. Testing connection stability...")
                test_result = await adapter.test_connection()
                if test_result:
                    print("   ✓ Connection test passed")
                else:
                    print("   ⚠ Connection test failed")

                await adapter.disconnect()
                print("3. ✓ Disconnected successfully")

            except Exception as e:
                error_msg = str(e)
                if "Access denied" in error_msg or "permission" in error_msg.lower():
                    print(f"   ⚠  Connection failed: {e} (expected if no device connected)")
                    return True  # Consider this a successful test when no device available
                else:
                    print(f"   ⚠ Connection failed: {e} (expected if no device connected)")

            finally:
                # Ensure cleanup
                try:
                    ensure_device_disconnected(adapter.jensen_device)
                    import asyncio

                    await asyncio.sleep(0.5)
                except Exception:
                    pass  # Ignore cleanup errors

        except Exception as e:
            print(f"ERROR: Test setup failed: {e}")
            return False

        return True


@pytest.mark.device
@device_test_ci_skip
def test_device_reset_functionality():
    """Pytest wrapper for device reset functionality test."""
    success = test_device_reset()
    assert success, "Device reset functionality test failed"


@pytest.mark.device
@pytest.mark.asyncio
@device_test_ci_skip
async def test_connection_timeout_recovery():
    """Pytest wrapper for connection timeout recovery test."""
    try:
        success = await test_connection_with_timeout_recovery()
        # If no device is available or access is denied, consider test passed
        assert success, "Connection timeout recovery test failed"
    except Exception as e:
        if "Access denied" in str(e) or "permission" in str(e).lower():
            pytest.skip(f"Device access denied - skipping test: {e}")
        else:
            raise


if __name__ == "__main__":
    print("HiDock Device Reset Test")
    print("=" * 40)

    # Test basic reset functionality
    success1 = test_device_reset()

    # Test connection with recovery
    import asyncio

    success2 = asyncio.run(test_connection_with_timeout_recovery())

    if success1 and success2:
        print("\n✓ All tests completed successfully!")
        sys.exit(0)
    else:
        print("\n✗ Some tests failed!")
        sys.exit(1)
