#!/usr/bin/env python3
"""
Command 10 Systematic Discovery Script (Console-Safe Version)

This script performs systematic parameter discovery for Command 10
using the safe testing framework and parameter generators.

Usage:
    python command_10_discovery_console.py [mode]
    
Modes:
    focused   - Quick focused discovery (default)
    full      - Comprehensive parameter exploration
    custom    - Custom parameter testing

Author: HiDock Research Project
Version: 1.0.0
Date: 2025-08-31
"""

import sys
import os
import time
import argparse
from datetime import datetime

# Import our research modules
from safe_testing_framework import SafeCommandTester
from parameter_generators import ParameterGenerator

def print_banner():
    """Print research banner"""
    print("""
================================================================
                Command 10 Parameter Discovery                
                     Research Project                         
================================================================
                                                              
  Purpose: Systematic exploration of Command 10 parameters   
           to unlock hidden HiDock functionality             
                                                              
  Status:  RESEARCH PHASE - Isolated from main codebase      
  Risk:    LOW - Command 10 has built-in protection          
                                                              
================================================================
""")

def run_focused_discovery():
    """Run focused discovery with high-priority parameters"""
    print("\n[*] FOCUSED DISCOVERY MODE")
    print("Testing high-probability parameter combinations...")
    
    tester = SafeCommandTester()
    generator = ParameterGenerator()
    
    try:
        # Initialize
        if not tester.initialize_backend():
            print("[!] Failed to initialize USB backend")
            return False
        
        if not tester.connect_device():
            print("[!] Failed to connect to device")
            return False
        
        print("[+] Device connected and ready")
        
        # Generate focused parameter set
        parameters = generator.generate_focused_discovery()
        print(f"\n[*] Generated {len(parameters)} focused test parameters")
        
        print("\n" + "="*60)
        print("STARTING FOCUSED PARAMETER DISCOVERY")
        print("="*60)
        
        # Run tests
        results = tester.run_parameter_test_batch(10, parameters)
        
        # Analyze results
        successful_tests = [r for r in results if r['status'] == 'success']
        
        print("\n" + "="*60)
        print("FOCUSED DISCOVERY RESULTS")
        print("="*60)
        
        if successful_tests:
            print(f"[SUCCESS] Found {len(successful_tests)} working parameter combinations:")
            for result in successful_tests:
                print(f"  [+] {result['description']}")
                print(f"     Parameters: {result['parameters']}")
                print(f"     Response: {result['response']}")
                print(f"     Time: {result['response_time']:.2f}s")
                print()
        else:
            print("[!] No successful responses found in focused discovery")
            print("   Recommendation: Try full discovery mode")
        
        # Save results
        result_file = tester.save_results("focused_discovery_results.json")
        print(f"[*] Detailed results saved to: {result_file}")
        
        # Print summary
        print("\n" + tester.generate_summary_report())
        
        return len(successful_tests) > 0
        
    except KeyboardInterrupt:
        print("\n\n[!] Discovery interrupted by user")
        return False
    except Exception as e:
        print(f"\n[!] Discovery failed: {e}")
        return False
    finally:
        tester.cleanup()

