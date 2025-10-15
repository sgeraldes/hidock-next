# -*- coding: utf-8-sig -*-
#!/usr/bin/env python3
"""
Quick Results Check for Commands 14 & 15

Run a quick subset of the most interesting parameters to get immediate results.

Author: HiDock Hardware Analysis Project
Version: 1.0.0
Date: 2025-08-31
"""

import sys
import time
import struct
from safe_testing_framework import SafeCommandTester

def quick_test():
    """Run quick test with most interesting parameters"""
    print("="*60)
    print("QUICK RESULTS CHECK - Commands 14 & 15")
    print("="*60)
    
    # Most interesting parameters to test
    interesting_params = [
        (b"", "Empty"),
        (b"\x00", "Single null byte"),
        (b"\x01", "Single byte 0x01"),
        (b"\x0E", "Command 14 reference"),
        (b"\x0F", "Command 15 reference"),
        (struct.pack('<H', 14), "uint16: 14"),
        (struct.pack('<H', 15), "uint16: 15"),
        (b"\x12\x34", "Jensen magic"),
        (b"\x12\x34\x00\x0E", "Jensen + cmd 14"),
        (b"\x12\x34\x00\x0F", "Jensen + cmd 15"),
        (struct.pack('<I', 0), "uint32: 0"),
        (struct.pack('<I', 1), "uint32: 1"),
        (struct.pack('<I', 14), "uint32: 14"),
        (struct.pack('<I', 15), "uint32: 15"),
    ]
    
    tester = SafeCommandTester()
    
    try:
        # Initialize connection
        if not tester.initialize_backend():
            print("[!] Failed to initialize USB backend")
            return 1
        
        if not tester.connect_device():
            print("[!] Failed to connect to device")
            return 1
        
        print("[+] Device connected\n")
        
        # Test each command
        for cmd_id in [14, 15]:
            print(f"\n{'='*40}")
            print(f"TESTING COMMAND {cmd_id}")
            print(f"{'='*40}")
            
            for params, desc in interesting_params:
                print(f"\n{desc}: {params.hex() if params else '(empty)'}")
                
                try:
                    result = tester.safe_command_test(cmd_id, params, desc)
                    response = result.get('response', {}).get('body_hex', '')
                    status = result['status']
                    
                    if response:
                        print(f"  [!!!] NON-EMPTY RESPONSE: {response}")
                    else:
                        print(f"  Response: (empty)")
                    
                    print(f"  Status: {status}")
                    
                except Exception as e:
                    print(f"  Error: {e}")
                
                time.sleep(0.5)
        
        print("\n" + "="*60)
        print("QUICK TEST COMPLETE")
        print("="*60)
        
    finally:
        tester.cleanup()
        print("\n[+] Device disconnected")
    
    return 0

if __name__ == "__main__":
    try:
        sys.exit(quick_test())
    except KeyboardInterrupt:
        print("\n\nTest interrupted")
        sys.exit(1)