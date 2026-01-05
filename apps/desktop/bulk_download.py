#!/usr/bin/env python3
"""
HiDock Bulk Download Utility

Downloads ALL recordings from a HiDock device to the specified folder.
Designed for reliability - retries failed downloads and tracks progress.

Usage:
    python bulk_download.py [--output-dir PATH] [--retry-count N]
"""

import os
import sys
import time
import argparse
import platform
from pathlib import Path
from datetime import datetime

# Add src directory to path for imports
script_dir = os.path.dirname(os.path.abspath(__file__))
src_dir = os.path.join(script_dir, "src")
sys.path.insert(0, src_dir)

import usb.backend.libusb1
from hidock_device import HiDockJensen
from constants import DEFAULT_VENDOR_ID, HIDOCK_PRODUCT_IDS


def init_usb_backend():
    """Initialize libusb backend with cross-platform support."""
    system = platform.system()
    backend_instance = None

    if system == "Windows":
        # Try to find libusb DLL in common locations
        lib_paths = (
            [os.path.join(script_dir, name) for name in ["libusb-1.0.dll"]]
            + [os.path.join(script_dir, "MS64", "dll", name) for name in ["libusb-1.0.dll"]]
            + [os.path.join(script_dir, "MS32", "dll", name) for name in ["libusb-1.0.dll"]]
            + [os.path.join(script_dir, "lib", name) for name in ["libusb-1.0.dll"]]
            + [os.path.join(src_dir, name) for name in ["libusb-1.0.dll"]]
        )

        # First try system paths
        try:
            backend_instance = usb.backend.libusb1.get_backend()
            if backend_instance:
                print("  Using system libusb backend")
                return backend_instance
        except Exception:
            pass

        # Then try explicit paths
        for lib_path in lib_paths:
            if os.path.exists(lib_path):
                try:
                    backend_instance = usb.backend.libusb1.get_backend(find_library=lambda x: lib_path)
                    if backend_instance:
                        print(f"  Using libusb from: {lib_path}")
                        return backend_instance
                except Exception:
                    continue
    else:
        # Unix-like systems
        backend_instance = usb.backend.libusb1.get_backend()

    if not backend_instance:
        raise RuntimeError("Could not initialize libusb backend. Make sure libusb is installed.")

    return backend_instance

# Default download directory (same as Electron app)
DEFAULT_DOWNLOAD_DIR = r"C:\Users\Sebastian\HiDock\recordings"


def format_size(bytes_val: int) -> str:
    """Format bytes as human-readable string."""
    for unit in ['B', 'KB', 'MB', 'GB']:
        if bytes_val < 1024:
            return f"{bytes_val:.1f} {unit}"
        bytes_val /= 1024
    return f"{bytes_val:.1f} TB"


def format_duration(seconds: float) -> str:
    """Format seconds as HH:MM:SS."""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    if hours > 0:
        return f"{hours}:{minutes:02d}:{secs:02d}"
    return f"{minutes}:{secs:02d}"


def download_file(device: HiDockJensen, file_info: dict, output_dir: Path, retry_count: int = 3) -> tuple[bool, str]:
    """
    Download a single file with retry logic.

    Returns: (success: bool, error_message: str or None)
    """
    filename = file_info["name"]
    file_size = file_info["length"]
    output_path = output_dir / filename

    # Skip if already downloaded and correct size
    if output_path.exists():
        existing_size = output_path.stat().st_size
        if existing_size == file_size:
            return True, "already_exists"
        else:
            print(f"    Removing incomplete file ({format_size(existing_size)} vs {format_size(file_size)})")
            output_path.unlink()

    for attempt in range(1, retry_count + 1):
        try:
            bytes_received = [0]
            last_progress = [0]

            # Open file for writing
            with open(output_path, 'wb') as f:
                def data_callback(chunk: bytes):
                    f.write(chunk)
                    bytes_received[0] += len(chunk)

                def progress_callback(received: int, total: int):
                    progress = int((received / total) * 100) if total > 0 else 0
                    if progress >= last_progress[0] + 10:  # Update every 10%
                        print(f"    Progress: {progress}% ({format_size(received)} / {format_size(total)})")
                        last_progress[0] = progress

                status = device.stream_file(
                    filename=filename,
                    file_length=file_size,
                    data_callback=data_callback,
                    progress_callback=progress_callback,
                    timeout_s=300,  # 5 minutes per file max
                )

            if status == "OK":
                # Verify file size
                actual_size = output_path.stat().st_size
                if actual_size == file_size:
                    return True, None
                else:
                    print(f"    Size mismatch: expected {file_size}, got {actual_size}")
                    output_path.unlink()
                    if attempt < retry_count:
                        print(f"    Retrying... (attempt {attempt + 1}/{retry_count})")
                        time.sleep(2)
                        continue
                    return False, f"Size mismatch after {retry_count} attempts"
            else:
                print(f"    Transfer failed with status: {status}")
                if output_path.exists():
                    output_path.unlink()
                if attempt < retry_count:
                    print(f"    Retrying... (attempt {attempt + 1}/{retry_count})")
                    time.sleep(2)
                    continue
                return False, f"Transfer failed: {status}"

        except Exception as e:
            print(f"    Error: {e}")
            if output_path.exists():
                try:
                    output_path.unlink()
                except:
                    pass
            if attempt < retry_count:
                print(f"    Retrying... (attempt {attempt + 1}/{retry_count})")
                time.sleep(2)
                continue
            return False, str(e)

    return False, "Max retries exceeded"


