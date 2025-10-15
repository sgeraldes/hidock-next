# -*- coding: utf-8-sig -*-
#!/usr/bin/env python3
"""
Direct HiDock Tester - No Health Checks

Connects directly to the device bypassing all health check logic.

Author: HiDock Research Project
Version: 1.0.0
Date: 2025-09-01
"""

import sys
import os
import time
import struct
import usb.core
import usb.util
import usb.backend.libusb1
from improved_response_decoder import ImprovedHiDockDecoder

# Constants
VENDOR_ID = 0x10D6
PRODUCT_ID = 0xB00D
EP_OUT = 0x01
EP_IN = 0x82

class DirectHiDockTester:
    def __init__(self):
        self.device = None
        self.decoder = ImprovedHiDockDecoder()
        self.sequence_id = 0
        self.backend = None
        self._init_backend()
        
    def _init_backend(self):
        """Initialize USB backend"""
        # Try to find libusb DLL
        app_dir = os.path.join(os.path.dirname(__file__), '..', '..', 'hidock-desktop-app')
        lib_path = os.path.join(app_dir, 'libusb-1.0.dll')
        
        if os.path.exists(lib_path):
            print(f"Using libusb from: {lib_path}")
            self.backend = usb.backend.libusb1.get_backend(find_library=lambda x: lib_path)
        else:
            print("Using system libusb")
            self.backend = usb.backend.libusb1.get_backend()
            
        if not self.backend:
            print("WARNING: No USB backend found!")
        
    def connect(self):
        """Connect to HiDock device"""
        print("Searching for HiDock device...")
        
        # Find device
        self.device = usb.core.find(idVendor=VENDOR_ID, idProduct=PRODUCT_ID, backend=self.backend)
        
        if self.device is None:
            print(f"Device not found (VID: 0x{VENDOR_ID:04x}, PID: 0x{PRODUCT_ID:04x})")
            return False
            
        print("Device found!")
        
        try:
            # Set configuration
            self.device.set_configuration()
            print("Device configured")
            
            # Clear any stale data
            try:
                while True:
                    self.device.read(EP_IN, 64, timeout=100)
            except:
                pass  # No more data to read
                
            print("Device ready")
            return True
            
        except Exception as e:
            print(f"Connection error: {e}")
            return False
            
    def disconnect(self):
        """Disconnect from device"""
        if self.device:
            try:
                usb.util.dispose_resources(self.device)
            except:
                pass
            self.device = None
        print("Disconnected")
        
    def build_packet(self, command_id, data):
        """Build a packet for sending (Jensen protocol)"""
        # Jensen packet format:
        # 0x12 0x34 (sync bytes)
        # Command ID (2 bytes, big-endian)
        # Sequence ID (4 bytes, big-endian)
        # Body length (4 bytes, big-endian)
        # Body data
        
        self.sequence_id = (self.sequence_id + 1) & 0xFFFFFFFF
        
        packet = bytearray([0x12, 0x34])  # Sync bytes
        packet.extend(struct.pack('>H', command_id))  # Command ID (2 bytes, big-endian)
        packet.extend(struct.pack('>I', self.sequence_id))  # Sequence ID (4 bytes, big-endian)
        packet.extend(struct.pack('>I', len(data)))  # Body length (4 bytes, big-endian)
        packet.extend(data)  # Body
        
        return bytes(packet)
        
    def send_command(self, command_id, data=b''):
        """Send command and get response"""
        if not self.device:
            print("Not connected")
            return None
            
        try:
            # Build and send packet
            packet = self.build_packet(command_id, data)
            print(f"\nSending Command {command_id}, {len(data)} bytes data")
            print(f"Packet: {packet.hex()[:50]}...")
            
            self.device.write(EP_OUT, packet)
            
            # Read response
            response_data = bytearray()
            start_time = time.time()
            timeout = 5.0
            expected_len = None
            
            while time.time() - start_time < timeout:
                try:
                    # Read in chunks
                    chunk = self.device.read(EP_IN, 512, timeout=1000)
                    response_data.extend(chunk)
                    
                    # Check if we have enough for header (Jensen format)
                    if expected_len is None and len(response_data) >= 12:
                        # Check for sync bytes
                        if response_data[0:2] == b'\x12\x34':
                            # Parse header to get body length
                            body_len = struct.unpack('>I', response_data[8:12])[0]
                            expected_len = 12 + body_len
                            print(f"Expecting {expected_len} bytes total ({body_len} body)")
                            
                            # For very large responses, extend timeout
                            if body_len > 1000:
                                timeout = 10.0
                    
                    # Check if we have complete response
                    if expected_len and len(response_data) >= expected_len:
                        print(f"Got complete response: {len(response_data)} bytes")
                        break
                        
                    # Continue reading if we know we need more
                    if expected_len and len(response_data) < expected_len:
                        continue
                        
                except usb.core.USBTimeoutError:
                    # Timeout is normal when no more data
                    if expected_len and len(response_data) >= expected_len:
                        break
                    elif not expected_len and response_data:
                        # We have some data but don't know expected length
                        break
                    continue
                except Exception as e:
                    print(f"Read error: {e}")
                    break
                    
            if not response_data:
                print("No response")
                return None
                
            # Parse response (Jensen format)
            if len(response_data) < 12 or response_data[0:2] != b'\x12\x34':
                print(f"Invalid response: {response_data.hex()[:100]}...")
                return None
                
            resp_cmd = struct.unpack('>H', response_data[2:4])[0]
            resp_seq = struct.unpack('>I', response_data[4:8])[0]
            resp_len = struct.unpack('>I', response_data[8:12])[0]
            
            body_end = 12 + resp_len
            if len(response_data) >= body_end:
                body = response_data[12:body_end]
                
                print(f"Response: Command {resp_cmd}, Seq {resp_seq}, {len(body)} bytes")
                
                if body:
                    # Show sample of raw data
                    if len(body) > 100:
                        print(f"Raw data (first 100 bytes): {body.hex()[:100]}...")
                    else:
                        print(f"Raw data: {body.hex()}")
                    
                    # Try to decode
                    decoded = self.decoder.decode_response(command_id, body.hex())
                    if decoded:
                        print("\nDECODED:")
                        print("-" * 40)
                        print(decoded)
                else:
                    print("Empty response body")
                    
                return body
            else:
                # Partial response - still try to decode what we have
                print(f"Warning: Incomplete response (expected {body_end} bytes, got {len(response_data)})")
                if len(response_data) > 12:
                    body = response_data[12:]
                    print(f"Partial data ({len(body)} bytes): {body.hex()[:100]}...")
                    
                    # Try to decode partial response
                    decoded = self.decoder.decode_response(command_id, body.hex())
                    if decoded:
                        print("\nPARTIAL DECODE:")
                        print("-" * 40)
                        print(decoded)
                    return body
                return None
                
        except Exception as e:
            print(f"Command error: {e}")
            return None
            
    def interactive_menu(self):
        """Interactive command menu"""
        commands = {
            '1': (1, b'', "GET_DEVICE_INFO"),
            '2': (2, b'', "GET_DEVICE_TIME"),
            '3': (4, b'', "GET_FILE_LIST"),
            '4': (6, b'', "GET_FILE_COUNT"),
            '5': (16, b'', "GET_CARD_INFO"),
            '6': (11, b'', "GET_SETTINGS"),
            '7': (10, b'\x00\x12\x34\x10', "START_DEMO"),
            '8': (10, b'\x00\x00\x00\x00', "STOP_DEMO"),
            '9': (14, b'', "COMMAND_14"),
            '10': (15, b'', "COMMAND_15"),
            'c': (None, None, "CUSTOM_COMMAND"),
            'q': (None, None, "QUIT")
        }
        
        while True:
            print("\n" + "="*60)
            print("DIRECT HIDOCK TESTER")
            print("="*60)
            
            for key, (cmd, data, desc) in commands.items():
                if cmd is not None:
                    print(f"{key}. {desc} (Command {cmd})")
                else:
                    print(f"{key}. {desc}")
                    
            choice = input("\nSelect option: ").strip().lower()
            
            if choice == 'q':
                break
            elif choice == 'c':
                # Custom command
                try:
                    cmd_id = int(input("Enter command ID (1-20): "))
                    hex_data = input("Enter hex data (or empty): ").strip()
                    data = bytes.fromhex(hex_data) if hex_data else b''
                    self.send_command(cmd_id, data)
                except Exception as e:
                    print(f"Error: {e}")
            elif choice in commands:
                cmd_id, data, desc = commands[choice]
                if cmd_id is not None:
                    print(f"\nExecuting: {desc}")
                    self.send_command(cmd_id, data)
            else:
                print("Invalid option")
                
def main():
    tester = DirectHiDockTester()
    
    if tester.connect():
        try:
            tester.interactive_menu()
        except KeyboardInterrupt:
            print("\n\nInterrupted")
        finally:
            tester.disconnect()
    else:
        print("Failed to connect to device")
        
if __name__ == "__main__":
    main()