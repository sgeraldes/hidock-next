"""
Edge case tests for audio_visualization.py to achieve maximum coverage

This file focuses on specific edge cases and boundary conditions that may not be
covered by the main test suite, targeting the remaining uncovered lines.
"""

import os
import sys
import unittest
from unittest.mock import MagicMock, Mock, PropertyMock, patch

import pytest

# Mark as GUI test for architectural separation
pytestmark = pytest.mark.gui

# Add current directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


# Enhanced mock setup for edge cases
class MockNumpyArrayEdgeCase:
    """Enhanced mock numpy array for edge case testing"""

    def __init__(self, data):
        self.data = data if isinstance(data, list) else [data]
        self.shape = (len(self.data),)

    def __len__(self):
        return len(self.data)

    def __getitem__(self, key):
        if isinstance(key, slice):
            return MockNumpyArrayEdgeCase(self.data[key])
        return self.data[key]

    def __iter__(self):
        return iter(self.data)

    def copy(self):
        return MockNumpyArrayEdgeCase(self.data[:])

    def max(self):
        return max(self.data) if self.data else 0

    def min(self):
        return min(self.data) if self.data else 0


class MockNumpyEdgeCase:
    """Enhanced mock numpy for edge case testing"""

    array = MockNumpyArrayEdgeCase
    ndarray = MockNumpyArrayEdgeCase  # Add ndarray attribute for type hints

    @staticmethod
    def linspace(start, stop, num):
        if num <= 0:
            return MockNumpyArrayEdgeCase([])
        return MockNumpyArrayEdgeCase([start + i * (stop - start) / (num - 1) for i in range(num)])

    @staticmethod
    def zeros_like(arr):
        return MockNumpyArrayEdgeCase([0] * len(arr))

    @staticmethod
    def full_like(arr, value):
        return MockNumpyArrayEdgeCase([value] * len(arr))

    @staticmethod
    def allclose(arr1, arr2, rtol=1e-5, atol=1e-8):
        """Mock allclose for testing"""
        if len(arr1) != len(arr2):
            return False
        return all(abs(a - b) <= atol + rtol * abs(b) for a, b in zip(arr1, arr2))

    @staticmethod
    def pad(arr, pad_width):
        return MockNumpyArrayEdgeCase(list(arr) + [0] * pad_width[1])

    @staticmethod
    def maximum(arr1, arr2):
        if hasattr(arr2, "__iter__"):
            return MockNumpyArrayEdgeCase([max(a, b) for a, b in zip(arr1, arr2)])
        else:
            return MockNumpyArrayEdgeCase([max(x, arr2) for x in arr1])

    @staticmethod
    def abs(arr):
        return MockNumpyArrayEdgeCase([abs(x) for x in arr])

    @staticmethod
    def max(arr):
        return max(arr) if arr else 0

    @staticmethod
    def sign(arr):
        return MockNumpyArrayEdgeCase([1 if x > 0 else -1 if x < 0 else 0 for x in arr])

    @staticmethod
    def power(arr, exp):
        return MockNumpyArrayEdgeCase([pow(x, exp) for x in arr])

    @staticmethod
    def log10(arr):
        import math

        return MockNumpyArrayEdgeCase([math.log10(x) if x > 0 else -10 for x in arr])

    @staticmethod
    def logspace(start, stop, num):
        import math

        if num <= 0:
            return MockNumpyArrayEdgeCase([])
        return MockNumpyArrayEdgeCase([pow(10, start + i * (stop - start) / (num - 1)) for i in range(num)])

    @staticmethod
    def interp(x_new, x_old, y_old):
        return MockNumpyArrayEdgeCase([0.5] * len(x_new))

    class fft:
        @staticmethod
        def fft(arr):
            return MockNumpyArrayEdgeCase([complex(x, 0) for x in arr])

        @staticmethod
        def fftfreq(n, d):
            return MockNumpyArrayEdgeCase([i / (n * d) for i in range(n)])


# Mock complex dependencies for edge cases
mock_ctk_edge = Mock()
mock_ctk_edge.CTkFrame = Mock
mock_ctk_edge.CTkTabview = Mock
mock_ctk_edge.CTkButton = Mock
mock_ctk_edge.CTkLabel = Mock
mock_ctk_edge.CTkImage = Mock
mock_ctk_edge.CTkFont = Mock
mock_ctk_edge.BooleanVar = Mock

