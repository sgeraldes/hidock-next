#!/usr/bin/env python3
"""
HiDock Firmware Downloader

Programmatically downloads latest firmware for HiDock devices.
Requires Google OAuth authentication to obtain API access token.
"""
import requests
import json
import base64
import hashlib
import os
import xml.etree.ElementTree as ET
from datetime import datetime

class HiDockFirmwareDownloader:
    def __init__(self):
        self.base_url = "https://hinotes.hidock.com"
        self.access_token = None
        self.session = requests.Session()
        
    def set_access_token(self, token):
        """Set the access token for API authentication"""
        self.access_token = token
        self.session.headers.update({'AccessToken': token})
        
    def get_latest_firmware(self, device_model="hidock-h1e", current_version="328196"):
        """
        Get latest firmware information for specified device model
        
        Args:
            device_model: Device model (e.g., "hidock-h1e")
            current_version: Current firmware version number (e.g., "328196")
            
        Returns:
            dict: Firmware metadata or None if no update available
        """
        if not self.access_token:
            raise ValueError("Access token required. Call set_access_token() first.")
            
        endpoint = f"{self.base_url}/v2/device/firmware/latest"
        
        # Form data as observed in HAR file
        data = {
            'version': current_version,
            'model': device_model
        }
        
        try:
            response = self.session.post(endpoint, data=data)
            
            if response.status_code != 200:
                print(f"API Error: {response.status_code} - {response.text}")
                return None
            
            # Parse XML response
            try:
                root = ET.fromstring(response.text)
                error_code = root.find('error').text if root.find('error') is not None else None
                message = root.find('message').text if root.find('message') is not None else None
                
                if error_code == "0" and root.find('data') is not None:
                    data_elem = root.find('data')
                    firmware_data = {
                        'id': data_elem.find('id').text if data_elem.find('id') is not None else None,
                        'model': data_elem.find('model').text if data_elem.find('model') is not None else None,
                        'versionCode': data_elem.find('versionCode').text if data_elem.find('versionCode') is not None else None,
                        'versionNumber': data_elem.find('versionNumber').text if data_elem.find('versionNumber') is not None else None,
                        'signature': data_elem.find('signature').text if data_elem.find('signature') is not None else None,
                        'fileName': data_elem.find('fileName').text if data_elem.find('fileName') is not None else None,
                        'fileLength': data_elem.find('fileLength').text if data_elem.find('fileLength') is not None else None,
                        'remark': data_elem.find('remark').text if data_elem.find('remark') is not None else None
                    }
                    return firmware_data
                else:
                    print(f"No firmware update available or API error. Error: {error_code}, Message: {message}")
                    if error_code != "0":
                        print(f"Raw response: {response.text}")
                    return None
                    
            except ET.ParseError as e:
                print(f"Error parsing XML response: {e}")
                print(f"Raw response: {response.text}")
                return None
                
        except requests.exceptions.RequestException as e:
            print(f"Error checking firmware: {e}")
            return None
            
    def download_firmware(self, firmware_info, output_path=None):
        """
        Download firmware binary by ID
        
        Args:
            firmware_info: Firmware metadata dict containing 'id' and 'fileName'
            output_path: Output file path (optional)
            
        Returns:
            str: Path to downloaded file or None if failed
        """
        if not self.access_token:
            raise ValueError("Access token required. Call set_access_token() first.")
            
        firmware_id = firmware_info.get('id')
        filename = firmware_info.get('fileName')
        endpoint = f"{self.base_url}/v2/device/firmware/get?id={firmware_id}"
        
        try:
            response = self.session.get(endpoint)
            if response.status_code != 200:
                print(f"Download failed: {response.status_code}")
                return None
            response.raise_for_status()
            
            # Create output directory if not specified
            if not output_path:
                # Use firmware directory structure: firmware/{model}/{version}/
                model = firmware_info.get('model', 'unknown').replace('hidock-', '')
                version = firmware_info.get('versionCode', 'unknown')
                output_dir = f"firmware/{model}/{version}"
                os.makedirs(output_dir, exist_ok=True)
                output_path = f"{output_dir}/{filename}.bin"
            else:
                os.makedirs(os.path.dirname(output_path), exist_ok=True)
            
            # Determine if response is Base64 encoded or binary
            content_type = response.headers.get('content-type', '')
            
            if 'application/octet-stream' in content_type:
                # Check if content is Base64 encoded
                try:
                    # Try to decode as Base64
                    binary_data = base64.b64decode(response.text)
                    print(f"Decoded Base64 firmware data: {len(binary_data)} bytes")
                except:
                    # Raw binary data
                    binary_data = response.content
                    print(f"Raw binary firmware data: {len(binary_data)} bytes")
            else:
                binary_data = response.content
                print(f"Binary firmware data: {len(binary_data)} bytes")
            
            # Save firmware file
            with open(output_path, 'wb') as f:
                f.write(binary_data)
                
            # Calculate and display file info
            file_size = len(binary_data)
            md5_hash = hashlib.md5(binary_data).hexdigest()
            
            print(f"Firmware downloaded successfully:")
            print(f"  Path: {output_path}")
            print(f"  Size: {file_size:,} bytes")
            print(f"  MD5: {md5_hash}")
            
            # Verify if it's a valid ACTTEST0 firmware
            if binary_data.startswith(b'ACTTEST0'):
                print(f"  Format: Valid ACTTEST0 firmware [+]")
            else:
                print(f"  Format: Unknown format (not ACTTEST0)")
            
            return output_path
            
        except requests.exceptions.RequestException as e:
            print(f"Error downloading firmware: {e}")
            return None
            
    def extract_firmware_from_har(self, har_file_path, firmware_id, output_path=None):
        """
        Extract firmware binary from HAR file (alternative when download endpoint is not accessible)
        
        Args:
            har_file_path: Path to HAR file
            firmware_id: Firmware file ID to extract
            output_path: Output file path (optional)
            
        Returns:
            str: Path to extracted file or None if failed
        """
        try:
            with open(har_file_path, 'r', encoding='utf-8') as f:
                har_data = json.load(f)
            
            # Find the firmware binary response (3.45MB octet-stream)
            firmware_entry = None
            for entry in har_data['log']['entries']:
                if (entry['response']['content'].get('size') == 3451904 and 
                    entry['response']['content'].get('mimeType') == 'application/octet-stream'):
                    firmware_entry = entry
                    break
            
            if not firmware_entry:
                print("[-] Firmware binary not found in HAR file")
                return None
                
            print("[+] Found firmware binary in HAR file")
            
            # Create output directory if not specified  
            if not output_path:
                output_dir = f"firmware/extracted_from_har"
                os.makedirs(output_dir, exist_ok=True)
                output_path = f"{output_dir}/{firmware_id}.bin"
            else:
                os.makedirs(os.path.dirname(output_path), exist_ok=True)
            
            # Decode base64 content
            base64_content = firmware_entry['response']['content']['text']
            binary_data = base64.b64decode(base64_content)
            
            # Save firmware file
            with open(output_path, 'wb') as f:
                f.write(binary_data)
                
            # Calculate and display file info
            file_size = len(binary_data)
            md5_hash = hashlib.md5(binary_data).hexdigest()
            
            print(f"Firmware extracted successfully:")
            print(f"  Path: {output_path}")
            print(f"  Size: {file_size:,} bytes")
            print(f"  MD5: {md5_hash}")
            
            # Verify if it's a valid ACTTEST0 firmware
            if binary_data.startswith(b'ACTTEST0'):
                print(f"  Format: Valid ACTTEST0 firmware [+]")
            else:
                print(f"  Format: Unknown format (not ACTTEST0)")
            
            return output_path
            
        except Exception as e:
            print(f"Error extracting firmware from HAR: {e}")
            return None
            
    def get_and_download_latest(self, device_model="hidock-h1e", current_version="328196"):
        """
        Get latest firmware info and download it in one step
        
        Args:
            device_model: Device model (e.g., "hidock-h1e")
            current_version: Current firmware version number (e.g., "328196")
            
        Returns:
            tuple: (firmware_info, download_path) or (None, None) if failed
        """
        print(f"Checking for firmware updates for {device_model}...")
        
        firmware_info = self.get_latest_firmware(device_model, current_version)
        if not firmware_info:
            return None, None
            
        print(f"Firmware update available:")
        print(f"  Version: {firmware_info.get('versionCode', 'Unknown')}")
        print(f"  Version Number: {firmware_info.get('versionNumber', 'Unknown')}")
        print(f"  File ID: {firmware_info.get('fileName', 'Unknown')}")
        print(f"  Size: {firmware_info.get('fileLength', 'Unknown')} bytes")
        print(f"  MD5 Signature: {firmware_info.get('signature', 'Unknown')}")
        
        firmware_id = firmware_info.get('fileName')
        if not firmware_id:
            print("No firmware file ID found in response")
            return firmware_info, None
            
        print(f"Downloading firmware {firmware_id}...")
        download_path = self.download_firmware(firmware_info)
        
        # If download failed, try extracting from HAR file
        if not download_path:
            print("Attempting to extract firmware from HAR file...")
            har_path = "archive/hinotes.hidock.com.har"
            if os.path.exists(har_path):
                download_path = self.extract_firmware_from_har(har_path, firmware_id)
            else:
                print(f"HAR file not found at: {har_path}")
        
        return firmware_info, download_path

