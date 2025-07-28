"""
Desktop Device Adapter - Implements the unified device interface for desktop application.

This adapter wraps the existing HiDockJensen class to implement the unified
IDeviceInterface, providing consistent API across platforms.
"""

import asyncio
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from config_and_logger import logger
from constants import DEFAULT_PRODUCT_ID, DEFAULT_VENDOR_ID
from device_interface import (
    AudioRecording,
    ConnectionStats,
    DeviceCapability,
    DeviceHealth,
    DeviceInfo,
    DeviceModel,
    IDeviceInterface,
    OperationProgress,
    OperationStatus,
    StorageInfo,
    detect_device_model,
    get_model_capabilities,
)
from hidock_device import HiDockJensen


class DesktopDeviceAdapter(IDeviceInterface):
    """
    Desktop implementation of the unified device interface using HiDockJensen.
    """

    def __init__(self, usb_backend=None):
        """
        Initialize the desktop device adapter.

        Args:
            usb_backend: USB backend instance for HiDockJensen
        """
        self.jensen_device = HiDockJensen(usb_backend)
        self.progress_callbacks: Dict[str, Callable[[OperationProgress], None]] = {}
        self._current_device_info: Optional[DeviceInfo] = None
        self._connection_start_time: Optional[datetime] = None

    async def discover_devices(self) -> List[DeviceInfo]:
        """
        Discover available HiDock devices.

        Returns:
            List[DeviceInfo]: List of discovered devices
        """
        try:
            # For desktop, we can try to find devices by attempting connection
            # This is a simplified implementation - in practice, you might want
            # to scan USB devices more systematically
            devices = []

            # Try common HiDock product IDs
            product_ids = [0xAF0C, 0xAF0D, 0xAF0E, DEFAULT_PRODUCT_ID]

            for pid in product_ids:
                try:
                    test_device = HiDockJensen(self.jensen_device.usb_backend)
                    found_device = test_device._find_device(DEFAULT_VENDOR_ID, pid)

                    if found_device:
                        model = detect_device_model(DEFAULT_VENDOR_ID, pid)

                        device_info = DeviceInfo(
                            id=f"{DEFAULT_VENDOR_ID:04x}:{pid:04x}",
                            name=f"HiDock {model.value}",
                            model=model,
                            serial_number=getattr(
                                found_device, "serial_number", "Unknown"
                            ),
                            firmware_version="1.0.0",  # Would need to be queried
                            vendor_id=DEFAULT_VENDOR_ID,
                            product_id=pid,
                            connected=False,
                            last_seen=datetime.now(),
                        )
                        devices.append(device_info)

                except Exception as e:
                    logger.debug(
                        "DesktopDeviceAdapter",
                        "discover_devices",
                        f"No device found for PID {pid:04x}: {e}",
                    )
                    continue

            return devices

        except Exception as e:
            logger.error(
                "DesktopDeviceAdapter",
                "discover_devices",
                f"Device discovery failed: {e}",
            )
            return []

    async def connect(
        self, device_id: Optional[str] = None, auto_retry: bool = True
    ) -> DeviceInfo:
        """
        Connect to a HiDock device.

        Args:
            device_id: Specific device ID to connect to, or None for first available
            auto_retry: Whether to automatically retry on connection failure

        Returns:
            DeviceInfo: Information about the connected device
        """
        try:
            self._connection_start_time = datetime.now()

            # Extract VID/PID from device_id if provided
            vid, pid = DEFAULT_VENDOR_ID, DEFAULT_PRODUCT_ID
            if device_id and ":" in device_id:
                try:
                    vid_str, pid_str = device_id.split(":")
                    vid, pid = int(vid_str, 16), int(pid_str, 16)
                except ValueError:
                    logger.warning(
                        f"Invalid device_id format: {device_id}, using defaults"
                    )

            # Connect using the Jensen device
            success, error_msg = self.jensen_device.connect(
                target_interface_number=0, vid=vid, pid=pid, auto_retry=auto_retry
            )

            if not success:
                raise ConnectionError(error_msg or "Connection failed")

            # Get device information
            device_info_raw = self.jensen_device.get_device_info() or {}
            model = detect_device_model(vid, pid)

            self._current_device_info = DeviceInfo(
                id=f"{vid:04x}:{pid:04x}",
                name=f"HiDock {model.value}",
                model=model,
                serial_number=device_info_raw.get("sn", "Unknown"),
                firmware_version=device_info_raw.get("versionCode", "1.0.0"),
                vendor_id=vid,
                product_id=pid,
                connected=True,
                connection_time=self._connection_start_time,
            )

            logger.info(
                "DesktopDeviceAdapter",
                "connect",
                f"Successfully connected to {self._current_device_info.name}",
            )
            return self._current_device_info

        except Exception as e:
            logger.error("DesktopDeviceAdapter", "connect", f"Connection failed: {e}")
            raise ConnectionError(f"Failed to connect to device: {e}")

    async def disconnect(self) -> None:
        """Disconnect from the current device."""
        try:
            self.jensen_device.disconnect()
            self._current_device_info = None
            self._connection_start_time = None
            logger.info(
                "DesktopDeviceAdapter", "disconnect", "Device disconnected successfully"
            )
        except Exception as e:
            logger.error(
                "DesktopDeviceAdapter", "disconnect", f"Disconnect failed: {e}"
            )
            raise RuntimeError(f"Failed to disconnect: {e}")

    def is_connected(self) -> bool:
        """Check if a device is currently connected."""
        return self.jensen_device.is_connected()

    async def get_device_info(self) -> DeviceInfo:
        """Get detailed information about the connected device."""
        if not self.is_connected():
            raise ConnectionError("No device connected")

        if self._current_device_info:
            return self._current_device_info

        # Fallback to querying device info
        device_info_raw = self.jensen_device.get_device_info() or {}
        model = detect_device_model(DEFAULT_VENDOR_ID, DEFAULT_PRODUCT_ID)

        return DeviceInfo(
            id="unknown",
            name=f"HiDock {model.value}",
            model=model,
            serial_number=device_info_raw.get("sn", "Unknown"),
            firmware_version=device_info_raw.get("versionCode", "1.0.0"),
            vendor_id=DEFAULT_VENDOR_ID,
            product_id=DEFAULT_PRODUCT_ID,
            connected=True,
        )

    async def get_storage_info(self) -> StorageInfo:
        """Get storage information from the device."""
        if not self.is_connected():
            raise ConnectionError("No device connected")

        try:
            # Get card info from Jensen device
            card_info = self.jensen_device.get_card_info()
            if card_info:
                status_raw = card_info.get("status_raw", 0)
                total_capacity = (
                    card_info.get("capacity", 0) * 1024 * 1024
                )  # Convert MB to bytes
                used_space = card_info.get("used", 0) * 1024 * 1024
                free_space = total_capacity - used_space
            else:
                # Fallback values
                total_capacity = 8 * 1024 * 1024 * 1024  # 8GB
                used_space = 0
                status_raw = 0
                free_space = total_capacity

            # Get file count
            file_count_info = self.jensen_device.get_file_count()
            file_count = file_count_info.get("count", 0) if file_count_info else 0

            return StorageInfo(
                total_capacity=total_capacity,
                used_space=used_space,
                free_space=free_space,
                file_count=file_count,
                health_status="good",
                last_updated=datetime.now(),
                status_raw=status_raw,
            )

        except Exception as e:
            logger.error(
                "DesktopDeviceAdapter",
                "get_storage_info",
                f"Failed to get storage info: {e}",
            )
            raise

    async def get_recordings(self) -> List[AudioRecording]:
        """Get list of audio recordings on the device."""
        if not self.is_connected():
            raise ConnectionError("No device connected")

        try:
            files_info = self.jensen_device.list_files()
            if not files_info or "files" not in files_info:
                return []

            recordings = []
            for i, file_info in enumerate(files_info["files"]):
                recording = AudioRecording(
                    id=file_info.get("name", ""),
                    filename=file_info.get("name", ""),
                    size=file_info.get("length", 0),
                    duration=file_info.get("duration", 0.0),
                    date_created=file_info.get("time", datetime.now()),
                    format_version=file_info.get("version", 1),
                    checksum=file_info.get("signature", ""),
                )
                recordings.append(recording)

            return recordings

        except Exception as e:
            logger.error(
                "DesktopDeviceAdapter",
                "get_recordings",
                f"Failed to get recordings: {e}",
            )
            raise

    async def get_current_recording_filename(self) -> Optional[str]:
        """Get the filename of the currently active recording."""
        if not self.is_connected():
            raise ConnectionError("No device connected")

        try:
            # This is a lightweight command to check for an active recording
            recording_info = self.jensen_device.get_recording_file()
            if not recording_info or not recording_info.get("name"):
                return None

            # The device returns the filename of the active recording.
            return recording_info.get("name")

        except Exception as e:
            logger.error(
                "DesktopDeviceAdapter",
                "get_current_recording_filename",
                f"Failed to get current recording filename: {e}",
            )
            return None  # Return None on error to avoid crashing the polling loop

    async def download_recording(
        self,
        recording_id: str,
        progress_callback: Optional[Callable[[OperationProgress], None]] = None,
        file_size: Optional[int] = None,
    ) -> bytes:
        """Download an audio recording from the device."""
        if not self.is_connected():
            raise ConnectionError("No device connected")

        try:
            # If file size is provided (from cache), use it to avoid expensive file list operation
            if file_size is not None:
                recording_filename = recording_id
                recording_size = file_size
                logger.debug(
                    "DesktopDeviceAdapter",
                    "download_recording",
                    f"Using cached file size {file_size} for {recording_id}",
                )
            else:
                # Fallback: Get recording info - we need the file size for proper download
                logger.debug(
                    "DesktopDeviceAdapter",
                    "download_recording",
                    f"No cached size available, fetching file list for {recording_id}",
                )
                recordings = await self.get_recordings()
                recording = next((r for r in recordings if r.id == recording_id), None)
                if not recording:
                    raise FileNotFoundError(f"Recording {recording_id} not found")
                recording_filename = recording.filename
                recording_size = recording.size

            # Set up progress tracking
            if progress_callback:
                self.add_progress_listener(
                    f"download_{recording_id}", progress_callback
                )

            # Download the file
            file_data = bytearray()

            def data_callback(chunk: bytes):
                file_data.extend(chunk)

            def progress_update(bytes_received: int, total_bytes: int):
                if progress_callback:
                    progress = OperationProgress(
                        operation_id=f"download_{recording_id}",
                        operation_name=f"Downloading {recording_filename}",
                        progress=(
                            bytes_received / total_bytes if total_bytes > 0 else 0.0
                        ),
                        status=OperationStatus.IN_PROGRESS,
                        bytes_processed=bytes_received,
                        total_bytes=total_bytes,
                        start_time=datetime.now(),
                    )
                    progress_callback(progress)

            # Use Jensen device to stream the file
            result = self.jensen_device.stream_file(
                filename=recording_filename,
                file_length=recording_size,
                data_callback=data_callback,
                progress_callback=progress_update,
                timeout_s=180,
            )

            if result != "OK":
                raise RuntimeError(f"Download failed: {result}")

            # Final progress update
            if progress_callback:
                final_progress = OperationProgress(
                    operation_id=f"download_{recording_id}",
                    operation_name=f"Downloaded {recording_filename}",
                    progress=1.0,
                    status=OperationStatus.COMPLETED,
                    bytes_processed=len(file_data),
                    total_bytes=recording_size,
                )
                progress_callback(final_progress)

            return bytes(file_data)

        except Exception as e:
            logger.error(
                "DesktopDeviceAdapter", "download_recording", f"Download failed: {e}"
            )
            if progress_callback:
                error_progress = OperationProgress(
                    operation_id=f"download_{recording_id}",
                    operation_name="Download failed",
                    progress=0.0,
                    status=OperationStatus.ERROR,
                    message=str(e),
                )
                progress_callback(error_progress)
            raise
        finally:
            self.remove_progress_listener(f"download_{recording_id}")

    async def delete_recording(
        self,
        recording_id: str,
        progress_callback: Optional[Callable[[OperationProgress], None]] = None,
    ) -> None:
        """Delete an audio recording from the device."""
        if not self.is_connected():
            raise ConnectionError("No device connected")

        try:
            # Get recording info
            recordings = await self.get_recordings()
            recording = next((r for r in recordings if r.id == recording_id), None)
            if not recording:
                raise FileNotFoundError(f"Recording {recording_id} not found")

            if progress_callback:
                progress_callback(
                    OperationProgress(
                        operation_id=f"delete_{recording_id}",
                        operation_name=f"Deleting {recording.filename}",
                        progress=0.5,
                        status=OperationStatus.IN_PROGRESS,
                    )
                )

            # Delete using Jensen device
            result = self.jensen_device.delete_file(recording.filename)

            if result.get("result") != "success":
                raise RuntimeError(
                    f"Delete failed: {result.get('result', 'unknown error')}"
                )

            if progress_callback:
                progress_callback(
                    OperationProgress(
                        operation_id=f"delete_{recording_id}",
                        operation_name=f"Deleted {recording.filename}",
                        progress=1.0,
                        status=OperationStatus.COMPLETED,
                    )
                )

        except Exception as e:
            logger.error(
                "DesktopDeviceAdapter", "delete_recording", f"Delete failed: {e}"
            )
            if progress_callback:
                progress_callback(
                    OperationProgress(
                        operation_id=f"delete_{recording_id}",
                        operation_name="Delete failed",
                        progress=0.0,
                        status=OperationStatus.ERROR,
                        message=str(e),
                    )
                )
            raise

    async def format_storage(
        self, progress_callback: Optional[Callable[[OperationProgress], None]] = None
    ) -> None:
        """Format the device storage."""
        if not self.is_connected():
            raise ConnectionError("No device connected")

        try:
            if progress_callback:
                progress_callback(
                    OperationProgress(
                        operation_id="format_storage",
                        operation_name="Formatting storage",
                        progress=0.5,
                        status=OperationStatus.IN_PROGRESS,
                    )
                )

            result = self.jensen_device.format_card()

            if result.get("result") != "success":
                raise RuntimeError(
                    f"Format failed: {result.get('result', 'unknown error')}"
                )

            if progress_callback:
                progress_callback(
                    OperationProgress(
                        operation_id="format_storage",
                        operation_name="Storage formatted successfully",
                        progress=1.0,
                        status=OperationStatus.COMPLETED,
                    )
                )

        except Exception as e:
            logger.error(
                "DesktopDeviceAdapter", "format_storage", f"Format failed: {e}"
            )
            if progress_callback:
                progress_callback(
                    OperationProgress(
                        operation_id="format_storage",
                        operation_name="Format failed",
                        progress=0.0,
                        status=OperationStatus.ERROR,
                        message=str(e),
                    )
                )
            raise

    async def sync_time(self, target_time: Optional[datetime] = None) -> None:
        """Synchronize device time."""
        if not self.is_connected():
            raise ConnectionError("No device connected")

        try:
            sync_time = target_time or datetime.now()
            result = self.jensen_device.set_device_time(sync_time)

            if result.get("result") != "success":
                raise RuntimeError(
                    f"Time sync failed: {result.get('error', 'unknown error')}"
                )

        except Exception as e:
            logger.error("DesktopDeviceAdapter", "sync_time", f"Time sync failed: {e}")
            raise

    def get_capabilities(self) -> List[DeviceCapability]:
        """Get list of capabilities supported by the connected device."""
        if not self.is_connected() or not self._current_device_info:
            return []

        return get_model_capabilities(self._current_device_info.model)

    def get_connection_stats(self) -> ConnectionStats:
        """Get connection statistics and performance metrics."""
        jensen_stats = self.jensen_device.get_connection_stats()

        return ConnectionStats(
            connection_attempts=jensen_stats.get("retry_count", 0) + 1,
            successful_connections=1 if jensen_stats.get("is_connected", False) else 0,
            failed_connections=jensen_stats.get("retry_count", 0),
            total_operations=jensen_stats.get("operation_stats", {}).get(
                "commands_sent", 0
            ),
            successful_operations=jensen_stats.get("operation_stats", {}).get(
                "responses_received", 0
            ),
            failed_operations=jensen_stats.get("operation_stats", {}).get(
                "commands_sent", 0
            )
            - jensen_stats.get("operation_stats", {}).get("responses_received", 0),
            bytes_transferred=jensen_stats.get("operation_stats", {}).get(
                "bytes_transferred", 0
            ),
            average_operation_time=jensen_stats.get("operation_stats", {}).get(
                "last_operation_time", 0
            ),
            uptime=time.time()
            - jensen_stats.get("operation_stats", {}).get(
                "connection_time", time.time()
            ),
            error_counts=jensen_stats.get("error_counts", {}),
        )

    async def get_device_health(self) -> DeviceHealth:
        """Get device health information."""
        if not self.is_connected():
            raise ConnectionError("No device connected")

        stats = self.get_connection_stats()

        # Calculate connection quality
        connection_quality = 1.0
        if stats.total_operations > 0:
            success_rate = stats.successful_operations / stats.total_operations
            connection_quality = success_rate

        # Calculate error rate
        error_rate = 0.0
        if stats.total_operations > 0:
            error_rate = stats.failed_operations / stats.total_operations

        # Determine overall status
        overall_status = "healthy"
        if error_rate > 0.1:
            overall_status = "error"
        elif error_rate > 0.05 or connection_quality < 0.8:
            overall_status = "warning"

        return DeviceHealth(
            overall_status=overall_status,
            connection_quality=connection_quality,
            error_rate=error_rate,
            last_successful_operation=(
                datetime.now() if stats.successful_operations > 0 else None
            ),
            temperature=None,  # Not available
            battery_level=None,  # Not available
            storage_health="good",  # Would need to be determined
            firmware_status="up_to_date",  # Would need to be determined
        )

    def add_progress_listener(
        self, operation_id: str, callback: Callable[[OperationProgress], None]
    ) -> None:
        """Add a progress listener for device operations."""
        self.progress_callbacks[operation_id] = callback

    def remove_progress_listener(self, operation_id: str) -> None:
        """Remove a progress listener."""
        self.progress_callbacks.pop(operation_id, None)

    async def test_connection(self) -> bool:
        """Test the current device connection."""
        if not self.is_connected():
            return False

        try:
            # Perform a lightweight operation to test connection
            device_info = self.jensen_device.get_device_info()
            return device_info is not None
        except Exception as e:
            logger.warning(
                "DesktopDeviceAdapter",
                "test_connection",
                f"Connection test failed: {e}",
            )
            return False


# Factory function to create desktop device adapter
def create_desktop_device_adapter(usb_backend=None) -> DesktopDeviceAdapter:
    """
    Create a desktop device adapter instance.

    Args:
        usb_backend: USB backend instance for HiDockJensen

    Returns:
        DesktopDeviceAdapter: Configured adapter instance
    """
    return DesktopDeviceAdapter(usb_backend)