mock_matplotlib_edge = Mock()
mock_figure_edge = Mock()
mock_canvas_edge = Mock()
mock_animation_edge = Mock()
mock_scipy_edge = Mock()
mock_signal_edge = Mock()
mock_signal_edge.savgol_filter = Mock(return_value=MockNumpyArrayEdgeCase([0.5, 0.5, 0.5]))
mock_fft_edge = Mock()
mock_fft_edge.fftfreq = MockNumpyEdgeCase.fft.fftfreq

# Mock logger for edge cases
mock_logger_edge = Mock()


# Mock PIL for edge cases
class MockPILImageEdgeCase:
    @staticmethod
    def open(path):
        if "nonexistent" in path:
            raise FileNotFoundError("File not found")
        return Mock()


# Set up all mocks in sys.modules for edge case testing
with patch.dict(
    sys.modules,
    {
        "customtkinter": mock_ctk_edge,
        "tkinter": Mock(BooleanVar=Mock),
        "numpy": MockNumpyEdgeCase,
        "matplotlib": mock_matplotlib_edge,
        "matplotlib.figure": Mock(Figure=mock_figure_edge),
        "matplotlib.backends.backend_tkagg": Mock(FigureCanvasTkAgg=mock_canvas_edge),
        "matplotlib.animation": mock_animation_edge,
        "scipy": mock_scipy_edge,
        "scipy.signal": mock_signal_edge,
        "scipy.fft": mock_fft_edge,
        "audio_player_enhanced": Mock(),
        "config_and_logger": Mock(logger=mock_logger_edge),
        "PIL": Mock(Image=MockPILImageEdgeCase),
        "PIL.Image": MockPILImageEdgeCase,
    },
):
    # Import the module under test
    import audio_visualization
    from audio_visualization import AudioVisualizationWidget, SpectrumAnalyzer, WaveformVisualizer


class MockPlaybackPositionEdgeCase:
    """Mock playback position for edge case testing"""

    def __init__(self, current_time=0.0, total_time=100.0, percentage=0.0):
        self.current_time = current_time
        self.total_time = total_time
        self.percentage = percentage


class TestWaveformVisualizerEdgeCases(unittest.TestCase):
    """Edge cases for WaveformVisualizer"""

    def test_update_position_with_error_in_zoom_logic(self):
        """Test update_position with error in zoom logic (edge case for lines 296-299)"""
        mock_parent = Mock()

        with patch("audio_visualization.Figure") as mock_fig_class, patch(
            "audio_visualization.FigureCanvasTkAgg"
        ) as mock_canvas_class, patch.object(WaveformVisualizer, "_setup_styling"), patch.object(
            WaveformVisualizer, "_initialize_plot"
        ):
            mock_fig = Mock()
            mock_ax = Mock()
            mock_fig.add_subplot.return_value = mock_ax
            mock_fig_class.return_value = mock_fig
            mock_canvas_class.return_value = Mock()

            visualizer = Mock(spec=WaveformVisualizer)
            visualizer.update_position = WaveformVisualizer.update_position.__get__(visualizer)
            visualizer.waveform_data = MockNumpyArrayEdgeCase([0.1, 0.2, 0.3])
            visualizer.zoom_level = 2.0
            visualizer.total_duration = 0.0  # Edge case: zero duration

            position = MockPlaybackPositionEdgeCase(current_time=5.0)

            # Test with zero duration - should not crash
            visualizer.update_position(position)

            self.assertEqual(visualizer.current_position, 5.0)

    def test_load_audio_with_zero_length_waveform(self):
        """Test load_audio with zero-length waveform data"""
        mock_parent = Mock()

        with patch("audio_visualization.AudioProcessor.extract_waveform_data") as mock_extract, patch(
            "audio_visualization.Figure"
        ) as mock_fig_class, patch("audio_visualization.FigureCanvasTkAgg") as mock_canvas_class, patch.object(
            WaveformVisualizer, "_setup_styling"
        ), patch.object(
            WaveformVisualizer, "_initialize_plot"
        ):
            # Return empty waveform data
            mock_extract.return_value = (MockNumpyArrayEdgeCase([]), 44100)

            mock_fig = Mock()
            mock_ax = Mock()
            mock_fig.add_subplot.return_value = mock_ax
            mock_fig_class.return_value = mock_fig
            mock_canvas_class.return_value = Mock()

            visualizer = Mock(spec=WaveformVisualizer)
            visualizer.load_audio = WaveformVisualizer.load_audio.__get__(visualizer)

            # This should return False and trigger line 156
            result = visualizer.load_audio("/test/empty.wav")

            self.assertFalse(result)


