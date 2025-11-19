# Design Document: Quick Transcription Feature

## 1. Overview

This document outlines the technical design for implementing a quick transcription feature in the HiDock Desktop application. The feature allows users to transcribe audio recordings using Gemini 2.5 Pro and access transcriptions directly from the file list interface.

## 2. Architecture

### 2.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                       HiDock Desktop GUI                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐ │
│  │  TreeView    │  │ FileActions  │  │  EventHandlers       │ │
│  │  Mixin       │  │ Mixin        │  │  Mixin               │ │
│  │              │  │              │  │                      │ │
│  │ - Display    │  │ - Transcribe │  │ - Click Handler      │ │
│  │   Column     │  │   Action     │  │ - Context Menu       │ │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────────────┘ │
│         │                  │                  │                 │
└─────────┼──────────────────┼──────────────────┼─────────────────┘
          │                  │                  │
          ▼                  ▼                  ▼
┌─────────────────────────────────────────────────────────────────┐
│              Transcription Service Layer                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌────────────────────────────────────────────────────────────┐│
│  │  TranscriptionManager (NEW)                                ││
│  │  - manage_transcription_for_file()                         ││
│  │  - check_transcription_exists()                            ││
│  │  - open_transcription()                                    ││
│  │  - get_transcription_status()                              ││
│  └────────────────┬───────────────────────────────────────────┘│
│                   │                                             │
│                   ▼                                             │
│  ┌────────────────────────────────────────────────────────────┐│
│  │  transcription_module.py (EXISTING)                        ││
│  │  - process_audio_file_for_insights()                       ││
│  │  - transcribe_audio()                                      ││
│  └────────────────┬───────────────────────────────────────────┘│
│                   │                                             │
└───────────────────┼─────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                    AI Service Layer                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌────────────────────────────────────────────────────────────┐│
│  │  ai_service.py (EXISTING)                                  ││
│  │  - AIServiceManager                                        ││
│  │  - GeminiProvider                                          ││
│  └────────────────┬───────────────────────────────────────────┘│
│                   │                                             │
└───────────────────┼─────────────────────────────────────────────┘
                    │
                    ▼
            ┌───────────────┐
            │  Gemini API   │
            │  (gemini-2.0  │
            │  -flash-exp)  │
            └───────────────┘
```

### 2.2 Component Responsibilities

#### 2.2.1 TreeViewMixin (Modified)
- **File**: `apps/desktop/src/gui_treeview.py`
- **Responsibilities**:
  - Add "transcription" column to tree view columns tuple
  - Configure column width and alignment (80px, left-aligned)
  - Display transcription status indicator in column
  - Bind click events to transcription column cells
  - Update transcription column when status changes

#### 2.2.2 FileActionsMixin (Modified)
- **File**: `apps/desktop/src/gui_actions_file.py`
- **Responsibilities**:
  - Add "Quick Transcribe" context menu item
  - Implement `transcribe_selected_file()` method
  - Handle transcription action initiation
  - Update UI during transcription process
  - Display toast notifications for status updates

#### 2.2.3 EventHandlersMixin (Modified)
- **File**: `apps/desktop/src/gui_event_handlers.py`
- **Responsibilities**:
  - Handle clicks on transcription column cells
  - Determine if click is on transcription indicator
  - Delegate to appropriate handler method
  - Prevent event propagation when appropriate

#### 2.2.4 TranscriptionManager (New)
- **File**: `apps/desktop/src/transcription_manager.py` (NEW)
- **Responsibilities**:
  - Manage transcription lifecycle for files
  - Check if transcription exists for a file
  - Generate transcription file paths
  - Open transcriptions in system editor
  - Track transcription status (pending, processing, completed, failed)
  - Store/retrieve transcription metadata
  - Handle concurrent transcription requests
  - Implement retry logic for failed transcriptions

## 3. Data Model

### 3.1 File Metadata Extension

Existing file metadata structure will be extended:

```python
file_info = {
    # Existing fields
    "name": str,                    # e.g., "REC_20250104_143022.hta"
    "length": int,                  # File size in bytes
    "createDate": str,              # "2025-01-04"
    "createTime": str,              # "14:30:22"
    "duration": int,                # Duration in seconds
    "gui_status": str,              # "On Device", "Downloaded", etc.
    "meeting_display_text": str,    # Meeting info if available

    # NEW FIELDS
    "transcription_status": str,    # "none" | "pending" | "processing" | "completed" | "failed"
    "transcription_path": str,      # Path to transcription .txt file
    "transcription_timestamp": float,  # Unix timestamp of last transcription attempt
    "transcription_error": str,     # Error message if failed
}
```

### 3.2 Transcription File Naming Convention

Transcription files will be stored alongside downloaded audio files:

```
Download Directory/
├── REC_20250104_143022.hta
├── REC_20250104_143022_transcription.txt
├── REC_20250104_143022_insights.json (existing, if generated)
├── REC_20250105_091530.hta
└── REC_20250105_091530_transcription.txt
```

**Naming Pattern**: `{original_filename}_transcription.txt`

### 3.3 Transcription Status States

```python
class TranscriptionStatus:
    NONE = "none"              # No transcription exists or attempted
    PENDING = "pending"        # Queued for transcription
    PROCESSING = "processing"  # Currently transcribing
    COMPLETED = "completed"    # Transcription successful
    FAILED = "failed"          # Transcription failed
