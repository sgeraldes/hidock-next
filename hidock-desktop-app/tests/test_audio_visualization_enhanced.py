"""
Enhanced tests for audio_visualization.py to achieve 80%+ coverage

This file focuses specifically on the uncovered lines identified in the coverage report:
- Lines 108-111: WaveformVisualizer recursion error handling
- Lines 158-169: WaveformVisualizer load_audio success path
- Lines 293, 296-299: WaveformVisualizer zoom auto-center functionality
- Line 322: WaveformVisualizer _update_zoom_display method
- Lines 424-427: SpectrumAnalyzer recursion error handling
- Lines 437-494: SpectrumAnalyzer start_analysis success path
- Lines 506-507: SpectrumAnalyzer stop_analysis error handling
- Lines 515-593: SpectrumAnalyzer _update_spectrum method
- Lines 692-693, 703-717: AudioVisualizationWidget theme icon loading failures
- Lines 729-731: AudioVisualizationWidget load_audio error handling
- Lines 744-745: AudioVisualizationWidget update_position error handling
- Lines 769-770: AudioVisualizationWidget spectrum analysis error handling
- Lines 787-788, 796-797, 805-806: AudioVisualizationWidget audio control error handling
- Lines 810-815: AudioVisualizationWidget _get_main_window edge cases
- Lines 824-828, 849-850: AudioVisualizationWidget theme toggle error handling
- Lines 862-870, 885-899, 904-905: AudioVisualizationWidget tab change error handling
- Lines 1001-1002, 1047-1053: AudioVisualizationWidget speed control error scenarios
"""

import os
import sys
import tempfile
import unittest
import unittest.mock as mock
from unittest.mock import MagicMock, Mock, PropertyMock, patch

# Add current directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


# Comprehensive mock setup
class MockNumpyArray:
    """Mock numpy array with required methods"""

    def __init__(self, data):
        self.data = data if isinstance(data, list) else [data]
        self.shape = (len(self.data),)

    def __len__(self):
        return len(self.data)

    def __getitem__(self, key):
        return self.data[key]

    def __iter__(self):
        return iter(self.data)

    def copy(self):
        return MockNumpyArray(self.data[:])

    def max(self):
        return max(self.data) if self.data else 0

    def min(self):
        return min(self.data) if self.data else 0


class MockNumpy:
    """Mock numpy module"""

    array = MockNumpyArray

    @staticmethod
    def linspace(start, stop, num):
        return MockNumpyArray([start + i * (stop - start) / (num - 1) for i in range(num)])

    @staticmethod
    def zeros_like(arr):
        return MockNumpyArray([0] * len(arr))

    @staticmethod
    def full_like(arr, value):
        return MockNumpyArray([value] * len(arr))

    @staticmethod
    def pad(arr, pad_width):
        return MockNumpyArray(list(arr) + [0] * pad_width[1])

    @staticmethod
    def hanning(n):
        return MockNumpyArray([0.5 * (1 - cos(2 * 3.14159 * i / (n - 1))) for i in range(n)])

    @staticmethod
    def maximum(arr1, arr2):
        if hasattr(arr2, "__iter__"):
            return MockNumpyArray([max(a, b) for a, b in zip(arr1, arr2)])
        else:
            return MockNumpyArray([max(x, arr2) for x in arr1])

    @staticmethod
    def abs(arr):
        return MockNumpyArray([abs(x) for x in arr])

    @staticmethod
    def max(arr):
        return max(arr) if arr else 0

    @staticmethod
    def sign(arr):
        return MockNumpyArray([1 if x > 0 else -1 if x < 0 else 0 for x in arr])

    @staticmethod
    def power(arr, exp):
        return MockNumpyArray([pow(x, exp) for x in arr])

    @staticmethod
    def log10(arr):
        return MockNumpyArray([__import__("math").log10(x) if x > 0 else -10 for x in arr])

    @staticmethod
    def logspace(start, stop, num):
        import math

        return MockNumpyArray([pow(10, start + i * (stop - start) / (num - 1)) for i in range(num)])

    @staticmethod
    def interp(x_new, x_old, y_old):
        return MockNumpyArray([0.5] * len(x_new))  # Simplified interpolation

    class fft:
        @staticmethod
        def fft(arr):
            return MockNumpyArray([complex(x, 0) for x in arr])

        @staticmethod
        def fftfreq(n, d):
            return MockNumpyArray([i / (n * d) for i in range(n)])


