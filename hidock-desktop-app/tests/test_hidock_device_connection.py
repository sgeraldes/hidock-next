"""
Tests for HiDockJensen device connection and communication error handling.

This test module focuses on connection establishment, error recovery,
and communication protocols, targeting uncovered lines in connection logic.
"""

import struct
import sys
import time
from unittest.mock import MagicMock, Mock, patch

import pytest
import usb.core
import usb.util

from constants import (
    CMD_GET_DEVICE_INFO,
    CMD_TRANSFER_FILE,
    DEFAULT_PRODUCT_ID,
    DEFAULT_VENDOR_ID,
    EP_IN_ADDR,
    EP_OUT_ADDR,
)
from hidock_device import HiDockJensen


class TestHiDockJensenConnection:
    """Test device connection functionality."""

    @pytest.fixture
    def mock_usb_backend(self):
        """Create a mock USB backend."""
        return Mock()

    @pytest.fixture
    def jensen_device(self, mock_usb_backend):
        """Create a HiDockJensen instance with mock backend."""
        return HiDockJensen(mock_usb_backend)

    def test_find_device_no_backend(self, jensen_device):
        """Test _find_device when USB backend is not available - covering lines 281-286."""
        jensen_device.usb_backend = None

        with pytest.raises(ConnectionError, match="USB backend not available"):
            jensen_device._find_device(DEFAULT_VENDOR_ID, DEFAULT_PRODUCT_ID)

    @patch("hidock_device.usb.core.find")
    def test_find_device_not_found(self, mock_find, jensen_device):
        """Test _find_device when device is not found - covering lines 293-299."""
        mock_find.return_value = None

        result = jensen_device._find_device(DEFAULT_VENDOR_ID, DEFAULT_PRODUCT_ID)

        assert result is None
        mock_find.assert_called_once_with(
            idVendor=DEFAULT_VENDOR_ID, idProduct=DEFAULT_PRODUCT_ID, backend=jensen_device.usb_backend
        )

    @patch("hidock_device.usb.core.find")
    def test_find_device_string_descriptor_error(self, mock_find, jensen_device):
        """Test _find_device with string descriptor errors - covering lines 313-328."""
        mock_device = Mock()
        mock_device.product = None
        mock_device.manufacturer = None

        # Test ValueError with "no langid" message
        mock_device.product = Mock(side_effect=ValueError("no langid"))
        mock_find.return_value = mock_device

        result = jensen_device._find_device(DEFAULT_VENDOR_ID, DEFAULT_PRODUCT_ID)

        assert result is mock_device  # Should still return device despite descriptor error

    @patch("hidock_device.usb.core.find")
    def test_find_device_usb_error_descriptors(self, mock_find, jensen_device):
        """Test _find_device with USB errors during descriptor access - covering lines 329-335."""
        mock_device = Mock()
        mock_device.product = Mock(side_effect=usb.core.USBError("Device busy"))
        mock_device.manufacturer = "Test Manufacturer"
        mock_find.return_value = mock_device

        result = jensen_device._find_device(DEFAULT_VENDOR_ID, DEFAULT_PRODUCT_ID)

        assert result is mock_device  # Should still return device

    @patch("hidock_device.usb.core.find")
    def test_find_device_success_with_descriptors(self, mock_find, jensen_device):
        """Test successful device finding with descriptors."""
        mock_device = Mock()
        mock_device.product = "HiDock H1"
        mock_device.manufacturer = "HiDock Inc."
        mock_find.return_value = mock_device

        result = jensen_device._find_device(DEFAULT_VENDOR_ID, DEFAULT_PRODUCT_ID)

        assert result is mock_device

    @patch("hidock_device.usb.core.find")
    @patch("hidock_device.usb.util.claim_interface")
    @patch("hidock_device.usb.util.find_descriptor")
    def test_attempt_connection_kernel_driver_detach_non_windows(
        self, mock_find_desc, mock_claim, mock_find, jensen_device
    ):
        """Test kernel driver detachment on non-Windows systems - covering lines 447-460."""
        # Setup mocks
        mock_device = Mock()
        mock_device.idVendor = DEFAULT_VENDOR_ID
        mock_device.idProduct = DEFAULT_PRODUCT_ID
        mock_device.is_kernel_driver_active.return_value = True
        mock_device.detach_kernel_driver = Mock()
        mock_device.set_configuration = Mock()
        mock_device.get_active_configuration = Mock()

        mock_find.return_value = mock_device

        # Mock interface and endpoints
        interface = Mock()
        interface.bInterfaceNumber = 0
        interface.bAlternateSetting = 0
        ep_out = Mock()
        ep_out.bEndpointAddress = EP_OUT_ADDR
        ep_in = Mock()
        ep_in.bEndpointAddress = EP_IN_ADDR

        config = Mock()
        mock_device.get_active_configuration.return_value = config
        mock_find_desc.side_effect = [interface, ep_out, ep_in]

        # Test on non-Windows platform
        with patch("hidock_device.sys.platform", "linux"):
            success, error = jensen_device._attempt_connection(0, DEFAULT_VENDOR_ID, DEFAULT_PRODUCT_ID)

        assert success is True
        assert error is None
        mock_device.is_kernel_driver_active.assert_called_once_with(0)
        mock_device.detach_kernel_driver.assert_called_once_with(0)
        assert jensen_device.detached_kernel_driver_on_interface == 0

    @patch("hidock_device.usb.core.find")
    @patch("hidock_device.usb.util.claim_interface")
    @patch("hidock_device.usb.util.find_descriptor")
    def test_attempt_connection_set_configuration_resource_busy(
        self, mock_find_desc, mock_claim, mock_find, jensen_device
    ):
        """Test set_configuration with resource busy error - covering lines 468-476."""
        mock_device = Mock()
        mock_device.idVendor = DEFAULT_VENDOR_ID
        mock_device.idProduct = DEFAULT_PRODUCT_ID
        mock_device.is_kernel_driver_active.return_value = False

        # Make set_configuration raise resource busy error
        usb_error = usb.core.USBError("Resource busy")
        usb_error.errno = 16  # EBUSY
        mock_device.set_configuration.side_effect = usb_error

        mock_find.return_value = mock_device

        success, error = jensen_device._attempt_connection(0, DEFAULT_VENDOR_ID, DEFAULT_PRODUCT_ID)

        assert success is False
        assert "Device is busy" in error
        assert jensen_device._error_counts["connection_lost"] == 1

    @patch("hidock_device.usb.core.find")
    @patch("hidock_device.usb.util.claim_interface")
    @patch("hidock_device.usb.util.find_descriptor")
    def test_attempt_connection_set_configuration_access_denied(
        self, mock_find_desc, mock_claim, mock_find, jensen_device
    ):
        """Test set_configuration with access denied error."""
        mock_device = Mock()
        mock_device.idVendor = DEFAULT_VENDOR_ID
        mock_device.idProduct = DEFAULT_PRODUCT_ID
        mock_device.is_kernel_driver_active.return_value = False

        # Make set_configuration raise access denied error
        usb_error = usb.core.USBError("Access denied")
        usb_error.errno = 13  # EACCES
        mock_device.set_configuration.side_effect = usb_error

        mock_find.return_value = mock_device

        success, error = jensen_device._attempt_connection(0, DEFAULT_VENDOR_ID, DEFAULT_PRODUCT_ID)

        assert success is False
        assert "Access denied" in error
        assert jensen_device._error_counts["connection_lost"] == 1

    @patch("hidock_device.usb.core.find")
    @patch("hidock_device.usb.util.claim_interface")
    @patch("hidock_device.usb.util.find_descriptor")
    def test_attempt_connection_interface_not_found(self, mock_find_desc, mock_claim, mock_find, jensen_device):
        """Test connection when interface is not found - covering line 499."""
        mock_device = Mock()
        mock_device.idVendor = DEFAULT_VENDOR_ID
        mock_device.idProduct = DEFAULT_PRODUCT_ID
        mock_device.is_kernel_driver_active.return_value = False
        mock_device.set_configuration = Mock()
        mock_device.get_active_configuration = Mock()

        mock_find.return_value = mock_device

        # Mock configuration but return None for interface
        config = Mock()
        mock_device.get_active_configuration.return_value = config
        mock_find_desc.return_value = None  # Interface not found

        success, error = jensen_device._attempt_connection(0, DEFAULT_VENDOR_ID, DEFAULT_PRODUCT_ID)

        assert success is False
        assert "Interface 0 not found" in error

    @patch("hidock_device.usb.core.find")
    @patch("hidock_device.usb.util.claim_interface")
    @patch("hidock_device.usb.util.find_descriptor")
    def test_attempt_connection_claim_interface_busy(self, mock_find_desc, mock_claim, mock_find, jensen_device):
        """Test claim_interface with resource busy error - covering lines 514-525."""
        mock_device = Mock()
        mock_device.idVendor = DEFAULT_VENDOR_ID
        mock_device.idProduct = DEFAULT_PRODUCT_ID
        mock_device.is_kernel_driver_active.return_value = False
        mock_device.set_configuration = Mock()
        mock_device.get_active_configuration = Mock()

        mock_find.return_value = mock_device

        # Mock interface
        interface = Mock()
        interface.bInterfaceNumber = 0
        interface.bAlternateSetting = 0

        config = Mock()
        mock_device.get_active_configuration.return_value = config
        mock_find_desc.return_value = interface

        # Make claim_interface raise resource busy error
        usb_error = usb.core.USBError("Resource busy")
        usb_error.errno = 16  # EBUSY
        mock_claim.side_effect = usb_error

        success, error = jensen_device._attempt_connection(0, DEFAULT_VENDOR_ID, DEFAULT_PRODUCT_ID)

        assert success is False
        assert "Device is busy" in error
        assert jensen_device._error_counts["connection_lost"] == 1

    @patch("hidock_device.usb.core.find")
    @patch("hidock_device.usb.util.claim_interface")
    @patch("hidock_device.usb.util.find_descriptor")
    def test_attempt_connection_endpoints_not_found(self, mock_find_desc, mock_claim, mock_find, jensen_device):
        """Test connection when endpoints are not found - covering lines 541-547."""
        mock_device = Mock()
        mock_device.idVendor = DEFAULT_VENDOR_ID
        mock_device.idProduct = DEFAULT_PRODUCT_ID
        mock_device.is_kernel_driver_active.return_value = False
        mock_device.set_configuration = Mock()
        mock_device.get_active_configuration = Mock()

        mock_find.return_value = mock_device

        # Mock interface
        interface = Mock()
        interface.bInterfaceNumber = 0
        interface.bAlternateSetting = 0

        config = Mock()
        mock_device.get_active_configuration.return_value = config

        # Return interface first, then None for endpoints
        mock_find_desc.side_effect = [interface, None, None]

        success, error = jensen_device._attempt_connection(0, DEFAULT_VENDOR_ID, DEFAULT_PRODUCT_ID)

        assert success is False
        assert "Could not find required IN/OUT endpoints" in error

    @patch("hidock_device.usb.core.find")
    @patch("hidock_device.usb.util.claim_interface")
    @patch("hidock_device.usb.util.find_descriptor")
    def test_attempt_connection_success_with_model_detection(
        self, mock_find_desc, mock_claim, mock_find, jensen_device
    ):
        """Test successful connection with model detection - covering lines 557-567."""
        mock_device = Mock()
        mock_device.idVendor = DEFAULT_VENDOR_ID
        mock_device.idProduct = 0xAF0C  # H1 model
        mock_device.is_kernel_driver_active.return_value = False
        mock_device.set_configuration = Mock()
        mock_device.get_active_configuration = Mock()

        mock_find.return_value = mock_device

        # Mock interface and endpoints
        interface = Mock()
        interface.bInterfaceNumber = 0
        interface.bAlternateSetting = 0
        ep_out = Mock()
        ep_out.bEndpointAddress = EP_OUT_ADDR
        ep_in = Mock()
        ep_in.bEndpointAddress = EP_IN_ADDR

        config = Mock()
        mock_device.get_active_configuration.return_value = config
        mock_find_desc.side_effect = [interface, ep_out, ep_in]

        success, error = jensen_device._attempt_connection(0, DEFAULT_VENDOR_ID, 0xAF0C)

        assert success is True
        assert error is None
        assert jensen_device.is_connected_flag is True
        assert "HiDock Device" in jensen_device.model
        assert "0xaf0c" in jensen_device.model.lower()

    @patch("hidock_device.usb.core.find")
    def test_attempt_connection_exception_handling(self, mock_find, jensen_device):
        """Test exception handling in attempt_connection - covering lines 568-613."""
        # Test different exception types

        # Test ValueError
        mock_find.side_effect = ValueError("Test ValueError")
        success, error = jensen_device._attempt_connection(0, DEFAULT_VENDOR_ID, DEFAULT_PRODUCT_ID)
        assert success is False
        assert "ValueError: Test ValueError" in error

        # Test ConnectionError
        mock_find.side_effect = ConnectionError("Test ConnectionError")
        success, error = jensen_device._attempt_connection(0, DEFAULT_VENDOR_ID, DEFAULT_PRODUCT_ID)
        assert success is False
        assert "Connection Error: Test ConnectionError" in error

        # Test USBError with errno 13 (Access denied)
        usb_error = usb.core.USBError("Access denied")
        usb_error.errno = 13
        mock_find.side_effect = usb_error
        success, error = jensen_device._attempt_connection(0, DEFAULT_VENDOR_ID, DEFAULT_PRODUCT_ID)
        assert success is False
        assert "Access denied" in error

        # Test USBError with errno 16 (Resource busy)
        usb_error = usb.core.USBError("Resource busy")
        usb_error.errno = 16
        mock_find.side_effect = usb_error
        success, error = jensen_device._attempt_connection(0, DEFAULT_VENDOR_ID, DEFAULT_PRODUCT_ID)
        assert success is False
        assert "Device is busy" in error

        # Test generic USBError
        usb_error = usb.core.USBError("Generic USB error")
        usb_error.errno = 99
        mock_find.side_effect = usb_error
        success, error = jensen_device._attempt_connection(0, DEFAULT_VENDOR_ID, DEFAULT_PRODUCT_ID)
        assert success is False
        assert "USB Error:" in error

        # Test OSError
        mock_find.side_effect = OSError("Test OSError")
        success, error = jensen_device._attempt_connection(0, DEFAULT_VENDOR_ID, DEFAULT_PRODUCT_ID)
        assert success is False
        assert "Unexpected system error" in error

        # Test RuntimeError
        mock_find.side_effect = RuntimeError("Test RuntimeError")
        success, error = jensen_device._attempt_connection(0, DEFAULT_VENDOR_ID, DEFAULT_PRODUCT_ID)
        assert success is False
        assert "Unexpected system error" in error


