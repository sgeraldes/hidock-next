"""
Test that the device selector has the required method.
"""

import pytest


class TestDeviceSelectorMethod:
    """Test the device selector method exists."""

    @pytest.mark.unit
    def test_enhanced_device_selector_class_has_set_enabled_method(self):
        """EnhancedDeviceSelector class should have set_enabled method."""
        import enhanced_device_selector
        
        # Check that the class has the method
        assert hasattr(enhanced_device_selector.EnhancedDeviceSelector, 'set_enabled')
        
        # Check that it's callable
        method = getattr(enhanced_device_selector.EnhancedDeviceSelector, 'set_enabled')
        assert callable(method)

    @pytest.mark.unit
    def test_settings_window_uses_set_enabled_not_configure(self):
        """Settings window should use set_enabled method, not configure."""
        import settings_window
        
        # Read the source code to verify the fix
        import inspect
        source = inspect.getsource(settings_window.SettingsDialog._populate_connection_tab)
        
        # Should contain set_enabled call
        assert 'set_enabled(False)' in source
        
        # Should NOT contain the old configure call
        assert 'configure(state="disabled")' not in source

    @pytest.mark.unit
    def test_device_selector_method_signature(self):
        """set_enabled method should have correct signature."""
        import enhanced_device_selector
        import inspect
        
        method = enhanced_device_selector.EnhancedDeviceSelector.set_enabled
        sig = inspect.signature(method)
        
        # Should have self and enabled parameters
        params = list(sig.parameters.keys())
        assert 'self' in params
        assert 'enabled' in params
        
        # enabled parameter should have bool type hint
        enabled_param = sig.parameters['enabled']
        assert enabled_param.annotation == bool


if __name__ == "__main__":
    pytest.main([__file__, "-v"])