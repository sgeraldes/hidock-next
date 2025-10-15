# -*- coding: utf-8-sig -*-
#!/usr/bin/env python3
"""
ARM Handler Analysis for Commands 14 & 15

This script analyzes the ARM Thumb assembly code at the handler addresses
discovered for Commands 14 and 15 to understand their actual functionality.

Based on firmware analysis findings:
- Command 14 handlers: 0x3ac92623, 0x24ed2a1b
- Command 15 handlers: 0x26f69a17, 0x2bed2a1b

Author: HiDock Hardware Analysis Project
Version: 1.0.0
Date: 2025-08-31
"""

import struct
from pathlib import Path

class ARMHandlerAnalyzer:
    def __init__(self, zephyr_path):
        self.zephyr_path = Path(zephyr_path)
        with open(self.zephyr_path, 'rb') as f:
            self.binary_data = f.read()
            
        # ARM Thumb instruction patterns for analysis
        self.thumb_patterns = {
            b'\x00\xb5': 'push {lr}',                    # Function prologue
            b'\x10\xb5': 'push {r4, lr}',               # Function with r4
            b'\x30\xb5': 'push {r4, r5, lr}',           # Function with r4-r5
            b'\xf0\xb5': 'push {r4-r7, lr}',            # Function with r4-r7
            b'\x00\xbd': 'pop {pc}',                     # Function epilogue
            b'\x10\xbd': 'pop {r4, pc}',                # Function epilogue with r4
            b'\x30\xbd': 'pop {r4, r5, pc}',            # Function epilogue with r4-r5
            b'\xf0\xbd': 'pop {r4-r7, pc}',             # Function epilogue with r4-r7
            b'\x70\x47': 'bx lr',                       # Return instruction
            b'\x00\x20': 'movs r0, #0',                 # Return 0
            b'\x01\x20': 'movs r0, #1',                 # Return 1
            b'\xff\x20': 'movs r0, #0xff',              # Return 0xFF
        }
    
    def virtual_to_file_offset(self, virtual_addr):
        """Convert ARM virtual address to file offset (approximate)"""
        # ARM Cortex-M typically maps flash at 0x08000000
        # Our binary starts at that base
        base_addr = 0x08000000
        if virtual_addr >= base_addr:
            file_offset = virtual_addr - base_addr
            if file_offset < len(self.binary_data):
                return file_offset
        return None
    
    def analyze_handler_function(self, handler_addr, command_id):
        """Analyze ARM Thumb code at handler address"""
        print(f"\n{'='*60}")
        print(f"ANALYZING COMMAND {command_id} HANDLER: 0x{handler_addr:08x}")
        print(f"{'='*60}")
        
        # Convert to file offset
        file_offset = self.virtual_to_file_offset(handler_addr)
        
        if file_offset is None:
            print(f"Handler address 0x{handler_addr:08x} not mappable to file offset")
            return
            
        if file_offset >= len(self.binary_data):
            print(f"Handler address 0x{handler_addr:08x} beyond file size")
            return
            
        print(f"Virtual Address: 0x{handler_addr:08x}")
        print(f"File Offset: 0x{file_offset:08x}")
        
        # Analyze function structure
        self.analyze_function_structure(file_offset, command_id)
        
        # Show raw bytes and attempt disassembly
        self.show_handler_bytes(file_offset, handler_addr)
        
        # Look for function patterns
        self.analyze_function_patterns(file_offset)
    
    def analyze_function_structure(self, file_offset, command_id):
        """Analyze the structure of the function"""
        print(f"\n--- Function Structure Analysis ---")
        
        # Look backwards for function prologue
        prologue_found = None
        for i in range(32):  # Search 32 bytes back
            search_offset = file_offset - i
            if search_offset < 0:
                break
                
            for pattern, description in self.thumb_patterns.items():
                if search_offset + len(pattern) <= len(self.binary_data):
                    if self.binary_data[search_offset:search_offset+len(pattern)] == pattern:
                        if 'push' in description:
                            prologue_found = (search_offset, description)
                            print(f"Function prologue at -{i}: {description}")
                            break
            if prologue_found:
                break
        
        # Look forward for function epilogue
        epilogue_found = None
        for i in range(64):  # Search 64 bytes forward
            search_offset = file_offset + i
            if search_offset >= len(self.binary_data) - 2:
                break
                
            for pattern, description in self.thumb_patterns.items():
                if search_offset + len(pattern) <= len(self.binary_data):
                    if self.binary_data[search_offset:search_offset+len(pattern)] == pattern:
                        if 'pop' in description or 'bx lr' in description:
                            epilogue_found = (search_offset, description)
                            print(f"Function epilogue at +{i}: {description}")
                            break
            if epilogue_found:
                break
        
        # Estimate function size
        if prologue_found and epilogue_found:
            func_size = epilogue_found[0] - prologue_found[0] + 2
            print(f"Estimated function size: {func_size} bytes")
        elif prologue_found:
            print("Function prologue found, but no clear epilogue")
        else:
            print("No clear function boundaries detected")
    
    def show_handler_bytes(self, file_offset, virtual_addr):
        """Show raw bytes around the handler"""
        print(f"\n--- Raw Bytes at Handler ---")
        
        start = max(0, file_offset - 16)
        end = min(len(self.binary_data), file_offset + 48)
        
        for addr in range(start, end, 16):
            line = self.binary_data[addr:addr+16]
            hex_part = ' '.join(f'{b:02x}' for b in line)
            
            # Calculate virtual address for this line
            vaddr = virtual_addr - (file_offset - addr)
            
            marker = ""
            if addr <= file_offset < addr + 16:
                marker = " <-- HANDLER"
            
            print(f"  0x{vaddr:08x}  {hex_part:<48}{marker}")
    
    def analyze_function_patterns(self, file_offset):
        """Look for specific patterns that indicate function behavior"""
        print(f"\n--- Function Behavior Analysis ---")
        
        # Analyze 64 bytes around the handler
        start = max(0, file_offset - 16)
        end = min(len(self.binary_data), file_offset + 48)
        region = self.binary_data[start:end]
        
        patterns_found = []
        
        for i in range(len(region) - 1):
            for pattern, description in self.thumb_patterns.items():
                if i + len(pattern) <= len(region):
                    if region[i:i+len(pattern)] == pattern:
                        offset_from_handler = (start + i) - file_offset
                        patterns_found.append((offset_from_handler, description))
        
        if patterns_found:
            print("ARM Thumb patterns found:")
            for offset, desc in sorted(patterns_found):
                sign = '+' if offset >= 0 else ''
                print(f"  {sign}{offset:3d}: {desc}")
        else:
            print("No recognized ARM Thumb patterns found")
        
        # Look for immediate values that might indicate behavior
        self.analyze_immediate_values(region, file_offset)
    
    def analyze_immediate_values(self, region, handler_offset):
        """Look for immediate values that might indicate function behavior"""
        print(f"\n--- Immediate Values Analysis ---")
        
        # Look for common immediate value patterns in ARM Thumb
        for i in range(len(region) - 1):
            # Check for movs r0, #imm (common return values)
            if i < len(region) - 1:
                byte1, byte2 = region[i], region[i+1]
                
                # movs r0, #imm8 pattern: 0x20 imm8
                if byte1 == 0x20:
                    imm = byte2
                    offset = (handler_offset - len(region)//2) + i
                    print(f"  movs r0, #{imm} (0x{imm:02x}) at offset {offset - handler_offset:+d}")
                
                # movs r1, #imm8 pattern: 0x21 imm8  
                elif byte1 == 0x21:
                    imm = byte2
                    offset = (handler_offset - len(region)//2) + i
                    print(f"  movs r1, #{imm} (0x{imm:02x}) at offset {offset - handler_offset:+d}")
    
    def compare_handler_functions(self, cmd14_handlers, cmd15_handlers):
        """Compare Command 14 and 15 handler functions"""
        print(f"\n{'='*60}")
        print("COMPARING COMMAND 14 & 15 HANDLERS")
        print(f"{'='*60}")
        
        print(f"Command 14 handlers: {[hex(h) for h in cmd14_handlers]}")
        print(f"Command 15 handlers: {[hex(h) for h in cmd15_handlers]}")
        
        # Check if handlers are close to each other (same subsystem)
        all_handlers = cmd14_handlers + cmd15_handlers
        all_handlers.sort()
        
        print(f"\nHandler proximity analysis:")
        for i in range(len(all_handlers) - 1):
            distance = all_handlers[i+1] - all_handlers[i]
            cmd_a = "14" if all_handlers[i] in cmd14_handlers else "15"
            cmd_b = "14" if all_handlers[i+1] in cmd14_handlers else "15"
            print(f"  Cmd {cmd_a} -> Cmd {cmd_b}: {distance} bytes apart (0x{distance:x})")
            
            if distance < 1024:  # If very close, might be same subsystem
                print(f"    -> Very close! Likely same subsystem/module")

def main():
    zephyr_path = r"E:\Code\hidock-next\firmware\hidock-h1e\6.2.5\partitions\zephyr.bin"
    
    print("ARM Handler Analysis - Commands 14 & 15")
    print("=" * 50)
    
    if not Path(zephyr_path).exists():
        print(f"Error: File not found: {zephyr_path}")
        return 1
    
    analyzer = ARMHandlerAnalyzer(zephyr_path)
    
    # Handler addresses found from firmware analysis
    cmd14_handlers = [0x3ac92623, 0x24ed2a1b]
    cmd15_handlers = [0x26f69a17, 0x2bed2a1b]
    
    # Analyze Command 14 handlers
    for handler in cmd14_handlers:
        analyzer.analyze_handler_function(handler, 14)
    
    # Analyze Command 15 handlers  
    for handler in cmd15_handlers:
        analyzer.analyze_handler_function(handler, 15)
    
    # Compare handlers
    analyzer.compare_handler_functions(cmd14_handlers, cmd15_handlers)
    
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