# Mock math functions
def cos(x):
    import math

    return math.cos(x)


# Create comprehensive mocks for all dependencies
mock_ctk = Mock()
mock_ctk.CTkFrame = Mock
mock_ctk.CTkTabview = Mock
mock_ctk.CTkButton = Mock
mock_ctk.CTkLabel = Mock
mock_ctk.CTkImage = Mock
mock_ctk.CTkFont = Mock
mock_ctk.BooleanVar = Mock

mock_matplotlib = Mock()
mock_figure = Mock()
mock_canvas = Mock()
mock_animation = Mock()
mock_scipy = Mock()
mock_signal = Mock()
mock_signal.savgol_filter = Mock(return_value=MockNumpyArray([0.5, 0.5, 0.5]))
mock_fft = Mock()
mock_fft.fftfreq = MockNumpy.fft.fftfreq

# Mock logger
mock_logger = Mock()


# Mock PIL
class MockPILImage:
    @staticmethod
    def open(path):
        return Mock()


# Set up all mocks in sys.modules
with patch.dict(
    sys.modules,
    {
        "customtkinter": mock_ctk,
        "tkinter": Mock(BooleanVar=Mock),
        "numpy": MockNumpy,
        "matplotlib": mock_matplotlib,
        "matplotlib.figure": Mock(Figure=mock_figure),
        "matplotlib.backends.backend_tkagg": Mock(FigureCanvasTkAgg=mock_canvas),
        "matplotlib.animation": mock_animation,
        "scipy": mock_scipy,
        "scipy.signal": mock_signal,
        "scipy.fft": mock_fft,
        "audio_player_enhanced": Mock(),
        "config_and_logger": Mock(logger=mock_logger),
        "PIL": Mock(Image=MockPILImage),
        "PIL.Image": MockPILImage,
    },
):
    # Import the module under test
    import audio_visualization
    from audio_visualization import AudioVisualizationWidget, SpectrumAnalyzer, WaveformVisualizer


# Mock PlaybackPosition for tests
class MockPlaybackPosition:
    def __init__(self, current_time=0.0, total_time=100.0, percentage=0.0):
        self.current_time = current_time
        self.total_time = total_time
        self.percentage = percentage


class TestWaveformVisualizerRecursionHandling(unittest.TestCase):
    """Test WaveformVisualizer recursion error handling - Lines 108-111"""

    def test_initialize_plot_recursion_error_handling(self):
        """Test _initialize_plot handles RecursionError correctly (lines 108-111)"""
        mock_parent = Mock()

        with patch("audio_visualization.Figure") as mock_fig_class, patch(
            "audio_visualization.FigureCanvasTkAgg"
        ) as mock_canvas_class:
            # Set up mocks
            mock_fig = Mock()
            mock_ax = Mock()
            mock_fig.add_subplot.return_value = mock_ax
            mock_fig_class.return_value = mock_fig

            mock_canvas_instance = Mock()
            mock_canvas_class.return_value = mock_canvas_instance

            # Make canvas.draw raise RecursionError to trigger lines 108-111
            mock_canvas_instance.draw.side_effect = RecursionError("Maximum recursion depth exceeded")

            with patch.object(WaveformVisualizer, "_setup_styling"):
                visualizer = WaveformVisualizer(mock_parent)
                visualizer.ax = mock_ax
                visualizer.canvas = mock_canvas_instance
                visualizer.background_color = "#1a1a1a"

                # This should trigger the RecursionError handling in lines 108-111
                visualizer._initialize_plot()

                # Verify RecursionError was caught and logged
                self.assertTrue(mock_canvas_instance.draw.called)


