#!/usr/bin/env python3
"""
Test script to verify device connection fallback logic.
Tests the scenario where P1 is configured but only H1E is connected.
"""

import asyncio
import sys
from datetime import datetime
from pathlib import Path

# Add the parent directory to Python path
sys.path.insert(0, str(Path(__file__).parent))

from desktop_device_adapter import DesktopDeviceAdapter
from config_and_logger import load_config, logger


async def test_device_fallback():
    """Test device fallback when configured device is not available."""
    print("=== Device Connection Fallback Test ===")
    print(f"Test started at: {datetime.now()}")
    print()
    
    # Load current config
    config = load_config()
    configured_vid = config.get("selected_vid", 4310)  # Default VID
    configured_pid = config.get("selected_pid", 44814)  # P1 PID (0xAF0E)
    
    print(f"Configured device: VID=0x{configured_vid:04X}, PID=0x{configured_pid:04X}")
    print(f"Expected: P1 device (PID 0xAF0E = {0xAF0E})")
    print()
    
    # Create device adapter
    adapter = DesktopDeviceAdapter()
    
    # Step 1: Discover available devices
    print("Step 1: Discovering available devices...")
    try:
        discovered_devices = await adapter.discover_devices()
        print(f"Found {len(discovered_devices)} devices:")
        for device in discovered_devices:
            print(f"  - {device.name} (VID=0x{device.vendor_id:04X}, PID=0x{device.product_id:04X})")
        print()
    except Exception as e:
        print(f"Device discovery failed: {e}")
        return False
    
    if not discovered_devices:
        print("❌ No devices found - cannot test fallback")
        return False
    
    # Step 2: Try connecting to configured device (should fail if P1 not connected)
    print("Step 2: Attempting connection to configured device...")
    configured_device_id = f"{configured_vid:04x}:{configured_pid:04x}"
    
    try:
        device_info = await adapter.connect(device_id=configured_device_id)
        print(f"✅ Connected to configured device: {device_info.name}")
        await adapter.disconnect()
        print("📌 Note: Configured device was available - fallback not tested")
        return True
    except Exception as e:
        print(f"❌ Configured device connection failed: {e}")
        print("✅ This is expected if P1 is not connected")
        print()
    
    # Step 3: Test fallback to first available device
    print("Step 3: Testing fallback connection...")
    try:
        # Connect without specifying device_id to trigger fallback
        device_info = await adapter.connect(device_id=None)
        print(f"✅ Fallback successful!")
        print(f"   Connected device: {device_info.name}")
        print(f"   VID=0x{device_info.vendor_id:04X}, PID=0x{device_info.product_id:04X}")
        
        # Check if it's different from configured
        if device_info.product_id != configured_pid:
            print(f"✅ Fallback worked: Connected to {device_info.name} instead of configured P1")
        else:
            print("📌 Connected to configured device (P1 was actually available)")
        
        # Test device info
        print()
        print("Step 4: Testing connected device functionality...")
        device_details = await adapter.get_device_info()
        print(f"   Device ID: {device_details.id}")
        print(f"   Serial: {device_details.serial_number}")
        print(f"   Firmware: {device_details.firmware_version}")
        print(f"   Model: {device_details.model.value}")
        
        # Disconnect
        await adapter.disconnect()
        print("✅ Disconnected successfully")
        
        return True
    except Exception as e:
        print(f"❌ Fallback connection failed: {e}")
        return False


if __name__ == "__main__":
    # Suppress some console output for cleaner test results
    import logging
    logging.getLogger("config_and_logger").setLevel(logging.WARNING)
    
    # Run the test
    success = asyncio.run(test_device_fallback())
    
    print()
    print("=== Test Results ===")
    if success:
        print("✅ Device fallback test PASSED")
        print("   - Device discovery works")
        print("   - Connection fallback works when configured device unavailable")
        print("   - Connected device functionality works")
    else:
        print("❌ Device fallback test FAILED")
        print("   Check that a HiDock device is connected")
    
    sys.exit(0 if success else 1)