def main():
    """
    Universal firmware downloader for all HiDock devices
    Downloads latest firmware for H1 and H1E models
    """
    
    downloader = HiDockFirmwareDownloader()
    
    # Use the access token from HAR file analysis
    access_token = "M4XoUFm5OOygd5snWe10lMxtSqadM2KOp2wWObw554iUyTaEZbVXdu11TZ3zD4SD"
    downloader.set_access_token(access_token)
    
    # Define devices to download firmware for - try different P1 model names
    devices = [
        {"model": "p1", "version": "100000", "name": "HiDock P1 (p1)"},
        {"model": "hidock-p1", "version": "100000", "name": "HiDock P1 (hidock-p1)"}
    ]
    
    print("=== Universal HiDock Firmware Downloader ===\n")
    
    successful_downloads = 0
    failed_downloads = 0
    
    for device in devices:
        print(f"--- Downloading {device['name']} Firmware ---")
        firmware_info, download_path = downloader.get_and_download_latest(
            device['model'], device['version']
        )
        
        if download_path:
            print(f"[+] {device['name']} firmware downloaded: {download_path}")
            successful_downloads += 1
        else:
            print(f"[-] {device['name']} firmware download failed")
            failed_downloads += 1
        print()
    
    print("=== Download Summary ===")
    print(f"Successful: {successful_downloads}")
    print(f"Failed: {failed_downloads}")
    print(f"Total: {successful_downloads + failed_downloads}")
    
    if successful_downloads > 0:
        print(f"\nFirmware files saved to: firmware/ directory")
        print("Directory structure: firmware/{model}/{version}/")

if __name__ == "__main__":
    main()