```

## 4. User Interface Design

### 4.1 Tree View Column Layout

Existing columns + new transcription column:

```
┌────┬────────────┬──────────────┬──────┬──────────┬─────────┬────────┬──────────┬───────────────┐
│ #  │ Name       │ Date/Time    │ Size │ Duration │ Meeting │ Version│ Status   │ Transcription │
├────┼────────────┼──────────────┼──────┼──────────┼─────────┼────────┼──────────┼───────────────┤
│ 1  │ REC_001... │ 2025-01-04...│ 5.2  │ 00:45:30 │ Team... │ 1.0    │ Download │ 📄 View       │
│ 2  │ REC_002... │ 2025-01-05...│ 3.8  │ 00:30:15 │         │ 1.0    │ On Device│ ⏳ Processing │
│ 3  │ REC_003... │ 2025-01-06...│ 7.1  │ 01:15:00 │ Client..│ 1.0    │ Download │ -             │
│ 4  │ REC_004... │ 2025-01-07...│ 4.5  │ 00:38:20 │         │ 1.0    │ Download │ ❌ Failed     │
└────┴────────────┴──────────────┴──────┴──────────┴─────────┴────────┴──────────┴───────────────┘
```

### 4.2 Transcription Column Indicators

| Status | Display | Clickable | Description |
|--------|---------|-----------|-------------|
| none | `-` | No | No transcription exists |
| pending | `⏰ Queued` | No | In queue for processing |
| processing | `⏳ Processing...` | No | Currently transcribing |
| completed | `📄 View` | Yes | Click to open in Notepad |
| failed | `❌ Failed` | Yes | Click to see error details |

### 4.3 Context Menu Addition

Right-click context menu for audio files:

```
┌──────────────────────────────────────┐
│ 🎵 Play Audio                        │
│ ⬇️  Download                         │
│ 📝 Quick Transcribe with Gemini      │  <- NEW
│ ────────────────────────────────     │
│ 🗑️  Delete from Device              │
│ ℹ️  Properties                       │
└──────────────────────────────────────┘
```

### 4.4 Toast Notifications

**Start Notification**:
```
┌─────────────────────────────────────────┐
│ 🎙️ Transcription Started                │
│ Processing: REC_20250104_143022.hta    │
└─────────────────────────────────────────┘
```

**Success Notification**:
```
┌─────────────────────────────────────────┐
│ ✅ Transcription Complete               │
│ REC_20250104_143022.hta                │
│ Click to view                          │
└─────────────────────────────────────────┘
```

**Error Notification**:
```
┌─────────────────────────────────────────┐
│ ❌ Transcription Failed                  │
│ REC_20250104_143022.hta                │
│ Error: API rate limit exceeded         │
└─────────────────────────────────────────┘
```

## 5. API Integration

### 5.1 Gemini Configuration

The system will use Gemini 2.5 Pro (or gemini-2.0-flash-exp) via the existing `ai_service.py` infrastructure:

```python
provider_config = {
    "provider": "gemini",
    "model": "gemini-2.0-flash-exp",  # Best for audio transcription
    "api_key": config["gemini_api_key"],
    "temperature": 0.3,
    "language": "auto"
}
```

### 5.2 API Call Flow

```
1. User triggers transcription
   └─> FileActionsMixin.transcribe_selected_file()
       └─> TranscriptionManager.manage_transcription_for_file()
           ├─> Check if file downloaded (if not, download)
           ├─> Set status to "processing"
           ├─> Update UI (show spinner in column)
           └─> async: transcribe_audio()
               └─> ai_service.transcribe_audio()
                   └─> GeminiProvider.transcribe_audio()
                       └─> Gemini API call
                           ├─> Success: save transcription to file
                           │   ├─> Update status to "completed"
                           │   └─> Show success toast
                           └─> Failure: log error
                               ├─> Update status to "failed"
                               └─> Show error toast