def run_full_discovery():
    """Run comprehensive parameter exploration"""
    print("\n[*] FULL DISCOVERY MODE")
    print("Comprehensive parameter exploration - this may take a while...")
    
    # Confirm with user
    print("\n[!] Warning: Full discovery will test 100+ parameter combinations")
    print("   This could take 15-30 minutes to complete.")
    
    response = input("Continue with full discovery? (y/N): ")
    if not response.lower().startswith('y'):
        print("Full discovery cancelled")
        return False
    
    tester = SafeCommandTester()
    generator = ParameterGenerator()
    
    try:
        # Initialize
        if not tester.initialize_backend():
            print("[!] Failed to initialize USB backend")
            return False
        
        if not tester.connect_device():
            print("[!] Failed to connect to device")
            return False
        
        print("[+] Device connected and ready")
        
        # Generate comprehensive parameter set
        parameters = generator.generate_systematic_exploration(max_params=100)
        print(f"\n[*] Generated {len(parameters)} comprehensive test parameters")
        
        print(f"\n[*] Estimated time: {len(parameters) * 3} seconds ({len(parameters) * 3 / 60:.1f} minutes)")
        
        print("\n" + "="*60)
        print("STARTING COMPREHENSIVE PARAMETER DISCOVERY")
        print("="*60)
        
        # Run tests
        results = tester.run_parameter_test_batch(10, parameters)
        
        # Analyze results
        successful_tests = [r for r in results if r['status'] == 'success']
        interesting_errors = [r for r in results if r['status'] == 'error' and not r['recovery_required']]
        
        print("\n" + "="*60)
        print("COMPREHENSIVE DISCOVERY RESULTS")
        print("="*60)
        
        if successful_tests:
            print(f"[SUCCESS] Found {len(successful_tests)} working parameter combinations:")
            for result in successful_tests:
                print(f"  [+] {result['description']}")
                print(f"     Parameters: {result['parameters']}")
                print(f"     Response: {result['response']}")
                print(f"     Time: {result['response_time']:.2f}s")
                print()
        
        if interesting_errors:
            print(f"[*] Found {len(interesting_errors)} interesting error responses:")
            for result in interesting_errors[:10]:  # Limit to first 10
                print(f"  [~] {result['description']}")
                print(f"     Error: {result['error']}")
                print()
        
        if not successful_tests and not interesting_errors:
            print("[!] No successful responses or interesting errors found")
        
        # Save results
        result_file = tester.save_results("full_discovery_results.json")
        print(f"[*] Detailed results saved to: {result_file}")
        
        # Print summary
        print("\n" + tester.generate_summary_report())
        
        return len(successful_tests) > 0
        
    except KeyboardInterrupt:
        print("\n\n[!] Discovery interrupted by user")
        return False
    except Exception as e:
        print(f"\n[!] Discovery failed: {e}")
        return False
    finally:
        tester.cleanup()

def run_custom_discovery():
    """Run custom parameter testing"""
    print("\n[*] CUSTOM DISCOVERY MODE")
    print("Enter custom parameters to test...")
    
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
        
        custom_params = []
        
        print("\nEnter parameters to test (one per line)")
        print("Formats supported:")
        print("  - Hex: 0x1234ABCD or 1234ABCD")
        print("  - Text: Hello or 'Hello World'")
        print("  - Empty line to finish")
        print()
        
        while True:
            try:
                param_input = input("Parameter: ").strip()
                
                if not param_input:
                    break
                
                # Parse parameter input
                if param_input.startswith('0x'):
                    # Hex input
                    hex_str = param_input[2:]
                    if len(hex_str) % 2 != 0:
                        hex_str = '0' + hex_str
                    params = bytes.fromhex(hex_str)
                    desc = f"Custom hex: {param_input}"
                    
                elif param_input.startswith("'") and param_input.endswith("'"):
                    # Quoted text
                    params = param_input[1:-1].encode('utf-8')
                    desc = f"Custom text: {param_input[1:-1]}"
                    
                elif all(c in '0123456789ABCDEFabcdef' for c in param_input):
                    # Hex without 0x prefix
                    if len(param_input) % 2 != 0:
                        param_input = '0' + param_input
                    params = bytes.fromhex(param_input)
                    desc = f"Custom hex: 0x{param_input.upper()}"
                    
                else:
                    # Plain text
                    params = param_input.encode('utf-8')
                    desc = f"Custom text: {param_input}"
                
                custom_params.append((params, desc))
                print(f"  Added: {desc} ({len(params)} bytes)")
                
            except ValueError as e:
                print(f"  [!] Invalid format: {e}")
                continue
            except KeyboardInterrupt:
                break
        
        if not custom_params:
            print("No custom parameters entered")
            return False
        
        print(f"\n[*] Testing {len(custom_params)} custom parameters")
        
        print("\n" + "="*60)
        print("STARTING CUSTOM PARAMETER DISCOVERY")
        print("="*60)
        
        # Run tests
        results = tester.run_parameter_test_batch(10, custom_params)
        
        # Analyze results
        successful_tests = [r for r in results if r['status'] == 'success']
        
        print("\n" + "="*60)
        print("CUSTOM DISCOVERY RESULTS")
        print("="*60)
        
        if successful_tests:
            print(f"[SUCCESS] Found {len(successful_tests)} working parameter combinations:")
            for result in successful_tests:
                print(f"  [+] {result['description']}")
                print(f"     Parameters: {result['parameters']}")
                print(f"     Response: {result['response']}")
                print(f"     Time: {result['response_time']:.2f}s")
                print()
        else:
            print("[!] No successful responses found in custom testing")
        
        # Save results
        result_file = tester.save_results("custom_discovery_results.json")
        print(f"[*] Detailed results saved to: {result_file}")
        
        # Print summary
        print("\n" + tester.generate_summary_report())
        
        return len(successful_tests) > 0
        
    except KeyboardInterrupt:
        print("\n\n[!] Discovery interrupted by user")
        return False
    except Exception as e:
        print(f"\n[!] Discovery failed: {e}")
        return False
    finally:
        tester.cleanup()

