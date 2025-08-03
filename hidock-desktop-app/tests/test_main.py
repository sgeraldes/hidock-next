import os
import sys
import unittest
from unittest.mock import MagicMock, patch

import main
from main import main as main_func

# Add the project root to the Python path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


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


if __name__ == "__main__":
    unittest.main()
