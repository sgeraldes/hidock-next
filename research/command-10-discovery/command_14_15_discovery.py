#!/usr/bin/env python3
"""
Command 14 & 15 Systematic Discovery Script

Building on the success of Command 10 discovery, this script tests Commands 14 and 15
with systematic parameter combinations to discover any hidden functionality.

Author: HiDock Research Project
Version: 1.0.0
Date: 2025-08-31
"""

import sys
import os
import time
from safe_testing_framework import SafeCommandTester
from parameter_generators import ParameterGenerator

def test_command_with_parameters(command_id, parameters, tester):
    """Test a specific command with parameter list"""
    print(f"\n{'='*60}")
    print(f"TESTING COMMAND {command_id}")
    print(f"{'='*60}")
    
    results = []
    
    for i, (param_bytes, description) in enumerate(parameters, 1):
        print(f"\nTest {i}/{len(parameters)}: {description}")
        print(f"Parameters: {param_bytes.hex() if param_bytes else '(empty)'} ({len(param_bytes)} bytes)")
        
        try:
            result = tester.safe_command_test(command_id, param_bytes, description)
            
            success = result['status'] == 'success'
            response = result.get('response', {}).get('body_hex', 'No response')
            response_time = result.get('response_time', 0)
            
            print(f"Response: {response}")
            print(f"Status: {result['status']}")
            print(f"Time: {response_time:.3f}s")
            
            # Check for interesting responses (anything other than empty)
            if success and response != '':
                print(f"🔍 INTERESTING: Non-empty response detected!")
            
            results.append({
                'command': command_id,
                'parameters': param_bytes.hex() if param_bytes else '',
                'parameter_length': len(param_bytes),
                'description': description,
                'response': response,
                'status': result['status'],
                'response_time': response_time,
                'interesting': success and response != ''
            })
            
        except Exception as e:
            print(f"❌ Test failed: {e}")
            results.append({
                'command': command_id,
                'parameters': param_bytes.hex() if param_bytes else '',
                'parameter_length': len(param_bytes),
                'description': description,
                'response': 'ERROR',
                'status': 'error',
                'error': str(e),
                'response_time': 0,
                'interesting': False
            })
        
        # Small delay between tests
        time.sleep(1)
    
    return results

def analyze_results(results):
    """Analyze test results for patterns"""
    print(f"\n{'='*60}")
    print("RESULTS ANALYSIS")
    print(f"{'='*60}")
    
    successful = [r for r in results if r['status'] == 'success']
    interesting = [r for r in results if r.get('interesting', False)]
    
    print(f"Total Tests: {len(results)}")
    print(f"Successful: {len(successful)} ({len(successful)/len(results)*100:.1f}%)")
    print(f"Interesting Responses: {len(interesting)}")
    
    if interesting:
        print(f"\n🔍 INTERESTING RESPONSES FOUND:")
        for result in interesting:
            print(f"  Command {result['command']}: {result['description']}")
            print(f"    Parameters: {result['parameters']}")
            print(f"    Response: {result['response']}")
            print(f"    Time: {result['response_time']:.3f}s")
            print()
    
    # Check for different response patterns
    responses = {}
    for result in successful:
        resp = result['response']
        if resp not in responses:
            responses[resp] = []
        responses[resp].append(result)
    
    print(f"\nResponse Patterns:")
    for response, results_list in responses.items():
        print(f"  '{response}': {len(results_list)} occurrences")
        if len(results_list) <= 3:  # Show examples for small groups
            for r in results_list:
                print(f"    - {r['description']}")
    
    return interesting

def main():
    """Main discovery script for Commands 14 & 15"""
    print("="*60)
    print("COMMAND 14 & 15 SYSTEMATIC DISCOVERY")
    print("="*60)
    print("Building on Command 10 success methodology")
    print("Testing focused parameter combinations...")
    
    tester = SafeCommandTester()
    generator = ParameterGenerator()
    
    try:
        # Initialize connection
        if not tester.initialize_backend():
            print("❌ Failed to initialize USB backend")
            return
        
        if not tester.connect_device():
            print("❌ Failed to connect to device")
            return
        
        print("✅ Device connected and ready")
        
        # Generate focused parameter set (same as Command 10 discovery)
        parameters = generator.generate_focused_discovery()
        print(f"\n📋 Generated {len(parameters)} focused test parameters")
        
        print(f"\n⏱️ Estimated time: {len(parameters) * 2 * 2} seconds for both commands")
        
        response = input("\nProceed with Commands 14 & 15 discovery? (y/N): ")
        if not response.lower().startswith('y'):
            print("Discovery cancelled")
            return
        
        all_results = []
        
        # Test Command 14
        print(f"\n🔍 STARTING COMMAND 14 DISCOVERY")
        cmd14_results = test_command_with_parameters(14, parameters, tester)
        all_results.extend(cmd14_results)
        
        # Test Command 15  
        print(f"\n🔍 STARTING COMMAND 15 DISCOVERY")
        cmd15_results = test_command_with_parameters(15, parameters, tester)
        all_results.extend(cmd15_results)
        
        # Analyze combined results
        print(f"\n🧠 ANALYZING COMBINED RESULTS")
        interesting_results = analyze_results(all_results)
        
        # Save results
        import json
        from datetime import datetime
        
        results_data = {
            'session_info': {
                'timestamp': datetime.now().isoformat(),
                'commands_tested': [14, 15],
                'total_tests': len(all_results),
                'parameters_per_command': len(parameters)
            },
            'results': all_results,
            'interesting_count': len(interesting_results)
        }
        
        results_file = "command_14_15_discovery_results.json"
        with open(results_file, 'w') as f:
            json.dump(results_data, f, indent=2)
        
        print(f"\n📁 Results saved to: {results_file}")
        
        # Summary
        print(f"\n{'='*60}")
        print("DISCOVERY SUMMARY")
        print(f"{'='*60}")
        
        cmd14_interesting = [r for r in cmd14_results if r.get('interesting', False)]
        cmd15_interesting = [r for r in cmd15_results if r.get('interesting', False)]
        
        print(f"Command 14: {len(cmd14_interesting)} interesting responses")
        print(f"Command 15: {len(cmd15_interesting)} interesting responses")
        
        if interesting_results:
            print(f"\n🎉 POTENTIAL BREAKTHROUGH: Found {len(interesting_results)} interesting responses!")
            print("   Check detailed results for analysis")
        else:
            print(f"\n📊 No breakthrough discovered, but valuable data collected:")
            print("   - Confirmed Commands 14 & 15 behavior patterns") 
            print("   - Mapped parameter response characteristics")
            print("   - Validated safe operation across parameter space")
        
    except KeyboardInterrupt:
        print(f"\n\n⏹️ Discovery interrupted by user")
    except Exception as e:
        print(f"\n❌ Discovery failed: {e}")
        import traceback
        traceback.print_exc()
    finally:
        tester.cleanup()
        print("✅ Device disconnected")

if __name__ == "__main__":
    main()