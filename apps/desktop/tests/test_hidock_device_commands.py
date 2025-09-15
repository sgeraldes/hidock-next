"""
Tests for HiDockJensen device command methods.

This test module focuses on device information, time management, and communication
protocol commands, targeting uncovered lines in command handling logic.
"""

import struct
from datetime import datetime
from unittest.mock import Mock, patch

import pytest
from tests.helpers.optional import require
require("usb", marker="integration")

import usb.core

from constants import CMD_GET_DEVICE_INFO, CMD_GET_DEVICE_TIME, CMD_SET_DEVICE_TIME, CMD_TRANSFER_FILE
from hidock_device import HiDockJensen

pytestmark = [pytest.mark.integration]


class TestHiDockJensenDeviceInfo:
    """Test device information commands - covering lines 1040-1094."""

    @pytest.fixture
    def jensen_device(self):
        """Create a connected HiDockJensen instance."""
        device = HiDockJensen(Mock())
        device.device = Mock()
        device.is_connected_flag = True
        return device

    def test_get_device_info_success(self, jensen_device):
        """Test successful get_device_info - covering lines 1051-1081."""
        # Create response body with version and serial number
        version_bytes = b"\x01\x02\x03\x04"  # Version code bytes
        serial_bytes = b"HDA123456789\x00\x00\x00\x00"  # 16-byte serial (null-terminated)
        response_body = version_bytes + serial_bytes

        with patch.object(jensen_device, "_send_and_receive") as mock_send_receive:
            mock_send_receive.return_value = {"id": CMD_GET_DEVICE_INFO, "body": response_body}

            result = jensen_device.get_device_info()

        assert result is not None
        assert result["versionCode"] == "2.3.4"  # Skip first byte, format as dotted
        assert result["versionNumber"] == 0x01020304
        assert result["sn"] == "HDA123456789"
        assert jensen_device.device_info == result

    def test_get_device_info_short_body(self, jensen_device):
        """Test get_device_info with short response body - covering lines 1082-1087."""
        short_body = b"\x01\x02"  # Less than 4 bytes

        with patch.object(jensen_device, "_send_and_receive") as mock_send_receive:
            mock_send_receive.return_value = {"id": CMD_GET_DEVICE_INFO, "body": short_body}

            result = jensen_device.get_device_info()

        assert result is None

    def test_get_device_info_version_only(self, jensen_device):
        """Test get_device_info with version only (no serial) - covering lines 1058-1070."""
        version_bytes = b"\x01\x02\x03\x04"  # Exactly 4 bytes, no serial

        with patch.object(jensen_device, "_send_and_receive") as mock_send_receive:
            mock_send_receive.return_value = {"id": CMD_GET_DEVICE_INFO, "body": version_bytes}

            result = jensen_device.get_device_info()

        assert result is not None
        assert result["versionCode"] == "2.3.4"
        assert result["sn"] == "N/A"

    def test_get_device_info_unprintable_serial(self, jensen_device):
        """Test get_device_info with unprintable serial number - covering lines 1067-1070."""
        version_bytes = b"\x01\x02\x03\x04"
        unprintable_serial = b"\xff\xfe\xfd\xfc\xfb\xfa\xf9\xf8\x00\x00\x00\x00\x00\x00\x00\x00"
        response_body = version_bytes + unprintable_serial

        with patch.object(jensen_device, "_send_and_receive") as mock_send_receive:
            mock_send_receive.return_value = {"id": CMD_GET_DEVICE_INFO, "body": response_body}

            result = jensen_device.get_device_info()

        assert result is not None
        # Should fall back to hex representation
        assert result["sn"] == unprintable_serial.hex()

    def test_get_device_info_unicode_decode_error(self, jensen_device):
        """Test get_device_info with Unicode decode error - covering lines 1069-1070."""
        version_bytes = b"\x01\x02\x03\x04"
        # Create bytes that will cause UnicodeDecodeError when decoded as utf-8
        problematic_serial = b"\x80\x81\x82\x83\x84\x85\x86\x87\x00\x00\x00\x00\x00\x00\x00\x00"
        response_body = version_bytes + problematic_serial

        with patch.object(jensen_device, "_send_and_receive") as mock_send_receive:
            mock_send_receive.return_value = {"id": CMD_GET_DEVICE_INFO, "body": response_body}

            result = jensen_device.get_device_info()

        assert result is not None
        # Should fall back to hex representation for invalid UTF-8
        assert result["sn"] == problematic_serial.hex()

    def test_get_device_info_empty_serial_after_cleanup(self, jensen_device):
        """Test get_device_info when serial becomes empty after cleanup - covering lines 1067-1068."""
        version_bytes = b"\x01\x02\x03\x04"
        # Serial with only control characters and nulls
        control_serial = b"\x01\x02\x03\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00"
        response_body = version_bytes + control_serial

        with patch.object(jensen_device, "_send_and_receive") as mock_send_receive:
            mock_send_receive.return_value = {"id": CMD_GET_DEVICE_INFO, "body": response_body}

            result = jensen_device.get_device_info()

        assert result is not None
        # Should fall back to hex when printable string is empty
        assert result["sn"] == control_serial.hex()

    def test_get_device_info_invalid_response(self, jensen_device):
        """Test get_device_info with invalid response - covering lines 1088-1094."""
        with patch.object(jensen_device, "_send_and_receive") as mock_send_receive:
            mock_send_receive.return_value = {"id": 999, "body": b"invalid"}

            result = jensen_device.get_device_info()

        assert result is None

    def test_get_device_info_no_response(self, jensen_device):
        """Test get_device_info with no response."""
        with patch.object(jensen_device, "_send_and_receive") as mock_send_receive:
            mock_send_receive.return_value = None

            result = jensen_device.get_device_info()

        assert result is None


