"""
Unified Device Interface Abstraction for HiDock Community Platform.

This module provides a common interface for device operations across both
desktop and web applications, enabling consistent device management,
model detection, capability reporting, storage monitoring, and health diagnostics.
"""

import threading
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Union


class DeviceModel(Enum):
    """Enumeration of supported HiDock device models."""

    H1 = "hidock-h1"
    H1E = "hidock-h1e"
    P1 = "hidock-p1"
    UNKNOWN = "unknown"


class DeviceCapability(Enum):
    """Enumeration of device capabilities."""

    FILE_LIST = "file_list"
    FILE_DOWNLOAD = "file_download"
    FILE_DELETE = "file_delete"
    FILE_UPLOAD = "file_upload"
    TIME_SYNC = "time_sync"
    FORMAT_STORAGE = "format_storage"
    SETTINGS_MANAGEMENT = "settings_management"
    HEALTH_MONITORING = "health_monitoring"
    REAL_TIME_RECORDING = "real_time_recording"
    AUDIO_PLAYBACK = "audio_playback"


class ConnectionStatus(Enum):
    """Device connection status."""

    DISCONNECTED = "disconnected"
    CONNECTING = "connecting"
    CONNECTED = "connected"
    ERROR = "error"
    RECONNECTING = "reconnecting"


class OperationStatus(Enum):
    """Status of device operations."""

    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    ERROR = "error"
    CANCELLED = "cancelled"


@dataclass
class DeviceInfo:
    """Device information structure."""

    id: str
    name: str
    model: DeviceModel
    serial_number: str
    firmware_version: str
    vendor_id: int
    product_id: int
    connected: bool
    connection_time: Optional[datetime] = None
    last_seen: Optional[datetime] = None


@dataclass
class StorageInfo:
    """Device storage information."""

    total_capacity: int  # bytes
    used_space: int  # bytes
    free_space: int  # bytes
    file_count: int
    status_raw: int = 0
    health_status: str = "good"
    last_updated: Optional[datetime] = None


@dataclass
class AudioRecording:
    """Audio recording metadata."""

    id: str
    filename: str
    size: int
    duration: float
    date_created: datetime
    format_version: int
    checksum: Optional[str] = None
    local_path: Optional[str] = None


@dataclass
class OperationProgress:
    """Progress information for device operations."""

    operation_id: str
    operation_name: str
    progress: float  # 0.0 to 1.0
    status: OperationStatus
    message: Optional[str] = None
    bytes_processed: int = 0
    total_bytes: int = 0
    start_time: Optional[datetime] = None
    estimated_completion: Optional[datetime] = None


@dataclass
class DeviceHealth:
    """Device health monitoring information."""

    overall_status: str  # "healthy", "warning", "error"
    connection_quality: float  # 0.0 to 1.0
    error_rate: float  # errors per operation
    last_successful_operation: Optional[datetime] = None
    temperature: Optional[float] = None
    battery_level: Optional[float] = None
    storage_health: Optional[str] = None
    firmware_status: Optional[str] = None


@dataclass
class ConnectionStats:
    """Connection statistics and performance metrics."""

    connection_attempts: int = 0
    successful_connections: int = 0
    failed_connections: int = 0
    total_operations: int = 0
    successful_operations: int = 0
    failed_operations: int = 0
    bytes_transferred: int = 0
    average_operation_time: float = 0.0
    uptime: float = 0.0
    error_counts: Dict[str, int] = None

    def __post_init__(self):
        if self.error_counts is None:
            self.error_counts = {}


