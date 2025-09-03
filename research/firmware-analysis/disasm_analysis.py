#!/usr/bin/env python3
"""
ARM Disassembly Analysis for Commands 10, 14, 15

This script attempts to disassemble ARM Thumb code around command references
to understand what the handlers actually do.

Author: HiDock Hardware Analysis Project  
Version: 1.0.0
Date: 2025-08-31
"""

import struct
from pathlib import Path

class ARMDisasmAnalyzer:
    def __init__(self, zephyr_path):
        self.zephyr_path = Path(zephyr_path)
        with open(self.zephyr_path, 'rb') as f:
            self.binary_data = f.read()
    
    def decode_thumb_instruction(self, instruction_bytes):
        """Basic ARM Thumb instruction decoder for common patterns"""
        if len(instruction_bytes) < 2:
            return "INCOMPLETE"
            
        instr = struct.unpack('<H', instruction_bytes[:2])[0]
        
        # Common Thumb instructions
        if instr == 0xB500:
            return "push {lr}"
        elif instr == 0xB510:
            return "push {r4, lr}"  
        elif instr == 0xB530:
            return "push {r4, r5, lr}"
        elif instr == 0xBD00:
            return "pop {pc}"
        elif instr == 0xBD10:
            return "pop {r4, pc}"
        elif (instr & 0xFF00) == 0x4600:
            reg = instr & 0x07
            return f"mov r{reg}, r{reg}"
        elif (instr & 0xF000) == 0x2000:
            reg = (instr >> 8) & 0x07
            imm = instr & 0xFF
            return f"movs r{reg}, #{imm}"
        elif (instr & 0xF800) == 0x4800:
            reg = (instr >> 8) & 0x07
            imm = instr & 0xFF
            return f"ldr r{reg}, [pc, #{imm*4}]"
        elif (instr & 0xF800) == 0x6000:
            return "str/ldr register offset"
        elif (instr & 0xF000) == 0xD000:
            return "conditional branch"
        elif (instr & 0xF800) == 0xE000:
            return "unconditional branch"
        else:
            return f"unknown (0x{instr:04x})"
    
    def find_function_starts(self, start_offset, search_range=200):
        """Find potential ARM Thumb function starts near offset"""
        candidates = []
        
        # ARM Thumb functions typically start with push instructions
        push_patterns = [0xB500, 0xB510, 0xB530, 0xB570, 0xB5F0]
        
        search_start = max(0, start_offset - search_range)
        search_end = min(len(self.binary_data) - 2, start_offset + search_range)
        
        for offset in range(search_start, search_end, 2):  # Thumb is 2-byte aligned
            if offset + 2 <= len(self.binary_data):
                instr = struct.unpack('<H', self.binary_data[offset:offset+2])[0]
                if instr in push_patterns:
                    candidates.append((offset, instr))
        
        return candidates
    
    def disassemble_region(self, start_offset, num_instructions=10):
        """Disassemble a region starting at given offset"""
        instructions = []
        offset = start_offset
        
        for i in range(num_instructions):
            if offset + 2 > len(self.binary_data):
                break
                
            instr_bytes = self.binary_data[offset:offset+2]
            decoded = self.decode_thumb_instruction(instr_bytes)
            instructions.append((offset, struct.unpack('<H', instr_bytes)[0], decoded))
            offset += 2
            
        return instructions
    
    def analyze_command_handler_candidates(self, cmd_id):
        """Try to locate and analyze potential command handlers"""
        print(f"\n=== HANDLER ANALYSIS: Command {cmd_id} ===")
        
        # Find command occurrences
        cmd_bytes = struct.pack('<H', cmd_id)
        positions = []
        pos = 0
        
        while pos < len(self.binary_data) and len(positions) < 5:
            pos = self.binary_data.find(cmd_bytes, pos)
            if pos == -1:
                break
            positions.append(pos)
            pos += 1
        
        for i, cmd_pos in enumerate(positions):
            print(f"\n--- Occurrence {i+1} at 0x{cmd_pos:x} ---")
            
            # Look for potential handler address after command ID
            if cmd_pos + 6 <= len(self.binary_data):
                # Check different potential table structures
                
                # Structure 1: cmd_id (2 bytes) + handler (4 bytes)
                handler_addr = struct.unpack('<I', self.binary_data[cmd_pos+2:cmd_pos+6])[0]
                print(f"Potential handler address: 0x{handler_addr:08x}")
                
                # Check if this could be a valid Thumb function address
                if handler_addr & 1:  # Thumb functions have odd addresses
                    actual_addr = handler_addr & 0xFFFFFFFE
                    
                    # Check if address is within our binary
                    if actual_addr < len(self.binary_data):
                        print(f"  Thumb function at: 0x{actual_addr:08x}")
                        
                        # Try to disassemble from this address
                        try:
                            instructions = self.disassemble_region(actual_addr, 8)
                            print("  Disassembly:")
                            for addr, raw, decoded in instructions:
                                print(f"    0x{addr:08x}: {raw:04x}  {decoded}")
                        except Exception as e:
                            print(f"  Disassembly failed: {e}")
                    else:
                        print(f"  Address outside binary range")
                else:
                    print(f"  Not a Thumb function (even address)")
            
            # Look for function starts near this command reference
            func_starts = self.find_function_starts(cmd_pos, 100)
            if func_starts:
                print(f"  Nearby function starts:")
                for func_addr, push_instr in func_starts[:3]:
                    distance = abs(func_addr - cmd_pos)
                    print(f"    0x{func_addr:08x}: push instruction (0x{push_instr:04x}), distance: {distance}")
                    
                    # Disassemble a bit of this function
                    try:
                        instructions = self.disassemble_region(func_addr, 5)
                        for addr, raw, decoded in instructions:
                            print(f"      0x{addr:08x}: {raw:04x}  {decoded}")
                    except Exception as e:
                        print(f"      Disassembly failed: {e}")
    
    def search_command_jump_table(self):
        """Look for jump/dispatch tables containing our commands"""
        print("\n=== SEARCHING FOR COMMAND DISPATCH TABLES ===")
        
        # Look for sequences of consecutive commands that might indicate a table
        for base_cmd in range(1, 18):  # Start from different base commands
            pattern = b""
            for i in range(base_cmd, min(base_cmd + 8, 21)):
                pattern += struct.pack('<H', i)
            
            pos = self.binary_data.find(pattern)
            if pos != -1:
                print(f"\nFound command sequence starting with {base_cmd} at 0x{pos:x}")
                
                # Check what follows - might be handler addresses
                table_offset = pos
                for cmd in range(base_cmd, min(base_cmd + 10, 21)):
                    cmd_offset = table_offset + (cmd - base_cmd) * 2
                    
                    if cmd_offset + 6 <= len(self.binary_data):
                        cmd_val = struct.unpack('<H', self.binary_data[cmd_offset:cmd_offset+2])[0]
                        handler = struct.unpack('<I', self.binary_data[cmd_offset+2:cmd_offset+6])[0]
                        
                        print(f"  Command {cmd_val}: Handler 0x{handler:08x}")
                        
                        # Check if commands 10, 14, 15 are in this table
                        if cmd_val in [10, 14, 15]:
                            print(f"    *** FOUND COMMAND {cmd_val} HANDLER! ***")
                            
                            # Try to analyze this handler
                            if handler & 1 and (handler & 0xFFFFFFFE) < len(self.binary_data):
                                actual_addr = handler & 0xFFFFFFFE
                                print(f"    Analyzing handler at 0x{actual_addr:08x}:")
                                
                                try:
                                    instructions = self.disassemble_region(actual_addr, 15)
                                    for addr, raw, decoded in instructions:
                                        print(f"      0x{addr:08x}: {raw:04x}  {decoded}")
                                        
                                        # Look for patterns that might indicate function purpose
                                        if "ldr" in decoded.lower():
                                            print(f"        ^ Memory access - might be reading data")
                                        elif "str" in decoded.lower():
                                            print(f"        ^ Memory write - might be setting state")
                                        elif "pop {pc}" in decoded:
                                            print(f"        ^ Function return")
                                            break
                                            
                                except Exception as e:
                                    print(f"      Disassembly failed: {e}")
    
    def extract_string_references(self, handler_addr, max_instructions=20):
        """Try to find string references in a handler function"""
        print(f"  Looking for string references in handler at 0x{handler_addr:x}:")
        
        offset = handler_addr
        for i in range(max_instructions):
            if offset + 2 > len(self.binary_data):
                break
                
            instr = struct.unpack('<H', self.binary_data[offset:offset+2])[0]
            
            # Look for LDR PC-relative (loads constants/string addresses)
            if (instr & 0xF800) == 0x4800:  # LDR Rd, [PC, #imm]
                reg = (instr >> 8) & 0x07
                imm = instr & 0xFF
                
                # Calculate the address being loaded from
                pc_value = (offset + 4) & 0xFFFFFFFC  # PC is current addr + 4, aligned
                target_addr = pc_value + (imm * 4)
                
                if target_addr + 4 <= len(self.binary_data):
                    # Read the 32-bit value at target address
                    value = struct.unpack('<I', self.binary_data[target_addr:target_addr+4])[0]
                    
                    # Check if this could be a string pointer
                    if value < len(self.binary_data):
                        # Try to read string at this address
                        string_data = ""
                        str_offset = value
                        for j in range(50):  # Max 50 chars
                            if str_offset + j >= len(self.binary_data):
                                break
                            char = self.binary_data[str_offset + j]
                            if 32 <= char <= 126:
                                string_data += chr(char)
                            else:
                                break
                        
                        if len(string_data) >= 3:
                            print(f"    0x{offset:08x}: ldr r{reg}, [pc, #{imm*4}] -> 0x{value:08x} -> '{string_data}'")
            
            offset += 2


def main():
    zephyr_path = r"E:\Code\hidock-next\firmware\hidock-h1e\6.2.5\partitions\zephyr.bin"
    
    print("ARM Disassembly Analysis for Commands 10, 14, 15")
    print("=" * 50)
    
    if not Path(zephyr_path).exists():
        print(f"Error: File not found: {zephyr_path}")
        return 1
    
    analyzer = ARMDisasmAnalyzer(zephyr_path)
    
    # Look for command dispatch tables first
    analyzer.search_command_jump_table()
    
    # Analyze individual command handlers
    for cmd_id in [10, 14, 15]:
        analyzer.analyze_command_handler_candidates(cmd_id)
    
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