# -*- coding: utf-8-sig -*-
#!/usr/bin/env python3
"""
Working Command Analysis

Analyze how working commands (like Command 4: GET_FILE_LIST) are structured
to understand the proper parameter format for Commands 14 & 15.

Author: HiDock Hardware Analysis Project
Version: 1.0.0
Date: 2025-08-31
"""

import struct
import json
from pathlib import Path

class WorkingCommandAnalyzer:
    def __init__(self):
        self.known_working_commands = {
            1: ("GET_DEVICE_INFO", "Returns device information"),
            2: ("GET_DEVICE_TIME", "Returns current time"), 
            3: ("SET_DEVICE_TIME", "Sets device time"),
            4: ("GET_FILE_LIST", "Returns file listing"),
            5: ("TRANSFER_FILE", "Downloads file data"),
            6: ("GET_FILE_COUNT", "Returns file count"),
            7: ("DELETE_FILE", "Deletes specified file"),
            8: ("REQUEST_FIRMWARE_UPGRADE", "Prepares firmware update"),
            9: ("FIRMWARE_UPLOAD", "Uploads firmware data"),
            11: ("GET_SETTINGS", "Returns device settings"),
            12: ("SET_SETTINGS", "Updates device settings"),
            13: ("GET_FILE_BLOCK", "Returns file block data"),
            16: ("GET_CARD_INFO", "Returns storage info"),
            17: ("FORMAT_CARD", "Formats storage"),
            18: ("GET_RECORDING_FILE", "Returns recording metadata"),
            19: ("RESTORE_FACTORY_SETTINGS", "Factory reset"),
            20: ("SEND_MEETING_SCHEDULE_INFO", "Calendar integration"),
        }
        
        self.known_parameters = {
            # Commands that work with empty parameters
            1: b"",     # GET_DEVICE_INFO
            2: b"",     # GET_DEVICE_TIME  
            6: b"",     # GET_FILE_COUNT
            11: b"",    # GET_SETTINGS
            16: b"",    # GET_CARD_INFO
            19: b"",    # RESTORE_FACTORY_SETTINGS
            
            # Commands that need parameters
            3: struct.pack('<Q', 1693478400),  # SET_DEVICE_TIME (example timestamp)
            4: struct.pack('<H', 0),           # GET_FILE_LIST (start index)  
            5: struct.pack('<I', 1),           # TRANSFER_FILE (file ID)
            7: struct.pack('<I', 999),         # DELETE_FILE (file ID) 
            13: struct.pack('<IH', 1, 0),      # GET_FILE_BLOCK (file ID, block)
            18: struct.pack('<I', 1),          # GET_RECORDING_FILE (file ID)
        }
    
    def analyze_parameter_patterns(self):
        """Analyze parameter patterns from working commands"""
        print("WORKING COMMAND PARAMETER ANALYSIS")
        print("=" * 50)
        
        print(f"\nParameter patterns from working commands:")
        
        for cmd_id, params in self.known_parameters.items():
            cmd_name = self.known_working_commands[cmd_id][0]
            param_hex = params.hex() if params else "(empty)"
            param_len = len(params)
            
            print(f"Command {cmd_id:2d} ({cmd_name}):")
            print(f"  Parameters: {param_hex}")
            print(f"  Length: {param_len} bytes")
            
            if params:
                # Try to interpret parameters
                if param_len == 2:
                    val = struct.unpack('<H', params)[0]
                    print(f"  Interpreted as uint16: {val}")
                elif param_len == 4:
                    val = struct.unpack('<I', params)[0]
                    print(f"  Interpreted as uint32: {val}")
                elif param_len == 8:
                    val = struct.unpack('<Q', params)[0]
                    print(f"  Interpreted as uint64: {val}")
                elif param_len == 6:
                    val1 = struct.unpack('<I', params[:4])[0]
                    val2 = struct.unpack('<H', params[4:6])[0]
                    print(f"  Interpreted as uint32 + uint16: {val1}, {val2}")
            
            print()
    
    def generate_structured_parameters(self):
        """Generate structured parameter combinations based on working commands"""
        print("STRUCTURED PARAMETER GENERATION")
        print("=" * 50)
        
        # Based on working command patterns, generate systematic parameters
        parameter_sets = []
        
        # 1. Empty parameters (like commands 1, 2, 6, 11, 16, 19)
        parameter_sets.append((b"", "Empty (like GET_DEVICE_INFO)"))
        
        # 2. Single 16-bit values (like command 4: GET_FILE_LIST)
        for val in [0, 1, 2, 10, 100, 0xFFFF]:
            params = struct.pack('<H', val)
            parameter_sets.append((params, f"uint16: {val}"))
        
        # 3. Single 32-bit values (like commands 5, 7, 18)
        for val in [0, 1, 2, 10, 100, 1000, 0xFFFFFFFF]:
            params = struct.pack('<I', val)
            parameter_sets.append((params, f"uint32: {val}"))
        
        # 4. 64-bit timestamp (like command 3: SET_DEVICE_TIME)
        import time
        current_timestamp = int(time.time())
        for offset in [0, -3600, 3600]:  # current, -1h, +1h
            timestamp = current_timestamp + offset
            params = struct.pack('<Q', timestamp)
            parameter_sets.append((params, f"timestamp: {timestamp}"))
        
        # 5. Composite structures (like command 13: GET_FILE_BLOCK)
        for file_id in [0, 1, 2]:
            for block_num in [0, 1]:
                params = struct.pack('<IH', file_id, block_num)
                parameter_sets.append((params, f"file_id={file_id}, block={block_num}"))
        
        # 6. Command-specific patterns
        # Maybe Commands 14/15 expect command references?
        for cmd_ref in [1, 4, 6, 11]:  # Reference other working commands
            params = struct.pack('<H', cmd_ref)
            parameter_sets.append((params, f"command_ref: {cmd_ref}"))
        
        # 7. Status/flag patterns
        for status in [0x00, 0x01, 0xFF]:
            params = struct.pack('<B', status)
            parameter_sets.append((params, f"status_flag: 0x{status:02x}"))
        
        # 8. Device state queries
        for state_id in [0, 1, 2, 3, 14, 15]:  # Including self-reference
            params = struct.pack('<H', state_id)
            parameter_sets.append((params, f"state_query: {state_id}"))
        
        print(f"Generated {len(parameter_sets)} structured parameter combinations:")
        for i, (params, desc) in enumerate(parameter_sets):
            param_hex = params.hex() if params else "(empty)"
            print(f"{i+1:2d}. {desc:<30} -> {param_hex}")
        
        return parameter_sets
    
    def create_hypothesis_based_tests(self):
        """Create test parameters based on specific hypotheses"""
        print(f"\nHYPOTHESIS-BASED TEST PARAMETERS")
        print("=" * 50)
        
        hypothesis_tests = []
        
        # Hypothesis 1: Commands 14/15 are query commands for other command status
        print("Hypothesis 1: Query command status")
        for cmd_id in [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 16, 17, 18, 19, 20]:
            params = struct.pack('<H', cmd_id)
            hypothesis_tests.append((params, f"Query status of command {cmd_id}"))
        
        # Hypothesis 2: Commands 14/15 are debug info for specific subsystems
        print("\nHypothesis 2: Debug info requests")
        debug_subsystems = [
            (0x01, "USB subsystem"),
            (0x02, "Audio subsystem"), 
            (0x03, "Storage subsystem"),
            (0x04, "Power management"),
            (0x05, "Firmware subsystem"),
            (0x0E, "Command 14 subsystem"),
            (0x0F, "Command 15 subsystem"),
        ]
        for subsystem_id, desc in debug_subsystems:
            params = struct.pack('<B', subsystem_id)
            hypothesis_tests.append((params, f"Debug info: {desc}"))
        
        # Hypothesis 3: Commands 14/15 are device state queries
        print("\nHypothesis 3: Device state queries")
        state_queries = [
            (0x0000, "General device state"),
            (0x0001, "Recording state"),
            (0x0002, "Playback state"),
            (0x0003, "Storage state"),
            (0x0004, "Battery state"),
            (0x000E, "Command 14 state"),
            (0x000F, "Command 15 state"),
        ]
        for state_id, desc in state_queries:
            params = struct.pack('<H', state_id)
            hypothesis_tests.append((params, f"State query: {desc}"))
        
        # Hypothesis 4: Commands 14/15 expect authentication tokens
        print("\nHypothesis 4: Authentication tokens")
        auth_tokens = [
            (b"\x12\x34", "Jensen magic partial"),
            (b"\x12\x34\x00\x0E", "Jensen magic + cmd 14"),
            (b"\x12\x34\x00\x0F", "Jensen magic + cmd 15"),
            (b"\x00\x0E\x12\x34", "Cmd 14 + Jensen magic"),
            (b"\x00\x0F\x12\x34", "Cmd 15 + Jensen magic"),
        ]
        for token, desc in auth_tokens:
            hypothesis_tests.append((token, f"Auth token: {desc}"))
        
        print(f"\nGenerated {len(hypothesis_tests)} hypothesis-based tests:")
        for i, (params, desc) in enumerate(hypothesis_tests):
            param_hex = params.hex() if params else "(empty)"
            print(f"{i+1:2d}. {desc:<35} -> {param_hex}")
        
        return hypothesis_tests

