#!/usr/bin/env python3
"""
Test Demo Repeatability
"""

import sys
import os
import time
from safe_testing_framework import SafeCommandTester

def test_demo_repeat():
    """Test if the demo can be repeated with the same parameter"""
    print("="*50)
    print("TESTING DEMO REPEATABILITY")
    print("Parameter: 34121000 (Jensen magic + Command 10)")
    print("="*50)
    
    tester = SafeCommandTester()
    
    try:
        if not tester.initialize_backend():
            print("[!] Failed to initialize USB backend")
            return
        
        if not tester.connect_device():
            print("[!] Failed to connect to device")
            return
        
        print("[+] Device connected and ready")
        
        param_bytes = bytes.fromhex("34121000")
        
        print(f"\n[*] Sending demo trigger parameter again...")
        print("[*] Listen for demo audio...")
        
        result = tester.safe_command_test(10, param_bytes, "Demo repeat test")
        
        print(f"\n[+] Command sent!")
        print(f"    Response: {result.get('response', {}).get('body_hex', 'No response')}")
        
        print("\n[*] Waiting 10 seconds for potential demo...")
        time.sleep(10)
        
    except Exception as e:
        print(f"[!] Test failed: {e}")
    finally:
        tester.cleanup()
        print("[*] Device disconnected")

if __name__ == "__main__":
    test_demo_repeat()
    
    print("\n" + "="*50)
    print("DEMO REPEAT TEST FEEDBACK:")
    print("="*50)
    print("Did the demo play again?")
    print("- Same audio about dual core neural processors?")
    print("- Different content?") 
    print("- No audio this time?")
    print("\nThis will tell us if the demo is repeatable or one-time only.")