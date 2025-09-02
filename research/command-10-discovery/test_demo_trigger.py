#!/usr/bin/env python3
"""
Test Individual Command 10 Parameters to Find Demo Trigger

This script tests specific Command 10 parameters individually to determine
which one triggered the demo mode.
"""

import sys
import os
import time
from datetime import datetime

# Import our research modules
from safe_testing_framework import SafeCommandTester
from parameter_generators import ParameterGenerator

def test_single_parameter(param_hex, description):
    """Test a single parameter and wait for user feedback"""
    print(f"\n[*] TESTING: {description}")
    print(f"    Parameter: {param_hex}")
    print("    Waiting for device response...")
    
    tester = SafeCommandTester()
    
    try:
        # Initialize
        if not tester.initialize_backend():
            print("[!] Failed to initialize USB backend")
            return False
        
        if not tester.connect_device():
            print("[!] Failed to connect to device")
            return False
        
        print("[+] Device connected")
        
        # Convert hex string to bytes
        param_bytes = bytes.fromhex(param_hex)
        
        # Test the parameter
        result = tester.safe_command_test(10, param_bytes, description)
        
        print(f"[*] Command sent successfully")
        print(f"    Response: {result.get('response', {}).get('body_hex', 'No response')}")
        print(f"    Status: {result.get('status', 'Unknown')}")
        
        # Give time for any demo to start
        print("\n[?] Did this trigger the demo mode? (Listening for 5 seconds...)")
        time.sleep(5)
        
        response = input("Did you hear the demo audio? (y/N): ").lower()
        
        if response.startswith('y'):
            print(f"[SUCCESS] DEMO TRIGGER FOUND: {description}")
            print(f"          Parameter: {param_hex}")
            return True
        else:
            print("[*] No demo detected with this parameter")
            return False
        
    except Exception as e:
        print(f"[!] Test failed: {e}")
        return False
    finally:
        tester.cleanup()
        print("[*] Device disconnected\n")

def main():
    """Test candidate parameters individually"""
    print("="*60)
    print("COMMAND 10 DEMO MODE TRIGGER ANALYSIS")
    print("="*60)
    print("Testing individual parameters to find demo trigger...\n")
    
    # Most likely demo trigger candidates from our successful tests
    candidates = [
        ("4445425547", "DEBUG text"),
        ("41444d494e", "ADMIN text"), 
        ("34121000", "Jensen magic + Command 10"),
        ("0a000000", "Command 10, subcommand 0"),
        ("0a000100", "Command 10, subcommand 1"),
        ("01000000", "Query state 1"),
    ]
    
    print("Testing candidates in order of likelihood...\n")
    
    demo_triggers = []
    
    for param_hex, description in candidates:
        if test_single_parameter(param_hex, description):
            demo_triggers.append((param_hex, description))
        
        # Small delay between tests
        time.sleep(2)
    
    print("="*60)
    print("DEMO TRIGGER ANALYSIS RESULTS")
    print("="*60)
    
    if demo_triggers:
        print(f"[SUCCESS] Found {len(demo_triggers)} demo trigger(s):")
        for param_hex, description in demo_triggers:
            print(f"  [+] {description}: {param_hex}")
        
        print("\nRecommendations:")
        print("1. Document these parameters as demo mode activators")
        print("2. Investigate if different parameters trigger different demos")
        print("3. Test if demo mode unlocks additional functionality")
        print("4. Add demo mode support to main applications")
        
    else:
        print("[!] No individual demo triggers identified")
        print("    Demo may require combination of parameters or timing")
        print("    or may have been triggered by the batch testing sequence")
    
    print(f"\nDemo trigger analysis complete!")

if __name__ == "__main__":
    main()