# HiDock Next Desktop Application - Technical Architecture Plan

## Overview

This document outlines the technical architecture for implementing the comprehensive UX enhancements detailed in `UX_PLAN.md`, `AUDIO_PLAYBACK_UX.md`, and `ADVANCED_VISUALIZATIONS.md`. The plan focuses on maintainable, extensible code using best practices and appropriate open-source components.

## Current Architecture Analysis

### Strengths
- **Modular Design**: Clear separation of concerns with mixins (TreeViewMixin, DeviceActionsMixin, etc.)
- **Enhanced Audio Player**: `EnhancedAudioPlayer` with proper state management
- **Visualization Framework**: Existing `AudioVisualizationWidget` with matplotlib integration
- **Configuration Management**: Encrypted settings with proper persistence
- **Threading**: Background operations with proper GUI thread safety

### Areas for Improvement
- **Audio Player Integration**: Current toolbar buttons feel disconnected from content
- **Visualization Limitations**: Static waveform without interaction capabilities
- **Status System**: Limited workflow integration for transcription states
- **Component Coupling**: Some tight coupling between GUI components

## Technical Architecture Plan

### Phase 1: Audio Player Component Redesign (2-3 hours)

#### 1.1 New Audio Player Component Architecture

**Create New Component: `IntegratedAudioPlayer`**

```python
# audio_player_integrated.py
class IntegratedAudioPlayer(ctk.CTkFrame):
    """
    Integrated audio player component that replaces the current waveform area.
    Combines playback controls, visualization, and scrubbing in one cohesive unit.
    """

    def __init__(self, parent, audio_player_backend, **kwargs):
        super().__init__(parent, **kwargs)
        self.audio_player = audio_player_backend
        self.current_track = None
        self.visualization_mode = "loudness"  # Default mode

        self._create_control_bar()
        self._create_visualization_area()
        self._setup_callbacks()

    def _create_control_bar(self):
        """Create the top control bar with play/pause/stop, time, volume, speed"""
        # 40px height control bar as specified in UX_PLAN

    def _create_visualization_area(self):
        """Create the interactive visualization area with scrub bar"""
        # 80px height visualization as specified in UX_PLAN

    def set_visualization_mode(self, mode: str):
        """Switch between visualization modes (loudness, sentiment, speakers, etc.)"""
```

**Integration Strategy:**
- Replace `AudioVisualizationWidget` usage in `gui_main_window.py`
- Maintain backward compatibility during transition
- Use composition over inheritance for flexibility

#### 1.2 Visualization Engine Refactor

**Create Pluggable Visualization System:**

```python
# visualization_engine.py
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import List, Optional, Dict, Any

@dataclass
class VisualizationData:
    """Unified data structure for all visualization types"""
    timestamp: float
    duration: float
    loudness: float
    sentiment: Optional[Dict[str, Any]] = None
    speaker_id: Optional[str] = None
    confidence: float = 1.0
    topics: List[str] = None
    energy_level: str = "medium"
    metadata: Dict[str, Any] = None

class VisualizationRenderer(ABC):
    """Abstract base class for visualization renderers"""

    @abstractmethod
    def render(self, data: List[VisualizationData], canvas, **kwargs) -> None:
        """Render visualization data to the provided canvas"""
        pass

    @abstractmethod
    def handle_click(self, x: float, y: float) -> Optional[float]:
        """Handle click events and return timestamp if applicable"""
        pass

class LoudnessRenderer(VisualizationRenderer):
    """Renders loudness-based visualization with speech detection"""

    def render(self, data: List[VisualizationData], canvas, **kwargs):
        # Implementation for loudness bars with speech/silence detection
        pass

class SentimentRenderer(VisualizationRenderer):
    """Renders sentiment analysis visualization"""

    def render(self, data: List[VisualizationData], canvas, **kwargs):
        # Implementation for sentiment color coding
        pass
```

**Benefits:**
- **Extensible**: Easy to add new visualization types
- **Testable**: Each renderer can be unit tested independently
- **Maintainable**: Clear separation of concerns
- **Performant**: Optimized rendering for each visualization type