def main():
    print("Working Command Analysis for Commands 14 & 15")
    print("=" * 60)
    
    analyzer = WorkingCommandAnalyzer()
    
    # Analyze parameter patterns from working commands
    analyzer.analyze_parameter_patterns()
    
    # Generate structured parameters based on working patterns
    structured_params = analyzer.generate_structured_parameters()
    
    # Create hypothesis-based test parameters
    hypothesis_params = analyzer.create_hypothesis_based_tests()
    
    # Combine all parameters for testing
    all_test_params = structured_params + hypothesis_params
    
    print(f"\nTOTAL TEST PARAMETERS GENERATED: {len(all_test_params)}")
    print("Ready for systematic testing of Commands 14 & 15")
    
    # Save parameters to JSON for use in testing script
    test_data = {
        "generation_timestamp": "2025-08-31",
        "total_parameters": len(all_test_params),
        "structured_count": len(structured_params),
        "hypothesis_count": len(hypothesis_params),
        "parameters": [
            {
                "index": i + 1,
                "hex": params.hex() if params else "",
                "bytes": len(params),
                "description": desc
            }
            for i, (params, desc) in enumerate(all_test_params)
        ]
    }
    
    output_file = "structured_test_parameters.json"
    with open(output_file, 'w') as f:
        json.dump(test_data, f, indent=2)
    
    print(f"\nTest parameters saved to: {output_file}")
    
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