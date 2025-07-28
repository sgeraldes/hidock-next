# audio_player.py
"""
Audio Player Mixin for the HiDock Explorer Tool GUI.
"""
import os
import threading
import tkinter
from tkinter import messagebox

import customtkinter as ctk
from config_and_logger import logger

try:
    import pygame
except ImportError:
    pygame = None


class AudioPlayer:
    """
    A UI-agnostic class to handle core audio playback using Pygame.
    Communicates with the owner via callbacks.
    """

    def __init__(self, on_start=None, on_stop=None, on_error=None):
        self.on_start = on_start
        self.on_stop = on_stop
        self.on_error = on_error
        self._is_playing = False
        self._is_looping = False
        self._current_filepath = None

        if pygame and not pygame.mixer.get_init():
            pygame.mixer.init()

    @property
    def is_playing(self):
        """Returns True if audio is currently playing."""
        if not pygame or not pygame.mixer.get_init():
            return False
        # get_busy is more reliable for checking playback status
        self._is_playing = pygame.mixer.music.get_busy()
        return self._is_playing

    def play(self, filepath):
        """Loads and plays an audio file."""
        if not pygame or not pygame.mixer.get_init():
            if self.on_error:
                self.on_error("Pygame mixer not initialized.")
            return

        try:
            self._current_filepath = filepath
            pygame.mixer.music.load(filepath)
            pygame.mixer.music.play()
            self._is_playing = True
            if self.on_start:
                self.on_start(filepath)
        except pygame.error as e:
            self._is_playing = False
            if self.on_error:
                self.on_error(f"Could not play file: {e}")

    def stop(self):
        """Stops the currently playing audio."""
        if not pygame or not pygame.mixer.get_init():
            return
        pygame.mixer.music.stop()
        self._is_playing = False
        if self.on_stop:
            self.on_stop()

    def set_volume(self, value):
        """Sets the playback volume (0.0 to 1.0)."""
        if pygame and pygame.mixer.get_init():
            pygame.mixer.music.set_volume(float(value))

    def set_loop(self, should_loop):
        """Sets the looping state."""
        self._is_looping = bool(should_loop)

    def get_pos_ms(self):
        """Gets the current playback position in milliseconds."""
        if pygame and pygame.mixer.get_init():
            return pygame.mixer.music.get_pos()
        return -1

    def seek(self, position_s):
        """Seeks to a specific position in the audio in seconds."""
        if not pygame or not pygame.mixer.get_init() or not self.is_playing:
            return
        try:
            pygame.mixer.music.set_pos(position_s)
        except pygame.error as e:
            if self.on_error:
                self.on_error(f"Error seeking audio: {e}")

    def check_for_end(self):
        """
        Checks if playback has finished and handles looping or stopping.
        This should be called periodically by the owner.
        """
        if self._is_playing and not pygame.mixer.music.get_busy():
            self._is_playing = False
            if self._is_looping and self._current_filepath:
                self.play(self._current_filepath)
            else:
                if self.on_stop:
                    self.on_stop()


