"""
Comprehensive Tests for Desktop Device Adapter - Coverage Enhancement.

This test suite focuses on achieving 80%+ coverage by testing the missing lines
and edge cases in the desktop device adapter implementation, including error
handling, protocol violations, device communication failures, and recovery scenarios.
"""

import asyncio
import time
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, Mock, call, mock_open, patch

import pytest

# Import the module under test
import desktop_device_adapter
from desktop_device_adapter import DesktopDeviceAdapter, create_desktop_device_adapter
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


class TestDeviceDiscoveryErrorHandling:
    """Test device discovery error handling scenarios (lines 98-104)."""

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
    async def test_discover_devices_general_exception(self):
        """Test device discovery with general exception handling (lines 98-104)."""
        with patch("desktop_device_adapter.HiDockJensen") as mock_jensen_class:
            # Mock to raise exception during device discovery process
            mock_jensen_class.side_effect = Exception("Critical USB backend error")

            devices = await self.adapter.discover_devices()

            # Should return empty list and log error
            assert devices == []

    @pytest.mark.asyncio
    async def test_discover_devices_usb_permission_error(self):
        """Test device discovery with USB permission errors."""
        with patch("desktop_device_adapter.HiDockJensen") as mock_jensen_class:
            # Mock permission error during USB access
            mock_test_device = Mock()
            mock_test_device._find_device.side_effect = PermissionError("USB access denied")
            mock_jensen_class.return_value = mock_test_device

            devices = await self.adapter.discover_devices()

            assert devices == []


class TestConnectionTimeoutAndRetry:
    """Test connection timeout and retry logic (lines 142-147)."""

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
    async def test_connect_timeout_retry_with_reset(self):
        """Test connection timeout retry with device reset (lines 142-147)."""
        # First connection attempt fails with timeout
        # Second attempt (with force_reset) succeeds
        self.mock_jensen.connect.side_effect = [(False, "Connection timeout occurred"), (True, None)]
        self.mock_jensen.get_device_info.return_value = {"sn": "RETRY123", "versionCode": "1.0.0"}

        with patch("desktop_device_adapter.detect_device_model") as mock_detect:
            mock_detect.return_value = DeviceModel.H1E

            result = await self.adapter.connect()

            assert isinstance(result, DeviceInfo)
            assert result.serial_number == "RETRY123"
            # Should have called connect twice (original + retry with force_reset)
            assert self.mock_jensen.connect.call_count == 2

            # Check second call has force_reset=True
            second_call = self.mock_jensen.connect.call_args_list[1]
            assert second_call[1]["force_reset"] is True

    @pytest.mark.asyncio
    async def test_connect_timeout_retry_still_fails(self):
        """Test connection timeout retry that still fails (lines 142-147)."""
        # Both connection attempts fail with timeout
        self.mock_jensen.connect.side_effect = [
            (False, "Connection timeout occurred"),
            (False, "Still timing out after reset"),
        ]

        with pytest.raises(ConnectionError) as exc_info:
            await self.adapter.connect()

        assert "Still timing out after reset" in str(exc_info.value)
        # Should have called connect twice
        assert self.mock_jensen.connect.call_count == 2

    @pytest.mark.asyncio
    async def test_connect_non_timeout_error_no_retry(self):
        """Test that non-timeout errors don't trigger retry."""
        # Non-timeout error should not trigger retry
        self.mock_jensen.connect.return_value = (False, "Invalid device configuration")

        with pytest.raises(ConnectionError) as exc_info:
            await self.adapter.connect()

        assert "Invalid device configuration" in str(exc_info.value)
        # Should only call connect once (no retry for non-timeout errors)
        assert self.mock_jensen.connect.call_count == 1


