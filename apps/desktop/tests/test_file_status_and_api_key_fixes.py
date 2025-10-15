#!/usr/bin/env python3
"""
Test cases for file status and API key encryption fixes.

This module tests the specific fixes implemented for:
1. File status not updating correctly after downloads
2. API key decryption failures
"""

import os
import tempfile
import unittest
from unittest.mock import Mock, patch, MagicMock
import pytest

from gui_actions_file import FileActionsMixin
from file_operations_manager import FileOperationStatus, FileOperationType


class TestFileStatusFixes(unittest.TestCase):
    """Test cases for file status update fixes."""

    def setUp(self):
        """Set up test fixtures."""
        self.mock_gui = Mock()
        self.mock_gui.displayed_files_details = [
            {"name": "test_file.hda", "local_path": None, "gui_status": "On Device"}
        ]
        self.mock_gui.file_operations_manager = Mock()
        self.mock_gui.file_operations_manager.metadata_cache = Mock()
        
        # Mock cached metadata
        self.mock_metadata = Mock()
        self.mock_metadata.local_path = None
        self.mock_gui.file_operations_manager.metadata_cache.get_metadata.return_value = self.mock_metadata
        
        # Mock the _get_local_filepath method
        self.mock_gui._get_local_filepath = Mock(return_value="/path/to/test_file.hda")
        self.mock_gui._update_file_status_in_treeview = Mock()

    def test_refresh_single_file_status_downloaded(self):
        """Test that _refresh_single_file_status correctly updates status for downloaded files."""
        # Create a test instance
        class TestGUI(FileActionsMixin):
            def __init__(self, mock_gui):
                self.displayed_files_details = mock_gui.displayed_files_details
                self.file_operations_manager = mock_gui.file_operations_manager
                self._get_local_filepath = mock_gui._get_local_filepath
                self._update_file_status_in_treeview = mock_gui._update_file_status_in_treeview
        
        test_gui = TestGUI(self.mock_gui)
        
        # Test when file exists locally
        with patch('os.path.exists', return_value=True):
            test_gui._refresh_single_file_status("test_file.hda")
        
        # Verify that the metadata was updated
        assert self.mock_metadata.local_path == "/path/to/test_file.hda"
        self.mock_gui.file_operations_manager.metadata_cache.set_metadata.assert_called_once()
        
        # Verify that the GUI status was updated
        assert test_gui.displayed_files_details[0]["gui_status"] == "Downloaded"
        self.mock_gui._update_file_status_in_treeview.assert_called_with("test_file.hda", "Downloaded", ("downloaded_ok",))

    def test_refresh_single_file_status_on_device(self):
        """Test that _refresh_single_file_status correctly updates status for files not downloaded."""
        # Set up metadata that has a local_path initially (so there will be a change)
        self.mock_metadata.local_path = "/some/old/path"
        
        # Create a test instance
        class TestGUI(FileActionsMixin):
            def __init__(self, mock_gui):
                self.displayed_files_details = mock_gui.displayed_files_details
                self.file_operations_manager = mock_gui.file_operations_manager
                self._get_local_filepath = mock_gui._get_local_filepath
                self._update_file_status_in_treeview = mock_gui._update_file_status_in_treeview
        
        test_gui = TestGUI(self.mock_gui)
        
        # Test when file doesn't exist locally
        with patch('os.path.exists', return_value=False):
            test_gui._refresh_single_file_status("test_file.hda")
        
        # Verify that the metadata was updated to None
        assert self.mock_metadata.local_path is None
        self.mock_gui.file_operations_manager.metadata_cache.set_metadata.assert_called_once()
        
        # Verify that the GUI status was updated
        assert test_gui.displayed_files_details[0]["gui_status"] == "On Device"
        self.mock_gui._update_file_status_in_treeview.assert_called_with("test_file.hda", "On Device", ())

    def test_download_completion_updates_status(self):
        """Test that download completion properly updates file status and metadata."""
        from file_operations_manager import FileOperation, FileOperationType, FileOperationStatus
        
        # Create a test instance
        class TestGUI(FileActionsMixin):
            def __init__(self, mock_gui):
                self.displayed_files_details = mock_gui.displayed_files_details
                self.file_operations_manager = mock_gui.file_operations_manager
                self._get_local_filepath = mock_gui._get_local_filepath
                self._update_file_status_in_treeview = mock_gui._update_file_status_in_treeview
                self._refresh_single_file_status = Mock()
                self.update_status_bar = Mock()
        
        test_gui = TestGUI(self.mock_gui)
        
        # Create a completed download operation
        operation = FileOperation(
            operation_id="test_op",
            operation_type=FileOperationType.DOWNLOAD,
            filename="test_file.hda",
            status=FileOperationStatus.COMPLETED
        )
        
        # Test the operation completion handler
        test_gui._perform_gui_update_for_operation(operation)
        
        # Verify that metadata cache was updated
        self.mock_gui.file_operations_manager.metadata_cache.set_metadata.assert_called_once()
        
        # Verify that displayed file details were updated
        assert test_gui.displayed_files_details[0]["local_path"] == "/path/to/test_file.hda"
        assert test_gui.displayed_files_details[0]["gui_status"] == "Downloaded"
        
        # Verify that treeview was updated
        self.mock_gui._update_file_status_in_treeview.assert_called_with("test_file.hda", "Downloaded", ("downloaded_ok",))
        
        # Verify that refresh was called
        test_gui._refresh_single_file_status.assert_called_once_with("test_file.hda")


