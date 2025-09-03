# -*- coding: utf-8-sig -*-
#!/usr/bin/env python3
"""
HiDock Response Decoder

Decodes binary responses from HiDock commands into human-readable format.

Author: HiDock Research Project
Version: 1.0.0
Date: 2025-08-31
"""

import struct
from datetime import datetime
import json

class HiDockResponseDecoder:
    """Decode HiDock binary responses into readable data"""
    
    def __init__(self):
        self.decoders = {
            1: self.decode_device_info,
            2: self.decode_device_time,
            4: self.decode_file_list,
            6: self.decode_file_count,
            11: self.decode_settings,
            16: self.decode_card_info,
            18: self.decode_recording_file,
        }
    
    def decode_response(self, command_id, hex_data):
        """Main decoder - routes to specific command decoder and formats output"""
        if not hex_data:
            return "Empty response"
            
        decoder = self.decoders.get(command_id)
        if decoder:
            try:
                decoded_data = decoder(hex_data)
                return self.format_result(decoded_data)
            except Exception as e:
                return f"Decode error: {e}"
        else:
            # For unknown commands, show ASCII if printable
            try:
                data = bytes.fromhex(hex_data)
                ascii_str = ''.join(chr(b) if 32 <= b <= 126 else '.' for b in data)
                if any(32 <= b <= 126 for b in data):
                    return f"Raw data (ASCII): {ascii_str}"
            except:
                pass
            return None
    
    def decode_device_info(self, hex_data):
        """Decode Command 1: GET_DEVICE_INFO response"""
        data = bytes.fromhex(hex_data)
        
        result = {
            "command": "GET_DEVICE_INFO",
            "status": "success"
        }
        
        # Observed format from actual device:
        # 00 06 02 05 48443145323433353035343335
        # First 4 bytes: version numbers (0.6.2.5)
        # Remaining bytes: ASCII text "HD1E2435054335" (model + serial)
        
        if len(data) < 4:
            return {"status": "invalid_response", "raw_hex": hex_data}
        
        try:
            # Parse version from first 4 bytes
            version_parts = []
            for i in range(min(4, len(data))):
                if data[i] != 0 or i == 0:  # Include zeros except leading
                    version_parts.append(str(data[i]))
            
            if version_parts:
                result["firmware_version"] = ".".join(version_parts)
            
            # Build number from version bytes
            if len(data) >= 4:
                result["build_number"] = f"{data[2]:02d}{data[3]:02d}"
            
            # Parse remaining bytes as ASCII for model/serial
            if len(data) > 4:
                ascii_bytes = data[4:]
                ascii_str = ascii_bytes.decode('ascii', errors='ignore')
                
                # HD1E is the model prefix
                if ascii_str.startswith('HD1E'):
                    result["model"] = "HD1E" 
                    result["serial_number"] = ascii_str[4:] if len(ascii_str) > 4 else "Unknown"
                elif ascii_str:
                    # Just use the whole string as serial if no HD1E prefix
                    result["serial_number"] = ascii_str
                else:
                    # Fallback to hex if not ASCII
                    result["serial_number"] = ascii_bytes.hex().upper()
                            
        except Exception as e:
            result["parse_error"] = str(e)
            
        result["raw_hex"] = hex_data
        return result
    
    def decode_device_time(self, hex_data):
        """Decode Command 2: GET_DEVICE_TIME response"""
        data = bytes.fromhex(hex_data)
        
        result = {
            "command": "GET_DEVICE_TIME",
            "status": "success"
        }
        
        try:
            if len(data) == 7:
                # BCD format: YYYYMMDDHHmmss (7 bytes)
                # Each byte contains two BCD digits
                year = int(hex_data[0:4])  # 2025
                month = int(hex_data[4:6])  # 08
                day = int(hex_data[6:8])    # 31
                hour = int(hex_data[8:10])  # 22
                minute = int(hex_data[10:12]) # 54
                second = int(hex_data[12:14]) # 21
                
                dt = datetime(year, month, day, hour, minute, second)
                
                result["timestamp"] = int(dt.timestamp())
                result["datetime"] = dt.strftime("%Y-%m-%d %H:%M:%S")
                result["date"] = dt.strftime("%Y-%m-%d")
                result["time"] = dt.strftime("%H:%M:%S")
                result["readable"] = dt.strftime("%B %d, %Y at %I:%M:%S %p")
            elif len(data) >= 8:
                # Try as Unix timestamp
                timestamp = struct.unpack('<Q', data[:8])[0]
                dt = datetime.fromtimestamp(timestamp)
                
                result["timestamp"] = timestamp
                result["datetime"] = dt.strftime("%Y-%m-%d %H:%M:%S")
                result["date"] = dt.strftime("%Y-%m-%d")
                result["time"] = dt.strftime("%H:%M:%S")
                result["readable"] = dt.strftime("%B %d, %Y at %I:%M:%S %p")
            else:
                result["status"] = "invalid_response"
        except Exception as e:
            result["status"] = "parse_error"
            result["error"] = str(e)
            
        result["raw_hex"] = hex_data
        return result
    
    def decode_file_list(self, hex_data):
        """Decode Command 4: GET_FILE_LIST response"""
        data = bytes.fromhex(hex_data)
        
        result = {
            "command": "GET_FILE_LIST",
            "status": "success",
            "files": []
        }
        
        # HiDock file list format (observed):
        # Starts with header: ffff0000 or similar
        # Then each file entry:
        # - 2 bytes: file index (big-endian)
        # - 2 bytes: unknown (often 0000)
        # - 4 bytes: file size or length (big-endian)
        # - Variable: filename (null-terminated)
        # - Variable: padding/additional data
        
        try:
            idx = 0
            file_count = 0
            
            # Skip header if present
            if len(data) >= 4 and data[0:2] == b'\xff\xff':
                idx = 4
            
            while idx < len(data) - 8:  # Need at least 8 bytes for a file entry
                file_entry = {}
                
                # File index (2 bytes, big-endian)
                if idx + 2 <= len(data):
                    file_idx = struct.unpack('>H', data[idx:idx+2])[0]
                    file_entry["file_id"] = file_idx
                    idx += 2
                else:
                    break
                    
                # Skip 2 bytes (unknown field)
                idx += 2
                
                # File size or name length (4 bytes, big-endian)
                if idx + 4 <= len(data):
                    size_or_len = struct.unpack('>I', data[idx:idx+4])[0]
                    idx += 4
                else:
                    break
                
                # Filename (null-terminated or fixed length)
                name_start = idx
                name_end = idx
                
                # Look for null terminator or use size_or_len as length
                if size_or_len < 256:  # Likely filename length
                    name_end = min(idx + size_or_len, len(data))
                else:
                    # Look for null terminator
                    while name_end < len(data) and data[name_end] != 0:
                        name_end += 1
                
                if name_end > name_start:
                    filename_bytes = data[name_start:name_end]
                    # Clean up filename
                    filename = filename_bytes.decode('utf-8', errors='ignore')
                    filename = filename.strip('\x00').strip()
                    
                    if filename and filename[0].isalnum():  # Valid filename
                        file_entry["filename"] = filename
                        idx = name_end
                        
                        # Skip null terminator if present
                        if idx < len(data) and data[idx] == 0:
                            idx += 1
                            
                        # Skip to next file entry (aligned to 64-byte boundary in some cases)
                        # Look for next valid entry marker
                        while idx < len(data) - 4:
                            # Check if we found a new file entry (starts with valid index)
                            if idx + 2 <= len(data):
                                next_idx = struct.unpack('>H', data[idx:idx+2])[0]
                                if 0 < next_idx < 1000:  # Reasonable file index
                                    break
                            idx += 1
                            
                            # Safety: don't skip too far
                            if idx - name_end > 100:
                                break
                                
                        result["files"].append(file_entry)
                        file_count += 1
                    else:
                        idx = name_end + 1
                else:
                    break
                    
                # Safety check
                if file_count > 500:
                    break
            
            result["file_count"] = len(result["files"])
            
            # If we didn't parse any files, try alternative format
            if not result["files"]:
                # Maybe it's just a list of filenames separated by nulls
                parts = data.split(b'\x00')
                for part in parts:
                    if part and len(part) > 3:
                        try:
                            filename = part.decode('utf-8', errors='ignore')
                            if filename and not all(c == '\x00' for c in filename):
                                result["files"].append({"filename": filename})
                        except:
                            pass
                            
                result["file_count"] = len(result["files"])
                
        except Exception as e:
            result["parse_error"] = str(e)
            
        result["raw_hex"] = hex_data[:200] + "..." if len(hex_data) > 200 else hex_data
        return result
    
    def decode_file_count(self, hex_data):
        """Decode Command 6: GET_FILE_COUNT response"""
        data = bytes.fromhex(hex_data)
        
        result = {
            "command": "GET_FILE_COUNT",
            "status": "success"
        }
        
        if len(data) >= 4:
            # File count is 32-bit little-endian integer
            count = struct.unpack('<I', data[:4])[0]
            result["file_count"] = count
            result["readable"] = f"{count} file{'s' if count != 1 else ''} on device"
        elif len(data) >= 2:
            # Maybe it's 16-bit?
            count = struct.unpack('<H', data[:2])[0]
            result["file_count"] = count
            result["readable"] = f"{count} file{'s' if count != 1 else ''} on device"
        else:
            result["status"] = "invalid_response"
            
        result["raw_hex"] = hex_data
        return result
    
    def decode_settings(self, hex_data):
        """Decode Command 11: GET_SETTINGS response"""
        data = bytes.fromhex(hex_data)
        
        result = {
            "command": "GET_SETTINGS",
            "status": "success",
            "settings": {}
        }
        
        try:
            # Settings format is likely:
            # Multiple setting entries with ID and value
            
            if len(data) >= 4:
                # Common settings might include:
                # - Auto record on/off
                # - Auto play on/off
                # - Recording quality
                # - Microphone gain
                
                idx = 0
                
                # Try to parse as key-value pairs
                while idx < len(data) - 1:
                    if idx + 2 <= len(data):
                        setting_id = data[idx]
                        setting_value = data[idx + 1]
                        
                        # Map known setting IDs
                        setting_names = {
                            0: "auto_record",
                            1: "auto_play",
                            2: "recording_quality",
                            3: "mic_gain",
                            4: "led_brightness",
                            5: "beep_volume",
                        }
                        
                        name = setting_names.get(setting_id, f"setting_{setting_id}")
                        result["settings"][name] = setting_value
                        
                        idx += 2
                    else:
                        break
                        
                # If no settings parsed, show raw
                if not result["settings"]:
                    result["settings"]["raw_data"] = hex_data
                    
        except Exception as e:
            result["parse_error"] = str(e)
            
        result["raw_hex"] = hex_data
        return result
    
    def decode_card_info(self, hex_data):
        """Decode Command 16: GET_CARD_INFO response"""
        data = bytes.fromhex(hex_data)
        
        result = {
            "command": "GET_CARD_INFO",
            "status": "success"
        }
        
        try:
            if len(data) >= 8:
                # First 4 bytes: total space
                # Next 4 bytes: free space
                total_space = struct.unpack('<I', data[:4])[0]
                free_space = struct.unpack('<I', data[4:8])[0]
                
                # Values might be in KB, MB, or blocks
                # If values are small, probably GB
                if total_space < 1000:
                    total_mb = total_space * 1024  # Assume GB
                    free_mb = free_space * 1024
                else:
                    total_mb = total_space  # Assume MB
                    free_mb = free_space
                
                used_mb = total_mb - free_mb
                used_percent = round((used_mb / total_mb * 100), 1) if total_mb > 0 else 0
                
                result["total_space_mb"] = total_mb
                result["free_space_mb"] = free_mb
                result["used_space_mb"] = used_mb
                result["used_percent"] = used_percent
                
                # Human readable
                result["total_space_gb"] = round(total_mb / 1024, 2)
                result["free_space_gb"] = round(free_mb / 1024, 2)
                result["used_space_gb"] = round(used_mb / 1024, 2)
                
                result["readable"] = f"Storage: {result['used_space_gb']}GB used of {result['total_space_gb']}GB ({used_percent}% full)"
                
                # Additional info if present
                if len(data) > 8:
                    # Might have health status, etc.
                    if len(data) >= 9:
                        result["health_status"] = data[8]
                        
        except Exception as e:
            result["parse_error"] = str(e)
            
        result["raw_hex"] = hex_data
        return result
    
    def decode_recording_file(self, hex_data):
        """Decode Command 18: GET_RECORDING_FILE response"""
        data = bytes.fromhex(hex_data)
        
        result = {
            "command": "GET_RECORDING_FILE",
            "status": "success"
        }
        
        try:
            idx = 0
            
            # File info structure
            if len(data) >= 4:
                file_id = struct.unpack('<I', data[idx:idx+4])[0]
                result["file_id"] = file_id
                idx += 4
            
            if len(data) >= idx + 8:
                timestamp = struct.unpack('<Q', data[idx:idx+8])[0]
                result["timestamp"] = timestamp
                result["recorded_date"] = datetime.fromtimestamp(timestamp).strftime("%Y-%m-%d %H:%M:%S")
                idx += 8
            
            if len(data) >= idx + 4:
                duration_ms = struct.unpack('<I', data[idx:idx+4])[0]
                result["duration_ms"] = duration_ms
                result["duration_seconds"] = duration_ms / 1000
                result["duration_readable"] = f"{int(duration_ms/60000)}:{int((duration_ms%60000)/1000):02d}"
                idx += 4
            
            if len(data) >= idx + 4:
                file_size = struct.unpack('<I', data[idx:idx+4])[0]
                result["file_size_bytes"] = file_size
                result["file_size_mb"] = round(file_size / (1024*1024), 2)
                idx += 4
            
            # Remaining might be filename
            if idx < len(data):
                # Look for null-terminated string
                name_end = data.find(b'\x00', idx)
                if name_end > idx:
                    filename = data[idx:name_end].decode('utf-8', errors='ignore')
                    result["filename"] = filename
                    
        except Exception as e:
            result["parse_error"] = str(e)
            
        result["raw_hex"] = hex_data
        return result
    
    def format_result(self, decoded_data):
        """Format decoded data for display"""
        lines = []
        
        if "command" in decoded_data:
            lines.append(f"Command: {decoded_data['command']}")
            lines.append("-" * 40)
        
        if decoded_data.get("status") == "success":
            # Format based on command type
            if "firmware_version" in decoded_data:
                lines.append(f"Firmware Version: {decoded_data.get('firmware_version', 'Unknown')}")
                lines.append(f"Build Number: {decoded_data.get('build_number', 'Unknown')}")
                lines.append(f"Serial Number: {decoded_data.get('serial_number', 'Unknown')}")
                
            elif "datetime" in decoded_data:
                lines.append(f"Device Time: {decoded_data['readable']}")
                
            elif "files" in decoded_data:
                lines.append(f"Total Files: {decoded_data['file_count']}")
                for i, file in enumerate(decoded_data['files'][:10]):  # Show first 10
                    lines.append(f"  {i+1}. {file.get('filename', 'Unknown')}")
                    if "size_mb" in file:
                        lines.append(f"     Size: {file['size_mb']} MB")
                    if "date" in file:
                        lines.append(f"     Date: {file['date']}")
                        
            elif "file_count" in decoded_data:
                lines.append(decoded_data['readable'])
                
            elif "settings" in decoded_data:
                lines.append("Device Settings:")
                for key, value in decoded_data['settings'].items():
                    lines.append(f"  {key}: {value}")
                    
            elif "total_space_mb" in decoded_data:
                lines.append(decoded_data['readable'])
                lines.append(f"  Free: {decoded_data['free_space_gb']} GB")
                
            elif "duration_readable" in decoded_data:
                lines.append(f"File: {decoded_data.get('filename', 'Unknown')}")
                lines.append(f"Duration: {decoded_data['duration_readable']}")
                lines.append(f"Size: {decoded_data.get('file_size_mb', 0)} MB")
                lines.append(f"Recorded: {decoded_data.get('recorded_date', 'Unknown')}")
                
        else:
            lines.append(f"Status: {decoded_data.get('status', 'Unknown')}")
            if "error" in decoded_data:
                lines.append(f"Error: {decoded_data['error']}")
                
        return "\n".join(lines)


# Test function
if __name__ == "__main__":
    decoder = HiDockResponseDecoder()
    
    # Test with sample data
    test_cases = [
        (1, "00060205484431453234333530353433350006020548443145323433353035343335"),  # Device info
        (2, "00e0854d66000000"),  # Device time
        (6, "03000000"),  # File count = 3
        (16, "0080000000300000"),  # Card info
    ]
    
    for cmd_id, hex_data in test_cases:
        print(f"\nTesting Command {cmd_id}:")
        print(f"Raw hex: {hex_data}")
        result = decoder.decode_response(cmd_id, hex_data)
        print(decoder.format_result(result))
        print()