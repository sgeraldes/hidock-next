"""
Tests for HiDockJensen settings and card management operations.

This test module focuses on device settings, card management, and recording file operations,
targeting uncovered lines in settings and card handling logic.
"""

import struct
from unittest.mock import Mock, patch

import pytest

from constants import CMD_FORMAT_CARD, CMD_GET_CARD_INFO, CMD_GET_RECORDING_FILE, CMD_GET_SETTINGS, CMD_SET_SETTINGS
from hidock_device import HiDockJensen


class TestHiDockJensenDeviceSettings:
    """Test device settings operations - covering lines 2114-2200."""

    @pytest.fixture
    def jensen_device(self):
        """Create a connected HiDockJensen instance."""
        device = HiDockJensen(Mock())
        device.device = Mock()
        device.is_connected_flag = True
        return device

    def test_get_device_settings_success(self, jensen_device):
        """Test successful get_device_settings - covering lines 2126-2143."""
        # Create response with all settings enabled
        settings_body = bytes([1, 1, 1, 1])  # autoRecord, autoPlay, bluetoothTone, notificationSound

        with patch.object(jensen_device, "_send_and_receive") as mock_send_receive:
            mock_send_receive.return_value = {"id": CMD_GET_SETTINGS, "body": settings_body}

            result = jensen_device.get_device_settings()

        assert result is not None
        assert result["autoRecord"] is True
        assert result["autoPlay"] is True
        assert result["bluetoothTone"] is True
        assert result["notificationSound"] is True

        # Verify cached settings match
        assert jensen_device.device_behavior_settings == result

    def test_get_device_settings_mixed_values(self, jensen_device):
        """Test get_device_settings with mixed boolean values."""
        # Create response with mixed settings
        settings_body = bytes([1, 0, 1, 0])  # True, False, True, False

        with patch.object(jensen_device, "_send_and_receive") as mock_send_receive:
            mock_send_receive.return_value = {"id": CMD_GET_SETTINGS, "body": settings_body}

            result = jensen_device.get_device_settings()

        assert result["autoRecord"] is True
        assert result["autoPlay"] is False
        assert result["bluetoothTone"] is True
        assert result["notificationSound"] is False

    def test_get_device_settings_insufficient_body(self, jensen_device):
        """Test get_device_settings with insufficient response body - covering lines 2144-2148."""
        # Response body too short (less than 4 bytes)
        short_body = bytes([1, 0])

        with patch.object(jensen_device, "_send_and_receive") as mock_send_receive:
            mock_send_receive.return_value = {"id": CMD_GET_SETTINGS, "body": short_body}

            result = jensen_device.get_device_settings()

        assert result is None

    def test_get_device_settings_invalid_response(self, jensen_device):
        """Test get_device_settings with invalid response."""
        with patch.object(jensen_device, "_send_and_receive") as mock_send_receive:
            mock_send_receive.return_value = {"id": 999, "body": bytes([1, 1, 1, 1])}

            result = jensen_device.get_device_settings()

        assert result is None

    def test_get_device_settings_no_response(self, jensen_device):
        """Test get_device_settings with no response."""
        with patch.object(jensen_device, "_send_and_receive") as mock_send_receive:
            mock_send_receive.return_value = None

            result = jensen_device.get_device_settings()

        assert result is None

    def test_set_device_settings_success(self, jensen_device):
        """Test successful set_device_settings - covering lines 2151-2194."""
        # Mock current settings
        current_settings = {
            "autoRecord": False,
            "autoPlay": False,
            "bluetoothTone": False,
            "notificationSound": False,
        }

        # Settings to update
        new_settings = {
            "autoRecord": True,
            "bluetoothTone": True,
        }

        with patch.object(jensen_device, "get_device_settings", return_value=current_settings):
            with patch.object(jensen_device, "_send_and_receive") as mock_send_receive:
                mock_send_receive.return_value = {"id": CMD_SET_SETTINGS, "body": b"\x00"}  # Success

                result = jensen_device.set_device_settings(new_settings)

        assert result["result"] == "success"

        # Verify the payload was constructed correctly (merged settings)
        expected_payload = bytes(
            [
                1,  # autoRecord (updated to True)
                0,  # autoPlay (unchanged False)
                1,  # bluetoothTone (updated to True)
                0,  # notificationSound (unchanged False)
            ]
        )
        mock_send_receive.assert_called_once_with(CMD_SET_SETTINGS, expected_payload, timeout_ms=5000)

        # Verify local cache was updated
        expected_final_settings = {
            "autoRecord": True,
            "autoPlay": False,
            "bluetoothTone": True,
            "notificationSound": False,
        }
        assert jensen_device.device_behavior_settings == expected_final_settings

    def test_set_device_settings_get_current_fails(self, jensen_device):
        """Test set_device_settings when getting current settings fails - covering lines 2166-2173."""
        new_settings = {"autoRecord": True}

        with patch.object(jensen_device, "get_device_settings", return_value=None):
            result = jensen_device.set_device_settings(new_settings)

        assert result["result"] == "failed"
        assert result["error"] == "Could not get current settings."

    def test_set_device_settings_device_error(self, jensen_device):
        """Test set_device_settings with device error response - covering lines 2195-2200."""
        current_settings = {
            "autoRecord": False,
            "autoPlay": False,
            "bluetoothTone": False,
            "notificationSound": False,
        }
        new_settings = {"autoRecord": True}

        with patch.object(jensen_device, "get_device_settings", return_value=current_settings):
            with patch.object(jensen_device, "_send_and_receive") as mock_send_receive:
                mock_send_receive.return_value = {"id": CMD_SET_SETTINGS, "body": b"\x01"}  # Error code

                result = jensen_device.set_device_settings(new_settings)

        assert result["result"] == "failed"

    def test_set_device_settings_invalid_response(self, jensen_device):
        """Test set_device_settings with invalid response."""
        current_settings = {
            "autoRecord": False,
            "autoPlay": False,
            "bluetoothTone": False,
            "notificationSound": False,
        }
        new_settings = {"autoRecord": True}

        with patch.object(jensen_device, "get_device_settings", return_value=current_settings):
            with patch.object(jensen_device, "_send_and_receive") as mock_send_receive:
                mock_send_receive.return_value = {"id": 999, "body": b"\x00"}

                result = jensen_device.set_device_settings(new_settings)

        assert result["result"] == "failed"

    def test_set_device_settings_empty_body(self, jensen_device):
        """Test set_device_settings with empty response body."""
        current_settings = {
            "autoRecord": False,
            "autoPlay": False,
            "bluetoothTone": False,
            "notificationSound": False,
        }
        new_settings = {"autoRecord": True}

        with patch.object(jensen_device, "get_device_settings", return_value=current_settings):
            with patch.object(jensen_device, "_send_and_receive") as mock_send_receive:
                mock_send_receive.return_value = {"id": CMD_SET_SETTINGS, "body": b""}

                result = jensen_device.set_device_settings(new_settings)

        assert result["result"] == "failed"

    def test_set_device_settings_partial_update(self, jensen_device):
        """Test set_device_settings with partial settings update."""
        current_settings = {
            "autoRecord": True,
            "autoPlay": True,
            "bluetoothTone": True,
            "notificationSound": True,
        }

        # Only update one setting
        new_settings = {"autoPlay": False}

        with patch.object(jensen_device, "get_device_settings", return_value=current_settings):
            with patch.object(jensen_device, "_send_and_receive") as mock_send_receive:
                mock_send_receive.return_value = {"id": CMD_SET_SETTINGS, "body": b"\x00"}

                result = jensen_device.set_device_settings(new_settings)

        assert result["result"] == "success"

        # Verify only autoPlay was changed
        expected_payload = bytes([1, 0, 1, 1])  # autoRecord, autoPlay(changed), bluetoothTone, notificationSound
        mock_send_receive.assert_called_once_with(CMD_SET_SETTINGS, expected_payload, timeout_ms=5000)

    def test_set_device_settings_unknown_keys_ignored(self, jensen_device):
        """Test set_device_settings ignores unknown setting keys."""
        current_settings = {
            "autoRecord": False,
            "autoPlay": False,
            "bluetoothTone": False,
            "notificationSound": False,
        }

        # Include unknown setting key
        new_settings = {
            "autoRecord": True,
            "unknownSetting": True,  # Should be ignored
        }

        with patch.object(jensen_device, "get_device_settings", return_value=current_settings):
            with patch.object(jensen_device, "_send_and_receive") as mock_send_receive:
                mock_send_receive.return_value = {"id": CMD_SET_SETTINGS, "body": b"\x00"}

                result = jensen_device.set_device_settings(new_settings)

        assert result["result"] == "success"

        # Verify unknown setting was ignored, only autoRecord changed
        expected_payload = bytes([1, 0, 0, 0])
        mock_send_receive.assert_called_once_with(CMD_SET_SETTINGS, expected_payload, timeout_ms=5000)


