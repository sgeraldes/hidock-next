"""
Test the device selector fix.
"""

from unittest.mock import Mock, patch

import pytest


class TestDeviceSelectorFix:
    """Test the device selector set_enabled method."""

    @pytest.mark.unit
    def test_enhanced_device_selector_has_set_enabled_method(self):
        """EnhancedDeviceSelector should have set_enabled method."""
        import enhanced_device_selector

        # Mock the entire widget creation process
        with patch("enhanced_device_selector.ctk.CTkFrame.__init__", return_value=None), patch.object(
            enhanced_device_selector.EnhancedDeviceSelector, "_create_widgets", return_value=None
        ):
            mock_parent = Mock()
            mock_parent._w = "mock_parent"

            # Create the device selector
            selector = enhanced_device_selector.EnhancedDeviceSelector(mock_parent)

            # Should have set_enabled method
            assert hasattr(selector, "set_enabled")
            assert callable(selector.set_enabled)

    @pytest.mark.unit
    def test_set_enabled_method_works(self):
        """set_enabled method should work without errors."""
        import enhanced_device_selector

        # Mock the entire widget creation process
        with patch("enhanced_device_selector.ctk.CTkFrame.__init__", return_value=None), patch.object(
            enhanced_device_selector.EnhancedDeviceSelector, "_create_widgets", return_value=None
        ):
            mock_parent = Mock()
            mock_parent._w = "mock_parent"

            # Create the device selector
            selector = enhanced_device_selector.EnhancedDeviceSelector(mock_parent)

            # Mock the required attributes
            selector.scan_button = Mock()
            selector.device_list_frame = Mock()
            selector.device_list_frame.winfo_children.return_value = []
            selector.status_label = Mock()

            # Should not raise an error
            selector.set_enabled(False)
            selector.set_enabled(True)

            # Verify scan button was configured
            assert selector.scan_button.configure.call_count >= 2

    @pytest.mark.unit
    def test_set_enabled_false_disables_components(self):
        """set_enabled(False) should disable scan button and show warning."""
        import enhanced_device_selector

        # Mock the entire widget creation process
        with patch("enhanced_device_selector.ctk.CTkFrame.__init__", return_value=None), patch.object(
            enhanced_device_selector.EnhancedDeviceSelector, "_create_widgets", return_value=None
        ):
            mock_parent = Mock()
            mock_parent._w = "mock_parent"

            # Create the device selector
            selector = enhanced_device_selector.EnhancedDeviceSelector(mock_parent)

            # Mock the required attributes
            selector.scan_button = Mock()
            selector.device_list_frame = Mock()
            selector.device_list_frame.winfo_children.return_value = []
            selector.status_label = Mock()

            # Disable the selector
            selector.set_enabled(False)

            # Verify scan button was disabled
            selector.scan_button.configure.assert_called_with(state="disabled")

            # Verify status message was updated
            selector.status_label.configure.assert_called_with(text="⚠️ Device selection disabled while connected")

    @pytest.mark.unit
    def test_set_enabled_true_enables_components(self):
        """set_enabled(True) should enable scan button."""
        import enhanced_device_selector

        # Mock the entire widget creation process
        with patch("enhanced_device_selector.ctk.CTkFrame.__init__", return_value=None), patch.object(
            enhanced_device_selector.EnhancedDeviceSelector, "_create_widgets", return_value=None
        ):
            mock_parent = Mock()
            mock_parent._w = "mock_parent"

            # Create the device selector
            selector = enhanced_device_selector.EnhancedDeviceSelector(mock_parent)

            # Mock the required attributes
            selector.scan_button = Mock()
            selector.device_list_frame = Mock()
            selector.device_list_frame.winfo_children.return_value = []
            selector.status_label = Mock()

            # Enable the selector
            selector.set_enabled(True)

            # Verify scan button was enabled
            selector.scan_button.configure.assert_called_with(state="normal")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
