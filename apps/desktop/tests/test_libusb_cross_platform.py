"""
Test cross-platform libusb initialization functionality.

This test verifies that the libusb backend initialization works correctly
across different operating systems (Windows, macOS, Linux) with proper
path detection and fallback mechanisms.
"""

import os
import platform
import unittest
from unittest.mock import Mock, patch, MagicMock

import pytest

from gui_actions_device import DeviceActionsMixin


class TestLibusbCrossPlatform(unittest.TestCase):
    """Test cross-platform libusb initialization."""

    def setUp(self):
        """Set up test fixtures."""
        self.mixin = DeviceActionsMixin()

    @patch('platform.system')
    @patch('os.path.exists')
    @patch('usb.backend.libusb1.get_backend')
    def test_macos_apple_silicon_path(self, mock_get_backend, mock_exists, mock_system):
        """Test macOS Apple Silicon Homebrew path detection."""
        mock_system.return_value = "Darwin"
        mock_backend = Mock()
        mock_get_backend.return_value = mock_backend
        
        # Simulate Apple Silicon Homebrew path exists
        def exists_side_effect(path):
            return path == "/opt/homebrew/lib/libusb-1.0.dylib"
        mock_exists.side_effect = exists_side_effect
        
        success, error, backend = self.mixin._initialize_backend_early()
        
        self.assertTrue(success)
        self.assertIsNone(error)
        self.assertEqual(backend, mock_backend)
        mock_get_backend.assert_called_once()

    @patch('platform.system')
    @patch('os.path.exists')
    @patch('usb.backend.libusb1.get_backend')
    def test_macos_intel_path(self, mock_get_backend, mock_exists, mock_system):
        """Test macOS Intel Homebrew path detection."""
        mock_system.return_value = "Darwin"
        mock_backend = Mock()
        mock_get_backend.return_value = mock_backend
        
        # Simulate Intel Mac Homebrew path exists (Apple Silicon path doesn't)
        def exists_side_effect(path):
            return path == "/usr/local/lib/libusb-1.0.dylib"
        mock_exists.side_effect = exists_side_effect
        
        success, error, backend = self.mixin._initialize_backend_early()
        
        self.assertTrue(success)
        self.assertIsNone(error)
        self.assertEqual(backend, mock_backend)

    @patch('platform.system')
    @patch('os.path.exists')
    @patch('usb.backend.libusb1.get_backend')
    def test_linux_ubuntu_path(self, mock_get_backend, mock_exists, mock_system):
        """Test Linux Ubuntu/Debian path detection."""
        mock_system.return_value = "Linux"
        mock_backend = Mock()
        mock_get_backend.return_value = mock_backend
        
        # Simulate Ubuntu x64 path exists
        def exists_side_effect(path):
            return path == "/usr/lib/x86_64-linux-gnu/libusb-1.0.so"
        mock_exists.side_effect = exists_side_effect
        
        success, error, backend = self.mixin._initialize_backend_early()
        
        self.assertTrue(success)
        self.assertIsNone(error)
        self.assertEqual(backend, mock_backend)

    @patch('platform.system')
    @patch('os.path.exists')
    @patch('os.path.dirname')
    @patch('os.path.abspath')
    @patch('usb.backend.libusb1.get_backend')
    def test_windows_local_dll(self, mock_get_backend, mock_abspath, mock_dirname, mock_exists, mock_system):
        """Test Windows local DLL path detection."""
        mock_system.return_value = "Windows"
        mock_backend = Mock()
        mock_get_backend.return_value = mock_backend
        mock_dirname.return_value = "/test/script/dir"
        mock_abspath.return_value = "/test/script/dir/file.py"
        
        # Simulate local DLL exists
        def exists_side_effect(path):
            return path == "/test/script/dir/libusb-1.0.dll"
        mock_exists.side_effect = exists_side_effect
        
        success, error, backend = self.mixin._initialize_backend_early()
        
        self.assertTrue(success)
        self.assertIsNone(error)
        self.assertEqual(backend, mock_backend)

    @patch('platform.system')
    @patch('os.path.exists')
    @patch('usb.backend.libusb1.get_backend')
    def test_fallback_to_system_paths(self, mock_get_backend, mock_exists, mock_system):
        """Test fallback to system paths when no specific paths are found."""
        mock_system.return_value = "Darwin"
        mock_backend = Mock()
        
        # Simulate no specific paths exist
        mock_exists.return_value = False
        
        # System paths call returns backend
        mock_get_backend.return_value = mock_backend
        
        success, error, backend = self.mixin._initialize_backend_early()
        
        self.assertTrue(success)
        self.assertIsNone(error)
        self.assertEqual(backend, mock_backend)
        # Should be called once for system paths
        self.assertEqual(mock_get_backend.call_count, 1)

    @patch('platform.system')
    @patch('os.path.exists')
    @patch('usb.backend.libusb1.get_backend')
    def test_complete_failure(self, mock_get_backend, mock_exists, mock_system):
        """Test complete failure when no backend can be initialized."""
        mock_system.return_value = "Linux"
        mock_get_backend.return_value = None  # Both calls fail
        mock_exists.return_value = False
        
        success, error, backend = self.mixin._initialize_backend_early()
        
        self.assertFalse(success)
        self.assertIsNotNone(error)
        self.assertIsNone(backend)
        self.assertIn("system paths", error)

    @patch('platform.system')
    @patch('os.path.exists')
    @patch('usb.backend.libusb1.get_backend')
    def test_unknown_system(self, mock_get_backend, mock_exists, mock_system):
        """Test handling of unknown operating systems."""
        mock_system.return_value = "UnknownOS"
        mock_backend = Mock()
        mock_get_backend.return_value = mock_backend
        mock_exists.return_value = False
        
        success, error, backend = self.mixin._initialize_backend_early()
        
        self.assertTrue(success)
        self.assertIsNone(error)
        self.assertEqual(backend, mock_backend)

    @patch('platform.system')
    @patch('usb.backend.libusb1.get_backend')
    def test_exception_handling(self, mock_get_backend, mock_system):
        """Test proper exception handling during initialization."""
        mock_system.return_value = "Linux"
        mock_get_backend.side_effect = OSError("Test error")
        
        success, error, backend = self.mixin._initialize_backend_early()
        
        self.assertFalse(success)
        self.assertIsNotNone(error)
        self.assertIsNone(backend)
        self.assertIn("Test error", error)

    def test_path_coverage_macos(self):
        """Test that all expected macOS paths are covered."""
        with patch('platform.system', return_value="Darwin"), \
             patch('os.path.exists', return_value=False), \
             patch('usb.backend.libusb1.get_backend', return_value=Mock()) as mock_backend:
            
            self.mixin._initialize_backend_early()
            
            # Verify that os.path.exists was called with expected macOS paths
            expected_paths = [
                "/opt/homebrew/lib/libusb-1.0.dylib",  # Apple Silicon
                "/usr/local/lib/libusb-1.0.dylib",     # Intel Mac
                "/opt/local/lib/libusb-1.0.dylib",     # MacPorts
                "/usr/lib/libusb-1.0.dylib",           # System
            ]
            
            with patch('os.path.exists') as mock_exists:
                mock_exists.return_value = False
                self.mixin._initialize_backend_early()
                
                # Check that all expected paths were tested
                called_paths = [call[0][0] for call in mock_exists.call_args_list]
                for expected_path in expected_paths:
                    self.assertIn(expected_path, called_paths, 
                                f"Expected path {expected_path} was not checked")

    def test_path_coverage_linux(self):
        """Test that all expected Linux paths are covered."""
        with patch('platform.system', return_value="Linux"), \
             patch('os.path.exists', return_value=False), \
             patch('usb.backend.libusb1.get_backend', return_value=Mock()):
            
            expected_paths = [
                "/usr/lib/x86_64-linux-gnu/libusb-1.0.so",  # Ubuntu/Debian x64
                "/usr/lib/aarch64-linux-gnu/libusb-1.0.so", # Ubuntu/Debian ARM64
                "/usr/lib64/libusb-1.0.so",                  # RHEL/CentOS/Fedora
                "/usr/lib/libusb-1.0.so",                    # Generic
                "/usr/local/lib/libusb-1.0.so",              # Compiled from source
            ]
            
            with patch('os.path.exists') as mock_exists:
                mock_exists.return_value = False
                self.mixin._initialize_backend_early()
                
                called_paths = [call[0][0] for call in mock_exists.call_args_list]
                for expected_path in expected_paths:
                    self.assertIn(expected_path, called_paths,
                                f"Expected path {expected_path} was not checked")


if __name__ == '__main__':
    unittest.main()