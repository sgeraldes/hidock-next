"""
Tests for the Desktop Device Adapter Module.

This test suite covers the desktop implementation of the unified device interface,
including device discovery, connection management, data operations, and error handling.
"""

import asyncio
import time
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, Mock, mock_open, patch

import pytest

# Import the module under test
import desktop_device_adapter
from desktop_device_adapter import DesktopDeviceAdapter
from device_interface import (
    AudioRecording,
    ConnectionStats,
    DeviceCapability,
    DeviceHealth,
    DeviceInfo,
    DeviceModel,
    OperationProgress,
    OperationStatus,
    StorageInfo,
)


class TestDesktopDeviceAdapterInitialization:
    """Test DesktopDeviceAdapter initialization."""

    @patch("desktop_device_adapter.HiDockJensen")
    def test_desktop_adapter_initialization_default(self, mock_jensen):
        """Test adapter initialization with default parameters."""
        adapter = DesktopDeviceAdapter()

        assert adapter.jensen_device is not None
        assert adapter.progress_callbacks == {}
        assert adapter._current_device_info is None
        assert adapter._connection_start_time is None

        mock_jensen.assert_called_once_with(None)

    @patch("desktop_device_adapter.HiDockJensen")
    def test_desktop_adapter_initialization_with_backend(self, mock_jensen):
        """Test adapter initialization with custom USB backend."""
        mock_backend = Mock()
        adapter = DesktopDeviceAdapter(usb_backend=mock_backend)

        mock_jensen.assert_called_once_with(mock_backend)


class TestDeviceDiscovery:
    """Test device discovery functionality."""

    def setup_method(self):
        """Set up test fixtures."""
        self.patcher = patch("desktop_device_adapter.HiDockJensen")
        self.mock_jensen_class = self.patcher.start()
        self.mock_jensen = Mock()
        self.mock_jensen_class.return_value = self.mock_jensen
        self.adapter = DesktopDeviceAdapter()

    def teardown_method(self):
        """Clean up after tests."""
        self.patcher.stop()

    @pytest.mark.asyncio
    async def test_discover_devices_success(self):
        """Test successful device discovery."""
        with patch("desktop_device_adapter.detect_device_model") as mock_detect, patch(
            "desktop_device_adapter.HiDockJensen"
        ) as mock_jensen_class:
            mock_detect.return_value = DeviceModel.H1E

            # Mock only first 2 product IDs to return devices
            def mock_find_device(vid, pid):
                if pid in [0xAF0C, 0xAF0D]:  # Only first 2 PIDs have devices
                    mock_device = Mock()
                    mock_device.serial_number = f"TEST{pid:04X}"
                    return mock_device
                return None

            mock_test_device = Mock()
            mock_test_device._find_device.side_effect = mock_find_device
            mock_jensen_class.return_value = mock_test_device

            devices = await self.adapter.discover_devices()

            assert len(devices) == 2
            assert all(isinstance(device, DeviceInfo) for device in devices)
            assert devices[0].id == "10d6:af0c"
            assert devices[1].id == "10d6:af0d"

    @pytest.mark.asyncio
    async def test_discover_devices_empty_list(self):
        """Test device discovery when no devices found."""
        with patch("desktop_device_adapter.HiDockJensen") as mock_jensen_class:
            # Mock _find_device to return None for all product IDs
            mock_test_device = Mock()
            mock_test_device._find_device.return_value = None
            mock_jensen_class.return_value = mock_test_device

            devices = await self.adapter.discover_devices()

            assert devices == []

    @pytest.mark.asyncio
    async def test_discover_devices_exception(self):
        """Test device discovery with exception handling."""
        with patch("desktop_device_adapter.HiDockJensen") as mock_jensen_class:
            # Mock _find_device to raise exception
            mock_test_device = Mock()
            mock_test_device._find_device.side_effect = Exception("USB error")
            mock_jensen_class.return_value = mock_test_device

            devices = await self.adapter.discover_devices()

            assert devices == []


