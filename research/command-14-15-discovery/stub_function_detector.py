#!/usr/bin/env python3
"""
Stub Function Detector for Commands 14 & 15

This script analyzes the firmware binary to determine if Commands 14 & 15
are just stub functions that immediately return empty responses.

Key indicators of stub functions:
- Very short function body (just a few instructions)
- Immediate return with no processing
- No parameter access
- No memory operations
- Just return 0 or empty response setup

Author: HiDock Hardware Analysis Project
Version: 1.0.0
Date: 2025-08-31
"""

import struct
from pathlib import Path

class StubFunctionAnalyzer:
    def __init__(self, zephyr_path):
        self.zephyr_path = Path(zephyr_path)
        with open(self.zephyr_path, 'rb') as f:
            self.binary_data = f.read()
            
    def find_command_handler_patterns(self, cmd_id):
        """Find potential handler patterns for a command"""
        print(f"\n{'='*60}")
        print(f"ANALYZING COMMAND {cmd_id} HANDLER PATTERNS")
        print(f"{'='*60}")
        
        # Find command ID occurrences
        cmd_bytes = struct.pack('<B', cmd_id)  # Single byte command ID
        positions = []
        
        # Search for command ID in different contexts
        search_patterns = [
            (struct.pack('<B', cmd_id), "Single byte"),
            (struct.pack('<H', cmd_id), "Little-endian uint16"),
            (struct.pack('>H', cmd_id), "Big-endian uint16"),
            (bytes([cmd_id, 0x00]), "Byte + null"),
            (bytes([0x00, cmd_id]), "Null + byte"),
        ]
        
        for pattern, desc in search_patterns:
            pos = 0
            local_positions = []
            while pos < len(self.binary_data) - len(pattern):
                pos = self.binary_data.find(pattern, pos)
                if pos == -1:
                    break
                local_positions.append(pos)
                pos += 1
            
            if local_positions:
                print(f"\n{desc} pattern ({pattern.hex()}): {len(local_positions)} occurrences")
                
                # Analyze context around first few occurrences
                for i, pos in enumerate(local_positions[:3]):
                    self.analyze_handler_region(pos, cmd_id, i+1)
    
    def analyze_handler_region(self, pos, cmd_id, occurrence_num):
        """Analyze potential handler code around command reference"""
        print(f"\n--- Occurrence {occurrence_num} at 0x{pos:08x} ---")
        
        # Get surrounding bytes (look for function patterns)
        start = max(0, pos - 64)
        end = min(len(self.binary_data), pos + 64)
        region = self.binary_data[start:end]
        
        # Look for stub function patterns
        stub_indicators = self.detect_stub_patterns(region, pos - start)
        
        if stub_indicators:
            print("STUB INDICATORS FOUND:")
            for indicator in stub_indicators:
                print(f"  - {indicator}")
        
        # Show hex dump of the region
        self.show_hex_dump(region, pos - start, cmd_id)
    
    def detect_stub_patterns(self, region, cmd_offset):
        """Detect patterns that indicate a stub function"""
        indicators = []
        
        # ARM Thumb-2 patterns for stub functions
        stub_patterns = {
            # Common stub patterns
            b'\x00\x20\x70\x47': "movs r0, #0; bx lr (return 0)",
            b'\x00\x20\x00\xbd': "movs r0, #0; pop {pc} (return 0)",
            b'\x00\x20\x10\xbd': "movs r0, #0; pop {r4, pc} (return 0)",
            b'\x70\x47': "bx lr (immediate return)",
            b'\x00\xbd': "pop {pc} (immediate return)",
            b'\x00\x20': "movs r0, #0 (set return value 0)",
            
            # Function epilogue without body
            b'\x00\xb5\x00\xbd': "push {lr}; pop {pc} (empty function)",
            b'\x00\xb5\x00\x20\x00\xbd': "push {lr}; movs r0, #0; pop {pc}",
            
            # NOP patterns (doing nothing)
            b'\x00\xbf': "nop (no operation)",
            b'\xc0\x46': "mov r8, r8 (nop equivalent)",
        }
        
        # Check for stub patterns near command reference
        for pattern, description in stub_patterns.items():
            # Look before command reference (function prologue area)
            for offset in range(max(0, cmd_offset - 16), cmd_offset):
                if offset + len(pattern) <= len(region):
                    if region[offset:offset + len(pattern)] == pattern:
                        indicators.append(f"Before cmd: {description} at offset {offset - cmd_offset}")
            
            # Look after command reference (function body area)
            for offset in range(cmd_offset, min(len(region), cmd_offset + 16)):
                if offset + len(pattern) <= len(region):
                    if region[offset:offset + len(pattern)] == pattern:
                        indicators.append(f"After cmd: {description} at offset {offset - cmd_offset}")
        
        # Check for very short distance between function prologue and epilogue
        prologue_patterns = [b'\x00\xb5', b'\x10\xb5', b'\x30\xb5', b'\x70\xb5', b'\xf0\xb5']
        epilogue_patterns = [b'\x00\xbd', b'\x10\xbd', b'\x30\xbd', b'\x70\xbd', b'\xf0\xbd', b'\x70\x47']
        
        prologue_pos = None
        epilogue_pos = None
        
        # Find prologue
        for pattern in prologue_patterns:
            for offset in range(max(0, cmd_offset - 32), cmd_offset):
                if offset + len(pattern) <= len(region):
                    if region[offset:offset + len(pattern)] == pattern:
                        prologue_pos = offset
                        break
            if prologue_pos:
                break
        
        # Find epilogue
        for pattern in epilogue_patterns:
            for offset in range(cmd_offset, min(len(region), cmd_offset + 32)):
                if offset + len(pattern) <= len(region):
                    if region[offset:offset + len(pattern)] == pattern:
                        epilogue_pos = offset
                        break
            if epilogue_pos:
                break
        
        if prologue_pos is not None and epilogue_pos is not None:
            func_size = epilogue_pos - prologue_pos
            if func_size < 16:  # Very short function
                indicators.append(f"VERY SHORT FUNCTION: Only {func_size} bytes from prologue to epilogue")
        
        return indicators
    
    def show_hex_dump(self, region, cmd_offset, cmd_id):
        """Show hex dump with command position highlighted"""
        print("\nHex dump (command position marked with [XX]):")
        
        for i in range(0, len(region), 16):
            line = region[i:i+16]
            hex_parts = []
            ascii_parts = []
            
            for j, byte in enumerate(line):
                # Highlight command ID byte
                if i + j == cmd_offset:
                    hex_parts.append(f"[{byte:02x}]")
                else:
                    hex_parts.append(f"{byte:02x}")
                
                # ASCII representation
                if 32 <= byte <= 126:
                    ascii_parts.append(chr(byte))
                else:
                    ascii_parts.append('.')
            
            hex_str = ' '.join(hex_parts)
            ascii_str = ''.join(ascii_parts)
            
            offset = i
            print(f"  {offset:04x}: {hex_str:<50} |{ascii_str}|")
    
    def compare_commands(self):
        """Compare Commands 14 and 15 to see if they're identical stubs"""
        print(f"\n{'='*60}")
        print("COMPARING COMMANDS 14 & 15")
        print(f"{'='*60}")
        
        # Find all occurrences of both commands
        cmd14_positions = []
        cmd15_positions = []
        
        for cmd_id, positions in [(14, cmd14_positions), (15, cmd15_positions)]:
            pattern = struct.pack('<H', cmd_id)
            pos = 0
            while pos < len(self.binary_data):
                pos = self.binary_data.find(pattern, pos)
                if pos == -1:
                    break
                positions.append(pos)
                pos += 1
        
        print(f"Command 14: {len(cmd14_positions)} occurrences")
        print(f"Command 15: {len(cmd15_positions)} occurrences")
        
        # Compare regions around commands to see if they're similar
        if cmd14_positions and cmd15_positions:
            print("\nComparing code regions around commands...")
            
            for i in range(min(3, len(cmd14_positions), len(cmd15_positions))):
                pos14 = cmd14_positions[i]
                pos15 = cmd15_positions[i]
                
                # Get 32 bytes around each command
                region14 = self.binary_data[max(0, pos14-16):min(len(self.binary_data), pos14+16)]
                region15 = self.binary_data[max(0, pos15-16):min(len(self.binary_data), pos15+16)]
                
                # Compare regions (ignoring the command ID bytes themselves)
                similarity = sum(1 for a, b in zip(region14, region15) if a == b) / len(region14) * 100
                
                print(f"\nOccurrence {i+1} similarity: {similarity:.1f}%")
                if similarity > 90:
                    print("  -> Nearly identical code! Likely same stub implementation")

def main():
    zephyr_path = r"E:\Code\hidock-next\firmware\hidock-h1e\6.2.5\partitions\zephyr.bin"
    
    print("Stub Function Detection - Commands 14 & 15")
    print("=" * 50)
    
    if not Path(zephyr_path).exists():
        print(f"Error: File not found: {zephyr_path}")
        return 1
    
    analyzer = StubFunctionAnalyzer(zephyr_path)
    
    # Analyze each command
    for cmd_id in [14, 15]:
        analyzer.find_command_handler_patterns(cmd_id)
    
    # Compare commands to see if they're identical
    analyzer.compare_commands()
    
    print(f"\n{'='*60}")
    print("CONCLUSION")
    print(f"{'='*60}")
    print("Check the indicators above to determine if Commands 14 & 15")
    print("are stub functions that just return empty responses.")
    print("\nKey indicators of stubs:")
    print("- 'return 0' patterns immediately after command reference")
    print("- Very short function size (<16 bytes)")
    print("- No memory operations between prologue and epilogue")
    print("- Identical code patterns for both commands")
    
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