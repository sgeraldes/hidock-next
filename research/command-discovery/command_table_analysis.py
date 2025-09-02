#!/usr/bin/env python3
"""
HiDock H1E Command Table Analysis

This script performs detailed analysis of the Zephyr firmware binary to locate
and decode Jensen protocol command handler tables.

Author: HiDock Hardware Analysis Project
Version: 1.0.0
Date: 2025-08-31
"""

import struct
from pathlib import Path

class CommandTableAnalyzer:
    def __init__(self, zephyr_path):
        self.zephyr_path = Path(zephyr_path)
        with open(self.zephyr_path, 'rb') as f:
            self.binary_data = f.read()
    
    def find_command_tables(self):
        """Search for command handler tables in the binary"""
        print("Searching for command handler tables...")
        
        # Look for sequential command IDs (1, 2, 3, 4, ...)
        potential_tables = []
        
        for offset in range(0, len(self.binary_data) - 80, 4):  # 4-byte alignment
            try:
                # Check if we have a sequence starting with command 1
                cmd1 = struct.unpack('<H', self.binary_data[offset:offset+2])[0]
                if cmd1 == 1:
                    # Check if followed by command 2, 3, etc.
                    sequential_count = 1
                    current_offset = offset + 2
                    
                    while current_offset + 2 <= len(self.binary_data):
                        next_cmd = struct.unpack('<H', self.binary_data[current_offset:current_offset+2])[0]
                        if next_cmd == sequential_count + 1:
                            sequential_count += 1
                            current_offset += 2
                            if sequential_count >= 5:  # Found a promising sequence
                                break
                        else:
                            break
                    
                    if sequential_count >= 5:
                        potential_tables.append((offset, sequential_count))
                        
            except (struct.error, IndexError):
                continue
        
        return potential_tables
    
    def analyze_command_table(self, offset, count):
        """Analyze a potential command table at given offset"""
        print(f"\nAnalyzing command table at offset 0x{offset:x}:")
        print(f"Sequential commands found: {count}")
        
        # Try different table structures
        structures = [
            ("Simple 16-bit commands", 2, "<H"),
            ("32-bit command IDs", 4, "<I"),
            ("Command + handler (8 bytes)", 8, "<HI"),
            ("Command + handler (12 bytes)", 12, "<III"),
        ]
        
        for struct_name, struct_size, format_str in structures:
            print(f"\n--- {struct_name} ---")
            try:
                for i in range(min(20, count)):  # Analyze first 20 entries
                    entry_offset = offset + (i * struct_size)
                    if entry_offset + struct_size <= len(self.binary_data):
                        data = struct.unpack(format_str, 
                                           self.binary_data[entry_offset:entry_offset+struct_size])
                        
                        if struct_size == 2:
                            print(f"  Command {i+1}: {data[0]} (0x{data[0]:04x})")
                        elif struct_size == 4:
                            print(f"  Command {i+1}: {data[0]} (0x{data[0]:08x})")
                        elif struct_size == 8:
                            print(f"  Command {i+1}: ID={data[0]:04x}, Handler=0x{data[1]:08x}")
                        elif struct_size == 12:
                            print(f"  Command {i+1}: ID={data[0]:08x}, Addr1=0x{data[1]:08x}, Addr2=0x{data[2]:08x}")
                            
            except (struct.error, IndexError) as e:
                print(f"  Error parsing structure: {e}")
    
    def search_jensen_magic_context(self):
        """Analyze context around Jensen magic numbers to find command handlers"""
        print("\nAnalyzing Jensen magic number contexts...")
        
        magic_positions = []
        pos = 0
        while pos < len(self.binary_data):
            pos = self.binary_data.find(b'\x12\x34', pos)
            if pos == -1:
                break
            magic_positions.append(pos)
            pos += 1
        
        print(f"Found {len(magic_positions)} Jensen magic numbers")
        
        # Analyze context around each magic number
        for i, pos in enumerate(magic_positions[:10]):  # Analyze first 10
            print(f"\n--- Magic #{i+1} at 0x{pos:x} ---")
            
            # Look at surrounding bytes
            start = max(0, pos - 32)
            end = min(len(self.binary_data), pos + 64)
            context = self.binary_data[start:end]
            
            # Try to find command-related patterns
            for offset in range(len(context) - 4):
                try:
                    # Look for little-endian 16-bit values that could be commands
                    val = struct.unpack('<H', context[offset:offset+2])[0]
                    if 1 <= val <= 30:  # Potential command ID
                        abs_offset = start + offset
                        print(f"  Potential command {val} at 0x{abs_offset:x}")
                except (struct.error, IndexError):
                    continue
    
    def search_specific_commands(self):
        """Search for specific command patterns we know exist"""
        print("\nSearching for specific command patterns...")
        
        # Commands we know exist from testing
        known_commands = {
            14: "SUPPORTED (empty response)",
            15: "SUPPORTED (empty response)",
            10: "NOT SUPPORTED (causes failure)"
        }
        
        for cmd_id in [10, 14, 15]:
            print(f"\n--- Command {cmd_id} ({known_commands.get(cmd_id, 'Unknown')}) ---")
            
            # Search for little-endian 16-bit representation
            cmd_bytes = struct.pack('<H', cmd_id)
            positions = []
            pos = 0
            
            while pos < len(self.binary_data) and len(positions) < 10:
                pos = self.binary_data.find(cmd_bytes, pos)
                if pos == -1:
                    break
                positions.append(pos)
                pos += 1
            
            print(f"  Found {len(positions)} occurrences:")
            for i, pos in enumerate(positions):
                # Show context around each occurrence
                start = max(0, pos - 8)
                end = min(len(self.binary_data), pos + 16)
                context = self.binary_data[start:end]
                hex_context = ' '.join(f'{b:02x}' for b in context)
                
                # Try to interpret as potential function table entry
                if pos + 6 <= len(self.binary_data):
                    try:
                        # Check if followed by what could be a function pointer
                        potential_handler = struct.unpack('<I', self.binary_data[pos+2:pos+6])[0]
                        if 0x20000000 <= potential_handler <= 0x40000000:  # ARM address range
                            print(f"    0x{pos:x}: {hex_context} (handler: 0x{potential_handler:08x})")
                        else:
                            print(f"    0x{pos:x}: {hex_context}")
                    except (struct.error, IndexError):
                        print(f"    0x{pos:x}: {hex_context}")
                else:
                    print(f"    0x{pos:x}: {hex_context}")


def main():
    zephyr_path = r"E:\Code\hidock-next\firmware\hidock-h1e\6.2.5\partitions\zephyr.bin"
    
    print("HiDock H1E Command Table Analysis")
    print("=" * 40)
    print(f"Analyzing: {zephyr_path}")
    
    if not Path(zephyr_path).exists():
        print(f"Error: File not found: {zephyr_path}")
        return 1
    
    analyzer = CommandTableAnalyzer(zephyr_path)
    
    # Search for command tables
    tables = analyzer.find_command_tables()
    if tables:
        print(f"\nFound {len(tables)} potential command tables:")
        for offset, count in tables[:5]:  # Analyze top 5 candidates
            analyzer.analyze_command_table(offset, count)
    else:
        print("\nNo obvious command tables found with sequential structure")
    
    # Analyze Jensen magic contexts
    analyzer.search_jensen_magic_context()
    
    # Search for specific commands
    analyzer.search_specific_commands()
    
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