```

### 5.3 Error Handling

```python
# Retry logic
max_retries = 2
retry_delay = 2  # seconds

# Rate limiting
if error.code == 429:  # Too Many Requests
    wait_time = exponential_backoff(attempt_number)
    await asyncio.sleep(wait_time)
    retry()

# Authentication errors
if error.code == 401:
    prompt_user_to_configure_api_key()

# Network errors
if isinstance(error, NetworkError):
    show_error("No internet connection")
```

## 6. File Storage

### 6.1 Transcription File Format

Transcription files will be plain text (.txt) with UTF-8 encoding:

```
=== TRANSCRIPTION ===
File: REC_20250104_143022.hta
Date: 2025-01-04 14:30:22
Duration: 45 minutes 30 seconds
Model: gemini-2.0-flash-exp
Transcribed: 2025-01-04 15:15:00

[Transcribed text starts here...]
Speaker A: Good afternoon everyone, welcome to the team meeting.
Speaker B: Thanks for joining. Let's start with the agenda...
[etc.]
```

### 6.2 Metadata Persistence

Transcription metadata will be stored in the existing file metadata system. Two approaches:

**Option A: Extend existing file metadata**
- Store transcription_status, transcription_path, etc. directly in file_info dict
- Persist to disk using existing mechanisms (JSON sidecar files or database)

**Option B: Separate transcription cache file**
- Create `transcription_cache.json` in app data directory
- Structure:
```json
{
  "transcriptions": {
    "REC_20250104_143022.hta": {
      "status": "completed",
      "path": "C:/Users/.../Downloads/REC_20250104_143022_transcription.txt",
      "timestamp": 1735998900.0,
      "model": "gemini-2.0-flash-exp"
    }
  }
}
```

**Recommendation**: Option A (extend file metadata) for better integration with existing systems.

## 7. Concurrency & Performance

### 7.1 Async Processing

All transcription operations will be async to prevent UI blocking:

```python
async def transcribe_selected_file(self):
    """Non-blocking transcription handler"""
    file_info = self._get_selected_file_info()

    # Run transcription in background
    self.run_async(
        self._transcribe_file_async(file_info),
        on_complete=self._on_transcription_complete
    )
```

### 7.2 Concurrent Transcription Limit

Maximum 3 concurrent transcriptions to avoid overwhelming the API:

```python
class TranscriptionManager:
    def __init__(self):
        self.active_transcriptions = []  # Track active tasks
        self.max_concurrent = 3
        self.transcription_queue = []    # Queue for excess requests
```

### 7.3 Progress Tracking

For long audio files, show progress updates:

```python
# Update UI during processing
def _update_transcription_progress(file_name, progress_pct):
    status_text = f"⏳ Processing... {progress_pct}%"
    update_tree_column(file_name, "transcription", status_text)
