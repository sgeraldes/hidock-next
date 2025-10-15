# Advanced Audio Visualizations for HiDock Next

## Overview

Beyond basic loudness visualization, transcribed audio files can display rich analytical data that helps users understand content at a glance. These visualizations leverage AI analysis results to provide actionable insights.

## Sentiment Visualization

### Visual Design

```text
┌───────────────────────────────────────────────────────────────────┐
│ ▶️ ⏸️ ⏹️    00:12 / 02:45    🔊 ────●──── 1.0x [Sentiment View] │
├───────────────────────────────────────────────────────────────────┤
│ ████▓▓▓▓░░░░████▓▓░░░░░░████▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
│ ████████░░░░████████░░░░████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
│ ●───────────────────────────────────────────────────────────────  │
└───────────────────────────────────────────────────────────────────┘
```

### Implementation Concept

**Dual-Layer Visualization**:

- **Top Layer**: Loudness bars (speech activity)
- **Bottom Layer**: Sentiment bars (emotional tone)

**Color Coding**:

```python
SENTIMENT_COLORS = {
    "positive": "#4CAF50",      # Green
    "neutral": "#9E9E9E",       # Gray
    "negative": "#F44336",      # Red
    "excited": "#FF9800",       # Orange
    "calm": "#2196F3",          # Blue
    "frustrated": "#9C27B0",    # Purple
    "confident": "#00BCD4",     # Cyan
    "uncertain": "#795548"      # Brown
}
```

**Bar Height Logic**:

```python
def calculate_sentiment_bar(sentiment_data):
    """
    sentiment_data = {
        "emotion": "positive",
        "confidence": 0.85,
        "intensity": 0.7
    }
    """
    base_height = sentiment_data["intensity"] * 40  # Max 40px
    opacity = sentiment_data["confidence"]  # 0.0 to 1.0
    color = SENTIMENT_COLORS[sentiment_data["emotion"]]

    return {
        "height": base_height,
        "color": color,
        "opacity": opacity
    }
```

### Hover Interactions

**Tooltip Content**:

```
Timestamp: 01:23
Emotion: Positive (85% confidence)
Intensity: High
Transcript: "I'm really excited about this project..."
```

## Speaker Identification Visualization

### Visual Design

```text
┌───────────────────────────────────────────────────────────────────┐
│ ▶️ ⏸️ ⏹️    00:12 / 02:45    🔊 ────●──── 1.0x [Speaker View]   │
├───────────────────────────────────────────────────────────────────┤
│ ████▓▓▓▓░░░░████▓▓░░░░░░████▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
│ ████    ████    ████████    ████████    ████    ████████████████  │
│ ●──────────────────────────────────────────────────────────────── │
│ Speaker A: 45%  Speaker B: 35%  Speaker C: 20%                    │
└───────────────────────────────────────────────────────────────────┘
```

### Implementation

**Color Assignment**:

```python
SPEAKER_COLORS = [
    "#4CAF50",  # Green - Speaker A
    "#2196F3",  # Blue - Speaker B
    "#FF9800",  # Orange - Speaker C
    "#9C27B0",  # Purple - Speaker D
    "#00BCD4",  # Cyan - Speaker E
    "#795548"   # Brown - Speaker F
]
```

**Speaker Statistics**:

- **Talk Time Percentage**: Show who spoke most
- **Turn Taking**: Visualize conversation flow
- **Overlap Detection**: Show interruptions/simultaneous speech

## Confidence Score Visualization

### Visual Design

```
┌──────────────────────────────────────────────────────────────────┐
│ ▶️ ⏸️ ⏹️    00:12 / 02:45    🔊 ────●──── 1.0x [Confidence]    │
├──────────────────────────────────────────────────────────────────┤
│ ████▓▓▓▓░░░░████▓▓░░░░░░████▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
│ ▓▓▓▓████░░░░▓▓▓▓████░░░░▓▓▓▓████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
│ ●─────────────────────────────────────────────────────────────── │
│ High: 65%  Medium: 25%  Low: 10%                                 │
└──────────────────────────────────────────────────────────────────┘
```

### Implementation

**Confidence Levels**:

```python
CONFIDENCE_LEVELS = {
    "high": {"threshold": 0.8, "color": "#4CAF50", "opacity": 1.0},
    "medium": {"threshold": 0.6, "color": "#FF9800", "opacity": 0.7},
    "low": {"threshold": 0.0, "color": "#F44336", "opacity": 0.5}
}
```

**Use Cases**:

