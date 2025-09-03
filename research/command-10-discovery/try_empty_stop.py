#!/usr/bin/env python3
"""
Try Empty Parameter to Stop Demo
"""

from safe_testing_framework import SafeCommandTester

def try_empty_stop():
    """Try empty parameter to stop running demo"""
    print("TRYING EMPTY PARAMETER TO STOP DEMO")
    print("="*40)
    
    tester = SafeCommandTester()
    
    try:
        if not tester.initialize_backend() or not tester.connect_device():
            print("[!] Connection failed")
            return
        
        print("[+] Connected - sending EMPTY parameter to Command 10...")
        
        # Empty parameter (known to cause "controlled failure")
        result = tester.safe_command_test(10, b"", "Empty parameter stop")
        
        print(f"Response: {result.get('response', 'No response')}")
        print(f"Status: {result.get('status', 'Unknown')}")
        
    except Exception as e:
        print(f"[!] Failed: {e}")
    finally:
        tester.cleanup()

if __name__ == "__main__":
    try_empty_stop()