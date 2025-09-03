#!/usr/bin/env python3
"""
Deep Command Analysis - Commands 10, 14, 15

This script performs targeted reverse engineering to understand the actual
function of commands 10, 14, and 15 based on firmware analysis.

Author: HiDock Hardware Analysis Project
Version: 1.0.0  
Date: 2025-08-31
"""

import struct
import re
from pathlib import Path

class DeepCommandAnalyzer:
    def __init__(self, zephyr_path):
        self.zephyr_path = Path(zephyr_path)
        with open(self.zephyr_path, 'rb') as f:
            self.binary_data = f.read()
    
    def extract_strings_around_offset(self, offset, radius=200):
        """Extract printable strings around a specific offset"""
        start = max(0, offset - radius)
        end = min(len(self.binary_data), offset + radius)
        region = self.binary_data[start:end]
        
        strings = []
        current = ""
        
        for i, byte in enumerate(region):
            if 32 <= byte <= 126:  # Printable ASCII
                current += chr(byte)
            else:
                if len(current) >= 3:
                    abs_offset = start + i - len(current)
                    strings.append((abs_offset, current))
                current = ""
                
        if len(current) >= 3:
            abs_offset = start + len(region) - len(current) 
            strings.append((abs_offset, current))
            
        return strings
    
    def find_command_context(self, cmd_id):
        """Find context around command ID occurrences to understand function"""
        print(f"\n=== DEEP ANALYSIS: Command {cmd_id} ===")
        
        # Find all occurrences of command ID
        cmd_bytes = struct.pack('<H', cmd_id)
        positions = []
        pos = 0
        
        while pos < len(self.binary_data):
            pos = self.binary_data.find(cmd_bytes, pos)
            if pos == -1:
                break
            positions.append(pos)
            pos += 1
        
        print(f"Found {len(positions)} occurrences of command {cmd_id}")
        
        # Analyze each occurrence
        for i, pos in enumerate(positions[:5]):  # Limit to first 5
            print(f"\n--- Occurrence {i+1} at 0x{pos:x} ---")
            
            # Get wider context for analysis
            context_start = max(0, pos - 100)
            context_end = min(len(self.binary_data), pos + 100)
            context = self.binary_data[context_start:context_end]
            
            # Look for strings near this command
            nearby_strings = self.extract_strings_around_offset(pos, 150)
            if nearby_strings:
                print("Nearby strings:")
                for str_offset, string in nearby_strings:
                    if len(string) >= 4 and len(string) <= 50:
                        distance = abs(str_offset - pos)
                        print(f"  +{distance:3d}: '{string}'")
            
            # Look for potential function patterns
            self.analyze_function_context(pos, context_start, context)
    
    def analyze_function_context(self, abs_pos, context_start, context):
        """Analyze if this command appears in a function context"""
        rel_pos = abs_pos - context_start
        
        # Look for ARM Thumb function patterns before this position
        patterns = [
            (b'\x00\xb5', "push {lr}"),
            (b'\x10\xb5', "push {r4, lr}"), 
            (b'\x30\xb5', "push {r4, r5, lr}"),
            (b'\xf0\xb5', "push {r4-r7, lr}"),
            (b'\x00\xbd', "pop {pc}"),
            (b'\x10\xbd', "pop {r4, pc}"),
        ]
        
        function_indicators = []
        for pattern, desc in patterns:
            pos = context.find(pattern)
            if pos != -1 and pos < rel_pos:
                distance = rel_pos - pos
                if distance < 50:  # Within reasonable function size
                    function_indicators.append((distance, desc))
        
        if function_indicators:
            print("Function patterns nearby:")
            for distance, desc in sorted(function_indicators):
                print(f"  -{distance:2d}: {desc}")
    
    def search_command_switch_tables(self):
        """Look for switch/case tables that might contain our commands"""
        print("\n=== SEARCHING FOR COMMAND DISPATCH LOGIC ===")
        
        # Look for sequences that might be jump tables or switch statements
        # ARM switch statements often use TBB/TBH instructions
        
        # Search for potential switch table patterns
        switch_patterns = [
            b'\x00\x00\x01\x00\x02\x00\x03\x00',  # Sequential 16-bit values
            b'\x01\x00\x00\x00\x02\x00\x00\x00',  # Sequential 32-bit values
        ]
        
        for pattern in switch_patterns:
            pos = 0
            while pos < len(self.binary_data):
                pos = self.binary_data.find(pattern, pos)
                if pos == -1:
                    break
                    
                print(f"\nPotential switch table at 0x{pos:x}")
                
                # Check if this contains our commands of interest
                table_region = self.binary_data[pos:pos+200]
                for cmd_id in [10, 14, 15]:
                    cmd_bytes = struct.pack('<H', cmd_id)
                    if cmd_bytes in table_region:
                        cmd_pos = table_region.find(cmd_bytes)
                        print(f"  Command {cmd_id} found at offset +{cmd_pos}")
                        
                        # Try to determine table entry size
                        if pos + cmd_pos + 6 < len(self.binary_data):
                            # Check if followed by potential handler address
                            potential_handler = struct.unpack('<I', 
                                self.binary_data[pos + cmd_pos + 2:pos + cmd_pos + 6])[0]
                            print(f"    Potential handler: 0x{potential_handler:08x}")
                
                pos += 1
    
    def analyze_string_references(self):
        """Look for diagnostic strings that might reveal command purposes"""
        print("\n=== SEARCHING FOR COMMAND-RELATED STRINGS ===")
        
        # Extract all strings from binary
        all_strings = self.extract_strings_around_offset(len(self.binary_data)//2, len(self.binary_data))
        
        # Look for strings that might be related to commands 10, 14, 15
        keywords = [
            'command', 'cmd', 'request', 'response', 'handler',
            'status', 'state', 'info', 'get', 'set', 'query',
            'debug', 'test', 'check', 'monitor', 'report',
            'device', 'system', 'hardware', 'firmware',
            'error', 'fail', 'success', 'ok', 'ready',
            'battery', 'power', 'temperature', 'storage',
            'audio', 'record', 'play', 'volume', 'mic'
        ]
        
        relevant_strings = []
        for offset, string in all_strings:
            string_lower = string.lower()
            for keyword in keywords:
                if keyword in string_lower and len(string) >= 6 and len(string) <= 80:
                    relevant_strings.append((offset, string))
                    break
        
        # Sort by offset and show interesting ones
        relevant_strings.sort()
        
        print("Potentially relevant strings:")
        for i, (offset, string) in enumerate(relevant_strings[:30]):  # Show first 30
            print(f"  0x{offset:08x}: '{string}'")
    
    def search_for_command_names(self):
        """Search for potential command name strings or identifiers"""
        print("\n=== SEARCHING FOR COMMAND IDENTIFIERS ===")
        
        # Look for strings that might be command names or descriptions
        all_strings = []
        current = ""
        
        for i, byte in enumerate(self.binary_data):
            if 32 <= byte <= 126:  # Printable ASCII
                current += chr(byte)
            else:
                if len(current) >= 4:
                    all_strings.append((i - len(current), current))
                current = ""
        
        # Filter for strings that might be command related
        command_candidates = []
        for offset, string in all_strings:
            # Look for patterns like "CMD_", "GET_", "SET_", etc.
            if (string.startswith(('CMD_', 'GET_', 'SET_', 'REQUEST_')) or
                'COMMAND' in string.upper() or
                re.match(r'^[A-Z_]{6,30}$', string)):
                command_candidates.append((offset, string))
        
        print("Potential command identifiers:")
        for offset, string in command_candidates[:20]:
            print(f"  0x{offset:08x}: '{string}'")
    
    def hex_dump_command_regions(self, cmd_id, num_bytes=64):
        """Show hex dump of regions containing command ID"""
        print(f"\n=== HEX DUMP REGIONS: Command {cmd_id} ===")
        
        cmd_bytes = struct.pack('<H', cmd_id)
        pos = 0
        count = 0
        
        while pos < len(self.binary_data) and count < 3:
            pos = self.binary_data.find(cmd_bytes, pos)
            if pos == -1:
                break
                
            print(f"\nRegion {count+1} at 0x{pos:08x}:")
            
            start = max(0, pos - num_bytes//2)
            end = min(len(self.binary_data), pos + num_bytes//2)
            region = self.binary_data[start:end]
            
            # Hex dump with ASCII
            for i in range(0, len(region), 16):
                line = region[i:i+16]
                hex_part = ' '.join(f'{b:02x}' for b in line)
                ascii_part = ''.join(chr(b) if 32 <= b <= 126 else '.' for b in line)
                
                addr = start + i
                cmd_marker = ""
                if start + i <= pos < start + i + 16:
                    cmd_marker = " <-- CMD HERE"
                
                print(f"  {addr:08x}  {hex_part:<48} |{ascii_part}|{cmd_marker}")
            
            pos += 1
            count += 1


def main():
    zephyr_path = r"E:\Code\hidock-next\firmware\hidock-h1e\6.2.5\partitions\zephyr.bin"
    
    print("Deep Command Analysis - Commands 10, 14, 15")
    print("=" * 50)
    
    if not Path(zephyr_path).exists():
        print(f"Error: File not found: {zephyr_path}")
        return 1
    
    analyzer = DeepCommandAnalyzer(zephyr_path)
    
    # Analyze each command in detail
    for cmd_id in [10, 14, 15]:
        analyzer.find_command_context(cmd_id)
        analyzer.hex_dump_command_regions(cmd_id, 128)
    
    # Look for command dispatch logic
    analyzer.search_command_switch_tables()
    
    # Search for relevant strings
    analyzer.analyze_string_references()
    
    # Search for command identifiers  
    analyzer.search_for_command_names()
    
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