class TestHiDockJensenCardManagement:
    """Test card management operations."""

    @pytest.fixture
    def jensen_device(self):
        """Create a connected HiDockJensen instance."""
        device = HiDockJensen(Mock())
        device.device = Mock()
        device.is_connected_flag = True
        return device

    def test_get_card_info_during_streaming(self, jensen_device):
        """Test get_card_info when file list streaming is active - covering lines 1853-1855."""
        jensen_device._file_list_streaming = True

        result = jensen_device.get_card_info()

        assert result is None

    def test_get_card_info_success(self, jensen_device):
        """Test successful get_card_info - covering lines 1857-1871."""
        # Create card info response: used (100 MB), capacity (1000 MB), status (0)
        card_info_body = struct.pack(">III", 100, 1000, 0)

        with patch.object(jensen_device, "_send_and_receive") as mock_send_receive:
            mock_send_receive.return_value = {"id": CMD_GET_CARD_INFO, "body": card_info_body}

            result = jensen_device.get_card_info()

        assert result is not None
        assert result["used"] == 100
        assert result["capacity"] == 1000
        assert result["status_raw"] == 0

    def test_get_card_info_short_body(self, jensen_device):
        """Test get_card_info with short response body - covering lines 1878-1882."""
        short_body = b"\x00\x00\x64"  # Less than 12 bytes

        with patch.object(jensen_device, "_send_and_receive") as mock_send_receive:
            mock_send_receive.return_value = {"id": CMD_GET_CARD_INFO, "body": short_body}

            result = jensen_device.get_card_info()

        assert result is None

    def test_get_card_info_struct_error(self, jensen_device):
        """Test get_card_info with struct unpack error - covering lines 1872-1877."""
        # Create malformed body that will cause struct.error
        malformed_body = b"\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff"  # 11 bytes, not 12

        with patch.object(jensen_device, "_send_and_receive") as mock_send_receive:
            mock_send_receive.return_value = {"id": CMD_GET_CARD_INFO, "body": malformed_body}

            result = jensen_device.get_card_info()

        assert result is None

    def test_get_card_info_invalid_response(self, jensen_device):
        """Test get_card_info with invalid response - covering line 1883."""
        with patch.object(jensen_device, "_send_and_receive") as mock_send_receive:
            mock_send_receive.return_value = {"id": 999, "body": b"invalid"}

            result = jensen_device.get_card_info()

        assert result is None

    def test_get_card_info_no_response(self, jensen_device):
        """Test get_card_info with no response."""
        with patch.object(jensen_device, "_send_and_receive") as mock_send_receive:
            mock_send_receive.return_value = None

            result = jensen_device.get_card_info()

        assert result is None

    def test_format_card_during_streaming(self, jensen_device):
        """Test format_card when file list streaming is active - covering lines 1899-1901."""
        jensen_device._file_list_streaming = True

        result = jensen_device.format_card()

        assert result["result"] == "failed"
        assert "streaming" in result["error"]

    def test_format_card_success(self, jensen_device):
        """Test successful format_card - covering lines 1903-1916."""
        with patch.object(jensen_device, "_send_and_receive") as mock_send_receive:
            mock_send_receive.return_value = {"id": CMD_FORMAT_CARD, "body": b"\x00"}  # Success code

            result = jensen_device.format_card()

        assert result["result"] == "success"
        assert result["code"] == 0

        # Verify the expected payload was sent
        expected_payload = bytes([1, 2, 3, 4])
        mock_send_receive.assert_called_once_with(CMD_FORMAT_CARD, body_bytes=expected_payload, timeout_ms=60000)

    def test_format_card_failure(self, jensen_device):
        """Test format_card failure."""
        with patch.object(jensen_device, "_send_and_receive") as mock_send_receive:
            mock_send_receive.return_value = {"id": CMD_FORMAT_CARD, "body": b"\x01"}  # Error code

            result = jensen_device.format_card()

        assert result["result"] == "failed"
        assert result["code"] == 1

    def test_format_card_empty_body(self, jensen_device):
        """Test format_card with empty response body."""
        with patch.object(jensen_device, "_send_and_receive") as mock_send_receive:
            mock_send_receive.return_value = {"id": CMD_FORMAT_CARD, "body": b""}

            result = jensen_device.format_card()

        assert result["result"] == "failed"
        assert result["code"] == 1  # Default failed code

    def test_format_card_invalid_response(self, jensen_device):
        """Test format_card with invalid response - covering lines 1917-1926."""
        with patch.object(jensen_device, "_send_and_receive") as mock_send_receive:
            mock_send_receive.return_value = {"id": 999, "body": b"\x00"}

            result = jensen_device.format_card()

        assert result["result"] == "failed"
        assert result["code"] == -1
        assert "error" in result

    def test_format_card_no_response(self, jensen_device):
        """Test format_card with no response."""
        with patch.object(jensen_device, "_send_and_receive") as mock_send_receive:
            mock_send_receive.return_value = None

            result = jensen_device.format_card()

        assert result["result"] == "failed"
        assert result["code"] == -1


