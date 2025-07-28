"""
Enhanced GUI Integration for Audio Features

This module extends the main GUI with enhanced audio playback capabilities:
- Integration of EnhancedAudioPlayer with existing GUI
- Advanced playback controls with speed and visualization
- Playlist management interface
- Audio format conversion utilities

Requirements: 9.3, 9.1, 9.2
"""

import os
import threading
from tkinter import filedialog, messagebox
from typing import Optional

import customtkinter as ctk
from audio_player_enhanced import (
    AudioProcessor,
    AudioTrack,
    EnhancedAudioPlayer,
    PlaybackPosition,
    PlaybackState,
    RepeatMode,
)
from audio_visualization import AudioVisualizationWidget
from config_and_logger import logger


class EnhancedPlaybackControlsFrame(ctk.CTkFrame):
    """Enhanced playback controls with advanced features"""

    def __init__(self, parent, audio_player: EnhancedAudioPlayer, **kwargs):
        super().__init__(parent, **kwargs)

        self.audio_player = audio_player
        self.is_user_seeking = False

        # Setup callbacks
        self.audio_player.on_position_changed = self._on_position_changed
        self.audio_player.on_state_changed = self._on_state_changed
        self.audio_player.on_track_changed = self._on_track_changed

        self._create_widgets()
        self._update_display()

    def _create_widgets(self):
        """Create the control widgets"""
        # Main controls row
        controls_frame = ctk.CTkFrame(self)
        controls_frame.pack(fill="x", padx=5, pady=5)

        # Previous track button
        self.prev_button = ctk.CTkButton(
            controls_frame, text="⏮", width=40, command=self._previous_track
        )
        self.prev_button.pack(side="left", padx=2)

        # Play/Pause button
        self.play_button = ctk.CTkButton(
            controls_frame, text="▶", width=60, command=self._toggle_playback
        )
        self.play_button.pack(side="left", padx=2)

        # Stop button
        self.stop_button = ctk.CTkButton(
            controls_frame, text="⏹", width=40, command=self._stop_playback
        )
        self.stop_button.pack(side="left", padx=2)

        # Next track button
        self.next_button = ctk.CTkButton(
            controls_frame, text="⏭", width=40, command=self._next_track
        )
        self.next_button.pack(side="left", padx=2)

        # Time display
        self.time_label = ctk.CTkLabel(controls_frame, text="00:00 / 00:00")
        self.time_label.pack(side="left", padx=10)

        # Progress slider
        self.progress_slider = ctk.CTkSlider(
            controls_frame, from_=0, to=100, command=self._on_progress_change
        )
        self.progress_slider.pack(side="left", fill="x", expand=True, padx=10)
        self.progress_slider.bind("<Button-1>", self._on_seek_start)
        self.progress_slider.bind("<ButtonRelease-1>", self._on_seek_end)

        # Volume controls
        volume_frame = ctk.CTkFrame(self)
        volume_frame.pack(fill="x", padx=5, pady=(0, 5))

        # Volume label
        ctk.CTkLabel(volume_frame, text="Volume:").pack(side="left", padx=5)

        # Volume slider
        self.volume_slider = ctk.CTkSlider(
            volume_frame, from_=0, to=1, command=self._on_volume_change, width=100
        )
        self.volume_slider.set(0.7)
        self.volume_slider.pack(side="left", padx=5)

        # Mute button
        self.mute_button = ctk.CTkButton(
            volume_frame, text="🔊", width=40, command=self._toggle_mute
        )
        self.mute_button.pack(side="left", padx=2)

        # Speed control
        ctk.CTkLabel(volume_frame, text="Speed:").pack(side="left", padx=(20, 5))

        self.speed_var = ctk.StringVar(value="1.0x")
        self.speed_combo = ctk.CTkComboBox(
            volume_frame,
            values=["0.5x", "0.75x", "1.0x", "1.25x", "1.5x", "2.0x"],
            variable=self.speed_var,
            command=self._on_speed_change,
            width=80,
        )
        self.speed_combo.pack(side="left", padx=5)

        # Advanced controls row
        advanced_frame = ctk.CTkFrame(self)
        advanced_frame.pack(fill="x", padx=5, pady=(0, 5))

        # Repeat mode
        self.repeat_var = ctk.StringVar(value="Off")
        self.repeat_combo = ctk.CTkComboBox(
            advanced_frame,
            values=["Off", "One", "All"],
            variable=self.repeat_var,
            command=self._on_repeat_change,
            width=80,
        )
        self.repeat_combo.pack(side="left", padx=5)

        # Shuffle button
        self.shuffle_var = ctk.BooleanVar()
        self.shuffle_checkbox = ctk.CTkCheckBox(
            advanced_frame,
            text="Shuffle",
            variable=self.shuffle_var,
            command=self._on_shuffle_change,
        )
        self.shuffle_checkbox.pack(side="left", padx=10)

        # Format conversion button
        self.convert_button = ctk.CTkButton(
            advanced_frame, text="Convert Audio", command=self._show_conversion_dialog
        )
        self.convert_button.pack(side="right", padx=5)

        # Visualization toggle
        self.viz_var = ctk.BooleanVar()
        self.viz_checkbox = ctk.CTkCheckBox(
            advanced_frame,
            text="Show Visualization",
            variable=self.viz_var,
            command=self._toggle_visualization,
        )
        self.viz_checkbox.pack(side="right", padx=10)

    def _toggle_playback(self):
        """Toggle play/pause"""
        try:
            if self.audio_player.state == PlaybackState.PLAYING:
                self.audio_player.pause()
            else:
                self.audio_player.play()
        except RuntimeError as e:
            logger.error(
                "EnhancedPlaybackControlsFrame",
                "_toggle_playback",
                f"Error toggling playback: {e}",
            )

    def _stop_playback(self):
        """Stop playback"""
        try:
            self.audio_player.stop()
        except RuntimeError as e:
            logger.error(
                "EnhancedPlaybackControlsFrame",
                "_stop_playback",
                f"Error stopping playback: {e}",
            )

    def _previous_track(self):
        """Go to previous track"""
        try:
            self.audio_player.previous_track()
        except RuntimeError as e:
            logger.error(
                "EnhancedPlaybackControlsFrame",
                "_previous_track",
                f"Error going to previous track: {e}",
            )

    def _next_track(self):
        """Go to next track"""
        try:
            self.audio_player.next_track()
        except RuntimeError as e:
            logger.error(
                "EnhancedPlaybackControlsFrame",
                "_next_track",
                f"Error going to next track: {e}",
            )

    def _on_progress_change(self, value):
        """Handle progress slider change"""
        if not self.is_user_seeking:
            return

        try:
            current_track = self.audio_player.get_current_track()
            if current_track:
                position = (float(value) / 100.0) * current_track.duration
                self.audio_player.seek(position)
        except (AttributeError, ValueError, RuntimeError) as e:
            logger.error(
                "EnhancedPlaybackControlsFrame",
                "_on_progress_change",
                f"Error seeking: {e}",
            )

    def _on_seek_start(self, _event):
        """Start seeking"""
        self.is_user_seeking = True

    def _on_seek_end(self, _event):
        """End seeking"""
        self.is_user_seeking = False

    def _on_volume_change(self, value):
        """Handle volume change"""
        try:
            self.audio_player.set_volume(float(value))
        except (ValueError, RuntimeError) as e:
            logger.error(
                "EnhancedPlaybackControlsFrame",
                "_on_volume_change",
                f"Error changing volume: {e}",
            )

    def _toggle_mute(self):
        """Toggle mute"""
        try:
            self.audio_player.toggle_mute()
            self.mute_button.configure(
                text="🔇" if self.audio_player.is_muted else "🔊"
            )
        except RuntimeError as e:
            logger.error(
                "EnhancedPlaybackControlsFrame",
                "_toggle_mute",
                f"Error toggling mute: {e}",
            )

    def _on_speed_change(self, value):
        """Handle playback speed change"""
        try:
            speed = float(value.replace("x", ""))
            self.audio_player.playback_speed = speed
            # Note: pygame doesn't support speed change, this would need additional implementation
            logger.info(
                "EnhancedPlaybackControlsFrame",
                "_on_speed_change",
                f"Speed set to {speed}x",
            )
        except ValueError as e:
            logger.error(
                "EnhancedPlaybackControlsFrame",
                "_on_speed_change",
                f"Error changing speed: {e}",
            )

    def _on_repeat_change(self, value):
        """Handle repeat mode change"""
        try:
            mode_map = {
                "Off": RepeatMode.OFF,
                "One": RepeatMode.ONE,
                "All": RepeatMode.ALL,
            }
            self.audio_player.set_repeat_mode(mode_map[value])
        except KeyError as e:
            logger.error(
                "EnhancedPlaybackControlsFrame",
                "_on_repeat_change",
                f"Error changing repeat mode: {e}",
            )

    def _on_shuffle_change(self):
        """Handle shuffle toggle"""
        try:
            self.audio_player.set_shuffle(self.shuffle_var.get())
        except RuntimeError as e:
            logger.error(
                "EnhancedPlaybackControlsFrame",
                "_on_shuffle_change",
                f"Error toggling shuffle: {e}",
            )

    def _show_conversion_dialog(self):
        """Show audio format conversion dialog"""
        try:
            current_track = self.audio_player.get_current_track()
            if not current_track:
                messagebox.showwarning(
                    "No Track", "No audio track loaded for conversion."
                )
                return

            dialog = AudioConversionDialog(self, current_track.filepath)
            dialog.grab_set()

        except RuntimeError as e:
            logger.error(
                "EnhancedPlaybackControlsFrame",
                "_show_conversion_dialog",
                f"Error showing conversion dialog: {e}",
            )

    def _toggle_visualization(self):
        """Toggle visualization display"""
        try:
            # This would be implemented to show/hide visualization widget
            if hasattr(self.master, "visualization_widget"):
                if self.viz_var.get():
                    self.master.visualization_widget.pack(fill="both", expand=True)
                else:
                    self.master.visualization_widget.pack_forget()
        except RuntimeError as e:
            logger.error(
                "EnhancedPlaybackControlsFrame",
                "_toggle_visualization",
                f"Error toggling visualization: {e}",
            )

    def _on_position_changed(self, position: PlaybackPosition):
        """Handle position change from audio player"""
        try:
            if not self.is_user_seeking:
                self.progress_slider.set(position.percentage)

            # Update time display
            current_time = f"{int(position.current_time//60):02d}:{int(position.current_time%60):02d}"
            total_time = (
                f"{int(position.total_time//60):02d}:{int(position.total_time%60):02d}"
            )
            self.time_label.configure(text=f"{current_time} / {total_time}")

        except RuntimeError as e:
            logger.error(
                "EnhancedPlaybackControlsFrame",
                "_on_position_changed",
                f"Error updating position: {e}",
            )

    def _on_state_changed(self, state: PlaybackState):
        """Handle state change from audio player"""
        try:
            if state == PlaybackState.PLAYING:
                self.play_button.configure(text="⏸")
            else:
                self.play_button.configure(text="▶")

            # Enable/disable controls based on state
            enabled = state != PlaybackState.LOADING
            self.prev_button.configure(state="normal" if enabled else "disabled")
            self.next_button.configure(state="normal" if enabled else "disabled")
            self.stop_button.configure(state="normal" if enabled else "disabled")

        except RuntimeError as e:
            logger.error(
                "EnhancedPlaybackControlsFrame",
                "_on_state_changed",
                f"Error updating state: {e}",
            )

    def _on_track_changed(self, track: Optional[AudioTrack]):
        """Handle track change from audio player"""
        try:
            if track:
                self.progress_slider.configure(to=track.duration)
                logger.info(
                    "EnhancedPlaybackControlsFrame",
                    "_on_track_changed",
                    f"Track changed to: {track.title}",
                )
            else:
                self.progress_slider.configure(to=100)
                self.time_label.configure(text="00:00 / 00:00")

        except RuntimeError as e:
            logger.error(
                "EnhancedPlaybackControlsFrame",
                "_on_track_changed",
                f"Error updating track: {e}",
            )

    def _update_display(self):
        """Update the display with current player state"""
        try:
            # Update volume slider
            self.volume_slider.set(self.audio_player.volume)

            # Update mute button
            self.mute_button.configure(
                text="🔇" if self.audio_player.is_muted else "🔊"
            )

            # Update repeat mode
            repeat_map = {
                RepeatMode.OFF: "Off",
                RepeatMode.ONE: "One",
                RepeatMode.ALL: "All",
            }
            self.repeat_var.set(repeat_map[self.audio_player.playlist.repeat_mode])

            # Update shuffle
            self.shuffle_var.set(self.audio_player.playlist.shuffle_enabled)

        except (KeyError, RuntimeError) as e:
            logger.error(
                "EnhancedPlaybackControlsFrame",
                "_update_display",
                f"Error updating display: {e}",
            )


