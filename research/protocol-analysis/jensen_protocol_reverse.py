#!/usr/bin/env python3
"""
Jensen Protocol Reverse Engineering Analysis

Advanced analysis of the HiDock H1E firmware to decode the Jensen protocol
command structure and discover command handlers.

Author: HiDock Hardware Analysis Project  
Version: 1.0.0
Date: 2025-08-31
"""

import struct
from pathlib import Path

class JensenProtocolReverser:
    def __init__(self, zephyr_path):
        self.zephyr_path = Path(zephyr_path)
        with open(self.zephyr_path, 'rb') as f:
            self.binary_data = f.read()
        
        # Known command information from testing
        self.known_commands = {
            1: {"name": "GET_DEVICE_INFO", "status": "SUPPORTED"},
            2: {"name": "GET_DEVICE_TIME", "status": "SUPPORTED"}, 
            3: {"name": "SET_DEVICE_TIME", "status": "SUPPORTED"},
            4: {"name": "GET_FILE_LIST", "status": "SUPPORTED"},
            5: {"name": "TRANSFER_FILE", "status": "SUPPORTED"},
            6: {"name": "GET_FILE_COUNT", "status": "SUPPORTED"},
            7: {"name": "DELETE_FILE", "status": "SUPPORTED"},
            8: {"name": "REQUEST_FIRMWARE_UPGRADE", "status": "SUPPORTED"},
            9: {"name": "FIRMWARE_UPLOAD", "status": "SUPPORTED"},
            10: {"name": "UNKNOWN", "status": "NOT_SUPPORTED"},
            11: {"name": "GET_SETTINGS", "status": "SUPPORTED"},
            12: {"name": "SET_SETTINGS", "status": "SUPPORTED"},
            13: {"name": "GET_FILE_BLOCK", "status": "SUPPORTED"},
            14: {"name": "UNKNOWN", "status": "SUPPORTED"},
            15: {"name": "UNKNOWN", "status": "SUPPORTED"},
            16: {"name": "GET_CARD_INFO", "status": "SUPPORTED"},
            17: {"name": "FORMAT_CARD", "status": "SUPPORTED"},
            18: {"name": "GET_RECORDING_FILE", "status": "SUPPORTED"},
            19: {"name": "RESTORE_FACTORY_SETTINGS", "status": "SUPPORTED"},
            20: {"name": "SEND_MEETING_SCHEDULE_INFO", "status": "SUPPORTED"},
        }
    
    def find_command_dispatch_table(self):
        """Try to locate the main command dispatch table"""
        print("Searching for command dispatch table...")
        
        # Look for patterns that could be a dispatch table
        # ARM function tables often have entries like: command_id, handler_address
        
        candidates = []
        
        # Search for sequences of command IDs 1-20 with potential handlers
        for offset in range(0, len(self.binary_data) - 160, 4):
            try:
                # Check if this could be start of command table (command 1)
                cmd_id = struct.unpack('<H', self.binary_data[offset:offset+2])[0]
                if cmd_id == 1:
                    # Check if followed by valid ARM address
                    if offset + 6 <= len(self.binary_data):
                        potential_handler = struct.unpack('<I', self.binary_data[offset+2:offset+6])[0]
                        
                        # ARM Cortex-M addresses typically in these ranges
                        if (0x08000000 <= potential_handler <= 0x08100000 or  # Flash
                            0x20000000 <= potential_handler <= 0x20080000 or  # SRAM
                            0x00000000 <= potential_handler <= 0x00100000):   # Vector table
                            
                            # Check if more commands follow
                            valid_entries = 1
                            check_offset = offset + 6
                            
                            for next_cmd in range(2, 21):
                                if check_offset + 6 <= len(self.binary_data):
                                    next_id = struct.unpack('<H', self.binary_data[check_offset:check_offset+2])[0]
                                    next_handler = struct.unpack('<I', self.binary_data[check_offset+2:check_offset+6])[0]
                                    
                                    if (next_id == next_cmd and 
                                        (0x08000000 <= next_handler <= 0x08100000 or
                                         0x20000000 <= next_handler <= 0x20080000 or
                                         0x00000000 <= next_handler <= 0x00100000)):
                                        valid_entries += 1
                                        check_offset += 6
                                    else:
                                        break
                                else:
                                    break
                            
                            if valid_entries >= 5:
                                candidates.append((offset, valid_entries, "6-byte entries (cmd+handler)"))
                        
                # Also check for 8-byte entries (aligned)
                if offset % 8 == 0:  # 8-byte aligned
                    potential_handler = struct.unpack('<I', self.binary_data[offset+4:offset+8])[0]
                    if (0x08000000 <= potential_handler <= 0x08100000 or
                        0x20000000 <= potential_handler <= 0x20080000 or
                        0x00000000 <= potential_handler <= 0x00100000):
                        
                        valid_entries = 1
                        check_offset = offset + 8
                        
                        for next_cmd in range(2, 21):
                            if check_offset + 8 <= len(self.binary_data):
                                next_id = struct.unpack('<H', self.binary_data[check_offset:check_offset+2])[0]
                                next_handler = struct.unpack('<I', self.binary_data[check_offset+4:check_offset+8])[0]
                                
                                if (next_id == next_cmd and
                                    (0x08000000 <= next_handler <= 0x08100000 or
                                     0x20000000 <= next_handler <= 0x20080000 or
                                     0x00000000 <= next_handler <= 0x00100000)):
                                    valid_entries += 1
                                    check_offset += 8
                                else:
                                    break
                            else:
                                break
                        
                        if valid_entries >= 5:
                            candidates.append((offset, valid_entries, "8-byte entries (cmd+padding+handler)"))
                            
            except (struct.error, IndexError):
                continue
        
        return candidates
    
    def analyze_dispatch_table(self, offset, count, structure_type):
        """Analyze a potential dispatch table"""
        print(f"\n--- Dispatch Table at 0x{offset:x} ({structure_type}) ---")
        print(f"Valid entries: {count}")
        
        entry_size = 6 if "6-byte" in structure_type else 8
        
        for i in range(min(count, 20)):
            entry_offset = offset + (i * entry_size)
            
            try:
                cmd_id = struct.unpack('<H', self.binary_data[entry_offset:entry_offset+2])[0]
                
                if entry_size == 6:
                    handler_addr = struct.unpack('<I', self.binary_data[entry_offset+2:entry_offset+6])[0]
                    print(f"  Command {cmd_id:2d}: Handler 0x{handler_addr:08x}")
                else:  # 8-byte
                    padding = struct.unpack('<H', self.binary_data[entry_offset+2:entry_offset+4])[0]
                    handler_addr = struct.unpack('<I', self.binary_data[entry_offset+4:entry_offset+8])[0]
                    print(f"  Command {cmd_id:2d}: Padding 0x{padding:04x}, Handler 0x{handler_addr:08x}")
                
                # Add context from known commands
                if cmd_id in self.known_commands:
                    info = self.known_commands[cmd_id]
                    print(f"              {info['name']} ({info['status']})")
                    
            except (struct.error, IndexError) as e:
                print(f"  Entry {i}: Parse error - {e}")
    
    def search_handler_functions(self):
        """Search for potential command handler function signatures"""
        print("\nSearching for command handler function signatures...")
        
        # ARM Thumb function prologue patterns
        # Common patterns: push {lr}, push {r4-r7,lr}, etc.
        thumb_patterns = [
            b'\x00\xb5',  # push {lr}
            b'\x10\xb5',  # push {r4, lr}  
            b'\x30\xb5',  # push {r4, r5, lr}
            b'\x70\xb5',  # push {r4-r6, lr}
            b'\xf0\xb5',  # push {r4-r7, lr}
        ]
        
        handler_candidates = []
        
        for pattern in thumb_patterns:
            pos = 0
            while pos < len(self.binary_data):
                pos = self.binary_data.find(pattern, pos)
                if pos == -1:
                    break
                
                # Check if this address could be a handler (Thumb functions have odd addresses)
                thumb_addr = pos | 1
                
                # Look for references to this address in our command patterns
                addr_bytes = struct.pack('<I', thumb_addr)
                if addr_bytes in self.binary_data:
                    handler_candidates.append((pos, thumb_addr, pattern.hex()))
                
                pos += 1
        
        print(f"Found {len(handler_candidates)} potential handler functions")
        
        # Show first 10
        for i, (pos, addr, pattern) in enumerate(handler_candidates[:10]):
            print(f"  Handler {i+1}: 0x{pos:08x} (Thumb: 0x{addr:08x}) Pattern: {pattern}")
    
    def analyze_command_14_15_context(self):
        """Detailed analysis of commands 14 and 15 context"""
        print("\nDetailed analysis of commands 14 and 15...")
        
        for cmd_id in [14, 15]:
            print(f"\n--- Command {cmd_id} Analysis ---")
            
            # Find all occurrences
            cmd_bytes = struct.pack('<H', cmd_id)
            positions = []
            pos = 0
            
            while pos < len(self.binary_data) and len(positions) < 5:
                pos = self.binary_data.find(cmd_bytes, pos)
                if pos == -1:
                    break
                positions.append(pos)
                pos += 1
            
            for i, pos in enumerate(positions):
                print(f"\nOccurrence {i+1} at 0x{pos:x}:")
                
                # Show larger context
                start = max(0, pos - 16)
                end = min(len(self.binary_data), pos + 32)
                context = self.binary_data[start:end]
                
                # Try to parse as potential table entry
                if pos + 6 <= len(self.binary_data):
                    try:
                        handler_candidate = struct.unpack('<I', self.binary_data[pos+2:pos+6])[0]
                        
                        print(f"  Raw bytes: {' '.join(f'{b:02x}' for b in context)}")
                        print(f"  Potential handler: 0x{handler_candidate:08x}")
                        
                        # Check if handler address looks valid
                        if (0x08000000 <= handler_candidate <= 0x08100000 or
                            0x20000000 <= handler_candidate <= 0x20080000 or
                            0x00000000 <= handler_candidate <= 0x00100000):
                            print(f"  [OK] Handler address in valid ARM range")
                            
                            # Try to find function at this address
                            if handler_candidate % 2 == 1:  # Thumb function
                                func_addr = handler_candidate - 1
                                if func_addr < len(self.binary_data):
                                    func_bytes = self.binary_data[func_addr:func_addr+8]
                                    print(f"  Function bytes: {' '.join(f'{b:02x}' for b in func_bytes)}")
                        else:
                            print(f"  [X] Handler address not in expected ARM range")
                            
                    except (struct.error, IndexError):
                        print(f"  Parse error at offset")


def main():
    zephyr_path = r"E:\Code\hidock-next\firmware\hidock-h1e\6.2.5\partitions\zephyr.bin"
    
    print("Jensen Protocol Reverse Engineering Analysis")
    print("=" * 50)
    print(f"Analyzing: {zephyr_path}")
    
    if not Path(zephyr_path).exists():
        print(f"Error: File not found: {zephyr_path}")
        return 1
    
    reverser = JensenProtocolReverser(zephyr_path)
    
    # Find dispatch tables
    dispatch_candidates = reverser.find_command_dispatch_table()
    
    if dispatch_candidates:
        print(f"\nFound {len(dispatch_candidates)} potential dispatch tables:")
        for offset, count, structure_type in dispatch_candidates[:3]:  # Show top 3
            reverser.analyze_dispatch_table(offset, count, structure_type)
    else:
        print("\nNo clear dispatch tables found with expected structure")
    
    # Search for handler functions
    reverser.search_handler_functions()
    
    # Detailed analysis of commands 14 and 15
    reverser.analyze_command_14_15_context()
    
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