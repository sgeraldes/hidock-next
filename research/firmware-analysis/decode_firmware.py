#!/usr/bin/env python3
"""
HiDock Firmware Extractor and Analyzer
Extracts firmware binary from HAR file, validates integrity, and unpacks all partitions
"""
import json
import base64
import hashlib
import struct
import xml.etree.ElementTree as ET
from datetime import datetime
import os
import binascii

def parse_acttest_header(binary_data):
    """Parse ACTTEST0 firmware header structure"""
    if not binary_data.startswith(b'ACTTEST0'):
        raise ValueError("Not a valid ACTTEST0 firmware")
    
    # Header is 512 bytes, followed by XML metadata
    header = binary_data[:512]
    return header

def extract_firmware_xml(binary_data):
    """Extract XML metadata from firmware"""
    xml_start = binary_data.find(b'<?xml')
    if xml_start < 0:
        raise ValueError("No XML metadata found")
    
    xml_end = binary_data.find(b'</ota_firmware>') + len(b'</ota_firmware>')
    xml_content = binary_data[xml_start:xml_end]
    
    return xml_content.decode('utf-8'), xml_start, xml_end

def parse_partitions(xml_content):
    """Parse partition information from XML"""
    root = ET.fromstring(xml_content)
    
    partitions = []
    for partition in root.find('partitions').findall('partition'):
        part_info = {
            'id': int(partition.find('file_id').text),
            'type': partition.find('type').text,
            'name': partition.find('name').text,
            'filename': partition.find('file_name').text,
            'size': int(partition.find('file_size').text, 16),
            'checksum': partition.find('checksum').text
        }
        partitions.append(part_info)
    
    return partitions

def extract_partitions(binary_data, partitions, xml_end, output_dir):
    """Extract individual partition binaries"""
    print(f"[*] Extracting {len(partitions)} partitions...")
    
    # Partitions start after XML content (aligned to next boundary)
    data_start = xml_end
    # Align to 16-byte boundary (common in firmware)
    if data_start % 16:
        data_start = (data_start + 15) // 16 * 16
    
    current_offset = data_start
    extracted_partitions = []
    
    for i, part in enumerate(partitions):
        print(f"[*] Extracting {part['filename']} (ID: {part['id']}, Size: {part['size']} bytes)")
        
        partition_data = binary_data[current_offset:current_offset + part['size']]
        if len(partition_data) != part['size']:
            print(f"[!] Warning: Expected {part['size']} bytes, got {len(partition_data)}")
        
        # Calculate CRC32 checksum for verification
        calculated_crc = hex(binascii.crc32(partition_data) & 0xffffffff)
        
        partition_path = f"{output_dir}/partitions/{part['filename']}"
        os.makedirs(os.path.dirname(partition_path), exist_ok=True)
        
        with open(partition_path, 'wb') as f:
            f.write(partition_data)
        
        extracted_partitions.append({
            'info': part,
            'path': partition_path,
            'extracted_size': len(partition_data),
            'calculated_checksum': calculated_crc
        })
        
        current_offset += part['size']
    
    return extracted_partitions

def generate_metadata(firmware_entry, binary_data, xml_content, partitions, extracted_partitions, validation_results):
    """Generate comprehensive metadata file"""
    
    # Parse firmware version info from XML
    root = ET.fromstring(xml_content)
    firmware_version = root.find('firmware_version')
    
    metadata = {
        "extraction_info": {
            "extracted_at": datetime.now().isoformat(),
            "source": "hinotes.hidock.com HAR capture",
            "extractor_version": "1.0.0"
        },
        "firmware_info": {
            "filename": "20ec7c710a9945428a5d3f0d904876c2",
            "version_code": firmware_version.find('version_code').text,
            "version_name": firmware_version.find('version_name').text,
            "board_name": firmware_version.find('board_name').text,
            "ota_version_check": firmware_version.find('ota_version_check').text,
            "file_size": len(binary_data),
            "container_format": "ACTTEST0"
        },
        "validation": {
            "md5_hash": validation_results['md5_hash'],
            "md5_verified": validation_results['md5_verified'],
            "expected_hash": validation_results['expected_hash'],
            "size_verified": validation_results['size_verified'],
            "format_verified": validation_results['format_verified']
        },
        "partitions": {
            "count": len(partitions),
            "total_size": sum(p['size'] for p in partitions),
            "details": []
        },
        "download_info": {
            "download_url": "https://hinotes.hidock.com/v2/device/firmware/download/20ec7c710a9945428a5d3f0d904876c2",
            "download_status": "404 - endpoint not found",
            "mime_type": firmware_entry['response']['content']['mimeType'],
            "compression": firmware_entry['response']['content'].get('compression', 0)
        }
    }
    
    # Add partition details
    for part_info in extracted_partitions:
        metadata["partitions"]["details"].append({
            "id": part_info['info']['id'],
            "type": part_info['info']['type'],
            "name": part_info['info']['name'],
            "filename": part_info['info']['filename'],
            "size": part_info['info']['size'],
            "extracted_size": part_info['extracted_size'],
            "checksum": part_info['info']['checksum'],
            "calculated_checksum": part_info['calculated_checksum'],
            "extracted_path": part_info['path']
        })
    
    return metadata