#### 1.3 Audio Processing Pipeline Enhancement

**Enhance Existing `AudioProcessor`:**

```python
# audio_processing_enhanced.py
class EnhancedAudioProcessor:
    """Enhanced audio processor with multiple analysis capabilities"""

    @staticmethod
    def extract_loudness_data(filepath: str, max_points: int = 800) -> List[VisualizationData]:
        """Extract loudness data with speech activity detection"""
        # Use librosa for audio analysis
        # Implement RMS energy calculation
        # Add voice activity detection

    @staticmethod
    def extract_sentiment_data(filepath: str, transcription_data: Dict) -> List[VisualizationData]:
        """Extract sentiment data from transcription results"""
        # Integrate with existing transcription module
        # Map sentiment to audio timestamps

    @staticmethod
    def detect_speakers(filepath: str) -> List[VisualizationData]:
        """Detect speaker changes using audio analysis"""
        # Implement speaker diarization using pyannote-audio or similar
        # Return speaker segments with confidence scores
```

**Open Source Dependencies:**
- **librosa**: Audio analysis (already in use)
- **pyannote-audio**: Speaker diarization (optional, for advanced features)
- **webrtcvad**: Voice activity detection (lightweight alternative)

### Phase 2: Enhanced Status System (4-6 hours)

#### 2.1 Transcription Status Management

**Create Centralized Status Manager:**

```python
# transcription_status_manager.py
from enum import Enum
from dataclasses import dataclass, field
from typing import Dict, Optional, Callable
import threading
import time

class TranscriptionStatus(Enum):
    NOT_STARTED = "not_started"
    QUEUED = "queued"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"

@dataclass
class TranscriptionJob:
    file_id: str
    status: TranscriptionStatus
    provider: str
    progress: float = 0.0
    start_time: Optional[float] = None
    completion_time: Optional[float] = None
    error_message: Optional[str] = None
    confidence_score: Optional[float] = None
    result_data: Optional[Dict] = None

class TranscriptionStatusManager:
    """Centralized manager for transcription job status"""

    def __init__(self):
        self._jobs: Dict[str, TranscriptionJob] = {}
        self._callbacks: List[Callable] = []
        self._lock = threading.Lock()

    def create_job(self, file_id: str, provider: str) -> TranscriptionJob:
        """Create a new transcription job"""
        with self._lock:
            job = TranscriptionJob(file_id=file_id, provider=provider, status=TranscriptionStatus.QUEUED)
            self._jobs[file_id] = job
            self._notify_callbacks(job)
            return job

    def update_progress(self, file_id: str, progress: float):
        """Update job progress"""
        with self._lock:
            if file_id in self._jobs:
                self._jobs[file_id].progress = progress
                self._notify_callbacks(self._jobs[file_id])

    def complete_job(self, file_id: str, result_data: Dict, confidence_score: float = None):
        """Mark job as completed"""
        with self._lock:
            if file_id in self._jobs:
                job = self._jobs[file_id]
                job.status = TranscriptionStatus.COMPLETED
                job.completion_time = time.time()
                job.result_data = result_data
                job.confidence_score = confidence_score
                self._notify_callbacks(job)

    def fail_job(self, file_id: str, error_message: str):
        """Mark job as failed"""
        with self._lock:
            if file_id in self._jobs:
                job = self._jobs[file_id]
                job.status = TranscriptionStatus.FAILED
                job.error_message = error_message
                job.completion_time = time.time()
                self._notify_callbacks(job)
```

#### 2.2 Enhanced TreeView Integration

**Extend Existing TreeViewMixin:**

