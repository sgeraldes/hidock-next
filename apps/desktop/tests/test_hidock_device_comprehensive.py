"""
Comprehensive tests for hidock_device.py HiDockJensen class.

This test module focuses on increasing coverage for the main HiDockJensen class,
targeting specific uncovered lines and critical functionality.
"""

import struct
import threading
import time
from datetime import datetime
from unittest.mock import MagicMock, Mock, patch

import pytest
import usb.core
import usb.util

from constants import (
    CMD_DELETE_FILE,
    CMD_FORMAT_CARD,
    CMD_GET_CARD_INFO,
    CMD_GET_DEVICE_INFO,
    CMD_GET_DEVICE_TIME,
    CMD_GET_FILE_BLOCK,
    CMD_GET_FILE_COUNT,
    CMD_GET_FILE_LIST,
    CMD_GET_RECORDING_FILE,
    CMD_GET_SETTINGS,
    CMD_SET_DEVICE_TIME,
    CMD_SET_SETTINGS,
    CMD_TRANSFER_FILE,
    DEFAULT_PRODUCT_ID,
    DEFAULT_VENDOR_ID,
    EP_IN_ADDR,
    EP_OUT_ADDR,
)
from hidock_device import HiDockJensen


class TestHiDockJensenBasicFunctionality:
    """Test basic functionality and initialization of HiDockJensen."""

    @pytest.fixture
    def mock_usb_backend(self):
        """Create a mock USB backend."""
        return Mock()

    @pytest.fixture
    def jensen_device(self, mock_usb_backend):
        """Create a HiDockJensen instance with mock backend."""
        return HiDockJensen(mock_usb_backend)

    def test_initialization_all_attributes(self, jensen_device):
        """Test that all attributes are properly initialized."""
        # Basic attributes
        assert jensen_device.usb_backend is not None
        assert jensen_device.device is None
        assert jensen_device.ep_out is None
        assert jensen_device.ep_in is None
        assert jensen_device.sequence_id == 0
        assert isinstance(jensen_device.receive_buffer, bytearray)
        assert len(jensen_device.receive_buffer) == 0
        assert jensen_device.device_info == {}
        assert jensen_device.model == "unknown"
        assert jensen_device.claimed_interface_number == -1
        assert jensen_device.detached_kernel_driver_on_interface == -1
        assert jensen_device.is_connected_flag is False

        # Enhanced connection management attributes
        assert jensen_device._connection_retry_count == 0
        assert jensen_device._max_retry_attempts == 3
        assert jensen_device._retry_delay == 1.0
        assert jensen_device._last_error is None
        assert jensen_device._connection_health_check_interval == 30.0
        assert jensen_device._is_in_health_check is False
        assert jensen_device._last_health_check == 0

        # Error tracking attributes
        expected_error_types = ["usb_timeout", "usb_pipe_error", "connection_lost", "protocol_error"]
        for error_type in expected_error_types:
            assert error_type in jensen_device._error_counts
            assert jensen_device._error_counts[error_type] == 0
        assert jensen_device._max_error_threshold == 5

        # Performance monitoring attributes
        expected_stats = [
            "commands_sent",
            "responses_received",
            "bytes_transferred",
            "connection_time",
            "last_operation_time",
        ]
        for stat in expected_stats:
            assert stat in jensen_device._operation_stats
            assert jensen_device._operation_stats[stat] == 0

        # Device behavior settings
        expected_settings = ["autoRecord", "autoPlay", "bluetoothTone", "notificationSound"]
        for setting in expected_settings:
            assert setting in jensen_device.device_behavior_settings
            assert jensen_device.device_behavior_settings[setting] is None

        # Thread lock
        assert hasattr(jensen_device, "_usb_lock")

    def test_get_usb_lock(self, jensen_device):
        """Test get_usb_lock method - covering line 115."""
        lock = jensen_device.get_usb_lock()
        assert lock is not None
        assert lock is jensen_device._usb_lock

    def test_get_connection_stats_complete(self, jensen_device):
        """Test complete connection statistics."""
        # Set some test values
        jensen_device.model = "test-model"
        jensen_device._connection_retry_count = 2
        jensen_device._last_error = "test error"
        jensen_device.device_info = {"version": "1.0"}
        jensen_device._error_counts["usb_timeout"] = 3
        jensen_device._operation_stats["commands_sent"] = 5

        stats = jensen_device.get_connection_stats()

        # Verify all expected keys are present
        expected_keys = [
            "is_connected",
            "model",
            "retry_count",
            "error_counts",
            "operation_stats",
            "last_error",
            "device_info",
        ]
        for key in expected_keys:
            assert key in stats

        # Verify values
        assert stats["is_connected"] is False  # Not connected in this test
        assert stats["model"] == "test-model"
        assert stats["retry_count"] == 2
        assert stats["last_error"] == "test error"
        assert stats["device_info"]["version"] == "1.0"
        assert stats["error_counts"]["usb_timeout"] == 3
        assert stats["operation_stats"]["commands_sent"] == 5

        # Verify copies are returned (not references)
        stats["error_counts"]["usb_timeout"] = 999
        assert jensen_device._error_counts["usb_timeout"] == 3

    def test_reset_error_counts_complete(self, jensen_device):
        """Test complete error count reset functionality."""
        # Set some error counts
        jensen_device._error_counts["usb_timeout"] = 5
        jensen_device._error_counts["usb_pipe_error"] = 3
        jensen_device._error_counts["connection_lost"] = 2
        jensen_device._error_counts["protocol_error"] = 1

        # Reset all counts
        jensen_device.reset_error_counts()

        # Verify all counts are reset to 0
        for error_type in jensen_device._error_counts:
            assert jensen_device._error_counts[error_type] == 0

    def test_increment_error_count_all_types(self, jensen_device):
        """Test incrementing all error types."""
        error_types = ["usb_timeout", "usb_pipe_error", "connection_lost", "protocol_error"]

        for error_type in error_types:
            initial_count = jensen_device._error_counts[error_type]
            jensen_device._increment_error_count(error_type)
            assert jensen_device._error_counts[error_type] == initial_count + 1

        # Test invalid error type
        jensen_device._increment_error_count("invalid_error_type")
        # Should not crash, but no new key should be added
        assert "invalid_error_type" not in jensen_device._error_counts

    def test_should_retry_connection_edge_cases(self, jensen_device):
        """Test connection retry logic edge cases."""
        # Test initial state - should retry
        assert jensen_device._should_retry_connection() is True

        # Test max retry attempts reached
        jensen_device._connection_retry_count = jensen_device._max_retry_attempts
        assert jensen_device._should_retry_connection() is False

        # Reset retry count, test error threshold
        jensen_device._connection_retry_count = 0
        jensen_device._error_counts["connection_lost"] = jensen_device._max_error_threshold
        assert jensen_device._should_retry_connection() is False

        # Test both conditions met (should not retry)
        jensen_device._connection_retry_count = jensen_device._max_retry_attempts
        assert jensen_device._should_retry_connection() is False

        # Reset for edge case: just under thresholds
        jensen_device._connection_retry_count = jensen_device._max_retry_attempts - 1
        jensen_device._error_counts["connection_lost"] = jensen_device._max_error_threshold - 1
        assert jensen_device._should_retry_connection() is True

    def test_is_connected_all_conditions(self, jensen_device):
        """Test is_connected method with all possible conditions."""
        # Test initial state - not connected
        assert jensen_device.is_connected() is False

        # Test with device but no endpoints
        jensen_device.device = Mock()
        assert jensen_device.is_connected() is False

        # Test with device and one endpoint
        jensen_device.ep_in = Mock()
        assert jensen_device.is_connected() is False

        # Test with device and both endpoints but flag false
        jensen_device.ep_out = Mock()
        assert jensen_device.is_connected() is False

        # Test with all conditions met
        jensen_device.is_connected_flag = True
        assert jensen_device.is_connected() is True

        # Test missing any condition
        jensen_device.device = None
        assert jensen_device.is_connected() is False

    def test_reset_connection_state_complete(self, jensen_device):
        """Test complete connection state reset - covering lines 670-690."""
        # Set up some state to be reset
        jensen_device.device = Mock()
        jensen_device.ep_out = Mock()
        jensen_device.ep_in = Mock()
        jensen_device.claimed_interface_number = 0
        jensen_device.detached_kernel_driver_on_interface = 0
        jensen_device.is_connected_flag = True
        jensen_device.receive_buffer.extend(b"test_data")
        jensen_device.device_info = {"test": "data"}
        jensen_device.model = "test_model"
        jensen_device.device_behavior_settings["autoRecord"] = True

        # Call reset
        jensen_device._reset_connection_state()

        # Verify all attributes are reset
        assert jensen_device.device is None
        assert jensen_device.ep_out is None
        assert jensen_device.ep_in is None
        assert jensen_device.claimed_interface_number == -1
        assert jensen_device.detached_kernel_driver_on_interface == -1
        assert jensen_device.is_connected_flag is False
        assert len(jensen_device.receive_buffer) == 0
        assert jensen_device.device_info == {}
        assert jensen_device.model == "unknown"

        # Verify device behavior settings are reset to None
        for setting in ["autoRecord", "autoPlay", "bluetoothTone", "notificationSound"]:
            assert jensen_device.device_behavior_settings[setting] is None