class TestSpectrumAnalyzerEdgeCases(unittest.TestCase):
    """Edge cases for SpectrumAnalyzer"""

    def test_start_analysis_with_empty_audio_data(self):
        """Test start_analysis with empty audio data (lines 451-453)"""
        mock_parent = Mock()

        with patch("audio_visualization.Figure") as mock_fig_class, patch(
            "audio_visualization.FigureCanvasTkAgg"
        ) as mock_canvas_class, patch.object(SpectrumAnalyzer, "_setup_styling"), patch.object(
            SpectrumAnalyzer, "_initialize_plot"
        ):
            mock_fig = Mock()
            mock_ax = Mock()
            mock_fig.add_subplot.return_value = mock_ax
            mock_fig_class.return_value = mock_fig
            mock_canvas_class.return_value = Mock()

            analyzer = Mock(spec=SpectrumAnalyzer)
            analyzer.start_analysis = SpectrumAnalyzer.start_analysis.__get__(analyzer)

            # Test with empty audio data
            empty_data = MockNumpyArrayEdgeCase([])
            analyzer.start_analysis(empty_data, 44100)

            # Should handle empty data gracefully

    def test_update_spectrum_insufficient_data_path(self):
        """Test _update_spectrum with insufficient data (lines 529-533)"""
        mock_parent = Mock()

        with patch("audio_visualization.Figure") as mock_fig_class, patch(
            "audio_visualization.FigureCanvasTkAgg"
        ) as mock_canvas_class, patch.object(SpectrumAnalyzer, "_setup_styling"), patch.object(
            SpectrumAnalyzer, "_initialize_plot"
        ):
            mock_fig = Mock()
            mock_ax = Mock()
            mock_fig.add_subplot.return_value = mock_ax
            mock_fig_class.return_value = mock_fig
            mock_canvas_class.return_value = Mock()

            analyzer = Mock(spec=SpectrumAnalyzer)
            analyzer._update_spectrum = SpectrumAnalyzer._update_spectrum.__get__(analyzer)
            analyzer.is_running = True
            analyzer.audio_data = MockNumpyArrayEdgeCase([0.1, 0.2])  # Very short data
            analyzer.sample_rate = 44100
            analyzer.current_position = 1.0
            analyzer.total_duration = 2.0
            analyzer.fft_size = 1024
            analyzer.spectrum_line = Mock()

            # This should trigger the insufficient data path (lines 529-533)
            result = analyzer._update_spectrum(0)

            # Should handle insufficient data gracefully

    def test_update_spectrum_canvas_draw_error(self):
        """Test _update_spectrum with canvas draw error (lines 582-587)"""
        mock_parent = Mock()

        with patch("audio_visualization.Figure") as mock_fig_class, patch(
            "audio_visualization.FigureCanvasTkAgg"
        ) as mock_canvas_class, patch.object(SpectrumAnalyzer, "_setup_styling"), patch.object(
            SpectrumAnalyzer, "_initialize_plot"
        ):
            mock_fig = Mock()
            mock_ax = Mock()
            mock_fig.add_subplot.return_value = mock_ax
            mock_fig_class.return_value = mock_fig

            mock_canvas_instance = Mock()
            mock_canvas_instance.draw_idle.side_effect = Exception("Canvas draw error")
            mock_canvas_class.return_value = mock_canvas_instance

            analyzer = Mock(spec=SpectrumAnalyzer)
            analyzer._update_spectrum = SpectrumAnalyzer._update_spectrum.__get__(analyzer)
            analyzer.canvas = mock_canvas_instance
            analyzer.is_running = True
            analyzer.audio_data = MockNumpyArrayEdgeCase([0.1, 0.2, 0.3] * 1000)
            analyzer.sample_rate = 44100
            analyzer.current_position = 1.0
            analyzer.total_duration = 10.0
            analyzer.fft_size = 1024
            analyzer.spectrum_line = Mock()

            # This should trigger canvas draw error handling (lines 582-587)
            result = analyzer._update_spectrum(0)

            # Should handle draw error gracefully


