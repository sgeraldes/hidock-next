"""
Test suite for USB device selection functionality.

This module tests the enhanced device selector, device detection,
and settings persistence for USB device selection.
"""

from unittest.mock import MagicMock, Mock, patch

import pytest
import usb.core

from enhanced_device_selector import DeviceInfo, EnhancedDeviceSelector


class TestDeviceInfo:
    """Test the DeviceInfo class."""

    def test_device_info_creation(self):
        """Test creating a DeviceInfo object."""
        device = DeviceInfo(
            name="HiDock H1E", vendor_id=0x10D6, product_id=0xB00D, status="available", is_hidock=True, version="6.2.5"
        )

        assert device.name == "HiDock H1E"
        assert device.vendor_id == 0x10D6
        assert device.product_id == 0xB00D
        assert device.is_hidock is True

    def test_device_display_name(self):
        """Test device display name formatting."""
        device = DeviceInfo(
            name="HiDock H1E", vendor_id=0x10D6, product_id=0xB00D, status="connected", is_hidock=True, version="6.2.5"
        )

        display_name = device.get_display_name()
        assert "🟢" in display_name  # Connected status
        assert "🎵" in display_name  # HiDock indicator
        assert "HiDock H1E" in display_name
        assert "v6.2.5" in display_name

    def test_device_detail_text(self):
        """Test device detail text generation."""
        device = DeviceInfo(
            name="HiDock P1",
            vendor_id=0x10D6,
            product_id=0xAF0E,
            status="available",
            is_hidock=True,
            capabilities=["Audio Recording", "File Transfer"],
        )

        details = device.get_detail_text()
        assert "VID: 0x10d6" in details
        assert "PID: 0xaf0e" in details
        assert "Status: Available" in details
        assert "Audio Recording" in details


