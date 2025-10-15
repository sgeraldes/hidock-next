"""
Comprehensive test for device selector functionality.

This consolidates device selector tests to avoid race conditions
that can occur when running multiple separate test files.
"""

import inspect
import sys
from unittest.mock import Mock, patch

import pytest

# Mock GUI modules to prevent tkinter initialization issues
sys.modules["tkinter.messagebox"] = Mock()
sys.modules["tkinter.filedialog"] = Mock()
sys.modules["tkinter.ttk"] = Mock()
sys.modules["tkinter.simpledialog"] = Mock()

# Import at module level to avoid race conditions
import enhanced_device_selector
import settings_window


class TestDeviceSelectorComprehensive:
    """Comprehensive test for device selector functionality."""

    def setup_method(self):
        """Set up each test method with clean state."""
        # Clear any existing patches or state
        pass

    def teardown_method(self):
        """Clean up after each test method."""
        # Ensure no lingering threads or state
        pass

    # Interface Contract Tests
    @pytest.mark.unit
    def test_enhanced_device_selector_class_has_set_enabled_method(self):
        """EnhancedDeviceSelector class should have set_enabled method."""
        # Check that the class has the method
        assert hasattr(enhanced_device_selector.EnhancedDeviceSelector, "set_enabled")

        # Check that it's callable
        method = getattr(enhanced_device_selector.EnhancedDeviceSelector, "set_enabled")
        assert callable(method)

    @pytest.mark.unit
    def test_device_selector_method_signature(self):
        """set_enabled method should have correct signature."""
        method = enhanced_device_selector.EnhancedDeviceSelector.set_enabled
        sig = inspect.signature(method)

        # Should have self and enabled parameters
        params = list(sig.parameters.keys())
        assert "self" in params
        assert "enabled" in params

        # enabled parameter should have bool type hint
        enabled_param = sig.parameters["enabled"]
        assert enabled_param.annotation == bool

    # Implementation Behavior Tests
    @pytest.mark.unit
    def test_enhanced_device_selector_has_set_enabled_method(self):
        """EnhancedDeviceSelector should have set_enabled method."""
        # Mock the entire widget creation process and threading
        with patch("enhanced_device_selector.ctk.CTkFrame.__init__", return_value=None), patch.object(
            enhanced_device_selector.EnhancedDeviceSelector, "_create_widgets", return_value=None
        ), patch("enhanced_device_selector.threading.Thread"):
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
        # Mock the entire widget creation process and threading
        with patch("enhanced_device_selector.ctk.CTkFrame.__init__", return_value=None), patch.object(
            enhanced_device_selector.EnhancedDeviceSelector, "_create_widgets", return_value=None
        ), patch("enhanced_device_selector.threading.Thread"):
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
        # Mock the entire widget creation process and threading
        with patch("enhanced_device_selector.ctk.CTkFrame.__init__", return_value=None), patch.object(
            enhanced_device_selector.EnhancedDeviceSelector, "_create_widgets", return_value=None
        ), patch("enhanced_device_selector.threading.Thread"):
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
            expected_text = "⚠️ Device selection disabled while connected"
            selector.status_label.configure.assert_called_with(text=expected_text)

    @pytest.mark.unit
    def test_set_enabled_true_enables_components(self):
        """set_enabled(True) should enable scan button."""
        # Mock the entire widget creation process and threading
        with patch("enhanced_device_selector.ctk.CTkFrame.__init__", return_value=None), patch.object(
            enhanced_device_selector.EnhancedDeviceSelector, "_create_widgets", return_value=None
        ), patch("enhanced_device_selector.threading.Thread"):
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

    # Integration Tests
    @pytest.mark.unit
    def test_settings_window_uses_set_enabled_not_configure(self):
        """Settings window should use set_enabled method, not configure."""
        # Read the source code to verify the fix
        source = inspect.getsource(settings_window.SettingsDialog._populate_connection_tab)

        # Should contain set_enabled call
        assert "set_enabled(False)" in source

        # Should NOT contain the old configure call
        assert 'configure(state="disabled")' not in source

    @pytest.mark.unit
    def test_device_selector_integration_with_settings(self):
        """Device selector should integrate properly with settings dialog."""
        # Mock the EnhancedDeviceSelector to avoid GUI initialization
        mock_device_selector = Mock()
        mock_device_selector.set_enabled = Mock()

        # Mock all GUI components to avoid tkinter initialization
        with patch("enhanced_device_selector.EnhancedDeviceSelector", return_value=mock_device_selector), patch(
            "settings_window.ctk.CTkScrollableFrame"
        ) as mock_scrollable_frame, patch("settings_window.ctk.CTkLabel"), patch("settings_window.ctk.CTkFrame"), patch(
            "settings_window.ctk.CTkFont"
        ) as mock_font, patch(
            "settings_window.ctk.CTkCheckBox"
        ), patch(
            "settings_window.ctk.CTkEntry"
        ), patch(
            "threading.Thread"
        ):
            # Mock font creation
            mock_font.return_value = Mock()

            # Create properly mocked tab with tkinter attributes
            mock_tab = Mock()
            mock_tab._w = "mock_tab_widget"
            mock_tab.tk = Mock()

            # Mock the scrollable frame with proper tkinter attributes
            mock_scroll_frame_instance = Mock()
            mock_scroll_frame_instance._w = "mock_scroll_frame"
            mock_scroll_frame_instance.tk = Mock()
            mock_scrollable_frame.return_value = mock_scroll_frame_instance

            # Create dialog instance without initialization
            dialog = settings_window.SettingsDialog.__new__(settings_window.SettingsDialog)
            dialog.dock = Mock()
            dialog.dock.is_connected.return_value = True
            dialog.local_vars = {"autoconnect_var": Mock(), "target_interface_var": Mock()}

            # This should not raise an error
            dialog._populate_connection_tab(mock_tab)

            # The device selector should be created and disabled
            mock_device_selector.set_enabled.assert_called_with(False)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