class TestConnectionManagement:
    """Test device connection and disconnection."""

    def setup_method(self):
        """Set up test fixtures."""
        self.patcher = patch("desktop_device_adapter.HiDockJensen")
        self.mock_jensen_class = self.patcher.start()
        self.mock_jensen = Mock()
        self.mock_jensen_class.return_value = self.mock_jensen
        self.adapter = DesktopDeviceAdapter()

    def teardown_method(self):
        """Clean up after tests."""
        self.patcher.stop()

    @pytest.mark.asyncio
    async def test_connect_with_device_info(self):
        """Test connection with specific device info."""
        device_id = "10d6:b00d"

        self.mock_jensen.connect.return_value = (True, None)
        self.mock_jensen.get_device_info.return_value = {"sn": "TEST123", "versionCode": "1.0.0"}

        with patch("desktop_device_adapter.detect_device_model") as mock_detect:
            mock_detect.return_value = DeviceModel.H1E

            result = await self.adapter.connect(device_id=device_id)

            assert isinstance(result, DeviceInfo)
            assert result.id == device_id
            assert result.serial_number == "TEST123"
            assert self.adapter._current_device_info == result
            assert self.adapter._connection_start_time is not None

    @pytest.mark.asyncio
    async def test_connect_with_device_id(self):
        """Test connection with device ID."""
        device_id = "test_device_123"

        self.mock_jensen.connect.return_value = (True, None)
        self.mock_jensen.get_device_info.return_value = {"sn": "TEST456", "versionCode": "2.0.0"}

        with patch("desktop_device_adapter.detect_device_model") as mock_detect:
            mock_detect.return_value = DeviceModel.P1

            result = await self.adapter.connect(device_id=device_id)

            assert isinstance(result, DeviceInfo)
            assert result.serial_number == "TEST456"

    @pytest.mark.asyncio
    async def test_connect_default_parameters(self):
        """Test connection with default parameters."""
        self.mock_jensen.connect.return_value = (True, None)
        self.mock_jensen.get_device_info.return_value = {"sn": "DEFAULT", "versionCode": "1.0.0"}

        with patch("desktop_device_adapter.detect_device_model") as mock_detect:
            mock_detect.return_value = DeviceModel.H1E

            result = await self.adapter.connect()

            assert isinstance(result, DeviceInfo)
            assert result.serial_number == "DEFAULT"

    @pytest.mark.asyncio
    async def test_connect_failure(self):
        """Test connection failure handling."""
        self.mock_jensen.connect.return_value = (False, "Connection failed")

        with pytest.raises(ConnectionError):
            await self.adapter.connect()

        assert self.adapter._current_device_info is None

    @pytest.mark.asyncio
    async def test_connect_exception(self):
        """Test connection exception handling."""
        self.mock_jensen.connect.side_effect = Exception("Connection error")

        with pytest.raises(ConnectionError):
            await self.adapter.connect()

    @pytest.mark.asyncio
    async def test_disconnect(self):
        """Test device disconnection."""
        # Set up connected state
        self.adapter._current_device_info = Mock()
        self.adapter._connection_start_time = datetime.now()

        await self.adapter.disconnect()

        assert self.adapter._current_device_info is None
        assert self.adapter._connection_start_time is None
        self.mock_jensen.disconnect.assert_called_once()

    def test_is_connected_true(self):
        """Test is_connected when device is connected."""
        self.mock_jensen.is_connected.return_value = True

        result = self.adapter.is_connected()

        assert result is True

    def test_is_connected_false(self):
        """Test is_connected when device is not connected."""
        self.mock_jensen.is_connected.return_value = False

        result = self.adapter.is_connected()

        assert result is False