class TestHiDockJensenDisconnection:
    """Test device disconnection functionality."""

    @pytest.fixture
    def jensen_device(self):
        """Create a HiDockJensen instance for disconnection testing."""
        device = HiDockJensen(Mock())
        # Set up as if connected
        device.device = Mock()
        device.claimed_interface_number = 0
        device.detached_kernel_driver_on_interface = 0
        device.is_connected_flag = True
        return device

    def test_disconnect_already_disconnected(self, jensen_device):
        """Test disconnect when already disconnected - covering lines 624-627."""
        # Reset to disconnected state
        jensen_device.device = None
        jensen_device.is_connected_flag = False

        with patch.object(jensen_device, "_reset_connection_state") as mock_reset:
            jensen_device.disconnect()

        mock_reset.assert_called_once()

    @patch("hidock_device.usb.util.release_interface")
    @patch("hidock_device.usb.util.dispose_resources")
    def test_disconnect_release_interface_error(self, mock_dispose, mock_release, jensen_device):
        """Test disconnect with interface release error - covering lines 657-662."""
        # Make release_interface raise USB error
        mock_release.side_effect = usb.core.USBError("Release error")

        # Store original device reference
        original_device = jensen_device.device

        jensen_device.disconnect()

        # Should still call dispose_resources despite error
        mock_dispose.assert_called_once_with(original_device)

    @patch("hidock_device.usb.util.release_interface")
    @patch("hidock_device.usb.util.dispose_resources")
    def test_disconnect_kernel_driver_reattach_non_windows(self, mock_dispose, mock_release, jensen_device):
        """Test kernel driver reattachment on non-Windows - covering lines 640-656."""
        jensen_device.device.attach_kernel_driver = Mock()

        # Store original device reference
        original_device = jensen_device.device

        with patch("hidock_device.sys.platform", "linux"):
            jensen_device.disconnect()

        original_device.attach_kernel_driver.assert_called_once_with(0)

    @patch("hidock_device.usb.util.release_interface")
    @patch("hidock_device.usb.util.dispose_resources")
    def test_disconnect_kernel_driver_reattach_error(self, mock_dispose, mock_release, jensen_device):
        """Test kernel driver reattachment error - covering lines 648-656."""
        jensen_device.device.attach_kernel_driver = Mock(side_effect=usb.core.USBError("Attach error"))

        # Store original device reference
        original_device = jensen_device.device

        with patch("hidock_device.sys.platform", "linux"):
            jensen_device.disconnect()

        # Should still proceed despite reattach error
        mock_dispose.assert_called_once_with(original_device)

    @patch("hidock_device.usb.util.release_interface")
    @patch("hidock_device.usb.util.dispose_resources")
    def test_disconnect_kernel_driver_not_implemented_error(self, mock_dispose, mock_release, jensen_device):
        """Test kernel driver reattachment with NotImplementedError."""
        jensen_device.device.attach_kernel_driver = Mock(side_effect=NotImplementedError("Not implemented"))

        # Store original device reference
        original_device = jensen_device.device

        with patch("hidock_device.sys.platform", "linux"):
            jensen_device.disconnect()

        # Should still proceed despite not implemented error
        mock_dispose.assert_called_once_with(original_device)