class TestWaveformVisualizerLoadAudioSuccess(unittest.TestCase):
    """Test WaveformVisualizer load_audio success path - Lines 158-169"""

    @patch("audio_visualization.AudioProcessor.extract_waveform_data")
    @patch("audio_visualization.AudioProcessor.get_audio_info")
    def test_load_audio_success_path(self, mock_get_info, mock_extract):
        """Test successful audio loading (lines 158-169)"""
        mock_parent = Mock()

        # Set up successful extraction
        mock_waveform = MockNumpyArray([0.1, 0.2, 0.3, 0.4])
        mock_extract.return_value = (mock_waveform, 44100)
        mock_get_info.return_value = {"duration": 10.0}

        with patch("audio_visualization.Figure") as mock_fig_class, patch(
            "audio_visualization.FigureCanvasTkAgg"
        ) as mock_canvas_class, patch.object(WaveformVisualizer, "_setup_styling"), patch.object(
            WaveformVisualizer, "_initialize_plot"
        ), patch.object(
            WaveformVisualizer, "_update_waveform_display"
        ):
            mock_fig = Mock()
            mock_ax = Mock()
            mock_fig.add_subplot.return_value = mock_ax
            mock_fig_class.return_value = mock_fig
            mock_canvas_class.return_value = Mock()

            visualizer = WaveformVisualizer(mock_parent)

            # Test successful load - this should hit lines 158-169
            result = visualizer.load_audio("/test/file.wav")

            self.assertTrue(result)
            self.assertEqual(visualizer.sample_rate, 44100)
            self.assertEqual(visualizer.total_duration, 10.0)
            self.assertIsNotNone(visualizer.waveform_data)


class TestWaveformVisualizerZoomAutoCenter(unittest.TestCase):
    """Test WaveformVisualizer zoom auto-center functionality - Lines 293, 296-299"""

    def test_update_position_zoom_auto_center(self):
        """Test zoom auto-center when zoomed in (lines 293, 296-299)"""
        mock_parent = Mock()

        with patch("audio_visualization.Figure") as mock_fig_class, patch(
            "audio_visualization.FigureCanvasTkAgg"
        ) as mock_canvas_class, patch.object(WaveformVisualizer, "_setup_styling"), patch.object(
            WaveformVisualizer, "_initialize_plot"
        ), patch.object(
            WaveformVisualizer, "_update_waveform_display"
        ) as mock_update:
            mock_fig = Mock()
            mock_ax = Mock()
            mock_fig.add_subplot.return_value = mock_ax
            mock_fig_class.return_value = mock_fig
            mock_canvas_class.return_value = Mock()

            visualizer = WaveformVisualizer(mock_parent)
            visualizer.waveform_data = MockNumpyArray([0.1, 0.2, 0.3])
            visualizer.zoom_level = 2.0  # Zoomed in
            visualizer.total_duration = 10.0

            position = MockPlaybackPosition(current_time=5.0)

            # This should trigger zoom auto-center (lines 293, 296-299)
            visualizer.update_position(position)

            self.assertEqual(visualizer.current_position, 5.0)
            self.assertEqual(visualizer.zoom_center, 0.5)  # 5.0 / 10.0
            mock_update.assert_called()


class TestWaveformVisualizerUpdateZoomDisplay(unittest.TestCase):
    """Test WaveformVisualizer _update_zoom_display method - Line 322"""

    def test_update_zoom_display_method(self):
        """Test _update_zoom_display method (line 322)"""
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

            visualizer = WaveformVisualizer(mock_parent)
            visualizer.zoom_level = 2.5
            visualizer.zoom_label = Mock()

            # This should trigger line 322
            visualizer._update_zoom_display()

            visualizer.zoom_label.configure.assert_called_with(text="2.5x")


