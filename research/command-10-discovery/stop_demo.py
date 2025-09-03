#!/usr/bin/env python3
"""
Attempt to Stop Running Demo
"""

import sys
import os
import time
from safe_testing_framework import SafeCommandTester

def try_stop_demo():
    """Try different parameters to stop the demo"""
    print("="*50)
    print("ATTEMPTING TO STOP RUNNING DEMO")
    print("="*50)
    
    tester = SafeCommandTester()
    
    try:
        if not tester.initialize_backend():
            print("[!] Failed to initialize USB backend")
            return
        
        if not tester.connect_device():
            print("[!] Failed to connect to device")
            return
        
        print("[+] Device connected - demo should be playing")
        
        # Try different stop commands
        stop_attempts = [
            ("00000000", "All zeros (stop/reset)"),
            ("0a000000", "Command 10, subcommand 0"),
            ("0a000100", "Command 10, subcommand 1"),
            ("ffffffff", "All ones (disable)"),
        ]
        
        for param_hex, description in stop_attempts:
            print(f"\n[*] Trying to stop demo with: {description}")
            print(f"    Parameter: {param_hex}")
            
            param_bytes = bytes.fromhex(param_hex)
            result = tester.safe_command_test(10, param_bytes, description)
            
            print(f"    Response: {result.get('response', {}).get('body_hex', 'No response')}")
            print(f"[?] Did the demo stop? Waiting 2 seconds...")
            time.sleep(2)
        
    except Exception as e:
        print(f"[!] Stop attempt failed: {e}")
    finally:
        tester.cleanup()
        print("[*] Device disconnected")

if __name__ == "__main__":
    try_stop_demo()
    
    print("\n" + "="*50)
    print("DEMO STOP ATTEMPT FEEDBACK:")
    print("="*50)
    print("Did any of the parameters stop the demo?")
    print("- Which one stopped it (if any)?")
    print("- Is demo still playing?")
    print("- Any changes in behavior?")