```python
# gui_treeview_enhanced.py
class EnhancedTreeViewMixin(TreeViewMixin):
    """Enhanced TreeView with transcription status integration"""

    def __init__(self):
        super().__init__()
        self.transcription_manager = TranscriptionStatusManager()
        self.transcription_manager.add_callback(self._on_transcription_status_changed)

    def _on_transcription_status_changed(self, job: TranscriptionJob):
        """Handle transcription status changes and update TreeView"""
        self.after(0, self._update_file_transcription_status, job.file_id, job)

    def _update_file_transcription_status(self, file_id: str, job: TranscriptionJob):
        """Update file status in TreeView with transcription info"""
        # Update status column with transcription state
        # Add provider icons
        # Show progress indicators
        # Update colors based on status

    def _get_enhanced_status_text(self, file_detail: Dict, transcription_job: Optional[TranscriptionJob]) -> str:
        """Generate enhanced status text combining file and transcription status"""
        base_status = file_detail.get("gui_status", "Unknown")

        if not transcription_job:
            return base_status

        if transcription_job.status == TranscriptionStatus.PROCESSING:
            return f"Transcribing... ({transcription_job.progress:.0f}% - {transcription_job.provider})"
        elif transcription_job.status == TranscriptionStatus.COMPLETED:
            confidence_text = f" ({transcription_job.confidence_score:.0%})" if transcription_job.confidence_score else ""
            return f"Transcribed ({transcription_job.provider}){confidence_text}"
        elif transcription_job.status == TranscriptionStatus.FAILED:
            return f"Failed ({transcription_job.provider})"

        return base_status
```

#### 2.3 Provider Icon System

**Create Icon Management System:**

```python
# provider_icons.py
from typing import Dict, Optional
import os
from PIL import Image
import customtkinter as ctk

class ProviderIconManager:
    """Manages AI provider icons for status display"""

    PROVIDER_ICONS = {
        "gemini": "google-g.png",
        "openai": "openai.png",
        "anthropic": "claude.png",
        "ollama": "computer.png",
        "lmstudio": "computer.png",
        "failed": "warning-triangle.png"
    }

    def __init__(self, icon_base_path: str):
        self.icon_base_path = icon_base_path
        self.icons: Dict[str, ctk.CTkImage] = {}
        self._load_provider_icons()

    def _load_provider_icons(self):
        """Load all provider icons"""
        for provider, filename in self.PROVIDER_ICONS.items():
            icon_path = os.path.join(self.icon_base_path, "providers", "16", filename)
            if os.path.exists(icon_path):
                try:
                    image = Image.open(icon_path)
                    self.icons[provider] = ctk.CTkImage(
                        light_image=image,
                        dark_image=image,
                        size=(16, 16)
                    )
                except Exception as e:
                    logger.warning(f"Failed to load provider icon {filename}: {e}")

    def get_icon(self, provider: str) -> Optional[ctk.CTkImage]:
        """Get icon for provider"""
        return self.icons.get(provider.lower())
```

### Phase 3: Advanced Visualization System (3-4 hours)

#### 3.1 Visualization Mode Selector

**Create Mode Selector Component:**

```python
# visualization_mode_selector.py
class VisualizationModeSelector(ctk.CTkFrame):
    """Mode selector for different visualization types"""

    MODES = {
        "loudness": {"label": "Speech Activity", "icon": "🔊", "requires_transcription": False},
        "sentiment": {"label": "Sentiment", "icon": "😊", "requires_transcription": True},
        "speakers": {"label": "Speakers", "icon": "👥", "requires_transcription": True},
        "confidence": {"label": "Confidence", "icon": "🎯", "requires_transcription": True},
        "topics": {"label": "Topics", "icon": "🏷️", "requires_transcription": True},
        "energy": {"label": "Energy", "icon": "⚡", "requires_transcription": False},
        "qa": {"label": "Q&A", "icon": "❓", "requires_transcription": True},
        "actions": {"label": "Actions", "icon": "✅", "requires_transcription": True}
    }

    def __init__(self, parent, on_mode_changed: Callable[[str], None], **kwargs):
        super().__init__(parent, **kwargs)
        self.on_mode_changed = on_mode_changed
        self.current_mode = "loudness"
        self.has_transcription = False

        self._create_mode_buttons()

    def _create_mode_buttons(self):
        """Create mode selection buttons"""
        # Create primary mode buttons (always visible)
        primary_modes = ["loudness", "sentiment", "speakers", "confidence"]

        for mode in primary_modes:
            mode_info = self.MODES[mode]
            button = ctk.CTkButton(
                self,
                text=f"{mode_info['icon']} {mode_info['label']}",
                command=lambda m=mode: self._select_mode(m),
                width=100,
                height=28
            )
            button.pack(side="left", padx=2)

        # Create "More" dropdown for additional modes
        self._create_more_dropdown()

    def _select_mode(self, mode: str):
        """Select visualization mode"""
        mode_info = self.MODES[mode]

        # Check if transcription is required but not available
        if mode_info["requires_transcription"] and not self.has_transcription:
            # Show tooltip or disable button
            return

        self.current_mode = mode
        self.on_mode_changed(mode)
        self._update_button_states()

    def set_transcription_available(self, available: bool):
        """Update transcription availability and enable/disable modes"""
        self.has_transcription = available
        self._update_button_states()
```