def main():
    """Main discovery script"""
    parser = argparse.ArgumentParser(description='Command 10 Parameter Discovery')
    parser.add_argument('mode', nargs='?', default='focused', 
                       choices=['focused', 'full', 'custom'],
                       help='Discovery mode (default: focused)')
    
    args = parser.parse_args()
    
    print_banner()
    
    print(f"[*] Starting Command 10 discovery in '{args.mode}' mode...")
    print(f"[*] Start time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    
    # Safety warning
    print("\n" + "[!] "*20)
    print("SAFETY NOTICE:")
    print("- This research tests Command 10 with various parameters")
    print("- Command 10 has built-in protection (safe failure mechanism)")
    print("- Device recovery is automatic if needed")
    print("- All testing is isolated from main application")
    print("- Results are saved for analysis")
    print("[!] "*20)
    
    response = input("\nProceed with Command 10 discovery? (y/N): ")
    if not response.lower().startswith('y'):
        print("Discovery cancelled")
        return
    
    start_time = time.time()
    success = False
    
    try:
        if args.mode == 'focused':
            success = run_focused_discovery()
        elif args.mode == 'full':
            success = run_full_discovery()
        elif args.mode == 'custom':
            success = run_custom_discovery()
        
    except Exception as e:
        print(f"\n[!] Unexpected error: {e}")
        import traceback
        traceback.print_exc()
    
    elapsed_time = time.time() - start_time
    
    print("\n" + "="*60)
    print("DISCOVERY SESSION COMPLETE")
    print("="*60)
    print(f"[*] Duration: {elapsed_time:.1f} seconds ({elapsed_time/60:.1f} minutes)")
    print(f"[*] Result: {'SUCCESS - Command 10 responded!' if success else 'No successful responses found'}")
    
    if success:
        print("\n[SUCCESS] BREAKTHROUGH! Command 10 functionality discovered!")
        print("   Check the detailed results file for response analysis")
        print("   This could unlock significant hidden functionality")
    else:
        print("\n[*] No immediate success, but valuable data collected:")
        print("   - Confirmed Command 10 protection mechanisms")
        print("   - Mapped parameter response patterns")  
        print("   - Identified potential authentication requirements")
        print("   - Consider trying different device states or timing")
    
    print(f"\n[*] Results saved in: {os.path.dirname(__file__)}")
    print("   Use results_analyzer.py to analyze findings in detail")

if __name__ == "__main__":
    main()