- **Quality Assessment**: Identify sections needing manual review
- **Reliability Indicator**: Show transcription accuracy
- **Re-processing Guidance**: Highlight low-confidence segments for re-transcription

## Topic/Keyword Visualization

### Visual Design

```
┌───────────────────────────────────────────────────────────────────┐
│ ▶️ ⏸️ ⏹️    00:12 / 02:45    🔊 ────●──── 1.0x [Topics]         │
├───────────────────────────────────────────────────────────────────┤
│ ████▓▓▓▓░░░░████▓▓░░░░░░████▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
│ ████    ░░░░████████░░░░    ████░░░░████████░░░░████    ████████░ │
│ ●──────────────────────────────────────────────────────────────── │
│ 🏢 Business  💰 Finance  📊 Analytics  🎯 Strategy              │
└───────────────────────────────────────────────────────────────────┘
```

### Implementation

**Topic Detection**:

```python
TOPIC_COLORS = {
    "business": "#1976D2",
    "finance": "#388E3C",
    "technology": "#7B1FA2",
    "strategy": "#F57C00",
    "analytics": "#5D4037",
    "personal": "#E91E63"
}

TOPIC_ICONS = {
    "business": "🏢",
    "finance": "💰",
    "technology": "💻",
    "strategy": "🎯",
    "analytics": "📊",
    "personal": "👤"
}
```

**Hover Information**:

```
Topic: Business Strategy
Keywords: growth, market, competition, revenue
Relevance: 85%
Duration: 2:15 - 3:45
```

## Energy/Engagement Visualization

### Visual Design

```
┌─────────────────────────────────────────────────────────────────┐
│ ▶️ ⏸️ ⏹️    00:12 / 02:45    🔊 ────●──── 1.0x [Energy]       │
├─────────────────────────────────────────────────────────────────┤
│ ████▓▓▓▓░░░░████▓▓░░░░░░████▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
│ ░░░░████████░░░░████░░░░████████████░░░░░░░░████░░░░███████████ │
│ ●────────────────────────────────────────────────────────────── │
│ 🔥 High Energy: 35%  ⚡ Medium: 45%  😴 Low: 20%               │
└─────────────────────────────────────────────────────────────────┘
```

### Metrics

**Energy Indicators**:

- **Speech Rate**: Words per minute
- **Volume Variation**: Dynamic range
- **Pause Frequency**: Silence gaps
- **Pitch Variation**: Vocal energy

**Color Coding**:

```python
ENERGY_COLORS = {
    "high": "#FF5722",      # Red-Orange (fire)
    "medium": "#FF9800",    # Orange (lightning)
    "low": "#607D8B"        # Blue-Gray (sleepy)
}
```

## Question/Answer Detection

### Visual Design

```
┌─────────────────────────────────────────────────────────────────┐
│ ▶️ ⏸️ ⏹️    00:12 / 02:45    🔊 ────●──── 1.0x [Q&A]          │
├─────────────────────────────────────────────────────────────────┤
│ ████▓▓▓▓░░░░████▓▓░░░░░░████▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
│ ❓  ████  ❗████  ❓    ████❗  ████  ❓  ████❗███ ❓ ██❗ │
│ ●────────────────────────────────────────────────────────────── │
│ Questions: 12  Answers: 11  Unanswered: 1                       │
└─────────────────────────────────────────────────────────────────┘
```

### Implementation

**Pattern Recognition**:

```python
QUESTION_PATTERNS = [
    r"\b(what|how|why|when|where|who)\b.*\?",
    r".*\?$",
    r"\b(can you|could you|would you)\b",
    r"\b(is it|are you|do you)\b"
]

QA_MARKERS = {
    "question": {"symbol": "❓", "color": "#2196F3"},
    "answer": {"symbol": "❗", "color": "#4CAF50"},
    "unanswered": {"symbol": "❔", "color": "#FF9800"}
}
```

## Action Items/Decisions Visualization

### Visual Design

```
┌─────────────────────────────────────────────────────────────────┐
│ ▶️ ⏸️ ⏹️    00:12 / 02:45    🔊 ────●──── 1.0x [Actions]      │
├─────────────────────────────────────────────────────────────────┤
│ ████▓▓▓▓░░░░████▓▓░░░░░░████▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
│ ✅    ⚡  ✅    📋  ⚡    ✅  📋    ⚡  ✅   📋  ⚡  ✅   │
│ ●────────────────────────────────────────────────────────────── │
│ ✅ Decisions: 5  ⚡ Actions: 8  📋 Follow-ups: 3               │
└─────────────────────────────────────────────────────────────────┘
```

