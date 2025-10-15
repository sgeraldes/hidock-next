#!/usr/bin/env python3
"""
HiDock H1E Firmware Binary Analysis Tool

This script analyzes firmware binary files to search for Jensen protocol command
references, USB protocol patterns, and other relevant structures.

Author: HiDock Hardware Analysis Project
Version: 1.0.0
Date: 2025-08-31
"""

import os
import re
import struct
from pathlib import Path

class FirmwareAnalyzer:
    def __init__(self, firmware_dir):
        self.firmware_dir = Path(firmware_dir)
        self.results = {}
        
    def extract_strings(self, binary_data, min_length=4):
        """Extract printable strings from binary data"""
        strings = []
        current = ""
        
        for byte in binary_data:
            if 32 <= byte <= 126:  # Printable ASCII
                current += chr(byte)
            else:
                if len(current) >= min_length:
                    strings.append(current)
                current = ""
                
        if len(current) >= min_length:
            strings.append(current)
            
        return strings
    
    def search_command_patterns(self, binary_data):
        """Search for Jensen protocol command patterns"""
        patterns = {
            'jensen_magic': b'\x12\x34',  # Jensen protocol magic number
            'command_handlers': [],
            'usb_descriptors': [],
            'version_strings': [],
            'command_tables': []
        }
        
        # Search for Jensen magic number
        magic_positions = []
        pos = 0
        while pos < len(binary_data):
            pos = binary_data.find(b'\x12\x34', pos)
            if pos == -1:
                break
            magic_positions.append(pos)
            pos += 1
            
        patterns['jensen_magic_positions'] = magic_positions[:20]  # Limit to first 20
        
        # Search for command ID sequences (1-20)
        command_sequences = []
        for i in range(1, 21):
            cmd_bytes = struct.pack('<H', i)  # Little endian 16-bit
            positions = []
            pos = 0
            while pos < len(binary_data):
                pos = binary_data.find(cmd_bytes, pos)
                if pos == -1:
                    break
                positions.append(pos)
                pos += 1
                if len(positions) >= 5:  # Limit results
                    break
            if positions:
                command_sequences.append((i, positions))
                
        patterns['command_sequences'] = command_sequences
        
        return patterns
    
    def search_strings(self, binary_data, keywords):
        """Search for specific keyword strings in binary"""
        strings = self.extract_strings(binary_data)
        matches = []
        
        for string in strings:
            for keyword in keywords:
                if keyword.lower() in string.lower():
                    matches.append(string)
                    break
                    
        return matches
    
    def analyze_partition(self, partition_file):
        """Analyze a single partition file"""
        print(f"\nAnalyzing {partition_file.name}...")
        
        try:
            with open(partition_file, 'rb') as f:
                binary_data = f.read()
                
            # Search for command patterns
            patterns = self.search_command_patterns(binary_data)
            
            # Search for relevant strings
            keywords = [
                'command', 'cmd', 'jensen', 'usb', 'protocol', 'handler',
                'device', 'hidock', 'endpoint', 'transfer', 'request',
                'response', 'version', 'firmware', 'dios', 'rome', 'zephyr'
            ]
            relevant_strings = self.search_strings(binary_data, keywords)
            
            results = {
                'file_size': len(binary_data),
                'jensen_magic_found': len(patterns['jensen_magic_positions']),
                'jensen_magic_positions': patterns['jensen_magic_positions'],
                'command_sequences': patterns['command_sequences'],
                'relevant_strings': relevant_strings[:50],  # Limit output
                'total_strings': len(self.extract_strings(binary_data))
            }
            
            return results
            
        except Exception as e:
            print(f"Error analyzing {partition_file.name}: {e}")
            return None
    
    def analyze_all_partitions(self):
        """Analyze all partition files"""
        partitions_dir = self.firmware_dir / "partitions"
        
        if not partitions_dir.exists():
            print(f"Partitions directory not found: {partitions_dir}")
            return
            
        partition_files = list(partitions_dir.glob("*.bin"))
        
        print(f"Found {len(partition_files)} partition files:")
        for pf in partition_files:
            print(f"  - {pf.name} ({pf.stat().st_size} bytes)")
            
        print("\n" + "="*60)
        print("FIRMWARE BINARY ANALYSIS")
        print("="*60)
        
        for partition_file in partition_files:
            result = self.analyze_partition(partition_file)
            if result:
                self.results[partition_file.name] = result
                self.display_partition_results(partition_file.name, result)
                
        self.display_summary()
    
    def display_partition_results(self, filename, results):
        """Display analysis results for a partition"""
        print(f"\n--- {filename} Results ---")
        print(f"File size: {results['file_size']:,} bytes")
        print(f"Total strings found: {results['total_strings']}")
        print(f"Jensen magic (0x1234) found: {results['jensen_magic_found']} times")
        
        if results['jensen_magic_positions']:
            print("Jensen magic positions (hex):", 
                  [f"0x{pos:x}" for pos in results['jensen_magic_positions'][:10]])
        
        if results['command_sequences']:
            print("Command ID sequences found:")
            for cmd_id, positions in results['command_sequences'][:10]:
                print(f"  Command {cmd_id}: {len(positions)} occurrences at {[f'0x{p:x}' for p in positions[:3]]}")
        
        if results['relevant_strings']:
            print("Relevant strings found:")
            for string in results['relevant_strings'][:15]:
                if len(string) > 60:
                    print(f"  '{string[:60]}...'")
                else:
                    print(f"  '{string}'")
    
    def display_summary(self):
        """Display analysis summary"""
        print("\n" + "="*60)
        print("ANALYSIS SUMMARY")
        print("="*60)
        
        total_magic = sum(r['jensen_magic_found'] for r in self.results.values())
        total_commands = sum(len(r['command_sequences']) for r in self.results.values())
        
        print(f"Total Jensen magic numbers found: {total_magic}")
        print(f"Total command sequences found: {total_commands}")
        
        # Find most promising partition
        best_partition = None
        best_score = 0
        
        for name, results in self.results.items():
            score = results['jensen_magic_found'] + len(results['command_sequences']) * 2
            if score > best_score:
                best_score = score
                best_partition = name
                
        if best_partition:
            print(f"Most promising partition: {best_partition} (score: {best_score})")
        
        # Consolidate all command findings
        all_commands = set()
        for results in self.results.values():
            for cmd_id, positions in results['command_sequences']:
                all_commands.add(cmd_id)
                
        if all_commands:
            print(f"Command IDs found in binaries: {sorted(all_commands)}")


def main():
    firmware_dir = r"E:\Code\hidock-next\firmware\hidock-h1e\6.2.5"
    
    print("HiDock H1E Firmware Binary Analysis")
    print("=" * 40)
    print(f"Analyzing firmware in: {firmware_dir}")
    
    analyzer = FirmwareAnalyzer(firmware_dir)
    analyzer.analyze_all_partitions()
    
    return 0

if __name__ == "__main__":
    import sys
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\n\nAnalysis interrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"\nUnexpected error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)