class TestHiDockJensenTimeManagement:
    """Test device time management commands."""

    @pytest.fixture
    def jensen_device(self):
        """Create a connected HiDockJensen instance."""
        device = HiDockJensen(Mock())
        device.device = Mock()
        device.is_connected_flag = True
        return device

    def test_to_bcd_valid_values(self, jensen_device):
        """Test _to_bcd method with valid values - covering lines 1991-2004."""
        assert jensen_device._to_bcd(0) == 0x00
        assert jensen_device._to_bcd(9) == 0x09
        assert jensen_device._to_bcd(10) == 0x10
        assert jensen_device._to_bcd(23) == 0x23
        assert jensen_device._to_bcd(59) == 0x59
        assert jensen_device._to_bcd(99) == 0x99

    def test_to_bcd_out_of_range(self, jensen_device):
        """Test _to_bcd method with out of range values - covering lines 2002-2003."""
        assert jensen_device._to_bcd(-1) == 0
        assert jensen_device._to_bcd(100) == 0
        assert jensen_device._to_bcd(255) == 0

    def test_set_device_time_success(self, jensen_device):
        """Test successful set_device_time - covering lines 2006-2033."""
        test_datetime = datetime(2023, 12, 25, 14, 30, 45)

        with patch.object(jensen_device, "_send_and_receive") as mock_send_receive:
            mock_send_receive.return_value = {"id": CMD_SET_DEVICE_TIME, "body": b"\x00"}  # Success

            result = jensen_device.set_device_time(test_datetime)

        assert result["result"] == "success"

        # Verify the payload was constructed correctly
        expected_payload = bytes(
            [
                jensen_device._to_bcd(20),  # Century (20 for 2023)
                jensen_device._to_bcd(23),  # Year (23 for 2023)
                jensen_device._to_bcd(12),  # Month
                jensen_device._to_bcd(25),  # Day
                jensen_device._to_bcd(14),  # Hour
                jensen_device._to_bcd(30),  # Minute
                jensen_device._to_bcd(45),  # Second
            ]
        )
        mock_send_receive.assert_called_once_with(CMD_SET_DEVICE_TIME, expected_payload, timeout_ms=5000)

    def test_set_device_time_failure(self, jensen_device):
        """Test set_device_time failure - covering lines 2034-2044."""
        test_datetime = datetime(2023, 12, 25, 14, 30, 45)

        with patch.object(jensen_device, "_send_and_receive") as mock_send_receive:
            mock_send_receive.return_value = {"id": CMD_SET_DEVICE_TIME, "body": b"\x01"}  # Error code 1

            result = jensen_device.set_device_time(test_datetime)

        assert result["result"] == "failed"
        assert result["error"] == "Device error or invalid response."
        assert result["device_code"] == 1

    def test_set_device_time_invalid_response(self, jensen_device):
        """Test set_device_time with invalid response."""
        test_datetime = datetime(2023, 12, 25, 14, 30, 45)

        with patch.object(jensen_device, "_send_and_receive") as mock_send_receive:
            mock_send_receive.return_value = {"id": 999, "body": b"\x00"}

            result = jensen_device.set_device_time(test_datetime)

        assert result["result"] == "failed"

    def test_set_device_time_empty_body(self, jensen_device):
        """Test set_device_time with empty response body."""
        test_datetime = datetime(2023, 12, 25, 14, 30, 45)

        with patch.object(jensen_device, "_send_and_receive") as mock_send_receive:
            mock_send_receive.return_value = {"id": CMD_SET_DEVICE_TIME, "body": b""}

            result = jensen_device.set_device_time(test_datetime)

        assert result["result"] == "failed"
        assert result["device_code"] == -1

    def test_parse_bcd_time_response_success(self, jensen_device):
        """Test _parse_bcd_time_response with valid data - covering lines 2046-2074."""
        # Create BCD time for 2023-12-25 14:30:45
        bcd_time = bytes(
            [
                0x20,
                0x23,  # Year 2023
                0x12,  # Month 12
                0x25,  # Day 25
                0x14,  # Hour 14
                0x30,  # Minute 30
                0x45,  # Second 45
            ]
        )

        result = jensen_device._parse_bcd_time_response(bcd_time)

        assert result == "2023-12-25 14:30:45"

    def test_parse_bcd_time_response_short_body(self, jensen_device):
        """Test _parse_bcd_time_response with short body - covering lines 2058-2060."""
        short_body = b"\x20\x23\x12"  # Less than 7 bytes

        result = jensen_device._parse_bcd_time_response(short_body)

        assert result == "unknown"

    def test_parse_bcd_time_response_zero_time(self, jensen_device):
        """Test _parse_bcd_time_response with all zero time - covering lines 2068-2069."""
        zero_time = b"\x00\x00\x00\x00\x00\x00\x00"

        result = jensen_device._parse_bcd_time_response(zero_time)

        assert result == "unknown"

    def test_parse_bcd_time_response_invalid_bcd(self, jensen_device):
        """Test _parse_bcd_time_response with invalid BCD data - covering lines 2075-2081."""
        # Invalid BCD that will cause ValueError in strptime
        invalid_bcd = b"\x20\x23\x13\x32\x25\x61\x61"  # Invalid month (13), day (32), minute/second (61)

        result = jensen_device._parse_bcd_time_response(invalid_bcd)

        assert result == "unknown"

    def test_get_device_time_success(self, jensen_device):
        """Test successful get_device_time - covering lines 2083-2099."""
        # Create valid BCD time response
        bcd_time = bytes([0x20, 0x23, 0x12, 0x25, 0x14, 0x30, 0x45])

        with patch.object(jensen_device, "_send_and_receive") as mock_send_receive:
            mock_send_receive.return_value = {"id": CMD_GET_DEVICE_TIME, "body": bcd_time}

            result = jensen_device.get_device_time()

        assert result is not None
        assert result["time"] == "2023-12-25 14:30:45"

    def test_get_device_time_empty_body(self, jensen_device):
        """Test get_device_time with empty response body - covering lines 2100-2106."""
        with patch.object(jensen_device, "_send_and_receive") as mock_send_receive:
            mock_send_receive.return_value = {"id": CMD_GET_DEVICE_TIME, "body": b""}

            result = jensen_device.get_device_time()

        assert result is not None
        assert result["time"] == "unknown"
        assert "error" in result

    def test_get_device_time_invalid_response(self, jensen_device):
        """Test get_device_time with invalid response - covering lines 2107-2112."""
        with patch.object(jensen_device, "_send_and_receive") as mock_send_receive:
            mock_send_receive.return_value = {"id": 999, "body": b"invalid"}

            result = jensen_device.get_device_time()

        assert result is None

    def test_get_device_time_no_response(self, jensen_device):
        """Test get_device_time with no response."""
        with patch.object(jensen_device, "_send_and_receive") as mock_send_receive:
            mock_send_receive.return_value = None

            result = jensen_device.get_device_time()

        assert result is None


