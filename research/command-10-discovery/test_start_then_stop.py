#!/usr/bin/env python3
"""
Test Start Demo, Then Stop Demo
"""

from safe_testing_framework import SafeCommandTester
import time

def test_start_then_stop():
    """Start demo, wait for confirmation, then test stop"""
    print("STEP 1: Starting demo with Jensen magic parameter")
    print("="*50)
    
    tester = SafeCommandTester()
    
    try:
        if not tester.initialize_backend() or not tester.connect_device():
            print("[!] Connection failed")
            return
        
        print("[+] Connected")
        print("\n[1] Sending 34121000 (Jensen magic + Command 10) to start demo...")
        
        # Start demo
        start_param = bytes.fromhex("34121000")
        result = tester.safe_command_test(10, start_param, "Start demo")
        
        print(f"Start command response: {result.get('response', {}).get('body_hex', 'No response')}")
        print(f"Status: {result.get('status', 'Unknown')}")
        
        print("\n[*] Demo should be starting now...")
        print("PLEASE CONFIRM: Is the demo playing? (wait 3 seconds)")
        time.sleep(3)
        
    except Exception as e:
        print(f"[!] Failed: {e}")
    finally:
        tester.cleanup()
        print("\n[*] Disconnected")

if __name__ == "__main__":
    test_start_then_stop()
    
    print("\nFEEDBACK STEP 1:")
    print("Is the demo currently playing?")
    print("- If YES: Tell me and I'll send the stop command")  
    print("- If NO: Something went wrong with the start")