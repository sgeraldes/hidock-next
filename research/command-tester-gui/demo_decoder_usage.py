# -*- coding: utf-8-sig -*-
#!/usr/bin/env python3
"""
Demo: Using HiDock Response Decoder with Real Device

Shows how to get file list, device info, and other data in human-readable format.

Author: HiDock Research Project
Version: 1.0.0
Date: 2025-09-01
"""

import sys
import time
from pathlib import Path

# Add parent directory to path for imports
sys.path.append(str(Path(__file__).parent.parent / "command-10-discovery"))

from safe_testing_framework import SafeCommandTester
from response_decoder import HiDockResponseDecoder

def demo_decoder():
    """Demonstrate decoder with actual device commands"""
    
    print("="*60)
    print("HIDOCK RESPONSE DECODER - Live Demo")
    print("="*60)
    print()
    
    # Initialize components
    tester = SafeCommandTester()
    decoder = HiDockResponseDecoder()
    
    # Connect to device
    print("Connecting to device...")
    if not tester.initialize_backend():
        print("Failed to initialize USB backend")
        return
        
    if not tester.connect_device():
        print("Failed to connect to device")
        return
        
    print("Device connected successfully!\n")
    
    # Commands to test
    commands_to_test = [
        (1, b'', "GET_DEVICE_INFO - Device information"),
        (2, b'', "GET_DEVICE_TIME - Current device time"),
        (6, b'', "GET_FILE_COUNT - Number of files"),
        (4, b'', "GET_FILE_LIST - List of recordings"),
        (16, b'', "GET_CARD_INFO - Storage information"),
        (11, b'', "GET_SETTINGS - Device settings"),
    ]
    
    for cmd_id, params, description in commands_to_test:
        print("="*60)
        print(f"Testing: {description}")
        print("-"*60)
        
        # Send command
        result = tester.safe_command_test(cmd_id, params, description)
        
        if result['status'] == 'success':
            response = result.get('response', {})
            hex_data = response.get('body_hex', '')
            
            if hex_data:
                print(f"Raw response: {hex_data[:60]}..." if len(hex_data) > 60 else f"Raw response: {hex_data}")
                print()
                
                # Decode and display
                decoded = decoder.decode_response(cmd_id, hex_data)
                if decoded:
                    print("DECODED:")
                    print("-" * 40)
                    print(decoded)
                else:
                    print("No decoder available for this response")
            else:
                print("Empty response received")
        else:
            print(f"Command failed: {result.get('error', 'Unknown error')}")
        
        print()
        time.sleep(1)  # Small delay between commands
    
    # Cleanup
    tester.cleanup()
    print("="*60)
    print("Demo complete - device disconnected")
    print("="*60)

if __name__ == "__main__":
    try:
        demo_decoder()
    except KeyboardInterrupt:
        print("\n\nDemo interrupted by user")
    except Exception as e:
        print(f"\nError: {e}")