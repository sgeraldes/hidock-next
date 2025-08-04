"""
Tests for HiDockJensen file operations and streaming functionality.

This test module focuses on file listing, streaming, deletion, and block operations,
targeting uncovered lines in file handling logic.
"""

import struct
import threading
import time
from unittest.mock import MagicMock, Mock, call, patch

import pytest
import usb.core

from constants import CMD_DELETE_FILE, CMD_GET_FILE_BLOCK, CMD_GET_FILE_COUNT, CMD_GET_FILE_LIST, CMD_TRANSFER_FILE
from hidock_device import HiDockJensen


class TestHiDockJensenFileListOperations:
    """Test file listing operations with streaming - targeting lines 1191-1369."""

    @pytest.fixture
    def jensen_device(self):
        """Create a connected HiDockJensen instance for file testing."""
        device = HiDockJensen(Mock())
        device.device = Mock()
        device.ep_in = Mock()
        device.ep_out = Mock()
        device.is_connected_flag = True
        device.device_info = {"versionNumber": 12345}
        return device

    def test_list_files_no_device_info(self, jensen_device):
        """Test list_files when device info is missing - covering lines 1191-1198."""
        jensen_device.device_info = {}

        with patch.object(jensen_device, "get_device_info", return_value=None):
            result = jensen_device.list_files()

        assert result is None

    def test_list_files_already_streaming(self, jensen_device):
        """Test list_files when already streaming - covering lines 1203-1215."""
        jensen_device._file_list_streaming = True

        result = jensen_device.list_files()

        assert result is not None
        assert result["error"] == "Operation already in progress"
        assert result["totalFiles"] == 0

    def test_list_files_send_command_fails(self, jensen_device):
        """Test list_files when send command fails - covering lines 1220-1234."""
        with patch.object(jensen_device, "_send_command", side_effect=usb.core.USBError("USB Error")):
            result = jensen_device.list_files()

        assert result is not None
        assert result["error"] == "Failed to send command"
        assert result["totalFiles"] == 0

    def test_list_files_empty_response_completion(self, jensen_device):
        """Test list_files with empty response indicating completion - covering lines 1244-1251."""
        with patch.object(jensen_device, "_send_command", return_value=1):
            with patch.object(jensen_device, "_receive_response") as mock_receive:
                # Mock empty response to signal completion
                mock_receive.return_value = {"id": CMD_GET_FILE_LIST, "sequence": 1, "body": b""}

                result = jensen_device.list_files()

        assert result is not None
        assert result["totalFiles"] == 0
        assert "error" not in result

    def test_list_files_with_header_and_files(self, jensen_device):
        """Test list_files with header and file data - covering lines 1264-1290."""
        with patch.object(jensen_device, "_send_command", return_value=1):
            with patch.object(jensen_device, "_receive_response") as mock_receive:
                # Create file list data with header
                file_data = bytearray()
                # Header: 0xFF 0xFF + file count (2 files)
                file_data.extend([0xFF, 0xFF])
                file_data.extend(struct.pack(">I", 2))  # 2 files expected

                # First file
                file_data.append(1)  # version
                filename1 = "test1.wav"
                file_data.extend(struct.pack(">I", len(filename1))[1:])  # 3-byte length
                file_data.extend(filename1.encode())
                file_data.extend(struct.pack(">I", 1000))  # file length
                file_data.extend(b"\x00" * 6)  # skip 6 bytes
                file_data.extend(b"\x00" * 16)  # signature

                # Second file
                file_data.append(2)  # version
                filename2 = "test2.wav"
                file_data.extend(struct.pack(">I", len(filename2))[1:])  # 3-byte length
                file_data.extend(filename2.encode())
                file_data.extend(struct.pack(">I", 2000))  # file length
                file_data.extend(b"\x00" * 6)  # skip 6 bytes
                file_data.extend(b"\x00" * 16)  # signature

                mock_receive.return_value = {"id": CMD_GET_FILE_LIST, "sequence": 1, "body": bytes(file_data)}

                result = jensen_device.list_files()

        assert result is not None
        assert result["totalFiles"] == 2
        assert len(result["files"]) == 2
        assert result["files"][0]["name"] == "test1.wav"
        assert result["files"][1]["name"] == "test2.wav"

    def test_list_files_timeout_completion(self, jensen_device):
        """Test list_files with timeout completion - covering lines 1324-1341."""
        with patch.object(jensen_device, "_send_command", return_value=1):
            with patch.object(jensen_device, "_receive_response") as mock_receive:
                # Mock consecutive timeouts
                mock_receive.return_value = None

                result = jensen_device.list_files()

        assert result is not None
        assert result["totalFiles"] == 0

    def test_list_files_unexpected_response(self, jensen_device):
        """Test list_files with unexpected response - covering lines 1342-1350."""
        with patch.object(jensen_device, "_send_command", return_value=1):
            with patch.object(jensen_device, "_receive_response") as mock_receive:
                # Mock unexpected response
                mock_receive.side_effect = [
                    {"id": 999, "sequence": 999, "body": b"unexpected"},  # Unexpected response
                    None,  # Then timeout
                ]

                result = jensen_device.list_files()

        assert result is not None

    def test_is_file_list_streaming(self, jensen_device):
        """Test is_file_list_streaming method - covering lines 1371-1373."""
        # Test default state
        assert jensen_device.is_file_list_streaming() is False

        # Test when streaming
        jensen_device._file_list_streaming = True
        assert jensen_device.is_file_list_streaming() is True

    def test_parse_file_list_chunks_empty(self, jensen_device):
        """Test _parse_file_list_chunks with empty chunks."""
        result = jensen_device._parse_file_list_chunks([])
        assert result == []

    def test_parse_file_list_chunks_with_header(self, jensen_device):
        """Test _parse_file_list_chunks with header - covering lines 1398-1405."""
        # Create chunk with header
        chunk = bytearray()
        chunk.extend([0xFF, 0xFF])  # Header marker
        chunk.extend(struct.pack(">I", 1))  # 1 file expected

        # Add one file
        chunk.append(1)  # version
        filename = "test.wav"
        chunk.extend(struct.pack(">I", len(filename))[1:])  # 3-byte length
        chunk.extend(filename.encode())
        chunk.extend(struct.pack(">I", 1000))  # file length
        chunk.extend(b"\x00" * 6)  # skip 6 bytes
        chunk.extend(b"\x00" * 16)  # signature

        result = jensen_device._parse_file_list_chunks([bytes(chunk)])

        assert len(result) == 1
        assert result[0]["name"] == "test.wav"
        assert result[0]["version"] == 1
        assert result[0]["length"] == 1000

    def test_parse_file_list_chunks_insufficient_data(self, jensen_device):
        """Test _parse_file_list_chunks with insufficient data - covering lines 1410-1411, 1419-1420, 1425-1427."""
        # Test insufficient data for version + name length
        chunk1 = b"\x01\x00\x00"  # Only 3 bytes, need 4
        result = jensen_device._parse_file_list_chunks([chunk1])
        assert result == []

        # Test insufficient data for filename
        chunk2 = b"\x01\x00\x00\x05test"  # Says 5 char filename but only 4 chars provided
        result = jensen_device._parse_file_list_chunks([chunk2])
        assert result == []

        # Test insufficient data for remaining fields
        chunk3 = b"\x01\x00\x00\x04test\x00\x00"  # Has filename but missing other fields
        result = jensen_device._parse_file_list_chunks([chunk3])
        assert result == []

    def test_parse_file_list_chunks_parsing_error(self, jensen_device):
        """Test _parse_file_list_chunks with parsing error - covering lines 1461-1467."""
        # Create malformed chunk that will cause struct.error
        chunk = b"\x01\x00\x00\x04test\xff\xff"  # Malformed data

        result = jensen_device._parse_file_list_chunks([chunk])

        # Should return empty list due to parsing error
        assert result == []

    def test_calculate_file_duration_version_1(self, jensen_device):
        """Test _calculate_file_duration for version 1 files."""
        duration = jensen_device._calculate_file_duration(1000, 1)
        expected = (1000 / 32) * 2 * 4  # Version 1 formula with 4x correction
        assert duration == expected

    def test_calculate_file_duration_version_2(self, jensen_device):
        """Test _calculate_file_duration for version 2 files (48kHz WAV)."""
        file_size = 1044  # 44 byte header + 1000 bytes data
        duration = jensen_device._calculate_file_duration(file_size, 2)
        expected = ((file_size - 44) / (48000 * 2 * 1)) * 4  # 48kHz stereo 8-bit with 4x correction
        assert duration == expected

        # Test with file smaller than header
        duration = jensen_device._calculate_file_duration(30, 2)
        assert duration == 0

    def test_calculate_file_duration_version_3(self, jensen_device):
        """Test _calculate_file_duration for version 3 files (24kHz WAV)."""
        file_size = 1044  # 44 byte header + 1000 bytes data
        duration = jensen_device._calculate_file_duration(file_size, 3)
        expected = ((file_size - 44) / (24000 * 2 * 1)) * 4  # 24kHz stereo 8-bit with 4x correction
        assert duration == expected

    def test_calculate_file_duration_version_5(self, jensen_device):
        """Test _calculate_file_duration for version 5 files (12kHz)."""
        duration = jensen_device._calculate_file_duration(1000, 5)
        expected = (1000 / 12000) * 4  # 12kHz with 4x correction
        assert duration == expected

    def test_calculate_file_duration_default(self, jensen_device):
        """Test _calculate_file_duration for default version (16kHz)."""
        duration = jensen_device._calculate_file_duration(1000, 99)  # Unknown version
        expected = (1000 / (16000 * 2 * 1)) * 4  # 16kHz stereo 8-bit with 4x correction
        assert duration == expected

    def test_parse_filename_datetime_yyyymmddhhmmss(self, jensen_device):
        """Test _parse_filename_datetime with YYYYMMDDHHMMSS format."""
        filename = "20231225143059REC.wav"
        date_str, time_str, time_obj = jensen_device._parse_filename_datetime(filename)

        assert date_str == "2023/12/25"
        assert time_str == "14:30:59"
        assert time_obj is not None
        assert time_obj.year == 2023
        assert time_obj.month == 12
        assert time_obj.day == 25

    def test_parse_filename_datetime_month_abbreviation_format(self, jensen_device):
        """Test _parse_filename_datetime with month abbreviation format."""
        filename = "2023Dec25-143059.wav"
        date_str, time_str, time_obj = jensen_device._parse_filename_datetime(filename)

        assert date_str == "2023/12/25"
        assert time_str == "14:30:59"
        assert time_obj is not None

    def test_parse_filename_datetime_2digit_year(self, jensen_device):
        """Test _parse_filename_datetime with 2-digit year format."""
        filename = "23Dec25-143059.hda"
        date_str, time_str, time_obj = jensen_device._parse_filename_datetime(filename)

        assert date_str == "2023/12/25"
        assert time_str == "14:30:59"

    def test_parse_filename_datetime_invalid_format(self, jensen_device):
        """Test _parse_filename_datetime with invalid format - covering lines 1538-1553."""
        filename = "invalid_filename.wav"
        date_str, time_str, time_obj = jensen_device._parse_filename_datetime(filename)

        assert date_str == ""
        assert time_str == ""
        assert time_obj is None

    def test_parse_filename_datetime_parsing_error(self, jensen_device):
        """Test _parse_filename_datetime with parsing error."""
        filename = "2023Feb31-143059.wav"  # Invalid date (Feb 31)
        date_str, time_str, time_obj = jensen_device._parse_filename_datetime(filename)

        assert date_str == ""
        assert time_str == ""
        assert time_obj is None


