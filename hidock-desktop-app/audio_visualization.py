"""
Audio Visualization Module for HiDock Desktop Application

This module provides audio visualization capabilities including:
- Waveform display with real-time updates
- Spectrum analyzer with frequency analysis
- Visual feedback for audio playback position
- Customizable visualization themes

Requirements: 9.3, 9.1, 9.2
"""

import os
import threading
import time
from typing import List, Optional, Tuple

import customtkinter as ctk
import matplotlib.animation as animation
import matplotlib.pyplot as plt
import numpy as np
from audio_player_enhanced import AudioProcessor, PlaybackPosition
from config_and_logger import logger
from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg
from matplotlib.figure import Figure
from scipy import signal
from scipy.fft import fftfreq


class WaveformVisualizer:
    """Waveform visualization component"""

    def __init__(self, parent_frame: ctk.CTkFrame, width: int = 800, height: int = 120):
        self.parent = parent_frame
        self.width = width
        self.height = height

        # Visualization data
        self.waveform_data: Optional[np.ndarray] = None
        self.sample_rate: int = 0
        self.current_position: float = 0.0
        self.total_duration: float = 0.0

        # Matplotlib setup - use more dynamic sizing
        self.figure = Figure(
            figsize=(width / 100, height / 100), dpi=100, facecolor="#2b2b2b"
        )
        # Adjust subplot to use more space and reduce margins
        self.ax = self.figure.add_subplot(111)
        self.figure.subplots_adjust(left=0.02, right=0.98, top=0.95, bottom=0.05)
        self.canvas = FigureCanvasTkAgg(self.figure, parent_frame)

        # Styling
        self._setup_styling()

        # Initialize empty plot
        self._initialize_plot()

        # Zoom functionality
        self.zoom_level = 1.0
        self.zoom_center = 0.5  # Center of zoom (0.0 to 1.0)

        # Pack the canvas to fill available space
        self.canvas.get_tk_widget().pack(fill="both", expand=True, padx=2, pady=2)

    def _setup_styling(self):
        """Setup matplotlib styling for dark theme"""
        self.figure.patch.set_facecolor("#2b2b2b")
        self.ax.set_facecolor("#1a1a1a")

        # Remove axes and ticks for cleaner look
        self.ax.set_xticks([])
        self.ax.set_yticks([])

        # Style the spines
        for spine in self.ax.spines.values():
            spine.set_color("#404040")
            spine.set_linewidth(0.5)

        # Set colors
        self.waveform_color = "#4a9eff"
        self.position_color = "#ff4444"
        self.background_color = "#1a1a1a"

    def _initialize_plot(self):
        """Initialize empty waveform plot"""
        try:
            self.ax.clear()
            self.ax.set_xlim(0, 1)
            self.ax.set_ylim(-1, 1)
            self.ax.set_facecolor(self.background_color)

            # Add placeholder text
            self.ax.text(
                0.5,
                0,
                "No audio loaded",
                ha="center",
                va="center",
                color="#666666",
                fontsize=12,
                transform=self.ax.transAxes,
            )

            # Draw the canvas with error handling
            try:
                self.canvas.draw()
            except RecursionError:
                # If we get a recursion error, skip the initial draw
                # The canvas will be drawn when it's actually displayed
                logger.warning(
                    "WaveformVisualizer",
                    "_initialize_plot", 
                    "Skipping initial canvas draw due to recursion error"
                )
        except Exception as e:
            logger.error(
                "WaveformVisualizer",
                "_initialize_plot",
                f"Error initializing plot: {e}"
            )

    def _apply_theme_colors(self):
        """Apply current theme colors to the matplotlib figure"""
        try:
            # Update figure and axes background colors
            self.figure.patch.set_facecolor("#2b2b2b")
            self.ax.set_facecolor(self.background_color)

            # Update spine colors
            for spine in self.ax.spines.values():
                spine.set_color("#404040")
                spine.set_linewidth(0.5)

        except Exception as e:
            logger.error(
                "WaveformVisualizer",
                "_apply_theme_colors",
                f"Error applying theme colors: {e}",
            )

    def load_audio(self, filepath: str) -> bool:
        """Load audio file and extract waveform data"""
        try:
            logger.info(
                "WaveformVisualizer", "load_audio", f"Loading waveform for {filepath}"
            )

            # Extract waveform data
            waveform_data, sample_rate = AudioProcessor.extract_waveform_data(
                filepath, max_points=2000
            )

            if len(waveform_data) == 0:
                logger.warning(
                    "WaveformVisualizer",
                    "load_audio",
                    f"No waveform data extracted from {filepath}",
                )
                return False

            self.waveform_data = waveform_data
            self.sample_rate = sample_rate

            # Get audio duration
            audio_info = AudioProcessor.get_audio_info(filepath)
            self.total_duration = audio_info.get("duration", 0.0)

            # Update visualization
            self._update_waveform_display()

            logger.info(
                "WaveformVisualizer", "load_audio", f"Waveform loaded successfully"
            )
            return True

        except Exception as e:
            logger.error(
                "WaveformVisualizer", "load_audio", f"Error loading waveform: {e}"
            )
            return False

    def _update_waveform_display(self):
        """Update the waveform display with improved normalization and scaling"""
        if self.waveform_data is None:
            return

        try:
            self.ax.clear()
            self.ax.set_facecolor(self.background_color)

            # Create time axis
            time_axis = np.linspace(0, self.total_duration, len(self.waveform_data))

            # Improve waveform normalization and scaling
            waveform_display = self.waveform_data.copy()

            # Apply better normalization for quiet audio
            max_amplitude = np.max(np.abs(waveform_display))
            if max_amplitude > 0:
                # Normalize to full range but with some headroom
                waveform_display = waveform_display / max_amplitude * 0.9

                # Apply slight compression to make quiet parts more visible
                waveform_display = np.sign(waveform_display) * np.power(
                    np.abs(waveform_display), 0.7
                )

            # Plot waveform with thicker line for better visibility
            self.ax.plot(
                time_axis,
                waveform_display,
                color=self.waveform_color,
                linewidth=1.2,
                alpha=0.9,
            )

            # Fill under the curve for better visual effect
            self.ax.fill_between(
                time_axis, waveform_display, alpha=0.4, color=self.waveform_color
            )

            # Apply zoom to time axis
            if self.zoom_level > 1.0:
                # Calculate zoom window
                zoom_duration = self.total_duration / self.zoom_level
                zoom_start = max(
                    0, self.zoom_center * self.total_duration - zoom_duration / 2
                )
                zoom_end = min(self.total_duration, zoom_start + zoom_duration)

                # Adjust if we're at the edges
                if zoom_end >= self.total_duration:
                    zoom_end = self.total_duration
                    zoom_start = max(0, zoom_end - zoom_duration)
                elif zoom_start <= 0:
                    zoom_start = 0
                    zoom_end = min(self.total_duration, zoom_duration)

                self.ax.set_xlim(zoom_start, zoom_end)
            else:
                self.ax.set_xlim(0, self.total_duration)
            self.ax.set_ylim(-1.0, 1.0)

            # Add subtle grid for better readability
            self.ax.grid(True, alpha=0.2, color="#666666", linewidth=0.5)

            # Remove ticks and labels
            self.ax.set_xticks([])
            self.ax.set_yticks([])

            # Style spines
            for spine in self.ax.spines.values():
                spine.set_color("#404040")
                spine.set_linewidth(0.5)

            # Add position indicator if playing
            if self.current_position > 0:
                self._add_position_indicator()

            self.canvas.draw()

        except Exception as e:
            logger.error(
                "WaveformVisualizer",
                "_update_waveform_display",
                f"Error updating display: {e}",
            )

    def _add_position_indicator(self):
        """Add current position indicator to waveform"""
        if self.total_duration > 0:
            # Add vertical line for current position
            self.ax.axvline(
                x=self.current_position,
                color=self.position_color,
                linewidth=2,
                alpha=0.8,
            )

            # Add time text
            time_text = f"{int(self.current_position//60):02d}:{int(self.current_position%60):02d}"
            self.ax.text(
                self.current_position,
                0.9,
                time_text,
                ha="center",
                va="bottom",
                color=self.position_color,
                fontsize=10,
                fontweight="bold",
                bbox=dict(
                    boxstyle="round,pad=0.3",
                    facecolor="#2b2b2b",
                    edgecolor=self.position_color,
                    alpha=0.8,
                ),
            )

    def update_position(self, position: PlaybackPosition):
        """Update playback position indicator"""
        try:
            self.current_position = position.current_time

            # Auto-center zoom on current position when zoomed in
            if self.zoom_level > 1.0 and self.total_duration > 0:
                self.zoom_center = self.current_position / self.total_duration

            if self.waveform_data is not None:
                self._update_waveform_display()

        except Exception as e:
            logger.error(
                "WaveformVisualizer", "update_position", f"Error updating position: {e}"
            )

    def _zoom_in(self):
        """Zoom in on the waveform"""
        self.zoom_level = min(self.zoom_level * 2.0, 32.0)
        self._update_zoom_display()
        self._update_waveform_display()

    def _zoom_out(self):
        """Zoom out on the waveform"""
        self.zoom_level = max(self.zoom_level / 2.0, 1.0)
        self._update_zoom_display()
        self._update_waveform_display()

    def _zoom_reset(self):
        """Reset zoom to 1x"""
        self.zoom_level = 1.0
        self.zoom_center = 0.5
        self._update_zoom_display()
        self._update_waveform_display()

    def _update_zoom_display(self):
        """Update the zoom level display"""
        self.zoom_label.configure(text=f"{self.zoom_level:.1f}x")

    def clear(self):
        """Clear the visualization"""
        self.waveform_data = None
        self.sample_rate = 0
        self.current_position = 0.0
        self.total_duration = 0.0
        self.zoom_level = 1.0
        self.zoom_center = 0.5
        self._update_zoom_display()
        self._initialize_plot()

    def clear_position_indicator(self):
        """Clear only the position indicator without affecting the waveform"""
        self.current_position = 0.0
        if self.waveform_data is not None:
            self._update_waveform_display()