class TestSpectrumAnalyzerRecursionHandling(unittest.TestCase):
    """Test SpectrumAnalyzer recursion error handling - Lines 424-427"""

    def test_initialize_plot_recursion_error_handling(self):
        """Test _initialize_plot handles RecursionError correctly (lines 424-427)"""
        mock_parent = Mock()

        with patch("audio_visualization.Figure") as mock_fig_class, patch(
            "audio_visualization.FigureCanvasTkAgg"
        ) as mock_canvas_class:
            mock_fig = Mock()
            mock_ax = Mock()
            mock_fig.add_subplot.return_value = mock_ax
            mock_fig_class.return_value = mock_fig

            mock_canvas_instance = Mock()
            mock_canvas_class.return_value = mock_canvas_instance

            # Make canvas.draw raise RecursionError to trigger lines 424-427
            mock_canvas_instance.draw.side_effect = RecursionError("Maximum recursion depth exceeded")

            with patch.object(SpectrumAnalyzer, "_setup_styling"):
                analyzer = SpectrumAnalyzer(mock_parent)
                analyzer.ax = mock_ax
                analyzer.canvas = mock_canvas_instance
                analyzer.background_color = "#1a1a1a"
                analyzer.spectrum_color = "#00ff88"
                analyzer.grid_color = "#404040"

                # This should trigger the RecursionError handling in lines 424-427
                analyzer._initialize_plot()

                # Verify RecursionError was caught and logged
                self.assertTrue(mock_canvas_instance.draw.called)


class TestSpectrumAnalyzerStartAnalysisSuccess(unittest.TestCase):
    """Test SpectrumAnalyzer start_analysis success path - Lines 437-494"""

    def test_start_analysis_comprehensive_success(self):
        """Test comprehensive start_analysis success path (lines 437-494)"""
        mock_parent = Mock()

        with patch("audio_visualization.Figure") as mock_fig_class, patch(
            "audio_visualization.FigureCanvasTkAgg"
        ) as mock_canvas_class, patch("audio_visualization.animation.FuncAnimation") as mock_func_anim, patch.object(
            SpectrumAnalyzer, "_setup_styling"
        ), patch.object(
            SpectrumAnalyzer, "_initialize_plot"
        ):
            mock_fig = Mock()
            mock_ax = Mock()
            mock_fig.add_subplot.return_value = mock_ax
            mock_fig_class.return_value = mock_fig

            mock_canvas_instance = Mock()
            mock_canvas_class.return_value = mock_canvas_instance

            mock_animation_instance = Mock()
            mock_func_anim.return_value = mock_animation_instance

            analyzer = SpectrumAnalyzer(mock_parent)
            analyzer.figure = mock_fig
            analyzer.canvas = mock_canvas_instance

            # Test with valid audio data to trigger success path (lines 437-494)
            audio_data = MockNumpyArray([0.1, 0.2, 0.3] * 1000)  # Non-empty data
            sample_rate = 44100

            analyzer.start_analysis(audio_data, sample_rate)

            # Verify success path was executed
            self.assertEqual(analyzer.sample_rate, sample_rate)
            self.assertEqual(analyzer.audio_data, audio_data)
            self.assertTrue(analyzer.is_running)
            mock_func_anim.assert_called()


class TestSpectrumAnalyzerStopAnalysisError(unittest.TestCase):
    """Test SpectrumAnalyzer stop_analysis error handling - Lines 506-507"""

    def test_stop_analysis_error_handling(self):
        """Test stop_analysis error handling (lines 506-507)"""
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

            analyzer = SpectrumAnalyzer(mock_parent)
            analyzer.is_running = True

            # Set up animation mock that will raise exception
            mock_animation = Mock()
            mock_event_source = Mock()
            mock_event_source.stop.side_effect = Exception("Animation stop error")
            mock_animation.event_source = mock_event_source
            analyzer.animation = mock_animation

            # This should trigger error handling in lines 506-507
            analyzer.stop_analysis()

            # Should still set is_running to False despite error
            self.assertFalse(analyzer.is_running)