class TestAudioVisualizationWidgetEdgeCases(unittest.TestCase):
    """Edge cases for AudioVisualizationWidget"""

    def test_load_theme_icons_with_pil_import_error(self):
        """Test _load_theme_icons when PIL import fails"""
        mock_parent = Mock()

        with patch.object(AudioVisualizationWidget, "_create_speed_controls"), patch.object(
            AudioVisualizationWidget, "_update_tab_state"
        ), patch("builtins.__import__", side_effect=ImportError("PIL not available")):
            widget = Mock(spec=AudioVisualizationWidget)
            widget._load_theme_icons = AudioVisualizationWidget._load_theme_icons.__get__(widget)

            # This should trigger import error handling
            widget._load_theme_icons()

            # Icons should be None after import error
            self.assertIsNone(widget.moon_icon)
            self.assertIsNone(widget.sun_icon)

    def test_get_main_window_with_complex_hierarchy(self):
        """Test _get_main_window with complex widget hierarchy"""
        # Create a mock widget instance without calling __init__
        widget = Mock(spec=AudioVisualizationWidget)
        widget._get_main_window = AudioVisualizationWidget._get_main_window.__get__(widget)

        # Create a hierarchy: widget -> parent1 -> parent2 -> parent3 (with audio_player)
        parent1 = Mock()
        parent2 = Mock()
        parent3 = Mock()
        parent3.audio_player = Mock()  # This should be found

        widget.master = parent1
        parent1.master = parent2
        parent2.master = parent3
        parent3.master = None

        # None of the intermediate parents have audio_player
        if hasattr(parent1, "audio_player"):
            del parent1.audio_player
        if hasattr(parent2, "audio_player"):
            del parent2.audio_player

        result = widget._get_main_window()

        # Should find parent3 which has audio_player
        self.assertEqual(result, parent3)

    def test_on_tab_changed_with_audio_processor_error(self):
        """Test _on_tab_changed when AudioProcessor raises error"""
        mock_parent = Mock()

        with patch.object(AudioVisualizationWidget, "_load_theme_icons"), patch.object(
            AudioVisualizationWidget, "_create_speed_controls"
        ), patch.object(AudioVisualizationWidget, "_update_tab_state"):
            widget = Mock(spec=AudioVisualizationWidget)
            widget._on_tab_changed = AudioVisualizationWidget._on_tab_changed.__get__(widget)
            widget.notebook = Mock()
            widget.notebook.get.return_value = "Spectrum"

            # Mock main window with audio player
            mock_main_window = Mock()
            mock_audio_player = Mock()
            mock_track = Mock()
            mock_track.filepath = "/test/file.wav"
            mock_audio_player.get_current_track.return_value = mock_track
            mock_main_window.audio_player = mock_audio_player

            with patch.object(widget, "_get_main_window", return_value=mock_main_window), patch(
                "audio_visualization.AudioProcessor.extract_waveform_data",
                side_effect=Exception("Audio processor error"),
            ):
                # This should trigger the exception handling in lines 898-899
                widget._on_tab_changed()

                # Should handle the AudioProcessor error gracefully

    def test_update_speed_display_without_speed_label(self):
        """Test _update_speed_display when speed_label doesn't exist"""
        mock_parent = Mock()

        with patch.object(AudioVisualizationWidget, "_load_theme_icons"), patch.object(
            AudioVisualizationWidget, "_create_speed_controls"
        ), patch.object(AudioVisualizationWidget, "_update_tab_state"):
            widget = Mock(spec=AudioVisualizationWidget)
            widget._update_speed_display = AudioVisualizationWidget._update_speed_display.__get__(widget)
            widget.current_speed = 1.5

            # Don't set speed_label attribute to test hasattr check
            if hasattr(widget, "speed_label"):
                delattr(widget, "speed_label")

            # This should handle missing speed_label gracefully
            widget._update_speed_display()

            # Should not raise exception

    def test_toggle_theme_with_waveform_visualizer_error(self):
        """Test _toggle_theme when waveform_visualizer methods raise errors"""
        mock_parent = Mock()

        with patch.object(AudioVisualizationWidget, "_load_theme_icons"), patch.object(
            AudioVisualizationWidget, "_create_speed_controls"
        ), patch.object(AudioVisualizationWidget, "_update_tab_state"):
            widget = Mock(spec=AudioVisualizationWidget)
            widget._toggle_theme = AudioVisualizationWidget._toggle_theme.__get__(widget)
            widget.is_dark_theme = True
            widget.theme_toggle = Mock()
            widget.moon_icon = Mock()
            widget.sun_icon = Mock()

            # Mock visualizers with error-raising methods
            widget.waveform_visualizer = Mock()
            widget.waveform_visualizer._apply_theme_colors.side_effect = Exception("Theme error")
            widget.waveform_visualizer._update_waveform_display.side_effect = Exception("Update error")

            widget.spectrum_analyzer = Mock()
            widget.spectrum_analyzer._initialize_plot.side_effect = Exception("Init error")

            # This should handle visualizer errors gracefully
            widget._toggle_theme()

            # Should still toggle theme state despite errors
            self.assertFalse(widget.is_dark_theme)