class TestHiDockJensenStreamFile:
    """Test file streaming operations - covering lines 788-795, 845-878, 881, 919-928, 955-977, 982."""

    @pytest.fixture
    def jensen_device(self):
        """Create a connected HiDockJensen instance for streaming testing."""
        device = HiDockJensen(Mock())
        device.device = Mock()
        device.ep_in = Mock()
        device.ep_out = Mock()
        device.is_connected_flag = True
        return device

    def test_stream_file_basic_success(self, jensen_device):
        """Test basic successful file streaming."""
        filename = "test.wav"
        file_length = 100
        received_data = []
        progress_updates = []

        def data_callback(chunk):
            received_data.append(chunk)

        def progress_callback(bytes_received, total_bytes):
            progress_updates.append((bytes_received, total_bytes))

        with patch.object(jensen_device, "_send_command", return_value=1):
            with patch.object(jensen_device, "_receive_response") as mock_receive:
                # Mock file data chunks
                mock_receive.side_effect = [
                    {"id": CMD_TRANSFER_FILE, "body": b"chunk1"},
                    {"id": CMD_TRANSFER_FILE, "body": b"chunk2"},
                    {"id": CMD_TRANSFER_FILE, "body": b"chunk3_last_to_reach_100"},
                ]

                result = jensen_device.stream_file(filename, file_length, data_callback, progress_callback)

        assert result == "OK"
        assert len(received_data) == 3
        assert len(progress_updates) == 3

    def test_stream_file_cancelled_before_start(self, jensen_device):
        """Test stream_file cancelled before starting - covering lines 1646-1652."""
        cancel_event = threading.Event()
        cancel_event.set()  # Pre-cancelled

        with patch.object(jensen_device, "_send_command", return_value=1):
            result = jensen_device.stream_file("test.wav", 100, Mock(), cancel_event=cancel_event)

        assert result == "cancelled"

    def test_stream_file_timeout(self, jensen_device):
        """Test stream_file timeout - covering lines 1658-1665."""
        with patch.object(jensen_device, "_send_command", return_value=1):
            with patch("hidock_device.time.time") as mock_time:
                # Mock time to simulate timeout
                mock_time.side_effect = [0, 0, 200]  # Start, first check, timeout exceeded

                result = jensen_device.stream_file("test.wav", 100, Mock(), timeout_s=100)

        assert result == "fail_timeout"

    def test_stream_file_cancelled_during_transfer(self, jensen_device):
        """Test stream_file cancelled during transfer - covering lines 1667-1674."""
        cancel_event = threading.Event()

        with patch.object(jensen_device, "_send_command", return_value=1):
            with patch.object(jensen_device, "_receive_response") as mock_receive:

                def side_effect(*args, **kwargs):
                    cancel_event.set()  # Cancel during first receive
                    return {"id": CMD_TRANSFER_FILE, "body": b"chunk"}

                mock_receive.side_effect = side_effect

                result = jensen_device.stream_file("test.wav", 100, Mock(), cancel_event=cancel_event)

        assert result == "cancelled"

    def test_stream_file_empty_chunk_before_completion(self, jensen_device):
        """Test stream_file with empty chunk before completion - covering lines 1690-1696."""
        with patch.object(jensen_device, "_send_command", return_value=1):
            with patch.object(jensen_device, "_receive_response") as mock_receive:
                with patch("hidock_device.time.sleep"):  # Mock sleep to speed up test
                    mock_receive.side_effect = [
                        {"id": CMD_TRANSFER_FILE, "body": b""},  # Empty chunk
                        {"id": CMD_TRANSFER_FILE, "body": b"chunk"},  # Then real data
                        {"id": CMD_TRANSFER_FILE, "body": b"final_chunk_to_complete"},
                    ]

                    result = jensen_device.stream_file("test.wav", 50, Mock())

        assert result == "OK"

    def test_stream_file_empty_chunk_at_completion(self, jensen_device):
        """Test stream_file with empty chunk at completion - covering lines 1682-1689."""
        received_data = []

        def data_callback(chunk):
            received_data.append(chunk)

        with patch.object(jensen_device, "_send_command", return_value=1):
            with patch.object(jensen_device, "_receive_response") as mock_receive:
                mock_receive.side_effect = [
                    {"id": CMD_TRANSFER_FILE, "body": b"complete_data"},  # Exactly the file length
                    {"id": CMD_TRANSFER_FILE, "body": b""},  # Empty chunk after completion
                ]

                result = jensen_device.stream_file("test.wav", 13, data_callback)  # "complete_data" is 13 bytes

        assert result == "OK"
        assert len(received_data) == 1

    def test_stream_file_receive_timeout(self, jensen_device):
        """Test stream_file with receive timeout - covering lines 1709-1716."""
        with patch.object(jensen_device, "_send_command", return_value=1):
            with patch.object(jensen_device, "_receive_response", return_value=None):
                with patch.object(jensen_device, "is_connected", return_value=True):
                    result = jensen_device.stream_file("test.wav", 100, Mock())

        assert result == "fail_comms_error"

    def test_stream_file_receive_timeout_disconnected(self, jensen_device):
        """Test stream_file with receive timeout when disconnected."""
        with patch.object(jensen_device, "_send_command", return_value=1):
            with patch.object(jensen_device, "_receive_response", return_value=None):
                with patch.object(jensen_device, "is_connected", return_value=False):
                    result = jensen_device.stream_file("test.wav", 100, Mock())

        assert result == "fail_disconnected"

    def test_stream_file_unexpected_response(self, jensen_device):
        """Test stream_file with unexpected response - covering lines 1717-1724."""
        with patch.object(jensen_device, "_send_command", return_value=1):
            with patch.object(jensen_device, "_receive_response") as mock_receive:
                mock_receive.return_value = {"id": 999, "sequence": 1, "body": b"unexpected"}

                result = jensen_device.stream_file("test.wav", 100, Mock())

        assert result == "fail_unexpected_response"

    def test_stream_file_usb_error(self, jensen_device):
        """Test stream_file with USB error - covering lines 1734-1743."""
        with patch.object(jensen_device, "_send_command", side_effect=usb.core.USBError("USB Error")):
            with patch.object(jensen_device, "is_connected", return_value=True):
                result = jensen_device.stream_file("test.wav", 100, Mock())

        assert result == "fail_comms_error"

    def test_stream_file_usb_error_disconnected(self, jensen_device):
        """Test stream_file with USB error when disconnected."""
        with patch.object(jensen_device, "_send_command", side_effect=usb.core.USBError("USB Error")):
            with patch.object(jensen_device, "is_connected", return_value=False):
                result = jensen_device.stream_file("test.wav", 100, Mock())

        assert result == "fail_disconnected"

    def test_stream_file_connection_error(self, jensen_device):
        """Test stream_file with connection error."""
        with patch.object(jensen_device, "_send_command", side_effect=ConnectionError("Connection lost")):
            result = jensen_device.stream_file("test.wav", 100, Mock())

        assert result == "fail_comms_error"

    def test_stream_file_io_error(self, jensen_device):
        """Test stream_file with IO error - covering lines 1744-1755."""
        with patch.object(jensen_device, "_send_command", side_effect=IOError("IO Error")):
            result = jensen_device.stream_file("test.wav", 100, Mock())

        assert result == "fail_file_io"

    def test_stream_file_os_error(self, jensen_device):
        """Test stream_file with OS error."""
        with patch.object(jensen_device, "_send_command", side_effect=OSError("OS Error")):
            result = jensen_device.stream_file("test.wav", 100, Mock())

        assert result == "fail_file_io"

    def test_stream_file_generic_exception(self, jensen_device):
        """Test stream_file with generic exception - covering lines 1758-1766."""
        with patch.object(jensen_device, "_send_command", side_effect=Exception("Generic error")):
            result = jensen_device.stream_file("test.wav", 100, Mock())

        assert result == "fail_exception"

    def test_stream_file_keyboard_interrupt(self, jensen_device):
        """Test stream_file with KeyboardInterrupt - should re-raise."""
        with patch.object(jensen_device, "_send_command", side_effect=KeyboardInterrupt()):
            with pytest.raises(KeyboardInterrupt):
                jensen_device.stream_file("test.wav", 100, Mock())

    def test_stream_file_system_exit(self, jensen_device):
        """Test stream_file with SystemExit - should re-raise."""
        with patch.object(jensen_device, "_send_command", side_effect=SystemExit()):
            with pytest.raises(SystemExit):
                jensen_device.stream_file("test.wav", 100, Mock())

    def test_stream_file_finally_cleanup_success(self, jensen_device):
        """Test stream_file finally block cleanup on success."""
        with patch.object(jensen_device, "_send_command", return_value=1):
            with patch.object(jensen_device, "_receive_response") as mock_receive:
                mock_receive.return_value = {"id": CMD_TRANSFER_FILE, "body": b"complete_data"}

                result = jensen_device.stream_file("test.wav", 13, Mock())

        assert result == "OK"
        # No flush should occur on success

    def test_stream_file_finally_cleanup_failure(self, jensen_device):
        """Test stream_file finally block cleanup on failure - covering lines 1769-1793."""
        jensen_device.ep_in.wMaxPacketSize = 64

        # Mock successful flush
        jensen_device.device.read.side_effect = [b"data", b""]  # Some data then empty

        with patch.object(jensen_device, "_send_command", return_value=1):
            with patch.object(jensen_device, "_receive_response", return_value=None):  # Timeout
                result = jensen_device.stream_file("test.wav", 100, Mock())

        assert result == "fail_comms_error"
        # Verify flush was attempted
        assert jensen_device.device.read.call_count > 0

    def test_stream_file_finally_cleanup_flush_timeout(self, jensen_device):
        """Test stream_file finally block with flush timeout - covering lines 1785-1786."""
        jensen_device.ep_in.wMaxPacketSize = 64

        # Mock flush timeout
        jensen_device.device.read.side_effect = usb.core.USBTimeoutError("Timeout")

        with patch.object(jensen_device, "_send_command", return_value=1):
            with patch.object(jensen_device, "_receive_response", return_value=None):  # Timeout
                result = jensen_device.stream_file("test.wav", 100, Mock())

        assert result == "fail_comms_error"

    def test_stream_file_finally_cleanup_flush_error(self, jensen_device):
        """Test stream_file finally block with flush USB error - covering lines 1787-1793."""
        jensen_device.ep_in.wMaxPacketSize = 64

        # Mock flush USB error
        jensen_device.device.read.side_effect = usb.core.USBError("Flush error")

        with patch.object(jensen_device, "_send_command", return_value=1):
            with patch.object(jensen_device, "_receive_response", return_value=None):  # Timeout
                result = jensen_device.stream_file("test.wav", 100, Mock())

        assert result == "fail_comms_error"


