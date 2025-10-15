# -*- coding: utf-8-sig -*-
#!/usr/bin/env python3
"""
HiDock Command Tester Console

Interactive console application for testing HiDock commands with custom parameters.

Author: HiDock Research Project
Version: 1.0.0
Date: 2025-08-31
"""

import sys
import os
import time
import struct
from datetime import datetime
from pathlib import Path

# Add parent directory to path for imports
sys.path.append(str(Path(__file__).parent.parent / "command-10-discovery"))

from safe_testing_framework import SafeCommandTester
from response_decoder import HiDockResponseDecoder

class ConsoleCommandTester:
    def __init__(self):
        self.tester = None
        self.connected = False
        self.decoder = HiDockResponseDecoder()
        
        # Command definitions
        self.commands = {
            1: "GET_DEVICE_INFO",
            2: "GET_DEVICE_TIME",
            3: "SET_DEVICE_TIME",
            4: "GET_FILE_LIST",
            5: "TRANSFER_FILE",
            6: "GET_FILE_COUNT",
            7: "DELETE_FILE",
            8: "REQUEST_FIRMWARE_UPGRADE",
            9: "FIRMWARE_UPLOAD",
            10: "DEMO_CONTROL",
            11: "GET_SETTINGS",
            12: "SET_SETTINGS",
            13: "GET_FILE_BLOCK",
            14: "UNKNOWN_14 (Empty Response)",
            15: "UNKNOWN_15 (Empty Response)",
            16: "GET_CARD_INFO",
            17: "FORMAT_CARD",
            18: "GET_RECORDING_FILE",
            19: "RESTORE_FACTORY_SETTINGS",
            20: "SEND_MEETING_SCHEDULE_INFO"
        }
        
        # Quick parameter templates
        self.quick_params = {
            '1': ('Empty', b''),
            '2': ('Single Null', b'\x00'),
            '3': ('Double Null', b'\x00\x00'),
            '4': ('Quad Null', b'\x00\x00\x00\x00'),
            '5': ('Demo Start', b'\x00\x12\x34\x10'),  # 34121000 in little-endian
            '6': ('Demo Stop', b'\x00\x00\x00\x00'),
            '7': ('File ID 0', b'\x00\x00\x00\x00'),
            '8': ('File ID 1', b'\x01\x00\x00\x00'),
            '9': ('Index 0', b'\x00\x00'),
            '10': ('Index 1', b'\x01\x00'),
        }
        
    def print_header(self):
        """Print application header"""
        print("="*60)
        print("HIDOCK COMMAND TESTER - Console Version")
        print("="*60)
        print()
        
    def print_menu(self):
        """Print main menu"""
        print("\n" + "="*60)
        print("MAIN MENU")
        print("="*60)
        
        if self.connected:
            print("[Status: CONNECTED]")
            print()
            print("1. Send Command")
            print("2. Quick Test (Common Commands)")
            print("3. Batch Test")
            print("4. Disconnect Device")
        else:
            print("[Status: DISCONNECTED]")
            print()
            print("1. Connect Device")
            
        print("0. Exit")
        print("-"*60)
        
    def connect_device(self):
        """Connect to HiDock device"""
        print("\nConnecting to device...")
        
        try:
            self.tester = SafeCommandTester()
            
            if not self.tester.initialize_backend():
                print("[ERROR] Failed to initialize USB backend")
                return False
                
            if not self.tester.connect_device():
                print("[ERROR] Failed to connect to device")
                return False
                
            self.connected = True
            print("[SUCCESS] Device connected!")
            
            # Get device info
            self.get_device_info()
            return True
            
        except Exception as e:
            print(f"[ERROR] Connection failed: {e}")
            return False
            
    def disconnect_device(self):
        """Disconnect from device"""
        if self.tester:
            self.tester.cleanup()
            self.tester = None
            
        self.connected = False
        print("\n[INFO] Device disconnected")
        
    def get_device_info(self):
        """Get and display device information"""
        try:
            result = self.tester.safe_command_test(1, b'', "GET_DEVICE_INFO")
            
            if result['status'] == 'success':
                response = result.get('response', {})
                body = response.get('body_hex', '')
                
                if body:
                    print(f"[INFO] Device Info: {body[:20]}...")
                    
        except Exception as e:
            print(f"[WARNING] Could not get device info: {e}")
            
    def send_command(self):
        """Interactive command sending"""
        print("\n" + "="*60)
        print("SEND COMMAND")
        print("="*60)
        
        # Show available commands
        print("\nAvailable Commands:")
        for cmd_id, name in self.commands.items():
            print(f"  {cmd_id:2d}: {name}")
        
        # Get command selection
        try:
            cmd_id = int(input("\nEnter command ID (1-20): "))
            if cmd_id not in self.commands:
                print("[ERROR] Invalid command ID")
                return
        except ValueError:
            print("[ERROR] Invalid input")
            return
            
        cmd_name = self.commands[cmd_id]
        print(f"\nSelected: Command {cmd_id} - {cmd_name}")
        
        # Get parameters
        print("\nParameter Options:")
        print("  1. Empty (no parameters)")
        print("  2. Quick select from templates")
        print("  3. Enter hex manually")
        
        param_choice = input("\nChoice (1-3): ").strip()
        
        param_bytes = b''
        
        if param_choice == '1':
            param_bytes = b''
            print("Using: Empty parameters")
            
        elif param_choice == '2':
            print("\nQuick Templates:")
            for key, (name, data) in self.quick_params.items():
                print(f"  {key}: {name} ({data.hex()})")
            
            template = input("\nSelect template: ").strip()
            if template in self.quick_params:
                name, param_bytes = self.quick_params[template]
                print(f"Using: {name} ({param_bytes.hex()})")
            else:
                print("[ERROR] Invalid template")
                return
                
        elif param_choice == '3':
            hex_str = input("\nEnter hex bytes (e.g., '01020304' or '01 02 03 04'): ").strip()
            hex_str = hex_str.replace(" ", "").replace(",", "")
            
            try:
                param_bytes = bytes.fromhex(hex_str)
                print(f"Using: {param_bytes.hex()}")
            except ValueError:
                print("[ERROR] Invalid hex data")
                return
        else:
            print("[ERROR] Invalid choice")
            return
            
        # Send command
        print("\n" + "-"*60)
        print(f"SENDING: Command {cmd_id} with {len(param_bytes)} bytes")
        print(f"Parameters: {param_bytes.hex() if param_bytes else '(empty)'}")
        print("-"*60)
        
        try:
            start_time = time.time()
            result = self.tester.safe_command_test(cmd_id, param_bytes, cmd_name)
            elapsed = time.time() - start_time
            
            if result['status'] == 'success':
                response = result.get('response', {})
                body_hex = response.get('body_hex', '')
                
                print(f"\n[SUCCESS] Response received in {elapsed:.3f}s")
                
                if body_hex:
                    print(f"Response data: {body_hex}")
                    
                    # Try to decode
                    self.decode_response(cmd_id, body_hex)
                else:
                    print("Response: (empty)")
                    
                # Health check
                if self.tester.test_device_health():
                    print("[OK] Device health check passed")
                else:
                    print("[WARNING] Device health check failed")
                    
            else:
                print(f"\n[ERROR] Command failed: {result.get('error', 'Unknown error')}")
                
        except Exception as e:
            print(f"\n[ERROR] Failed to send command: {e}")
            
    def quick_test(self):
        """Quick test common commands"""
        print("\n" + "="*60)
        print("QUICK TEST")
        print("="*60)
        
        tests = [
            (1, b'', "GET_DEVICE_INFO"),
            (2, b'', "GET_DEVICE_TIME"),
            (6, b'', "GET_FILE_COUNT"),
            (16, b'', "GET_CARD_INFO"),
            (10, b'\x00\x12\x34\x10', "START_DEMO"),
            (10, b'\x00\x00\x00\x00', "STOP_DEMO"),
            (14, b'', "TEST_CMD_14"),
            (15, b'', "TEST_CMD_15"),
        ]
        
        print("\nRunning quick tests...")
        
        for cmd_id, params, desc in tests:
            print(f"\nTesting: {desc} (Command {cmd_id})")
            print(f"Parameters: {params.hex() if params else '(empty)'}")
            
            try:
                result = self.tester.safe_command_test(cmd_id, params, desc)
                
                if result['status'] == 'success':
                    response = result.get('response', {}).get('body_hex', '')
                    if response:
                        print(f"  Response: {response[:40]}...")
                    else:
                        print(f"  Response: (empty)")
                else:
                    print(f"  Failed: {result.get('error', 'Unknown')}")
                    
            except Exception as e:
                print(f"  Error: {e}")
                
            time.sleep(0.5)
            
        print("\n[COMPLETE] Quick test finished")
        
    def batch_test(self):
        """Batch test with custom parameters"""
        print("\n" + "="*60)
        print("BATCH TEST")
        print("="*60)
        
        print("\nEnter commands to test (one per line)")
        print("Format: <command_id> <hex_params>")
        print("Example: 10 34121000")
        print("Enter blank line to finish")
        print("-"*60)
        
        tests = []
        while True:
            line = input("> ").strip()
            if not line:
                break
                
            parts = line.split(maxsplit=1)
            if len(parts) == 1:
                # Command with no parameters
                try:
                    cmd_id = int(parts[0])
                    tests.append((cmd_id, b''))
                except ValueError:
                    print("[ERROR] Invalid command ID")
                    continue
            else:
                # Command with parameters
                try:
                    cmd_id = int(parts[0])
                    hex_str = parts[1].replace(" ", "").replace(",", "")
                    params = bytes.fromhex(hex_str)
                    tests.append((cmd_id, params))
                except (ValueError, IndexError):
                    print("[ERROR] Invalid format")
                    continue
                    
        if not tests:
            print("[INFO] No tests to run")
            return
            
        print(f"\n[INFO] Running {len(tests)} tests...")
        
        for i, (cmd_id, params) in enumerate(tests, 1):
            cmd_name = self.commands.get(cmd_id, f"UNKNOWN_{cmd_id}")
            print(f"\n[{i}/{len(tests)}] Command {cmd_id}: {cmd_name}")
            print(f"  Parameters: {params.hex() if params else '(empty)'}")
            
            try:
                result = self.tester.safe_command_test(cmd_id, params, cmd_name)
                
                if result['status'] == 'success':
                    response = result.get('response', {}).get('body_hex', '')
                    if response:
                        print(f"  Response: {response[:60]}...")
                    else:
                        print(f"  Response: (empty)")
                else:
                    print(f"  Failed: {result.get('error', 'Unknown')}")
                    
            except Exception as e:
                print(f"  Error: {e}")
                
            time.sleep(0.5)
            
        print("\n[COMPLETE] Batch test finished")
        
    def decode_response(self, cmd_id, hex_data):
        """Try to decode response data"""
        try:
            # Use the comprehensive decoder
            decoded = self.decoder.decode_response(cmd_id, hex_data)
            
            if decoded:
                # Print the decoded data in a formatted way
                print("\n  --- DECODED RESPONSE ---")
                for line in decoded.split('\n'):
                    if line.strip():
                        print(f"  {line}")
                print("  --- END DECODED ---\n")
            else:
                # If decoder returns None, try showing ASCII if printable
                data = bytes.fromhex(hex_data)
                ascii_str = ''.join(chr(b) if 32 <= b <= 126 else '.' for b in data)
                if any(32 <= b <= 126 for b in data):
                    print(f"  ASCII representation: {ascii_str}")
                    
        except Exception as e:
            # If we can't decode, that's fine
            print(f"  Could not decode response: {e}")
            
    def run(self):
        """Main application loop"""
        self.print_header()
        
        while True:
            self.print_menu()
            
            choice = input("\nEnter choice: ").strip()
            
            if choice == '0':
                if self.connected:
                    self.disconnect_device()
                print("\nGoodbye!")
                break
                
            elif not self.connected and choice == '1':
                self.connect_device()
                
            elif self.connected:
                if choice == '1':
                    self.send_command()
                elif choice == '2':
                    self.quick_test()
                elif choice == '3':
                    self.batch_test()
                elif choice == '4':
                    self.disconnect_device()
                else:
                    print("[ERROR] Invalid choice")
            else:
                print("[ERROR] Invalid choice")
                
            if self.connected:
                input("\nPress Enter to continue...")

def main():
    try:
        app = ConsoleCommandTester()
        app.run()
    except KeyboardInterrupt:
        print("\n\n[INFO] Interrupted by user")
    except Exception as e:
        print(f"\n[ERROR] Unexpected error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main()