class PlaylistWidget(ctk.CTkFrame):
    """Playlist management widget"""

    def __init__(self, parent, audio_player: EnhancedAudioPlayer, **kwargs):
        super().__init__(parent, **kwargs)

        self.audio_player = audio_player
        self.audio_player.on_playlist_changed = self._on_playlist_changed
        self.audio_player.on_track_changed = self._on_track_changed

        self._create_widgets()
        self._update_playlist_display()

    def _create_widgets(self):
        """Create playlist widgets"""
        # Header
        header_frame = ctk.CTkFrame(self)
        header_frame.pack(fill="x", padx=5, pady=5)

        ctk.CTkLabel(header_frame, text="Playlist", font=("Arial", 16, "bold")).pack(
            side="left", padx=5
        )

        # Playlist controls
        self.add_button = ctk.CTkButton(
            header_frame, text="Add Files", command=self._add_files, width=80
        )
        self.add_button.pack(side="right", padx=2)

        self.clear_button = ctk.CTkButton(
            header_frame, text="Clear", command=self._clear_playlist, width=60
        )
        self.clear_button.pack(side="right", padx=2)

        # Playlist display
        self.playlist_frame = ctk.CTkScrollableFrame(self)
        self.playlist_frame.pack(fill="both", expand=True, padx=5, pady=(0, 5))

        # Track widgets list
        self.track_widgets = []

    def _add_files(self):
        """Add files to playlist"""
        try:
            filetypes = [
                ("Audio files", "*.wav *.mp3 *.m4a *.ogg *.flac *.aac"),
                ("All files", "*.*"),
            ]

            filenames = filedialog.askopenfilenames(
                title="Select Audio Files", filetypes=filetypes
            )

            if filenames:
                loaded_count = self.audio_player.load_playlist(list(filenames))
                if loaded_count > 0:
                    messagebox.showinfo(
                        "Success", f"Loaded {loaded_count} audio files."
                    )
                else:
                    messagebox.showerror("Error", "Failed to load audio files.")

        except RuntimeError as e:
            logger.error("PlaylistWidget", "_add_files", f"Error adding files: {e}")
            messagebox.showerror("Error", f"Error adding files: {e}")

    def _clear_playlist(self):
        """Clear the playlist"""
        try:
            if messagebox.askyesno(
                "Clear Playlist", "Are you sure you want to clear the playlist?"
            ):
                self.audio_player.stop()
                self.audio_player.playlist.clear()
                self._update_playlist_display()

        except RuntimeError as e:
            logger.error(
                "PlaylistWidget", "_clear_playlist", f"Error clearing playlist: {e}"
            )

    def _on_playlist_changed(self):
        """Handle playlist change"""
        self._update_playlist_display()

    def _on_track_changed(self, _track: Optional[AudioTrack]):
        """Handle track change"""
        self._update_playlist_display()

    def _update_playlist_display(self):
        """Update the playlist display"""
        try:
            # Clear existing widgets
            for widget in self.track_widgets:
                widget.destroy()
            self.track_widgets.clear()

            # Add track widgets
            for i, track in enumerate(self.audio_player.playlist.tracks):
                track_widget = self._create_track_widget(i, track)
                self.track_widgets.append(track_widget)

        except RuntimeError as e:
            logger.error(
                "PlaylistWidget",
                "_update_playlist_display",
                f"Error updating playlist display: {e}",
            )

    def _create_track_widget(self, index: int, track: AudioTrack) -> ctk.CTkFrame:
        """Create a widget for a single track"""
        is_current = index == self.audio_player.playlist.current_index

        # Track frame
        track_frame = ctk.CTkFrame(
            self.playlist_frame,
            fg_color=("gray75", "gray25") if is_current else ("gray90", "gray10"),
        )
        track_frame.pack(fill="x", padx=2, pady=1)

        # Track info
        info_frame = ctk.CTkFrame(track_frame, fg_color="transparent")
        info_frame.pack(side="left", fill="both", expand=True, padx=5, pady=2)

        # Title
        title_label = ctk.CTkLabel(
            info_frame,
            text=track.title,
            font=("Arial", 12, "bold" if is_current else "normal"),
            anchor="w",
        )
        title_label.pack(fill="x")

        # Details
        duration_str = f"{int(track.duration//60):02d}:{int(track.duration%60):02d}"
        size_str = "Unknown size"
        if track.size > 0:
            size_str = f"{track.size / (1024*1024):.1f} MB"
        details_text = f"{duration_str} • {size_str} • {track.format.upper()}"

        details_label = ctk.CTkLabel(
            info_frame,
            text=details_text,
            font=("Arial", 10),
            text_color="gray60",
            anchor="w",
        )
        details_label.pack(fill="x")

        # Controls
        controls_frame = ctk.CTkFrame(track_frame, fg_color="transparent")
        controls_frame.pack(side="right", padx=5, pady=2)

        # Play button
        play_button = ctk.CTkButton(
            controls_frame,
            text="▶" if not is_current else "⏸",
            width=30,
            height=25,
            command=lambda idx=index: self._play_track(idx),
        )
        play_button.pack(side="left", padx=1)

        # Remove button
        remove_button = ctk.CTkButton(
            controls_frame,
            text="✕",
            width=25,
            height=25,
            fg_color="red",
            hover_color="darkred",
            command=lambda idx=index: self._remove_track(idx),
        )
        remove_button.pack(side="left", padx=1)

        return track_frame

    def _play_track(self, index: int):
        """Play specific track"""
        try:
            current_index = self.audio_player.playlist.current_index

            if index == current_index:
                # Toggle play/pause for current track
                if self.audio_player.state == PlaybackState.PLAYING:
                    self.audio_player.pause()
                else:
                    self.audio_player.play()
            else:
                # Switch to different track
                self.audio_player.playlist.set_current_track(index)
                self.audio_player.stop()
                self.audio_player.play()

        except RuntimeError as e:
            logger.error(
                "PlaylistWidget", "_play_track", f"Error playing track {index}: {e}"
            )

    def _remove_track(self, index: int):
        """Remove track from playlist"""
        try:
            if self.audio_player.playlist.remove_track(index):
                self._update_playlist_display()

        except RuntimeError as e:
            logger.error(
                "PlaylistWidget", "_remove_track", f"Error removing track {index}: {e}"
            )