class TestHiDockJensenPacketBuilding:
    """Test packet building functionality."""

    @pytest.fixture
    def jensen_device(self):
        """Create a HiDockJensen instance for packet testing."""
        return HiDockJensen(Mock())

    def test_build_packet_structure(self, jensen_device):
        """Test packet building with correct structure."""
        command_id = CMD_GET_DEVICE_INFO
        body_bytes = b"test_body"

        initial_seq = jensen_device.sequence_id
        packet = jensen_device._build_packet(command_id, body_bytes)

        # Test sync bytes
        assert packet[:2] == b"\x12\x34"

        # Test command ID
        cmd_from_packet = struct.unpack(">H", packet[2:4])[0]
        assert cmd_from_packet == command_id

        # Test sequence ID incremented
        seq_from_packet = struct.unpack(">I", packet[4:8])[0]
        assert seq_from_packet == initial_seq + 1
        assert jensen_device.sequence_id == initial_seq + 1

        # Test body length
        body_len_from_packet = struct.unpack(">I", packet[8:12])[0]
        assert body_len_from_packet == len(body_bytes)

        # Test body content
        assert packet[12:] == body_bytes

        # Test total packet length
        assert len(packet) == 12 + len(body_bytes)

    def test_build_packet_sequence_wrapping(self, jensen_device):
        """Test sequence ID wrapping at maximum value."""
        # Set sequence ID near maximum
        jensen_device.sequence_id = 0xFFFFFFFF

        packet = jensen_device._build_packet(CMD_GET_DEVICE_INFO, b"")

        # Should wrap to 0
        assert jensen_device.sequence_id == 0

        # Verify packet contains wrapped sequence ID (which was 0)
        seq_from_packet = struct.unpack(">I", packet[4:8])[0]
        assert seq_from_packet == 0

    def test_build_packet_empty_body(self, jensen_device):
        """Test packet building with empty body."""
        packet = jensen_device._build_packet(CMD_GET_DEVICE_INFO, b"")

        assert len(packet) == 12  # Header only
        body_len = struct.unpack(">I", packet[8:12])[0]
        assert body_len == 0
        assert packet[12:] == b""

    def test_build_packet_large_body(self, jensen_device):
        """Test packet building with large body."""
        large_body = b"x" * 1024
        packet = jensen_device._build_packet(CMD_TRANSFER_FILE, large_body)

        assert len(packet) == 12 + 1024
        body_len = struct.unpack(">I", packet[8:12])[0]
        assert body_len == 1024
        assert packet[12:] == large_body

    def test_build_packet_various_commands(self, jensen_device):
        """Test packet building with various command IDs."""
        commands = [CMD_GET_DEVICE_INFO, CMD_GET_FILE_LIST, CMD_TRANSFER_FILE, CMD_DELETE_FILE, CMD_GET_CARD_INFO]

        for cmd_id in commands:
            packet = jensen_device._build_packet(cmd_id, b"test")
            cmd_from_packet = struct.unpack(">H", packet[2:4])[0]
            assert cmd_from_packet == cmd_id