class TestMiscellaneousEdgeCases(unittest.TestCase):
    """Miscellaneous edge cases and boundary conditions"""

    def test_waveform_visualizer_clear_with_missing_attributes(self):
        """Test WaveformVisualizer.clear when some attributes are missing"""
        mock_parent = Mock()

        with patch("audio_visualization.Figure") as mock_fig_class, patch(
            "audio_visualization.FigureCanvasTkAgg"
        ) as mock_canvas_class, patch.object(WaveformVisualizer, "_setup_styling"), patch.object(
            WaveformVisualizer, "_initialize_plot"
        ) as mock_init, patch.object(
            WaveformVisualizer, "_update_zoom_display"
        ):
            mock_fig = Mock()
            mock_ax = Mock()
            mock_fig.add_subplot.return_value = mock_ax
            mock_fig_class.return_value = mock_fig
            mock_canvas_class.return_value = Mock()

            visualizer = Mock(spec=WaveformVisualizer)
            visualizer.clear = WaveformVisualizer.clear.__get__(visualizer)
            visualizer._initialize_plot = mock_init
            visualizer._update_zoom_display = Mock()

            # Initialize attributes that clear() will modify
            visualizer.waveform_data = "some_data"
            visualizer.sample_rate = 44100
            visualizer.current_position = 10.0
            visualizer.total_duration = 100.0
            visualizer.zoom_level = 2.0
            visualizer.zoom_center = 0.7

            # Remove some attributes to test robustness
            if hasattr(visualizer, "zoom_label"):
                delattr(visualizer, "zoom_label")

            # Should still clear successfully
            visualizer.clear()

            self.assertIsNone(visualizer.waveform_data)
            mock_init.assert_called()

    def test_spectrum_analyzer_stop_analysis_no_animation(self):
        """Test SpectrumAnalyzer.stop_analysis when animation is None"""
        mock_parent = Mock()

        with patch("audio_visualization.Figure") as mock_fig_class, patch(
            "audio_visualization.FigureCanvasTkAgg"
        ) as mock_canvas_class, patch.object(SpectrumAnalyzer, "_setup_styling"), patch.object(
            SpectrumAnalyzer, "_initialize_plot"
        ):
            mock_fig = Mock()
            mock_ax = Mock()
            mock_fig.add_subplot.return_value = mock_ax
            mock_fig_class.return_value = mock_fig
            mock_canvas_class.return_value = Mock()

            analyzer = Mock(spec=SpectrumAnalyzer)
            analyzer.stop_analysis = SpectrumAnalyzer.stop_analysis.__get__(analyzer)
            analyzer.is_running = True
            analyzer.animation = None  # No animation to stop

            # Should handle None animation gracefully
            analyzer.stop_analysis()

            self.assertFalse(analyzer.is_running)

    def test_audio_visualization_widget_set_audio_player_none(self):
        """Test AudioVisualizationWidget.set_audio_player with None"""
        mock_parent = Mock()

        with patch.object(AudioVisualizationWidget, "_load_theme_icons"), patch.object(
            AudioVisualizationWidget, "_create_speed_controls"
        ), patch.object(AudioVisualizationWidget, "_update_tab_state"):
            widget = Mock(spec=AudioVisualizationWidget)
            widget.set_audio_player = AudioVisualizationWidget.set_audio_player.__get__(widget)

            # Test setting audio_player to None
            widget.set_audio_player(None)

            self.assertIsNone(widget.audio_player)


if __name__ == "__main__":
    unittest.main()