```

## 8. Configuration

### 8.1 New Config Keys

Add to `hidock_config.json`:

```json
{
  "transcription": {
    "provider": "gemini",
    "model": "gemini-2.0-flash-exp",
    "auto_transcribe": false,
    "save_insights": true,
    "max_concurrent": 3,
    "retry_attempts": 2,
    "timeout_seconds": 300
  }
}
```

### 8.2 Settings Dialog Integration

Add transcription settings to Settings dialog:

```
┌─────────────────────────────────────────┐
│ [Transcription Settings]                │
│                                         │
│ Provider: [Gemini ▼]                    │
│ Model:    [gemini-2.0-flash-exp ▼]     │
│                                         │
│ [✓] Auto-transcribe downloaded files    │
│ [✓] Save insights with transcription    │
│                                         │
│ Max concurrent: [3]                     │
│                                         │
└─────────────────────────────────────────┘
```

## 9. Testing Strategy

### 9.1 Unit Tests

```python
# test_transcription_manager.py
def test_generate_transcription_path():
    """Test transcription file path generation"""

def test_check_transcription_exists():
    """Test checking for existing transcriptions"""

def test_transcription_status_updates():
    """Test status transitions"""

def test_concurrent_transcription_limit():
    """Test max concurrent transcription enforcement"""
```

### 9.2 Integration Tests

```python
# test_transcription_integration.py
async def test_full_transcription_flow():
    """Test complete transcription workflow"""

async def test_transcription_with_api_error():
    """Test error handling and retry logic"""

def test_transcription_persistence():
    """Test metadata saving and loading"""
```

### 9.3 Manual Testing Checklist

- [ ] Transcribe file via context menu
- [ ] Click on completed transcription to open in Notepad
- [ ] Verify transcription column updates in real-time
- [ ] Test with missing API key (should prompt)
- [ ] Test with invalid API key (should error gracefully)
- [ ] Test with very long audio file (60+ minutes)
- [ ] Test with multiple concurrent transcriptions
- [ ] Test transcription persistence after app restart
- [ ] Test with different audio formats (HTA, WAV, MP3)
- [ ] Test error handling (network errors, API errors)

## 10. Security Considerations

### 10.1 API Key Security

- Store API keys in encrypted config (if encryption available)
- Never log API keys
- Validate API key format before sending to API
- Allow users to clear/reset API keys

### 10.2 File Security

- Validate file paths before writing transcriptions
- Prevent path traversal attacks
- Sanitize file names for transcription files
- Check disk space before writing files

### 10.3 Data Privacy

- Warn users that audio is sent to Google Gemini API
- Add opt-in consent for transcription feature
- Allow users to delete transcription files easily
- Don't cache sensitive transcription data in memory longer than necessary

## 11. Backwards Compatibility

### 11.1 Config Migration

Existing configs without transcription settings:

```python
def migrate_config_for_transcription(config):
    """Add transcription defaults if not present"""
    if "transcription" not in config:
        config["transcription"] = {
            "provider": "gemini",
            "model": "gemini-2.0-flash-exp",
            "auto_transcribe": False,
            "save_insights": True,
            "max_concurrent": 3,
            "retry_attempts": 2,
            "timeout_seconds": 300
        }
    return config
```

### 11.2 Tree View Column Compatibility

Handle existing saved column orders gracefully:

```python
# If saved column order doesn't include "transcription", append it
if "transcription" not in saved_columns:
    saved_columns.append("transcription")
```

## 12. Future Enhancements

### 12.1 Phase 2 Features
- Batch transcription (transcribe multiple files at once)
- In-app transcription viewer with syntax highlighting
- Search within transcriptions
- Export transcriptions to PDF/DOCX

### 12.2 Phase 3 Features
- Speaker diarization visualization
- Edit transcriptions inline
- Compare transcription versions
- Transcription quality metrics
- Alternative AI providers (OpenAI Whisper, Anthropic)

## 13. References

- [Google Gemini API Documentation](https://ai.google.dev/docs)
- [EARS Requirements Syntax](https://www.iaria.org/conferences2013/filesICCGI13/Tutorial%20EARS.pdf)
- Existing codebase: `apps/desktop/src/transcription_module.py`
- Existing codebase: `apps/desktop/src/ai_service.py`