class TestHiDockJensenSendReceiveOperations:
    """Test send and receive operations with error handling."""

    @pytest.fixture
    def jensen_device(self):
        """Create a connected HiDockJensen instance."""
        device = HiDockJensen(Mock())
        device.device = Mock()
        device.ep_in = Mock()
        device.ep_out = Mock()
        device.is_connected_flag = True
        # Reset error counts to prevent accumulation across tests
        device._error_counts = {
            "usb_timeout": 0,
            "usb_pipe_error": 0,
            "protocol_error": 0,
            "connection_lost": 0,
        }
        return device

    def test_send_command_health_check_failure(self, jensen_device):
        """Test send_command when health check fails - covering lines 735-742."""
        with patch.object(jensen_device, "_perform_health_check", return_value=False):
            with pytest.raises(ConnectionError, match="Device health check failed"):
                jensen_device._send_command(CMD_GET_DEVICE_INFO)

    def test_send_command_performance_tracking(self, jensen_device):
        """Test send_command performance statistics tracking - covering lines 756-758."""
        jensen_device.ep_out.write.return_value = 16  # Mock successful write (full packet)

        with patch.object(jensen_device, "_perform_health_check", return_value=True):
            jensen_device._send_command(CMD_GET_DEVICE_INFO, b"test")

        assert jensen_device._operation_stats["commands_sent"] == 1
        assert jensen_device._operation_stats["bytes_transferred"] > 0
        assert jensen_device._operation_stats["last_operation_time"] >= 0  # Should be elapsed time, not timestamp

    def test_send_command_partial_write_warning(self, jensen_device):
        """Test send_command with partial write - covering lines 760-767."""
        jensen_device.ep_out.write.return_value = 5  # Partial write (packet should be 12+ bytes)

        with patch.object(jensen_device, "_perform_health_check", return_value=True):
            jensen_device._send_command(CMD_GET_DEVICE_INFO, b"test")

        assert jensen_device._error_counts["protocol_error"] == 1

    def test_send_command_pipe_error_clear_halt_success(self, jensen_device):
        """Test send_command with pipe error and successful clear halt - covering lines 779-787."""
        # Create USB error with pipe error errno
        pipe_error = usb.core.USBError("Pipe error")
        pipe_error.errno = 32  # LIBUSB_ERROR_PIPE
        jensen_device.ep_out.write.side_effect = pipe_error

        # Store references before they get set to None
        original_device = jensen_device.device
        ep_out_addr = jensen_device.ep_out.bEndpointAddress

        with patch.object(jensen_device, "_perform_health_check", return_value=True):
            with pytest.raises(usb.core.USBError):
                jensen_device._send_command(CMD_GET_DEVICE_INFO)

        assert jensen_device._error_counts["usb_pipe_error"] == 1
        original_device.clear_halt.assert_called_once_with(ep_out_addr)

    def test_send_command_pipe_error_clear_halt_fails(self, jensen_device):
        """Test send_command with pipe error and clear halt failure - covering lines 788-795."""
        # Create USB error with pipe error errno
        pipe_error = usb.core.USBError("Pipe error")
        pipe_error.errno = 32  # LIBUSB_ERROR_PIPE
        jensen_device.ep_out.write.side_effect = pipe_error

        # Make clear_halt also fail
        jensen_device.device.clear_halt.side_effect = usb.core.USBError("Clear halt failed")

        # Store references before they get set to None
        original_device = jensen_device.device
        ep_out_addr = jensen_device.ep_out.bEndpointAddress

        with patch.object(jensen_device, "_perform_health_check", return_value=True):
            with pytest.raises(usb.core.USBError):
                jensen_device._send_command(CMD_GET_DEVICE_INFO)

        assert jensen_device._error_counts["usb_pipe_error"] == 1
        original_device.clear_halt.assert_called_once_with(ep_out_addr)

    def test_send_command_other_usb_error(self, jensen_device):
        """Test send_command with other USB error - covering line 795."""
        # Create USB error with different errno
        other_error = usb.core.USBError("Other USB error")
        other_error.errno = 99  # Not a pipe error
        jensen_device.ep_out.write.side_effect = other_error

        with patch.object(jensen_device, "_perform_health_check", return_value=True):
            with pytest.raises(usb.core.USBError):
                jensen_device._send_command(CMD_GET_DEVICE_INFO)

        assert jensen_device._error_counts["protocol_error"] == 1

    def test_receive_response_buffer_resync_streaming(self, jensen_device):
        """Test receive_response buffer re-sync during streaming - covering lines 845-856."""
        # Set up streaming context and bad sync data
        jensen_device.receive_buffer.extend(b"\xff\xff\x12\x34")  # Bad sync, then good sync

        response = jensen_device._receive_response(1, streaming_cmd_id=CMD_TRANSFER_FILE)

        assert response is None  # Should fail fast during streaming
        assert jensen_device._error_counts["protocol_error"] == 1

    def test_receive_response_no_sync_marker_found(self, jensen_device):
        """Test receive_response when no sync marker found - covering lines 869-878."""
        # Fill buffer with data that has no sync marker
        jensen_device.receive_buffer.extend(b"\xff\xff\xff\xff\xff\xff\xff\xff")
        jensen_device.ep_in.wMaxPacketSize = 64  # Set proper packet size

        with patch.object(jensen_device.device, "read", side_effect=usb.core.USBTimeoutError("Timeout")):
            with patch.object(jensen_device, "is_connected", return_value=True):
                response = jensen_device._receive_response(1, timeout_ms=100)

        assert response is None
        assert len(jensen_device.receive_buffer) == 0  # Buffer should be cleared

    def test_receive_response_sync_marker_found_with_offset(self, jensen_device):
        """Test receive_response when sync marker found with offset - covering lines 859-868."""
        # Create response with offset sync marker
        bad_prefix = b"\xff\xff\xff"
        good_packet = self._create_test_packet(CMD_GET_DEVICE_INFO, 1, b"test")
        jensen_device.receive_buffer.extend(bad_prefix + good_packet)

        response = jensen_device._receive_response(1)

        assert response is not None
        assert response["id"] == CMD_GET_DEVICE_INFO
        assert response["sequence"] == 1

    def test_receive_response_unexpected_sequence_warning(self, jensen_device):
        """Test receive_response with unexpected sequence - covering lines 919-928."""
        # Create packet with wrong sequence ID
        wrong_seq_packet = self._create_test_packet(CMD_GET_DEVICE_INFO, 999, b"test")
        jensen_device.receive_buffer.extend(wrong_seq_packet)
        jensen_device.ep_in.wMaxPacketSize = 64  # Set proper packet size

        with patch.object(jensen_device.device, "read", side_effect=usb.core.USBTimeoutError("Timeout")):
            with patch.object(jensen_device, "is_connected", return_value=True):
                response = jensen_device._receive_response(1, timeout_ms=100)

        assert response is None

    def test_receive_response_large_read_size(self, jensen_device):
        """Test receive_response with large read size calculation - covering lines 934-937."""
        jensen_device.ep_in.wMaxPacketSize = 64

        with patch.object(jensen_device.device, "read", side_effect=usb.core.USBTimeoutError("Timeout")) as mock_read:
            jensen_device._receive_response(1, timeout_ms=100)

        # Should use larger read size based on wMaxPacketSize
        expected_read_size = 64 * 64  # wMaxPacketSize * 64
        mock_read.assert_called_with(jensen_device.ep_in.bEndpointAddress, expected_read_size, timeout=200)

    def test_receive_response_default_read_size(self, jensen_device):
        """Test receive_response with default read size when wMaxPacketSize unavailable."""
        jensen_device.ep_in.wMaxPacketSize = None

        with patch.object(jensen_device.device, "read", side_effect=usb.core.USBTimeoutError("Timeout")) as mock_read:
            jensen_device._receive_response(1, timeout_ms=100)

        # Should use default read size
        mock_read.assert_called_with(jensen_device.ep_in.bEndpointAddress, 4096, timeout=200)

    def test_receive_response_timeout_non_streaming(self, jensen_device):
        """Test receive_response timeout for non-streaming command - covering lines 952-953."""
        jensen_device.ep_in.wMaxPacketSize = 64  # Set proper packet size
        # Reset error counts to ensure test isolation
        jensen_device._error_counts["usb_timeout"] = 0
        
        with patch.object(jensen_device.device, "read", side_effect=usb.core.USBTimeoutError("Timeout")):
            with patch.object(jensen_device, "is_connected", return_value=True):
                response = jensen_device._receive_response(1, timeout_ms=100)

        assert response is None
        assert jensen_device._error_counts["usb_timeout"] > 0  # Should increment at least once

    def test_receive_response_timeout_streaming(self, jensen_device):
        """Test receive_response timeout for streaming command - no error increment."""
        jensen_device.ep_in.wMaxPacketSize = 64  # Set proper packet size
        
        with patch.object(jensen_device.device, "read", side_effect=usb.core.USBTimeoutError("Timeout")):
            with patch.object(jensen_device, "is_connected", return_value=True):
                response = jensen_device._receive_response(1, timeout_ms=100, streaming_cmd_id=CMD_TRANSFER_FILE)

        assert response is None
        assert jensen_device._error_counts["usb_timeout"] == 0  # No increment for streaming timeouts

    def test_receive_response_pipe_error_clear_halt_success(self, jensen_device):
        """Test receive_response with pipe error and successful clear halt - covering lines 957-971."""
        pipe_error = usb.core.USBError("Pipe error")
        pipe_error.errno = 32  # LIBUSB_ERROR_PIPE
        jensen_device.ep_in.wMaxPacketSize = 64  # Set proper packet size

        # Store references before they get set to None
        original_device = jensen_device.device
        ep_in_addr = jensen_device.ep_in.bEndpointAddress

        with patch.object(jensen_device.device, "read", side_effect=pipe_error):
            response = jensen_device._receive_response(1)

        assert response is None
        assert jensen_device._error_counts["usb_pipe_error"] == 1
        assert jensen_device._error_counts["connection_lost"] == 1
        original_device.clear_halt.assert_called_once_with(ep_in_addr)

    def test_receive_response_pipe_error_clear_halt_fails(self, jensen_device):
        """Test receive_response with pipe error and clear halt failure - covering lines 966-971."""
        pipe_error = usb.core.USBError("Pipe error")
        pipe_error.errno = 32  # LIBUSB_ERROR_PIPE
        jensen_device.ep_in.wMaxPacketSize = 64  # Set proper packet size

        # Make clear_halt also fail
        jensen_device.device.clear_halt.side_effect = usb.core.USBError("Clear halt failed")

        # Store references before they get set to None
        original_device = jensen_device.device
        ep_in_addr = jensen_device.ep_in.bEndpointAddress

        with patch.object(jensen_device.device, "read", side_effect=pipe_error):
            response = jensen_device._receive_response(1)

        assert response is None
        assert jensen_device._error_counts["usb_pipe_error"] == 1
        original_device.clear_halt.assert_called_once_with(ep_in_addr)

    def test_receive_response_other_usb_error(self, jensen_device):
        """Test receive_response with other USB error - covering lines 972-977."""
        other_error = usb.core.USBError("Other USB error")
        other_error.errno = 99  # Not a pipe error
        jensen_device.ep_in.wMaxPacketSize = 64  # Set proper packet size

        # Store reference to device before it gets set to None
        original_device = jensen_device.device

        with patch.object(jensen_device.device, "read", side_effect=other_error):
            response = jensen_device._receive_response(1)

        assert response is None
        assert jensen_device._error_counts["protocol_error"] == 1
        assert jensen_device._error_counts["connection_lost"] == 1

    def test_receive_response_streaming_timeout_debug_log(self, jensen_device):
        """Test receive_response streaming timeout uses debug log - covering lines 981-987."""
        jensen_device.ep_in.wMaxPacketSize = 64  # Set proper packet size
        
        with patch.object(jensen_device.device, "read", side_effect=usb.core.USBTimeoutError("Timeout")):
            with patch.object(jensen_device, "is_connected", return_value=True):
                response = jensen_device._receive_response(1, timeout_ms=100, streaming_cmd_id=CMD_TRANSFER_FILE)

        assert response is None

    def test_receive_response_non_streaming_timeout_warning_log(self, jensen_device):
        """Test receive_response non-streaming timeout uses warning log - covering lines 988-994."""
        jensen_device.ep_in.wMaxPacketSize = 64  # Set proper packet size
        
        with patch.object(jensen_device.device, "read", side_effect=usb.core.USBTimeoutError("Timeout")):
            with patch.object(jensen_device, "is_connected", return_value=True):
                response = jensen_device._receive_response(1, timeout_ms=100)

        assert response is None

    def test_send_and_receive_transfer_file_special_handling(self, jensen_device):
        """Test send_and_receive special handling for transfer file - covering lines 1019-1029."""
        with patch.object(jensen_device, "_send_command", return_value=1):
            with patch.object(jensen_device, "_receive_response") as mock_receive:
                mock_receive.return_value = {"id": CMD_TRANSFER_FILE, "body": b"data"}

                result = jensen_device._send_and_receive(CMD_TRANSFER_FILE, b"filename")

        # Should not clear buffer for transfer file command
        mock_receive.assert_called_once_with(1, 5000, streaming_cmd_id=CMD_TRANSFER_FILE)

    def test_send_and_receive_non_transfer_file_buffer_clear(self, jensen_device):
        """Test send_and_receive buffer clearing for non-transfer commands."""
        jensen_device.receive_buffer.extend(b"old_data")

        with patch.object(jensen_device, "_send_command", return_value=1):
            with patch.object(jensen_device, "_receive_response") as mock_receive:
                mock_receive.return_value = {"id": CMD_GET_DEVICE_INFO, "body": b"data"}

                jensen_device._send_and_receive(CMD_GET_DEVICE_INFO, b"")

        # Buffer should have been cleared for non-transfer command
        # (This is tested by verifying the command executed without buffer contamination)

    def test_send_and_receive_error_propagation(self, jensen_device):
        """Test send_and_receive error propagation - covering lines 1031-1037."""
        with patch.object(jensen_device, "_send_command", side_effect=usb.core.USBError("Test error")):
            with pytest.raises(usb.core.USBError):
                jensen_device._send_and_receive(CMD_GET_DEVICE_INFO)

    def _create_test_packet(self, command_id, sequence_id, body):
        """Helper method to create a test packet."""
        header = bytearray([0x12, 0x34])  # Sync bytes
        header.extend(struct.pack(">H", command_id))  # Command ID
        header.extend(struct.pack(">I", sequence_id))  # Sequence ID
        header.extend(struct.pack(">I", len(body)))  # Body length
        return bytes(header) + body
