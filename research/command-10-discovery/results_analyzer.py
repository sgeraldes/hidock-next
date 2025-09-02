#!/usr/bin/env python3
"""
Results Analyzer for Command 10 Discovery

This script analyzes the JSON results from Command 10 discovery tests
and provides insights, pattern recognition, and recommendations.

Author: HiDock Research Project
Version: 1.0.0
Date: 2025-08-31
"""

import sys
import json
import os
import argparse
from datetime import datetime
from collections import Counter, defaultdict
from typing import Dict, List, Any, Optional

class DiscoveryResultsAnalyzer:
    """Analyze Command 10 discovery results for patterns and insights"""
    
    def __init__(self, results_file: str):
        self.results_file = results_file
        self.session_data = None
        self.test_results = []
        self.load_results()
    
    def load_results(self):
        """Load results from JSON file"""
        try:
            with open(self.results_file, 'r') as f:
                self.session_data = json.load(f)
            
            self.test_results = self.session_data.get('test_results', [])
            print(f"✅ Loaded {len(self.test_results)} test results from {self.results_file}")
            
        except FileNotFoundError:
            print(f"❌ Results file not found: {self.results_file}")
            sys.exit(1)
        except json.JSONDecodeError as e:
            print(f"❌ Invalid JSON in results file: {e}")
            sys.exit(1)
    
    def print_session_summary(self):
        """Print session summary information"""
        session_info = self.session_data.get('session_info', {})
        
        print("\n" + "="*60)
        print("SESSION SUMMARY")
        print("="*60)
        
        print(f"Session ID: {session_info.get('session_id', 'Unknown')}")
        print(f"Start Time: {session_info.get('start_time', 'Unknown')}")
        print(f"End Time: {session_info.get('end_time', 'Unknown')}")
        print(f"Total Tests: {session_info.get('total_tests', 0)}")
        print(f"Recovery Attempts: {session_info.get('recovery_attempts', 0)}")
    
    def analyze_response_patterns(self):
        """Analyze response patterns and statistics"""
        print("\n" + "="*60)
        print("RESPONSE PATTERN ANALYSIS")
        print("="*60)
        
        # Status distribution
        status_counts = Counter(result['status'] for result in self.test_results)
        
        print("Response Status Distribution:")
        for status, count in status_counts.most_common():
            percentage = (count / len(self.test_results)) * 100
            print(f"  {status}: {count} ({percentage:.1f}%)")
        
        # Response time analysis
        response_times = [r['response_time'] for r in self.test_results if r['response_time'] > 0]
        if response_times:
            print(f"\nResponse Time Statistics:")
            print(f"  Average: {sum(response_times)/len(response_times):.3f}s")
            print(f"  Min: {min(response_times):.3f}s")
            print(f"  Max: {max(response_times):.3f}s")
        
        # Recovery analysis
        recovery_needed = len([r for r in self.test_results if r.get('recovery_required', False)])
        if recovery_needed > 0:
            print(f"\nDevice Recovery Analysis:")
            print(f"  Tests requiring recovery: {recovery_needed}")
            print(f"  Recovery rate: {(recovery_needed/len(self.test_results))*100:.1f}%")
    
    def find_successful_responses(self):
        """Find and analyze successful responses"""
        successful_tests = [r for r in self.test_results if r['status'] == 'success']
        
        print("\n" + "="*60)
        print("SUCCESSFUL RESPONSES ANALYSIS")
        print("="*60)
        
        if not successful_tests:
            print("❌ No successful responses found")
            return
        
        print(f"🎉 Found {len(successful_tests)} successful responses!")
        
        for i, result in enumerate(successful_tests):
            print(f"\n--- Success #{i+1} ---")
            print(f"Description: {result['description']}")
            print(f"Parameters: {result['parameters']} ({result['parameter_length']} bytes)")
            print(f"Response Time: {result['response_time']:.3f}s")
            
            response = result.get('response')
            if response:
                print(f"Response Type: {response.get('type', 'unknown')}")
                print(f"Command ID: {response.get('command_id', 'unknown')}")
                print(f"Sequence: {response.get('sequence', 'unknown')}")
                print(f"Body Length: {response.get('body_length', 0)}")
                
                if response.get('body_hex'):
                    print(f"Body Data: {response['body_hex']}")
                if response.get('body_ascii'):
                    print(f"Body ASCII: {response['body_ascii']}")
    
    def analyze_error_patterns(self):
        """Analyze error patterns for insights"""
        error_tests = [r for r in self.test_results if r['status'] == 'error']
        
        print("\n" + "="*60)
        print("ERROR PATTERN ANALYSIS")
        print("="*60)
        
        if not error_tests:
            print("ℹ️  No error responses found")
            return
        
        print(f"Found {len(error_tests)} error responses")
        
        # Group errors by type
        error_groups = defaultdict(list)
        for result in error_tests:
            error_msg = result.get('error', 'Unknown error')
            # Group similar errors
            if 'timeout' in error_msg.lower():
                error_groups['Timeout'].append(result)
            elif 'health check' in error_msg.lower():
                error_groups['Health Check Failed'].append(result)
            elif 'connection' in error_msg.lower():
                error_groups['Connection Error'].append(result)
            else:
                error_groups['Other'].append(result)
        
        print("\nError Categories:")
        for error_type, results in error_groups.items():
            print(f"  {error_type}: {len(results)} occurrences")
            
            # Show examples
            for result in results[:3]:  # Show first 3 examples
                print(f"    - {result['description']}: {result['error']}")
        
        # Analyze parameters that cause device failures
        recovery_tests = [r for r in error_tests if r.get('recovery_required', False)]
        if recovery_tests:
            print(f"\nParameters causing device recovery ({len(recovery_tests)} cases):")
            for result in recovery_tests[:5]:  # Show first 5
                print(f"  - {result['description']}")
                print(f"    Parameters: {result['parameters']}")
    
    def analyze_parameter_patterns(self):
        """Analyze parameter patterns and effectiveness"""
        print("\n" + "="*60)
        print("PARAMETER PATTERN ANALYSIS")
        print("="*60)
        
        # Group by parameter length
        length_groups = defaultdict(list)
        for result in self.test_results:
            length = result['parameter_length']
            length_groups[length].append(result)
        
        print("Results by Parameter Length:")
        for length in sorted(length_groups.keys()):
            results = length_groups[length]
            success_count = len([r for r in results if r['status'] == 'success'])
            print(f"  {length} bytes: {len(results)} tests, {success_count} successful ({(success_count/len(results))*100:.1f}%)")
        
        # Analyze parameter content patterns
        print("\nParameter Content Analysis:")
        
        # Look for patterns in successful parameters
        successful_tests = [r for r in self.test_results if r['status'] == 'success']
        if successful_tests:
            print("  Successful parameter patterns:")
            for result in successful_tests:
                params = result['parameters']
                print(f"    - Length {len(params)}: {params} ({result['description']})")
        
        # Look for patterns in parameters that don't require recovery
        safe_tests = [r for r in self.test_results if not r.get('recovery_required', False)]
        dangerous_tests = [r for r in self.test_results if r.get('recovery_required', False)]
        
        print(f"\nSafety Analysis:")
        print(f"  Safe parameters (no recovery needed): {len(safe_tests)}")
        print(f"  Dangerous parameters (recovery needed): {len(dangerous_tests)}")
        
        if dangerous_tests:
            print("  Dangerous parameter patterns:")
            for result in dangerous_tests[:3]:
                print(f"    - {result['description']}: {result['parameters']}")
    
    def generate_recommendations(self):
        """Generate recommendations based on analysis"""
        print("\n" + "="*60)
        print("RECOMMENDATIONS AND NEXT STEPS")
        print("="*60)
        
        successful_tests = [r for r in self.test_results if r['status'] == 'success']
        error_tests = [r for r in self.test_results if r['status'] == 'error']
        recovery_tests = [r for r in self.test_results if r.get('recovery_required', False)]
        
        if successful_tests:
            print("🎉 BREAKTHROUGH DETECTED!")
            print("Command 10 responded successfully to some parameters.")
            print("Immediate recommendations:")
            print("  1. Analyze successful parameter patterns for common elements")
            print("  2. Test variations of successful parameters")
            print("  3. Document the functionality unlocked by successful parameters")
            print("  4. Test successful parameters in different device states")
            
        elif len([r for r in error_tests if not r.get('recovery_required', False)]) > 0:
            print("🔍 INTERESTING ERROR PATTERNS DETECTED!")
            print("Some parameters caused errors without device recovery.")
            print("Recommendations:")
            print("  1. Focus on parameters that cause 'safe' errors")
            print("  2. These may indicate partial authentication or wrong subcommands")
            print("  3. Try variations of parameters that cause interesting errors")
            
        else:
            print("📊 NO BREAKTHROUGH YET - but valuable data collected")
            print("Recommendations:")
            print("  1. Command 10 likely requires specific authentication")
            print("  2. Try testing in different device states:")
            print("     - After firmware update preparation (Command 8)")
            print("     - During/after file operations")
            print("     - With device in different settings states")
            print("  3. Consider timing-based approaches:")
            print("     - Send Command 10 immediately after other commands")
            print("     - Try specific timing sequences")
        
        # Parameter length recommendations
        length_success = defaultdict(int)
        length_total = defaultdict(int)
        
        for result in self.test_results:
            length = result['parameter_length']
            length_total[length] += 1
            if result['status'] == 'success':
                length_success[length] += 1
        
        print(f"\nParameter Length Recommendations:")
        for length in sorted(length_total.keys()):
            success_rate = (length_success[length] / length_total[length]) * 100
            print(f"  {length} bytes: {success_rate:.1f}% success rate ({length_success[length]}/{length_total[length]})")
        
        # Recovery pattern warnings
        if recovery_tests:
            print(f"\n⚠️  Device Recovery Warnings:")
            print(f"  {len(recovery_tests)} parameter combinations caused device failures")
            print("  Avoid similar patterns in future testing:")
            
            recovery_lengths = Counter(r['parameter_length'] for r in recovery_tests)
            for length, count in recovery_lengths.most_common(3):
                print(f"    - {length}-byte parameters: {count} failures")
    
    def export_detailed_report(self, output_file: str = None):
        """Export detailed analysis report"""
        if output_file is None:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            output_file = f"command_10_analysis_report_{timestamp}.txt"
        
        output_path = os.path.join(os.path.dirname(self.results_file), output_file)
        
        try:
            with open(output_path, 'w') as f:
                # Redirect stdout to file
                original_stdout = sys.stdout
                sys.stdout = f
                
                # Generate full report
                self.print_session_summary()
                self.analyze_response_patterns()
                self.find_successful_responses()
                self.analyze_error_patterns()
                self.analyze_parameter_patterns()
                self.generate_recommendations()
                
                # Restore stdout
                sys.stdout = original_stdout
            
            print(f"📄 Detailed analysis report exported to: {output_path}")
            return output_path
            
        except Exception as e:
            print(f"❌ Failed to export report: {e}")
            return None