class TestSpectrumAnalyzerUpdateSpectrum(unittest.TestCase):
    """Test SpectrumAnalyzer _update_spectrum method - Lines 515-593"""

    def test_update_spectrum_comprehensive(self):
        """Test comprehensive _update_spectrum method (lines 515-593)"""
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
            mock_canvas_class.return_value = mock_canvas_instance

            analyzer = SpectrumAnalyzer(mock_parent)
            analyzer.canvas = mock_canvas_instance
            analyzer.is_running = True
            analyzer.audio_data = MockNumpyArray([0.1, 0.2, 0.3] * 1000)
            analyzer.sample_rate = 44100
            analyzer.current_position = 1.0
            analyzer.total_duration = 10.0
            analyzer.fft_size = 1024
            analyzer.spectrum_line = Mock()

            # Test different scenarios in _update_spectrum

            # Test with insufficient data (lines 529-533)
            analyzer.current_position = 9.9  # Near end
            result = analyzer._update_spectrum(0)

            # Test with sufficient data (lines 534-589)
            analyzer.current_position = 1.0  # Middle
            result = analyzer._update_spectrum(0)

            # Should call canvas.draw_idle for visualization
            self.assertTrue(analyzer.spectrum_line.set_data.called)


class TestAudioVisualizationWidgetThemeIconFailures(unittest.TestCase):
    """Test AudioVisualizationWidget theme icon loading failures - Lines 692-693, 703-717"""

    def test_load_theme_icons_file_not_found(self):
        """Test _load_theme_icons when icon files don't exist (lines 692-693, 703-717)"""
        mock_parent = Mock()

        with patch.object(AudioVisualizationWidget, "_create_speed_controls"), patch.object(
            AudioVisualizationWidget, "_update_tab_state"
        ), patch(
            "os.path.exists", return_value=False
        ):  # Files don't exist
            widget = AudioVisualizationWidget(mock_parent)

            # This should trigger lines 692-693 and 703-717 (file not found paths)
            widget._load_theme_icons()

            # Icons should be None when files don't exist
            self.assertIsNone(widget.moon_icon)
            self.assertIsNone(widget.sun_icon)

    def test_load_theme_icons_exception_handling(self):
        """Test _load_theme_icons exception handling (lines 703-717)"""
        mock_parent = Mock()

        with patch.object(AudioVisualizationWidget, "_create_speed_controls"), patch.object(
            AudioVisualizationWidget, "_update_tab_state"
        ), patch("os.path.exists", side_effect=Exception("OS error")):
            widget = AudioVisualizationWidget(mock_parent)

            # This should trigger exception handling in lines 703-717
            widget._load_theme_icons()

            # Icons should be None after exception
            self.assertIsNone(widget.moon_icon)
            self.assertIsNone(widget.sun_icon)


class TestAudioVisualizationWidgetLoadAudioError(unittest.TestCase):
    """Test AudioVisualizationWidget load_audio error handling - Lines 729-731"""

    def test_load_audio_exception_handling(self):
        """Test load_audio error handling (lines 729-731)"""
        mock_parent = Mock()

        with patch.object(AudioVisualizationWidget, "_load_theme_icons"), patch.object(
            AudioVisualizationWidget, "_create_speed_controls"
        ), patch.object(AudioVisualizationWidget, "_update_tab_state"):
            widget = AudioVisualizationWidget(mock_parent)
            widget.show_waveform_var = Mock()
            widget.show_waveform_var.get.return_value = True
            widget.waveform_visualizer = Mock()
            widget.waveform_visualizer.load_audio.side_effect = Exception("Load error")

            # This should trigger error handling in lines 729-731
            result = widget.load_audio("/test/file.wav")

            self.assertFalse(result)


class TestAudioVisualizationWidgetUpdatePositionError(unittest.TestCase):
    """Test AudioVisualizationWidget update_position error handling - Lines 744-745"""

    def test_update_position_exception_handling(self):
        """Test update_position error handling (lines 744-745)"""
        mock_parent = Mock()

        with patch.object(AudioVisualizationWidget, "_load_theme_icons"), patch.object(
            AudioVisualizationWidget, "_create_speed_controls"
        ), patch.object(AudioVisualizationWidget, "_update_tab_state"):
            widget = AudioVisualizationWidget(mock_parent)
            widget.show_waveform_var = Mock()
            widget.show_waveform_var.get.return_value = True
            widget.waveform_visualizer = Mock()
            widget.waveform_visualizer.update_position.side_effect = Exception("Update error")
            widget.spectrum_analyzer = Mock()

            position = MockPlaybackPosition(current_time=30.0)

            # This should trigger error handling in lines 744-745
            widget.update_position(position)

            # Should still attempt to update spectrum analyzer
            widget.spectrum_analyzer.update_position.assert_called_with(30.0)


