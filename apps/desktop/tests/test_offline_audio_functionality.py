#!/usr/bin/env python3
"""
Test for offline audio functionality - playing and getting insights from downloaded files when disconnected.

Following TDD principles to ensure offline audio operations work correctly.
"""

import os
import tempfile
from unittest.mock import MagicMock, Mock, patch

import customtkinter as ctk
import pytest

# Mark all tests in this file as GUI tests - incompatible with parallel execution
pytestmark = pytest.mark.gui


class TestOfflineAudioFunctionality:
    """Test audio playback and insights functionality when disconnected."""

    def setup_method(self):
        """Set up test fixtures."""
        self.temp_dir = tempfile.mkdtemp()
        self.test_audio_file = os.path.join(self.temp_dir, "test_audio.wav")

        # Create a dummy audio file
        with open(self.test_audio_file, "wb") as f:
            f.write(b"dummy audio data")

    def teardown_method(self):
        """Clean up test fixtures."""
        import shutil

        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_can_play_downloaded_audio_when_disconnected(self):
        """Test that downloaded audio files can be played when device is disconnected."""

        # Mock the GUI components and dependencies
        with patch("gui_main_window.ctk.CTk"), patch("gui_main_window.EnhancedAudioPlayer") as mock_audio_player, patch(
            "gui_main_window.DesktopDeviceAdapter"
        ) as mock_adapter, patch("gui_main_window.DeviceManager") as mock_device_manager:
            # Set up mocks
            mock_device_interface = Mock()
            mock_device_interface.is_connected.return_value = False  # Device is disconnected
            mock_device_manager.return_value.device_interface = mock_device_interface

            mock_player_instance = Mock()
            mock_audio_player.return_value = mock_player_instance

            # Import and create GUI instance
            from gui_main_window import HiDockToolGUI

            gui = HiDockToolGUI()

            # Set up test data - simulate a downloaded file
            gui.displayed_files_details = [
                {"name": "test_audio.wav", "local_path": self.test_audio_file, "length": 1024, "duration": "00:01:00"}
            ]

            # Mock the file tree selection
            gui.file_tree = Mock()
            gui.file_tree.selection.return_value = ["test_audio.wav"]
            gui.file_tree.winfo_exists.return_value = True
            gui.file_tree.get_children.return_value = ["test_audio.wav"]
            gui.file_tree.item.return_value = {"values": ["test_audio.wav", "Downloaded", "1024", "00:01:00"]}

            # Mock _get_local_filepath to return our test file
            gui._get_local_filepath = Mock(return_value=self.test_audio_file)

            # Test: Should be able to play the downloaded file even when disconnected
            gui.play_selected_audio_gui()

            # Verify that the audio player was called to play the file
            mock_player_instance.load_track.assert_called_once_with(self.test_audio_file)
            mock_player_instance.play.assert_called_once()

            # Clean up GUI
            gui.destroy()

    def test_can_get_insights_from_downloaded_audio_when_disconnected(self):
        """Test that insights can be extracted from downloaded audio files when disconnected."""

        # Mock the GUI components and dependencies
        with patch("gui_main_window.ctk.CTk"), patch("gui_main_window.EnhancedAudioPlayer"), patch(
            "gui_main_window.DesktopDeviceAdapter"
        ) as mock_adapter, patch("gui_main_window.DeviceManager") as mock_device_manager, patch(
            "gui_main_window.process_audio_file_for_insights"
        ) as mock_insights:
            # Set up mocks
            mock_device_interface = Mock()
            mock_device_interface.is_connected.return_value = False  # Device is disconnected
            mock_device_manager.return_value.device_interface = mock_device_interface

            # Mock insights processing
            mock_insights.return_value = {
                "transcription": "Test transcription",
                "insights": {"summary": "Test summary"},
            }

            # Import and create GUI instance
            from gui_main_window import HiDockToolGUI

            gui = HiDockToolGUI()

            # Set up test data - simulate a downloaded file
            gui.displayed_files_details = [
                {"name": "test_audio.wav", "local_path": self.test_audio_file, "length": 1024, "duration": "00:01:00"}
            ]

            # Mock the file tree selection
            gui.file_tree = Mock()
            gui.file_tree.selection.return_value = ["test_audio.wav"]
            gui.file_tree.winfo_exists.return_value = True
            gui.file_tree.get_children.return_value = ["test_audio.wav"]
            gui.file_tree.item.return_value = {"values": ["test_audio.wav", "Downloaded", "1024", "00:01:00"]}

            # Mock _get_local_filepath to return our test file
            gui._get_local_filepath = Mock(return_value=self.test_audio_file)

            # Mock API key retrieval
            gui.get_decrypted_api_key = Mock(return_value="test_api_key")

            # Mock AI configuration variables
            gui.ai_api_provider_var = Mock()
            gui.ai_api_provider_var.get.return_value = "gemini"
            gui.ai_model_var = Mock()
            gui.ai_model_var.get.return_value = "gemini-2.5-flash"
            gui.ai_temperature_var = Mock()
            gui.ai_temperature_var.get.return_value = 0.3
            gui.ai_max_tokens_var = Mock()
            gui.ai_max_tokens_var.get.return_value = 4000
            gui.ai_language_var = Mock()
            gui.ai_language_var.get.return_value = "auto"

            # Mock transcription panel methods
            gui._show_transcription_processing_state = Mock()
            gui._update_panels_toolbar_visibility = Mock()
            gui._set_long_operation_active_state = Mock()
            gui.update_status_bar = Mock()

            # Test: Should be able to get insights from downloaded file when disconnected
            gui.get_insights_selected_file_gui()

            # Verify that insights processing was initiated
            gui._show_transcription_processing_state.assert_called_once_with("test_audio.wav")

            # Clean up GUI
            gui.destroy()

    def test_menu_states_allow_offline_operations(self):
        """Test that menu states correctly enable offline operations for downloaded files."""

        # Mock the GUI components and dependencies
        with patch("gui_main_window.ctk.CTk"), patch("gui_main_window.EnhancedAudioPlayer"), patch(
            "gui_main_window.DesktopDeviceAdapter"
        ) as mock_adapter, patch("gui_main_window.DeviceManager") as mock_device_manager:
            # Set up mocks
            mock_device_interface = Mock()
            mock_device_interface.is_connected.return_value = False  # Device is disconnected
            mock_device_manager.return_value.device_interface = mock_device_interface

            # Import and create GUI instance
            from gui_main_window import HiDockToolGUI

            gui = HiDockToolGUI()

            # Set up test data - simulate a downloaded file
            gui.displayed_files_details = [
                {"name": "test_audio.wav", "local_path": self.test_audio_file, "length": 1024, "duration": "00:01:00"}
            ]

            # Mock the file tree selection
            gui.file_tree = Mock()
            gui.file_tree.selection.return_value = ["test_audio.wav"]
            gui.file_tree.winfo_exists.return_value = True
            gui.file_tree.get_children.return_value = ["test_audio.wav"]
            gui.file_tree.item.return_value = {"values": ["test_audio.wav", "Downloaded", "1024", "00:01:00"]}

            # Mock _get_local_filepath to return our test file (exists)
            gui._get_local_filepath = Mock(return_value=self.test_audio_file)

            # Mock menu components
            gui.actions_menu = Mock()
            gui.toolbar_play_button = Mock()
            gui.toolbar_play_button.winfo_exists.return_value = True
            gui.toolbar_insights_button = Mock()
            gui.toolbar_insights_button.winfo_exists.return_value = True

            # Mock other required attributes
            gui.is_long_operation_active = False
            gui.is_audio_playing = False

            # Test: Update menu states should enable play and insights for downloaded files
            gui._update_menu_states()

            # Verify that play and insights actions are enabled for downloaded files
            gui.actions_menu.entryconfig.assert_any_call("Play Selected", state="normal")
            gui.actions_menu.entryconfig.assert_any_call("Get Insights", state="normal")
            gui.toolbar_play_button.configure.assert_called()
            gui.toolbar_insights_button.configure.assert_called()

            # Clean up GUI
            gui.destroy()

    def test_cannot_play_non_downloaded_audio_when_disconnected(self):
        """Test that non-downloaded audio files cannot be played when disconnected."""

        # Mock the GUI components and dependencies
        with patch("gui_main_window.ctk.CTk"), patch("gui_main_window.EnhancedAudioPlayer") as mock_audio_player, patch(
            "gui_main_window.DesktopDeviceAdapter"
        ) as mock_adapter, patch("gui_main_window.DeviceManager") as mock_device_manager:
            # Set up mocks
            mock_device_interface = Mock()
            mock_device_interface.is_connected.return_value = False  # Device is disconnected
            mock_device_manager.return_value.device_interface = mock_device_interface

            mock_player_instance = Mock()
            mock_audio_player.return_value = mock_player_instance

            # Import and create GUI instance
            from gui_main_window import HiDockToolGUI

            gui = HiDockToolGUI()

            # Set up test data - simulate a non-downloaded file
            gui.displayed_files_details = [
                {
                    "name": "not_downloaded.wav",
                    "local_path": None,  # Not downloaded
                    "length": 1024,
                    "duration": "00:01:00",
                }
            ]

            # Mock the file tree selection
            gui.file_tree = Mock()
            gui.file_tree.selection.return_value = ["not_downloaded.wav"]
            gui.file_tree.winfo_exists.return_value = True
            gui.file_tree.get_children.return_value = ["not_downloaded.wav"]
            gui.file_tree.item.return_value = {"values": ["not_downloaded.wav", "Not Downloaded", "0", "00:00:00"]}

            # Mock _get_local_filepath to return non-existent file
            non_existent_file = os.path.join(self.temp_dir, "not_downloaded.wav")
            gui._get_local_filepath = Mock(return_value=non_existent_file)

            # Mock messagebox to capture the error
            with patch("gui_main_window.messagebox") as mock_messagebox:
                # Test: Should not be able to play non-downloaded file when disconnected
                gui.play_selected_audio_gui()

                # Verify that an error message is shown and audio player is not called
                mock_messagebox.showinfo.assert_called_once()
                mock_player_instance.load_track.assert_not_called()
                mock_player_instance.play.assert_not_called()

            # Clean up GUI
            gui.destroy()