def main():
    """Main analysis script"""
    parser = argparse.ArgumentParser(description='Analyze Command 10 discovery results')
    parser.add_argument('results_file', nargs='?', 
                       help='JSON results file to analyze')
    parser.add_argument('--export', '-e', action='store_true',
                       help='Export detailed report to file')
    
    args = parser.parse_args()
    
    # Find results file if not specified
    if not args.results_file:
        results_dir = os.path.dirname(__file__)
        json_files = [f for f in os.listdir(results_dir) if f.endswith('.json')]
        
        if not json_files:
            print("❌ No results files found in research directory")
            print("   Run command_10_systematic_discovery.py first")
            return
        
        if len(json_files) == 1:
            args.results_file = os.path.join(results_dir, json_files[0])
            print(f"📂 Auto-selected results file: {json_files[0]}")
        else:
            print("📂 Multiple results files found:")
            for i, filename in enumerate(json_files):
                print(f"  {i+1}. {filename}")
            
            while True:
                try:
                    choice = int(input("Select file (number): ")) - 1
                    if 0 <= choice < len(json_files):
                        args.results_file = os.path.join(results_dir, json_files[choice])
                        break
                    else:
                        print("Invalid selection")
                except ValueError:
                    print("Please enter a number")
    
    print("\n" + "="*60)
    print("COMMAND 10 DISCOVERY RESULTS ANALYSIS")
    print("="*60)
    print(f"Analyzing: {os.path.basename(args.results_file)}")
    
    # Perform analysis
    analyzer = DiscoveryResultsAnalyzer(args.results_file)
    
    # Run all analyses
    analyzer.print_session_summary()
    analyzer.analyze_response_patterns()
    analyzer.find_successful_responses()
    analyzer.analyze_error_patterns()
    analyzer.analyze_parameter_patterns()
    analyzer.generate_recommendations()
    
    # Export detailed report if requested
    if args.export:
        report_file = analyzer.export_detailed_report()
        if report_file:
            print(f"\n📄 Full analysis report saved to: {os.path.basename(report_file)}")
    
    print("\n" + "="*60)
    print("ANALYSIS COMPLETE")
    print("="*60)

if __name__ == "__main__":
    main()