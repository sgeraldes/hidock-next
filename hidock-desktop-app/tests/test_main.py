import unittest
from unittest.mock import patch, MagicMock
import sys
import os

# Add the project root to the Python path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from main import main

class TestMain(unittest.TestCase):
    @patch('main.HiDockToolGUI')
    @patch('main.ctk.set_appearance_mode')
    @patch('main.ctk.set_default_color_theme')
    def test_main_initialization(self, mock_set_theme, mock_set_appearance, mock_main_window):
        # Arrange
        mock_app = MagicMock()
        mock_main_window.return_value = mock_app

        # Act
        main()

        # Assert
        mock_set_appearance.assert_called_once_with("System")
        mock_set_theme.assert_called_once_with("blue")
        mock_main_window.assert_called_once()
        mock_app.mainloop.assert_called_once()

    @patch('main.HiDockToolGUI')
    @patch('main.logger.error')
    @patch('main.tkinter.messagebox.showerror')
    @patch('main.sys.exit')
    def test_main_exception(self, mock_exit, mock_showerror, mock_logger_error, mock_main_window):
        # Arrange
        mock_main_window.side_effect = Exception("Test Exception")

        # Act
        main()

        # Assert
        mock_logger_error.assert_called_once()
        mock_showerror.assert_called_once()
        mock_exit.assert_called_once_with(1)

if __name__ == '__main__':
    unittest.main()
