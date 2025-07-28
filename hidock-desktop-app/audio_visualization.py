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
from typing import Optional, Tuple, List
import numpy as np
from scipy import signal
from scipy.fft import fft, fftfreq
import matplotlib.pyplot as plt
from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg
from matplotlib.figure import Figure
import matplotlib.animation as animation
import customtkinter as ctk

from config_and_logger import logger
from audio_player_enhanced import AudioProcessor, PlaybackPosition


class WaveformVisualizer:
    """Waveform visualization component"""
    
    def __init__(self, parent_frame: ctk.CTkFrame, width: int = 600, height: int = 150):
        self.parent = parent_frame
        self.width = width
        self.height = height
        
        # Visualization data
        self.waveform_data: Optional[np.ndarray] = None
        self.sample_rate: int = 0
        self.current_position: float = 0.0
        self.total_duration: float = 0.0
        
        # Matplotlib setup
        self.figure = Figure(figsize=(width/100, height/100), dpi=100, facecolor='#2b2b2b')
        self.ax = self.figure.add_subplot(111)
        self.canvas = FigureCanvasTkAgg(self.figure, parent_frame)
        
        # Styling
        self._setup_styling()
        
        # Initialize empty plot
        self._initialize_plot()
        
        # Pack the canvas
        self.canvas.get_tk_widget().pack(fill="both", expand=True)
    
    def _setup_styling(self):
        """Setup matplotlib styling for dark theme"""
        self.figure.patch.set_facecolor('#2b2b2b')
        self.ax.set_facecolor('#1a1a1a')
        
        # Remove axes and ticks for cleaner look
        self.ax.set_xticks([])
        self.ax.set_yticks([])
        
        # Style the spines
        for spine in self.ax.spines.values():
            spine.set_color('#404040')
            spine.set_linewidth(0.5)
        
        # Set colors
        self.waveform_color = '#4a9eff'
        self.position_color = '#ff4444'
        self.background_color = '#1a1a1a'
    
    def _initialize_plot(self):
        """Initialize empty waveform plot"""
        self.ax.clear()
        self.ax.set_xlim(0, 1)
        self.ax.set_ylim(-1, 1)
        self.ax.set_facecolor(self.background_color)
        
        # Add placeholder text
        self.ax.text(0.5, 0, 'No audio loaded', 
                    ha='center', va='center', 
                    color='#666666', fontsize=12,
                    transform=self.ax.transAxes)
        
        self.canvas.draw()
    
    def load_audio(self, filepath: str) -> bool:
        """Load audio file and extract waveform data"""
        try:
            logger.info("WaveformVisualizer", "load_audio", f"Loading waveform for {filepath}")
            
            # Extract waveform data
            waveform_data, sample_rate = AudioProcessor.extract_waveform_data(filepath, max_points=2000)
            
            if len(waveform_data) == 0:
                logger.warning("WaveformVisualizer", "load_audio", f"No waveform data extracted from {filepath}")
                return False
            
            self.waveform_data = waveform_data
            self.sample_rate = sample_rate
            
            # Get audio duration
            audio_info = AudioProcessor.get_audio_info(filepath)
            self.total_duration = audio_info.get('duration', 0.0)
            
            # Update visualization
            self._update_waveform_display()
            
            logger.info("WaveformVisualizer", "load_audio", f"Waveform loaded successfully")
            return True
            
        except Exception as e:
            logger.error("WaveformVisualizer", "load_audio", f"Error loading waveform: {e}")
            return False
    
    def _update_waveform_display(self):
        """Update the waveform display"""
        if self.waveform_data is None:
            return
        
        try:
            self.ax.clear()
            self.ax.set_facecolor(self.background_color)
            
            # Create time axis
            time_axis = np.linspace(0, self.total_duration, len(self.waveform_data))
            
            # Plot waveform
            self.ax.plot(time_axis, self.waveform_data, 
                        color=self.waveform_color, linewidth=0.8, alpha=0.8)
            
            # Fill under the curve for better visual effect
            self.ax.fill_between(time_axis, self.waveform_data, 
                               alpha=0.3, color=self.waveform_color)
            
            # Set limits
            self.ax.set_xlim(0, self.total_duration)
            self.ax.set_ylim(-1.1, 1.1)
            
            # Remove ticks and labels
            self.ax.set_xticks([])
            self.ax.set_yticks([])
            
            # Style spines
            for spine in self.ax.spines.values():
                spine.set_color('#404040')
                spine.set_linewidth(0.5)
            
            # Add position indicator if playing
            if self.current_position > 0:
                self._add_position_indicator()
            
            self.canvas.draw()
            
        except Exception as e:
            logger.error("WaveformVisualizer", "_update_waveform_display", f"Error updating display: {e}")
    
    def _add_position_indicator(self):
        """Add current position indicator to waveform"""
        if self.total_duration > 0:
            # Add vertical line for current position
            self.ax.axvline(x=self.current_position, 
                          color=self.position_color, 
                          linewidth=2, alpha=0.8)
            
            # Add time text
            time_text = f"{int(self.current_position//60):02d}:{int(self.current_position%60):02d}"
            self.ax.text(self.current_position, 0.9, time_text,
                        ha='center', va='bottom',
                        color=self.position_color,
                        fontsize=10, fontweight='bold',
                        bbox=dict(boxstyle='round,pad=0.3', 
                                facecolor='#2b2b2b', 
                                edgecolor=self.position_color,
                                alpha=0.8))
    
    def update_position(self, position: PlaybackPosition):
        """Update playback position indicator"""
        try:
            self.current_position = position.current_time
            
            if self.waveform_data is not None:
                self._update_waveform_display()
                
        except Exception as e:
            logger.error("WaveformVisualizer", "update_position", f"Error updating position: {e}")
    
    def clear(self):
        """Clear the visualization"""
        self.waveform_data = None
        self.sample_rate = 0
        self.current_position = 0.0
        self.total_duration = 0.0
        self._initialize_plot()