class TestStorageInfoStreamingEdgeCases:
    """Test storage info retrieval during streaming operations (lines 228-232, 243-246)."""

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
    async def test_get_storage_info_during_streaming(self):
        """Test storage info retrieval during file streaming (lines 228-232)."""
        self.mock_jensen.is_connected.return_value = True
        # Mock streaming is in progress
        self.mock_jensen.is_file_list_streaming = Mock(return_value=True)

        result = await self.adapter.get_storage_info()

        assert isinstance(result, StorageInfo)
        # Should use fallback values during streaming
        assert result.total_capacity == 8 * 1024 * 1024 * 1024  # 8GB fallback
        assert result.used_space == 0
        assert result.free_space == 8 * 1024 * 1024 * 1024
        assert result.file_count == 0

        # Should not call get_card_info during streaming
        self.mock_jensen.get_card_info.assert_not_called()
        self.mock_jensen.get_file_count.assert_not_called()

    @pytest.mark.asyncio
    async def test_get_storage_info_card_info_none(self):
        """Test storage info when card info is None (lines 243-246)."""
        self.mock_jensen.is_connected.return_value = True
        self.mock_jensen.is_file_list_streaming = Mock(return_value=False)
        # Return None for card info to trigger fallback
        self.mock_jensen.get_card_info.return_value = None
        self.mock_jensen.get_file_count.return_value = {"count": 10}

        result = await self.adapter.get_storage_info()

        assert isinstance(result, StorageInfo)
        # Should use fallback values when card_info is None
        assert result.total_capacity == 8 * 1024 * 1024 * 1024  # 8GB fallback
        assert result.used_space == 0
        assert result.free_space == 8 * 1024 * 1024 * 1024
        assert result.file_count == 10


class TestRecordingOperationsEdgeCases:
    """Test recording operations edge cases (lines 278, 300, 305, 350-351, 364-365, 368-378)."""

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
    async def test_get_recordings_empty_files_info(self):
        """Test get_recordings when files_info is empty or malformed (line 278)."""
        self.mock_jensen.is_connected.return_value = True
        # Return None or malformed data
        self.mock_jensen.list_files.return_value = None

        result = await self.adapter.get_recordings()

        assert result == []

    @pytest.mark.asyncio
    async def test_get_recordings_no_files_key(self):
        """Test get_recordings when files_info lacks 'files' key (line 278)."""
        self.mock_jensen.is_connected.return_value = True
        # Return dict without 'files' key
        self.mock_jensen.list_files.return_value = {"status": "ok"}

        result = await self.adapter.get_recordings()

        assert result == []

    @pytest.mark.asyncio
    async def test_get_current_recording_during_streaming(self):
        """Test get_current_recording_filename during streaming (line 300)."""
        self.mock_jensen.is_connected.return_value = True
        # Mock streaming is in progress
        self.mock_jensen.is_file_list_streaming = Mock(return_value=True)

        result = await self.adapter.get_current_recording_filename()

        # Should return None during streaming to avoid collisions
        assert result is None
        # Should not call get_recording_file during streaming
        self.mock_jensen.get_recording_file.assert_not_called()

    @pytest.mark.asyncio
    async def test_get_current_recording_no_name(self):
        """Test get_current_recording_filename when no recording name (line 305)."""
        self.mock_jensen.is_connected.return_value = True
        self.mock_jensen.is_file_list_streaming = Mock(return_value=False)
        # Return recording info without name
        self.mock_jensen.get_recording_file.return_value = {"status": "ok"}

        result = await self.adapter.get_current_recording_filename()

        assert result is None

    @pytest.mark.asyncio
    async def test_get_current_recording_exception_handling(self):
        """Test get_current_recording_filename exception handling (lines 310-316)."""
        self.mock_jensen.is_connected.return_value = True
        self.mock_jensen.is_file_list_streaming = Mock(return_value=False)
        # Raise exception during get_recording_file
        self.mock_jensen.get_recording_file.side_effect = Exception("Communication error")

        result = await self.adapter.get_current_recording_filename()

        # Should return None on error to avoid crashing polling loop
        assert result is None