class TestDeviceInformation:
    """Test device information retrieval."""

    def setup_method(self):
        """Set up test fixtures."""
        self.patcher = patch("desktop_device_adapter.HiDockJensen")
        self.mock_jensen_class = self.patcher.start()
        self.mock_jensen = Mock()
        self.mock_jensen_class.return_value = self.mock_jensen
        self.adapter = DesktopDeviceAdapter()

    def teardown_method(self):
        """Clean up after tests."""
        self.patcher.stop()

    @pytest.mark.asyncio
    async def test_get_device_info_cached(self):
        """Test getting device info from cache."""
        cached_info = DeviceInfo(
            id="cached_device",
            name="HiDock hidock-h1e",
            model=DeviceModel.H1E,
            serial_number="CACHED123",
            firmware_version="1.0.0",
            vendor_id=0x10D6,
            product_id=0xB00D,
            connected=True,
        )
        self.adapter._current_device_info = cached_info

        result = await self.adapter.get_device_info()

        assert result == cached_info
        # Should not call Jensen device for cached info
        self.mock_jensen.get_device_info.assert_not_called()

    @pytest.mark.asyncio
    async def test_get_device_info_from_device(self):
        """Test getting device info from device."""
        mock_info = {"sn": "SN123456", "versionCode": "2.0.0"}
        self.mock_jensen.get_device_info.return_value = mock_info
        self.mock_jensen.is_connected.return_value = True

        with patch("desktop_device_adapter.detect_device_model") as mock_detect:
            mock_detect.return_value = DeviceModel.P1

            result = await self.adapter.get_device_info()

            assert isinstance(result, DeviceInfo)
            assert result.id == "unknown"
            assert result.serial_number == "SN123456"
            assert result.model == DeviceModel.P1


class TestStorageOperations:
    """Test storage-related operations."""

    def setup_method(self):
        """Set up test fixtures."""
        self.patcher = patch("desktop_device_adapter.HiDockJensen")
        self.mock_jensen_class = self.patcher.start()
        self.mock_jensen = Mock()
        self.mock_jensen_class.return_value = self.mock_jensen
        self.adapter = DesktopDeviceAdapter()

    def teardown_method(self):
        """Clean up after tests."""
        self.patcher.stop()

    @pytest.mark.asyncio
    async def test_get_storage_info_success(self):
        """Test successful storage info retrieval."""
        mock_card_info = {"capacity": 1000, "used": 750, "status_raw": 0}  # MB  # MB
        mock_file_count = {"count": 50}

        self.mock_jensen.is_connected.return_value = True
        # Mock the streaming check to return False
        self.mock_jensen.is_file_list_streaming = Mock(return_value=False)
        self.mock_jensen.get_card_info.return_value = mock_card_info
        self.mock_jensen.get_file_count.return_value = mock_file_count

        result = await self.adapter.get_storage_info()

        assert isinstance(result, StorageInfo)
        assert result.total_capacity == 1000 * 1024 * 1024  # Convert MB to bytes
        assert result.used_space == 750 * 1024 * 1024
        assert result.free_space == 250 * 1024 * 1024
        assert result.file_count == 50

    @pytest.mark.asyncio
    async def test_get_storage_info_exception(self):
        """Test storage info retrieval with exception."""
        self.mock_jensen.is_connected.return_value = True
        # Mock the streaming check to return False
        self.mock_jensen.is_file_list_streaming = Mock(return_value=False)
        self.mock_jensen.get_card_info.side_effect = Exception("Storage error")

        with pytest.raises(Exception):
            await self.adapter.get_storage_info()

    @pytest.mark.asyncio
    async def test_format_storage_success(self):
        """Test successful storage formatting."""
        progress_callback = Mock()
        self.mock_jensen.is_connected.return_value = True
        self.mock_jensen.format_card.return_value = {"result": "success"}

        await self.adapter.format_storage(progress_callback)

        self.mock_jensen.format_card.assert_called_once()
        # Progress callback should be called for completion
        assert progress_callback.call_count >= 1


