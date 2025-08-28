# Audio Metadata System Documentation

## Overview

The HiDock Desktop Application features a comprehensive audio metadata system that manages transcriptions, AI analysis, user descriptions, and processing status for audio recordings. This system enhances the user experience by providing intelligent insights and searchable content for meeting recordings.

## Architecture

### Core Components

```
┌─────────────────────────────────────────────────────────┐
│                    GUI Layer                            │
│  ┌─────────────────────────────────────────────────┐   │
│  │         AudioMetadataMixin                      │   │
│  │  - GUI integration                              │   │
│  │  - Display updates                              │   │
│  │  - User interactions                            │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                 Database Layer                          │
│  ┌─────────────────────────────────────────────────┐   │
│  │         AudioMetadataDB                         │   │
│  │  - SQLite database management                   │   │
│  │  - CRUD operations                              │   │
│  │  - Thread-safe access                           │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                Processing Layer                         │
│  ┌──────────────────┐    ┌────────────────────────┐   │
│  │ Transcription    │    │    AI Analysis         │   │
│  │    Module        │───▶│      Service           │   │
│  └──────────────────┘    └────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### File Structure

- **`audio_metadata_db.py`** - Database manager and data models
- **`audio_metadata_mixin.py`** - GUI integration layer
- **`transcription_module.py`** - Audio transcription service
- **`ai_service.py`** - AI analysis and insight extraction
- **Database Location**: `~/.hidock/audio_metadata.db`

## Database Schema

### audio_metadata Table

| Field | Type | Description |
|-------|------|-------------|
| **filename** | TEXT PRIMARY KEY | Unique identifier for the audio file |
| **file_path** | TEXT | Local file system path |
| **file_size** | INTEGER | File size in bytes |
| **duration_seconds** | REAL | Audio duration |
| **date_created** | TIMESTAMP | File creation date |
| **processing_status** | TEXT | Current processing state |
| **processing_started_at** | TIMESTAMP | Processing start time |
| **processing_completed_at** | TIMESTAMP | Processing completion time |
| **processing_error** | TEXT | Error message if failed |
| **transcription_text** | TEXT | Full audio transcription |
| **transcription_confidence** | REAL | Transcription confidence score |
| **transcription_language** | TEXT | Detected language |
| **ai_summary** | TEXT | AI-generated summary |
| **ai_participants** | TEXT (JSON) | List of detected participants |
| **ai_action_items** | TEXT (JSON) | Extracted action items |
| **ai_topics** | TEXT (JSON) | Identified topics |
| **ai_sentiment** | TEXT | Overall sentiment |
| **ai_key_quotes** | TEXT (JSON) | Important quotes |
| **user_title** | TEXT | User-defined title |
| **user_description** | TEXT | User-defined description |
| **user_participants** | TEXT (JSON) | User-defined participants |
| **user_action_items** | TEXT (JSON) | User-defined action items |
| **user_tags** | TEXT (JSON) | User tags |
| **user_notes** | TEXT | Additional notes |
| **display_title** | TEXT | Computed display title |
| **display_description** | TEXT | Computed display description |
| **created_at** | TIMESTAMP | Record creation time |
| **updated_at** | TIMESTAMP | Last update time |

### processing_log Table

| Field | Type | Description |
|-------|------|-------------|
| **id** | INTEGER PRIMARY KEY | Auto-increment ID |
| **filename** | TEXT | Reference to audio file |
| **processing_step** | TEXT | Processing stage |
| **status** | TEXT | Step status |
| **message** | TEXT | Log message |
| **timestamp** | TIMESTAMP | Log entry time |

## Processing States

The system uses an enum `ProcessingStatus` with the following states:

```python
class ProcessingStatus(Enum):
    NOT_PROCESSED = "not_processed"    # File discovered but not processed
    TRANSCRIBING = "transcribing"      # Currently transcribing audio
    TRANSCRIBED = "transcribed"        # Transcription complete
    AI_ANALYZING = "ai_analyzing"      # AI analysis in progress
    AI_ANALYZED = "ai_analyzed"        # AI analysis complete
    COMPLETED = "completed"            # All processing complete
    ERROR = "error"                    # Processing failed
```

## Metadata Lifecycle

### 1. File Discovery

When files are fetched from the HiDock device:

```python
# In gui_actions_device.py
files_dict = self.enhance_files_with_audio_metadata(files_dict)
```

- Creates database entry for new files
- Sets initial status to `NOT_PROCESSED`
- Populates basic file information

### 2. Processing Initiation

User triggers processing via right-click context menu:

```python
# User selects "Process Audio (Transcribe + Analyze)"
self.start_audio_processing(filename)
```

### 3. Transcription Phase

```python
# Background thread execution
1. Update status → TRANSCRIBING
2. Call transcription_module.process_audio_file_for_insights()
3. Save transcription results
4. Update status → TRANSCRIBED
```

### 4. AI Analysis Phase

```python
# Continues in background thread
1. Update status → AI_ANALYZING
2. Call ai_service.process_audio_insights()
3. Extract:
   - Summary
   - Participants
   - Action items
   - Topics
   - Sentiment
   - Key quotes