class TestHiDockJensenResetDeviceState:
    """Test device state reset functionality - covering lines 214-255."""

    @pytest.fixture
    def jensen_device(self):
        """Create a HiDockJensen instance for reset testing."""
        device = HiDockJensen(Mock())
        # Set up some state to reset
        device.receive_buffer.extend(b"test_data")
        device.sequence_id = 5
        device._error_counts["usb_timeout"] = 3
        return device

    def test_reset_device_state_basic_cleanup(self, jensen_device):
        """Test basic state cleanup during reset."""
        jensen_device.reset_device_state()

        # Verify basic cleanup
        assert len(jensen_device.receive_buffer) == 0
        assert jensen_device.sequence_id == 0
        assert jensen_device._error_counts["usb_timeout"] == 0

    def test_reset_device_state_with_connected_device(self, jensen_device):
        """Test device state reset with connected device - covering lines 232-239."""
        # Set up connected device with endpoints
        jensen_device.device = Mock()
        jensen_device.ep_in = Mock()
        jensen_device.ep_out = Mock()
        jensen_device.ep_in.bEndpointAddress = EP_IN_ADDR
        jensen_device.ep_out.bEndpointAddress = EP_OUT_ADDR

        # Mock device.read to return bytes data, then empty to break loop
        jensen_device.device.read.side_effect = [b"test_data", b""]

        jensen_device.reset_device_state()

        # Verify clear_halt was called on both endpoints
        jensen_device.device.clear_halt.assert_any_call(EP_IN_ADDR)
        jensen_device.device.clear_halt.assert_any_call(EP_OUT_ADDR)

    def test_reset_device_state_clear_halt_error(self, jensen_device):
        """Test device state reset when clear_halt fails - covering lines 238-239."""
        # Set up connected device with endpoints
        jensen_device.device = Mock()
        jensen_device.ep_in = Mock()
        jensen_device.ep_out = Mock()
        jensen_device.ep_in.bEndpointAddress = EP_IN_ADDR
        jensen_device.ep_out.bEndpointAddress = EP_OUT_ADDR

        # Make clear_halt raise USB error
        jensen_device.device.clear_halt.side_effect = usb.core.USBError("Clear halt error")

        # Mock device.read to return empty to avoid flush loop
        jensen_device.device.read.side_effect = usb.core.USBTimeoutError("Timeout")

        # Should not raise exception
        jensen_device.reset_device_state()

    def test_reset_device_state_flush_pending_data(self, jensen_device):
        """Test flushing pending data during reset - covering lines 242-252."""
        # Set up connected device with endpoints
        jensen_device.device = Mock()
        jensen_device.ep_in = Mock()
        jensen_device.ep_out = Mock()
        jensen_device.ep_in.bEndpointAddress = EP_IN_ADDR
        jensen_device.ep_out.bEndpointAddress = EP_OUT_ADDR
        jensen_device.ep_in.wMaxPacketSize = 64

        # Mock device read to return data then empty
        jensen_device.device.read.side_effect = [b"data1", b"data2", b""]

        jensen_device.reset_device_state()

        # Verify multiple read attempts were made
        assert jensen_device.device.read.call_count >= 2

    def test_reset_device_state_flush_timeout(self, jensen_device):
        """Test flushing data with timeout - covering lines 248-250."""
        # Set up connected device with endpoints
        jensen_device.device = Mock()
        jensen_device.ep_in = Mock()
        jensen_device.ep_out = Mock()
        jensen_device.ep_in.bEndpointAddress = EP_IN_ADDR
        jensen_device.ep_out.bEndpointAddress = EP_OUT_ADDR
        jensen_device.ep_in.wMaxPacketSize = 64

        # Make device read timeout
        jensen_device.device.read.side_effect = usb.core.USBTimeoutError("Timeout")

        # Should not raise exception
        jensen_device.reset_device_state()

    def test_reset_device_state_flush_usb_error(self, jensen_device):
        """Test flushing data with USB error - covering lines 251-252."""
        # Set up connected device with endpoints
        jensen_device.device = Mock()
        jensen_device.ep_in = Mock()
        jensen_device.ep_out = Mock()
        jensen_device.ep_in.bEndpointAddress = EP_IN_ADDR
        jensen_device.ep_out.bEndpointAddress = EP_OUT_ADDR
        jensen_device.ep_in.wMaxPacketSize = 64

        # Make device read raise USB error
        jensen_device.device.read.side_effect = usb.core.USBError("Read error")

        # Should not raise exception
        jensen_device.reset_device_state()
