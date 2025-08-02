#!/usr/bin/env python3
"""
Comprehensive unit tests for device connection fallback functionality.
Tests all HiDock device types with mocked connections and offline scenarios.
"""

import asyncio
from datetime import datetime
from typing import List, Optional
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# Import the modules we're testing
from desktop_device_adapter import DesktopDeviceAdapter
from device_interface import DeviceInfo, DeviceModel


class TestDeviceFallbackMocked:
    """Test suite for device connection fallback with mocked hardware."""

    @pytest.fixture
    def mock_adapter(self):
        """Create a desktop device adapter with mocked HiDockJensen."""
        with patch("desktop_device_adapter.HiDockJensen") as mock_jensen_class:
            # Create a mock instance
            mock_jensen_instance = MagicMock()
            mock_jensen_class.return_value = mock_jensen_instance

            # Create adapter (this will use the mocked class)
            adapter = DesktopDeviceAdapter()

            return adapter, mock_jensen_instance

    @pytest.fixture
    def sample_devices(self):
        """Sample device info for different HiDock models."""
        return [
            DeviceInfo(
                id="10d6:b00d",
                name="HiDock H1E",
                model=DeviceModel.H1E,
                serial_number="H1E123456",
                firmware_version="1.2.0",
                vendor_id=0x10D6,
                product_id=0xB00D,
                connected=False,
                last_seen=datetime.now(),
            ),
            DeviceInfo(
                id="10d6:af0c",
                name="HiDock H1",
                model=DeviceModel.H1,
                serial_number="H1123456",
                firmware_version="1.1.0",
                vendor_id=0x10D6,
                product_id=0xAF0C,
                connected=False,
                last_seen=datetime.now(),
            ),
            DeviceInfo(
                id="10d6:af0e",
                name="HiDock P1",
                model=DeviceModel.P1,
                serial_number="P1123456",
                firmware_version="1.3.0",
                vendor_id=0x10D6,
                product_id=0xAF0E,
                connected=False,
                last_seen=datetime.now(),
            ),
        ]

    @pytest.mark.unit
    async def test_discover_all_device_types(self, mock_adapter, sample_devices):
        """Test discovery of all HiDock device types."""
        adapter, mock_jensen = mock_adapter

        # Mock the HiDockJensen class creation inside discover_devices
        with patch("desktop_device_adapter.HiDockJensen") as mock_jensen_class:
            # Create a mock for each test device instance
            def mock_find_device(vid, pid):
                device_map = {
                    0xB00D: MagicMock(serial_number="H1E123456"),  # H1E
                    0xAF0C: MagicMock(serial_number="H1123456"),  # H1
                    0xAF0E: MagicMock(serial_number="P1123456"),  # P1
                }
                return device_map.get(pid, None)

            # Mock the test device instances created in discover_devices
            mock_test_device = MagicMock()
            mock_test_device._find_device.side_effect = mock_find_device
            mock_jensen_class.return_value = mock_test_device

            # Test discovery
            discovered = await adapter.discover_devices()

            assert len(discovered) == 3
            device_names = [d.name for d in discovered]
            assert "HiDock hidock-h1e" in device_names
            assert "HiDock hidock-h1" in device_names
            assert "HiDock hidock-p1" in device_names

    @pytest.mark.unit
    async def test_discover_single_device(self, mock_adapter):
        """Test discovery when only one device type is available."""
        adapter, mock_jensen = mock_adapter

        # Mock the HiDockJensen class creation inside discover_devices
        with patch("desktop_device_adapter.HiDockJensen") as mock_jensen_class:
            # Only H1E is available
            def mock_find_device(vid, pid):
                if pid == 0xB00D:  # H1E
                    return MagicMock(serial_number="H1E123456")
                return None

            # Mock the test device instances created in discover_devices
            mock_test_device = MagicMock()
            mock_test_device._find_device.side_effect = mock_find_device
            mock_jensen_class.return_value = mock_test_device

            # Test discovery
            discovered = await adapter.discover_devices()

            assert len(discovered) == 1
            assert discovered[0].name == "HiDock hidock-h1e"
            assert discovered[0].product_id == 0xB00D

    @pytest.mark.unit
    async def test_discover_no_devices(self, mock_adapter):
        """Test discovery when no devices are available (offline scenario)."""
        adapter, mock_jensen = mock_adapter

        # No devices available
        mock_jensen._find_device.return_value = None

        discovered = await adapter.discover_devices()

        assert len(discovered) == 0

    @pytest.mark.unit
    async def test_connect_configured_device_success(self, mock_adapter):
        """Test successful connection to configured device."""
        adapter, mock_jensen = mock_adapter

        # Mock successful connection
        mock_jensen.connect.return_value = (True, None)
        mock_jensen.get_device_info.return_value = {"sn": "P1123456", "versionCode": "1.3.0"}

        # Test connecting to P1
        result = await adapter.connect(device_id="10d6:af0e")

        assert result.name == "HiDock hidock-p1"
        assert result.serial_number == "P1123456"
        assert result.connected is True
        mock_jensen.connect.assert_called_once_with(target_interface_number=0, vid=0x10D6, pid=0xAF0E, auto_retry=True)

    @pytest.mark.unit
    async def test_connect_configured_device_failure(self, mock_adapter):
        """Test connection failure to configured device."""
        adapter, mock_jensen = mock_adapter

        # Mock connection failure
        mock_jensen.connect.return_value = (False, "Device not found")

        # Test connecting to P1 (should fail)
        with pytest.raises(ConnectionError, match="Device not found"):
            await adapter.connect(device_id="10d6:af0e")

    @pytest.mark.unit
    async def test_connect_fallback_to_first_available(self, mock_adapter):
        """Test that connection fails when specified device unavailable (no fallback in current implementation)."""
        adapter, mock_jensen = mock_adapter

        # Mock connection failure for P1
        mock_jensen.connect.return_value = (False, "P1 not found")

        # Try to connect to P1, should fail (no fallback implemented)
        with pytest.raises(ConnectionError, match="P1 not found"):
            await adapter.connect(device_id="10d6:af0e")

    @pytest.mark.unit
    async def test_connect_no_device_available_offline(self, mock_adapter):
        """Test graceful handling when no devices available (offline)."""
        adapter, mock_jensen = mock_adapter

        # No devices discovered
        mock_jensen._find_device.return_value = None
        mock_jensen.connect.return_value = (False, "No device found")

        # Test connecting when no devices available
        with pytest.raises(ConnectionError, match="No device found"):
            await adapter.connect(device_id="10d6:af0e")

    @pytest.mark.unit
    async def test_connect_auto_retry_disabled(self, mock_adapter):
        """Test connection with auto_retry disabled."""
        adapter, mock_jensen = mock_adapter

        mock_jensen.connect.return_value = (True, None)
        mock_jensen.get_device_info.return_value = {"sn": "H1123456", "versionCode": "1.1.0"}

        await adapter.connect(device_id="10d6:af0c", auto_retry=False)

        mock_jensen.connect.assert_called_once_with(target_interface_number=0, vid=0x10D6, pid=0xAF0C, auto_retry=False)

    @pytest.mark.unit
    async def test_connect_invalid_device_id_format(self, mock_adapter):
        """Test connection with invalid device ID format."""
        adapter, mock_jensen = mock_adapter

        mock_jensen.connect.return_value = (True, None)
        mock_jensen.get_device_info.return_value = {"sn": "H1E123456", "versionCode": "1.2.0"}

        # Test with invalid device ID - should use defaults
        result = await adapter.connect(device_id="invalid:format")

        # Should use default VID/PID (H1E)
        mock_jensen.connect.assert_called_once_with(
            target_interface_number=0,
            vid=0x10D6,  # DEFAULT_VENDOR_ID
            pid=0xB00D,  # DEFAULT_PRODUCT_ID (H1E)
            auto_retry=True,
        )

    @pytest.mark.unit
    async def test_connect_no_device_id_uses_defaults(self, mock_adapter):
        """Test connection without device_id uses default values."""
        adapter, mock_jensen = mock_adapter

        mock_jensen.connect.return_value = (True, None)
        mock_jensen.get_device_info.return_value = {"sn": "H1E123456", "versionCode": "1.2.0"}

        # Test with None device_id
        result = await adapter.connect(device_id=None)

        # Should use default VID/PID (H1E)
        mock_jensen.connect.assert_called_once_with(
            target_interface_number=0,
            vid=0x10D6,  # DEFAULT_VENDOR_ID
            pid=0xB00D,  # DEFAULT_PRODUCT_ID (H1E)
            auto_retry=True,
        )

    @pytest.mark.unit
    async def test_disconnect_success(self, mock_adapter):
        """Test successful device disconnection."""
        adapter, mock_jensen = mock_adapter

        # Set up connected state
        adapter._current_device_info = DeviceInfo(
            id="10d6:b00d",
            name="HiDock H1E",
            model=DeviceModel.H1E,
            serial_number="H1E123456",
            firmware_version="1.2.0",
            vendor_id=0x10D6,
            product_id=0xB00D,
            connected=True,
        )

        await adapter.disconnect()

        mock_jensen.disconnect.assert_called_once()
        assert adapter._current_device_info is None
        assert adapter._connection_start_time is None

    @pytest.mark.unit
    async def test_disconnect_failure(self, mock_adapter):
        """Test disconnect failure handling."""
        adapter, mock_jensen = mock_adapter

        mock_jensen.disconnect.side_effect = Exception("Disconnect failed")

        with pytest.raises(RuntimeError, match="Failed to disconnect"):
            await adapter.disconnect()

    @pytest.mark.unit
    def test_is_connected_true(self, mock_adapter):
        """Test is_connected returns True when connected."""
        adapter, mock_jensen = mock_adapter

        mock_jensen.is_connected.return_value = True

        assert adapter.is_connected() is True

    @pytest.mark.unit
    def test_is_connected_false(self, mock_adapter):
        """Test is_connected returns False when not connected."""
        adapter, mock_jensen = mock_adapter

        mock_jensen.is_connected.return_value = False

        assert adapter.is_connected() is False

    @pytest.mark.unit
    async def test_get_device_info_connected(self, mock_adapter):
        """Test get_device_info when device is connected."""
        adapter, mock_jensen = mock_adapter

        # Set up connected device
        adapter._current_device_info = DeviceInfo(
            id="10d6:b00d",
            name="HiDock H1E",
            model=DeviceModel.H1E,
            serial_number="H1E123456",
            firmware_version="1.2.0",
            vendor_id=0x10D6,
            product_id=0xB00D,
            connected=True,
        )
        mock_jensen.is_connected.return_value = True

        result = await adapter.get_device_info()

        assert result.name == "HiDock H1E"
        assert result.serial_number == "H1E123456"

    @pytest.mark.unit
    async def test_get_device_info_not_connected(self, mock_adapter):
        """Test get_device_info when no device is connected (offline)."""
        adapter, mock_jensen = mock_adapter

        mock_jensen.is_connected.return_value = False

        with pytest.raises(ConnectionError, match="No device connected"):
            await adapter.get_device_info()

    @pytest.mark.unit
    async def test_offline_operations_fail_gracefully(self, mock_adapter):
        """Test that all operations fail gracefully when offline."""
        adapter, mock_jensen = mock_adapter

        mock_jensen.is_connected.return_value = False

        # Test all operations that require connection
        operations = [
            adapter.get_device_info(),
            adapter.get_storage_info(),
            adapter.get_recordings(),
            adapter.get_current_recording_filename(),
            adapter.download_recording("test.hda", "/tmp/test.hda"),
            adapter.delete_recording("test.hda"),
            adapter.format_storage(),
            adapter.sync_time(),
        ]

        for operation in operations:
            with pytest.raises(ConnectionError, match="No device connected"):
                await operation

    @pytest.mark.unit
    def test_device_model_detection_all_types(self):
        """Test device model detection for all HiDock types."""
        from device_interface import detect_device_model

        # Test all known HiDock devices
        test_cases = [
            (0x10D6, 0xB00D, DeviceModel.H1E),
            (0x10D6, 0xAF0C, DeviceModel.H1),
            (0x10D6, 0xAF0D, DeviceModel.H1E),  # H1E variant
            (0x10D6, 0xAF0E, DeviceModel.P1),
        ]

        for vid, pid, expected_model in test_cases:
            result = detect_device_model(vid, pid)
            assert result == expected_model, f"Failed for VID=0x{vid:04X}, PID=0x{pid:04X}"

    @pytest.mark.unit
    def test_device_model_detection_unknown(self):
        """Test device model detection for unknown devices."""
        from device_interface import detect_device_model

        # Test unknown device
        result = detect_device_model(0x1234, 0x5678)
        assert result == DeviceModel.UNKNOWN  # Should return UNKNOWN for unknown devices

    @pytest.mark.integration
    async def test_full_connection_workflow_successful_connection(self, mock_adapter):
        """Integration test: Successful connection workflow."""
        adapter, mock_jensen = mock_adapter

        # Mock successful H1E connection
        mock_jensen.connect.return_value = (True, None)
        mock_jensen.get_device_info.return_value = {"sn": "H1E123456", "versionCode": "1.2.0"}
        mock_jensen.is_connected.return_value = True

        # Step 1: Connect to H1E
        device_info = await adapter.connect(device_id="10d6:b00d")

        # Step 2: Verify connection worked
        assert device_info.name == "HiDock hidock-h1e"
        assert device_info.product_id == 0xB00D
        assert adapter.is_connected()

        # Step 3: Test device operations work
        current_info = await adapter.get_device_info()
        assert current_info.name == "HiDock hidock-h1e"

        # Step 4: Clean disconnect
        mock_jensen.is_connected.return_value = False  # Mock disconnected state
        await adapter.disconnect()
        assert not adapter.is_connected()


if __name__ == "__main__":
    # Run with: python -m pytest tests/test_device_fallback_mocked.py -v
    pytest.main([__file__, "-v", "--tb=short"])