4. Save AI analysis results
5. Update status → COMPLETED
```

### 5. Display Updates

Real-time GUI updates during processing:

```python
self._refresh_file_display_for_metadata_change(filename)
```

## Display Priority System

The Meeting column in the TreeView shows information based on priority:

1. **Processing Status** - "Transcribing...", "Analyzing...", "Processing Error"
2. **User Title** - If user has set a custom title
3. **AI Summary** - First line, truncated to 45 characters
4. **Calendar Info** - From calendar integration (if available)
5. **Blank** - If no metadata available

## User Interactions

### Editing Metadata

Users can edit metadata fields through:

```python
self.update_user_audio_metadata(
    filename=filename,
    title="Custom Meeting Title",
    description="Custom description",
    participants=["John", "Jane"],
    action_items=["Follow up on proposal"],
    tags=["important", "project-x"],
    notes="Additional context"
)
```

### Search Functionality

Search across all text content:

```python
results = self.search_audio_content("project deadline")
# Searches in: transcription_text, ai_summary, user_title, 
#              user_description, user_notes
```

### Batch Processing

Process multiple files automatically:

```python
# Process up to 5 ready files
processed_count = self.batch_process_ready_files(max_files=5)
```

## API Reference

### AudioMetadataMixin Methods

#### File Enhancement
```python
enhance_files_with_audio_metadata(files_dict: List[Dict]) -> List[Dict]
```
Enriches file data with metadata from database.

#### Processing Control
```python
start_audio_processing(filename: str) -> bool
```
Initiates background processing for an audio file.

```python
can_process_audio_file(filename: str) -> bool
```
Checks if file is downloaded and ready for processing.

#### Metadata Access
```python
get_audio_metadata_for_file(filename: str) -> Optional[AudioMetadata]
```
Retrieves complete metadata for a file.

#### User Updates
```python
update_user_audio_title(filename: str, title: str) -> bool
update_user_audio_description(filename: str, description: str) -> bool
update_user_audio_metadata(filename: str, **kwargs) -> bool
```

#### Search and Statistics
```python
search_audio_content(query: str) -> List[AudioMetadata]
get_audio_processing_statistics() -> Dict[str, int]
```

#### Maintenance
```python
cleanup_audio_metadata(current_filenames: List[str]) -> int
```
Removes metadata for files no longer on device.

### AudioMetadataDB Methods

#### Core Operations
```python
get_metadata(filename: str) -> Optional[AudioMetadata]
save_metadata(metadata: AudioMetadata) -> bool
delete_metadata(filename: str) -> bool
```

#### Processing Updates
```python
update_processing_status(filename: str, status: ProcessingStatus, 
                        error_message: Optional[str] = None) -> bool
save_transcription(filename: str, transcription_text: str, 
                  confidence: float = None, language: str = None) -> bool
save_ai_analysis(filename: str, summary: str = None, 
                participants: List[str] = None, ...) -> bool
```

#### Queries
```python
get_files_by_status(status: ProcessingStatus) -> List[AudioMetadata]
get_all_metadata() -> List[AudioMetadata]
search_metadata(query: str) -> List[AudioMetadata]
```

## Configuration

### AI Service Configuration

The system supports multiple AI providers configured in `hidock_config.json`:

```json
{
  "transcription_settings": {
    "ai_provider": "gemini",
    "api_key": "your-api-key",
    "model": "gemini-1.5-flash",
    "temperature": 0.7
  }
}
```

Supported providers:
- Google Gemini
- OpenAI
- Anthropic Claude
- Amazon Bedrock
- OpenRouter
- Qwen
- DeepSeek

### Database Configuration

Default database location: `~/.hidock/audio_metadata.db`

To change location, modify in `audio_metadata_db.py`:

```python
db_path = os.path.join(custom_path, "audio_metadata.db")
```

## Best Practices

### Performance Optimization

1. **Batch Processing**: Use `batch_process_ready_files()` for multiple files
2. **Background Threading**: All processing runs in background threads
3. **Database Indexing**: Indexes on `processing_status`, `date_created`, `updated_at`
4. **Lazy Initialization**: Database initialized only when needed

### Error Handling

1. **Graceful Degradation**: System continues with mock data if API keys missing
2. **Status Tracking**: All errors logged to `processing_log` table
3. **User Feedback**: Processing status visible in GUI
4. **Retry Logic**: Failed files can be reprocessed

### Data Integrity

1. **Thread Safety**: All database operations use locks
2. **Orphan Cleanup**: Automatic removal of metadata for deleted files
3. **Transaction Safety**: Database operations in transactions
4. **Foreign Keys**: Referential integrity enforced

## Troubleshooting

### Common Issues

#### Files Not Processing
- Check if file is downloaded locally
- Verify API keys are configured
- Check `processing_log` table for errors

#### Missing Metadata
- Ensure `enhance_files_with_audio_metadata()` is called
- Check database file permissions
- Verify database path exists

#### Slow Processing
- Large files take longer to transcribe
- API rate limits may apply
- Check network connectivity

### Debug Commands

```python
# Check processing statistics
stats = self.get_audio_processing_statistics()
print(f"Not processed: {stats.get('not_processed', 0)}")
print(f"Completed: {stats.get('completed', 0)}")
print(f"Errors: {stats.get('error', 0)}")

# Find failed files
db = get_audio_metadata_db()
failed = db.get_files_by_status(ProcessingStatus.ERROR)
for file in failed:
    print(f"{file.filename}: {file.processing_error}")

# Manually trigger processing
if self.can_process_audio_file(filename):
    self.start_audio_processing(filename)
```

## Future Enhancements

### Planned Features

1. **Metadata Export**: Export to CSV/JSON formats
2. **Advanced Search**: Regular expression support
3. **Speaker Diarization**: Identify individual speakers
4. **Language Detection**: Auto-detect and translate
5. **Metadata Templates**: Predefined metadata sets
6. **Webhook Integration**: Notify external systems
7. **Cloud Backup**: Sync metadata to cloud storage

### API Extensions

- Bulk metadata operations
- Metadata versioning
- Collaborative editing
- Real-time sync across devices

## Related Documentation

- [Configuration Guide](../SETUP.md)
- [API Documentation](../API.md)
- [Testing Guide](../testing/TESTING_GUIDE.md)
- [Calendar Integration](./CALENDAR_INTEGRATION.md)