class TestHiDockJensenFileCount:
    """Test file count operations."""

    @pytest.fixture
    def jensen_device(self):
        """Create a connected HiDockJensen instance."""
        device = HiDockJensen(Mock())
        device.device = Mock()
        device.is_connected_flag = True
        return device

    def test_get_file_count_during_streaming(self, jensen_device):
        """Test get_file_count when file list streaming is active - covering lines 1108-1110."""
        jensen_device._file_list_streaming = True

        result = jensen_device.get_file_count()

        assert result is None

    def test_get_file_count_empty_body(self, jensen_device):
        """Test get_file_count with empty response body - covering lines 1115-1116."""
        with patch.object(jensen_device, "_send_and_receive") as mock_send_receive:
            mock_send_receive.return_value = {"id": CMD_GET_FILE_COUNT, "body": b""}

            result = jensen_device.get_file_count()

        assert result == {"count": 0}

    def test_get_file_count_success(self, jensen_device):
        """Test successful get_file_count - covering lines 1117-1120."""
        with patch.object(jensen_device, "_send_and_receive") as mock_send_receive:
            mock_send_receive.return_value = {"id": CMD_GET_FILE_COUNT, "body": struct.pack(">I", 42)}

            result = jensen_device.get_file_count()

        assert result == {"count": 42}

    def test_get_file_count_invalid_response(self, jensen_device):
        """Test get_file_count with invalid response - covering line 1121-1122."""
        with patch.object(jensen_device, "_send_and_receive") as mock_send_receive:
            mock_send_receive.return_value = {"id": 999, "body": b"invalid"}

            result = jensen_device.get_file_count()

        assert result is None


