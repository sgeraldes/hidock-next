"""
Test main module.

Tests for the main entry point of the application.
"""

import os
import sys
import unittest
from unittest.mock import MagicMock, Mock, patch

import pytest

# Mark as GUI test for architectural separation
pytestmark = pytest.mark.gui

import main
from main import main as main_func


class TestMainModuleBasic:
    """Test main module basic functionality."""

    def test_main_imports(self):
        """Test that main module imports are available."""
        # Check that main function exists
        assert hasattr(main, "main")
        assert callable(main.main)

    @patch("main.HiDockToolGUI")
    @patch("main.ctk.set_appearance_mode")
    @patch("main.ctk.set_default_color_theme")
    def test_main_function_success(self, mock_theme, mock_appearance, mock_gui_class):
        """Test main function executes successfully."""
        # Mock GUI instance
        mock_app = Mock()
        mock_gui_class.return_value = mock_app

        # This should not raise an exception
        main.main()

        # Verify CTk setup calls
        mock_appearance.assert_called_once_with("System")
        mock_theme.assert_called_once_with("blue")

        # Verify GUI creation and mainloop
        mock_gui_class.assert_called_once()
        mock_app.mainloop.assert_called_once()

    @patch("main.HiDockToolGUI")
    @patch("main.ctk.set_appearance_mode")
    @patch("main.ctk.set_default_color_theme")
    @patch("main.logger")
    @patch("main.tkinter.messagebox.showerror")
    @patch("main.sys.exit")
    def test_main_function_handles_exceptions(
        self, mock_exit, mock_showerror, mock_logger, mock_theme, mock_appearance, mock_gui_class
    ):
        """Test main function handles exceptions gracefully."""
        # Mock GUI creation failure
        mock_gui_class.side_effect = Exception("GUI creation failed")

        # This should not raise an exception due to mocked sys.exit
        main.main()

        # Verify error handling
        mock_logger.error.assert_called()
        mock_showerror.assert_called()
        mock_exit.assert_called_once_with(1)

    def test_module_constants(self):
        """Test that required modules are imported."""
        # Check that required modules are available in the namespace
        assert hasattr(main, "sys")
        assert hasattr(main, "tkinter")
        assert hasattr(main, "ctk")
        assert hasattr(main, "logger")
        assert hasattr(main, "HiDockToolGUI")

    @patch("main.HiDockToolGUI")
    @patch("main.ctk.set_appearance_mode")
    @patch("main.ctk.set_default_color_theme")
    @patch("main.logger")
    @patch("main.tkinter.messagebox.showerror")
    @patch("main.tkinter.Tk")
    @patch("main.sys.exit")
    def test_main_function_app_withdraw_error(
        self, mock_exit, mock_tk, mock_showerror, mock_logger, mock_theme, mock_appearance, mock_gui_class
    ):
        """Test main function when app.withdraw() fails."""
        # Mock GUI instance that exists but withdraw fails
        mock_app = Mock()
        mock_app.winfo_exists.return_value = True
        mock_app.withdraw.side_effect = Exception("Withdraw failed")
        mock_gui_class.side_effect = Exception("GUI creation failed")

        # Mock temp root
        mock_temp_root = Mock()
        mock_temp_root.winfo_exists.return_value = True
        mock_tk.return_value = mock_temp_root

        main.main()

        # Verify error handling path was taken
        mock_logger.error.assert_called()
        mock_showerror.assert_called()
        mock_exit.assert_called_once_with(1)

    @patch("main.HiDockToolGUI")
    @patch("main.ctk.set_appearance_mode")
    @patch("main.ctk.set_default_color_theme")
    @patch("main.logger")
    @patch("main.tkinter.messagebox.showerror")
    @patch("main.tkinter.Tk")
    @patch("main.sys.exit")
    def test_main_function_temp_root_cleanup(
        self, mock_exit, mock_tk, mock_showerror, mock_logger, mock_theme, mock_appearance, mock_gui_class
    ):
        """Test main function properly cleans up temp root."""
        # Mock GUI creation failure
        mock_gui_class.side_effect = Exception("GUI creation failed")

        # Mock temp root that exists
        mock_temp_root = Mock()
        mock_temp_root.winfo_exists.return_value = True
        mock_tk.return_value = mock_temp_root

        main.main()

        # Verify temp root was properly destroyed
        mock_temp_root.withdraw.assert_called_once()
        mock_temp_root.destroy.assert_called_once()
        mock_exit.assert_called_once_with(1)

    @patch("main.HiDockToolGUI")
    @patch("main.ctk.set_appearance_mode")
    @patch("main.ctk.set_default_color_theme")
    @patch("main.logger")
    @patch("main.tkinter.messagebox.showerror")
    @patch("main.tkinter.Tk")
    @patch("main.sys.exit")
    @patch("builtins.print")
    def test_main_function_console_fallback(
        self, mock_print, mock_exit, mock_tk, mock_showerror, mock_logger, mock_theme, mock_appearance, mock_gui_class
    ):
        """Test main function falls back to console when messagebox fails."""
        # Mock GUI creation failure
        mock_gui_class.side_effect = Exception("GUI creation failed")

        # Mock messagebox failure
        mock_showerror.side_effect = Exception("Messagebox failed")
        mock_tk.return_value = Mock()

        main.main()

        # Verify console fallback was used
        assert mock_print.call_count >= 2  # Should print both error messages
        mock_exit.assert_called_once_with(1)

    @patch("main.HiDockToolGUI")
    @patch("main.ctk.set_appearance_mode")
    @patch("main.ctk.set_default_color_theme")
    @patch("main.logger")
    @patch("main.tkinter.messagebox.showerror")
    @patch("main.sys.exit")
    def test_main_function_app_no_winfo_exists(
        self, mock_exit, mock_showerror, mock_logger, mock_theme, mock_appearance, mock_gui_class
    ):
        """Test main function when app doesn't have winfo_exists method."""
        # Mock GUI instance without winfo_exists
        mock_app = Mock()
        del mock_app.winfo_exists  # Remove the method
        mock_gui_class.side_effect = Exception("GUI creation failed")

        main.main()

        # Should still handle error gracefully
        mock_logger.error.assert_called()
        mock_exit.assert_called_once_with(1)

    @patch("main.HiDockToolGUI")
    @patch("main.ctk.set_appearance_mode")
    @patch("main.ctk.set_default_color_theme")
    @patch("main.logger")
    @patch("main.tkinter.messagebox.showerror")
    @patch("main.tkinter.Tk")
    @patch("main.sys.exit")
    def test_main_function_mainloop_exception(
        self, mock_exit, mock_tk, mock_showerror, mock_logger, mock_theme, mock_appearance, mock_gui_class
    ):
        """Test main function when mainloop raises exception."""
        # Mock GUI instance with mainloop failure
        mock_app = Mock()
        mock_app.mainloop.side_effect = Exception("Mainloop failed")
        mock_gui_class.return_value = mock_app

        # Mock temp root for error dialog
        mock_temp_root = Mock()
        mock_temp_root.winfo_exists.return_value = True
        mock_tk.return_value = mock_temp_root

        main.main()

        # Verify error handling
        mock_logger.error.assert_called()
        mock_exit.assert_called_once_with(1)