class TestRecordingOperations:
    """Test recording-related operations."""

    def setup_method(self):
        """Set up test fixtures."""
        self.patcher = patch("desktop_device_adapter.HiDockJensen")
        self.mock_jensen_class = self.patcher.start()
        self.mock_jensen = Mock()
        self.mock_jensen_class.return_value = self.mock_jensen
        self.adapter = DesktopDeviceAdapter()

    def teardown_method(self):
        """Clean up after tests."""
        self.patcher.stop()

    @pytest.mark.asyncio
    async def test_get_recordings_success(self):
        """Test successful recordings retrieval."""
        mock_files_info = {
            "files": [
                {
                    "filename": "recording1.hta",
                    "size": 1024,
                    "created": datetime.now() - timedelta(hours=1),
                    "duration": 60.0,
                },
                {
                    "filename": "recording2.hta",
                    "size": 2048,
                    "created": datetime.now() - timedelta(hours=2),
                    "duration": 120.0,
                },
            ]
        }
        self.mock_jensen.is_connected.return_value = True
        self.mock_jensen.list_files.return_value = mock_files_info

        result = await self.adapter.get_recordings()

        assert len(result) == 2
        assert result[0]["filename"] == "recording1.hta"
        assert result[1]["size"] == 2048

    @pytest.mark.asyncio
    async def test_get_current_recording_filename(self):
        """Test getting current recording filename."""
        self.mock_jensen.is_connected.return_value = True
        # Mock the streaming check to return False
        self.mock_jensen.is_file_list_streaming = Mock(return_value=False)
        self.mock_jensen.get_recording_file.return_value = {"name": "current_recording.hta"}

        result = await self.adapter.get_current_recording_filename()

        assert result == "current_recording.hta"

    @pytest.mark.asyncio
    async def test_download_recording_success(self):
        """Test successful recording download."""
        progress_callback = Mock()
        self.mock_jensen.is_connected.return_value = True
        self.mock_jensen.stream_file.return_value = "OK"

        with patch("builtins.open", mock_open()) as mock_file:
            await self.adapter.download_recording("test.hta", "/tmp/output.wav", progress_callback, file_size=1024)

            mock_file.assert_called_once_with("/tmp/output.wav", "wb")
            self.mock_jensen.stream_file.assert_called_once()

    @pytest.mark.asyncio
    async def test_delete_recording_success(self):
        """Test successful recording deletion."""
        progress_callback = Mock()

        # Create a mock recording object that has both dict access and attributes
        class MockRecording:
            def __init__(self, id_val, filename):
                self.id = id_val
                self.filename = filename

        mock_recording = MockRecording("test.hta", "test.hta")

        self.mock_jensen.is_connected.return_value = True
        self.mock_jensen.delete_file.return_value = {"result": "success"}

        # Mock the get_recordings method to return our mock recording
        with patch.object(self.adapter, "get_recordings", return_value=[mock_recording]):
            await self.adapter.delete_recording("test.hta", progress_callback)

        self.mock_jensen.delete_file.assert_called_once_with("test.hta")


class TestProgressManagement:
    """Test progress callback management."""

    def setup_method(self):
        """Set up test fixtures."""
        self.patcher = patch("desktop_device_adapter.HiDockJensen")
        self.mock_jensen_class = self.patcher.start()
        self.mock_jensen = Mock()
        self.mock_jensen_class.return_value = self.mock_jensen
        self.adapter = DesktopDeviceAdapter()

    def teardown_method(self):
        """Clean up after tests."""
        self.patcher.stop()

    def test_add_progress_listener(self):
        """Test adding progress listener."""
        callback = Mock()
        operation_id = "test_operation"

        self.adapter.add_progress_listener(operation_id, callback)

        assert operation_id in self.adapter.progress_callbacks
        assert self.adapter.progress_callbacks[operation_id] == callback

    def test_remove_progress_listener(self):
        """Test removing progress listener."""
        callback = Mock()
        operation_id = "test_operation"

        self.adapter.add_progress_listener(operation_id, callback)
        assert operation_id in self.adapter.progress_callbacks

        self.adapter.remove_progress_listener(operation_id)
        assert operation_id not in self.adapter.progress_callbacks

    def test_remove_nonexistent_progress_listener(self):
        """Test removing non-existent progress listener."""
        # Should not raise an exception
        self.adapter.remove_progress_listener("nonexistent")
        assert "nonexistent" not in self.adapter.progress_callbacks