def main():
    
    # Read HAR file
    print("Reading HAR file...")
    with open('archive/hinotes.hidock.com.har', 'r', encoding='utf-8') as f:
        har_data = json.load(f)
    
    # Find the firmware binary response
    firmware_entry = None
    for entry in har_data['log']['entries']:
        if (entry['response']['content'].get('size') == 3451904 and 
            entry['response']['content'].get('mimeType') == 'application/octet-stream'):
            firmware_entry = entry
            break
    
    if not firmware_entry:
        print("[-] Firmware binary not found in HAR file")
        return
    
    print("[+] Found firmware binary entry")
    print(f"Size: {firmware_entry['response']['content']['size']} bytes")
    print(f"MIME type: {firmware_entry['response']['content']['mimeType']}")
    
    # Decode base64 content
    base64_content = firmware_entry['response']['content']['text']
    print(f"Base64 content length: {len(base64_content)} characters")
    
    try:
        # Decode base64
        binary_data = base64.b64decode(base64_content)
        print(f"[+] Decoded binary size: {len(binary_data)} bytes")
        
        # Calculate MD5 hash for verification
        md5_hash = hashlib.md5(binary_data).hexdigest()
        print(f"MD5 hash: {md5_hash}")
        
        # Expected hash from metadata
        expected_hash = "d38b66b51b222a89ca49d2d769d7f42e"
        
        validation_results = {
            'md5_hash': md5_hash,
            'md5_verified': md5_hash == expected_hash,
            'expected_hash': expected_hash,
            'size_verified': len(binary_data) == 3451904,
            'format_verified': binary_data.startswith(b'ACTTEST0')
        }
        
        if validation_results['md5_verified']:
            print("[+] MD5 hash matches expected signature!")
        else:
            print(f"[!] MD5 hash mismatch. Expected: {expected_hash}")
        
        # Create output directory
        output_dir = 'firmware/hidock-h1e/6.2.5'
        os.makedirs(output_dir, exist_ok=True)
        os.makedirs(f"{output_dir}/partitions", exist_ok=True)
        
        # Save main binary file
        binary_path = f'{output_dir}/20ec7c710a9945428a5d3f0d904876c2.bin'
        with open(binary_path, 'wb') as f:
            f.write(binary_data)
        print(f"[+] Firmware binary saved to: {binary_path}")
        
        # Parse firmware structure
        print("[*] Parsing firmware structure...")
        header = parse_acttest_header(binary_data)
        xml_content, xml_start, xml_end = extract_firmware_xml(binary_data)
        partitions = parse_partitions(xml_content)
        
        print(f"[*] Found {len(partitions)} partitions:")
        for part in partitions:
            print(f"    {part['filename']} (ID: {part['id']}, Type: {part['type']}, Size: {part['size']} bytes)")
        
        # Extract all partitions
        extracted_partitions = extract_partitions(binary_data, partitions, xml_end, output_dir)
        
        # Generate comprehensive metadata
        metadata = generate_metadata(firmware_entry, binary_data, xml_content, partitions, extracted_partitions, validation_results)
        
        # Save metadata file
        metadata_path = f'{output_dir}/firmware-metadata-complete.json'
        with open(metadata_path, 'w') as f:
            json.dump(metadata, f, indent=2)
        
        print(f"[+] Complete metadata saved to: {metadata_path}")
        
        # Save XML metadata separately
        xml_path = f'{output_dir}/firmware-ota.xml'
        with open(xml_path, 'w', encoding='utf-8') as f:
            f.write(xml_content)
        print(f"[+] Firmware XML metadata saved to: {xml_path}")
        
        print(f"\n[+] Extraction complete!")
        print(f"    Main binary: {binary_path}")
        print(f"    Partitions: {output_dir}/partitions/")
        print(f"    Metadata: {metadata_path}")
        print(f"    XML config: {xml_path}")
        
    except Exception as e:
        print(f"[-] Error processing firmware: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main()