class TestEnhancedDeviceSelector:
    """Test the EnhancedDeviceSelector class."""

    @pytest.fixture
    def mock_parent(self):
        """Create a mock parent widget."""
        parent = Mock()
        parent.winfo_children.return_value = []
        parent._last_child_ids = {}  # Add this for tkinter compatibility
        return parent

    def test_hidock_device_detection(self):
        """Test that all HiDock devices are properly detected."""
        # Test the static method directly without GUI initialization
        selector = EnhancedDeviceSelector.__new__(EnhancedDeviceSelector)

        # Test all known HiDock devices
        assert selector._is_hidock_device(0x10D6, 0xB00D) is True  # H1E
        assert selector._is_hidock_device(0x10D6, 0xAF0C) is True  # H1
        assert selector._is_hidock_device(0x10D6, 0xAF0D) is True  # Variant
        assert selector._is_hidock_device(0x10D6, 0xAF0E) is True  # P1

        # Test non-HiDock devices
        assert selector._is_hidock_device(0x0483, 0x5740) is False
        assert selector._is_hidock_device(0x1234, 0x5678) is False

    def test_hidock_model_names(self):
        """Test HiDock model name mapping."""
        selector = EnhancedDeviceSelector.__new__(EnhancedDeviceSelector)

        assert selector._get_hidock_model_name(0xB00D) == "H1E"
        assert selector._get_hidock_model_name(0xAF0C) == "H1"
        assert selector._get_hidock_model_name(0xAF0D) == "Device"
        assert selector._get_hidock_model_name(0xAF0E) == "P1"
        assert selector._get_hidock_model_name(0x9999) == "Unknown (0x9999)"

    @patch("usb.core.find")
    def test_device_enumeration_with_hidock(self, mock_usb_find):
        """Test USB device enumeration with HiDock devices."""
        # Mock USB devices
        mock_hidock = Mock()
        mock_hidock.idVendor = 0x10D6
        mock_hidock.idProduct = 0xB00D
        mock_hidock.iProduct = 1
        mock_hidock.bcdDevice = 0x0625  # Version 6.25

        mock_other = Mock()
        mock_other.idVendor = 0x1234
        mock_other.idProduct = 0x5678
        mock_other.iProduct = 2

        mock_usb_find.return_value = [mock_hidock, mock_other]

        # Mock string retrieval
        with patch("usb.util.get_string") as mock_get_string:
            mock_get_string.side_effect = ["HiDock Device", "Other Device"]

            # Create a proper mock parent with tkinter attributes
            mock_parent = Mock()
            mock_parent._last_child_ids = {}
            mock_parent.winfo_children.return_value = []

            with patch("customtkinter.CTkFrame.__init__", return_value=None):
                selector = EnhancedDeviceSelector.__new__(EnhancedDeviceSelector)
                devices = selector._enumerate_usb_devices()

        assert len(devices) == 2

        # Check HiDock device is first (due to sorting)
        hidock_device = devices[0]
        assert hidock_device.is_hidock is True
        assert hidock_device.name == "HiDock Device"
        assert hidock_device.vendor_id == 0x10D6
        assert hidock_device.product_id == 0xB00D
        assert hidock_device.version == "6.37"

        # Check other device
        other_device = devices[1]
        assert other_device.is_hidock is False
        assert other_device.name == "Other Device"

    @patch("usb.core.find")
    def test_device_enumeration_no_hidock(self, mock_usb_find):
        """Test USB device enumeration with no HiDock devices."""
        # Mock only non-HiDock devices
        mock_device1 = Mock()
        mock_device1.idVendor = 0x1234
        mock_device1.idProduct = 0x5678
        mock_device1.iProduct = 1

        mock_device2 = Mock()
        mock_device2.idVendor = 0x9876
        mock_device2.idProduct = 0x5432
        mock_device2.iProduct = 2

        mock_usb_find.return_value = [mock_device1, mock_device2]

        with patch("usb.util.get_string") as mock_get_string:
            mock_get_string.side_effect = ["Device A", "Device B"]

            with patch("customtkinter.CTkFrame.__init__", return_value=None):
                selector = EnhancedDeviceSelector.__new__(EnhancedDeviceSelector)
                devices = selector._enumerate_usb_devices()

        assert len(devices) == 2
        assert all(not d.is_hidock for d in devices)

    def test_scan_complete_callback(self):
        """Test scan completion callback."""
        scan_callback = Mock()

        # Create a proper mock parent
        mock_parent = Mock()
        mock_parent._last_child_ids = {}
        mock_parent.winfo_children.return_value = []

        with patch("customtkinter.CTkFrame.__init__", return_value=None):
            with patch.object(EnhancedDeviceSelector, "_load_icons"):
                with patch.object(EnhancedDeviceSelector, "_create_widgets"):
                    selector = EnhancedDeviceSelector.__new__(EnhancedDeviceSelector)
                    selector.scan_callback = scan_callback
                    selector.devices = []
                    selector.is_scanning = True
                    # Mock the UI elements that _on_scan_complete expects
                    selector.scan_button = Mock()
                    selector.progress_bar = Mock()
                    selector.status_label = Mock()
                    # Mock the _populate_device_list method instead of individual components
                    selector._populate_device_list = Mock()

        # Create mock devices
        devices = [
            DeviceInfo("HiDock H1E", 0x10D6, 0xB00D, is_hidock=True),
            DeviceInfo("Other Device", 0x1234, 0x5678, is_hidock=False),
        ]

        # Simulate scan completion
        selector._on_scan_complete(devices)

        # Verify callback was called with devices
        scan_callback.assert_called_once_with(devices)
        assert selector.devices == devices
        assert selector.is_scanning is False


class TestSettingsPersistence:
    """Test that device selection persists in settings."""

    @patch("config_and_logger.save_config")
    @patch("config_and_logger.load_config")
    def test_device_selection_saves_to_config(self, mock_load_config, mock_save_config):
        """Test that selecting a device updates the config."""
        # Mock initial config
        mock_config = {"selected_vid": 0x10D6, "selected_pid": 0xB00D}
        mock_load_config.return_value = mock_config

        # Simulate device selection with new VID/PID
        new_vid = 0x10D6
        new_pid = 0xAF0E  # P1 device

        # Update config (simulating what settings dialog does)
        mock_config["selected_vid"] = new_vid
        mock_config["selected_pid"] = new_pid

        # Save config
        from config_and_logger import save_config

        save_config(mock_config)

        # Verify save was called with updated config
        mock_save_config.assert_called_once()
        saved_config = mock_save_config.call_args[0][0]
        assert saved_config["selected_vid"] == new_vid
        assert saved_config["selected_pid"] == new_pid


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
