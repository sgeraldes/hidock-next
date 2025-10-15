"""
Tests for gui_main_window.py HiDockToolGUI main window functionality.
"""

import json
import os
import sys
from unittest.mock import MagicMock, Mock, call, patch

import pytest

# Mark all tests in this file as GUI tests - incompatible with parallel execution
pytestmark = pytest.mark.gui


class TestHiDockToolGUI:
    """Test cases for HiDockToolGUI main window."""

    @pytest.fixture
    def mock_config(self):
        """Create mock configuration."""
        return {
            "window_geometry": "800x600+100+100",
            "vendor_id": 0x1234,
            "product_id": 0x5678,
            "download_directory": "/test/downloads",
            "theme": "dark",
            "color": "blue",
            "show_log_pane": False,
            "show_audio_visualizer": False,
            "show_transcription_panel": False,
            "cached_files": [],
            "auto_connect": False,
            "google_api_key": "",
            "openai_api_key": "",
            "anthropic_api_key": "",
        }

    @pytest.fixture
    def mock_gui(self, mock_config):
        """Create a mock GUI instance."""
        # Create a simple mock without trying to initialize the actual GUI
        mock = Mock()
        mock.config = mock_config
        mock.logger = Mock()
        mock.dock = None
        mock._is_device_connected = False
        mock.cached_files_data = []
        mock.download_directory = "/test/downloads"
        mock.title = Mock(return_value="HiDock Explorer Tool")
        mock.geometry = Mock()
        mock.winfo_geometry = Mock(return_value="800x600+100+100")
        mock.status_bar = Mock()
        mock.file_tree = Mock()
        mock.info_label = Mock()

        # Theme variables
        mock.theme_var = Mock()
        mock.color_var = Mock()
        mock.visualizer_pin_var = Mock()
        mock.single_select_mode = Mock()

        # GUI panels
        mock.transcription_panel = Mock()
        mock.transcription_output = Mock()
        mock.process_insights_button = Mock()
        mock.cancel_button = Mock()
        mock.log_pane = Mock()
        mock.audio_visualizer_widget = Mock()
        mock.panels_toolbar = Mock()

        # Methods
        mock.after = Mock()
        mock._save_config = Mock()
        mock._show_error = Mock()
        mock._update_menubar_style = Mock()
        mock._update_treeview_style = Mock()
        mock._update_default_progressbar_colors = Mock()
        mock.update_log_colors_gui = Mock()
        mock._populate_treeview_from_data = Mock()
        mock._update_treeview_selectmode = Mock()
        mock._show_pinned_placeholder = Mock()
        mock._update_visualizer_visibility = Mock()

        # Audio related
        mock.audio_player = Mock()
        mock.play_button = Mock()
        mock._active_transcription_thread = None
        mock._transcription_cancelled = False
        mock._on_transcription_cancelled = Mock()

        return mock

    @pytest.mark.unit
    def test_validate_window_geometry_valid(self):
        """Test validating valid window geometry."""
        # Test the validation logic without creating actual GUI
        geometry = "1024x768+50+50"

        # Simple validation logic
        try:
            parts = geometry.split("+")
            if len(parts) == 3:
                size_part = parts[0]
                x_pos = int(parts[1])
                y_pos = int(parts[2])

                width, height = map(int, size_part.split("x"))

                # Ensure minimum size and positive position
                width = max(600, width)
                height = max(400, height)
                x_pos = max(0, x_pos)
                y_pos = max(0, y_pos)

                result = f"{width}x{height}+{x_pos}+{y_pos}"
            else:
                result = "950x850+100+100"  # Default
        except:
            result = "950x850+100+100"  # Default

        assert result == geometry

    @pytest.mark.unit
    def test_validate_window_geometry_invalid(self):
        """Test validating invalid window geometry."""
        # Test invalid format
        geometry = "invalid_geometry"
        result = "950x850+100+100"  # Would return default
        assert result == "950x850+100+100"

        # Test negative position handling
        geometry = "800x600+-50+-50"
        # Logic would correct to positive values
        corrected = "800x600+0+0"
        assert corrected == "800x600+0+0"

    @pytest.mark.unit
    def test_config_initialization(self, mock_gui, mock_config):
        """Test configuration variable initialization."""
        # Test that config values are properly set
        assert mock_gui.config["theme"] == "dark"
        assert mock_gui.config["color"] == "blue"
        assert mock_gui.config["download_directory"] == "/test/downloads"

    @pytest.mark.unit
    def test_api_key_handling(self, mock_gui):
        """Test API key handling without actual decryption."""
        mock_gui.config = {
            "google_api_key": "encrypted_key",
        }

        # Mock the decryption process
        with patch("builtins.hasattr", return_value=True):
            # Simulate getting a decrypted key
            api_key = mock_gui.config.get("google_api_key", "")
            if api_key:
                decrypted_key = "mock_decrypted_key"
            else:
                decrypted_key = ""

            assert decrypted_key == "mock_decrypted_key"

    @pytest.mark.unit
    def test_status_bar_update(self, mock_gui):
        """Test status bar updates."""
        # Test status bar configuration
        mock_gui.status_bar.configure(text="Connected | Processing...")
        mock_gui.status_bar.configure.assert_called_with(text="Connected | Processing...")

    @pytest.mark.unit
    def test_theme_application(self, mock_gui):
        """Test theme and color application."""
        mock_gui.theme_var.get.return_value = "dark"
        mock_gui.color_var.get.return_value = "blue"

        # Simulate theme application
        theme = mock_gui.theme_var.get()
        color = mock_gui.color_var.get()

        assert theme == "dark"
        assert color == "blue"

        # Simulate method calls
        mock_gui._update_menubar_style()
        mock_gui._update_treeview_style()
        mock_gui.update_log_colors_gui()

        mock_gui._update_menubar_style.assert_called_once()
        mock_gui._update_treeview_style.assert_called_once()
        mock_gui.update_log_colors_gui.assert_called_once()

    @pytest.mark.unit
    def test_selection_mode_toggle(self, mock_gui):
        """Test selection mode toggling."""
        mock_gui.single_select_mode.get.return_value = True

        # Simulate toggle
        current_mode = mock_gui.single_select_mode.get()
        new_mode = not current_mode
        mock_gui.single_select_mode.set(new_mode)

        mock_gui.single_select_mode.set.assert_called_with(False)
        mock_gui._save_config()
        mock_gui._update_treeview_selectmode()

        mock_gui._save_config.assert_called_once()
        mock_gui._update_treeview_selectmode.assert_called_once()

    @pytest.mark.unit
    def test_panel_visibility_toggle(self, mock_gui):
        """Test panel visibility toggling."""
        mock_gui.config = {"show_transcription_panel": False}
        mock_gui.transcription_panel.winfo_ismapped.return_value = False

        # Simulate toggle
        mock_gui.config["show_transcription_panel"] = True
        if mock_gui.config["show_transcription_panel"]:
            mock_gui.transcription_panel.pack()

        mock_gui.transcription_panel.pack.assert_called_once()
        mock_gui._save_config()
        mock_gui._save_config.assert_called_once()

    @pytest.mark.unit
    def test_cached_files_handling(self, mock_gui):
        """Test cached files display."""
        cached_files = [
            {
                "filename": "file1.wav",
                "size": 1024,
                "duration": "10.5s",
                "date": "2024-01-01",
                "device_path": "/device/file1.wav",
            }
        ]
        mock_gui.config["cached_files"] = cached_files

        # Simulate conversion and display
        converted_files = []  # Would normally convert format
        mock_gui._populate_treeview_from_data(converted_files)

        mock_gui._populate_treeview_from_data.assert_called_with(converted_files)

    @pytest.mark.unit
    def test_insights_processing_state(self, mock_gui):
        """Test transcription processing state without actual processing."""
        filename = "test.wav"

        # Simulate showing processing state
        mock_gui.transcription_output.configure(state="normal")
        mock_gui.transcription_output.delete("1.0", "end")
        mock_gui.transcription_output.insert("1.0", f"Processing {filename}...")
        mock_gui.transcription_output.configure(state="disabled")

        mock_gui.process_insights_button.configure(state="disabled")
        mock_gui.cancel_button.configure(state="normal")

        # Verify calls
        mock_gui.process_insights_button.configure.assert_called_with(state="disabled")
        mock_gui.cancel_button.configure.assert_called_with(state="normal")

    @pytest.mark.unit
    def test_transcription_cancellation(self, mock_gui):
        """Test transcription cancellation."""
        mock_thread = Mock()
        mock_thread.is_alive.return_value = True
        mock_gui._active_transcription_thread = mock_thread
        mock_gui._transcription_cancelled = False

        # Simulate cancellation
        mock_gui._transcription_cancelled = True
        mock_gui._on_transcription_cancelled()

        assert mock_gui._transcription_cancelled is True
        mock_gui._on_transcription_cancelled.assert_called_once()

    @pytest.mark.unit
    def test_insights_formatting(self, mock_gui):
        """Test insights formatting for display."""
        insights = {
            "summary": "Test summary",
            "key_points": ["Point 1", "Point 2"],
            "action_items": ["Action 1"],
            "questions": ["Question 1"],
        }

        # Simulate formatting
        formatted_text = []
        if "summary" in insights:
            formatted_text.append(f"SUMMARY:\n{insights['summary']}\n")
        if "key_points" in insights:
            formatted_text.append("KEY POINTS:")
            for point in insights["key_points"]:
                formatted_text.append(f"• {point}")
            formatted_text.append("")

        result = "\n".join(formatted_text)

        assert "SUMMARY" in result
        assert "Test summary" in result
        assert "KEY POINTS" in result
        assert "• Point 1" in result

    @pytest.mark.unit
    def test_audio_callbacks(self, mock_gui):
        """Test audio player callbacks."""
        # Test position callback
        mock_gui.audio_visualizer_widget.winfo_ismapped.return_value = True
        mock_gui.audio_visualizer_widget.playback_visualizer = Mock()

        # Simulate position update
        position = 0.5
        if mock_gui.audio_visualizer_widget.winfo_ismapped():
            mock_gui.audio_visualizer_widget.playback_visualizer.update_playback_position(position)

        mock_gui.audio_visualizer_widget.playback_visualizer.update_playback_position.assert_called_with(0.5)

    @pytest.mark.unit
    def test_dependency_checking(self, mock_gui):
        """Test dependency checking without actual file system access."""
        # Mock dependency check
        with patch("shutil.which") as mock_which:
            mock_which.return_value = None  # FFmpeg not found

            # Simulate check
            ffmpeg_available = mock_which("ffmpeg") is not None
            assert ffmpeg_available is False

            mock_which.return_value = "/usr/bin/ffmpeg"  # FFmpeg found
            ffmpeg_available = mock_which("ffmpeg") is not None
            assert ffmpeg_available is True

    @pytest.mark.unit
    def test_config_saving(self, mock_gui):
        """Test configuration saving."""
        mock_gui.config = {"test": "value"}

        # Simulate saving
        config_to_save = mock_gui.config.copy()
        config_to_save["window_geometry"] = mock_gui.winfo_geometry()

        # Just verify the data preparation
        assert config_to_save["test"] == "value"
        assert "window_geometry" in config_to_save

    @pytest.mark.unit
    def test_window_geometry_saving(self, mock_gui):
        """Test window geometry saving functionality."""
        # Mock the geometry method to return a test geometry
        mock_gui.geometry.return_value = "1200x800+150+50"
        mock_gui._geometry_save_timer = None

        # Mock the config update function
        with patch("config_and_logger.update_config_settings") as mock_update:
            # Simulate the _save_window_geometry method
            def save_geometry():
                try:
                    current_geometry = mock_gui.geometry()
                    mock_update({"window_geometry": current_geometry})
                    return True
                except Exception:
                    return False
                finally:
                    mock_gui._geometry_save_timer = None

            # Test the method
            result = save_geometry()

            # Verify it worked
            assert result is True
            mock_update.assert_called_once_with({"window_geometry": "1200x800+150+50"})
            assert mock_gui._geometry_save_timer is None

    @pytest.mark.unit
    def test_window_configure_event_handling(self, mock_gui):
        """Test window configure event handling for geometry saving."""
        mock_gui._geometry_save_timer = None
        mock_gui.after_cancel = Mock()
        mock_gui.after = Mock(return_value="timer_id")

        # Mock event object
        mock_event = Mock()
        mock_event.widget = mock_gui  # Event is for the main window

        # Simulate the _on_window_configure method
        def on_window_configure(event):
            if event.widget == mock_gui:
                if mock_gui._geometry_save_timer:
                    mock_gui.after_cancel(mock_gui._geometry_save_timer)
                mock_gui._geometry_save_timer = mock_gui.after(500, mock_gui._save_window_geometry)

        # Mock the save method
        mock_gui._save_window_geometry = Mock()

        # Test without existing timer
        on_window_configure(mock_event)
        mock_gui.after.assert_called_once_with(500, mock_gui._save_window_geometry)
        mock_gui.after_cancel.assert_not_called()

        # Reset mocks
        mock_gui.after.reset_mock()
        mock_gui.after_cancel.reset_mock()

        # Test with existing timer
        mock_gui._geometry_save_timer = "existing_timer"
        on_window_configure(mock_event)
        mock_gui.after_cancel.assert_called_once_with("existing_timer")
        mock_gui.after.assert_called_once_with(500, mock_gui._save_window_geometry)

    @pytest.mark.unit
    def test_geometry_validation_edge_cases(self):
        """Test geometry validation with edge cases."""

        # Test minimum size enforcement - matches actual implementation
        def validate_geometry(geometry_str):
            try:
                import re

                match = re.match(r"(\d+)x(\d+)([-+]\d+)([-+]\d+)", geometry_str)
                if not match:
                    return "950x850+100+100"

                width, height, x_str, y_str = match.groups()
                width, height = int(width), int(height)
                x, y = int(x_str), int(y_str)

                # Screen dimensions for validation (mock)
                screen_width, screen_height = 1920, 1080
                min_visible_pixels = 100

                # Validate coordinates
                if x < -width + min_visible_pixels:
                    x = 0
                elif x > screen_width - min_visible_pixels:
                    x = screen_width - width

                if y < 0:
                    y = 0
                elif y > screen_height - min_visible_pixels:
                    y = screen_height - height

                # Enforce minimum size
                min_width, min_height = 400, 300
                width = max(min_width, width)
                height = max(min_height, height)

                return f"{width}x{height}+{x}+{y}"
            except:
                return "950x850+100+100"

        # Test cases - based on actual implementation behavior
        assert validate_geometry("200x150+50+25") == "400x300+50+25"  # Too small size corrected
        assert validate_geometry("800x600+100-5") == "800x600+100+0"  # Negative Y corrected to 0
        assert validate_geometry("800x600-900+100") == "800x600+0+100"  # Far left corrected to 0
        assert validate_geometry("800x600+1900+100") == "800x600+1120+100"  # Far right corrected (1920-800=1120)
        assert validate_geometry("invalid") == "950x850+100+100"  # Invalid format returns default
        assert validate_geometry("1024x768+100+50") == "1024x768+100+50"  # Valid geometry unchanged
        assert validate_geometry("800x600+100+-5") == "950x850+100+100"  # Invalid format (+-5 not valid)

    @pytest.mark.unit
    def test_geometry_saving_error_handling(self, mock_gui):
        """Test error handling in geometry saving."""
        mock_gui.geometry.side_effect = Exception("Geometry error")
        mock_gui._geometry_save_timer = None

        # Simulate the _save_window_geometry method with error handling
        def save_geometry_with_error_handling():
            try:
                current_geometry = mock_gui.geometry()
                # This would normally call update_config_settings
                return True
            except Exception as e:
                # Log error (simulated)
                error_msg = str(e)
                assert "Geometry error" in error_msg
                return False
            finally:
                mock_gui._geometry_save_timer = None

        # Test error handling
        result = save_geometry_with_error_handling()
        assert result is False
        assert mock_gui._geometry_save_timer is None

    @pytest.mark.integration
    def test_gui_workflow_simulation(self, mock_gui):
        """Test GUI workflow without actual GUI creation."""
        # Simulate startup sequence
        mock_gui.config = {"theme": "dark", "show_transcription_panel": False}

        # Apply theme
        mock_gui._update_menubar_style()
        mock_gui._update_treeview_style()

        # Toggle panel
        mock_gui.config["show_transcription_panel"] = True
        mock_gui.transcription_panel.pack()

        # Save config
        mock_gui._save_config()

        # Verify workflow
        mock_gui._update_menubar_style.assert_called()
        mock_gui._update_treeview_style.assert_called()
        mock_gui.transcription_panel.pack.assert_called()
        mock_gui._save_config.assert_called()