class TestHiDockJensenDeleteFile:
    """Test file deletion operations."""

    @pytest.fixture
    def jensen_device(self):
        """Create a connected HiDockJensen instance."""
        device = HiDockJensen(Mock())
        device.device = Mock()
        device.is_connected_flag = True
        return device

    def test_delete_file_during_streaming(self, jensen_device):
        """Test delete_file when file list streaming is active - covering lines 1810-1812."""
        jensen_device._file_list_streaming = True

        result = jensen_device.delete_file("test.wav")

        assert result["result"] == "failed"
        assert "streaming" in result["error"]

    def test_delete_file_success(self, jensen_device):
        """Test successful file deletion - covering lines 1819-1828."""
        with patch.object(jensen_device, "_send_and_receive") as mock_send_receive:
            mock_send_receive.return_value = {"id": CMD_DELETE_FILE, "body": b"\x00"}  # Success code

            result = jensen_device.delete_file("test.wav")

        assert result["result"] == "success"
        assert result["code"] == 0

    def test_delete_file_not_exists(self, jensen_device):
        """Test delete file that doesn't exist."""
        with patch.object(jensen_device, "_send_and_receive") as mock_send_receive:
            mock_send_receive.return_value = {"id": CMD_DELETE_FILE, "body": b"\x01"}  # Not exists code

            result = jensen_device.delete_file("nonexistent.wav")

        assert result["result"] == "not-exists"
        assert result["code"] == 1

    def test_delete_file_failed(self, jensen_device):
        """Test delete file failure."""
        with patch.object(jensen_device, "_send_and_receive") as mock_send_receive:
            mock_send_receive.return_value = {"id": CMD_DELETE_FILE, "body": b"\x02"}  # Failed code

            result = jensen_device.delete_file("test.wav")

        assert result["result"] == "failed"
        assert result["code"] == 2

    def test_delete_file_empty_body(self, jensen_device):
        """Test delete file with empty response body."""
        with patch.object(jensen_device, "_send_and_receive") as mock_send_receive:
            mock_send_receive.return_value = {"id": CMD_DELETE_FILE, "body": b""}

            result = jensen_device.delete_file("test.wav")

        assert result["result"] == "failed"
        assert result["code"] == 2  # Default failed code

    def test_delete_file_invalid_response(self, jensen_device):
        """Test delete file with invalid response - covering lines 1829-1838."""
        with patch.object(jensen_device, "_send_and_receive") as mock_send_receive:
            mock_send_receive.return_value = None

            result = jensen_device.delete_file("test.wav")

        assert result["result"] == "failed"
        assert result["code"] == -1
        assert "error" in result


