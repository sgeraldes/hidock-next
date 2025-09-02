# -*- coding: utf-8-sig -*-
#!/usr/bin/env python3
"""
Test Script for HiDock Response Decoder

Demonstrates how the decoder parses different response types.

Author: HiDock Research Project
Version: 1.0.0
Date: 2025-09-01
"""

from response_decoder import HiDockResponseDecoder
import struct
from datetime import datetime

def test_decoder():
    """Test the decoder with sample responses"""
    decoder = HiDockResponseDecoder()
    
    print("="*60)
    print("HIDOCK RESPONSE DECODER TEST")
    print("="*60)
    print()
    
    # Test 1: Device Info (Command 1)
    print("Test 1: GET_DEVICE_INFO (Command 1)")
    print("-"*40)
    # Sample device info response (firmware version, build, serial)
    device_info_hex = "312e302e31000000000000000000000000323032353038333100000000000000004831453132333435363738393031323334353637383900"
    result = decoder.decode_response(1, device_info_hex)
    print(result if result else "No decode available")
    print()
    
    # Test 2: Device Time (Command 2)
    print("Test 2: GET_DEVICE_TIME (Command 2)")
    print("-"*40)
    # Current timestamp as 8-byte little-endian
    timestamp = int(datetime.now().timestamp())
    time_hex = struct.pack('<Q', timestamp).hex()
    result = decoder.decode_response(2, time_hex)
    print(result if result else "No decode available")
    print()
    
    # Test 3: File List (Command 4)
    print("Test 3: GET_FILE_LIST (Command 4)")
    print("-"*40)
    # Sample file list with 2 files
    # File 1: ID=1, Timestamp, Size=1024KB, Name="REC001.wav"
    # File 2: ID=2, Timestamp, Size=2048KB, Name="REC002.wav"
    file1_id = struct.pack('<I', 1)
    file1_time = struct.pack('<Q', int(datetime.now().timestamp()))
    file1_size = struct.pack('<I', 1024000)
    file1_name = b"REC001.wav\x00"
    
    file2_id = struct.pack('<I', 2)
    file2_time = struct.pack('<Q', int(datetime.now().timestamp()) - 3600)
    file2_size = struct.pack('<I', 2048000)
    file2_name = b"REC002.wav\x00"
    
    file_list_hex = (file1_id + file1_time + file1_size + file1_name + 
                     file2_id + file2_time + file2_size + file2_name).hex()
    result = decoder.decode_response(4, file_list_hex)
    print(result if result else "No decode available")
    print()
    
    # Test 4: File Count (Command 6)
    print("Test 4: GET_FILE_COUNT (Command 6)")
    print("-"*40)
    # 10 files
    count_hex = struct.pack('<I', 10).hex()
    result = decoder.decode_response(6, count_hex)
    print(result if result else "No decode available")
    print()
    
    # Test 5: Settings (Command 11)
    print("Test 5: GET_SETTINGS (Command 11)")
    print("-"*40)
    # Sample settings: autoRecord=1, autoPlay=0, sensitivity=75
    settings_hex = "01007500"
    result = decoder.decode_response(11, settings_hex)
    print(result if result else "No decode available")
    print()
    
    # Test 6: Card Info (Command 16)
    print("Test 6: GET_CARD_INFO (Command 16)")
    print("-"*40)
    # 8GB total, 3GB free
    total_mb = 8192
    free_mb = 3072
    card_hex = struct.pack('<II', total_mb, free_mb).hex()
    result = decoder.decode_response(16, card_hex)
    print(result if result else "No decode available")
    print()
    
    # Test 7: Unknown command response
    print("Test 7: Unknown Command (Command 99)")
    print("-"*40)
    unknown_hex = "48656c6c6f20576f726c64"  # "Hello World"
    result = decoder.decode_response(99, unknown_hex)
    print(result if result else "No decode available")
    print()
    
    # Test 8: Empty response (Commands 14, 15)
    print("Test 8: Empty Response (Command 14)")
    print("-"*40)
    result = decoder.decode_response(14, "")
    print(result if result else "No decode available")
    print()
    
    print("="*60)
    print("DECODER TEST COMPLETE")
    print("="*60)

if __name__ == "__main__":
    test_decoder()