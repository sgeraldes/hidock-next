#!/usr/bin/env python3
"""
Test cases for GUI file operations functionality.

This module tests file operations that are triggered from the GUI:
- Opening files locally
- Deleting files from device vs local copies
- File operation confirmations and error handling
"""

import importlib
import os
import sys
import unittest
from contextlib import contextmanager
from unittest.mock import Mock, patch

import pytest


@contextmanager
def mock_all_messageboxes():
    """Context manager to mock all messagebox calls to prevent tkinter issues in tests."""
    with patch("tkinter.messagebox.showinfo") as mock_info, patch(
        "tkinter.messagebox.showwarning"
    ) as mock_warning, patch("tkinter.messagebox.showerror") as mock_error, patch(
        "tkinter.messagebox.askyesno"
    ) as mock_askyesno, patch(
        "gui_actions_file.messagebox.showinfo"
    ) as mock_gui_info, patch(
        "gui_actions_file.messagebox.showwarning"
    ) as mock_gui_warning, patch(
        "gui_actions_file.messagebox.showerror"
    ) as mock_gui_error, patch(
        "gui_actions_file.messagebox.askyesno"
    ) as mock_gui_askyesno:
        mock_askyesno.return_value = True  # Default to confirming actions
        mock_gui_askyesno.return_value = True  # Default to confirming actions
        yield {
            "showinfo": mock_info,
            "showwarning": mock_warning,
            "showerror": mock_error,
            "askyesno": mock_askyesno,
            "gui_showinfo": mock_gui_info,
            "gui_showwarning": mock_gui_warning,
            "gui_showerror": mock_gui_error,
            "gui_askyesno": mock_gui_askyesno,
        }


class TestOpenFileLocally(unittest.TestCase):
    """Test cases for the open file locally functionality."""

    def setUp(self):
        """Set up test fixtures."""
        self.mock_gui = Mock()
        self.mock_gui._get_local_filepath = Mock()

    def tearDown(self):
        """Clean up after each test."""
        if hasattr(self, "mock_gui"):
            self.mock_gui.reset_mock()
        # Clear module cache to avoid state contamination
        if "gui_actions_file" in sys.modules:
            importlib.reload(sys.modules["gui_actions_file"])

    def test_open_file_locally_success(self):
        """Test that _open_file_locally successfully opens existing files."""
        # Import fresh to avoid module state contamination
        from gui_actions_file import FileActionsMixin

        # Create isolated test instance
        class IsolatedTestGUI(FileActionsMixin):
            def __init__(self):
                self._get_local_filepath = Mock(return_value="/path/to/test_file.wav")

        test_gui = IsolatedTestGUI()

        # Mock file exists and os.startfile
        with patch("os.path.exists", return_value=True), patch("sys.platform", "win32"), patch(
            "os.startfile"
        ) as mock_startfile:
            test_gui._open_file_locally("test_file.wav")
            mock_startfile.assert_called_once_with("/path/to/test_file.wav")

    def test_open_file_locally_file_not_found(self):
        """Test that _open_file_locally handles missing files gracefully."""
        from tkinter import messagebox

        from gui_actions_file import FileActionsMixin

        # Create isolated test instance
        class IsolatedTestGUI(FileActionsMixin):
            def __init__(self):
                self._get_local_filepath = Mock(return_value="/path/to/missing_file.wav")

        test_gui = IsolatedTestGUI()

        # Mock file doesn't exist
        with patch("os.path.exists", return_value=False), patch.object(messagebox, "showerror") as mock_error:
            test_gui._open_file_locally("missing_file.wav")

            mock_error.assert_called_once()
            args = mock_error.call_args[0]
            assert "File Not Found" in args[0]
            assert "/path/to/missing_file.wav" in args[1]

    def test_open_file_locally_cross_platform(self):
        """Test that _open_file_locally works on different platforms."""
        from gui_actions_file import FileActionsMixin

        # Create isolated test instance
        class IsolatedTestGUI(FileActionsMixin):
            def __init__(self):
                self._get_local_filepath = Mock(return_value="/path/to/test_file.wav")

        test_gui = IsolatedTestGUI()

        # Test macOS
        with patch("os.path.exists", return_value=True), patch("sys.platform", "darwin"), patch(
            "subprocess.call"
        ) as mock_call:
            test_gui._open_file_locally("test_file.wav")
            mock_call.assert_called_once_with(["open", "/path/to/test_file.wav"])

        # Test Linux
        with patch("os.path.exists", return_value=True), patch("sys.platform", "linux"), patch(
            "subprocess.call"
        ) as mock_call:
            test_gui._open_file_locally("test_file.wav")
            mock_call.assert_called_once_with(["xdg-open", "/path/to/test_file.wav"])


