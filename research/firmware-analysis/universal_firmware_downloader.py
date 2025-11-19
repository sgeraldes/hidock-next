#!/usr/bin/env python3
"""
Universal HiDock Firmware Downloader

Automatically discovers available device models and downloads latest firmware
for all supported HiDock devices without requiring manual configuration.
"""

import hashlib
import os
import xml.etree.ElementTree as ET

import requests


class UniversalHiDockFirmwareDownloader:
    def __init__(self):
        self.base_url = "https://hinotes.hidock.com"
        self.access_token = None
        self.session = requests.Session()

        # Known device model patterns to test
        self.device_patterns = [
            "hidock-h1",
            "hidock-h1e",
            "hidock-p1",
            "h1",
            "h1e",
            "p1",
            "hidock-h2",
            "hidock-h3",
            "h2",
            "h3",
            "hidock-pen",
            "pen",
            "hidock-recorder",
            "recorder",
            "hidock-p1-recorder",
            "p1-recorder",
            "hidock_p1",
            "hidock_pen",
        ]

        # Multiple download endpoints to try
        self.download_endpoints = [
            "/v2/device/firmware/get?id={firmware_id}",
            "/v2/device/firmware/download/{filename}",
            "/v1/device/firmware/download/{filename}",
            "/device/firmware/get?id={firmware_id}",
        ]

    def set_access_token(self, token):
        """Set the access token for API authentication"""
        self.access_token = token
        self.session.headers.update({"AccessToken": token})

    def discover_available_devices(self):
        """
        Auto-discover all available device models by testing known patterns
        Returns list of supported devices with their latest firmware info
        """
        print("[*] Auto-discovering available HiDock device models...")
        available_devices = []

        # Test with very low version number to ensure we get updates
        # Different devices use different version ranges:
        # H1/H1E: ~300000+ range, P1: ~65000+ range (1.x.x format)
        # P1 versions: Try much lower versions for P1, since 1.2.25 could be different encoding
        # Also try version "0" and "1" to see if we get any response
        test_versions = ["0", "1", "100", "1000", "5000", "10000", "50000", "65000", "65700", "65800"]

        for model in self.device_patterns:
            print(f"[*] Testing device model: {model}")

            firmware_info = None
            # Try multiple version ranges to find the right one for this device
            for test_version in test_versions:
                firmware_info = self._check_firmware_for_model(model, test_version)
                if firmware_info and firmware_info.get("id"):
                    break

            if firmware_info and firmware_info.get("id"):
                device_info = {
                    "model": model,
                    "display_name": self._get_display_name(model),
                    "firmware_info": firmware_info,
                }
                available_devices.append(device_info)
                print(f"[+] Found supported device: {device_info['display_name']}")
            else:
                print(f"[-] No firmware available for: {model}")

        print(f"\n[+] Discovery complete. Found {len(available_devices)} supported device(s)")
        return available_devices

    def _get_display_name(self, model):
        """Convert model identifier to display name"""
        name_map = {
            "hidock-h1": "HiDock H1",
            "hidock-h1e": "HiDock H1E",
            "hidock-p1": "HiDock P1",
            "h1": "HiDock H1",
            "h1e": "HiDock H1E",
            "p1": "HiDock P1",
            "hidock-h2": "HiDock H2",
            "hidock-h3": "HiDock H3",
            "h2": "HiDock H2",
            "h3": "HiDock H3",
        }
        return name_map.get(model, f"HiDock {model.upper()}")

    def _check_firmware_for_model(self, model, version):
        """Check if firmware is available for a specific device model"""
        if not self.access_token:
            return None

        endpoint = f"{self.base_url}/v2/device/firmware/latest"
        data = {"version": version, "model": model}

        try:
            response = self.session.post(endpoint, data=data)
            if response.status_code != 200:
                return None

            root = ET.fromstring(response.text)
            error_code = root.find("error").text if root.find("error") is not None else None
            message = root.find("message").text if root.find("message") is not None else None

            # Debug output for P1 models
            if "p1" in model.lower():
                print(f"    [DEBUG] {model} response: error={error_code}, message={message}")
                if root.find("data") is not None:
                    data_elem = root.find("data")
                    print(
                        f"    [DEBUG] data element exists, id={data_elem.find('id').text if data_elem.find('id') is not None else 'None'}"
                    )

            if error_code == "0" and root.find("data") is not None:
                data_elem = root.find("data")
                # Only return if we actually have firmware data
                if data_elem.find("id") is not None and data_elem.find("id").text:
                    return {
                        "id": data_elem.find("id").text,
                        "model": data_elem.find("model").text,
                        "versionCode": data_elem.find("versionCode").text,
                        "versionNumber": data_elem.find("versionNumber").text,
                        "signature": data_elem.find("signature").text,
                        "fileName": data_elem.find("fileName").text,
                        "fileLength": data_elem.find("fileLength").text,
                        "remark": data_elem.find("remark").text if data_elem.find("remark") is not None else None,
                    }
            return None

        except Exception as e:
            print(f"[!] Error checking {model}: {e}")
            return None

    def download_firmware_with_fallback(self, firmware_info, output_path=None):
        """
        Download firmware using multiple endpoints with fallback
        """
        if not self.access_token:
            raise ValueError("Access token required")

        firmware_id = firmware_info.get("id")
        filename = firmware_info.get("fileName")

        # Try each download endpoint until one works
        for endpoint_template in self.download_endpoints:
            endpoint = self.base_url + endpoint_template.format(firmware_id=firmware_id, filename=filename)

            print(f"[*] Trying endpoint: {endpoint}")

            try:
                response = self.session.get(endpoint)
                if response.status_code == 200 and len(response.content) > 10000:  # Valid firmware should be large
                    print(f"[+] Success with endpoint: {endpoint}")
                    saved_path = self._save_firmware(firmware_info, response.content, output_path)
                    if saved_path:
                        return saved_path
                else:
                    print(
                        f"[-] Failed ({response.status_code}) or invalid size ({len(response.content)} bytes): {endpoint}"
                    )

            except Exception as e:
                print(f"[-] Error with {endpoint}: {e}")
                continue

        print(f"[-] All download endpoints failed for firmware {filename}")
        return None

    def _save_firmware(self, firmware_info, binary_data, output_path=None):
        """Save firmware binary to file with proper directory structure"""
        if not output_path:
            # Create organized directory structure
            model = firmware_info.get("model", "unknown").replace("hidock-", "")
            version = firmware_info.get("versionCode", "unknown")
            filename = firmware_info.get("fileName", "firmware.bin")

            output_dir = f"firmware/{model}/{version}"
            os.makedirs(output_dir, exist_ok=True)
            output_path = f"{output_dir}/{filename}.bin"
        else:
            os.makedirs(os.path.dirname(output_path), exist_ok=True)

        # Save binary data
        with open(output_path, "wb") as f:
            f.write(binary_data)

        # Validate firmware
        file_size = len(binary_data)
        md5_hash = hashlib.md5(binary_data).hexdigest()
        is_valid_firmware = binary_data.startswith(b"ACTTEST0")

        # Display results
        print("[+] Firmware saved successfully:")
        print(f"    Path: {output_path}")
        print(f"    Size: {file_size:,} bytes")
        print(f"    MD5: {md5_hash}")
        print(f"    Format: {'Valid ACTTEST0 firmware' if is_valid_firmware else 'Unknown format'}")

        # Verify expected values
        expected_size = int(firmware_info.get("fileLength", 0))
        expected_hash = firmware_info.get("signature", "")

        if expected_size and file_size == expected_size:
            print("    Size verification: [+] PASSED")
        elif expected_size:
            print(f"    Size verification: [-] FAILED (expected {expected_size:,})")

        if expected_hash and md5_hash == expected_hash:
            print("    Hash verification: [+] PASSED")
        elif expected_hash:
            print(f"    Hash verification: [-] FAILED (expected {expected_hash})")

        return output_path

    def download_all_available_firmware(self):
        """
        Discover and download firmware for all available HiDock devices
        """
        print("=== Universal HiDock Firmware Downloader ===")
        print("Auto-discovering and downloading firmware for all supported devices...\n")

        # Discover available devices
        available_devices = self.discover_available_devices()

        if not available_devices:
            print("[-] No supported devices found")
            return

        print(f"\n=== Downloading Firmware for {len(available_devices)} Device(s) ===\n")

        successful_downloads = 0
        failed_downloads = 0

        for device in available_devices:
            print(f"--- {device['display_name']} ---")
            firmware_info = device["firmware_info"]

            print(f"Version: {firmware_info.get('versionCode', 'Unknown')}")
            print(f"Version Number: {firmware_info.get('versionNumber', 'Unknown')}")
            print(f"Size: {firmware_info.get('fileLength', 'Unknown')} bytes")
            print(f"File ID: {firmware_info.get('fileName', 'Unknown')}")

            # Download with multiple endpoint fallback
            download_path = self.download_firmware_with_fallback(firmware_info)

            if download_path:
                successful_downloads += 1
            else:
                failed_downloads += 1

            print()

        # Summary
        print("=== Download Summary ===")
        print(f"Successful: {successful_downloads}")
        print(f"Failed: {failed_downloads}")
        print(f"Total devices: {len(available_devices)}")

        if successful_downloads > 0:
            print("\nFirmware files saved to: firmware/ directory")
            print("Directory structure: firmware/{model}/{version}/")


def main():
    """Main entry point"""
    downloader = UniversalHiDockFirmwareDownloader()

    # Load access token from config file or environment variable
    access_token = os.environ.get("HINOTES_API_TOKEN", "")

    if not access_token:
        # Try reading from config file
        config_path = os.path.join(os.path.dirname(__file__), "..", "..", "config", ".hinotes.config")
        if os.path.exists(config_path):
            with open(config_path, "r") as f:
                for line in f:
                    if line.startswith("HINOTES_API_TOKEN="):
                        access_token = line.split("=", 1)[1].strip()
                        break

    if not access_token:
        print("ERROR: HINOTES_API_TOKEN not found")
        print("Set it via environment variable: export HINOTES_API_TOKEN='your_token'")
        print("Or create config/.hinotes.config (see config/.hinotes.config.example)")
        return

    downloader.set_access_token(access_token)

    # Auto-discover and download all available firmware
    downloader.download_all_available_firmware()


if __name__ == "__main__":
    main()