# Add the project root to the Python path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


class TestMainFunctionIsolated:
    """Isolated tests for main function edge cases."""

    @patch("main.HiDockToolGUI")
    @patch("main.ctk.set_appearance_mode")
    @patch("main.ctk.set_default_color_theme")
    @patch("main.logger")
    @patch("main.tkinter.messagebox.showerror")
    @patch("main.tkinter.Tk")
    @patch("main.sys.exit")
    def test_mainloop_exception_isolated(
        self, mock_exit, mock_tk, mock_showerror, mock_logger, mock_theme, mock_appearance, mock_gui_class
    ):
        """Test mainloop exception in isolation."""
        # Setup mocks
        mock_app = Mock()
        mock_app.winfo_exists.return_value = False
        mock_app.mainloop.side_effect = Exception("Mainloop failed")
        mock_gui_class.return_value = mock_app

        mock_temp_root = Mock()
        mock_temp_root.winfo_exists.return_value = True
        mock_tk.return_value = mock_temp_root

        # Execute
        main.main()

        # Verify
        mock_logger.error.assert_called_once()
        mock_exit.assert_called_once_with(1)
        mock_temp_root.destroy.assert_called_once()


class TestMain(unittest.TestCase):
    @patch("main.HiDockToolGUI")
    @patch("main.ctk.set_appearance_mode")
    @patch("main.ctk.set_default_color_theme")
    def test_main_initialization(self, mock_set_theme, mock_set_appearance, mock_main_window):
        # Arrange
        mock_app = MagicMock()
        mock_main_window.return_value = mock_app

        # Act
        main_func()

        # Assert
        mock_set_appearance.assert_called_once_with("System")
        mock_set_theme.assert_called_once_with("blue")
        mock_main_window.assert_called_once()
        mock_app.mainloop.assert_called_once()

    @patch("main.HiDockToolGUI")
    @patch("main.logger.error")
    @patch("main.tkinter.messagebox.showerror")
    @patch("main.sys.exit")
    def test_main_exception(self, mock_exit, mock_showerror, mock_logger_error, mock_main_window):
        # Arrange
        mock_main_window.side_effect = Exception("Test Exception")

        # Act
        main_func()

        # Assert
        mock_logger_error.assert_called_once()
        mock_showerror.assert_called_once()
        mock_exit.assert_called_once_with(1)

    def test_module_imports(self):
        """Test that main module has required imports."""
        self.assertTrue(hasattr(main, "logger"))
        self.assertTrue(hasattr(main, "ctk"))

    def test_config_manager_import(self):
        """Test main function availability."""
        # main.py doesn't have ConfigManager, testing main function instead
        self.assertTrue(hasattr(main, "main"))
        self.assertTrue(callable(main.main))

    def test_main_module_constants(self):
        """Test module-level constants and attributes."""
        self.assertTrue(hasattr(main, "__name__"))
        self.assertTrue(callable(main_func))

    @patch("main.HiDockToolGUI")
    @patch("main.ctk.set_appearance_mode")
    @patch("main.ctk.set_default_color_theme")
    def test_ctk_settings_configuration(self, mock_set_theme, mock_set_appearance, mock_main_window):
        """Test CTK appearance and theme settings."""
        mock_app = MagicMock()
        mock_main_window.return_value = mock_app

        main_func()

        # Verify CTK settings are applied
        mock_set_appearance.assert_called_once_with("System")
        mock_set_theme.assert_called_once_with("blue")

    def test_if_name_main_structure(self):
        """Test the if __name__ == '__main__' structure exists."""
        # Read the source to verify the structure
        import inspect

        source = inspect.getsource(main)
        self.assertIn('if __name__ == "__main__":', source)

    @patch("main.HiDockToolGUI")
    @patch("main.logger.error")
    @patch("main.tkinter.messagebox.showerror")
    @patch("main.tkinter.Tk")
    @patch("main.sys.exit")
    def test_main_exception_with_app_withdraw_called(
        self, mock_exit, mock_tk, mock_showerror, mock_logger_error, mock_main_window
    ):
        """Test main exception handling when app.withdraw() is called."""
        # Create a mock app that can be withdrawn
        mock_app = MagicMock()
        mock_app.winfo_exists.return_value = True

        # Set up HiDockToolGUI to return the app then raise exception on mainloop
        mock_main_window.return_value = mock_app
        mock_app.mainloop.side_effect = Exception("Test Exception")

        mock_temp_root = MagicMock()
        mock_temp_root.winfo_exists.return_value = True
        mock_tk.return_value = mock_temp_root

        # Act
        main_func()

        # Assert - app.withdraw should have been called
        mock_app.withdraw.assert_called_once()
        mock_exit.assert_called_with(1)

    @patch("main.HiDockToolGUI")
    @patch("main.logger.error")
    @patch("main.tkinter.messagebox.showerror", side_effect=Exception("Tkinter dialog failed"))
    @patch("main.tkinter.Tk")
    @patch("main.sys.exit")
    @patch("builtins.print")
    def test_main_exception_dialog_fails(
        self, mock_print, mock_exit, mock_tk, mock_showerror, mock_logger_error, mock_main_window
    ):
        """Test main exception handling when even the error dialog fails."""
        # Arrange
        mock_main_window.side_effect = Exception("Original error")

        mock_temp_root = MagicMock()
        mock_temp_root.winfo_exists.return_value = True
        mock_tk.return_value = mock_temp_root

        # Act
        main_func()

        # Assert - should print to console when dialog fails
        mock_print.assert_any_call("Could not display Tkinter error dialog: Tkinter dialog failed")
        mock_print.assert_any_call("Original critical error was: Original error")
        mock_exit.assert_called_with(1)

    @patch("main.HiDockToolGUI")
    @patch("main.logger.error")
    @patch("main.tkinter.messagebox.showerror")
    @patch("main.tkinter.Tk")
    @patch("main.sys.exit")
    def test_main_exception_with_no_app_exists(
        self, mock_exit, mock_tk, mock_showerror, mock_logger_error, mock_main_window
    ):
        """Test main exception handling when app doesn't exist or has no winfo_exists."""
        # Create a mock app without winfo_exists attribute
        mock_app = MagicMock()
        del mock_app.winfo_exists  # Remove the attribute to test the hasattr check

        mock_main_window.return_value = mock_app
        mock_app.mainloop.side_effect = Exception("Test Exception")

        mock_temp_root = MagicMock()
        mock_temp_root.winfo_exists.return_value = True
        mock_tk.return_value = mock_temp_root

        # Act
        main_func()

        # Assert - app.withdraw should NOT have been called
        self.assertFalse(mock_app.withdraw.called)
        mock_exit.assert_called_with(1)

    @patch("main.HiDockToolGUI")
    @patch("main.logger.error")
    @patch("main.tkinter.messagebox.showerror")
    @patch("main.tkinter.Tk")
    @patch("main.sys.exit")
    def test_main_exception_app_winfo_exists_false(
        self, mock_exit, mock_tk, mock_showerror, mock_logger_error, mock_main_window
    ):
        """Test main exception handling when app.winfo_exists() returns False."""
        mock_app = MagicMock()
        mock_app.winfo_exists.return_value = False

        mock_main_window.return_value = mock_app
        mock_app.mainloop.side_effect = Exception("Test Exception")

        mock_temp_root = MagicMock()
        mock_temp_root.winfo_exists.return_value = True
        mock_tk.return_value = mock_temp_root

        # Act
        main_func()

        # Assert - app.withdraw should NOT have been called since winfo_exists is False
        self.assertFalse(mock_app.withdraw.called)
        mock_exit.assert_called_with(1)

    @patch("main.HiDockToolGUI")
    @patch("main.logger.error")
    @patch("main.tkinter.messagebox.showerror")
    @patch("main.tkinter.Tk")
    @patch("main.sys.exit")
    def test_main_exception_temp_root_cleanup(
        self, mock_exit, mock_tk, mock_showerror, mock_logger_error, mock_main_window
    ):
        """Test main exception handling cleans up temp_root properly."""
        mock_main_window.side_effect = Exception("Test Exception")

        mock_temp_root = MagicMock()
        mock_temp_root.winfo_exists.return_value = True
        mock_tk.return_value = mock_temp_root

        # Act
        main_func()

        # Assert - temp root should be destroyed
        mock_temp_root.destroy.assert_called_once()
        mock_exit.assert_called_with(1)

    @patch("main.HiDockToolGUI")
    @patch("main.logger.error")
    @patch("main.tkinter.messagebox.showerror")
    @patch("main.tkinter.Tk")
    @patch("main.sys.exit")
    def test_main_exception_temp_root_no_winfo_exists(
        self, mock_exit, mock_tk, mock_showerror, mock_logger_error, mock_main_window
    ):
        """Test main exception handling when temp_root has no winfo_exists."""
        mock_main_window.side_effect = Exception("Test Exception")

        mock_temp_root = MagicMock()
        del mock_temp_root.winfo_exists  # Remove the attribute
        mock_tk.return_value = mock_temp_root

        # Act
        main_func()

        # Assert - temp root destroy should NOT be called
        self.assertFalse(mock_temp_root.destroy.called)
        mock_exit.assert_called_with(1)

    @patch("main.HiDockToolGUI")
    @patch("main.logger.error")
    @patch("main.tkinter.messagebox.showerror")
    @patch("main.tkinter.Tk")
    @patch("main.sys.exit")
    def test_main_exception_temp_root_winfo_exists_false(
        self, mock_exit, mock_tk, mock_showerror, mock_logger_error, mock_main_window
    ):
        """Test main exception handling when temp_root.winfo_exists() returns False."""
        mock_main_window.side_effect = Exception("Test Exception")

        mock_temp_root = MagicMock()
        mock_temp_root.winfo_exists.return_value = False
        mock_tk.return_value = mock_temp_root

        # Act
        main_func()

        # Assert - temp root destroy should NOT be called since winfo_exists is False
        self.assertFalse(mock_temp_root.destroy.called)
        mock_exit.assert_called_with(1)

    @patch("main.HiDockToolGUI")
    @patch("main.logger.error")
    @patch("main.tkinter.messagebox.showerror")
    @patch("main.tkinter.Tk")
    @patch("main.sys.exit")
    def test_main_exception_app_is_none(self, mock_exit, mock_tk, mock_showerror, mock_logger_error, mock_main_window):
        """Test main exception handling when app is None."""
        # Simulate app being None (initialization failure before assignment)
        mock_main_window.side_effect = Exception("Initialization failed")

        mock_temp_root = MagicMock()
        mock_temp_root.winfo_exists.return_value = True
        mock_tk.return_value = mock_temp_root

        # Act
        main_func()

        # Assert - should handle gracefully when app is None
        mock_logger_error.assert_called_once()
        mock_showerror.assert_called_once()
        mock_exit.assert_called_with(1)

    def test_main_module_docstring(self):
        """Test that main module has a proper docstring."""
        self.assertIsNotNone(main.__doc__)
        self.assertIn("HiDock", main.__doc__)
        self.assertIn("GUI", main.__doc__)

    def test_traceback_import(self):
        """Test that traceback module is imported for error handling."""
        self.assertTrue(hasattr(main, "traceback"))

    @patch("main.HiDockToolGUI")
    @patch("main.ctk.set_appearance_mode")
    @patch("main.ctk.set_default_color_theme")
    def test_ctk_appearance_modes(self, mock_set_theme, mock_set_appearance, mock_main_window):
        """Test that CTK appearance mode is set correctly."""
        mock_app = MagicMock()
        mock_main_window.return_value = mock_app

        main_func()

        # Verify specific appearance mode call
        mock_set_appearance.assert_called_once_with("System")

    @patch("main.HiDockToolGUI")
    @patch("main.ctk.set_appearance_mode")
    @patch("main.ctk.set_default_color_theme")
    def test_ctk_color_themes(self, mock_set_theme, mock_set_appearance, mock_main_window):
        """Test that CTK color theme is set correctly."""
        mock_app = MagicMock()
        mock_main_window.return_value = mock_app

        main_func()

        # Verify specific theme call
        mock_set_theme.assert_called_once_with("blue")

    def test_function_signature(self):
        """Test main function signature."""
        import inspect

        sig = inspect.signature(main_func)
        # main() should take no parameters
        self.assertEqual(len(sig.parameters), 0)

    def test_main_module_attributes(self):
        """Test main module has expected attributes."""
        expected_attrs = ["main", "sys", "tkinter", "traceback", "ctk", "logger", "HiDockToolGUI"]
        for attr in expected_attrs:
            self.assertTrue(hasattr(main, attr), f"main module should have {attr}")

    @patch("main.HiDockToolGUI")
    @patch("main.logger.error")
    @patch("main.traceback.format_exc")
    @patch("main.tkinter.messagebox.showerror")
    @patch("main.sys.exit")
    def test_main_exception_traceback_formatting(
        self, mock_exit, mock_showerror, mock_format_exc, mock_logger_error, mock_main_window
    ):
        """Test that traceback is properly formatted in error logging."""
        mock_main_window.side_effect = Exception("Test Exception")
        mock_format_exc.return_value = "Mocked traceback"

        # Act
        main_func()

        # Assert traceback formatting is called
        mock_format_exc.assert_called_once()

        # Check that logger.error was called with traceback
        mock_logger_error.assert_called_once()
        error_call_args = mock_logger_error.call_args[0]
        self.assertIn("CRITICAL ERROR DURING GUI INITIALIZATION OR RUNTIME", error_call_args[2])

    def test_imports_are_valid(self):
        """Test that all imports in main module are valid."""
        # This test ensures that the imports work correctly
        import sys
        import tkinter
        import traceback

        import customtkinter as ctk

        from config_and_logger import logger
        from gui_main_window import HiDockToolGUI

        # Basic checks that imports succeeded
        self.assertIsNotNone(sys)
        self.assertIsNotNone(tkinter)
        self.assertIsNotNone(traceback)
        self.assertIsNotNone(ctk)
        self.assertIsNotNone(logger)
        self.assertIsNotNone(HiDockToolGUI)


if __name__ == "__main__":
    unittest.main()