#### 3.2 Advanced Visualization Renderers

**Implement Specific Renderers:**

```python
# visualization_renderers.py
class SentimentRenderer(VisualizationRenderer):
    """Renders sentiment analysis with dual-layer visualization"""

    SENTIMENT_COLORS = {
        "positive": "#4CAF50",
        "neutral": "#9E9E9E",
        "negative": "#F44336",
        "excited": "#FF9800",
        "calm": "#2196F3",
        "frustrated": "#9C27B0",
        "confident": "#00BCD4",
        "uncertain": "#795548"
    }

    def render(self, data: List[VisualizationData], canvas, **kwargs):
        """Render dual-layer sentiment visualization"""
        ax = canvas.ax
        ax.clear()

        # Top layer: Loudness bars (speech activity)
        loudness_bars = [d.loudness for d in data]
        time_points = [d.timestamp for d in data]

        ax.bar(time_points, loudness_bars, width=0.1, alpha=0.6, color="#4a9eff", label="Speech")

        # Bottom layer: Sentiment bars
        sentiment_bars = []
        sentiment_colors = []

        for d in data:
            if d.sentiment:
                emotion = d.sentiment.get("emotion", "neutral")
                intensity = d.sentiment.get("intensity", 0.5)
                confidence = d.sentiment.get("confidence", 1.0)

                bar_height = intensity * 40  # Max 40px as specified
                color = self.SENTIMENT_COLORS.get(emotion, "#9E9E9E")

                sentiment_bars.append(-bar_height)  # Negative for bottom layer
                sentiment_colors.append(color)
            else:
                sentiment_bars.append(0)
                sentiment_colors.append("#9E9E9E")

        # Create bottom bars with individual colors
        for i, (time, height, color) in enumerate(zip(time_points, sentiment_bars, sentiment_colors)):
            ax.bar(time, height, width=0.1, color=color, alpha=0.8)

        ax.set_xlim(0, max(time_points) if time_points else 1)
        ax.set_ylim(-40, max(loudness_bars) if loudness_bars else 1)
        ax.set_xlabel("Time (s)")
        ax.legend()

        canvas.draw()

    def handle_click(self, x: float, y: float) -> Optional[float]:
        """Handle click and return timestamp"""
        # Convert click coordinates to timestamp
        return x  # Simplified - actual implementation would handle coordinate conversion

class SpeakerRenderer(VisualizationRenderer):
    """Renders speaker identification visualization"""

    SPEAKER_COLORS = [
        "#4CAF50",  # Green - Speaker A
        "#2196F3",  # Blue - Speaker B
        "#FF9800",  # Orange - Speaker C
        "#9C27B0",  # Purple - Speaker D
        "#00BCD4",  # Cyan - Speaker E
        "#795548"   # Brown - Speaker F
    ]

    def render(self, data: List[VisualizationData], canvas, **kwargs):
        """Render speaker identification bars"""
        ax = canvas.ax
        ax.clear()

        # Group data by speaker
        speaker_segments = {}
        for d in data:
            speaker_id = d.speaker_id or "unknown"
            if speaker_id not in speaker_segments:
                speaker_segments[speaker_id] = []
            speaker_segments[speaker_id].append(d)

        # Assign colors to speakers
        speaker_colors = {}
        for i, speaker_id in enumerate(sorted(speaker_segments.keys())):
            speaker_colors[speaker_id] = self.SPEAKER_COLORS[i % len(self.SPEAKER_COLORS)]

        # Render speaker bars
        for speaker_id, segments in speaker_segments.items():
            times = [s.timestamp for s in segments]
            loudness = [s.loudness for s in segments]
            color = speaker_colors[speaker_id]

            ax.bar(times, loudness, width=0.1, color=color, alpha=0.8, label=f"Speaker {speaker_id}")

        # Add statistics
        total_time = max([d.timestamp for d in data]) if data else 1
        stats_text = []
        for speaker_id, segments in speaker_segments.items():
            speaker_time = len(segments) * (total_time / len(data)) if data else 0
            percentage = (speaker_time / total_time) * 100 if total_time > 0 else 0
            stats_text.append(f"Speaker {speaker_id}: {percentage:.0f}%")

        ax.text(0.02, 0.98, " | ".join(stats_text), transform=ax.transAxes,
                verticalalignment='top', fontsize=10, bbox=dict(boxstyle="round,pad=0.3",
                facecolor="white", alpha=0.8))

        ax.legend()
        canvas.draw()
```

