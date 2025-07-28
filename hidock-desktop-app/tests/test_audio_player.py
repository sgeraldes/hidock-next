import unittest
from unittest.mock import MagicMock, patch, call
import os
import threading
import tkinter

# Import the AudioPlayerMixin at the top level
from audio_player import AudioPlayerMixin

# Patch the modules within the audio_player module's namespace
@patch('audio_player.logger')
@patch('audio_player.pygame')
@patch('audio_player.ctk')
@patch('tkinter.messagebox')
class TestAudioPlayerInitialization(unittest.TestCase):

    def setUp(self, mock_messagebox, mock_ctk, mock_pygame, mock_logger):
        # The patched modules are now directly available in the audio_player module
        # We can access them via import within the test methods or by re-importing
        # them here if needed for setup.
        import audio_player
        self.mock_logger = audio_player.logger
        self.mock_pygame = audio_player.pygame
        self.mock_ctk = audio_player.ctk
        self.mock_messagebox = mock_messagebox # Assign the patched messagebox

        # Configure pygame mocks
        self.mock_pygame.mixer.music = MagicMock()
        self.mock_pygame.mixer.get_init = MagicMock(return_value=True) # Corrected mocking
        self.mock_pygame.error = type('PygameError', (Exception,), {}) # Mock pygame.error as a class

        # Configure CTkinter mocks
        self.mock_ctk.CTkFrame.return_value = MagicMock(spec=tkinter.Frame)
        self.mock_ctk.CTkLabel.return_value = MagicMock(spec=tkinter.Label)
        self.mock_ctk.CTkSlider.return_value = MagicMock(spec=tkinter.Scale)
        self.mock_ctk.CTkCheckBox.return_value = MagicMock(spec=tkinter.Checkbutton)

        # Reset mocks before each test
        self.mock_messagebox.reset_mock()
        self.mock_logger.reset_mock()
        self.mock_pygame.mixer.music.reset_mock()
        self.mock_pygame.mixer.reset_mock()
        # self.mock_pygame.reset_mock() # This line is problematic, as it resets the get_init mock

        self.app = MockApp()

        # Call _create_playback_controls to set up the mocked CTk widgets in the app instance
        self.app._create_playback_controls()


    class MockApp(AudioPlayerMixin):
        def __init__(self):
            self.file_tree = MagicMock()
            self.displayed_files_details = []
            self.is_audio_playing = False
            self.dock = MagicMock()
            self.file_stream_timeout_s_var = MagicMock(get=MagicMock(return_value=10))
            self.cancel_operation_event = MagicMock()
            self.current_playing_filename_for_replay = None
            self.playback_total_duration = 0
            self.volume_var = MagicMock(get=MagicMock(return_value=0.5))
            self.playback_update_timer_id = None
            self._user_is_dragging_slider = False
            self.loop_playback_var = MagicMock(get=MagicMock(return_value=False))
            self.status_bar_frame = MagicMock()
            self.playback_controls_frame = None # Initialize as None

        def _get_local_filepath(self, filename):
            return f"local/path/{filename}"

        def _set_long_operation_active_state(self, state, operation):
            pass

        def update_status_bar(self, progress_text):
            pass

        def _update_file_status_in_treeview(self, file_iid, status_text, status_tags):
            pass

        # These methods will use the patched imports from audio_player.py
        def _start_audio_playback(self, filepath, file_detail):
            import pygame
            self.is_audio_playing = True
            pygame.mixer.music.load(filepath)
            pygame.mixer.music.set_volume(self.volume_var.get())
            pygame.mixer.music.play()

        def _stop_audio_playback(self):
            import pygame
            self.is_audio_playing = False
            pygame.mixer.music.stop()

        def _create_playback_controls(self):
            import customtkinter as ctk
            self.playback_controls_frame = ctk.CTkFrame.return_value
            self.playback_controls_frame.winfo_exists.return_value = True
            self.current_time_label = ctk.CTkLabel.return_value
            self.playback_slider = ctk.CTkSlider.return_value
            self.total_duration_label = ctk.CTkLabel.return_value
            self.volume_slider_widget = ctk.CTkSlider.return_value
            self.loop_checkbox = ctk.CTkCheckBox.return_value

        def _destroy_playback_controls(self):
            if self.playback_controls_frame and self.playback_controls_frame.winfo_exists():
                self.playback_controls_frame.destroy()
                self.playback_controls_frame = None

        def _update_playback_progress(self):
            pass

        def _update_menu_states(self):
            pass

        def refresh_file_list_gui(self):
            pass

        def after(self, ms, func, *args):
            # Simulate tkinter.after by directly calling the function
            func(*args)


    @patch('audio_player.pygame', None) # Simulate pygame not loaded
    def test_play_selected_audio_gui_no_pygame(self):
        self.app.play_selected_audio_gui()
        self.mock_messagebox.showerror.assert_called_once_with(
            "Playback Error", "Pygame module not loaded. Cannot play audio.", parent=self.app
        )
        self.assertFalse(self.app.is_audio_playing)

    def test_play_selected_audio_gui_audio_playing(self):
        self.app.is_audio_playing = True
        self.app._stop_audio_playback = MagicMock()
        self.app.play_selected_audio_gui()
        self.app._stop_audio_playback.assert_called_once()
        self.assertFalse(self.app.is_audio_playing)

    def test_play_selected_audio_gui_no_selection(self):
        self.app.file_tree.selection.return_value = []
        self.app.play_selected_audio_gui()
        self.mock_messagebox.showinfo.assert_called_once_with(
            "Playback", "Please select a single audio file to play.", parent=self.app
        )
        self.assertFalse(self.app.is_audio_playing)

    def test_play_selected_audio_gui_multiple_selections(self):
        self.app.file_tree.selection.return_value = ["file1", "file2"]
        self.app.play_selected_audio_gui()
        self.mock_messagebox.showinfo.assert_called_once_with(
            "Playback", "Please select a single audio file to play.", parent=self.app
        )
        self.assertFalse(self.app.is_audio_playing)

    @patch('os.path.exists', return_value=True)
    def test_download_for_playback_thread_success(self, mock_exists, mock_open, mock_rename, mock_remove):
        file_info = {"name": "test_file.mp3", "length": 100}
        local_path = "local/path/test_file.mp3"
        self.app.dock.stream_file.return_value = "OK"
        self.app._start_audio_playback = MagicMock()
        self.app._set_long_operation_active_state = MagicMock()
        self.app.refresh_file_list_gui = MagicMock()

        self.app._download_for_playback_thread(file_info, local_path)

        self.app.dock.stream_file.assert_called_once()
        mock_open.assert_called_once_with(local_path + ".tmp", "wb")
        mock_remove.assert_called_once_with(local_path)
        mock_rename.assert_called_once_with(local_path + ".tmp", local_path)
        self.app._start_audio_playback.assert_called_once_with(local_path, file_info)
        self.app._set_long_operation_active_state.assert_called_with(False, "Playback Preparation")
        self.app.refresh_file_list_gui.assert_called_once()

    @patch('os.path.exists', return_value=False)
    @patch('builtins.open', new_callable=unittest.mock.mock_open)
    def test_download_for_playback_thread_stream_failure(self, mock_open, mock_exists):
        file_info = {"name": "test_file.mp3", "length": 100}
        local_path = "local/path/test_file.mp3"
        self.app.dock.stream_file.return_value = "ERROR"
        self.app._set_long_operation_active_state = MagicMock()
        self.app.refresh_file_list_gui = MagicMock()

        self.app._download_for_playback_thread(file_info, local_path)

        self.mock_messagebox.showerror.assert_called_once_with(
            "Playback Error", f"Failed to download file: Stream failed: ERROR", parent=self.app
        )
        self.app._set_long_operation_active_state.assert_called_with(False, "Playback Preparation")
        self.app.refresh_file_list_gui.assert_called_once()
        self.mock_logger.error.assert_called_once()

    @patch('os.path.exists', return_value=False)
    @patch('builtins.open', side_effect=IOError("Disk Full"))
    def test_download_for_playback_thread_io_error(self, mock_open, mock_exists):
        file_info = {"name": "test_file.mp3", "length": 100}
        local_path = "local/path/test_file.mp3"
        self.app._set_long_operation_active_state = MagicMock()
        self.app.refresh_file_list_gui = MagicMock()

        self.app._download_for_playback_thread(file_info, local_path)

        self.mock_messagebox.showerror.assert_called_once_with(
            "Playback Error", f"Failed to download file: Disk Full", parent=self.app
        )
        self.app._set_long_operation_active_state.assert_called_with(False, "Playback Preparation")
        self.app.refresh_file_list_gui.assert_called_once()
        self.mock_logger.error.assert_called_once()

    def test_start_audio_playback_no_pygame_init(self):
        self.mock_pygame.mixer.get_init.return_value = False
        self.app._start_audio_playback("filepath", {"name": "file", "duration": 10})
        self.mock_pygame.mixer.music.load.assert_not_called()
        self.assertFalse(self.app.is_audio_playing)

    def test_start_audio_playback_success(self):
        filepath = "local/path/test_file.mp3"
        file_detail = {"name": "test_file.mp3", "duration": 60}
        self.app._create_playback_controls = MagicMock()
        self.app._update_playback_progress = MagicMock()
        self.app._update_menu_states = MagicMock()
        self.app._update_file_status_in_treeview = MagicMock()

        self.app._start_audio_playback(filepath, file_detail)

        self.assertTrue(self.app.is_audio_playing)
        self.assertEqual(self.app.playback_total_duration, 60)
        self.mock_pygame.mixer.music.load.assert_called_once_with(filepath)
        self.mock_pygame.mixer.music.set_volume.assert_called_once_with(0.5)
        self.mock_pygame.mixer.music.play.assert_called_once()
        self.app._create_playback_controls.assert_called_once()
        self.app._update_playback_progress.assert_called_once()
        self.app._update_menu_states.assert_called_once()
        self.app._update_file_status_in_treeview.assert_called_once_with(
            file_detail["name"], "Playing", ("playing",)
        )

    def test_start_audio_playback_pygame_error(self):
        filepath = "local/path/test_file.mp3"
        file_detail = {"name": "test_file.mp3", "duration": 60}
        self.mock_pygame.mixer.music.load.side_effect = self.mock_pygame.error("Test Pygame Error")
        self.app._destroy_playback_controls = MagicMock()
        self.app._update_menu_states = MagicMock()
        self.app.refresh_file_list_gui = MagicMock()

        self.app._start_audio_playback(filepath, file_detail)

        self.assertFalse(self.app.is_audio_playing)
        self.mock_messagebox.showerror.assert_called_once_with(
            "Playback Error", f"Could not play file: Test Pygame Error", parent=self.app
        )
        self.app._destroy_playback_controls.assert_called_once()
        self.app._update_menu_states.assert_called_once()
        self.app.refresh_file_list_gui.assert_called_once()

    def test_stop_audio_playback_no_pygame_init(self):
        self.mock_pygame.mixer.get_init.return_value = False
        self.app.is_audio_playing = True
        self.app._stop_audio_playback()
        self.mock_pygame.mixer.music.stop.assert_not_called()
        self.assertTrue(self.app.is_audio_playing) # Should not change if pygame not initialized

    def test_stop_audio_playback_success(self):
        self.app.is_audio_playing = True
        self.app.playback_update_timer_id = "timer_id_123"
        self.app._destroy_playback_controls = MagicMock()
        self.app._update_menu_states = MagicMock()
        self.app.refresh_file_list_gui = MagicMock()
        self.app.after_cancel = MagicMock()

        self.app._stop_audio_playback()

        self.mock_pygame.mixer.music.stop.assert_called_once()
        self.assertFalse(self.app.is_audio_playing)
        self.app.after_cancel.assert_called_once_with("timer_id_123")
        self.assertIsNone(self.app.playback_update_timer_id)
        self.app._destroy_playback_controls.assert_called_once()
        self.app._update_menu_states.assert_called_once()
        self.app.refresh_file_list_gui.assert_called_once()
        self.assertIsNone(self.app.current_playing_filename_for_replay)

    def test_create_playback_controls_already_exists(self):
        self.app.playback_controls_frame = MagicMock()
        self.app.playback_controls_frame.winfo_exists.return_value = True
        self.app._create_playback_controls()
        # No calls to pack or CTkFrame expected if already exists

    def test_create_playback_controls_success(self):
        self.app.playback_controls_frame = None # Simulate no existing frame
        self.app.status_bar_frame = MagicMock()
        self.app.playback_total_duration = 125 # 2 minutes 5 seconds
        self.app.volume_var = MagicMock()
        self.app.loop_playback_var = MagicMock()

        self.app._create_playback_controls()

        self.mock_ctk.CTkFrame.assert_called_once_with(self.app.status_bar_frame, fg_color="transparent")
        self.app.playback_controls_frame.pack.assert_called_once_with(side="right", padx=10, pady=2, fill="x")

        self.mock_ctk.CTkLabel.assert_has_calls([
            call(self.app.playback_controls_frame, text="00:00", width=40),
            call(self.app.playback_controls_frame, text="02:05", width=40)
        ])
        self.app.current_time_label.pack.assert_called_once_with(side="left", padx=(0, 5))
        self.app.total_duration_label.pack.assert_called_once_with(side="left", padx=(5, 10))

        self.mock_ctk.CTkSlider.assert_has_calls([
            call(self.app.playback_controls_frame, from_=0, to=125, command=self.app._on_playback_slider_drag),
            call(self.app.playback_controls_frame, from_=0, to=1, width=80, variable=self.app.volume_var, command=self.app._on_volume_change)
        ])
        self.app.playback_slider.bind.assert_has_calls([
            call("<ButtonPress-1>", self.app._on_slider_press),
            call("<ButtonRelease-1>", self.app._on_slider_release)
        ])
        self.app.playback_slider.pack.assert_called_once_with(side="left", fill="x", expand=True)
        self.app.volume_slider_widget.pack.assert_called_once_with(side="left", padx=(0, 5))

        self.mock_ctk.CTkCheckBox.assert_called_once_with(self.app.playback_controls_frame, text="Loop", variable=self.app.loop_playback_var, width=20)
        self.app.loop_checkbox.pack.assert_called_once_with(side="left")

    def test_destroy_playback_controls_exists(self):
        self.app.playback_controls_frame = MagicMock()
        self.app.playback_controls_frame.winfo_exists.return_value = True
        self.app._destroy_playback_controls()
        self.app.playback_controls_frame.destroy.assert_called_once()
        self.assertIsNone(self.app.playback_controls_frame)

    def test_destroy_playback_controls_not_exists(self):
        self.app.playback_controls_frame = None
        self.app._destroy_playback_controls()
        # No error, no destroy call

    def test_update_playback_progress_not_playing(self):
        self.app.is_audio_playing = False
        self.app._stop_audio_playback = MagicMock()
        self.app.after_cancel = MagicMock()
        self.app._update_playback_progress()
        self.app._stop_audio_playback.assert_not_called()
        self.app.after_cancel.assert_not_called()

    def test_update_playback_progress_playing_no_pygame_init(self):
        self.mock_pygame.mixer.get_init.return_value = False
        self.app.is_audio_playing = True
        self.app._stop_audio_playback = MagicMock()
        self.app.after_cancel = MagicMock()
        self.app._update_playback_progress()
        self.app._stop_audio_playback.assert_not_called()
        self.app.after_cancel.assert_not_called()

    def test_update_playback_progress_playing_loop_enabled(self):
        self.app.is_audio_playing = True
        self.mock_pygame.mixer.music.get_pos.return_value = 0 # Simulate end of playback
        self.app.loop_playback_var.get.return_value = True
        self.app.play_selected_audio_gui = MagicMock()
        self.app._update_playback_progress()
        self.app.play_selected_audio_gui.assert_called_once()

    def test_update_playback_progress_playing_loop_disabled(self):
        self.app.is_audio_playing = True
        self.mock_pygame.mixer.music.get_pos.return_value = 0 # Simulate end of playback
        self.app.loop_playback_var.get.return_value = False
        self.app._stop_audio_playback = MagicMock()
        self.app._update_playback_progress()
        self.app._stop_audio_playback.assert_called_once()

    def test_update_playback_progress_user_dragging_slider(self):
        self.app.is_audio_playing = True
        self.app._user_is_dragging_slider = True # Corrected: use self._user_is_dragging_slider
        self.app.playback_slider = MagicMock()
        self.app.current_time_label = MagicMock()
        self.app._update_playback_progress()
        self.app.playback_slider.set.assert_not_called()
        self.app.current_time_label.configure.assert_not_called()

    def test_update_playback_progress_success(self):
        self.app.is_audio_playing = True
        self.app._user_is_dragging_slider = False
        self.mock_pygame.mixer.music.get_pos.return_value = 30000 # 30 seconds
        self.app.playback_slider = MagicMock()
        self.app.current_time_label = MagicMock()
        self.app.after = MagicMock()

        self.app._update_playback_progress()

        self.app.playback_slider.set.assert_called_once_with(30.0)
        self.app.current_time_label.configure.assert_called_once_with(text="00:30")
        self.app.after.assert_called_once_with(250, self.app._update_playback_progress)

    def test_on_playback_slider_drag_user_dragging(self):
        self.app._user_is_dragging_slider = True
        self.app.current_time_label = MagicMock()
        self.app.current_time_label.winfo_exists.return_value = True
        self.app._on_playback_slider_drag(125.5)
        self.app.current_time_label.configure.assert_called_once_with(text="02:05")

    def test_on_playback_slider_drag_user_not_dragging(self):
        self.app._user_is_dragging_slider = False
        self.app.current_time_label = MagicMock()
        self.app._on_playback_slider_drag(125.5)
        self.app.current_time_label.configure.assert_not_called()

    def test_on_slider_press(self):
        self.app._user_is_dragging_slider = False
        self.app._on_slider_press(None)
        self.assertTrue(self.app._user_is_dragging_slider)

    def test_on_slider_release_no_pygame_init(self):
        self.app._user_is_dragging_slider = True
        self.mock_pygame.mixer.get_init.return_value = False
        self.app._on_slider_release(None)
        self.assertFalse(self.app._user_is_dragging_slider)
        self.mock_pygame.mixer.music.set_pos.assert_not_called()

    def test_on_slider_release_success(self):
        self.app._user_is_dragging_slider = True
        self.app.playback_slider = MagicMock()
        self.app.playback_slider.get.return_value = 45.0
        self.app._on_slider_release(None)
        self.assertFalse(self.app._user_is_dragging_slider)
        self.mock_pygame.mixer.music.set_pos.assert_called_once_with(45.0)

    def test_on_slider_release_pygame_error(self):
        self.app._user_is_dragging_slider = True
        self.app.playback_slider = MagicMock()
        self.app.playback_slider.get.return_value = 45.0
        self.mock_pygame.mixer.music.set_pos.side_effect = self.mock_pygame.error("Seek Error")
        self.app._on_slider_release(None)
        self.assertFalse(self.app._user_is_dragging_slider)
        self.mock_logger.error.assert_called_once_with("GUI", "_on_slider_release", "Error seeking audio: Seek Error")

    def test_on_volume_change_no_pygame_init(self):
        self.mock_pygame.mixer.get_init.return_value = False
        self.app._on_volume_change(0.7)
        self.mock_pygame.mixer.music.set_volume.assert_not_called()

    def test_on_volume_change_success(self):
        self.app._on_volume_change(0.7)
        self.mock_pygame.mixer.music.set_volume.assert_called_once_with(0.7)

if __name__ == '__main__':
    unittest.main()
