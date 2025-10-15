#!/usr/bin/env python3
"""
Test Single Command 10 Parameter with User Feedback
"""

import sys
import os
import time
from safe_testing_framework import SafeCommandTester

def test_parameter(param_hex, description):
    """Test a single parameter and get user feedback"""
    print(f"\n{'='*50}")
    print(f"TESTING: {description}")
    print(f"Parameter: {param_hex}")
    print(f"{'='*50}")
    
    tester = SafeCommandTester()
    
    try:
        # Initialize
        if not tester.initialize_backend():
            print("[!] Failed to initialize USB backend")
            return False
        
        if not tester.connect_device():
            print("[!] Failed to connect to device")
            return False
        
        print("[+] Device connected and ready")
        
        # Convert hex to bytes
        param_bytes = bytes.fromhex(param_hex)
        
        print(f"\n[*] Sending Command 10 with parameter: {param_hex}")
        print("[*] Listen carefully for any audio/demo activation...")
        
        # Send the command
        result = tester.safe_command_test(10, param_bytes, description)
        
        print(f"\n[+] Command sent successfully!")
        print(f"    Response: {result.get('response', {}).get('body_hex', 'No response')}")
        
        # Wait for potential demo to start
        print("\n[*] Waiting 3 seconds for potential demo activation...")
        time.sleep(3)
        
        return True
        
    except Exception as e:
        print(f"[!] Test failed: {e}")
        return False
    finally:
        tester.cleanup()
        print("[*] Device disconnected")

if __name__ == "__main__":
    # Test the first parameter from our batch (most likely demo trigger)
    test_parameter("34121000", "Jensen magic + Command 10 (FIRST parameter from batch)")
    
    print("\n" + "="*50)
    print("PLEASE PROVIDE FEEDBACK:")
    print("="*50)
    print("Did you hear any demo audio or notice any changes?")
    print("- Audio demo about noise cancelling?") 
    print("- Any voice narration?")
    print("- LED pattern changes?")
    print("- Any other behavior?")
    print("\nThis was the FIRST parameter from our original batch test.")