class TestHiDockJensenGetFileBlock:
    """Test file block operations - covering lines 2202-2250."""

    @pytest.fixture
    def jensen_device(self):
        """Create a connected HiDockJensen instance."""
        device = HiDockJensen(Mock())
        device.device = Mock()
        device.is_connected_flag = True
        return device

    def test_get_file_block_success(self, jensen_device):
        """Test successful get_file_block - covering lines 2218-2228."""
        test_data = b"test_file_block_data"

        with patch.object(jensen_device, "_send_command", return_value=1):
            with patch.object(jensen_device, "_receive_response") as mock_receive:
                mock_receive.return_value = {"id": CMD_GET_FILE_BLOCK, "body": test_data}

                result = jensen_device.get_file_block("test.wav", 0, 100)

        assert result == test_data

    def test_get_file_block_invalid_response(self, jensen_device):
        """Test get_file_block with invalid response - covering lines 2229-2234."""
        with patch.object(jensen_device, "_send_command", return_value=1):
            with patch.object(jensen_device, "_receive_response") as mock_receive:
                mock_receive.return_value = {"id": 999, "body": b"wrong"}

                result = jensen_device.get_file_block("test.wav", 0, 100)

        assert result is None

    def test_get_file_block_usb_error(self, jensen_device):
        """Test get_file_block with USB error - covering lines 2235-2240."""
        with patch.object(jensen_device, "_send_command", side_effect=usb.core.USBError("USB Error")):
            result = jensen_device.get_file_block("test.wav", 0, 100)

        assert result is None

    def test_get_file_block_connection_error(self, jensen_device):
        """Test get_file_block with connection error."""
        with patch.object(jensen_device, "_send_command", side_effect=ConnectionError("Connection lost")):
            result = jensen_device.get_file_block("test.wav", 0, 100)

        assert result is None

    def test_get_file_block_packet_structure(self, jensen_device):
        """Test get_file_block packet structure is correct."""
        filename = "test.wav"
        offset = 1000
        length = 500

        with patch.object(jensen_device, "_send_command") as mock_send:
            with patch.object(jensen_device, "_receive_response") as mock_receive:
                mock_receive.return_value = {"id": CMD_GET_FILE_BLOCK, "body": b"data"}

                jensen_device.get_file_block(filename, offset, length)

        # Verify the body structure: offset (4 bytes) + length (4 bytes) + filename
        expected_body = (
            struct.pack(">I", offset) + struct.pack(">I", length) + filename.encode("ascii", errors="ignore")
        )
        mock_send.assert_called_once_with(CMD_GET_FILE_BLOCK, expected_body, 5000)