class TestDownloadRecordingEdgeCases:
    """Test download recording edge cases and error handling (lines 350-351, 364-365, 368-378, 390)."""

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
    async def test_download_recording_not_found_fallback(self):
        """Test download when recording not found in fallback (lines 350-351)."""
        progress_callback = Mock()
        self.mock_jensen.is_connected.return_value = True

        # Mock get_recordings to return empty list
        with patch.object(self.adapter, "get_recordings", return_value=[]):
            with pytest.raises(FileNotFoundError) as exc_info:
                await self.adapter.download_recording("nonexistent.hta", "/tmp/output.wav", progress_callback)

            assert "Recording nonexistent.hta not found" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_download_recording_with_progress_callbacks(self):
        """Test download with progress callback handling (lines 364-365, 368-378)."""
        progress_callback = Mock()
        self.mock_jensen.is_connected.return_value = True
        self.mock_jensen.stream_file.return_value = "OK"

        file_data = b"test audio data"
        bytes_written = 0

        def mock_stream_file(filename, file_length, data_callback, progress_callback, timeout_s):
            # Simulate data callback being called
            data_callback(file_data)
            # Simulate progress callback being called
            progress_callback(len(file_data), file_length)
            return "OK"

        self.mock_jensen.stream_file.side_effect = mock_stream_file

        with patch("builtins.open", mock_open()) as mock_file:
            await self.adapter.download_recording("test.hta", "/tmp/output.wav", progress_callback, file_size=1024)

            # Verify progress callback was called
            assert progress_callback.call_count >= 2  # At least progress update + final

            # Check that progress updates have correct structure
            progress_calls = progress_callback.call_args_list

            # Check progress update call
            progress_args = progress_calls[0][0][0]
            assert isinstance(progress_args, OperationProgress)
            assert progress_args.operation_id == "download_test.hta"
            assert progress_args.status == OperationStatus.IN_PROGRESS

            # Check final completion call
            final_args = progress_calls[-1][0][0]
            assert isinstance(final_args, OperationProgress)
            assert final_args.status == OperationStatus.COMPLETED
            assert final_args.progress == 1.0

    @pytest.mark.asyncio
    async def test_download_recording_stream_failure(self):
        """Test download when stream_file fails (line 390)."""
        progress_callback = Mock()
        self.mock_jensen.is_connected.return_value = True
        # Stream operation fails
        self.mock_jensen.stream_file.return_value = "ERROR: Transfer failed"

        with patch("builtins.open", mock_open()):
            with pytest.raises(RuntimeError) as exc_info:
                await self.adapter.download_recording("test.hta", "/tmp/output.wav", progress_callback, file_size=1024)

            assert "Download failed: ERROR: Transfer failed" in str(exc_info.value)

            # Should call error progress callback
            error_calls = [
                call for call in progress_callback.call_args_list if call[0][0].status == OperationStatus.ERROR
            ]
            assert len(error_calls) > 0


class TestDeleteRecordingEdgeCases:
    """Test delete recording edge cases (lines 433, 449, 461-473)."""

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
    async def test_delete_recording_not_found(self):
        """Test delete when recording not found (line 433)."""
        progress_callback = Mock()
        self.mock_jensen.is_connected.return_value = True

        # Mock get_recordings to return empty list
        with patch.object(self.adapter, "get_recordings", return_value=[]):
            with pytest.raises(FileNotFoundError) as exc_info:
                await self.adapter.delete_recording("nonexistent.hta", progress_callback)

            assert "Recording nonexistent.hta not found" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_delete_recording_device_error(self):
        """Test delete when device returns error (line 449)."""
        progress_callback = Mock()

        class MockRecording:
            def __init__(self, id_val, filename):
                self.id = id_val
                self.filename = filename

        mock_recording = MockRecording("test.hta", "test.hta")

        self.mock_jensen.is_connected.return_value = True
        # Device returns failure result
        self.mock_jensen.delete_file.return_value = {"result": "file_locked"}

        with patch.object(self.adapter, "get_recordings", return_value=[mock_recording]):
            with pytest.raises(RuntimeError) as exc_info:
                await self.adapter.delete_recording("test.hta", progress_callback)

            assert "Delete failed: file_locked" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_delete_recording_exception_handling(self):
        """Test delete recording exception handling (lines 461-473)."""
        progress_callback = Mock()
        self.mock_jensen.is_connected.return_value = True

        # Mock get_recordings to raise exception
        with patch.object(self.adapter, "get_recordings", side_effect=Exception("Communication error")):
            with pytest.raises(Exception) as exc_info:
                await self.adapter.delete_recording("test.hta", progress_callback)

            assert "Communication error" in str(exc_info.value)

            # Should call error progress callback
            error_calls = [
                call for call in progress_callback.call_args_list if call[0][0].status == OperationStatus.ERROR
            ]
            assert len(error_calls) > 0


