#!/usr/bin/env python3
"""
Command Parameter Testing for Commands 10, 14, 15

This script tests commands with different parameters to understand their function.

Author: HiDock Hardware Analysis Project
Version: 1.0.0
Date: 2025-08-31
"""

import sys
import time
import struct
import os

# Add current directory to Python path
sys.path.insert(0, '.')

from config_and_logger import logger
from hidock_device import HiDockJensen
import usb.backend.libusb1

def initialize_usb_backend():
    """Initialize USB backend"""
    try:
        # Look for libusb in the hidock-desktop-app directory
        app_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "hidock-desktop-app")
        lib_path = os.path.join(app_dir, "libusb-1.0.dll")
        
        if os.path.exists(lib_path):
            backend_instance = usb.backend.libusb1.get_backend(find_library=lambda x: lib_path)
        else:
            # Try current directory
            current_lib = os.path.join(os.path.dirname(os.path.abspath(__file__)), "libusb-1.0.dll")
            if os.path.exists(current_lib):
                backend_instance = usb.backend.libusb1.get_backend(find_library=lambda x: current_lib)
            else:
                backend_instance = usb.backend.libusb1.get_backend()
        
        return backend_instance
    except Exception as e:
        logger.error("ParamTest", "initialize_usb_backend", f"Backend init failed: {e}")
        return None

def connect_device(backend):
    """Connect to HiDock device"""
    try:
        device = HiDockJensen(backend)
        if device.connect():
            logger.info("ParamTest", "connect_device", "Connected to HiDock device")
            return device
        else:
            logger.error("ParamTest", "connect_device", "Failed to connect")
            return None
    except Exception as e:
        logger.error("ParamTest", "connect_device", f"Connection error: {e}")
        return None

def test_command_with_parameters(device, cmd_id, test_params):
    """Test a command with different parameters"""
    print(f"\n=== Testing Command {cmd_id} with Parameters ===")
    
    for i, params in enumerate(test_params):
        param_desc = params.get('desc', f'Test {i+1}')
        param_data = params.get('data', b'')
        
        print(f"\nTest: {param_desc}")
        print(f"Data: {param_data.hex() if param_data else 'empty'} ({len(param_data)} bytes)")
        
        try:
            start_time = time.time()
            response = device._send_and_receive(cmd_id, param_data, timeout_ms=3000)
            elapsed = time.time() - start_time
            
            if response:
                print(f"SUCCESS: {len(response)} bytes in {elapsed:.2f}s")
                
                # Parse response based on known Jensen protocol structure
                if isinstance(response, dict):
                    print(f"Response ID: {response.get('id', 'unknown')}")
                    print(f"Sequence: {response.get('sequence', 'unknown')}")
                    body = response.get('body', b'')
                    if body:
                        print(f"Body: {body.hex()} ({len(body)} bytes)")
                        if len(body) <= 32:
                            print(f"Body ASCII: {''.join(chr(b) if 32 <= b <= 126 else '.' for b in body)}")
                    else:
                        print("Body: empty")
                else:
                    print(f"Raw response: {response}")
            else:
                print(f"NO RESPONSE in {elapsed:.2f}s")
                
        except Exception as e:
            print(f"ERROR: {e}")
        
        # Small delay between tests
        time.sleep(0.5)

def test_command_10_parameters(device):
    """Test Command 10 with various parameters to see if it works"""
    test_params = [
        {'desc': 'Empty parameters', 'data': b''},
        {'desc': 'Single zero byte', 'data': b'\x00'},
        {'desc': 'Four zero bytes', 'data': b'\x00\x00\x00\x00'},
        {'desc': 'Single 0x01', 'data': b'\x01'},
        {'desc': 'Enable flag', 'data': b'\x01\x00\x00\x00'},
        {'desc': 'Query flag', 'data': b'\x00\x01\x00\x00'},
        {'desc': 'Status request', 'data': b'\xFF\xFF\xFF\xFF'},
        {'desc': '8-byte parameter', 'data': b'\x00\x01\x02\x03\x04\x05\x06\x07'},
    ]
    
    test_command_with_parameters(device, 10, test_params)

def test_command_14_parameters(device):
    """Test Command 14 with various parameters"""
    test_params = [
        {'desc': 'Empty (known working)', 'data': b''},
        {'desc': 'Single zero', 'data': b'\x00'},
        {'desc': 'Single 0x01', 'data': b'\x01'},
        {'desc': 'Query all', 'data': b'\xFF'},
        {'desc': 'Four bytes zeros', 'data': b'\x00\x00\x00\x00'},
        {'desc': 'Index 0', 'data': b'\x00\x00'},
        {'desc': 'Index 1', 'data': b'\x01\x00'},
        {'desc': 'Index 2', 'data': b'\x02\x00'},
        {'desc': 'Status flags', 'data': b'\x00\x01\x02\x03'},
        {'desc': 'Timestamp request', 'data': struct.pack('<I', int(time.time()))},
    ]
    
    test_command_with_parameters(device, 14, test_params)

def test_command_15_parameters(device):
    """Test Command 15 with various parameters"""
    test_params = [
        {'desc': 'Empty (known working)', 'data': b''},
        {'desc': 'Single zero', 'data': b'\x00'},
        {'desc': 'Single 0x01', 'data': b'\x01'},
        {'desc': 'Query mode', 'data': b'\xFF'},
        {'desc': 'Four bytes', 'data': b'\x00\x00\x00\x00'},
        {'desc': 'Counter 0', 'data': b'\x00\x00'},
        {'desc': 'Counter 1', 'data': b'\x01\x00'},
        {'desc': 'Enable/disable', 'data': b'\x01\x00\x00\x00'},
        {'desc': 'Get status', 'data': b'\x00\x01\x00\x00'},
        {'desc': 'Reset command', 'data': b'\xFF\xFF\x00\x00'},
    ]
    
    test_command_with_parameters(device, 15, test_params)

def main():
    """Main parameter testing function"""
    print("HiDock H1E - Command Parameter Discovery")
    print("=" * 50)
    
    # Initialize USB backend
    backend = initialize_usb_backend()
    if not backend:
        print("ERROR: Could not initialize USB backend")
        return 1
    
    # Connect to device
    device = connect_device(backend)
    if not device:
        print("ERROR: Could not connect to HiDock device")
        return 1
    
    print("Device connected successfully!")
    
    # Test commands with parameters
    try:
        print("\n" + "="*60)
        print("PARAMETER TESTING")
        print("="*60)
        
        # Test Command 14 first (we know it works)
        test_command_14_parameters(device)
        
        # Test Command 15
        test_command_15_parameters(device)
        
        # Test Command 10 (be careful - might cause issues)
        print("\n" + "!"*60)
        print("WARNING: Testing Command 10 - this may cause device issues")
        print("!"*60)
        
        response = input("Continue with Command 10 testing? (y/N): ")
        if response.lower().startswith('y'):
            test_command_10_parameters(device)
        else:
            print("Skipping Command 10 testing")
        
    except Exception as e:
        print(f"Testing error: {e}")
    
    # Cleanup
    try:
        device.disconnect()
        print("\nDevice disconnected")
    except:
        pass
    
    print("\nParameter testing complete!")
    return 0

if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\n\nTesting interrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"\nUnexpected error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)