class TestDeleteFunctionality(unittest.TestCase):
    """Test cases for the delete functionality."""

    def setUp(self):
        """Set up test fixtures."""
        # Create fresh mocks for each test
        self.mock_gui = Mock()
        self._setup_fresh_mocks()

    def _setup_fresh_mocks(self):
        """Setup fresh mock objects to avoid state contamination."""
        self.mock_gui._get_local_filepath = Mock()
        self.mock_gui.file_operations_manager = Mock()
        self.mock_gui.file_operations_manager.queue_batch_delete = Mock()
        self.mock_gui.file_operations_manager.metadata_cache = Mock()
        self.mock_gui._update_operation_progress = Mock()
        self.mock_gui._update_file_status_in_treeview = Mock()
        self.mock_gui.update_status_bar = Mock()
        self.mock_gui.displayed_files_details = []
        self.mock_gui.device_manager = Mock()
        self.mock_gui.device_manager.device_interface = Mock()
        self.mock_gui.device_manager.device_interface.is_connected = Mock()
        self.mock_gui.file_operations_manager.is_file_operation_active = Mock()

    def tearDown(self):
        """Clean up after each test."""
        if hasattr(self, "mock_gui"):
            self.mock_gui.reset_mock()
        # Clear module cache to avoid state contamination
        if "gui_actions_file" in sys.modules:
            importlib.reload(sys.modules["gui_actions_file"])

    def test_delete_from_device_with_confirmation(self):
        """Test that _delete_from_device asks for confirmation and calls batch delete."""
        from gui_actions_file import FileActionsMixin

        class IsolatedTestGUI(FileActionsMixin):
            def __init__(self):
                self.file_operations_manager = Mock()
                self.file_operations_manager.queue_batch_delete = Mock()
                self.file_operations_manager.is_file_operation_active = Mock(return_value=False)
                self._update_operation_progress = Mock()
                self.device_manager = Mock()
                self.device_manager.device_interface = Mock()
                self.device_manager.device_interface.is_connected = Mock(return_value=True)
                self.displayed_files_details = [
                    {"name": "test1.wav", "is_recording": False},
                    {"name": "test2.wav", "is_recording": False},
                ]
                # Add mock tkinter attributes to prevent AttributeError
                self.tk = Mock()
                self.winfo_toplevel = Mock(return_value=self)
                self._get_device_status_for_deletion = Mock(return_value="Connected")

        test_gui = IsolatedTestGUI()

        # Mock user confirms deletion - we need to use the gui_askyesno mock since that's what the code calls
        with mock_all_messageboxes() as mbox:
            mbox["gui_askyesno"].return_value = True
            test_gui._delete_from_device(["test1.wav", "test2.wav"])

            # Verify confirmation dialog was shown
            mbox["gui_askyesno"].assert_called_once()
            args = mbox["gui_askyesno"].call_args[0]
            assert "Delete from Device" in args[0]
            assert "2 file(s)" in args[1]
            assert "cannot be undone" in args[1]

            # Verify batch delete was called
            test_gui.file_operations_manager.queue_batch_delete.assert_called_once_with(
                ["test1.wav", "test2.wav"], test_gui._update_operation_progress
            )

    def test_delete_from_device_cancelled(self):
        """Test that _delete_from_device respects user cancellation."""
        from gui_actions_file import FileActionsMixin

        class IsolatedTestGUI(FileActionsMixin):
            def __init__(self):
                self.file_operations_manager = Mock()
                self.file_operations_manager.queue_batch_delete = Mock()
                self.file_operations_manager.is_file_operation_active = Mock(return_value=False)
                self._update_operation_progress = Mock()
                self.device_manager = Mock()
                self.device_manager.device_interface = Mock()
                self.device_manager.device_interface.is_connected = Mock(return_value=True)
                self.displayed_files_details = [{"name": "test1.wav", "is_recording": False}]
                # Add mock tkinter attributes to prevent AttributeError
                self.tk = Mock()
                self.winfo_toplevel = Mock(return_value=self)
                self._get_device_status_for_deletion = Mock(return_value="Connected")

        test_gui = IsolatedTestGUI()

        # Mock user cancels deletion
        with mock_all_messageboxes() as mbox:
            mbox["gui_askyesno"].return_value = False
            test_gui._delete_from_device(["test1.wav"])

            # Verify batch delete was NOT called
            test_gui.file_operations_manager.queue_batch_delete.assert_not_called()

    def test_delete_local_copy_success(self):
        """Test that _delete_local_copy successfully deletes local files."""
        from gui_actions_file import FileActionsMixin

        class IsolatedTestGUI(FileActionsMixin):
            def __init__(self):
                self._get_local_filepath = Mock(return_value="/path/to/test.wav")
                self.file_operations_manager = Mock()
                self._update_file_status_in_treeview = Mock()
                self.update_status_bar = Mock()
                self.displayed_files_details = [
                    {"name": "test.wav", "local_path": "/path/to/test.wav", "gui_status": "Downloaded"}
                ]
                self.offline_mode_manager = Mock()
                self.offline_mode_manager.is_offline_mode = False
                self.current_playing_filename_for_replay = None

        test_gui = IsolatedTestGUI()

        # Mock metadata
        mock_metadata = Mock()
        test_gui.file_operations_manager.metadata_cache.get_metadata.return_value = mock_metadata
        test_gui.file_operations_manager.is_file_operation_active.return_value = False

        # Mock file exists and user confirms
        with patch("os.path.exists", return_value=True), patch("os.chmod"), patch(
            "os.remove"
        ) as mock_remove, mock_all_messageboxes() as mbox, patch.object(
            test_gui, "_is_file_locked", return_value=False
        ), patch.object(
            test_gui, "_is_file_in_transcription", return_value=False
        ):

            test_gui._delete_local_copy(["test.wav"])

            # Verify file was removed
            mock_remove.assert_called_once_with("/path/to/test.wav")
            # Verify metadata was updated
            assert mock_metadata.local_path is None
            # Verify success message
            mbox["gui_showinfo"].assert_called_once()

    def test_delete_local_copy_no_files_exist(self):
        """Test that _delete_local_copy handles case where no local files exist."""
        from tkinter import messagebox

        from gui_actions_file import FileActionsMixin

        class IsolatedTestGUI(FileActionsMixin):
            def __init__(self):
                self._get_local_filepath = Mock(return_value="/path/to/missing.wav")
                self.file_operations_manager = Mock()
                self.file_operations_manager.is_file_operation_active.return_value = False

        test_gui = IsolatedTestGUI()

        with patch("os.path.exists", return_value=False), patch.object(messagebox, "showinfo") as mock_info:
            test_gui._delete_local_copy(["missing.wav"])

            mock_info.assert_called_once()
            args = mock_info.call_args[0]
            assert "No Local Files" in args[0]

    def test_delete_local_copy_error_handling(self):
        """Test that _delete_local_copy properly handles and displays errors."""
        from tkinter import messagebox

        from gui_actions_file import FileActionsMixin

        class IsolatedTestGUI(FileActionsMixin):
            def __init__(self):
                self._get_local_filepath = Mock(return_value="/path/to/locked_file.wav")
                self.file_operations_manager = Mock()
                self._update_file_status_in_treeview = Mock()
                self.update_status_bar = Mock()
                self.displayed_files_details = []

        test_gui = IsolatedTestGUI()

        # Mock file exists and user confirms
        with patch("os.path.exists", return_value=True), patch(
            "os.remove",
            side_effect=PermissionError(
                "[WinError 32] The process cannot access the file because it is being used by another process"
            ),
        ), patch.object(messagebox, "askyesno", return_value=True), patch.object(messagebox, "showerror"), patch.object(
            messagebox, "showwarning"
        ) as mock_warning:

            test_gui._delete_local_copy(["locked_file.wav"])

            # Verify warning message was shown for locked files
            mock_warning.assert_called_once()
            args = mock_warning.call_args[0]
            assert "Files Cannot Be Deleted" in args[0]

    def test_delete_local_copy_offline_status(self):
        """Test that offline mode shows 'On Device (Offline)' status after local deletion."""
        import tempfile

        from gui_actions_file import FileActionsMixin

        class IsolatedTestGUI(FileActionsMixin):
            def __init__(self, local_path):
                self._get_local_filepath = Mock(return_value=local_path)
                self.file_operations_manager = Mock()
                self._update_file_status_in_treeview = Mock()
                self.update_status_bar = Mock()
                self.displayed_files_details = [
                    {"name": "test_file.hda", "local_path": local_path, "gui_status": "Downloaded"}
                ]
                self.offline_mode_manager = Mock()
                self.offline_mode_manager.is_offline_mode = True
                self.current_playing_filename_for_replay = None
                self.download_directory = "/tmp"

        # Setup test file
        filename = "test_file.hda"
        with tempfile.NamedTemporaryFile(delete=False) as tmp_file:
            local_path = tmp_file.name
            tmp_file.write(b"test content")

        test_gui = IsolatedTestGUI(local_path)

        # Setup metadata cache mock
        mock_metadata = Mock()
        test_gui.file_operations_manager.metadata_cache.get_metadata.return_value = mock_metadata
        test_gui.file_operations_manager.is_file_operation_active.return_value = False

        # Mock messagebox to auto-confirm deletion
        with mock_all_messageboxes() as mbox, patch.object(
            test_gui, "_is_file_locked", return_value=False
        ), patch.object(test_gui, "_is_file_in_transcription", return_value=False):

            mbox["gui_askyesno"].return_value = True
            test_gui._delete_local_copy([filename])

        # Verify the file was deleted successfully
        self.assertFalse(os.path.exists(local_path), "File should have been deleted")

        # Cleanup
        try:
            os.unlink(local_path)
        except:
            pass

    def test_delete_local_copy_online_status(self):
        """Test that online mode shows 'On Device' status after local deletion."""
        import tempfile

        from gui_actions_file import FileActionsMixin

        class IsolatedTestGUI(FileActionsMixin):
            def __init__(self, local_path):
                self._get_local_filepath = Mock(return_value=local_path)
                self.file_operations_manager = Mock()
                self._update_file_status_in_treeview = Mock()
                self.update_status_bar = Mock()
                self.displayed_files_details = [
                    {"name": "test_file.hda", "local_path": local_path, "gui_status": "Downloaded"}
                ]
                self.offline_mode_manager = Mock()
                self.offline_mode_manager.is_offline_mode = False
                self.current_playing_filename_for_replay = None
                self.download_directory = "/tmp"

        # Setup test file
        filename = "test_file.hda"
        with tempfile.NamedTemporaryFile(delete=False) as tmp_file:
            local_path = tmp_file.name
            tmp_file.write(b"test content")

        test_gui = IsolatedTestGUI(local_path)

        # Setup metadata cache mock
        mock_metadata = Mock()
        test_gui.file_operations_manager.metadata_cache.get_metadata.return_value = mock_metadata
        test_gui.file_operations_manager.is_file_operation_active.return_value = False

        # Mock messagebox to auto-confirm deletion
        with mock_all_messageboxes() as mbox, patch.object(
            test_gui, "_is_file_locked", return_value=False
        ), patch.object(test_gui, "_is_file_in_transcription", return_value=False):

            mbox["askyesno"].return_value = True
            test_gui._delete_local_copy([filename])

        # Verify the file was deleted successfully
        self.assertFalse(os.path.exists(local_path), "File should have been deleted")

        # Cleanup
        try:
            os.unlink(local_path)
        except:
            pass

    def test_delete_local_copy_stops_playback(self):
        """Test that deleting a currently playing file stops playback first."""
        import tempfile

        from gui_actions_file import FileActionsMixin

        class IsolatedTestGUI(FileActionsMixin):
            def __init__(self, local_path):
                self._get_local_filepath = Mock(return_value=local_path)
                self.file_operations_manager = Mock()
                self._update_file_status_in_treeview = Mock()
                self.update_status_bar = Mock()
                self.displayed_files_details = [
                    {"name": "playing_file.hda", "local_path": local_path, "gui_status": "Downloaded"}
                ]
                self.offline_mode_manager = Mock()
                self.offline_mode_manager.is_offline_mode = False
                self.current_playing_filename_for_replay = "playing_file.hda"
                self.stop_audio_playback_gui = Mock()

        # Setup test file
        filename = "playing_file.hda"
        with tempfile.NamedTemporaryFile(delete=False) as tmp_file:
            local_path = tmp_file.name
            tmp_file.write(b"test content")

        test_gui = IsolatedTestGUI(local_path)

        # Setup metadata cache mock
        mock_metadata = Mock()
        test_gui.file_operations_manager.metadata_cache.get_metadata.return_value = mock_metadata

        # Mock messagebox to auto-confirm deletion
        with patch("os.path.exists", return_value=True), patch("os.remove"), mock_all_messageboxes() as mbox:

            mbox["askyesno"].return_value = True
            test_gui._delete_local_copy([filename])

        # Verify that stop_audio_playback_gui was called
        test_gui.stop_audio_playback_gui.assert_called_once()

        # Cleanup
        try:
            os.unlink(local_path)
        except:
            pass

    def test_delete_readonly_file(self):
        """Test that read-only files can be deleted."""
        import stat
        import tempfile

        from gui_actions_file import FileActionsMixin

        class IsolatedTestGUI(FileActionsMixin):
            def __init__(self, local_path):
                self._get_local_filepath = Mock(return_value=local_path)
                self.file_operations_manager = Mock()
                self._update_file_status_in_treeview = Mock()
                self.update_status_bar = Mock()
                self.displayed_files_details = [
                    {"name": "readonly_file.hda", "local_path": local_path, "gui_status": "Downloaded"}
                ]
                self.offline_mode_manager = Mock()
                self.offline_mode_manager.is_offline_mode = False
                self.current_playing_filename_for_replay = None

        # Setup test file and make it read-only
        filename = "readonly_file.hda"
        with tempfile.NamedTemporaryFile(delete=False) as tmp_file:
            local_path = tmp_file.name
            tmp_file.write(b"test content")

        # Make file read-only
        os.chmod(local_path, stat.S_IREAD)

        test_gui = IsolatedTestGUI(local_path)

        # Setup metadata cache mock
        mock_metadata = Mock()
        test_gui.file_operations_manager.metadata_cache.get_metadata.return_value = mock_metadata
        test_gui.file_operations_manager.is_file_operation_active.return_value = False

        # Mock messagebox to auto-confirm deletion
        with mock_all_messageboxes() as mbox, patch.object(
            test_gui, "_is_file_locked", return_value=False
        ), patch.object(test_gui, "_is_file_in_transcription", return_value=False):

            mbox["askyesno"].return_value = True
            test_gui._delete_local_copy([filename])

        # Verify file was deleted despite being read-only
        self.assertFalse(os.path.exists(local_path))

    def test_comprehensive_file_handle_release(self):
        """Test that all possible file handle sources are properly released before deletion."""
        import tempfile

        from gui_actions_file import FileActionsMixin

        class IsolatedTestGUI(FileActionsMixin):
            def __init__(self, local_path):
                self._get_local_filepath = Mock(return_value=local_path)
                self.file_operations_manager = Mock()
                self._update_file_status_in_treeview = Mock()
                self.update_status_bar = Mock()
                self.displayed_files_details = [
                    {"name": "test_file.hda", "local_path": local_path, "gui_status": "Downloaded"}
                ]
                self.offline_mode_manager = Mock()
                self.offline_mode_manager.is_offline_mode = False
                self.current_playing_filename_for_replay = "test_file.hda"  # Same file to trigger handle release
                self.stop_audio_playback_gui = Mock()
                self.audio_visualization_widget = Mock()
                self.is_long_operation_active = True
                self._cancel_transcription = Mock()

        # Setup test file
        filename = "test_file.hda"
        with tempfile.NamedTemporaryFile(delete=False) as tmp_file:
            local_path = tmp_file.name
            tmp_file.write(b"test content")

        test_gui = IsolatedTestGUI(local_path)

        # Setup metadata cache mock
        mock_metadata = Mock()
        test_gui.file_operations_manager.metadata_cache.get_metadata.return_value = mock_metadata
        test_gui.file_operations_manager.is_file_operation_active.return_value = False

        # Mock messagebox to auto-confirm deletion
        with patch("os.path.exists", return_value=True), patch("os.chmod"), patch(
            "os.remove"
        ), mock_all_messageboxes() as mbox, patch.object(test_gui, "_is_file_locked", return_value=False), patch.object(
            test_gui, "_is_file_in_transcription", return_value=False
        ):

            mbox["askyesno"].return_value = True
            test_gui._delete_local_copy([filename])

        # Verify all handle release methods were called
        self.assertTrue(test_gui.stop_audio_playback_gui.called)
        test_gui.audio_visualization_widget.clear.assert_called_once()
        test_gui.audio_visualization_widget.stop_spectrum_analysis.assert_called_once()

        # Cleanup
        try:
            os.unlink(local_path)
        except:
            pass

    def test_file_lock_detection_comprehensive(self):
        """Test comprehensive file lock detection including edge cases."""
        import stat
        import tempfile

        from gui_actions_file import FileActionsMixin

        class TestGUI(FileActionsMixin):
            def __init__(self):
                pass

        test_gui = TestGUI()

        # Test 1: Non-existent file
        non_existent = "/path/that/does/not/exist.hda"
        self.assertFalse(test_gui._is_file_locked(non_existent))

        # Test 2: Normal file (not locked)
        with tempfile.NamedTemporaryFile(delete=False) as tmp_file:
            tmp_file.write(b"test content")
            tmp_path = tmp_file.name

        self.assertFalse(test_gui._is_file_locked(tmp_path))

        # Test 3: File with exclusive lock (simulate)
        with patch("builtins.open", side_effect=PermissionError("File is locked")):
            self.assertTrue(test_gui._is_file_locked(tmp_path))

        # Cleanup
        try:
            os.unlink(tmp_path)
        except:
            pass

    def test_deletion_with_multiple_file_handle_sources(self):
        """Test deletion when multiple sources might hold file handles."""
        import tempfile

        from gui_actions_file import FileActionsMixin

        class IsolatedTestGUI(FileActionsMixin):
            def __init__(self, temp_files):
                def mock_get_local_filepath(filename):
                    filenames = ["multi_handle_file.hda", "another_file.hda", "third_file.hda"]
                    index = filenames.index(filename)
                    return temp_files[index]

                self._get_local_filepath = mock_get_local_filepath
                self.file_operations_manager = Mock()
                self._update_file_status_in_treeview = Mock()
                self.update_status_bar = Mock()
                self.displayed_files_details = [
                    {"name": filename, "local_path": temp_files[i], "gui_status": "Downloaded"}
                    for i, filename in enumerate(["multi_handle_file.hda", "another_file.hda", "third_file.hda"])
                ]
                self.offline_mode_manager = Mock()
                self.offline_mode_manager.is_offline_mode = False
                self.current_playing_filename_for_replay = "multi_handle_file.hda"
                self.stop_audio_playback_gui = Mock()
                self.audio_visualization_widget = Mock()
                self.is_long_operation_active = True

        # Create multiple test files
        filenames = ["multi_handle_file.hda", "another_file.hda", "third_file.hda"]
        temp_files = []

        for filename in filenames:
            with tempfile.NamedTemporaryFile(delete=False) as tmp_file:
                tmp_file.write(b"test content")
                temp_files.append(tmp_file.name)

        test_gui = IsolatedTestGUI(temp_files)

        # Setup metadata cache mock
        mock_metadata = Mock()
        test_gui.file_operations_manager.metadata_cache.get_metadata.return_value = mock_metadata
        test_gui.file_operations_manager.is_file_operation_active.return_value = False

        # Mock messagebox to auto-confirm deletion
        with patch("os.path.exists", return_value=True), patch("os.chmod"), patch(
            "os.remove"
        ), mock_all_messageboxes() as mbox, patch.object(test_gui, "_is_file_locked", return_value=False), patch.object(
            test_gui, "_is_file_in_transcription", return_value=False
        ):

            mbox["askyesno"].return_value = True
            test_gui._delete_local_copy(filenames)

        # Verify handle release was called
        self.assertTrue(test_gui.stop_audio_playback_gui.called)
        test_gui.audio_visualization_widget.clear.assert_called_once()
        test_gui.audio_visualization_widget.stop_spectrum_analysis.assert_called_once()

        # Cleanup
        for temp_file in temp_files:
            try:
                os.unlink(temp_file)
            except:
                pass

    def test_deletion_error_recovery_with_partial_success(self):
        """Test deletion error recovery when some files succeed and others fail."""
        import tempfile
        from tkinter import messagebox

        from gui_actions_file import FileActionsMixin

        class IsolatedTestGUI(FileActionsMixin):
            def __init__(self, temp_files):
                def mock_get_local_filepath(filename):
                    filenames = ["success.hda", "fail.hda"]
                    index = filenames.index(filename)
                    return temp_files[index]

                self._get_local_filepath = mock_get_local_filepath
                self.file_operations_manager = Mock()
                self._update_file_status_in_treeview = Mock()
                self.update_status_bar = Mock()
                self.displayed_files_details = [
                    {"name": filename, "local_path": temp_files[i], "gui_status": "Downloaded"}
                    for i, filename in enumerate(["success.hda", "fail.hda"])
                ]
                self.offline_mode_manager = Mock()
                self.offline_mode_manager.is_offline_mode = False
                self.current_playing_filename_for_replay = None
                self.stop_audio_playback_gui = Mock()
                self.audio_visualization_widget = Mock()
                self.is_long_operation_active = False

        # Create test files - some will succeed, some will fail
        success_file = tempfile.NamedTemporaryFile(delete=False)
        success_file.write(b"success content")
        success_file.close()

        fail_file = tempfile.NamedTemporaryFile(delete=False)
        fail_file.write(b"fail content")
        fail_file.close()

        filenames = ["success.hda", "fail.hda"]
        temp_files = [success_file.name, fail_file.name]

        test_gui = IsolatedTestGUI(temp_files)

        # Setup metadata cache mock
        mock_metadata = Mock()
        test_gui.file_operations_manager.metadata_cache.get_metadata.return_value = mock_metadata
        test_gui.file_operations_manager.is_file_operation_active.return_value = False

        # Mock os.remove to fail for the fail file
        original_remove = os.remove

        def mock_remove(path):
            if path == fail_file.name:
                raise PermissionError("Access denied for testing")
            else:
                return original_remove(path)

        # Mock messagebox to auto-confirm deletion
        with patch.object(messagebox, "askyesno", return_value=True), patch.object(
            messagebox, "showwarning"
        ) as mock_warning, patch("os.remove", side_effect=mock_remove), patch.object(
            test_gui, "_is_file_locked", return_value=False
        ):

            test_gui._delete_local_copy(filenames)

            # Verify partial success warning was shown
            mock_warning.assert_called_once()
            warning_args = mock_warning.call_args[0]
            self.assertEqual(warning_args[0], "Partial Success")
            self.assertIn("Successfully deleted 1 file(s)", warning_args[1])
            self.assertIn("Failed to delete 1 file(s)", warning_args[1])

        # Verify success file was deleted
        self.assertFalse(os.path.exists(success_file.name))

        # Cleanup fail file
        try:
            os.unlink(fail_file.name)
        except OSError:
            pass


if __name__ == "__main__":
    unittest.main()