### Phase 4: Integration and Polish (2-3 hours)

#### 4.1 Main Window Integration

**Update `gui_main_window.py`:**

```python
# gui_main_window.py (modifications)
class HiDockToolGUI(ctk.CTk, TreeViewMixin, DeviceActionsMixin, FileActionsMixin, AuxiliaryMixin, EventHandlersMixin):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # ... existing initialization ...

        # Replace audio visualization widget with integrated player
        self.integrated_audio_player = None
        self.transcription_status_manager = TranscriptionStatusManager()
        self.provider_icon_manager = ProviderIconManager(self.icon_base_path)

    def _create_audio_visualizer_panel(self, parent_frame):
        """Creates the integrated audio player panel (replaces old visualizer)"""
        self.audio_player_frame = ctk.CTkFrame(parent_frame)

        # Create integrated audio player component
        self.integrated_audio_player = IntegratedAudioPlayer(
            self.audio_player_frame,
            self.audio_player,
            height=120  # As specified in UX plan
        )

        # Setup callbacks
        self.integrated_audio_player.on_seek = self._on_audio_seek
        self.integrated_audio_player.on_visualization_mode_changed = self._on_visualization_mode_changed

    def _on_audio_seek(self, timestamp: float):
        """Handle seek requests from integrated player"""
        if self.audio_player.get_current_track():
            self.audio_player.seek(timestamp)

    def _on_visualization_mode_changed(self, mode: str):
        """Handle visualization mode changes"""
        # Update visualization based on selected mode
        # Load appropriate data for the mode
        self._update_visualization_for_mode(mode)
```

#### 4.2 Configuration and Settings Integration

**Extend Settings System:**

```python
# settings_window.py (additions)
class SettingsDialog(ctk.CTkToplevel):

    def _create_visualization_settings(self):
        """Create visualization settings section"""
        viz_frame = ctk.CTkFrame(self.settings_notebook.tab("Visualization"))
        viz_frame.pack(fill="both", expand=True, padx=10, pady=10)

        # Default visualization mode
        ctk.CTkLabel(viz_frame, text="Default Visualization Mode:").pack(anchor="w", pady=(0, 5))
        self.default_viz_mode_var = ctk.StringVar(value=self.parent.config.get("default_visualization_mode", "loudness"))
        viz_mode_combo = ctk.CTkComboBox(
            viz_frame,
            variable=self.default_viz_mode_var,
            values=list(VisualizationModeSelector.MODES.keys()),
            state="readonly"
        )
        viz_mode_combo.pack(anchor="w", pady=(0, 10))

        # Auto-show visualization
        self.auto_show_viz_var = ctk.BooleanVar(value=self.parent.config.get("auto_show_visualization", True))
        ctk.CTkCheckBox(
            viz_frame,
            text="Auto-show visualization when playing audio",
            variable=self.auto_show_viz_var
        ).pack(anchor="w", pady=(0, 10))

        # Visualization performance settings
        ctk.CTkLabel(viz_frame, text="Visualization Quality:").pack(anchor="w", pady=(0, 5))
        self.viz_quality_var = ctk.StringVar(value=self.parent.config.get("visualization_quality", "high"))
        quality_combo = ctk.CTkComboBox(
            viz_frame,
            variable=self.viz_quality_var,
            values=["low", "medium", "high"],
            state="readonly"
        )
        quality_combo.pack(anchor="w", pady=(0, 10))
```