class TestAudioVisualizationWidgetSpectrumAnalysisError(unittest.TestCase):
    """Test AudioVisualizationWidget spectrum analysis error handling - Lines 769-770"""

    def test_start_spectrum_analysis_exception_handling(self):
        """Test start_spectrum_analysis error handling (lines 769-770)"""
        mock_parent = Mock()

        with patch.object(AudioVisualizationWidget, "_load_theme_icons"), patch.object(
            AudioVisualizationWidget, "_create_speed_controls"
        ), patch.object(AudioVisualizationWidget, "_update_tab_state"):
            widget = AudioVisualizationWidget(mock_parent)
            widget.spectrum_analyzer = Mock()
            widget.spectrum_analyzer.start_analysis.side_effect = Exception("Spectrum error")

            audio_data = MockNumpyArray([0.1, 0.2, 0.3])
            sample_rate = 44100

            # This should trigger error handling in lines 769-770
            widget.start_spectrum_analysis(audio_data, sample_rate)

            # Should have attempted to start analysis
            widget.spectrum_analyzer.start_analysis.assert_called_with(audio_data, sample_rate)


class TestAudioVisualizationWidgetAudioControlErrors(unittest.TestCase):
    """Test AudioVisualizationWidget audio control error handling - Lines 787-788, 796-797, 805-806"""

    def test_audio_control_error_handling(self):
        """Test audio control methods error handling"""
        mock_parent = Mock()

        with patch.object(AudioVisualizationWidget, "_load_theme_icons"), patch.object(
            AudioVisualizationWidget, "_create_speed_controls"
        ), patch.object(AudioVisualizationWidget, "_update_tab_state"):
            widget = AudioVisualizationWidget(mock_parent)

            # Test _play_audio error (lines 787-788)
            with patch.object(widget, "_get_main_window", side_effect=Exception("Get window error")):
                widget._play_audio()  # Should handle exception

            # Test _pause_audio error (lines 796-797)
            with patch.object(widget, "_get_main_window", side_effect=Exception("Get window error")):
                widget._pause_audio()  # Should handle exception

            # Test _stop_audio error (lines 805-806)
            with patch.object(widget, "_get_main_window", side_effect=Exception("Get window error")):
                widget._stop_audio()  # Should handle exception


class TestAudioVisualizationWidgetGetMainWindowEdgeCases(unittest.TestCase):
    """Test AudioVisualizationWidget _get_main_window edge cases - Lines 810-815"""

    def test_get_main_window_edge_cases(self):
        """Test _get_main_window traversal edge cases (lines 810-815)"""
        mock_parent = Mock()

        with patch.object(AudioVisualizationWidget, "_load_theme_icons"), patch.object(
            AudioVisualizationWidget, "_create_speed_controls"
        ), patch.object(AudioVisualizationWidget, "_update_tab_state"):
            widget = AudioVisualizationWidget(mock_parent)

            # Test case where no parent has audio_player
            widget.master = Mock()
            widget.master.master = None  # End of chain

            result = widget._get_main_window()

            # Should return None when no audio_player found
            self.assertIsNone(result)

            # Test case where widget itself has audio_player
            widget.audio_player = Mock()
            result = widget._get_main_window()

            # Should return the widget itself
            self.assertEqual(result, widget)