class TestFormatStorageEdgeCases:
    """Test format storage edge cases (lines 494, 506-518)."""

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
    async def test_format_storage_device_error(self):
        """Test format storage when device returns error (line 494)."""
        progress_callback = Mock()
        self.mock_jensen.is_connected.return_value = True
        # Device returns failure result
        self.mock_jensen.format_card.return_value = {"result": "format_failed"}

        with pytest.raises(RuntimeError) as exc_info:
            await self.adapter.format_storage(progress_callback)

        assert "Format failed: format_failed" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_format_storage_exception_handling(self):
        """Test format storage exception handling (lines 506-518)."""
        progress_callback = Mock()
        self.mock_jensen.is_connected.return_value = True
        # Device raises exception
        self.mock_jensen.format_card.side_effect = Exception("Hardware error")

        with pytest.raises(Exception) as exc_info:
            await self.adapter.format_storage(progress_callback)

        assert "Hardware error" in str(exc_info.value)

        # Should call error progress callback
        error_calls = [call for call in progress_callback.call_args_list if call[0][0].status == OperationStatus.ERROR]
        assert len(error_calls) > 0


class TestTimeSyncEdgeCases:
    """Test time synchronization edge cases (lines 530-534)."""

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
    async def test_sync_time_device_error(self):
        """Test time sync when device returns error (lines 530-534)."""
        self.mock_jensen.is_connected.return_value = True
        # Device returns failure result
        self.mock_jensen.set_device_time.return_value = {"result": "time_sync_failed", "error": "Clock locked"}

        with pytest.raises(RuntimeError) as exc_info:
            await self.adapter.sync_time()

        assert "Time sync failed: Clock locked" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_sync_time_no_error_message(self):
        """Test time sync with failure but no error message."""
        self.mock_jensen.is_connected.return_value = True
        # Device returns failure result without error message
        self.mock_jensen.set_device_time.return_value = {"result": "failed"}

        with pytest.raises(RuntimeError) as exc_info:
            await self.adapter.sync_time()

        assert "Time sync failed: unknown error" in str(exc_info.value)


