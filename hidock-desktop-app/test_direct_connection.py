#!/usr/bin/env python3
"""
Test script to verify direct device connection without discovery.
This tests if a HiDock device is actually connected and accessible.
"""

import asyncio
import sys
from pathlib import Path

# Add the parent directory to Python path
sys.path.insert(0, str(Path(__file__).parent))

from desktop_device_adapter import DesktopDeviceAdapter
from config_and_logger import load_config, logger


async def test_direct_connection():
    """Test direct connection to common HiDock device types."""
    print("=== Direct Device Connection Test ===")
    print()
    
    # Load current config
    config = load_config()
    configured_vid = config.get("selected_vid", 4310)  # Default VID
    configured_pid = config.get("selected_pid", 44814)  # P1 PID (0xAF0E)
    
    # Common HiDock device combinations
    test_devices = [
        (0x10D6, 0xB00D, "HiDock H1E (default)"),
        (0x10D6, 0xAF0C, "HiDock H1"),
        (0x10D6, 0xAF0D, "HiDock variant"),
        (0x10D6, 0xAF0E, "HiDock P1"),
        (configured_vid, configured_pid, "Configured device"),
    ]
    
    adapter = DesktopDeviceAdapter()
    connected_devices = []
    
    for vid, pid, name in test_devices:
        device_id = f"{vid:04x}:{pid:04x}"
        print(f"Testing {name} (VID=0x{vid:04X}, PID=0x{pid:04X})...")
        
        try:
            device_info = await adapter.connect(device_id=device_id)
            print(f"  ✅ SUCCESS: Connected to {device_info.name}")
            print(f"     Serial: {device_info.serial_number}")
            print(f"     Firmware: {device_info.firmware_version}")
            print(f"     Model: {device_info.model.value}")
            
            connected_devices.append((device_info, device_id))
            
            # Test basic functionality
            try:
                storage_info = await adapter.get_storage_info()
                print(f"     Storage: {storage_info.used_space // (1024*1024)} MB used of {storage_info.total_capacity // (1024*1024)} MB")
            except Exception as e:
                print(f"     Storage info failed: {e}")
            
            # Disconnect
            await adapter.disconnect()
            print(f"  ✅ Disconnected successfully")
            
        except Exception as e:
            print(f"  ❌ FAILED: {e}")
        
        print()
    
    print("=== Test Results ===")
    if connected_devices:
        print(f"✅ Found {len(connected_devices)} working device(s):")
        for device_info, device_id in connected_devices:
            print(f"   - {device_info.name} ({device_id})")
        
        # If configured device didn't work but others did, show fallback scenario
        configured_device_id = f"{configured_vid:04x}:{configured_pid:04x}"
        configured_worked = any(device_id == configured_device_id for _, device_id in connected_devices)
        
        if not configured_worked and connected_devices:
            print()
            print("📌 Device Fallback Scenario Detected:")
            print(f"   - Configured device: {configured_device_id} (not available)")
            print(f"   - Available device: {connected_devices[0][1]} ({connected_devices[0][0].name})")
            print("   - App should fall back to available device when manually connecting")
        
        return True
    else:
        print("❌ No HiDock devices found")
        print("   - Check USB connection")
        print("   - Check device is powered on")
        print("   - Check if device is in use by another application")
        return False


if __name__ == "__main__":
    # Suppress some console output for cleaner test results
    import logging
    logging.getLogger("config_and_logger").setLevel(logging.WARNING)
    
    # Run the test
    success = asyncio.run(test_direct_connection())
    sys.exit(0 if success else 1)