class TestHiDockJensenRecordingFile:
    """Test recording file operations."""

    @pytest.fixture
    def jensen_device(self):
        """Create a connected HiDockJensen instance."""
        device = HiDockJensen(Mock())
        device.device = Mock()
        device.is_connected_flag = True
        return device

    def test_get_recording_file_during_streaming(self, jensen_device):
        """Test get_recording_file when file list streaming is active - covering lines 1941-1943."""
        jensen_device._file_list_streaming = True

        result = jensen_device.get_recording_file()

        assert result is None

    def test_get_recording_file_success(self, jensen_device):
        """Test successful get_recording_file - covering lines 1945-1975."""
        # Create response with filename
        filename = "20231225143059REC.wav\x00"  # Null-terminated
        filename_body = filename.encode("ascii")

        with patch.object(jensen_device, "_send_and_receive") as mock_send_receive:
            mock_send_receive.return_value = {"id": CMD_GET_RECORDING_FILE, "body": filename_body}

            result = jensen_device.get_recording_file()

        assert result is not None
        assert result["name"] == "20231225143059REC.wav"
        assert result["status"] == "recording_active_or_last"

    def test_get_recording_file_empty_body(self, jensen_device):
        """Test get_recording_file with empty response body - covering lines 1947-1953."""
        with patch.object(jensen_device, "_send_and_receive") as mock_send_receive:
            mock_send_receive.return_value = {"id": CMD_GET_RECORDING_FILE, "body": b""}

            result = jensen_device.get_recording_file()

        assert result is None

    def test_get_recording_file_unprintable_bytes(self, jensen_device):
        """Test get_recording_file with unprintable bytes - covering lines 1955-1962."""
        # Create filename with only unprintable characters that become empty after cleanup
        unprintable_filename = b"\x01\x02\x03\x04\x00"

        with patch.object(jensen_device, "_send_and_receive") as mock_send_receive:
            mock_send_receive.return_value = {"id": CMD_GET_RECORDING_FILE, "body": unprintable_filename}

            result = jensen_device.get_recording_file()

        # Should return None when filename is empty after cleanup
        assert result is None

    def test_get_recording_file_unicode_decode_error(self, jensen_device):
        """Test get_recording_file with Unicode decode error - covering lines 1961-1962."""
        # Create bytes that will cause UnicodeDecodeError when decoded as ascii
        problematic_bytes = b"\xff\xfe\xfd\xfc\x00"

        with patch.object(jensen_device, "_send_and_receive") as mock_send_receive:
            mock_send_receive.return_value = {"id": CMD_GET_RECORDING_FILE, "body": problematic_bytes}

            # Mock the decode to raise UnicodeDecodeError
            with patch("builtins.bytearray") as mock_bytearray:
                mock_instance = mock_bytearray.return_value
                mock_instance.decode.side_effect = UnicodeDecodeError("ascii", b"", 0, 1, "test")
                mock_instance.__iter__ = lambda self: iter(problematic_bytes)
                mock_instance.find.return_value = 4  # Position of null terminator
                mock_instance.__getitem__ = lambda self, key: problematic_bytes[key]

                result = jensen_device.get_recording_file()

        assert result is not None
        assert result["name"] == problematic_bytes.hex()

    def test_get_recording_file_empty_after_cleanup(self, jensen_device):
        """Test get_recording_file when filename is empty after cleanup - covering lines 1963-1969."""
        # Create response with only control characters
        control_chars = b"\x01\x02\x03\x00"

        with patch.object(jensen_device, "_send_and_receive") as mock_send_receive:
            mock_send_receive.return_value = {"id": CMD_GET_RECORDING_FILE, "body": control_chars}

            result = jensen_device.get_recording_file()

        assert result is None

    def test_get_recording_file_card_info_response(self, jensen_device):
        """Test get_recording_file receiving card info response instead - covering lines 1976-1982."""
        with patch.object(jensen_device, "_send_and_receive") as mock_send_receive:
            mock_send_receive.return_value = {"id": CMD_GET_CARD_INFO, "body": b"card_info_data"}

            result = jensen_device.get_recording_file()

        assert result is None

    def test_get_recording_file_invalid_response(self, jensen_device):
        """Test get_recording_file with invalid response - covering lines 1983-1988."""
        with patch.object(jensen_device, "_send_and_receive") as mock_send_receive:
            mock_send_receive.return_value = {"id": 999, "body": b"invalid"}

            result = jensen_device.get_recording_file()

        assert result is None

    def test_get_recording_file_no_response(self, jensen_device):
        """Test get_recording_file with no response."""
        with patch.object(jensen_device, "_send_and_receive") as mock_send_receive:
            mock_send_receive.return_value = None

            result = jensen_device.get_recording_file()

        assert result is None

    def test_get_recording_file_with_null_terminator(self, jensen_device):
        """Test get_recording_file properly handles null terminator."""
        # Filename with null terminator in middle
        filename_with_extra = b"test.wav\x00extra_data_after_null"

        with patch.object(jensen_device, "_send_and_receive") as mock_send_receive:
            mock_send_receive.return_value = {"id": CMD_GET_RECORDING_FILE, "body": filename_with_extra}

            result = jensen_device.get_recording_file()

        assert result is not None
        assert result["name"] == "test.wav"  # Should stop at null terminator

    def test_get_recording_file_mixed_printable_unprintable(self, jensen_device):
        """Test get_recording_file with mixed printable and unprintable characters."""
        # Mix of printable and unprintable characters
        mixed_filename = b"test\xff\xfe.wav\x00"

        with patch.object(jensen_device, "_send_and_receive") as mock_send_receive:
            mock_send_receive.return_value = {"id": CMD_GET_RECORDING_FILE, "body": mixed_filename}

            result = jensen_device.get_recording_file()

        assert result is not None
        # Should extract only printable characters: "test.wav"
        assert result["name"] == "test.wav"

    def test_get_recording_file_only_spaces_and_nulls(self, jensen_device):
        """Test get_recording_file with only spaces and null characters."""
        spaces_and_nulls = b"   \x00\x00\x00"

        with patch.object(jensen_device, "_send_and_receive") as mock_send_receive:
            mock_send_receive.return_value = {"id": CMD_GET_RECORDING_FILE, "body": spaces_and_nulls}

            result = jensen_device.get_recording_file()

        assert result is None  # Should be None after stripping spaces