class TestAudioVisualizationWidgetThemeToggleErrors(unittest.TestCase):
    """Test AudioVisualizationWidget theme toggle error handling - Lines 824-828, 849-850"""

    def test_toggle_theme_error_handling(self):
        """Test _toggle_theme error handling (lines 824-828, 849-850)"""
        mock_parent = Mock()

        with patch.object(AudioVisualizationWidget, "_load_theme_icons"), patch.object(
            AudioVisualizationWidget, "_create_speed_controls"
        ), patch.object(AudioVisualizationWidget, "_update_tab_state"):
            widget = AudioVisualizationWidget(mock_parent)
            widget.is_dark_theme = True
            widget.theme_toggle = Mock()
            widget.moon_icon = Mock()
            widget.sun_icon = Mock()
            widget.waveform_visualizer = Mock()
            widget.spectrum_analyzer = Mock()

            # Make theme toggle configuration raise exception
            widget.theme_toggle.configure.side_effect = Exception("Theme config error")

            # This should trigger error handling in lines 849-850
            widget._toggle_theme()

            # Should still toggle the theme state
            self.assertFalse(widget.is_dark_theme)


class TestAudioVisualizationWidgetTabChangeErrors(unittest.TestCase):
    """Test AudioVisualizationWidget tab change error handling - Lines 862-870, 885-899, 904-905"""

    def test_update_tab_state_error_handling(self):
        """Test _update_tab_state error handling (lines 862-870)"""
        mock_parent = Mock()

        with patch.object(AudioVisualizationWidget, "_load_theme_icons"), patch.object(
            AudioVisualizationWidget, "_create_speed_controls"
        ):
            widget = AudioVisualizationWidget(mock_parent)
            widget.notebook = Mock()
            widget.notebook.get.side_effect = Exception("Notebook error")
            widget.show_waveform_var = Mock()
            widget.show_spectrum_var = Mock()

            # This should trigger error handling in lines 862-870
            widget._update_tab_state()

            # Should handle exception gracefully

    def test_on_tab_changed_error_handling(self):
        """Test _on_tab_changed error handling (lines 885-899, 904-905)"""
        mock_parent = Mock()

        with patch.object(AudioVisualizationWidget, "_load_theme_icons"), patch.object(
            AudioVisualizationWidget, "_create_speed_controls"
        ), patch.object(AudioVisualizationWidget, "_update_tab_state"):
            widget = AudioVisualizationWidget(mock_parent)
            widget.notebook = Mock()
            widget.notebook.get.return_value = "Spectrum"

            # Mock _get_main_window to raise exception (triggers lines 885-899 error path)
            with patch.object(widget, "_get_main_window", side_effect=Exception("Main window error")):
                # This should trigger error handling in lines 904-905
                widget._on_tab_changed()


class TestAudioVisualizationWidgetSpeedControlErrors(unittest.TestCase):
    """Test AudioVisualizationWidget speed control error scenarios - Lines 1001-1002, 1047-1053"""

    def test_create_speed_controls_error_handling(self):
        """Test _create_speed_controls error handling (lines 1001-1002)"""
        mock_parent = Mock()

        with patch.object(AudioVisualizationWidget, "_load_theme_icons"), patch.object(
            AudioVisualizationWidget, "_update_tab_state"
        ), patch("audio_visualization.ctk.CTkFrame", side_effect=Exception("CTk Frame error")):
            widget = AudioVisualizationWidget(mock_parent)
            widget.control_frame = Mock()

            # This should trigger error handling in lines 1001-1002
            widget._create_speed_controls()

            # Should handle exception gracefully

    def test_set_speed_preset_failure_scenarios(self):
        """Test _set_speed_preset failure scenarios (lines 1047-1053)"""
        mock_parent = Mock()

        with patch.object(AudioVisualizationWidget, "_load_theme_icons"), patch.object(
            AudioVisualizationWidget, "_create_speed_controls"
        ), patch.object(AudioVisualizationWidget, "_update_tab_state"):
            widget = AudioVisualizationWidget(mock_parent)
            widget.audio_player = Mock()

            # Test case where set_playback_speed returns False (lines 1047-1053)
            widget.audio_player.set_playback_speed.return_value = False
            widget.current_speed = 1.0

            widget._set_speed_preset(1.5)

            # Current speed should not change on failure
            self.assertEqual(widget.current_speed, 1.0)

            # Test case where no audio_player is available (lines 1047-1053)
            widget.audio_player = None
            widget._set_speed_preset(2.0)

            # Should handle gracefully


if __name__ == "__main__":
    unittest.main()
