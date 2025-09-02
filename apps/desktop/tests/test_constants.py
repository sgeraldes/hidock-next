"""
Test constants module.

Tests for USB device constants, command IDs, and configuration constants.
"""

import pytest

import constants


class TestConstants:
    """Test constants module."""

    def test_module_imports(self):
        """Test that constants module can be imported."""

        # Module should import without error
        assert constants is not None

    def test_usb_device_constants(self):
        """Test USB device constants are properly defined."""

        # Test vendor and product IDs
        assert hasattr(constants, "DEFAULT_VENDOR_ID")
        assert hasattr(constants, "DEFAULT_PRODUCT_ID")

        # Should be integers (hex values)
        assert isinstance(constants.DEFAULT_VENDOR_ID, int)
        assert isinstance(constants.DEFAULT_PRODUCT_ID, int)

        # Test expected values
        assert constants.DEFAULT_VENDOR_ID == 0x10D6
        assert constants.DEFAULT_PRODUCT_ID == 0xB00D

    def test_endpoint_constants(self):
        """Test endpoint address constants."""
        import constants

        # Test endpoint addresses
        assert hasattr(constants, "EP_OUT_ADDR")
        assert hasattr(constants, "EP_IN_ADDR")

        # Should be integers
        assert isinstance(constants.EP_OUT_ADDR, int)
        assert isinstance(constants.EP_IN_ADDR, int)

        # Test expected values
        assert constants.EP_OUT_ADDR == 0x01
        assert constants.EP_IN_ADDR == 0x82

    def test_command_id_constants(self):
        """Test all command ID constants."""
        import constants

        # Test all command IDs exist
        command_attrs = [
            "CMD_GET_DEVICE_INFO",
            "CMD_GET_DEVICE_TIME",
            "CMD_SET_DEVICE_TIME",
            "CMD_GET_FILE_LIST",
            "CMD_TRANSFER_FILE",
            "CMD_GET_FILE_COUNT",
            "CMD_DELETE_FILE",
            "CMD_GET_FILE_BLOCK",
            "CMD_GET_SETTINGS",
            "CMD_SET_SETTINGS",
            "CMD_GET_CARD_INFO",
            "CMD_FORMAT_CARD",
            "CMD_GET_RECORDING_FILE",
        ]

        for attr in command_attrs:
            assert hasattr(constants, attr), f"Missing command constant: {attr}"
            assert isinstance(getattr(constants, attr), int), f"{attr} should be an integer"

    def test_command_id_values(self):
        """Test specific command ID values."""
        import constants

        # Test specific expected values
        assert constants.CMD_GET_DEVICE_INFO == 1
        assert constants.CMD_GET_DEVICE_TIME == 2
        assert constants.CMD_SET_DEVICE_TIME == 3
        assert constants.CMD_GET_FILE_LIST == 4
        assert constants.CMD_TRANSFER_FILE == 5
        assert constants.CMD_GET_FILE_COUNT == 6
        assert constants.CMD_DELETE_FILE == 7
        assert constants.CMD_GET_FILE_BLOCK == 13
        assert constants.CMD_GET_SETTINGS == 11
        assert constants.CMD_SET_SETTINGS == 12
        assert constants.CMD_GET_CARD_INFO == 16
        assert constants.CMD_FORMAT_CARD == 17
        assert constants.CMD_GET_RECORDING_FILE == 18

    def test_command_id_uniqueness(self):
        """Test that all command IDs are unique."""
        import constants

        command_values = [
            constants.CMD_GET_DEVICE_INFO,
            constants.CMD_GET_DEVICE_TIME,
            constants.CMD_SET_DEVICE_TIME,
            constants.CMD_GET_FILE_LIST,
            constants.CMD_TRANSFER_FILE,
            constants.CMD_GET_FILE_COUNT,
            constants.CMD_DELETE_FILE,
            constants.CMD_GET_FILE_BLOCK,
            constants.CMD_GET_SETTINGS,
            constants.CMD_SET_SETTINGS,
            constants.CMD_GET_CARD_INFO,
            constants.CMD_FORMAT_CARD,
            constants.CMD_GET_RECORDING_FILE,
        ]

        # All command IDs should be unique
        assert len(command_values) == len(set(command_values))

    def test_config_file_constant(self):
        """Test configuration file constant."""
        import constants

        assert hasattr(constants, "CONFIG_FILE_NAME")
        assert isinstance(constants.CONFIG_FILE_NAME, str)
        assert constants.CONFIG_FILE_NAME == "hidock_config.json"
        assert constants.CONFIG_FILE_NAME.endswith(".json")

    def test_constants_immutability(self):
        """Test that constants can be accessed (they're not complex objects)."""
        import constants

        # Test that accessing constants doesn't raise errors
        vendor_id = constants.DEFAULT_VENDOR_ID
        product_id = constants.DEFAULT_PRODUCT_ID
        config_file = constants.CONFIG_FILE_NAME

        # These should be simple immutable types
        assert isinstance(vendor_id, int)
        assert isinstance(product_id, int)
        assert isinstance(config_file, str)

    def test_module_structure(self):
        """Test overall module structure and documentation."""
        import constants

        # Module should have a docstring
        assert constants.__doc__ is not None
        assert len(constants.__doc__) > 0

        # Test module contains expected sections
        assert "USB Device Constants" in constants.__doc__ or hasattr(constants, "DEFAULT_VENDOR_ID")
        assert "Command IDs" in constants.__doc__ or hasattr(constants, "CMD_GET_DEVICE_INFO")

    def test_command_id_ranges(self):
        """Test that command IDs are within reasonable ranges."""
        import constants

        command_values = [
            constants.CMD_GET_DEVICE_INFO,
            constants.CMD_GET_DEVICE_TIME,
            constants.CMD_SET_DEVICE_TIME,
            constants.CMD_GET_FILE_LIST,
            constants.CMD_TRANSFER_FILE,
            constants.CMD_GET_FILE_COUNT,
            constants.CMD_DELETE_FILE,
            constants.CMD_GET_FILE_BLOCK,
            constants.CMD_GET_SETTINGS,
            constants.CMD_SET_SETTINGS,
            constants.CMD_GET_CARD_INFO,
            constants.CMD_FORMAT_CARD,
            constants.CMD_GET_RECORDING_FILE,
        ]

        # All command IDs should be positive and within reasonable range
        for cmd_id in command_values:
            assert cmd_id > 0, f"Command ID {cmd_id} should be positive"
            assert cmd_id < 256, f"Command ID {cmd_id} should be within byte range"