class IDeviceInterface(ABC):
    """
    Abstract interface for HiDock device operations.

    This interface defines the common operations that must be implemented
    by both desktop and web device services to ensure consistent behavior
    across platforms.
    """

    @abstractmethod
    async def discover_devices(self) -> List[DeviceInfo]:
        """
        Discover available HiDock devices.

        Returns:
            List[DeviceInfo]: List of discovered devices
        """
        pass

    @abstractmethod
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

        Raises:
            ConnectionError: If connection fails
        """
        pass

    @abstractmethod
    async def disconnect(self) -> None:
        """
        Disconnect from the current device.

        Raises:
            RuntimeError: If disconnection fails
        """
        pass

    @abstractmethod
    def is_connected(self) -> bool:
        """
        Check if a device is currently connected.

        Returns:
            bool: True if connected, False otherwise
        """
        pass

    @abstractmethod
    async def get_device_info(self) -> DeviceInfo:
        """
        Get detailed information about the connected device.

        Returns:
            DeviceInfo: Device information

        Raises:
            ConnectionError: If no device is connected
        """
        pass

    @abstractmethod
    async def get_storage_info(self) -> StorageInfo:
        """
        Get storage information from the device.

        Returns:
            StorageInfo: Storage information

        Raises:
            ConnectionError: If no device is connected
        """
        pass

    @abstractmethod
    async def get_recordings(self) -> List[AudioRecording]:
        """
        Get list of audio recordings on the device.

        Returns:
            List[AudioRecording]: List of recordings

        Raises:
            ConnectionError: If no device is connected
        """
        pass

    @abstractmethod
    async def get_current_recording_filename(self) -> Optional[str]:
        """
        Get the filename of the currently active recording, if any.

        This is intended to be a lightweight operation compared to get_recordings().

        Returns:
            Optional[str]: Filename of the active recording, or None.

        Raises:
            ConnectionError: If no device is connected.
        """
        pass

    @abstractmethod
    async def download_recording(
        self,
        recording_id: str,
        progress_callback: Optional[Callable[[OperationProgress], None]] = None,
        file_size: Optional[int] = None,
    ) -> bytes:
        """
        Download an audio recording from the device.

        Args:
            recording_id: ID of the recording to download
            progress_callback: Optional callback for progress updates
            file_size: Optional file size from cache to avoid expensive file list operation

        Returns:
            bytes: Raw audio data

        Raises:
            ConnectionError: If no device is connected
            FileNotFoundError: If recording not found
        """
        pass

    @abstractmethod
    async def delete_recording(
        self,
        recording_id: str,
        progress_callback: Optional[Callable[[OperationProgress], None]] = None,
    ) -> None:
        """
        Delete an audio recording from the device.

        Args:
            recording_id: ID of the recording to delete
            progress_callback: Optional callback for progress updates

        Raises:
            ConnectionError: If no device is connected
            FileNotFoundError: If recording not found
        """
        pass

    @abstractmethod
    async def format_storage(
        self, progress_callback: Optional[Callable[[OperationProgress], None]] = None
    ) -> None:
        """
        Format the device storage.

        Args:
            progress_callback: Optional callback for progress updates

        Raises:
            ConnectionError: If no device is connected
        """
        pass

    @abstractmethod
    async def sync_time(self, target_time: Optional[datetime] = None) -> None:
        """
        Synchronize device time.

        Args:
            target_time: Time to set, or None for current system time

        Raises:
            ConnectionError: If no device is connected
        """
        pass

    @abstractmethod
    def get_capabilities(self) -> List[DeviceCapability]:
        """
        Get list of capabilities supported by the connected device.

        Returns:
            List[DeviceCapability]: List of supported capabilities
        """
        pass

    @abstractmethod
    def get_connection_stats(self) -> ConnectionStats:
        """
        Get connection statistics and performance metrics.

        Returns:
            ConnectionStats: Connection statistics
        """
        pass

    @abstractmethod
    async def get_device_health(self) -> DeviceHealth:
        """
        Get device health information.

        Returns:
            DeviceHealth: Device health status

        Raises:
            ConnectionError: If no device is connected
        """
        pass

    @abstractmethod
    def add_progress_listener(
        self, operation_id: str, callback: Callable[[OperationProgress], None]
    ) -> None:
        """
        Add a progress listener for device operations.

        Args:
            operation_id: ID of the operation to monitor
            callback: Callback function for progress updates
        """
        pass

    @abstractmethod
    def remove_progress_listener(self, operation_id: str) -> None:
        """
        Remove a progress listener.

        Args:
            operation_id: ID of the operation to stop monitoring
        """
        pass

    @abstractmethod
    async def test_connection(self) -> bool:
        """
        Test the current device connection.

        Returns:
            bool: True if connection is healthy, False otherwise
        """
        pass


class DeviceManager:
    """
    Device manager that provides unified access to device operations
    with automatic model detection and capability management.
    """

    def __init__(self, device_interface: IDeviceInterface):
        """
        Initialize the device manager.

        Args:
            device_interface: Implementation of the device interface
        """
        self.device_interface = device_interface
        self._current_device: Optional[DeviceInfo] = None
        self._capabilities: List[DeviceCapability] = []
        self._health_monitor_active = False
        self._health_monitor_thread: Optional[threading.Thread] = None
        self._health_check_interval = 30.0  # seconds
        self._health_callbacks: List[Callable[[DeviceHealth], None]] = []

    async def initialize(self) -> None:
        """Initialize the device manager."""
        pass

    async def connect_to_device(
        self, device_id: Optional[str] = None, auto_retry: bool = True
    ) -> DeviceInfo:
        """
        Connect to a device with automatic model detection.

        Args:
            device_id: Specific device ID or None for auto-discovery
            auto_retry: Whether to retry on failure

        Returns:
            DeviceInfo: Connected device information
        """
        device_info = await self.device_interface.connect(device_id, auto_retry)
        self._current_device = device_info
        self._capabilities = self.device_interface.get_capabilities()

        # Start health monitoring if supported
        if DeviceCapability.HEALTH_MONITORING in self._capabilities:
            await self._start_health_monitoring()

        return device_info

    async def disconnect_device(self) -> None:
        """Disconnect from the current device."""
        if self._health_monitor_active:
            await self._stop_health_monitoring()

        await self.device_interface.disconnect()
        self._current_device = None
        self._capabilities = []

    def get_current_device(self) -> Optional[DeviceInfo]:
        """Get information about the currently connected device."""
        return self._current_device

    def get_device_capabilities(self) -> List[DeviceCapability]:
        """Get capabilities of the current device."""
        return self._capabilities.copy()

    def has_capability(self, capability: DeviceCapability) -> bool:
        """Check if the current device has a specific capability."""
        return capability in self._capabilities

    async def get_device_model_info(self) -> Dict[str, Any]:
        """
        Get detailed model-specific information.

        Returns:
            Dict containing model-specific details
        """
        if not self._current_device:
            raise ConnectionError("No device connected")

        model_info = {
            "model": self._current_device.model.value,
            "capabilities": [cap.value for cap in self._capabilities],
            "specifications": self._get_model_specifications(
                self._current_device.model
            ),
            "recommended_settings": self._get_recommended_settings(
                self._current_device.model
            ),
        }

        return model_info

    def _get_model_specifications(self, model: DeviceModel) -> Dict[str, Any]:
        """Get technical specifications for a device model."""
        specs = {
            DeviceModel.H1: {
                "max_storage": "8GB",
                "audio_format": "WAV/HDA",
                "sample_rate": "48kHz",
                "bit_depth": "16-bit",
                "channels": "Mono",
                "battery_life": "20 hours",
                "connectivity": "USB 2.0",
            },
            DeviceModel.H1E: {
                "max_storage": "16GB",
                "audio_format": "WAV/HDA",
                "sample_rate": "48kHz",
                "bit_depth": "16-bit",
                "channels": "Mono",
                "battery_life": "24 hours",
                "connectivity": "USB 2.0",
                "features": ["Auto-record", "Bluetooth"],
            },
            DeviceModel.P1: {
                "max_storage": "32GB",
                "audio_format": "WAV/HDA/MP3",
                "sample_rate": "48kHz",
                "bit_depth": "24-bit",
                "channels": "Stereo",
                "battery_life": "30 hours",
                "connectivity": "USB-C",
                "features": ["Auto-record", "Bluetooth", "Noise cancellation"],
            },
        }

        return specs.get(model, {})

    def _get_recommended_settings(self, model: DeviceModel) -> Dict[str, Any]:
        """Get recommended settings for a device model."""
        settings = {
            DeviceModel.H1: {
                "auto_record": False,
                "audio_quality": "standard",
                "power_saving": True,
            },
            DeviceModel.H1E: {
                "auto_record": True,
                "audio_quality": "high",
                "bluetooth_enabled": True,
                "power_saving": False,
            },
            DeviceModel.P1: {
                "auto_record": True,
                "audio_quality": "premium",
                "noise_cancellation": True,
                "bluetooth_enabled": True,
                "power_saving": False,
            },
        }

        return settings.get(model, {})

    async def _start_health_monitoring(self) -> None:
        """Start background health monitoring."""
        if self._health_monitor_active:
            return

        self._health_monitor_active = True
        self._health_monitor_thread = threading.Thread(
            target=self._health_monitor_loop, daemon=True
        )
        self._health_monitor_thread.start()

    async def _stop_health_monitoring(self) -> None:
        """Stop background health monitoring."""
        self._health_monitor_active = False
        if self._health_monitor_thread:
            self._health_monitor_thread.join(timeout=5.0)
            self._health_monitor_thread = None

    def _health_monitor_loop(self) -> None:
        """Background health monitoring loop."""
        while self._health_monitor_active:
            try:
                # This would need to be adapted for async context
                # In practice, you'd use asyncio.run or similar
                health = None  # await self.device_interface.get_device_health()

                if health:
                    for callback in self._health_callbacks:
                        try:
                            callback(health)
                        except Exception as e:
                            print(f"Health callback error: {e}")

            except Exception as e:
                print(f"Health monitoring error: {e}")

            time.sleep(self._health_check_interval)

    def add_health_callback(self, callback: Callable[[DeviceHealth], None]) -> None:
        """Add a callback for health status updates."""
        self._health_callbacks.append(callback)

    def remove_health_callback(self, callback: Callable[[DeviceHealth], None]) -> None:
        """Remove a health status callback."""
        if callback in self._health_callbacks:
            self._health_callbacks.remove(callback)

    async def perform_diagnostics(self) -> Dict[str, Any]:
        """
        Perform comprehensive device diagnostics.

        Returns:
            Dict containing diagnostic results
        """
        if not self._current_device:
            raise ConnectionError("No device connected")

        diagnostics = {
            "timestamp": datetime.now(),
            "device_info": self._current_device,
            "connection_test": await self.device_interface.test_connection(),
            "storage_info": await self.device_interface.get_storage_info(),
            "connection_stats": self.device_interface.get_connection_stats(),
        }

        if DeviceCapability.HEALTH_MONITORING in self._capabilities:
            diagnostics["health_status"] = (
                await self.device_interface.get_device_health()
            )

        return diagnostics

    def get_storage_recommendations(self, storage_info: StorageInfo) -> List[str]:
        """
        Get storage optimization recommendations.

        Args:
            storage_info: Current storage information

        Returns:
            List of recommendation strings
        """
        recommendations = []
        usage_percent = (storage_info.used_space / storage_info.total_capacity) * 100

        if usage_percent > 90:
            recommendations.append("Storage is critically full. Delete old recordings.")
        elif usage_percent > 75:
            recommendations.append(
                "Storage is getting full. Consider backing up recordings."
            )
        elif usage_percent > 50:
            recommendations.append("Storage is half full. Regular cleanup recommended.")

        if storage_info.file_count > 1000:
            recommendations.append(
                "Large number of files detected. Consider organizing recordings."
            )

        if storage_info.health_status != "good":
            recommendations.append(
                f"Storage health issue detected: {storage_info.health_status}"
            )

        return recommendations


# Utility functions for device model detection
def detect_device_model(vendor_id: int, product_id: int) -> DeviceModel:
    """
    Detect device model from USB identifiers.

    Args:
        vendor_id: USB vendor ID
        product_id: USB product ID

    Returns:
        DeviceModel: Detected device model
    """
    model_map = {
        0xAF0C: DeviceModel.H1,
        0xAF0D: DeviceModel.H1E,
        0xB00D: DeviceModel.H1E,  # Add PID from logs for H1E
        0xAF0E: DeviceModel.P1,
    }

    return model_map.get(product_id, DeviceModel.UNKNOWN)


def get_model_capabilities(model: DeviceModel) -> List[DeviceCapability]:
    """
    Get capabilities for a specific device model.

    Args:
        model: Device model

    Returns:
        List[DeviceCapability]: List of capabilities
    """
    base_capabilities = [
        DeviceCapability.FILE_LIST,
        DeviceCapability.FILE_DOWNLOAD,
        DeviceCapability.FILE_DELETE,
        DeviceCapability.TIME_SYNC,
    ]

    model_specific = {
        DeviceModel.H1: [
            DeviceCapability.FORMAT_STORAGE,
        ],
        DeviceModel.H1E: [
            DeviceCapability.FORMAT_STORAGE,
            DeviceCapability.SETTINGS_MANAGEMENT,
            DeviceCapability.HEALTH_MONITORING,
        ],
        DeviceModel.P1: [
            DeviceCapability.FORMAT_STORAGE,
            DeviceCapability.SETTINGS_MANAGEMENT,
            DeviceCapability.HEALTH_MONITORING,
            DeviceCapability.REAL_TIME_RECORDING,
            DeviceCapability.AUDIO_PLAYBACK,
        ],
    }

    return base_capabilities + model_specific.get(model, [])
