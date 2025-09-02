#!/usr/bin/env python3
"""
Test Permanent Demo Stop
"""

import sys
import time
from safe_testing_framework import SafeCommandTester

def test_permanent_stop():
    """Test if we can permanently stop the demo"""
    print("="*50)
    print("TESTING PERMANENT DEMO STOP")
    print("="*50)
    
    tester = SafeCommandTester()
    
    try:
        if not tester.initialize_backend():
            print("[!] Failed to initialize USB backend")
            return
        
        if not tester.connect_device():
            print("[!] Failed to connect to device")
            return
        
        print("[+] Device connected")
        
        # First start the demo
        print("\n[1] Starting demo with Jensen magic parameter...")
        start_param = bytes.fromhex("34121000")
        result = tester.safe_command_test(10, start_param, "Start demo")
        print(f"    Demo started: {result.get('response', {}).get('body_hex', 'No response')}")
        
        time.sleep(3)  # Let demo play for 3 seconds
        
        # Try a potential "stop" command - empty parameter
        print("\n[2] Trying empty parameter as STOP command...")
        result = tester.safe_command_test(10, b"", "Empty stop command")
        print(f"    Stop response: {result.get('response', {}).get('body_hex', 'No response')}")
        
        print("\n[*] Waiting 5 seconds to see if demo restarts...")
        time.sleep(5)
        
    except Exception as e:
        print(f"[!] Test failed: {e}")
    finally:
        tester.cleanup()
        print("[*] Device disconnected")

if __name__ == "__main__":
    test_permanent_stop()
    
    print("\n" + "="*50)
    print("PERMANENT STOP TEST FEEDBACK:")
    print("="*50)
    print("After the empty parameter command:")
    print("- Did demo stop permanently?")
    print("- Did demo restart after 5 seconds?")
    print("- Any different behavior?")