class TestDeviceCapabilities:
    """Test device capability functions."""

    def setup_method(self):
        """Set up test fixtures."""
        self.patcher = patch("desktop_device_adapter.HiDockJensen")
        self.mock_jensen_class = self.patcher.start()
        self.mock_jensen = Mock()
        self.mock_jensen_class.return_value = self.mock_jensen
        self.adapter = DesktopDeviceAdapter()

    def teardown_method(self):
        """Clean up after tests."""
        self.patcher.stop()

    def test_get_capabilities(self):
        """Test getting device capabilities."""
        self.adapter._current_device_info = DeviceInfo(
            id="test",
            name="HiDock hidock-h1e",
            model=DeviceModel.H1E,
            serial_number="TEST123",
            firmware_version="1.0.0",
            vendor_id=0x10D6,
            product_id=0xB00D,
            connected=True,
        )
        self.mock_jensen.is_connected.return_value = True

        with patch("desktop_device_adapter.get_model_capabilities") as mock_get_caps:
            mock_caps = [DeviceCapability.FILE_LIST, DeviceCapability.FILE_DOWNLOAD]
            mock_get_caps.return_value = mock_caps

            result = self.adapter.get_capabilities()

            assert result == mock_caps
            mock_get_caps.assert_called_once_with(DeviceModel.H1E)

    def test_get_capabilities_no_device_info(self):
        """Test getting capabilities when no device info available."""
        result = self.adapter.get_capabilities()

        assert result == []


class TestConnectionStats:
    """Test connection statistics."""

    def setup_method(self):
        """Set up test fixtures."""
        self.patcher = patch("desktop_device_adapter.HiDockJensen")
        self.mock_jensen_class = self.patcher.start()
        self.mock_jensen = Mock()
        self.mock_jensen_class.return_value = self.mock_jensen
        self.adapter = DesktopDeviceAdapter()

    def teardown_method(self):
        """Clean up after tests."""
        self.patcher.stop()

    def test_get_connection_stats_connected(self):
        """Test connection stats when connected."""
        mock_stats = {
            "retry_count": 2,
            "is_connected": True,
            "operation_stats": {
                "commands_sent": 10,
                "responses_received": 8,
                "bytes_transferred": 1024,
                "last_operation_time": 0.5,
                "connection_time": time.time() - 1800,
            },
            "error_counts": {"timeout": 1},
        }
        self.mock_jensen.get_connection_stats.return_value = mock_stats

        result = self.adapter.get_connection_stats()

        assert isinstance(result, ConnectionStats)
        assert result.connection_attempts == 3  # retry_count + 1
        assert result.successful_connections == 1
        assert result.total_operations == 10

    def test_get_connection_stats_disconnected(self):
        """Test connection stats when disconnected."""
        mock_stats = {
            "retry_count": 0,
            "is_connected": False,
            "operation_stats": {
                "commands_sent": 0,
                "responses_received": 0,
                "bytes_transferred": 0,
                "last_operation_time": 0,
                "connection_time": time.time(),
            },
            "error_counts": {},
        }
        self.mock_jensen.get_connection_stats.return_value = mock_stats

        result = self.adapter.get_connection_stats()

        assert isinstance(result, ConnectionStats)
        assert result.successful_connections == 0
        assert result.total_operations == 0


class TestDeviceHealth:
    """Test device health monitoring."""

    def setup_method(self):
        """Set up test fixtures."""
        self.patcher = patch("desktop_device_adapter.HiDockJensen")
        self.mock_jensen_class = self.patcher.start()
        self.mock_jensen = Mock()
        self.mock_jensen_class.return_value = self.mock_jensen
        self.adapter = DesktopDeviceAdapter()

    def teardown_method(self):
        """Clean up after tests."""
        self.patcher.stop()

    @pytest.mark.asyncio
    async def test_get_device_health_success(self):
        """Test successful device health retrieval."""
        mock_stats = {
            "retry_count": 0,
            "is_connected": True,
            "operation_stats": {
                "commands_sent": 10,
                "responses_received": 10,
                "bytes_transferred": 1024,
                "last_operation_time": 0.1,
                "connection_time": time.time(),
            },
            "error_counts": {},
        }
        self.mock_jensen.is_connected.return_value = True
        self.mock_jensen.get_connection_stats.return_value = mock_stats

        result = await self.adapter.get_device_health()

        assert isinstance(result, DeviceHealth)
        assert result.overall_status == "healthy"
        assert result.connection_quality == 1.0
        assert result.error_rate == 0.0

    @pytest.mark.asyncio
    async def test_get_device_health_exception(self):
        """Test device health retrieval with exception."""
        self.mock_jensen.is_connected.return_value = False

        with pytest.raises(ConnectionError):
            await self.adapter.get_device_health()


