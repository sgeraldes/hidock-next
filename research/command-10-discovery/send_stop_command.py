#!/usr/bin/env python3
"""
Send ONLY the stop command to running demo
"""

from safe_testing_framework import SafeCommandTester

def send_stop_command():
    """Send only the stop command to running demo"""
    print("STEP 2: Sending STOP command to running demo")
    print("="*45)
    
    tester = SafeCommandTester()
    
    try:
        if not tester.initialize_backend() or not tester.connect_device():
            print("[!] Connection failed")
            return
        
        print("[+] Connected - demo should be playing")
        print("\n[2] Sending ONLY 00000000 (all zeros) as STOP command...")
        
        # Send stop command
        stop_param = bytes.fromhex("00000000")
        result = tester.safe_command_test(10, stop_param, "Stop command")
        
        print(f"Stop command response: {result.get('response', {}).get('body_hex', 'No response')}")
        print(f"Status: {result.get('status', 'Unknown')}")
        
        print("\n[*] Stop command sent!")
        
    except Exception as e:
        print(f"[!] Failed: {e}")
    finally:
        tester.cleanup()
        print("[*] Disconnected")

if __name__ == "__main__":
    send_stop_command()
    
    print("\nFEEDBACK STEP 2:")
    print("Did the 00000000 command stop the demo?")
    print("- Stopped immediately and permanently?")  
    print("- Stopped temporarily then restarted?")
    print("- Had no effect?")
    print("- Any other behavior?")