### Implementation

**Action Detection**:

```python
ACTION_PATTERNS = {
    "decision": {
        "patterns": [r"\b(decided|agreed|concluded)\b", r"\b(we will|let's)\b"],
        "symbol": "✅",
        "color": "#4CAF50"
    },
    "action": {
        "patterns": [r"\b(need to|should|must|will)\b", r"\b(action item|todo)\b"],
        "symbol": "⚡",
        "color": "#FF9800"
    },
    "followup": {
        "patterns": [r"\b(follow up|check back|revisit)\b", r"\b(next week|later)\b"],
        "symbol": "📋",
        "color": "#2196F3"
    }
}
```

## Visualization Mode Selector

### UI Component

```python
VISUALIZATION_MODES = {
    "loudness": {"label": "Speech Activity", "icon": "🔊"},
    "sentiment": {"label": "Sentiment", "icon": "😊"},
    "speakers": {"label": "Speakers", "icon": "👥"},
    "confidence": {"label": "Confidence", "icon": "🎯"},
    "topics": {"label": "Topics", "icon": "🏷️"},
    "energy": {"label": "Energy", "icon": "⚡"},
    "qa": {"label": "Q&A", "icon": "❓"},
    "actions": {"label": "Actions", "icon": "✅"}
}
```

### Mode Selector UI

```
[🔊 Speech] [😊 Sentiment] [👥 Speakers] [🎯 Confidence] [More ▼]
```

**Dropdown for "More"**:

- 🏷️ Topics
- ⚡ Energy
- ❓ Q&A
- ✅ Actions

## Implementation Architecture

### Data Structure

```python
@dataclass
class VisualizationData:
    timestamp: float
    duration: float
    loudness: float
    sentiment: Optional[SentimentData]
    speaker_id: Optional[str]
    confidence: float
    topics: List[str]
    energy_level: str
    question_type: Optional[str]
    action_items: List[ActionItem]

@dataclass
class SentimentData:
    emotion: str
    confidence: float
    intensity: float

@dataclass
class ActionItem:
    type: str  # "decision", "action", "followup"
    text: str
    confidence: float
```

### Processing Pipeline

```python
def generate_visualization_data(transcription_result):
    """
    Convert AI transcription results into visualization data
    """
    segments = []

    for segment in transcription_result.segments:
        viz_data = VisualizationData(
            timestamp=segment.start,
            duration=segment.duration,
            loudness=calculate_loudness(segment.audio),
            sentiment=extract_sentiment(segment.text),
            speaker_id=identify_speaker(segment),
            confidence=segment.confidence,
            topics=extract_topics(segment.text),
            energy_level=calculate_energy(segment),
            question_type=detect_questions(segment.text),
            action_items=extract_actions(segment.text)
        )
        segments.append(viz_data)

    return segments
```

## Use Case Examples

### Meeting Analysis

- **Sentiment**: Track mood changes during discussion
- **Speakers**: See who dominated conversation
- **Q&A**: Identify unresolved questions
- **Actions**: Extract next steps automatically

### Interview Analysis

- **Energy**: Find most engaging moments
- **Topics**: See subject coverage
- **Confidence**: Identify unclear responses
- **Sentiment**: Track interviewee comfort level

### Content Creation

- **Energy**: Find best clips for highlights
- **Topics**: Ensure comprehensive coverage
- **Q&A**: Structure content around questions
- **Sentiment**: Balance emotional tone

### Legal/Compliance

- **Speakers**: Verify who said what
- **Confidence**: Flag uncertain transcriptions
- **Actions**: Track commitments and decisions
- **Topics**: Ensure all subjects covered

## Future Enhancements

### Interactive Features

- **Click to jump**: Click any visualization element to jump to that timestamp
- **Zoom functionality**: Zoom into specific time ranges
- **Export segments**: Export audio/transcript segments based on visualization
- **Annotation overlay**: Add manual notes to visualization

### Advanced Analytics

- **Trend analysis**: Show sentiment/energy trends over time
- **Comparative analysis**: Compare multiple recordings
- **Pattern recognition**: Identify recurring themes across recordings
- **Predictive insights**: Suggest optimal meeting lengths, break times

### Integration Features

- **Calendar sync**: Link visualizations to meeting metadata
- **CRM integration**: Connect action items to customer records
- **Task management**: Export action items to project management tools
- **Reporting**: Generate summary reports with visualization insights