## Implementation Strategy

### Development Approach

1. **Incremental Implementation**: Implement each phase independently to minimize risk
2. **Backward Compatibility**: Maintain existing functionality during transition
3. **Testing Strategy**: Unit tests for each component, integration tests for workflows
4. **Performance Monitoring**: Profile audio processing and visualization rendering

### Open Source Component Selection

#### Audio Processing
- **librosa**: Already in use, excellent for audio analysis
- **soundfile**: For audio I/O operations
- **webrtcvad**: Lightweight voice activity detection
- **pyannote-audio**: Advanced speaker diarization (optional)

#### Visualization
- **matplotlib**: Already in use, mature and flexible
- **numpy**: Essential for numerical operations
- **scipy**: Signal processing utilities

#### UI Components
- **CustomTkinter**: Already in use, modern styling
- **PIL/Pillow**: Image processing for icons
- **tkinter**: Base GUI framework

### Performance Considerations

#### Audio Processing Optimization
```python
# Implement caching for expensive operations
class AudioAnalysisCache:
    """Cache for audio analysis results"""

    def __init__(self, max_size: int = 100):
        self.cache = {}
        self.max_size = max_size

    def get_analysis(self, filepath: str, analysis_type: str) -> Optional[Any]:
        """Get cached analysis result"""
        cache_key = f"{filepath}:{analysis_type}:{os.path.getmtime(filepath)}"
        return self.cache.get(cache_key)

    def store_analysis(self, filepath: str, analysis_type: str, result: Any):
        """Store analysis result in cache"""
        if len(self.cache) >= self.max_size:
            # Remove oldest entry
            oldest_key = next(iter(self.cache))
            del self.cache[oldest_key]

        cache_key = f"{filepath}:{analysis_type}:{os.path.getmtime(filepath)}"
        self.cache[cache_key] = result
```

#### Visualization Performance
- **Data Downsampling**: Limit visualization points to ~800 for smooth rendering
- **Lazy Loading**: Load visualization data only when needed
- **Background Processing**: Process audio analysis in worker threads
- **Canvas Optimization**: Use matplotlib's blitting for smooth animations

### Error Handling and Resilience

#### Graceful Degradation
```python
class VisualizationFallbackManager:
    """Handles fallbacks when advanced visualizations fail"""

    def __init__(self):
        self.fallback_renderers = {
            "sentiment": "loudness",
            "speakers": "loudness",
            "topics": "loudness",
            "qa": "loudness",
            "actions": "loudness"
        }

    def get_fallback_renderer(self, failed_mode: str) -> str:
        """Get fallback renderer for failed mode"""
        return self.fallback_renderers.get(failed_mode, "loudness")

    def handle_visualization_error(self, mode: str, error: Exception) -> str:
        """Handle visualization errors and return fallback mode"""
        logger.warning(f"Visualization mode '{mode}' failed: {error}")
        fallback = self.get_fallback_renderer(mode)
        logger.info(f"Falling back to '{fallback}' visualization")
        return fallback
```

### Testing Strategy