class AudioConversionDialog(ctk.CTkToplevel):
    """Dialog for audio format conversion"""

    def __init__(self, parent, input_filepath: str):
        super().__init__(parent)

        self.input_filepath = input_filepath
        self.output_filepath = ""

        self.title("Audio Format Conversion")
        self.geometry("500x400")
        self.resizable(False, False)

        self._create_widgets()

    def _create_widgets(self):
        """Create conversion dialog widgets"""
        # Input file info
        input_frame = ctk.CTkFrame(self)
        input_frame.pack(fill="x", padx=20, pady=10)

        ctk.CTkLabel(input_frame, text="Input File:", font=("Arial", 12, "bold")).pack(
            anchor="w", padx=10, pady=5
        )
        ctk.CTkLabel(input_frame, text=os.path.basename(self.input_filepath)).pack(
            anchor="w", padx=20
        )

        # Get input file info
        audio_info = AudioProcessor.get_audio_info(self.input_filepath)
        if audio_info:
            info_text = f"Format: {audio_info.get('format', 'Unknown')}\n"
            info_text += f"Duration: {audio_info.get('duration', 0):.1f} seconds\n"
            info_text += f"Sample Rate: {audio_info.get('sample_rate', 0)} Hz\n"
            info_text += f"Channels: {audio_info.get('channels', 0)}\n"
            info_text += f"Size: {audio_info.get('size', 0) / (1024*1024):.1f} MB"

            ctk.CTkLabel(input_frame, text=info_text, justify="left").pack(
                anchor="w", padx=20, pady=5
            )

        # Output format selection
        format_frame = ctk.CTkFrame(self)
        format_frame.pack(fill="x", padx=20, pady=10)

        ctk.CTkLabel(
            format_frame, text="Output Format:", font=("Arial", 12, "bold")
        ).pack(anchor="w", padx=10, pady=5)

        self.format_var = ctk.StringVar(value="wav")
        format_options = ["wav", "mp3", "ogg", "flac", "m4a"]

        for fmt in format_options:
            ctk.CTkRadioButton(
                format_frame, text=fmt.upper(), variable=self.format_var, value=fmt
            ).pack(anchor="w", padx=20, pady=2)

        # Quality settings
        quality_frame = ctk.CTkFrame(self)
        quality_frame.pack(fill="x", padx=20, pady=10)

        ctk.CTkLabel(
            quality_frame, text="Quality Settings:", font=("Arial", 12, "bold")
        ).pack(anchor="w", padx=10, pady=5)

        # Normalize audio
        self.normalize_var = ctk.BooleanVar(value=True)
        ctk.CTkCheckBox(
            quality_frame, text="Normalize audio levels", variable=self.normalize_var
        ).pack(anchor="w", padx=20, pady=2)

        # Target dBFS for normalization
        dbfs_frame = ctk.CTkFrame(quality_frame, fg_color="transparent")
        dbfs_frame.pack(fill="x", padx=20, pady=5)

        ctk.CTkLabel(dbfs_frame, text="Target Level (dBFS):").pack(side="left")

        self.dbfs_var = ctk.StringVar(value="-20.0")
        self.dbfs_entry = ctk.CTkEntry(dbfs_frame, textvariable=self.dbfs_var, width=80)
        self.dbfs_entry.pack(side="left", padx=10)

        # Output file selection
        output_frame = ctk.CTkFrame(self)
        output_frame.pack(fill="x", padx=20, pady=10)

        ctk.CTkLabel(
            output_frame, text="Output File:", font=("Arial", 12, "bold")
        ).pack(anchor="w", padx=10, pady=5)

        file_frame = ctk.CTkFrame(output_frame, fg_color="transparent")
        file_frame.pack(fill="x", padx=10, pady=5)

        self.output_var = ctk.StringVar()
        self.output_entry = ctk.CTkEntry(
            file_frame,
            textvariable=self.output_var,
            placeholder_text="Select output file...",
        )
        self.output_entry.pack(side="left", fill="x", expand=True, padx=(0, 5))

        ctk.CTkButton(
            file_frame, text="Browse", command=self._browse_output_file, width=80
        ).pack(side="right")

        # Progress bar
        self.progress_var = ctk.DoubleVar()
        self.progress_bar = ctk.CTkProgressBar(self, variable=self.progress_var)
        self.progress_bar.pack(fill="x", padx=20, pady=10)
        self.progress_bar.set(0)

        # Status label
        self.status_label = ctk.CTkLabel(self, text="Ready to convert")
        self.status_label.pack(pady=5)

        # Buttons
        button_frame = ctk.CTkFrame(self, fg_color="transparent")
        button_frame.pack(fill="x", padx=20, pady=10)

        ctk.CTkButton(
            button_frame, text="Cancel", command=self.destroy, width=100
        ).pack(side="right", padx=5)

        self.convert_button = ctk.CTkButton(
            button_frame, text="Convert", command=self._start_conversion, width=100
        )
        self.convert_button.pack(side="right", padx=5)

    def _browse_output_file(self):
        """Browse for output file"""
        try:
            format_ext = self.format_var.get()
            filename = filedialog.asksaveasfilename(
                title="Save Converted Audio As",
                defaultextension=f".{format_ext}",
                filetypes=[
                    (f"{format_ext.upper()} files", f"*.{format_ext}"),
                    ("All files", "*.*"),
                ],
            )

            if filename:
                self.output_var.set(filename)

        except RuntimeError as e:
            logger.error(
                "AudioConversionDialog",
                "_browse_output_file",
                f"Error browsing output file: {e}",
            )

    def _start_conversion(self):
        """Start the conversion process"""
        try:
            output_path = self.output_var.get().strip()
            if not output_path:
                messagebox.showerror("Error", "Please select an output file.")
                return

            # Disable convert button
            self.convert_button.configure(state="disabled")
            self.status_label.configure(text="Converting...")
            self.progress_bar.set(0.1)

            # Perform conversion in a separate thread
            conversion_thread = threading.Thread(
                target=self._perform_conversion, args=(output_path,)
            )
            conversion_thread.daemon = True
            conversion_thread.start()

        except RuntimeError as e:
            logger.error(
                "AudioConversionDialog",
                "_start_conversion",
                f"Error starting conversion: {e}",
            )
            messagebox.showerror("Error", f"Error starting conversion: {e}")
            self.convert_button.configure(state="normal")

    def _perform_conversion(self, output_path: str):
        """Perform the actual conversion"""
        try:
            self.progress_bar.set(0.3)

            # Convert format
            target_format = self.format_var.get()
            success = AudioProcessor.convert_audio_format(
                self.input_filepath, output_path, target_format
            )

            if not success:
                raise RuntimeError("Format conversion failed")

            self.progress_bar.set(0.7)

            # Normalize if requested
            if self.normalize_var.get():
                try:
                    target_dbfs = float(self.dbfs_var.get())
                    temp_path = output_path + ".temp"

                    # Rename original to temp
                    os.rename(output_path, temp_path)

                    # Normalize
                    normalize_success = AudioProcessor.normalize_audio(
                        temp_path, output_path, target_dbfs
                    )

                    # Clean up temp file
                    if os.path.exists(temp_path):
                        os.remove(temp_path)

                    if not normalize_success:
                        logger.warning(
                            "AudioConversionDialog",
                            "_perform_conversion",
                            "Normalization failed, keeping original conversion",
                        )

                except ValueError:
                    logger.warning(
                        "AudioConversionDialog",
                        "_perform_conversion",
                        "Invalid dBFS value, skipping normalization",
                    )

            self.progress_bar.set(1.0)

            # Update UI on main thread
            self.after(
                0, self._conversion_complete, True, "Conversion completed successfully!"
            )

        except (OSError, ValueError, RuntimeError) as e:
            logger.error(
                "AudioConversionDialog",
                "_perform_conversion",
                f"Conversion failed: {e}",
            )
            self.after(0, self._conversion_complete, False, f"Conversion failed: {e}")

    def _conversion_complete(self, success: bool, message: str):
        """Handle conversion completion"""
        try:
            self.status_label.configure(text=message)
            self.convert_button.configure(state="normal")

            if success:
                messagebox.showinfo("Success", message)
                self.destroy()
            else:
                messagebox.showerror("Error", message)
                self.progress_bar.set(0)

        except RuntimeError as e:
            logger.error(
                "AudioConversionDialog",
                "_conversion_complete",
                f"Error handling completion: {e}",
            )