class TestDeviceHealthEdgeCases:
    """Test device health edge cases (lines 582, 584)."""

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
    async def test_get_device_health_error_status(self):
        """Test device health with error status (line 582)."""
        mock_stats = {
            "retry_count": 0,
            "is_connected": True,
            "operation_stats": {
                "commands_sent": 10,
                "responses_received": 6,  # High error rate
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
        # Error rate > 0.1 should set status to "error"
        assert result.overall_status == "error"
        assert result.error_rate == 0.4  # 4 failed / 10 total

    @pytest.mark.asyncio
    async def test_get_device_health_warning_status(self):
        """Test device health with warning status (line 584)."""
        mock_stats = {
            "retry_count": 0,
            "is_connected": True,
            "operation_stats": {
                "commands_sent": 10,
                "responses_received": 9,  # Moderate error rate
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
        # Error rate > 0.05 should set status to "warning"
        assert result.overall_status == "warning"
        assert result.error_rate == 0.1  # 1 failed / 10 total


class TestConnectionTestingAndRecovery:
    """Test connection testing and recovery functionality (lines 608, 614-620, 627-628, 647-678)."""

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
    async def test_test_connection_not_connected(self):
        """Test connection test when not connected (line 608)."""
        self.mock_jensen.is_connected.return_value = False

        result = await self.adapter.test_connection()

        assert result is False
        # Should not call get_device_info when not connected
        self.mock_jensen.get_device_info.assert_not_called()

    @pytest.mark.asyncio
    async def test_test_connection_exception(self):
        """Test connection test with exception (lines 614-620)."""
        self.mock_jensen.is_connected.return_value = True
        # Raise exception during device info retrieval
        self.mock_jensen.get_device_info.side_effect = Exception("Timeout during test")

        result = await self.adapter.test_connection()

        assert result is False

    def test_reset_device_state_exception(self):
        """Test reset device state with exception (lines 627-628)."""
        # Mock reset to raise exception
        self.mock_jensen.reset_device_state.side_effect = Exception("Reset failed")

        # Should not raise exception, just log error
        self.adapter.reset_device_state()

        self.mock_jensen.reset_device_state.assert_called_once()


class TestDeviceSettings:
    """Test device settings functionality (lines 632-645)."""

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
    async def test_get_device_settings_not_connected(self):
        """Test get device settings when not connected (lines 632-633)."""
        self.mock_jensen.is_connected.return_value = False

        result = await self.adapter.get_device_settings()

        assert result is None

    @pytest.mark.asyncio
    async def test_get_device_settings_exception(self):
        """Test get device settings with exception (lines 639-645)."""
        self.mock_jensen.is_connected.return_value = True
        # Raise exception during settings retrieval
        self.mock_jensen.get_device_settings.side_effect = Exception("Settings read error")

        result = await self.adapter.get_device_settings()

        assert result is None


class TestErrorRecovery:
    """Test error recovery functionality (lines 647-678)."""

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
    async def test_recover_from_error_connection_restored(self):
        """Test error recovery when connection is restored (lines 657-661)."""
        self.mock_jensen.is_connected.return_value = True

        # Mock test_connection to succeed after reset
        with patch.object(self.adapter, "test_connection", return_value=True):
            result = await self.adapter.recover_from_error()

            assert result is True
            self.mock_jensen.reset_device_state.assert_called_once()

    @pytest.mark.asyncio
    async def test_recover_from_error_disconnect_and_reconnect(self):
        """Test error recovery with disconnect and reconnect (lines 664-673)."""
        # First is_connected check returns True, test_connection fails
        # Then need to disconnect and reconnect
        self.mock_jensen.is_connected.side_effect = [True, False]  # Connected, then disconnected

        with patch.object(self.adapter, "test_connection", return_value=False), patch.object(
            self.adapter, "disconnect"
        ), patch.object(self.adapter, "connect") as mock_connect:
            # Mock successful reconnect
            mock_device_info = DeviceInfo(
                id="recovered",
                name="HiDock H1E",
                model=DeviceModel.H1E,
                serial_number="RECOVER123",
                firmware_version="1.0.0",
                vendor_id=0x10D6,
                product_id=0xB00D,
                connected=True,
            )
            mock_connect.return_value = mock_device_info

            result = await self.adapter.recover_from_error()

            assert result is True
            mock_connect.assert_called_once_with(force_reset=True)

    @pytest.mark.asyncio
    async def test_recover_from_error_disconnect_exception_ignored(self):
        """Test error recovery ignores disconnect exceptions (lines 666-667)."""
        self.mock_jensen.is_connected.side_effect = [True, False]

        with patch.object(self.adapter, "test_connection", return_value=False), patch.object(
            self.adapter, "disconnect", side_effect=Exception("Disconnect error")
        ), patch.object(self.adapter, "connect") as mock_connect:
            mock_device_info = DeviceInfo(
                id="recovered",
                name="HiDock H1E",
                model=DeviceModel.H1E,
                serial_number="RECOVER123",
                firmware_version="1.0.0",
                vendor_id=0x10D6,
                product_id=0xB00D,
                connected=True,
            )
            mock_connect.return_value = mock_device_info

            result = await self.adapter.recover_from_error()

            # Should still succeed despite disconnect exception
            assert result is True

    @pytest.mark.asyncio
    async def test_recover_from_error_reconnect_fails(self):
        """Test error recovery when reconnect fails (line 674)."""
        self.mock_jensen.is_connected.side_effect = [True, False]

        with patch.object(self.adapter, "test_connection", return_value=False), patch.object(
            self.adapter, "disconnect"
        ), patch.object(self.adapter, "connect", return_value=None):
            result = await self.adapter.recover_from_error()

            assert result is False

    @pytest.mark.asyncio
    async def test_recover_from_error_exception_handling(self):
        """Test error recovery exception handling (lines 676-678)."""
        # Make reset_device_state raise exception
        self.mock_jensen.reset_device_state.side_effect = Exception("Critical hardware error")
        # Make is_connected return True but test_connection fail
        self.mock_jensen.is_connected.return_value = True

        with patch.object(self.adapter, "test_connection", return_value=False), patch.object(
            self.adapter, "disconnect"
        ), patch.object(self.adapter, "connect", side_effect=Exception("Connection failed")):
            result = await self.adapter.recover_from_error()

            assert result is False


class TestFactoryFunction:
    """Test factory function (line 692)."""

    def test_create_desktop_device_adapter(self):
        """Test factory function creates adapter correctly (line 692)."""
        with patch("desktop_device_adapter.DesktopDeviceAdapter") as mock_adapter:
            mock_backend = Mock()

            result = create_desktop_device_adapter(mock_backend)

            mock_adapter.assert_called_once_with(mock_backend)
            assert result == mock_adapter.return_value

    def test_create_desktop_device_adapter_no_backend(self):
        """Test factory function with no backend."""
        with patch("desktop_device_adapter.DesktopDeviceAdapter") as mock_adapter:
            result = create_desktop_device_adapter()

            mock_adapter.assert_called_once_with(None)
            assert result == mock_adapter.return_value


class TestDisconnectExceptionHandling:
    """Test disconnect exception handling."""

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
    async def test_disconnect_exception(self):
        """Test disconnect with exception handling."""
        # Set up connected state
        self.adapter._current_device_info = Mock()
        self.adapter._connection_start_time = datetime.now()

        # Mock disconnect to raise exception
        self.mock_jensen.disconnect.side_effect = Exception("Disconnect failed")

        with pytest.raises(RuntimeError) as exc_info:
            await self.adapter.disconnect()

        assert "Failed to disconnect: Disconnect failed" in str(exc_info.value)


class TestGetDeviceInfoNotConnected:
    """Test get_device_info when not connected."""

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
    async def test_get_device_info_not_connected(self):
        """Test get_device_info when not connected."""
        self.mock_jensen.is_connected.return_value = False

        with pytest.raises(ConnectionError):
            await self.adapter.get_device_info()


# Additional edge case tests for complete coverage
class TestAdditionalEdgeCases:
    """Additional edge case tests for remaining coverage gaps."""

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
    async def test_operations_not_connected_errors(self):
        """Test various operations when not connected."""
        self.mock_jensen.is_connected.return_value = False

        # Test all operations that should raise ConnectionError when not connected
        operations = [
            ("get_storage_info", []),
            ("get_recordings", []),
            ("get_current_recording_filename", []),
            ("download_recording", ["test.hta", "/tmp/out.wav"]),
            ("delete_recording", ["test.hta"]),
            ("format_storage", []),
            ("sync_time", []),
            ("get_device_health", []),
        ]

        for operation_name, args in operations:
            operation = getattr(self.adapter, operation_name)
            with pytest.raises(ConnectionError):
                await operation(*args)

    @pytest.mark.asyncio
    async def test_get_capabilities_not_connected(self):
        """Test get_capabilities when not connected."""
        self.mock_jensen.is_connected.return_value = False
        self.adapter._current_device_info = None

        result = self.adapter.get_capabilities()

        assert result == []

    def test_get_capabilities_no_current_device_info(self):
        """Test get_capabilities when no current device info."""
        self.mock_jensen.is_connected.return_value = True
        self.adapter._current_device_info = None

        result = self.adapter.get_capabilities()

        assert result == []
