# -*- coding: utf-8-sig -*-
#!/usr/bin/env python3
"""
Improved HiDock Response Decoder

Based on jensen.js implementation and protocol documentation.

Author: HiDock Research Project
Version: 2.0.0
Date: 2025-09-01
"""

import struct
from datetime import datetime

class ImprovedHiDockDecoder:
    """Decoder based on JavaScript implementation and protocol docs"""
    
    def __init__(self):
        self.commands = {
            1: self.decode_device_info,
            2: self.decode_device_time,
            4: self.decode_file_list,
            6: self.decode_file_count,
            11: self.decode_settings,
            16: self.decode_card_info,
            18: self.decode_recording_file,
        }
    
    def decode_response(self, command_id, hex_data):
        """Main decoder entry point"""
        if not hex_data:
            return "Empty response"
        
        decoder = self.commands.get(command_id)
        if decoder:
            try:
                return decoder(hex_data)
            except Exception as e:
                return f"Decode error: {e}"
        return None
    
    def decode_device_info(self, hex_data):
        """
        Based on deviceService.ts:
        - First 4 bytes: version code (skip first byte, use next 3 as x.y.z)
        - Remaining bytes: serial number (ASCII printable chars)
        """
        data = bytes.fromhex(hex_data)
        lines = []
        
        if len(data) >= 4:
            # Version from bytes 1-3 (skip byte 0)
            version = f"{data[1]}.{data[2]}.{data[3]}"
            lines.append(f"Firmware Version: {version}")
            
            # Serial from remaining bytes
            if len(data) > 4:
                serial_bytes = data[4:20] if len(data) >= 20 else data[4:]
                # Filter printable ASCII
                printable = [b for b in serial_bytes if 32 <= b <= 126]
                
                if printable:
                    serial = bytes(printable).decode('ascii', errors='ignore').strip()
                    if serial.startswith('HD1E'):
                        lines.append(f"Model: HD1E")
                        lines.append(f"Serial: {serial[4:]}")
                    else:
                        lines.append(f"Serial: {serial}")
                else:
                    # Fallback to hex
                    serial_hex = serial_bytes.hex().upper()
                    lines.append(f"Serial (hex): {serial_hex}")
        
        return '\n'.join(lines) if lines else "Invalid device info response"
    
    def decode_device_time(self, hex_data):
        """
        Device time in BCD format: YYYYMMDDHHmmss (7 bytes)
        Example: 20250831225421 = 2025-08-31 22:54:21
        """
        if len(hex_data) == 14:  # 7 bytes = 14 hex chars
            try:
                year = int(hex_data[0:4])
                month = int(hex_data[4:6])
                day = int(hex_data[6:8])
                hour = int(hex_data[8:10])
                minute = int(hex_data[10:12])
                second = int(hex_data[12:14])
                
                dt = datetime(year, month, day, hour, minute, second)
                return f"Device Time: {dt.strftime('%Y-%m-%d %H:%M:%S')}"
            except:
                pass
        
        # Fallback to Unix timestamp
        data = bytes.fromhex(hex_data)
        if len(data) >= 8:
            timestamp = struct.unpack('<Q', data[:8])[0]
            dt = datetime.fromtimestamp(timestamp)
            return f"Device Time: {dt.strftime('%Y-%m-%d %H:%M:%S')}"
        
        return f"Invalid time format: {hex_data}"
    
    def decode_file_list(self, hex_data):
        """
        Based on deviceService.ts parseFileListResponse:
        - Optional header: FF FF [4 bytes file count]
        - Each file:
          - 1 byte: file version
          - Variable: file data based on version
        """
        data = bytes.fromhex(hex_data)
        view = struct.Struct('>I')  # Big-endian uint32
        offset = 0
        files = []
        total_files = -1
        
        # Check for header
        if len(data) >= 6 and data[0] == 0xFF and data[1] == 0xFF:
            total_files = view.unpack(data[2:6])[0]
            offset = 6
        
        # Parse files
        file_count = 0
        while offset < len(data) and file_count < 500:  # Safety limit
            if offset + 4 > len(data):
                break
            
            # File version byte
            file_version = data[offset]
            offset += 1
            
            # Based on version, parse differently
            if file_version == 0 or file_version == 1:
                # Version 0/1 format (from JS code)
                if offset + 7 > len(data):
                    break
                
                # Skip 3 bytes
                offset += 3
                
                # Filename length (4 bytes, big-endian)
                name_len = struct.unpack('>I', data[offset:offset+4])[0]
                offset += 4
                
                if name_len > 0 and name_len < 256 and offset + name_len <= len(data):
                    filename = data[offset:offset+name_len].decode('utf-8', errors='ignore').strip('\x00')
                    if filename and filename[0].isalnum():
                        files.append(filename)
                        file_count += 1
                    offset += name_len
                else:
                    break
            else:
                # Unknown version, try to skip to next file
                break
        
        lines = []
        if total_files > 0:
            lines.append(f"Total files reported: {total_files}")
        lines.append(f"Files found: {file_count}")
        
        for i, filename in enumerate(files[:20], 1):  # Show first 20
            lines.append(f"  {i}. {filename}")
        
        if file_count > 20:
            lines.append(f"  ... and {file_count - 20} more files")
        
        return '\n'.join(lines) if lines else "No files found"
    
    def decode_file_count(self, hex_data):
        """File count as 4-byte integer"""
        data = bytes.fromhex(hex_data)
        if len(data) >= 4:
            count = struct.unpack('<I', data[:4])[0]  # Little-endian
            return f"File count: {count}"
        return "Invalid file count response"
    
    def decode_settings(self, hex_data):
        """Device settings - format varies by firmware"""
        data = bytes.fromhex(hex_data)
        lines = ["Device Settings:"]
        
        # Show as hex pairs for now
        settings_hex = ' '.join(f"{b:02X}" for b in data[:20])
        lines.append(f"  Raw: {settings_hex}")
        
        # Try to parse known settings
        if len(data) >= 2:
            lines.append(f"  Auto-record: {'On' if data[0] else 'Off'}")
        if len(data) >= 3:
            lines.append(f"  Auto-play: {'On' if data[1] else 'Off'}")
        
        return '\n'.join(lines)
    
    def decode_card_info(self, hex_data):
        """
        Based on deviceService.ts getStorageInfo:
        - First 4 bytes: free space in MiB (big-endian)
        - Next 4 bytes: total capacity in MiB (big-endian)
        - Optional 4 bytes: status
        """
        data = bytes.fromhex(hex_data)
        
        if len(data) >= 8:
            # Parse as big-endian (from JS: getUint32(x, false))
            free_mib = struct.unpack('>I', data[0:4])[0]
            total_mib = struct.unpack('>I', data[4:8])[0]
            
            # Convert MiB to GB
            free_gb = free_mib / 1024
            total_gb = total_mib / 1024
            used_gb = total_gb - free_gb
            
            if total_gb > 0:
                used_percent = (used_gb / total_gb) * 100
            else:
                used_percent = 0
            
            lines = [
                f"Storage Information:",
                f"  Total: {total_gb:.2f} GB ({total_mib} MiB)",
                f"  Free: {free_gb:.2f} GB ({free_mib} MiB)",
                f"  Used: {used_gb:.2f} GB ({used_percent:.1f}%)"
            ]
            
            return '\n'.join(lines)
        
        return "Invalid storage info response"
    
    def decode_recording_file(self, hex_data):
        """Recording file metadata"""
        data = bytes.fromhex(hex_data)
        lines = ["Recording File Info:"]
        
        # This would need proper format documentation
        lines.append(f"  Raw data: {hex_data[:60]}...")
        
        return '\n'.join(lines)

# Test the decoder
if __name__ == "__main__":
    decoder = ImprovedHiDockDecoder()
    
    # Test with your actual responses
    tests = [
        (1, "0006020548443145323433353035343335", "Device Info"),
        (2, "20250831225421", "Device Time"),
        (16, "00200000000c0000", "Card Info (example)"),
    ]
    
    for cmd_id, hex_data, desc in tests:
        print(f"\n{desc} (Command {cmd_id}):")
        print("-" * 40)
        result = decoder.decode_response(cmd_id, hex_data)
        print(result if result else "No decoder")