class SpectrumAnalyzer:
    """Real-time spectrum analyzer visualization"""

    def __init__(self, parent_frame: ctk.CTkFrame, width: int = 800, height: int = 120):
        self.parent = parent_frame
        self.width = width
        self.height = height

        # Analysis parameters
        self.fft_size = 1024
        self.sample_rate = 44100
        self.frequency_bins = None
        self.magnitude_data = None

        # Audio data for analysis
        self.audio_data = None
        self.current_position = 0.0
        self.total_duration = 0.0

        # Matplotlib setup
        self.figure = Figure(
            figsize=(width / 100, height / 100), dpi=100, facecolor="#2b2b2b"
        )
        # Adjust subplot to use more space and reduce margins
        self.ax = self.figure.add_subplot(111)
        self.figure.subplots_adjust(left=0.02, right=0.98, top=0.95, bottom=0.05)
        self.canvas = FigureCanvasTkAgg(self.figure, parent_frame)

        # Animation
        self.animation = None
        self.is_running = False

        # Styling
        self._setup_styling()

        # Initialize plot
        self._initialize_plot()

        # Pack canvas to fill available space
        self.canvas.get_tk_widget().pack(fill="both", expand=True, padx=2, pady=2)

    def _setup_styling(self):
        """Setup matplotlib styling"""
        self.figure.patch.set_facecolor("#2b2b2b")
        self.ax.set_facecolor("#1a1a1a")

        # Colors
        self.spectrum_color = "#00ff88"
        self.background_color = "#1a1a1a"
        self.grid_color = "#404040"

    def _initialize_plot(self):
        """Initialize spectrum plot"""
        try:
            self.ax.clear()
            self.ax.set_facecolor(self.background_color)

            # Set up frequency axis (logarithmic scale)
            freqs = np.logspace(1, 4, 100)  # 10 Hz to 10 kHz
            mags = np.zeros_like(freqs)

            # Plot empty spectrum
            (self.spectrum_line,) = self.ax.semilogx(
                freqs, mags, color=self.spectrum_color, linewidth=1.5
            )

            # Styling
            self.ax.set_xlim(10, 10000)
            self.ax.set_ylim(-80, 0)
            self.ax.set_xlabel("Frequency (Hz)", color="#cccccc", fontsize=10)
            self.ax.set_ylabel("Magnitude (dB)", color="#cccccc", fontsize=10)

            # Grid
            self.ax.grid(True, color=self.grid_color, alpha=0.3, linewidth=0.5)

            # Tick styling
            self.ax.tick_params(colors="#cccccc", labelsize=8)

            # Spine styling
            for spine in self.ax.spines.values():
                spine.set_color("#404040")
                spine.set_linewidth(0.5)

            # Draw the canvas with error handling
            try:
                self.canvas.draw()
            except RecursionError:
                # If we get a recursion error, skip the initial draw
                # The canvas will be drawn when it's actually displayed
                logger.warning(
                    "SpectrumAnalyzer",
                    "_initialize_plot", 
                    "Skipping initial canvas draw due to recursion error"
                )
        except Exception as e:
            logger.error(
                "SpectrumAnalyzer",
                "_initialize_plot",
                f"Error initializing plot: {e}"
            )

    def start_analysis(self, audio_data: np.ndarray, sample_rate: int):
        """Start real-time spectrum analysis"""
        try:
            # Stop any existing animation first
            self.stop_analysis()
            
            self.sample_rate = sample_rate
            self.audio_data = audio_data

            # Get audio duration
            self.total_duration = len(audio_data) / sample_rate

            # Prepare frequency bins
            self.frequency_bins = fftfreq(self.fft_size, 1 / sample_rate)[
                : self.fft_size // 2
            ]

            # Ensure we have valid audio data
            if len(audio_data) == 0:
                logger.warning(
                    "SpectrumAnalyzer", "start_analysis", "No audio data provided"
                )
                return

            # Start animation with explicit settings to ensure it runs
            logger.info(
                "SpectrumAnalyzer", 
                "start_analysis", 
                f"Starting spectrum analysis with {len(audio_data)} samples at {sample_rate} Hz"
            )
            
            self.is_running = True
            self.animation = animation.FuncAnimation(
                self.figure,
                self._update_spectrum,
                interval=50,  # Faster update - every 50ms for smoother animation
                blit=False,
                cache_frame_data=False,
                repeat=True,  # Keep repeating the animation
            )
            
            # Force initial draw to start the animation
            try:
                self.canvas.draw()
                logger.info(
                    "SpectrumAnalyzer", "start_analysis", "Initial canvas draw completed"
                )
            except Exception as draw_error:
                logger.warning(
                    "SpectrumAnalyzer", "start_analysis", f"Initial draw warning: {draw_error}"
                )

            logger.info(
                "SpectrumAnalyzer", "start_analysis", "Spectrum analysis started successfully"
            )

        except Exception as e:
            logger.error(
                "SpectrumAnalyzer", "start_analysis", f"Error starting analysis: {e}"
            )

    def stop_analysis(self):
        """Stop spectrum analysis"""
        try:
            self.is_running = False
            if self.animation:
                self.animation.event_source.stop()
                self.animation = None

            logger.info(
                "SpectrumAnalyzer", "stop_analysis", "Spectrum analysis stopped"
            )

        except Exception as e:
            logger.error(
                "SpectrumAnalyzer", "stop_analysis", f"Error stopping analysis: {e}"
            )

    def update_position(self, position: float):
        """Update current playback position for spectrum analysis"""
        self.current_position = position

    def _update_spectrum(self, frame):
        """Update spectrum display (animation callback)"""
        try:
            if not self.is_running or self.audio_data is None:
                return []

            # Calculate current sample position based on playback position
            if self.total_duration > 0:
                sample_position = int(self.current_position * self.sample_rate)
            else:
                sample_position = 0

            # Extract audio chunk for FFT analysis
            chunk_start = max(0, sample_position)
            chunk_end = min(len(self.audio_data), chunk_start + self.fft_size)

            if chunk_end - chunk_start < self.fft_size // 2:
                # Not enough data for meaningful analysis
                freqs = np.logspace(1, 4, 50)
                spectrum = np.full_like(freqs, -80.0)
            else:
                # Get audio chunk and pad if necessary
                audio_chunk = self.audio_data[chunk_start:chunk_end]
                if len(audio_chunk) < self.fft_size:
                    audio_chunk = np.pad(
                        audio_chunk, (0, self.fft_size - len(audio_chunk))
                    )

                # Apply window function to reduce spectral leakage
                windowed_chunk = audio_chunk * np.hanning(len(audio_chunk))

                # Perform FFT
                fft_data = np.fft.fft(windowed_chunk)
                fft_magnitude = np.abs(fft_data[: self.fft_size // 2])

                # Convert to dB scale
                fft_magnitude = np.maximum(fft_magnitude, 1e-10)  # Avoid log(0)
                spectrum_db = 20 * np.log10(fft_magnitude)

                # Create frequency bins
                freqs = np.fft.fftfreq(self.fft_size, 1 / self.sample_rate)[
                    : self.fft_size // 2
                ]

                # Resample to logarithmic frequency scale for better visualization
                log_freqs = np.logspace(1, np.log10(self.sample_rate / 2), 50)
                spectrum = np.interp(
                    log_freqs, freqs[1:], spectrum_db[1:]
                )  # Skip DC component

                # Normalize and smooth
                spectrum = spectrum - np.max(spectrum)  # Normalize to 0 dB max
                spectrum = np.maximum(spectrum, -80)  # Clamp minimum

                # Apply smoothing
                if len(spectrum) > 5:
                    spectrum = signal.savgol_filter(
                        spectrum, min(5, len(spectrum) // 2 * 2 + 1), 2
                    )

                freqs = log_freqs

            # Update plot data
            self.spectrum_line.set_data(freqs, spectrum)
            
            # Force canvas redraw to make sure spectrum is visible
            try:
                self.canvas.draw_idle()
                # Log occasionally to avoid spam, but show that it's working
                if int(self.current_position * 10) % 20 == 0:  # Log every 2 seconds
                    logger.info(
                        "SpectrumAnalyzer",
                        "_update_spectrum",
                        f"Updated spectrum at {self.current_position:.1f}s, freq range: {freqs[0]:.1f}-{freqs[-1]:.1f} Hz, max magnitude: {np.max(spectrum):.1f} dB"
                    )
            except Exception as draw_error:
                logger.error(
                    "SpectrumAnalyzer",
                    "_update_spectrum",
                    f"Canvas draw error: {draw_error}"
                )

            return [self.spectrum_line]

        except Exception as e:
            logger.error(
                "SpectrumAnalyzer", "_update_spectrum", f"Error updating spectrum: {e}"
            )
            return []


class AudioVisualizationWidget(ctk.CTkFrame):
    """Combined audio visualization widget"""

    def __init__(self, parent, height=180, **kwargs):
        super().__init__(parent, **kwargs)
        
        # Set a fixed height for the widget and prevent it from expanding
        self.configure(height=height)
        self.pack_propagate(False)  # Prevent child widgets from affecting our size
        
        # Audio player reference (will be set by parent)
        self.audio_player = None
        self.current_speed = 1.0

        # Create notebook for different visualization types
        self.notebook = ctk.CTkTabview(self, height=height-40)  # Leave room for controls
        self.notebook.pack(fill="x", expand=False, padx=3, pady=3)

        # Waveform tab
        self.waveform_tab = self.notebook.add("Waveform")
        self.waveform_visualizer = WaveformVisualizer(self.waveform_tab, height=height-80)

        # Spectrum tab
        self.spectrum_tab = self.notebook.add("Spectrum")
        self.spectrum_analyzer = SpectrumAnalyzer(self.spectrum_tab, height=height-80)

        # Set up tab change callback
        self.notebook.configure(command=self._on_tab_changed)

        # Control frame for audio controls and theme toggle
        self.control_frame = ctk.CTkFrame(self)
        self.control_frame.pack(fill="x", padx=3, pady=(0, 3))

        # Speed control section
        self._create_speed_controls()

        # Audio controls are handled by the main toolbar - no duplicate controls needed here

        # Theme toggle button (floating in top-right corner)
        self.theme_frame = ctk.CTkFrame(self, fg_color="transparent")
        self.theme_frame.place(relx=0.98, rely=0.02, anchor="ne")

        # Load theme toggle icons
        self._load_theme_icons()

        self.is_dark_theme = True

        # Create theme toggle button with appropriate icon or fallback text
        if self.moon_icon:
            self.theme_toggle = ctk.CTkButton(
                self.theme_frame,
                image=self.moon_icon,
                text="",  # No text, just icon
                width=30,
                height=30,
                command=self._toggle_theme,
                fg_color="transparent",
                hover_color=("gray80", "gray20"),
            )
        else:
            # Fallback to emoji if icons not available
            self.theme_toggle = ctk.CTkButton(
                self.theme_frame,
                text="🌙",  # Moon emoji for dark theme
                width=30,
                height=30,
                command=self._toggle_theme,
                fg_color="transparent",
                hover_color=("gray80", "gray20"),
            )
        self.theme_toggle.pack()

        # Remove redundant checkboxes - tabs already provide this functionality
        # Visualization state is now controlled by the active tab
        self.show_waveform_var = ctk.BooleanVar(value=True)
        self.show_spectrum_var = ctk.BooleanVar(value=True)  # Always enable spectrum analyzer

    def _load_theme_icons(self):
        """Load theme toggle icons"""
        try:
            import os

            from PIL import Image

            # Get the script directory and construct icon paths
            script_dir = os.path.dirname(os.path.abspath(__file__))
            icons_dir = os.path.join(script_dir, "icons", "white", "16")

            moon_path = os.path.join(icons_dir, "moon-o.png")
            sun_path = os.path.join(icons_dir, "sun-o.png")

            # Load and create CTkImage objects
            if os.path.exists(moon_path):
                moon_image = Image.open(moon_path)
                self.moon_icon = ctk.CTkImage(
                    light_image=moon_image, dark_image=moon_image, size=(16, 16)
                )
            else:
                self.moon_icon = None
                logger.warning(
                    "AudioVisualizationWidget",
                    "_load_theme_icons",
                    f"Moon icon not found at {moon_path}",
                )

            if os.path.exists(sun_path):
                sun_image = Image.open(sun_path)
                self.sun_icon = ctk.CTkImage(
                    light_image=sun_image, dark_image=sun_image, size=(16, 16)
                )
            else:
                self.sun_icon = None
                logger.warning(
                    "AudioVisualizationWidget",
                    "_load_theme_icons",
                    f"Sun icon not found at {sun_path}",
                )

        except Exception as e:
            logger.error(
                "AudioVisualizationWidget",
                "_load_theme_icons",
                f"Error loading theme icons: {e}",
            )
            self.moon_icon = None
            self.sun_icon = None

    def load_audio(self, filepath: str) -> bool:
        """Load audio file for visualization"""
        try:
            success = True

            if self.show_waveform_var.get():
                success &= self.waveform_visualizer.load_audio(filepath)

            return success

        except Exception as e:
            logger.error(
                "AudioVisualizationWidget", "load_audio", f"Error loading audio: {e}"
            )
            return False

    def update_position(self, position: PlaybackPosition):
        """Update playback position in visualizations"""
        try:
            # Always update waveform if it's being shown
            if self.show_waveform_var.get():
                self.waveform_visualizer.update_position(position)

            # Always update spectrum analyzer position regardless of tab visibility
            # The animation needs position updates to work properly
            self.spectrum_analyzer.update_position(position.current_time)

        except Exception as e:
            logger.error(
                "AudioVisualizationWidget",
                "update_position",
                f"Error updating position: {e}",
            )

    def start_spectrum_analysis(self, audio_data: np.ndarray, sample_rate: int):
        """Start spectrum analysis"""
        try:
            # Always start spectrum analysis when audio is playing regardless of current tab
            # The tab visibility only controls what the user sees, not the functionality
            logger.info(
                "AudioVisualizationWidget",
                "start_spectrum_analysis",
                f"Starting spectrum analysis for {len(audio_data)} samples at {sample_rate} Hz"
            )
            
            self.spectrum_analyzer.start_analysis(audio_data, sample_rate)
            
            logger.info(
                "AudioVisualizationWidget",
                "start_spectrum_analysis", 
                "Spectrum analysis started successfully"
            )
        except Exception as e:
            logger.error(
                "AudioVisualizationWidget",
                "start_spectrum_analysis",
                f"Error starting spectrum analysis: {e}"
            )

    def stop_spectrum_analysis(self):
        """Stop spectrum analysis"""
        self.spectrum_analyzer.stop_analysis()

    def _play_audio(self):
        """Play audio - delegate to parent GUI"""
        try:
            # Get reference to main window through parent chain
            main_window = self._get_main_window()
            if main_window and hasattr(main_window, "audio_player"):
                main_window.audio_player.play()
        except Exception as e:
            logger.error(
                "AudioVisualizationWidget", "_play_audio", f"Error playing audio: {e}"
            )

    def _pause_audio(self):
        """Pause audio - delegate to parent GUI"""
        try:
            main_window = self._get_main_window()
            if main_window and hasattr(main_window, "audio_player"):
                main_window.audio_player.pause()
        except Exception as e:
            logger.error(
                "AudioVisualizationWidget", "_pause_audio", f"Error pausing audio: {e}"
            )

    def _stop_audio(self):
        """Stop audio - delegate to parent GUI"""
        try:
            main_window = self._get_main_window()
            if main_window and hasattr(main_window, "audio_player"):
                main_window.audio_player.stop()
        except Exception as e:
            logger.error(
                "AudioVisualizationWidget", "_stop_audio", f"Error stopping audio: {e}"
            )

    def _get_main_window(self):
        """Get reference to main window through parent chain"""
        widget = self
        while widget:
            if hasattr(widget, "audio_player"):
                return widget
            widget = widget.master
        return None

    def _toggle_theme(self):
        """Toggle between dark and light themes"""
        try:
            self.is_dark_theme = not self.is_dark_theme

            if self.is_dark_theme:
                # Dark theme
                if self.moon_icon:
                    self.theme_toggle.configure(image=self.moon_icon, text="")
                else:
                    self.theme_toggle.configure(image=None, text="🌙")
                colors = {"waveform": "#4a9eff", "spectrum": "#00ff88", "bg": "#1a1a1a"}
            else:
                # Light theme
                if self.sun_icon:
                    self.theme_toggle.configure(image=self.sun_icon, text="")
                else:
                    self.theme_toggle.configure(image=None, text="☀️")
                colors = {"waveform": "#2563eb", "spectrum": "#059669", "bg": "#f8fafc"}

            # Update visualizer colors
            self.waveform_visualizer.waveform_color = colors["waveform"]
            self.waveform_visualizer.background_color = colors["bg"]

            self.spectrum_analyzer.spectrum_color = colors["spectrum"]
            self.spectrum_analyzer.background_color = colors["bg"]

            # Refresh displays
            self.waveform_visualizer._apply_theme_colors()
            self.waveform_visualizer._update_waveform_display()
            self.spectrum_analyzer._initialize_plot()

        except Exception as e:
            logger.error(
                "AudioVisualizationWidget",
                "_toggle_theme",
                f"Error toggling theme: {e}",
            )

    def _update_tab_state(self):
        """Update visualization state based on active tab"""
        try:
            active_tab = self.notebook.get()
            self.show_waveform_var.set(active_tab == "Waveform")
            self.show_spectrum_var.set(active_tab == "Spectrum")
        except Exception as e:
            logger.error(
                "AudioVisualizationWidget",
                "_update_tab_state",
                f"Error updating tab state: {e}",
            )

        except Exception as e:
            logger.error(
                "AudioVisualizationWidget",
                "_change_theme",
                f"Error changing theme: {e}",
            )

    def _on_tab_changed(self):
        """Handle tab change events"""
        try:
            self._update_tab_state()

            # Start/stop spectrum analysis based on active tab
            active_tab = self.notebook.get()
            if active_tab == "Spectrum":
                # Start spectrum analysis if we have audio data
                main_window = self._get_main_window()
                if main_window and hasattr(main_window, "audio_player"):
                    current_track = main_window.audio_player.get_current_track()
                    if current_track:
                        try:
                            from audio_player_enhanced import AudioProcessor

                            waveform_data, sample_rate = (
                                AudioProcessor.extract_waveform_data(
                                    current_track.filepath, max_points=1024
                                )
                            )
                            if len(waveform_data) > 0:
                                self.start_spectrum_analysis(waveform_data, sample_rate)
                        except Exception:
                            pass  # Ignore errors, spectrum will show default animation
            else:
                # Stop spectrum analysis when not on spectrum tab
                self.stop_spectrum_analysis()

        except Exception as e:
            logger.error(
                "AudioVisualizationWidget",
                "_on_tab_changed",
                f"Error handling tab change: {e}",
            )

    def clear(self):
        """Clear all visualizations"""
        self.waveform_visualizer.clear()
        self.spectrum_analyzer.stop_analysis()

    def clear_position_indicators(self):
        """Clear position indicators from all visualizations"""
        self.waveform_visualizer.clear_position_indicator()
        # Spectrum analyzer position is updated per frame, no persistent indicator to clear

    def set_audio_player(self, audio_player):
        """Set the audio player reference for speed controls"""
        self.audio_player = audio_player
        if audio_player:
            self.current_speed = audio_player.get_playback_speed()
            self._update_speed_display()

    def _create_speed_controls(self):
        """Create audio playback speed control widgets"""
        try:
            # Speed control section
            speed_frame = ctk.CTkFrame(self.control_frame)
            speed_frame.pack(side="left", padx=(5, 10), pady=3)

            # Speed label
            ctk.CTkLabel(
                speed_frame,
                text="Speed:",
                font=ctk.CTkFont(size=12, weight="bold")
            ).pack(side="left", padx=(8, 5))

            # Speed decrease button
            self.speed_down_btn = ctk.CTkButton(
                speed_frame,
                text="−",
                width=30,
                height=24,
                font=ctk.CTkFont(size=16, weight="bold"),
                command=self._decrease_speed
            )
            self.speed_down_btn.pack(side="left", padx=2)

            # Speed display
            self.speed_label = ctk.CTkLabel(
                speed_frame,
                text="1.0x",
                width=50,
                font=ctk.CTkFont(size=12, weight="bold")
            )
            self.speed_label.pack(side="left", padx=5)

            # Speed increase button
            self.speed_up_btn = ctk.CTkButton(
                speed_frame,
                text="+",
                width=30,
                height=24,
                font=ctk.CTkFont(size=16, weight="bold"),
                command=self._increase_speed
            )
            self.speed_up_btn.pack(side="left", padx=2)

            # Speed reset button
            self.speed_reset_btn = ctk.CTkButton(
                speed_frame,
                text="Reset",
                width=50,
                height=24,
                font=ctk.CTkFont(size=11),
                command=self._reset_speed
            )
            self.speed_reset_btn.pack(side="left", padx=(5, 8))

            # Preset speed buttons
            preset_frame = ctk.CTkFrame(self.control_frame)
            preset_frame.pack(side="left", padx=5, pady=3)

            ctk.CTkLabel(
                preset_frame,
                text="Presets:",
                font=ctk.CTkFont(size=10)
            ).pack(side="left", padx=(5, 3))

            # Create preset buttons for common speeds
            preset_speeds = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0]
            for speed in preset_speeds:
                btn = ctk.CTkButton(
                    preset_frame,
                    text=f"{speed}x",
                    width=35,
                    height=20,
                    font=ctk.CTkFont(size=9),
                    command=lambda s=speed: self._set_speed_preset(s)
                )
                btn.pack(side="left", padx=1)

        except Exception as e:
            logger.error(
                "AudioVisualizationWidget",
                "_create_speed_controls",
                f"Error creating speed controls: {e}"
            )

    def _decrease_speed(self):
        """Decrease playback speed"""
        if self.audio_player:
            new_speed = self.audio_player.decrease_speed()
            self.current_speed = new_speed
            self._update_speed_display()

    def _increase_speed(self):
        """Increase playback speed"""
        if self.audio_player:
            new_speed = self.audio_player.increase_speed()
            self.current_speed = new_speed
            self._update_speed_display()

    def _reset_speed(self):
        """Reset playback speed to normal"""
        if self.audio_player:
            new_speed = self.audio_player.reset_speed()
            self.current_speed = new_speed
            self._update_speed_display()

    def _set_speed_preset(self, speed):
        """Set playback speed to preset value"""
        logger.info(
            "AudioVisualizationWidget",
            "_set_speed_preset",
            f"Setting playback speed to {speed}x"
        )
        if self.audio_player:
            success = self.audio_player.set_playback_speed(speed)
            if success:
                self.current_speed = speed
                self._update_speed_display()
                logger.info(
                    "AudioVisualizationWidget",
                    "_set_speed_preset",
                    f"Successfully set speed to {speed}x"
                )
            else:
                logger.error(
                    "AudioVisualizationWidget",
                    "_set_speed_preset",
                    f"Failed to set speed to {speed}x"
                )
        else:
            logger.warning(
                "AudioVisualizationWidget",
                "_set_speed_preset",
                "No audio player reference available"
            )

    def _update_speed_display(self):
        """Update the speed display label"""
        try:
            if hasattr(self, 'speed_label'):
                self.speed_label.configure(text=f"{self.current_speed:.2f}x")
        except Exception as e:
            logger.error(
                "AudioVisualizationWidget",
                "_update_speed_display", 
                f"Error updating speed display: {e}"
            )
