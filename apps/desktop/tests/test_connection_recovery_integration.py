#!/usr/bin/env python3
"""Integration test for connection recovery after USB communication errors."""

import asyncio
import os
import sys
import time

import pytest
from tests.helpers.optional import require
require("usb", marker="integration")

import usb.backend.libusb1

pytestmark = [pytest.mark.integration]

# Add parent directory to path for imports when running standalone
if __name__ == "__main__":
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from desktop_device_adapter import DesktopDeviceAdapter
from hidock_device import HiDockJensen

from .test_ci_skip import device_test_ci_skip
from .test_race_condition_fix import device_test_manager, ensure_device_disconnected


@pytest.mark.integration
@pytest.mark.device
@device_test_ci_skip
async def test_connection_recovery_after_error():
    """Test that connection can recover after USB communication errors."""
    # Use exclusive device access to prevent race conditions
    async with device_test_manager.exclusive_async_device_access("test_connection_recovery_after_error"):
        # Initialize backend
        script_dir = os.path.dirname(os.path.abspath(__file__))
        if script_dir.endswith("tests"):
            script_dir = os.path.dirname(script_dir)
        dll_path = os.path.join(script_dir, "libusb-1.0.dll")

        if os.path.exists(dll_path):
            backend = usb.backend.libusb1.get_backend(find_library=lambda x: dll_path)
        else:
            backend = usb.backend.libusb1.get_backend()

        assert backend is not None, "Failed to initialize USB backend"

        adapter = DesktopDeviceAdapter(backend)

        try:
            # Step 1: Normal connection
            print("1. Testing normal connection...")
            try:
                device_info = await adapter.connect()
                assert device_info is not None, "Initial connection failed"
                assert adapter.is_connected(), "Device should be connected"
                print(f"   ✓ Connected to {device_info.name}")

                # Add delay to ensure connection is stable
                await asyncio.sleep(0.5)

                # Step 2: Simulate communication error by forcing disconnect
                print("2. Simulating communication error...")
                # Force disconnect the underlying Jensen device to simulate USB error
                adapter.jensen_device.disconnect()
                await asyncio.sleep(0.2)  # Allow disconnect to complete
                assert not adapter.is_connected(), "Device should be disconnected after error"
                print("   ✓ Simulated USB communication error")

                # Step 3: Test recovery with automatic reset
                print("3. Testing automatic recovery...")
                await asyncio.sleep(0.5)  # Wait before recovery attempt
                device_info = await adapter.connect(force_reset=True)
                assert device_info is not None, "Recovery connection failed"
                assert adapter.is_connected(), "Device should be connected after recovery"
                print(f"   ✓ Recovered connection to {device_info.name}")

                # Step 4: Verify connection works normally
                print("4. Verifying connection stability...")
                await asyncio.sleep(0.3)  # Allow connection to stabilize
                test_result = await adapter.test_connection()
                assert test_result, "Connection test should pass after recovery"
                print("   ✓ Connection stable after recovery")

                # Step 5: Test the recovery method directly
                print("5. Testing direct recovery method...")
                # Simulate another error
                adapter.jensen_device.disconnect()
                await asyncio.sleep(0.2)  # Allow disconnect to complete
                recovery_success = await adapter.recover_from_error()
                assert recovery_success, "Direct recovery should succeed"
                assert adapter.is_connected(), "Device should be connected after direct recovery"
                print("   ✓ Direct recovery method works")

            except Exception as e:
                error_msg = str(e)
                if "Access denied" in error_msg or "permission" in error_msg.lower():
                    pytest.skip(f"Device access denied - skipping test: {e}")
                else:
                    raise

        finally:
            # Clean up
            try:
                ensure_device_disconnected(adapter.jensen_device)
                if adapter.is_connected():
                    await adapter.disconnect()
                print("6. ✓ Cleanup completed")
                # Additional cleanup delay
                await asyncio.sleep(0.5)
            except Exception:
                pass  # Ignore cleanup errors


@pytest.mark.integration
@pytest.mark.device
@device_test_ci_skip
def test_gui_connection_retry_logic():
    """Test the GUI connection retry logic with device reset."""
    # Use exclusive device access to prevent race conditions
    with device_test_manager.exclusive_device_access("test_gui_connection_retry_logic"):
        # Initialize backend
        script_dir = os.path.dirname(os.path.abspath(__file__))
        if script_dir.endswith("tests"):
            script_dir = os.path.dirname(script_dir)
        dll_path = os.path.join(script_dir, "libusb-1.0.dll")

        if os.path.exists(dll_path):
            backend = usb.backend.libusb1.get_backend(find_library=lambda x: dll_path)
        else:
            backend = usb.backend.libusb1.get_backend()

        assert backend is not None, "Failed to initialize USB backend"

        jensen = HiDockJensen(backend)

        try:
            print("1. Testing connection with automatic retry and reset...")

            # This simulates the GUI connection logic with retry
            success, error = jensen.connect(auto_retry=True)
            if not success:
                if "Access denied" in error or "permission" in error.lower():
                    pytest.skip(f"Device access denied - skipping test: {error}")
                else:
                    assert success, f"Connection with retry should succeed: {error}"
            print("   ✓ Connection with retry succeeded")

            # Add delay to ensure connection is stable
            time.sleep(0.5)

            # Test device reset while connected
            print("2. Testing device reset during connection...")
            jensen.reset_device_state()
            time.sleep(0.2)  # Allow reset to complete
            assert jensen.is_connected(), "Device should remain connected after reset"
            print("   ✓ Device reset successful while connected")

            # Test communication after reset
            print("3. Testing communication after reset...")
            time.sleep(0.3)  # Allow device to stabilize
            try:
                device_info = jensen.get_device_info(timeout_s=3)
                assert device_info is not None, "Device info should be available after reset"
                print(f"   ✓ Communication works after reset: {device_info}")
            except Exception as e:
                if "Device health check failed" in str(e):
                    pytest.skip(f"Device communication failed after reset - may need physical reset: {e}")
                else:
                    raise

        except Exception as e:
            error_msg = str(e)
            if "Access denied" in error_msg or "permission" in error_msg.lower():
                pytest.skip(f"Device access denied - skipping test: {e}")
            else:
                raise
        finally:
            try:
                ensure_device_disconnected(jensen)
                print("4. ✓ Cleanup completed")
                # Additional cleanup delay
                time.sleep(0.5)
            except Exception:
                pass  # Ignore cleanup errors


if __name__ == "__main__":
    print("HiDock Connection Recovery Integration Test")
    print("=" * 50)

    try:
        # Test async recovery
        print("\nTesting async recovery...")
        asyncio.run(test_connection_recovery_after_error())

        # Add delay between tests
        time.sleep(1.0)

        # Test GUI retry logic
        print("\nTesting GUI retry logic...")
        test_gui_connection_retry_logic()

        print("\n✓ All integration tests completed!")
    except Exception as e:
        print(f"\n✗ Test failed: {e}")
        raise