class TestHiDockJensenHealthCheck:
    """Test health check functionality."""

    @pytest.fixture
    def jensen_device(self):
        """Create a HiDockJensen instance for health check testing."""
        return HiDockJensen(Mock())

    @patch("hidock_device.time.time")
    def test_perform_health_check_skip_recent(self, mock_time, jensen_device):
        """Test health check skipping when performed too recently."""
        mock_time.return_value = 100.0
        jensen_device._last_health_check = 95.0  # 5 seconds ago
        jensen_device._connection_health_check_interval = 30.0

        result = jensen_device._perform_health_check()

        assert result is True  # Should skip and return True
        # Last health check time should not be updated
        assert jensen_device._last_health_check == 95.0

    @patch("hidock_device.time.time")
    def test_perform_health_check_not_connected(self, mock_time, jensen_device):
        """Test health check when device is not connected."""
        mock_time.return_value = 100.0
        jensen_device._last_health_check = 0  # Force check

        # Mock is_connected to return False
        with patch.object(jensen_device, "is_connected", return_value=False):
            result = jensen_device._perform_health_check()

        assert result is False
        assert jensen_device._last_health_check == 100.0

    @patch("hidock_device.time.time")
    def test_perform_health_check_recursion_prevention(self, mock_time, jensen_device):
        """Test health check recursion prevention."""
        mock_time.return_value = 100.0
        jensen_device._last_health_check = 0  # Force check
        jensen_device._is_in_health_check = True  # Already in health check

        result = jensen_device._perform_health_check()

        assert result is True  # Should exit early due to recursion prevention

    @patch("hidock_device.time.time")
    def test_perform_health_check_success(self, mock_time, jensen_device):
        """Test successful health check."""
        mock_time.return_value = 100.0
        jensen_device._last_health_check = 0  # Force check

        # Mock device as connected
        with patch.object(jensen_device, "is_connected", return_value=True):
            with patch.object(jensen_device, "get_device_info", return_value={"version": "1.0"}):
                result = jensen_device._perform_health_check()

        assert result is True
        assert jensen_device._last_health_check == 100.0
        assert jensen_device._is_in_health_check is False

    @patch("hidock_device.time.time")
    def test_perform_health_check_get_device_info_fails(self, mock_time, jensen_device):
        """Test health check when get_device_info fails."""
        mock_time.return_value = 100.0
        jensen_device._last_health_check = 0  # Force check

        # Mock device as connected but get_device_info returns None
        with patch.object(jensen_device, "is_connected", return_value=True):
            with patch.object(jensen_device, "get_device_info", return_value=None):
                result = jensen_device._perform_health_check()

        assert result is False
        assert jensen_device._last_health_check == 100.0

    @patch("hidock_device.time.time")
    def test_perform_health_check_exception_handling(self, mock_time, jensen_device):
        """Test health check exception handling - covering lines 207-210."""
        mock_time.return_value = 100.0
        jensen_device._last_health_check = 0  # Force check

        # Mock device as connected but get_device_info raises exception
        with patch.object(jensen_device, "is_connected", return_value=True):
            with patch.object(jensen_device, "get_device_info", side_effect=Exception("Test error")):
                result = jensen_device._perform_health_check()

        assert result is False
        assert jensen_device._last_health_check == 100.0
        assert jensen_device._error_counts["connection_lost"] == 1
        assert jensen_device._is_in_health_check is False