class TestAPIKeyFixes(unittest.TestCase):
    """Test cases for API key encryption/decryption fixes."""

    def setUp(self):
        """Set up test fixtures."""
        # Mock the settings dialog components
        self.mock_parent = Mock()
        self.mock_parent.config = {"config_file_path": "/tmp/config.json"}
        
        self.mock_dialog = Mock()
        self.mock_dialog.parent_gui = self.mock_parent
        self.mock_dialog.local_vars = {"ai_api_provider_var": Mock()}
        self.mock_dialog.local_vars["ai_api_provider_var"].get.return_value = "gemini"

    def test_decrypt_api_key_invalid_base64(self):
        """Test that invalid base64 data is handled gracefully."""
        from settings_window import SettingsDialog
        
        # Create a settings dialog instance
        settings_dialog = SettingsDialog.__new__(SettingsDialog)
        settings_dialog.parent_gui = self.mock_parent
        settings_dialog.local_vars = self.mock_dialog.local_vars
        
        # Mock the encryption availability and update function
        with patch('settings_window.ENCRYPTION_AVAILABLE', True):
            with patch('settings_window.update_config_settings') as mock_update:
                # Test with invalid base64 data
                result = settings_dialog._decrypt_api_key("invalid_base64_data!")
                
                # Should return empty string
                assert result == ""
                
                # Should clear the corrupted key
                mock_update.assert_called_once_with({"ai_api_key_gemini_encrypted": ""})

    def test_decrypt_api_key_corrupted_encryption_key(self):
        """Test that corrupted encryption key file is handled gracefully."""
        from settings_window import SettingsDialog
        
        # Create a settings dialog instance
        settings_dialog = SettingsDialog.__new__(SettingsDialog)
        settings_dialog.parent_gui = self.mock_parent
        settings_dialog.local_vars = self.mock_dialog.local_vars
        
        # Mock the encryption components to simulate corruption
        with patch('settings_window.ENCRYPTION_AVAILABLE', True):
            with patch('settings_window.Fernet') as mock_fernet:
                with patch('base64.b64decode') as mock_b64decode:
                    with patch('os.path.exists', return_value=True):
                        with patch('os.remove') as mock_remove:
                            # Simulate decryption failure
                            mock_fernet.return_value.decrypt.side_effect = Exception("Decryption failed")
                            mock_b64decode.return_value = b"encrypted_data"
                            
                            # Test decryption with corrupted key
                            result = settings_dialog._decrypt_api_key("dGVzdF9lbmNyeXB0ZWRfZGF0YQ==")
                            
                            # Should return empty string
                            assert result == ""
                            
                            # Should attempt to remove corrupted key file
                            mock_remove.assert_called_once()

    def test_load_api_key_status_decryption_failure(self):
        """Test that API key status loading handles decryption failures gracefully."""
        from settings_window import SettingsDialog
        
        # Create a settings dialog instance
        settings_dialog = SettingsDialog.__new__(SettingsDialog)
        settings_dialog.parent_gui = self.mock_parent
        settings_dialog.local_vars = self.mock_dialog.local_vars
        
        # Mock UI components
        settings_dialog.api_key_entry = Mock()
        settings_dialog.api_key_status_label = Mock()
        
        # Mock config with encrypted key
        self.mock_parent.config = {
            "config_file_path": "/tmp/config.json",
            "ai_api_key_gemini_encrypted": "corrupted_key_data"
        }
        
        # Mock decryption to fail
        settings_dialog._decrypt_api_key = Mock(return_value="")
        
        # Test loading API key status
        settings_dialog._load_api_key_status()
        
        # Verify that entry was cleared
        settings_dialog.api_key_entry.delete.assert_called_with(0, "end")
        
        # Verify that status shows decryption failure message
        settings_dialog.api_key_status_label.configure.assert_called_with(
            text="Status: Decryption failed - please re-enter your API key",
            text_color="red"
        )



if __name__ == "__main__":
    unittest.main()