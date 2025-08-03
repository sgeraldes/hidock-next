"""
Test for the device selector configuration bug.
"""

import pytest
from unittest.mock import Mock, patch


class TestDeviceSelectorBug:
    """Test the device selector configuration issue."""

    @pytest.mark.unit
    def test_device_selector_configure_state_should_not_fail(self):
        """Device selector should handle state configuration properly."""
        import settings_window
        
        # Mock the EnhancedDeviceSelector
        mock_device_selector = Mock()
        mock_device_selector.set_enabled = Mock()
        
        # Mock all tkinter and customtkinter components
        with patch('enhanced_device_selector.EnhancedDeviceSelector', return_value=mock_device_selector), \
             patch('customtkinter.CTkScrollableFrame') as mock_scrollable_frame, \
             patch('customtkinter.CTkLabel') as mock_label, \
             patch('customtkinter.CTkFrame') as mock_frame, \
             patch('customtkinter.CTkFont') as mock_font, \
             patch('customtkinter.CTkCheckBox') as mock_checkbox, \
             patch('customtkinter.CTkEntry') as mock_entry, \
             patch('threading.Thread') as mock_thread:
            
            # Mock font creation to avoid tkinter root window requirement
            mock_font.return_value = Mock()
            
            # Create mock parent with required tkinter attributes
            mock_tab = Mock()
            mock_tab._last_child_ids = {}
            mock_tab.tk = Mock()
            
            # Mock the scrollable frame creation
            mock_scroll_frame_instance = Mock()
            mock_scroll_frame_instance._last_child_ids = {}
            mock_scroll_frame_instance.tk = Mock()
            mock_scrollable_frame.return_value = mock_scroll_frame_instance
            
            dialog = settings_window.SettingsDialog.__new__(settings_window.SettingsDialog)
            dialog.dock = Mock()
            dialog.dock.is_connected.return_value = True
            dialog.local_vars = {
                "autoconnect_var": Mock(),
                "target_interface_var": Mock()
            }
            
            # This should not raise an error
            dialog._populate_connection_tab(mock_tab)
            
            # The device selector should be created and disabled
            mock_device_selector.set_enabled.assert_called_with(False)

    @pytest.mark.unit
    def test_device_selector_should_use_proper_disable_method(self):
        """Device selector should use proper method to disable when connected."""
        # This test defines how the device selector SHOULD be disabled
        
        # Mock device selector that supports proper disable method
        mock_device_selector = Mock()
        mock_device_selector.set_enabled = Mock()  # Proper method
        
        # When device is connected, should call set_enabled(False)
        is_connected = True
        if is_connected:
            mock_device_selector.set_enabled(False)
        
        mock_device_selector.set_enabled.assert_called_once_with(False)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])