#### Unit Tests
```python
# test_visualization_renderers.py
import unittest
from unittest.mock import Mock, patch
from visualization_renderers import LoudnessRenderer, SentimentRenderer

class TestVisualizationRenderers(unittest.TestCase):

    def setUp(self):
        self.mock_canvas = Mock()
        self.mock_canvas.ax = Mock()

    def test_loudness_renderer_basic(self):
        """Test basic loudness rendering"""
        renderer = LoudnessRenderer()
        data = [
            VisualizationData(timestamp=0.0, duration=0.1, loudness=0.5),
            VisualizationData(timestamp=0.1, duration=0.1, loudness=0.8),
        ]

        renderer.render(data, self.mock_canvas)

        # Verify canvas methods were called
        self.mock_canvas.ax.clear.assert_called_once()
        self.mock_canvas.draw.assert_called_once()

    def test_sentiment_renderer_with_data(self):
        """Test sentiment rendering with sentiment data"""
        renderer = SentimentRenderer()
        data = [
            VisualizationData(
                timestamp=0.0,
                duration=0.1,
                loudness=0.5,
                sentiment={"emotion": "positive", "intensity": 0.8, "confidence": 0.9}
            )
        ]

        renderer.render(data, self.mock_canvas)

        # Verify dual-layer rendering
        self.assertEqual(self.mock_canvas.ax.bar.call_count, 2)  # Loudness + sentiment bars
```

#### Integration Tests
```python
# test_integrated_audio_player.py
import unittest
from unittest.mock import Mock, patch
from audio_player_integrated import IntegratedAudioPlayer

class TestIntegratedAudioPlayer(unittest.TestCase):

    def setUp(self):
        self.mock_parent = Mock()
        self.mock_audio_backend = Mock()
        self.player = IntegratedAudioPlayer(self.mock_parent, self.mock_audio_backend)

    def test_play_pause_integration(self):
        """Test play/pause button integration"""
        # Simulate loading a track
        self.player.load_track("test.wav")

        # Test play button
        self.player._on_play_clicked()
        self.mock_audio_backend.play.assert_called_once()

        # Test pause button
        self.player._on_pause_clicked()
        self.mock_audio_backend.pause.assert_called_once()

    def test_seek_functionality(self):
        """Test seeking via visualization click"""
        self.player.load_track("test.wav")

        # Simulate click on visualization
        timestamp = self.player._handle_visualization_click(100, 50)  # x=100, y=50

        # Verify seek was called with correct timestamp
        self.assertIsNotNone(timestamp)
        self.mock_audio_backend.seek.assert_called_with(timestamp)
```

### Migration Strategy

#### Phase 1: Parallel Implementation
- Implement new components alongside existing ones
- Add feature flags to switch between old and new implementations
- Maintain full backward compatibility

#### Phase 2: Gradual Rollout
- Default to new implementation for new installations
- Provide option to revert to old implementation
- Monitor for issues and user feedback

#### Phase 3: Legacy Removal
- Remove old implementation after stability is confirmed
- Clean up unused code and dependencies
- Update documentation and examples

### Documentation and Maintenance

#### Code Documentation
- Comprehensive docstrings for all public methods
- Type hints for all function parameters and return values
- Architecture decision records (ADRs) for major design choices

#### User Documentation
- Updated user guide with new audio player features
- Visualization mode explanations with screenshots
- Troubleshooting guide for common issues

#### Maintenance Plan
- Regular dependency updates
- Performance monitoring and optimization
- User feedback integration process

## Conclusion

This architecture plan provides a comprehensive, maintainable solution for implementing the UX enhancements while preserving the existing codebase's strengths. The modular design allows for incremental implementation and easy testing, while the use of established open-source components ensures reliability and community support.

The plan prioritizes:
1. **User Experience**: Intuitive, integrated audio controls
2. **Maintainability**: Clean, modular architecture
3. **Extensibility**: Easy to add new visualization modes
4. **Performance**: Optimized for smooth real-time operation
5. **Reliability**: Comprehensive error handling and fallbacks

Implementation should proceed in the defined phases, with thorough testing at each stage to ensure a smooth transition from the current implementation to the enhanced system.