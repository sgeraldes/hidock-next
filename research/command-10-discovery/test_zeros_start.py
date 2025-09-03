#!/usr/bin/env python3
"""
Test if 00000000 (all zeros) starts the demo
"""

from safe_testing_framework import SafeCommandTester

def test_zeros_start():
    """Test if all zeros parameter starts demo"""
    print("TESTING: 00000000 (all zeros) as demo starter")
    print("="*45)
    
    tester = SafeCommandTester()
    
    try:
        if not tester.initialize_backend() or not tester.connect_device():
            print("[!] Connection failed")
            return
        
        print("[+] Connected - sending 00000000 to Command 10...")
        
        # All zeros parameter
        param_bytes = bytes.fromhex("00000000")
        result = tester.safe_command_test(10, param_bytes, "All zeros test")
        
        print(f"Response: {result.get('response', {}).get('body_hex', 'No response')}")
        print(f"Status: {result.get('status', 'Unknown')}")
        
        print("\n[*] Waiting 3 seconds for potential demo...")
        import time
        time.sleep(3)
        
    except Exception as e:
        print(f"[!] Failed: {e}")
    finally:
        tester.cleanup()
        print("[*] Disconnected")

if __name__ == "__main__":
    test_zeros_start()
    
    print("\nFEEDBACK NEEDED:")
    print("Did the demo start with 00000000?")
    print("- Audio about dual core neural processors?")
    print("- Any other behavior?")