def main():
    parser = argparse.ArgumentParser(description="Download all recordings from HiDock device")
    parser.add_argument("--output-dir", "-o", default=DEFAULT_DOWNLOAD_DIR,
                        help=f"Output directory (default: {DEFAULT_DOWNLOAD_DIR})")
    parser.add_argument("--retry-count", "-r", type=int, default=3,
                        help="Number of retries per file (default: 3)")
    parser.add_argument("--skip-existing", "-s", action="store_true",
                        help="Skip files that already exist with correct size")
    args = parser.parse_args()

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    print("=" * 60)
    print("HiDock Bulk Download Utility")
    print("=" * 60)
    print(f"Output directory: {output_dir}")
    print(f"Retry count: {args.retry_count}")
    print()

    # Initialize device
    print("Initializing device connection...")
    device = HiDockJensen()

    # Try to connect with different product IDs
    connected = False
    for pid in HIDOCK_PRODUCT_IDS:
        print(f"  Trying PID 0x{pid:04X}...")
        success, error = device.connect(
            target_interface_number=0,
            vid=DEFAULT_VENDOR_ID,
            pid=pid,
            auto_retry=True,
            force_reset=False
        )
        if success:
            print(f"  Connected! (PID: 0x{pid:04X})")
            connected = True
            break
        else:
            if error and "not found" not in error.lower():
                print(f"    Error: {error}")

    if not connected:
        print("\nERROR: Could not connect to HiDock device.")
        print("Make sure:")
        print("  1. The device is connected via USB")
        print("  2. No other application is using it (close Electron app)")
        print("  3. libusb drivers are installed")
        return 1

    # Get device info
    try:
        info = device.get_device_info()
        if info:
            print(f"\nDevice: {info.get('model', 'Unknown')}")
            print(f"Serial: {info.get('serial_number', 'Unknown')}")
            print(f"Firmware: {info.get('firmware_version', 'Unknown')}")
    except Exception as e:
        print(f"Could not get device info: {e}")

    # List files
    print("\nFetching file list...")
    try:
        result = device.list_files(timeout_s=60)  # Longer timeout for many files
        files = result.get("files", [])
        total_files = result.get("totalFiles", len(files))
        total_size = result.get("totalSize", sum(f.get("length", 0) for f in files))
    except Exception as e:
        print(f"ERROR: Failed to list files: {e}")
        device.disconnect()
        return 1

    if not files:
        print("No files found on device.")
        device.disconnect()
        return 0

    print(f"\nFound {total_files} files ({format_size(total_size)} total)")

    # Calculate total duration
    total_duration = sum(f.get("duration", 0) for f in files)
    print(f"Total recording time: {format_duration(total_duration)}")

    # Filter to .wav and .hda files
    wav_files = [f for f in files if f["name"].lower().endswith(('.wav', '.hda'))]
    print(f"Audio files to download: {len(wav_files)}")

    # Check what already exists
    existing_count = 0
    to_download = []
    for f in wav_files:
        output_path = output_dir / f["name"]
        if output_path.exists() and output_path.stat().st_size == f["length"]:
            existing_count += 1
        else:
            to_download.append(f)

    print(f"Already downloaded: {existing_count}")
    print(f"To download: {len(to_download)}")

    if not to_download:
        print("\nAll files already downloaded!")
        device.disconnect()
        return 0

    # Download files
    print("\n" + "=" * 60)
    print("Starting downloads...")
    print("=" * 60)

    downloaded = 0
    failed = []
    skipped = 0
    start_time = time.time()

    for i, file_info in enumerate(to_download):
        filename = file_info["name"]
        file_size = file_info["length"]
        duration = file_info.get("duration", 0)

        print(f"\n[{i+1}/{len(to_download)}] {filename}")
        print(f"    Size: {format_size(file_size)}, Duration: {format_duration(duration)}")

        success, error = download_file(device, file_info, output_dir, args.retry_count)

        if success:
            if error == "already_exists":
                print(f"    SKIPPED (already exists)")
                skipped += 1
            else:
                print(f"    DONE")
                downloaded += 1
        else:
            print(f"    FAILED: {error}")
            failed.append((filename, error))

    # Summary
    elapsed = time.time() - start_time
    print("\n" + "=" * 60)
    print("Download Summary")
    print("=" * 60)
    print(f"Downloaded: {downloaded} files")
    print(f"Skipped (existing): {skipped} files")
    print(f"Failed: {len(failed)} files")
    print(f"Time elapsed: {format_duration(elapsed)}")

    if failed:
        print("\nFailed files:")
        for filename, error in failed:
            print(f"  - {filename}: {error}")

        # Write failed files to a log
        failed_log = output_dir / "failed_downloads.txt"
        with open(failed_log, 'w') as f:
            f.write(f"Failed downloads - {datetime.now().isoformat()}\n")
            f.write("-" * 40 + "\n")
            for filename, error in failed:
                f.write(f"{filename}: {error}\n")
        print(f"\nFailed files list saved to: {failed_log}")

    # Disconnect
    device.disconnect()
    print("\nDevice disconnected.")

    # Final verification
    print("\n" + "=" * 60)
    print("Verification")
    print("=" * 60)

    verified_count = 0
    for f in wav_files:
        output_path = output_dir / f["name"]
        if output_path.exists():
            if output_path.stat().st_size == f["length"]:
                verified_count += 1
            else:
                print(f"  Size mismatch: {f['name']}")

    print(f"Verified: {verified_count}/{len(wav_files)} files")

    if verified_count == len(wav_files):
        print("\nSUCCESS: All files downloaded and verified!")
        return 0
    else:
        print(f"\nWARNING: {len(wav_files) - verified_count} files not verified")
        return 1


if __name__ == "__main__":
    sys.exit(main())