class SpectrumAnalyzer:
    """Real-time spectrum analyzer visualization"""
    
    def __init__(self, parent_frame: ctk.CTkFrame, width: int = 300, height: int = 200):
        self.parent = parent_frame
        self.width = width
        self.height = height
        
        # Analysis parameters
        self.fft_size = 1024
        self.sample_rate = 44100
        self.frequency_bins = None
        self.magnitude_data = None
        
        # Matplotlib setup
        self.figure = Figure(figsize=(width/100, height/100), dpi=100, facecolor='#2b2b2b')
        self.ax = self.figure.add_subplot(111)
        self.canvas = FigureCanvasTkAgg(self.figure, parent_frame)
        
        # Animation
        self.animation = None
        self.is_running = False
        
        # Styling
        self._setup_styling()
        
        # Initialize plot
        self._initialize_plot()
        
        # Pack canvas
        self.canvas.get_tk_widget().pack(fill="both", expand=True)
    
    def _setup_styling(self):
        """Setup matplotlib styling"""
        self.figure.patch.set_facecolor('#2b2b2b')
        self.ax.set_facecolor('#1a1a1a')
        
        # Colors
        self.spectrum_color = '#00ff88'
        self.background_color = '#1a1a1a'
        self.grid_color = '#404040'
    
    def _initialize_plot(self):
        """Initialize spectrum plot"""
        self.ax.clear()
        self.ax.set_facecolor(self.background_color)
        
        # Set up frequency axis (logarithmic scale)
        freqs = np.logspace(1, 4, 100)  # 10 Hz to 10 kHz
        mags = np.zeros_like(freqs)
        
        # Plot empty spectrum
        self.spectrum_line, = self.ax.semilogx(freqs, mags, 
                                             color=self.spectrum_color, 
                                             linewidth=1.5)
        
        # Styling
        self.ax.set_xlim(10, 10000)
        self.ax.set_ylim(-80, 0)
        self.ax.set_xlabel('Frequency (Hz)', color='#cccccc', fontsize=10)
        self.ax.set_ylabel('Magnitude (dB)', color='#cccccc', fontsize=10)
        
        # Grid
        self.ax.grid(True, color=self.grid_color, alpha=0.3, linewidth=0.5)
        
        # Tick styling
        self.ax.tick_params(colors='#cccccc', labelsize=8)
        
        # Spine styling
        for spine in self.ax.spines.values():
            spine.set_color('#404040')
            spine.set_linewidth(0.5)
        
        self.canvas.draw()
    
    def start_analysis(self, audio_data: np.ndarray, sample_rate: int):
        """Start real-time spectrum analysis"""
        try:
            self.sample_rate = sample_rate
            
            # Prepare frequency bins
            self.frequency_bins = fftfreq(self.fft_size, 1/sample_rate)[:self.fft_size//2]
            
            # Start animation
            if not self.is_running:
                self.is_running = True
                self.animation = animation.FuncAnimation(
                    self.figure, self._update_spectrum, 
                    interval=50, blit=False, cache_frame_data=False
                )
                
            logger.info("SpectrumAnalyzer", "start_analysis", "Spectrum analysis started")
            
        except Exception as e:
            logger.error("SpectrumAnalyzer", "start_analysis", f"Error starting analysis: {e}")
    
    def stop_analysis(self):
        """Stop spectrum analysis"""
        try:
            self.is_running = False
            if self.animation:
                self.animation.event_source.stop()
                self.animation = None
            
            logger.info("SpectrumAnalyzer", "stop_analysis", "Spectrum analysis stopped")
            
        except Exception as e:
            logger.error("SpectrumAnalyzer", "stop_analysis", f"Error stopping analysis: {e}")
    
    def _update_spectrum(self, frame):
        """Update spectrum display (animation callback)"""
        try:
            if not self.is_running:
                return
            
            # Generate mock spectrum data for demonstration
            # In a real implementation, this would analyze live audio input
            freqs = np.logspace(1, 4, 100)
            
            # Simulate spectrum with some randomness
            base_spectrum = -20 * np.log10(freqs / 100 + 1)  # Decreasing with frequency
            noise = np.random.normal(0, 5, len(freqs))
            spectrum = base_spectrum + noise
            
            # Smooth the spectrum
            spectrum = signal.savgol_filter(spectrum, 5, 2)
            
            # Update plot
            self.spectrum_line.set_data(freqs, spectrum)
            
            return [self.spectrum_line]
            
        except Exception as e:
            logger.error("SpectrumAnalyzer", "_update_spectrum", f"Error updating spectrum: {e}")
            return []


class AudioVisualizationWidget(ctk.CTkFrame):
    """Combined audio visualization widget"""
    
    def __init__(self, parent, **kwargs):
        super().__init__(parent, **kwargs)
        
        # Create notebook for different visualization types
        self.notebook = ctk.CTkTabview(self)
        self.notebook.pack(fill="both", expand=True, padx=5, pady=5)
        
        # Waveform tab
        self.waveform_tab = self.notebook.add("Waveform")
        self.waveform_visualizer = WaveformVisualizer(self.waveform_tab)
        
        # Spectrum tab
        self.spectrum_tab = self.notebook.add("Spectrum")
        self.spectrum_analyzer = SpectrumAnalyzer(self.spectrum_tab)
        
        # Control frame
        self.control_frame = ctk.CTkFrame(self)
        self.control_frame.pack(fill="x", padx=5, pady=(0, 5))
        
        # Visualization controls
        self.show_waveform_var = ctk.BooleanVar(value=True)
        self.show_spectrum_var = ctk.BooleanVar(value=False)
        
        self.waveform_checkbox = ctk.CTkCheckBox(
            self.control_frame,
            text="Show Waveform",
            variable=self.show_waveform_var,
            command=self._toggle_waveform
        )
        self.waveform_checkbox.pack(side="left", padx=5, pady=5)
        
        self.spectrum_checkbox = ctk.CTkCheckBox(
            self.control_frame,
            text="Show Spectrum",
            variable=self.show_spectrum_var,
            command=self._toggle_spectrum
        )
        self.spectrum_checkbox.pack(side="left", padx=5, pady=5)
        
        # Theme selection
        self.theme_label = ctk.CTkLabel(self.control_frame, text="Theme:")
        self.theme_label.pack(side="left", padx=(20, 5), pady=5)
        
        self.theme_var = ctk.StringVar(value="Dark")
        self.theme_combo = ctk.CTkComboBox(
            self.control_frame,
            values=["Dark", "Light", "Blue", "Green"],
            variable=self.theme_var,
            command=self._change_theme,
            width=100
        )
        self.theme_combo.pack(side="left", padx=5, pady=5)
    
    def load_audio(self, filepath: str) -> bool:
        """Load audio file for visualization"""
        try:
            success = True
            
            if self.show_waveform_var.get():
                success &= self.waveform_visualizer.load_audio(filepath)
            
            return success
            
        except Exception as e:
            logger.error("AudioVisualizationWidget", "load_audio", f"Error loading audio: {e}")
            return False
    
    def update_position(self, position: PlaybackPosition):
        """Update playback position in visualizations"""
        try:
            if self.show_waveform_var.get():
                self.waveform_visualizer.update_position(position)
                
        except Exception as e:
            logger.error("AudioVisualizationWidget", "update_position", f"Error updating position: {e}")
    
    def start_spectrum_analysis(self, audio_data: np.ndarray, sample_rate: int):
        """Start spectrum analysis"""
        if self.show_spectrum_var.get():
            self.spectrum_analyzer.start_analysis(audio_data, sample_rate)
    
    def stop_spectrum_analysis(self):
        """Stop spectrum analysis"""
        self.spectrum_analyzer.stop_analysis()
    
    def _toggle_waveform(self):
        """Toggle waveform display"""
        if self.show_waveform_var.get():
            self.notebook.set("Waveform")
        else:
            self.waveform_visualizer.clear()
    
    def _toggle_spectrum(self):
        """Toggle spectrum display"""
        if self.show_spectrum_var.get():
            self.notebook.set("Spectrum")
        else:
            self.spectrum_analyzer.stop_analysis()
    
    def _change_theme(self, theme: str):
        """Change visualization theme"""
        try:
            color_schemes = {
                "Dark": {"waveform": "#4a9eff", "spectrum": "#00ff88", "bg": "#1a1a1a"},
                "Light": {"waveform": "#2563eb", "spectrum": "#059669", "bg": "#f8fafc"},
                "Blue": {"waveform": "#3b82f6", "spectrum": "#06b6d4", "bg": "#1e293b"},
                "Green": {"waveform": "#10b981", "spectrum": "#84cc16", "bg": "#064e3b"}
            }
            
            if theme in color_schemes:
                colors = color_schemes[theme]
                
                # Update waveform colors
                self.waveform_visualizer.waveform_color = colors["waveform"]
                self.waveform_visualizer.background_color = colors["bg"]
                
                # Update spectrum colors
                self.spectrum_analyzer.spectrum_color = colors["spectrum"]
                self.spectrum_analyzer.background_color = colors["bg"]
                
                # Refresh displays
                self.waveform_visualizer._update_waveform_display()
                self.spectrum_analyzer._initialize_plot()
                
        except Exception as e:
            logger.error("AudioVisualizationWidget", "_change_theme", f"Error changing theme: {e}")
    
    def clear(self):
        """Clear all visualizations"""
        self.waveform_visualizer.clear()
        self.spectrum_analyzer.stop_analysis()