class AudioPlayerMixin:
    """A mixin for handling audio playback."""

    def _initialize_audio_player(self):
        """Initializes the audio player and its callbacks."""
        if not hasattr(self, "audio_player"):
            self.audio_player = None
        if pygame and not self.audio_player:
            self.audio_player = AudioPlayer(
                on_start=self._handle_playback_start,
                on_stop=self._handle_playback_stop,
                on_error=self._handle_playback_error,
            )

    def play_selected_audio_gui(self):
        """
        Initiates playback of the selected audio file.

        Handles downloading the file if it's not available locally, and then
        starts the playback process.
        """
        self._initialize_audio_player()  # Ensure player is ready
        if not self.audio_player:
            messagebox.showerror(
                "Playback Error",
                "Pygame module not loaded. Cannot play audio.",
                parent=self,
            )
            return

        if self.audio_player.is_playing:
            self.audio_player.stop()
            return

        selected_iids = self.file_tree.selection()
        if len(selected_iids) != 1:
            messagebox.showinfo(
                "Playback", "Please select a single audio file to play.", parent=self
            )
            return

        file_iid = selected_iids[0]
        file_detail = next(
            (f for f in self.displayed_files_details if f["name"] == file_iid), None
        )
        if not file_detail:
            return

        self.current_playing_file_detail = file_detail
        local_filepath = self._get_local_filepath(file_detail["name"])

        if os.path.exists(local_filepath):
            self.playback_total_duration = file_detail.get("duration", 0)
            self.audio_player.play(local_filepath)
        else:
            self._set_long_operation_active_state(True, "Playback Preparation")
            self.update_status_bar(
                progress_text=f"Downloading {file_detail['name']} for playback..."
            )
            self._update_file_status_in_treeview(
                file_iid, "Preparing Playback", ("downloading",)
            )
            threading.Thread(
                target=self._download_for_playback_thread,
                args=(file_detail, local_filepath),
                daemon=True,
            ).start()

    def _download_for_playback_thread(self, file_info, local_path):
        """
        Downloads a file specifically for immediate playback.

        Args:
            file_info (dict): The details of the file to download.
            local_path (str): The local path to save the file to.
        """
        temp_path = local_path + ".tmp"
        try:
            with open(temp_path, "wb") as f:
                stream_status = self.dock.stream_file(
                    file_info["name"],
                    file_info["length"],
                    f.write,
                    lambda r, t: self.after(
                        0, self.update_file_progress, r, t, "Downloading for playback"
                    ),
                    timeout_s=self.file_stream_timeout_s_var.get(),
                    cancel_event=self.cancel_operation_event,
                )
            if stream_status == "OK":
                if os.path.exists(local_path):
                    os.remove(local_path)
                os.rename(temp_path, local_path)
                self.playback_total_duration = file_info.get("duration", 0)
                self.after(0, self.audio_player.play, local_path)
            else:
                raise ConnectionError(f"Stream failed: {stream_status}")
        except (IOError, OSError, ConnectionError, tkinter.TclError) as e:
            logger.error(
                "GUI",
                "_download_for_playback_thread",
                f"Failed to download for playback: {e}",
            )
            self.after(0, self._handle_playback_error, f"Failed to download file: {e}")
        finally:
            self.after(
                0,
                self._set_long_operation_active_state,
                False,
                "Playback Preparation",
            )
            self.after(0, self.refresh_file_list_gui)

    def _handle_playback_start(self, filepath):
        """Callback for when audio playback starts."""
        self.is_audio_playing = True
        self.audio_player.set_volume(self.volume_var.get())
        self.audio_player.set_loop(self.loop_playback_var.get())
        self._create_playback_controls()
        self._update_playback_progress()
        self._update_menu_states()

        # Update the file status to show "Playing" and refresh the treeview
        if self.current_playing_file_detail:
            self._update_file_status_in_treeview(
                self.current_playing_file_detail["name"], "Playing", ("playing",)
            )
            # Force a treeview refresh to ensure the "Playing" status is visible
            self.refresh_file_list_gui()

    def _handle_playback_stop(self):
        """Callback for when audio playback stops (user-initiated or finished)."""
        self.is_audio_playing = False
        if self.playback_update_timer_id:
            self.after_cancel(self.playback_update_timer_id)
            self.playback_update_timer_id = None
        self._destroy_playback_controls()
        self._update_menu_states()
        self.refresh_file_list_gui()
        self.current_playing_file_detail = None

    def _handle_playback_error(self, error_message):
        """Callback for when a playback error occurs."""
        messagebox.showerror("Playback Error", error_message, parent=self)
        self._handle_playback_stop()  # Clean up UI on error

    def _stop_audio_playback(self):
        """Stops the currently playing audio. Public-facing method."""
        if self.audio_player and self.audio_player.is_playing:
            self.audio_player.stop()

    def _create_playback_controls(self):
        """Creates and displays the audio playback controls (slider, labels, etc.)."""
        if self.playback_controls_frame and self.playback_controls_frame.winfo_exists():
            return
        self.playback_controls_frame = ctk.CTkFrame(
            self.status_bar_frame, fg_color="transparent"
        )
        self.playback_controls_frame.pack(side="right", padx=10, pady=2, fill="x")
        self.current_time_label = ctk.CTkLabel(
            self.playback_controls_frame, text="00:00", width=40
        )
        self.current_time_label.pack(side="left", padx=(0, 5))
        self.playback_slider = ctk.CTkSlider(
            self.playback_controls_frame,
            from_=0,
            to=self.playback_total_duration,
            command=self._on_playback_slider_drag,
        )
        self.playback_slider.bind("<ButtonPress-1>", self._on_slider_press)
        self.playback_slider.bind("<ButtonRelease-1>", self._on_slider_release)
        self.playback_slider.pack(side="left", fill="x", expand=True)
        self.total_duration_label = ctk.CTkLabel(
            self.playback_controls_frame,
            text=f"{int(self.playback_total_duration // 60):02d}:{int(self.playback_total_duration % 60):02d}",
            width=40,
        )
        self.total_duration_label.pack(side="left", padx=(5, 10))
        self.volume_slider_widget = ctk.CTkSlider(
            self.playback_controls_frame,
            from_=0,
            to=1,
            width=80,
            variable=self.volume_var,
            command=self._on_volume_change,
        )
        self.volume_slider_widget.pack(side="left", padx=(0, 5))
        self.loop_checkbox = ctk.CTkCheckBox(
            self.playback_controls_frame,
            text="Loop",
            variable=self.loop_playback_var,
            width=20,
            command=self._on_loop_toggle,
        )
        self.loop_checkbox.pack(side="left")

    def _destroy_playback_controls(self):
        """Destroys the audio playback controls."""
        if (
            hasattr(self, "playback_controls_frame")
            and self.playback_controls_frame
            and self.playback_controls_frame.winfo_exists()
        ):
            self.playback_controls_frame.destroy()
            self.playback_controls_frame = None

    def _update_playback_progress(self):
        """Periodically updates the playback progress slider and time labels."""
        if not self.audio_player or not self.is_audio_playing:
            return

        # Check if playback has ended naturally
        self.audio_player.check_for_end()
        if not self.audio_player.is_playing:
            # The check_for_end method handles stopping or looping,
            # which will trigger the on_stop callback and clean up.
            return

        if not self._user_is_dragging_slider:
            current_pos_ms = self.audio_player.get_pos_ms()
            current_pos_s = current_pos_ms / 1000.0
            if (
                hasattr(self, "playback_slider")
                and self.playback_slider
                and self.playback_slider.winfo_exists()
            ):
                self.playback_slider.set(current_pos_s)
            if (
                hasattr(self, "current_time_label")
                and self.current_time_label
                and self.current_time_label.winfo_exists()
            ):
                self.current_time_label.configure(
                    text=f"{int(current_pos_s // 60):02d}:{int(current_pos_s % 60):02d}"
                )
        self.playback_update_timer_id = self.after(250, self._update_playback_progress)

    def _on_playback_slider_drag(self, value):
        """Handles seeking when the user drags the playback slider."""
        if self._user_is_dragging_slider:
            if (
                hasattr(self, "current_time_label")
                and self.current_time_label
                and self.current_time_label.winfo_exists()
            ):
                self.current_time_label.configure(
                    text=f"{int(float(value) // 60):02d}:{int(float(value) % 60):02d}"
                )

    def _on_slider_press(self, _event):
        """Flags that the user is currently interacting with the playback slider."""
        self._user_is_dragging_slider = True

    def _on_slider_release(self, _event):
        """Handles seeking the audio when the user releases the playback slider."""
        self._user_is_dragging_slider = False
        if not self.audio_player:
            return
        seek_pos_s = self.playback_slider.get()
        self.audio_player.seek(seek_pos_s)

    def _on_volume_change(self, value):
        """Handles changes to the volume slider."""
        if self.audio_player:
            self.audio_player.set_volume(float(value))

    def _on_loop_toggle(self):
        """Handles toggling the loop checkbox."""
        if self.audio_player:
            self.audio_player.set_loop(self.loop_playback_var.get())
