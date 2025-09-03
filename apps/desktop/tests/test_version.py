"""
Test version module.

Simple tests for the version module.
"""

import pytest


class TestVersion:
    """Test version module."""

    def test_version_imports(self):
        """Test that version module can be imported and has expected attributes."""
        import _version

        # Check that all expected attributes exist
        assert hasattr(_version, "__version__")
        assert hasattr(_version, "__version_tuple__")
        assert hasattr(_version, "version")
        assert hasattr(_version, "version_tuple")

        # Check that version is a string
        assert isinstance(_version.__version__, str)
        assert isinstance(_version.version, str)

        # Check that version tuple is a tuple
        assert isinstance(_version.__version_tuple__, tuple)
        assert isinstance(_version.version_tuple, tuple)

        # Check that version and __version__ are the same
        assert _version.__version__ == _version.version
        assert _version.__version_tuple__ == _version.version_tuple

    def test_version_format(self):
        """Test that version follows expected format."""
        import _version

        # Version should be non-empty string
        assert len(_version.__version__.strip()) > 0

        # Version tuple should have at least 3 elements
        assert len(_version.__version_tuple__) >= 3

        # First three elements should be integers
        assert isinstance(_version.__version_tuple__[0], int)
        assert isinstance(_version.__version_tuple__[1], int)
        assert isinstance(_version.__version_tuple__[2], int)

    def test_version_constants(self):
        """Test version constants match expected values."""
        import _version

        # Test that the version starts with "0.1.0"
        assert _version.__version__.startswith("0.1.0")

        # Test that version tuple starts with (0, 1, 0)
        assert _version.__version_tuple__[:3] == (0, 1, 0)

    def test_all_exports(self):
        """Test that __all__ exports are properly defined and accessible."""
        import _version

        # Test that __all__ exists and contains expected items
        expected_exports = ["__version__", "__version_tuple__", "version", "version_tuple"]
        assert hasattr(_version, "__all__")
        assert _version.__all__ == expected_exports

        # Test that all exported items are actually available
        for export in expected_exports:
            assert hasattr(_version, export)

    def test_type_checking_behavior(self):
        """Test TYPE_CHECKING flag and VERSION_TUPLE behavior."""
        import _version

        # TYPE_CHECKING should be False at runtime
        assert _version.TYPE_CHECKING is False

        # VERSION_TUPLE should be the object type
        assert _version.VERSION_TUPLE == object

    def test_version_annotations(self):
        """Test that annotated variables exist and have proper values."""
        import _version

        # Check that annotated variables exist and have values
        assert hasattr(_version, "version")
        assert hasattr(_version, "__version__")
        assert hasattr(_version, "__version_tuple__")
        assert hasattr(_version, "version_tuple")

        # Check that they are not None
        assert _version.version is not None
        assert _version.__version__ is not None
        assert _version.__version_tuple__ is not None
        assert _version.version_tuple is not None

        # Test __all__ contents
        assert hasattr(_version, "__all__")
        assert isinstance(_version.__all__, list)
        assert len(_version.__all__) == 4

        # Verify all exported names exist
        for name in _version.__all__:
            assert hasattr(_version, name)

        # Test specific exports
        assert "__version__" in _version.__all__
        assert "__version_tuple__" in _version.__all__
        assert "version" in _version.__all__
        assert "version_tuple" in _version.__all__

    def test_type_checking_flag(self):
        """Test TYPE_CHECKING flag behavior."""
        import _version

        # TYPE_CHECKING should be False at runtime
        assert hasattr(_version, "TYPE_CHECKING")
        assert _version.TYPE_CHECKING is False

        # VERSION_TUPLE should be object when TYPE_CHECKING is False
        assert hasattr(_version, "VERSION_TUPLE")
        assert _version.VERSION_TUPLE is object

    def test_version_annotations(self):
        """Test version variable annotations exist."""
        import _version

        # Test that annotated variables exist
        assert hasattr(_version, "version")
        assert hasattr(_version, "__version__")
        assert hasattr(_version, "__version_tuple__")
        assert hasattr(_version, "version_tuple")

        # Test they have proper values
        assert _version.version is not None
        assert _version.__version__ is not None
        assert _version.__version_tuple__ is not None
        assert _version.version_tuple is not None

    def test_version_string_content(self):
        """Test version string content is reasonable."""
        import _version

        # Version should not be empty after stripping
        version_stripped = _version.__version__.strip()
        assert len(version_stripped) > 0

        # Should contain digits
        assert any(c.isdigit() for c in version_stripped)

        # Should not contain obvious invalid characters
        invalid_chars = ["<", ">", "|", "&", ";"]
        for char in invalid_chars:
            assert char not in _version.__version__

    def test_version_tuple_structure(self):
        """Test version tuple has proper structure."""
        import _version

        # Should be a tuple
        assert isinstance(_version.__version_tuple__, tuple)

        # Should have at least 3 elements
        assert len(_version.__version_tuple__) >= 3

        # Check types of standard version components
        major, minor, patch = _version.__version_tuple__[:3]
        assert isinstance(major, int)
        assert isinstance(minor, int)
        assert isinstance(patch, int)

        # Should be non-negative
        assert major >= 0
        assert minor >= 0
        assert patch >= 0