class TestTimeSynchronization:
    """Test time synchronization functionality."""

    def setup_method(self):
        """Set up test fixtures."""
        self.patcher = patch("desktop_device_adapter.HiDockJensen")
        self.mock_jensen_class = self.patcher.start()
        self.mock_jensen = Mock()
        self.mock_jensen_class.return_value = self.mock_jensen
        self.adapter = DesktopDeviceAdapter()

    def teardown_method(self):
        """Clean up after tests."""
        self.patcher.stop()

    @pytest.mark.asyncio
    async def test_sync_time_with_target(self):
        """Test time sync with specific target time."""
        target_time = datetime(2024, 1, 1, 12, 0, 0)
        self.mock_jensen.is_connected.return_value = True
        self.mock_jensen.set_device_time.return_value = {"result": "success"}

        await self.adapter.sync_time(target_time)

        self.mock_jensen.set_device_time.assert_called_once_with(target_time)

    @pytest.mark.asyncio
    async def test_sync_time_current_time(self):
        """Test time sync with current time."""
        self.mock_jensen.is_connected.return_value = True
        self.mock_jensen.set_device_time.return_value = {"result": "success"}

        await self.adapter.sync_time()

        self.mock_jensen.set_device_time.assert_called_once()
        # Should be called with approximately current time
        call_args = self.mock_jensen.set_device_time.call_args[0]
        if call_args:  # If time argument was passed
            time_diff = abs((call_args[0] - datetime.now()).total_seconds())
            assert time_diff < 2  # Within 2 seconds


class TestErrorHandling:
    """Test comprehensive error handling scenarios."""

    def setup_method(self):
        """Set up test fixtures."""
        self.patcher = patch("desktop_device_adapter.HiDockJensen")
        self.mock_jensen_class = self.patcher.start()
        self.mock_jensen = Mock()
        self.mock_jensen_class.return_value = self.mock_jensen
        self.adapter = DesktopDeviceAdapter()

    def teardown_method(self):
        """Clean up after tests."""
        self.patcher.stop()

    @pytest.mark.asyncio
    async def test_operation_with_jensen_exception(self):
        """Test operations handle Jensen device exceptions."""
        self.mock_jensen.is_connected.return_value = True
        self.mock_jensen.list_files.side_effect = Exception("Device communication error")

        # Should handle gracefully
        with pytest.raises(Exception):
            await self.adapter.get_recordings()

    @pytest.mark.asyncio
    async def test_download_with_invalid_filename(self):
        """Test download with invalid filename."""
        progress_callback = Mock()
        self.mock_jensen.is_connected.return_value = True
        self.mock_jensen.list_files.return_value = {"files": []}

        with pytest.raises(FileNotFoundError):
            await self.adapter.download_recording("", "/tmp/output.wav", progress_callback)


class TestModuleIntegration:
    """Test module-level integration."""

    def test_module_imports_successfully(self):
        """Test that the module imports without errors."""
        assert desktop_device_adapter is not None
        assert hasattr(desktop_device_adapter, "DesktopDeviceAdapter")

    def test_adapter_implements_interface(self):
        """Test that adapter properly implements IDeviceInterface."""
        from device_interface import IDeviceInterface

        adapter = DesktopDeviceAdapter()
        assert isinstance(adapter, IDeviceInterface)

    def test_async_method_signatures(self):
        """Test that async methods have correct signatures."""
        import inspect

        adapter = DesktopDeviceAdapter()

        async_methods = [
            "discover_devices",
            "connect",
            "disconnect",
            "get_device_info",
            "get_storage_info",
            "get_recordings",
            "get_current_recording_filename",
            "download_recording",
            "delete_recording",
            "format_storage",
            "sync_time",
            "get_device_health",
        ]

        for method_name in async_methods:
            method = getattr(adapter, method_name)
            assert inspect.iscoroutinefunction(method), f"{method_name} should be async"