class EnhancedAudioGUI:
    """Main enhanced audio GUI integration class"""

    def __init__(self, main_gui_instance):
        self.main_gui = main_gui_instance
        self.enhanced_player = EnhancedAudioPlayer(main_gui_instance)

        # GUI components
        self.playback_controls = None
        self.playlist_widget = None
        self.visualization_widget = None
        self.enhanced_frame = None
        self.tabview = None

        # Integration state
        self.is_enhanced_mode = False

    def enable_enhanced_mode(self):
        """Enable enhanced audio features"""
        try:
            if self.is_enhanced_mode:
                return

            # Create enhanced controls
            self._create_enhanced_controls()

            # Replace existing playback functionality
            self._integrate_with_main_gui()

            self.is_enhanced_mode = True
            logger.info(
                "EnhancedAudioGUI",
                "enable_enhanced_mode",
                "Enhanced audio mode enabled",
            )

        except RuntimeError as e:
            logger.error(
                "EnhancedAudioGUI",
                "enable_enhanced_mode",
                f"Error enabling enhanced mode: {e}",
            )

    def disable_enhanced_mode(self):
        """Disable enhanced audio features"""
        try:
            if not self.is_enhanced_mode:
                return

            # Clean up enhanced components
            if self.playback_controls:
                self.playback_controls.destroy()
            if self.playlist_widget:
                self.playlist_widget.destroy()
            if self.visualization_widget:
                self.visualization_widget.destroy()

            # Restore original functionality
            self._restore_original_gui()

            self.is_enhanced_mode = False
            logger.info(
                "EnhancedAudioGUI",
                "disable_enhanced_mode",
                "Enhanced audio mode disabled",
            )

        except RuntimeError as e:
            logger.error(
                "EnhancedAudioGUI",
                "disable_enhanced_mode",
                f"Error disabling enhanced mode: {e}",
            )

    def _create_enhanced_controls(self):
        """Create enhanced control widgets"""
        try:
            # Create a new frame for enhanced controls
            self.enhanced_frame = ctk.CTkFrame(self.main_gui)

            # Playback controls
            self.playback_controls = EnhancedPlaybackControlsFrame(
                self.enhanced_frame, self.enhanced_player
            )
            self.playback_controls.pack(fill="x", padx=5, pady=5)

            # Create tabview for playlist and visualization
            self.tabview = ctk.CTkTabview(self.enhanced_frame)
            self.tabview.pack(fill="both", expand=True, padx=5, pady=5)

            # Playlist tab
            playlist_tab = self.tabview.add("Playlist")
            self.playlist_widget = PlaylistWidget(playlist_tab, self.enhanced_player)
            self.playlist_widget.pack(fill="both", expand=True)

            # Visualization tab
            viz_tab = self.tabview.add("Visualization")
            self.visualization_widget = AudioVisualizationWidget(viz_tab)
            self.visualization_widget.pack(fill="both", expand=True)

            # Set up visualization callbacks
            self.enhanced_player.on_track_changed = self._on_enhanced_track_changed
            self.enhanced_player.on_position_changed = (
                self._on_enhanced_position_changed
            )

        except RuntimeError as e:
            logger.error(
                "EnhancedAudioGUI",
                "_create_enhanced_controls",
                f"Error creating controls: {e}",
            )

    def _integrate_with_main_gui(self):
        """Integrate enhanced controls with main GUI"""
        try:
            # Hide original playback controls if they exist
            if (
                hasattr(self.main_gui, "playback_controls_frame")
                and self.main_gui.playback_controls_frame
            ):
                self.main_gui.playback_controls_frame.pack_forget()

            # Insert enhanced frame before status bar
            self.enhanced_frame.pack(
                fill="both", expand=True, before=self.main_gui.status_bar_frame
            )

            # Override the play_selected_audio_gui method
            self.main_gui.original_play_selected_audio_gui = (
                self.main_gui.play_selected_audio_gui
            )
            self.main_gui.play_selected_audio_gui = self._enhanced_play_selected_audio

        except RuntimeError as e:
            logger.error(
                "EnhancedAudioGUI",
                "_integrate_with_main_gui",
                f"Error integrating with main GUI: {e}",
            )

    def _restore_original_gui(self):
        """Restore original GUI functionality"""
        try:
            # Remove enhanced frame
            if hasattr(self, "enhanced_frame"):
                self.enhanced_frame.destroy()

            # Restore original method
            if hasattr(self.main_gui, "original_play_selected_audio_gui"):
                self.main_gui.play_selected_audio_gui = (
                    self.main_gui.original_play_selected_audio_gui
                )

            # Show original playback controls
            if (
                hasattr(self.main_gui, "playback_controls_frame")
                and self.main_gui.playback_controls_frame
            ):
                self.main_gui.playback_controls_frame.pack(
                    fill="x",
                    side="bottom",
                    pady=5,
                    before=self.main_gui.status_bar_frame,
                )

        except RuntimeError as e:
            logger.error(
                "EnhancedAudioGUI",
                "_restore_original_gui",
                f"Error restoring original GUI: {e}",
            )

    def _enhanced_play_selected_audio(self):
        """Enhanced version of play_selected_audio_gui"""
        try:
            # Get selected file from main GUI
            selected_items = self.main_gui.file_tree.selection()
            if not selected_items:
                return

            item_iid = selected_items[0]
            file_detail = None

            # Find the file detail
            for detail in self.main_gui.displayed_files_details:
                if detail.get("tree_iid") == item_iid:
                    file_detail = detail
                    break

            if not file_detail:
                return

            # Check if file is downloaded
            local_filepath = (
                self.main_gui._get_local_filepath(  # pylint: disable=protected-access
                    file_detail["name"]
                )
            )
            if not os.path.exists(local_filepath):
                # File not downloaded, use original method to download first
                self.main_gui.original_play_selected_audio_gui()
                return

            # Load into enhanced player
            if self.enhanced_player.load_track(local_filepath):
                self.enhanced_player.play()

                # Load visualization
                if self.visualization_widget:
                    self.visualization_widget.load_audio(local_filepath)

        except (AttributeError, IndexError, RuntimeError) as e:
            logger.error(
                "EnhancedAudioGUI",
                "_enhanced_play_selected_audio",
                f"Error in enhanced playback: {e}",
            )

    def _on_enhanced_track_changed(self, track: Optional[AudioTrack]):
        """Handle track change for visualization"""
        try:
            if track and self.visualization_widget:
                self.visualization_widget.load_audio(track.filepath)
        except RuntimeError as e:
            logger.error(
                "EnhancedAudioGUI",
                "_on_enhanced_track_changed",
                f"Error updating visualization: {e}",
            )

    def _on_enhanced_position_changed(self, position: PlaybackPosition):
        """Handle position change for visualization"""
        try:
            if self.visualization_widget:
                self.visualization_widget.update_position(position)
        except RuntimeError as e:
            logger.error(
                "EnhancedAudioGUI",
                "_on_enhanced_position_changed",
                f"Error updating position: {e}",
            )

    def cleanup(self):
        """Clean up resources"""
        try:
            if self.enhanced_player:
                self.enhanced_player.cleanup()

            if self.is_enhanced_mode:
                self.disable_enhanced_mode()

        except RuntimeError as e:
            logger.error("EnhancedAudioGUI", "cleanup", f"Error during cleanup: {e}")
