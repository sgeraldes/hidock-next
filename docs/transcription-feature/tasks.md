# Implementation Tasks: Quick Transcription Feature

## Overview

This document breaks down the implementation of the Quick Transcription feature into discrete, actionable tasks organized by component and priority.

## Task Organization

- **Priority**: P0 (Critical), P1 (High), P2 (Medium), P3 (Low)
- **Effort**: XS (<2h), S (2-4h), M (4-8h), L (8-16h), XL (>16h)
- **Dependencies**: Listed as task IDs (e.g., T1.1, T2.3)

---

## Phase 1: Core Infrastructure

### T1. Create TranscriptionManager Module

**Priority**: P0 | **Effort**: M | **Dependencies**: None

#### T1.1 Create transcription_manager.py file
- [ ] Create `apps/desktop/src/transcription_manager.py`
- [ ] Add module docstring with description
- [ ] Import necessary dependencies (os, pathlib, asyncio, logger)
- [ ] Define module-level constants

**Acceptance Criteria**:
- File created with proper structure
- Imports are correct and not circular
- Passes linting (ruff, black, isort)

---

#### T1.2 Implement TranscriptionStatus enum
- [ ] Define `TranscriptionStatus` enum with states: NONE, PENDING, PROCESSING, COMPLETED, FAILED
- [ ] Add docstring describing each state
- [ ] Add utility methods for status comparison if needed

**Acceptance Criteria**:
- Enum is properly defined
- All states are documented
- Can be imported from other modules

**Code Snippet**:
```python
from enum import Enum

class TranscriptionStatus(Enum):
    """Status of audio file transcription"""
    NONE = "none"              # No transcription attempted
    PENDING = "pending"        # Queued for processing
    PROCESSING = "processing"  # Currently transcribing
    COMPLETED = "completed"    # Successfully transcribed
    FAILED = "failed"          # Transcription failed
```

---

#### T1.3 Implement TranscriptionManager class skeleton
- [ ] Create `TranscriptionManager` class
- [ ] Add `__init__` method with configuration parameters
- [ ] Initialize instance variables (active_transcriptions, queue, etc.)
- [ ] Add placeholder methods for core functionality

**Acceptance Criteria**:
- Class instantiates without errors
- Instance variables are properly initialized
- Follows existing code patterns (logger, config)

**Code Snippet**:
```python
class TranscriptionManager:
    """Manages audio transcription lifecycle"""

    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.active_transcriptions: List[str] = []
        self.transcription_queue: List[str] = []
        self.max_concurrent = config.get("transcription", {}).get("max_concurrent", 3)
        logger.info("TranscriptionManager", "init", "Transcription manager initialized")
```

---

#### T1.4 Implement get_transcription_path()
- [ ] Create method to generate transcription file path from audio file path
- [ ] Handle different file extensions (HTA, WAV, MP3)
- [ ] Validate paths and sanitize filenames
- [ ] Add unit tests

**Acceptance Criteria**:
- Method correctly generates paths for all audio formats
- Handles edge cases (special characters, long names)
- Unit tests pass with 100% coverage

**Code Snippet**:
```python
def get_transcription_path(self, audio_file_path: str) -> str:
    """Generate transcription file path for audio file"""
    base_path = os.path.splitext(audio_file_path)[0]
    return f"{base_path}_transcription.txt"
```

---

#### T1.5 Implement check_transcription_exists()
- [ ] Create method to check if transcription file exists
- [ ] Verify file is readable and not corrupted
- [ ] Return transcription status
- [ ] Add unit tests

**Acceptance Criteria**:
- Correctly identifies existing transcriptions
- Handles missing files gracefully
- Validates file integrity
- Unit tests cover all scenarios

**Code Snippet**:
```python
def check_transcription_exists(self, audio_file_path: str) -> bool:
    """Check if transcription file exists for audio file"""
    transcription_path = self.get_transcription_path(audio_file_path)
    return os.path.exists(transcription_path) and os.path.getsize(transcription_path) > 0
```

---

#### T1.6 Implement get_transcription_status()
- [ ] Create method to determine current transcription status
- [ ] Check file metadata for status
- [ ] Fallback to file existence check
- [ ] Add unit tests

**Acceptance Criteria**:
- Returns correct status for all scenarios
- Handles corrupted metadata gracefully
- Unit tests pass

---

#### T1.7 Implement save_transcription()
- [ ] Create method to save transcription text to file
- [ ] Add header with metadata (filename, date, model, etc.)
- [ ] Use UTF-8 encoding
- [ ] Handle write errors gracefully
- [ ] Add unit tests

**Acceptance Criteria**:
- Transcription files are correctly formatted
- Handles disk full errors
- Handles permission errors
- Unit tests pass

**Code Snippet**:
```python
def save_transcription(self, audio_file_path: str, transcription_text: str, metadata: Dict[str, Any]) -> bool:
    """Save transcription text to file with metadata header"""
    try:
        transcription_path = self.get_transcription_path(audio_file_path)
        with open(transcription_path, 'w', encoding='utf-8') as f:
            # Write header
            f.write("=== TRANSCRIPTION ===\n")
            f.write(f"File: {os.path.basename(audio_file_path)}\n")
            f.write(f"Date: {metadata.get('date', 'N/A')}\n")
            f.write(f"Model: {metadata.get('model', 'N/A')}\n")
            f.write(f"\n{transcription_text}\n")
        return True
    except Exception as e:
        logger.error("TranscriptionManager", "save_transcription", f"Error: {e}")
        return False
```

---

#### T1.8 Implement open_transcription()
- [ ] Create method to open transcription in system editor
- [ ] Use subprocess to launch notepad.exe (Windows)
- [ ] Handle file not found errors
- [ ] Add cross-platform support check
- [ ] Add unit tests (mocking subprocess)

**Acceptance Criteria**:
- Opens Notepad on Windows correctly
- Handles missing file errors
- Logs errors appropriately
- Unit tests pass

**Code Snippet**:
```python
def open_transcription(self, audio_file_path: str) -> bool:
    """Open transcription file in system text editor"""
    transcription_path = self.get_transcription_path(audio_file_path)

    if not os.path.exists(transcription_path):
        logger.error("TranscriptionManager", "open_transcription", "File not found")
        return False

    try:
        if sys.platform == "win32":
            subprocess.Popen(["notepad.exe", transcription_path])
            return True
        else:
            logger.warning("TranscriptionManager", "open_transcription", "Unsupported platform")
            return False
    except Exception as e:
        logger.error("TranscriptionManager", "open_transcription", f"Error: {e}")
        return False
```

---

#### T1.9 Implement transcribe_file_async()
- [ ] Create async method to transcribe audio file
- [ ] Check if file is downloaded (download if needed)
- [ ] Call transcription_module.transcribe_audio()
- [ ] Update status during processing
- [ ] Save transcription on success
- [ ] Handle errors and retries
- [ ] Add integration tests

**Acceptance Criteria**:
- Successfully transcribes audio files
- Updates status at each stage
- Handles API errors gracefully
- Implements retry logic
- Integration tests pass

**Code Snippet**:
```python
async def transcribe_file_async(
    self,
    audio_file_path: str,
    file_info: Dict[str, Any],
    on_status_change: Callable[[str, TranscriptionStatus], None]
) -> bool:
    """Asynchronously transcribe audio file"""
    try:
        # Update status to processing
        on_status_change(file_info["name"], TranscriptionStatus.PROCESSING)

        # Get API configuration
        provider = self.config.get("transcription", {}).get("provider", "gemini")
        model = self.config.get("transcription", {}).get("model", "gemini-2.0-flash-exp")
        api_key = self.config.get("gemini_api_key", "")

        # Perform transcription
        result = await transcription_module.transcribe_audio(
            audio_file_path=audio_file_path,
            provider=provider,
            api_key=api_key,
            config={"model": model},
            language="auto"
        )

        # Save transcription
        if result.get("transcription"):
            success = self.save_transcription(
                audio_file_path,
                result["transcription"],
                {"model": model, "date": datetime.now().isoformat()}
            )

            if success:
                on_status_change(file_info["name"], TranscriptionStatus.COMPLETED)
                return True

        on_status_change(file_info["name"], TranscriptionStatus.FAILED)
        return False

    except Exception as e:
        logger.error("TranscriptionManager", "transcribe_file_async", f"Error: {e}")
        on_status_change(file_info["name"], TranscriptionStatus.FAILED)
        return False
```

---

#### T1.10 Implement manage_transcription_for_file()
- [ ] Create main orchestration method
- [ ] Check concurrency limits
- [ ] Add to queue if limit reached
- [ ] Start transcription task
- [ ] Track active transcriptions
- [ ] Add integration tests

**Acceptance Criteria**:
- Respects max concurrent limit
- Properly queues excess requests
- Removes completed tasks from tracking
- Integration tests pass

---

### T2. Extend File Metadata Structure

**Priority**: P0 | **Effort**: S | **Dependencies**: T1.2

#### T2.1 Add transcription fields to file_info dict
- [ ] Identify where file metadata is initialized
- [ ] Add transcription_status field (default: TranscriptionStatus.NONE)
- [ ] Add transcription_path field (default: None)
- [ ] Add transcription_timestamp field (default: None)
- [ ] Add transcription_error field (default: None)
- [ ] Update existing code that creates file_info dicts

**Acceptance Criteria**:
- All file_info dicts include new fields
- Default values are appropriate
- No breaking changes to existing code

**Files to Modify**:
- `apps/desktop/src/gui_actions_device.py` (where file list is fetched)
- Any other locations that create file_info dicts

---

#### T2.2 Implement metadata persistence
- [ ] Create method to save transcription metadata to disk
- [ ] Create method to load transcription metadata from disk
- [ ] Decide on storage format (JSON sidecar or extend existing)
- [ ] Add migration for existing data
- [ ] Add unit tests

**Acceptance Criteria**:
- Metadata persists across app restarts
- Loading is fast (<100ms for 1000 files)
- Migration doesn't break existing data
- Unit tests pass

---

### T3. Modify TreeViewMixin

**Priority**: P0 | **Effort**: M | **Dependencies**: T1.1, T2.1

#### T3.1 Add transcription column to tree view
- [ ] Modify columns tuple in `_create_file_tree_frame()`
- [ ] Add `"transcription"` to columns list
- [ ] Configure column properties (width: 100px, anchor: "w")
- [ ] Add to `original_tree_headings` dict with heading text "Transcription"
- [ ] Test column display

**Acceptance Criteria**:
- Column appears in tree view
- Column is properly sized
- Column heading is displayed correctly

**File**: `apps/desktop/src/gui_treeview.py:29`

**Code Change**:
```python
# BEFORE
columns = ("num", "name", "datetime", "size", "duration", "meeting", "version", "status")

# AFTER
columns = ("num", "name", "datetime", "size", "duration", "meeting", "version", "status", "transcription")
```

---

#### T3.2 Add transcription column configuration
- [ ] Add column width configuration
- [ ] Add column alignment
- [ ] Add to displaycolumns if needed
- [ ] Test column configuration

**File**: `apps/desktop/src/gui_treeview.py:70-83`

**Code Change**:
```python
elif col == "transcription":
    self.file_tree.column(col, width=100, minwidth=80, anchor="w")
```

---

#### T3.3 Update _populate_treeview_from_data()
- [ ] Add transcription status to values tuple
- [ ] Format transcription status for display
- [ ] Handle all status states (none, pending, processing, completed, failed)
- [ ] Test with different statuses

**Acceptance Criteria**:
- Transcription column displays correct status
- Status indicators are properly formatted
- All status states are handled

**File**: `apps/desktop/src/gui_treeview.py:215-225`

**Code Change**:
```python
# Get transcription status indicator
transcription_display = self._format_transcription_status(file_info)

values = (
    file_info.get("original_index", i + 1),
    file_info["name"],
    datetime_str,
    size_mb_str,
    duration_str,
    meeting_text,
    version_str,
    status_text,
    transcription_display,  # NEW
)
```

---

#### T3.4 Implement _format_transcription_status()
- [ ] Create helper method to format transcription status for display
- [ ] Map TranscriptionStatus values to display strings
- [ ] Add emoji indicators
- [ ] Test all status types

**Acceptance Criteria**:
- All statuses are properly formatted
- Emoji indicators are consistent
- Method is efficient (no heavy processing)

**Code Snippet**:
```python
def _format_transcription_status(self, file_info: Dict[str, Any]) -> str:
    """Format transcription status for display in tree view"""
    status = file_info.get("transcription_status", TranscriptionStatus.NONE)

    if status == TranscriptionStatus.COMPLETED:
        return "📄 View"
    elif status == TranscriptionStatus.PROCESSING:
        return "⏳ Processing..."
    elif status == TranscriptionStatus.PENDING:
        return "⏰ Queued"
    elif status == TranscriptionStatus.FAILED:
        return "❌ Failed"
    else:
        return "-"
```

---

#### T3.5 Bind click event to transcription column
- [ ] Modify `<Button-1>` binding to detect transcription column clicks
- [ ] Implement `_on_transcription_column_click()` handler
- [ ] Delegate to appropriate action based on status
- [ ] Test click handling

**Acceptance Criteria**:
- Clicks on transcription column are detected
- Only "completed" status triggers open action
- Failed status shows error details
- Other statuses do nothing

**File**: `apps/desktop/src/gui_treeview.py:101`

---

#### T3.6 Update _update_file_status_in_treeview()
- [ ] Extend method to update transcription column
- [ ] Add parameter for transcription status
- [ ] Update both status and transcription columns
- [ ] Test updates

**Acceptance Criteria**:
- Transcription column updates correctly
- Status column updates are not broken
- Updates are efficient (no full tree refresh)

---

### T4. Modify FileActionsMixin

**Priority**: P0 | **Effort**: M | **Dependencies**: T1.9, T3.1

#### T4.1 Add "Quick Transcribe" to context menu
- [ ] Locate context menu creation code
- [ ] Add "Quick Transcribe with Gemini" menu item
- [ ] Add appropriate icon/emoji
- [ ] Position logically in menu
- [ ] Bind to handler method

**Acceptance Criteria**:
- Menu item appears in right-click menu
- Menu item is appropriately positioned
- Menu item triggers handler

**File**: `apps/desktop/src/gui_actions_file.py` (locate `_create_context_menu()` or similar)

---

#### T4.2 Implement transcribe_selected_file()
- [ ] Create handler method for transcribe action
- [ ] Get selected file info
- [ ] Validate file is audio format
- [ ] Check if transcription already exists (offer to re-transcribe)
- [ ] Check if Gemini API key is configured
- [ ] Delegate to TranscriptionManager
- [ ] Show toast notification

**Acceptance Criteria**:
- Method handles all edge cases
- Provides user feedback at each stage
- Integrates with TranscriptionManager
- Works asynchronously (doesn't block UI)

**Code Snippet**:
```python
def transcribe_selected_file(self):
    """Initiate transcription for selected file"""
    selected = self.file_tree.selection()
    if not selected:
        return

    file_iid = selected[0]
    file_info = next((f for f in self.displayed_files_details if f["name"] == file_iid), None)

    if not file_info:
        return

    # Check if API key configured
    if not self.config.get("gemini_api_key"):
        self._prompt_configure_api_key()
        return

    # Check if already transcribed
    if file_info.get("transcription_status") == TranscriptionStatus.COMPLETED:
        if not messagebox.askyesno("Re-transcribe?", "Transcription exists. Re-transcribe?"):
            return

    # Start transcription
    self.toast_manager.show_info(f"Transcription started: {file_info['name']}")
    self.run_async(
        self.transcription_manager.transcribe_file_async(
            audio_file_path=self._get_downloaded_file_path(file_info),
            file_info=file_info,
            on_status_change=self._on_transcription_status_change
        ),
        on_complete=lambda success: self._on_transcription_complete(file_info, success)
    )
```

---

#### T4.3 Implement _on_transcription_status_change()
- [ ] Create callback for status updates
- [ ] Update file metadata
- [ ] Update tree view column
- [ ] Show progress if applicable

**Acceptance Criteria**:
- Tree view updates in real-time
- File metadata stays in sync
- UI remains responsive

---

#### T4.4 Implement _on_transcription_complete()
- [ ] Create callback for transcription completion
- [ ] Show success/error toast
- [ ] Update file metadata
- [ ] Refresh tree view
- [ ] Handle errors

**Acceptance Criteria**:
- User receives appropriate feedback
- UI reflects final status
- Errors are logged

---

#### T4.5 Implement _prompt_configure_api_key()
- [ ] Create dialog to prompt user for API key
- [ ] Link to settings dialog
- [ ] Validate API key format
- [ ] Save to config

**Acceptance Criteria**:
- Dialog is user-friendly
- Links to settings work
- API key is validated

---

### T5. Modify EventHandlersMixin

**Priority**: P1 | **Effort**: S | **Dependencies**: T3.5, T4.1

#### T5.1 Implement _on_transcription_column_click()
- [x] Create handler for transcription column clicks
- [x] Determine which row and column was clicked
- [x] Get file info for clicked row
- [x] Check transcription status
- [x] Open transcription if completed
- [x] Show error details if failed
- [x] Do nothing for other statuses

**Acceptance Criteria**:
- Clicks on "completed" transcriptions open Notepad
- Clicks on "failed" show error dialog
- Clicks on other statuses are ignored
- Click detection is accurate

**File**: `apps/desktop/src/gui_event_handlers.py`

**Status**: ✅ COMPLETED

**Code Snippet**:
```python
def _on_transcription_column_click(self, event):
    """Handle clicks on transcription column"""
    region = self.file_tree.identify_region(event.x, event.y)
    if region != "cell":
        return

    column = self.file_tree.identify_column(event.x)
    if column != "#9":  # Transcription column index
        return

    row_id = self.file_tree.identify_row(event.y)
    if not row_id:
        return

    file_info = next((f for f in self.displayed_files_details if f["name"] == row_id), None)
    if not file_info:
        return

    status = file_info.get("transcription_status", TranscriptionStatus.NONE)

    if status == TranscriptionStatus.COMPLETED:
        self._open_transcription_for_file(file_info)
    elif status == TranscriptionStatus.FAILED:
        error_msg = file_info.get("transcription_error", "Unknown error")
        messagebox.showerror("Transcription Failed", f"Error: {error_msg}")
```

---

#### T5.2 Implement _open_transcription_for_file()
- [ ] Create method to open transcription
- [ ] Delegate to TranscriptionManager.open_transcription()
- [ ] Handle errors gracefully
- [ ] Show error message if file not found

**Acceptance Criteria**:
- Transcription opens in Notepad
- Errors are handled gracefully
- User receives feedback

---

## Phase 2: Configuration & Persistence

### T6. Update Configuration System

**Priority**: P1 | **Effort**: S | **Dependencies**: T1.1

#### T6.1 Add transcription config defaults
- [ ] Add transcription section to default config in `config_and_logger.py`
- [ ] Define default values for all settings
- [ ] Document each setting

**Acceptance Criteria**:
- Config includes all transcription settings
- Defaults are sensible
- Documentation is clear

**File**: `apps/desktop/src/config_and_logger.py`

**Code Addition**:
```python
"transcription": {
    "provider": "gemini",
    "model": "gemini-2.0-flash-exp",
    "auto_transcribe": False,
    "save_insights": True,
    "max_concurrent": 3,
    "retry_attempts": 2,
    "timeout_seconds": 300
}
```

---

#### T6.2 Implement config migration
- [ ] Create migration function for existing configs
- [ ] Add transcription defaults if missing
- [ ] Test with old config files
- [ ] Document migration process

**Acceptance Criteria**:
- Old configs are migrated automatically
- No data loss during migration
- Migration is logged

---

### T7. Update Settings Dialog

**Priority**: P2 | **Effort**: M | **Dependencies**: T6.1

#### T7.1 Add transcription settings section
- [ ] Locate settings dialog code
- [ ] Add "Transcription" tab or section
- [ ] Add provider dropdown
- [ ] Add model selection
- [ ] Add checkboxes for options
- [ ] Add max concurrent spinner

**Acceptance Criteria**:
- Settings UI is consistent with existing design
- All settings are configurable
- Changes are saved properly

**File**: `apps/desktop/src/settings_window.py`

---

#### T7.2 Implement settings validation
- [ ] Validate max_concurrent value (1-5)
- [ ] Validate timeout_seconds (60-600)
- [ ] Validate API key format (if applicable)
- [ ] Show validation errors

**Acceptance Criteria**:
- Invalid settings are rejected
- User receives clear error messages
- Validation doesn't block UI

---

## Phase 3: UI Polish & User Experience

### T8. Implement Toast Notifications

**Priority**: P1 | **Effort**: XS | **Dependencies**: T4.2

#### T8.1 Add transcription start notification
- [ ] Call toast_manager.show_info() when transcription starts
- [ ] Include filename in message
- [ ] Add appropriate icon

**Acceptance Criteria**:
- Notification is displayed
- Message is clear and concise
- Icon is appropriate

---

#### T8.2 Add transcription success notification
- [ ] Call toast_manager.show_success() when transcription completes
- [ ] Include filename in message
- [ ] Add "Click to view" hint if applicable
- [ ] Add appropriate icon

**Acceptance Criteria**:
- Notification is displayed
- Message is helpful
- Icon is appropriate

---

#### T8.3 Add transcription error notification
- [ ] Call toast_manager.show_error() when transcription fails
- [ ] Include error summary
- [ ] Suggest corrective action if possible
- [ ] Add appropriate icon

**Acceptance Criteria**:
- Notification is displayed
- Error message is actionable
- Icon is appropriate

---

### T9. Loading & Progress Indicators

**Priority**: P2 | **Effort**: S | **Dependencies**: T3.3

#### T9.1 Implement processing spinner
- [ ] Add animated spinner to "Processing..." status
- [ ] Update periodically during transcription
- [ ] Remove when complete

**Acceptance Criteria**:
- Spinner is visible and animates
- Performance impact is minimal
- Spinner stops when transcription ends

---

#### T9.2 Add progress percentage (optional)
- [ ] If Gemini API provides progress, display it
- [ ] Update transcription column with percentage
- [ ] Remove percentage when complete

**Acceptance Criteria**:
- Progress is accurate (if available)
- UI updates smoothly
- Doesn't break if progress unavailable

---

## Phase 4: Error Handling & Resilience

### T10. Implement Retry Logic

**Priority**: P1 | **Effort**: S | **Dependencies**: T1.9

#### T10.1 Add retry mechanism to transcribe_file_async()
- [ ] Implement exponential backoff
- [ ] Retry up to config.retry_attempts times
- [ ] Log each retry attempt
- [ ] Give up after max retries

**Acceptance Criteria**:
- Transient errors are retried
- Permanent errors fail immediately
- User is informed of retries

---

#### T10.2 Handle rate limiting (HTTP 429)
- [ ] Detect rate limit errors
- [ ] Wait for specified duration (from API headers)
- [ ] Retry after waiting
- [ ] Show user-friendly message

**Acceptance Criteria**:
- Rate limits are respected
- User is informed of delay
- Transcription succeeds after waiting

---

### T11. Handle Edge Cases

**Priority**: P1 | **Effort**: M | **Dependencies**: T1.9, T4.2

#### T11.1 Handle missing API key
- [ ] Check for API key before transcription
- [ ] Prompt user to configure if missing
- [ ] Link to settings dialog
- [ ] Prevent transcription without key

**Acceptance Criteria**:
- User is prompted appropriately
- Settings dialog opens correctly
- Transcription doesn't proceed without key

---

#### T11.2 Handle file not downloaded
- [ ] Check if file is downloaded before transcription
- [ ] Auto-download if not present
- [ ] Show download progress
- [ ] Proceed with transcription after download

**Acceptance Criteria**:
- Files are downloaded automatically
- User sees progress
- Transcription proceeds seamlessly

---

#### T11.3 Handle unsupported file formats
- [ ] Check file extension before transcription
- [ ] Show error for unsupported formats
- [ ] List supported formats
- [ ] Disable transcribe option for unsupported files

**Acceptance Criteria**:
- Only supported formats can be transcribed
- User receives clear error message
- Menu item is disabled for unsupported formats

---

#### T11.4 Handle disk space errors
- [ ] Check available disk space before saving transcription
- [ ] Show error if insufficient space
- [ ] Suggest cleanup actions
- [ ] Prevent data corruption

**Acceptance Criteria**:
- Disk space is checked
- User receives actionable error
- No corrupted files are created

---

#### T11.5 Handle network errors
- [ ] Detect network connectivity issues
- [ ] Show appropriate error message
- [ ] Offer to retry when connection restored
- [ ] Don't mark as failed immediately

**Acceptance Criteria**:
- Network errors are detected
- User understands the issue
- Retry option is available

---

## Phase 5: Testing

### T12. Unit Tests

**Priority**: P1 | **Effort**: M | **Dependencies**: T1.10, T2.2

#### T12.1 Test TranscriptionManager methods
- [ ] Test get_transcription_path()
- [ ] Test check_transcription_exists()
- [ ] Test get_transcription_status()
- [ ] Test save_transcription()
- [ ] Test open_transcription() (with mocking)
- [ ] Achieve 90%+ code coverage

**File**: `apps/desktop/tests/test_transcription_manager.py`

---

#### T12.2 Test metadata persistence
- [ ] Test saving metadata
- [ ] Test loading metadata
- [ ] Test migration
- [ ] Test corrupted data handling

**File**: `apps/desktop/tests/test_transcription_metadata.py`

---

#### T12.3 Test tree view integration
- [ ] Test column display
- [ ] Test status formatting
- [ ] Test click handling
- [ ] Mock tree view for isolation

**File**: `apps/desktop/tests/test_treeview_transcription.py`

---

### T13. Integration Tests

**Priority**: P1 | **Effort**: L | **Dependencies**: T12.1, T12.2

#### T13.1 Test end-to-end transcription flow
- [ ] Test full workflow: select file → transcribe → open
- [ ] Use mock API for Gemini
- [ ] Verify file creation
- [ ] Verify UI updates

**File**: `apps/desktop/tests/test_transcription_integration.py`

---

#### T13.2 Test error scenarios
- [ ] Test API errors
- [ ] Test network errors
- [ ] Test disk full errors
- [ ] Test invalid API key
- [ ] Verify error handling

---

#### T13.3 Test concurrent transcriptions
- [ ] Test multiple simultaneous transcriptions
- [ ] Verify max concurrent limit
- [ ] Test queueing behavior
- [ ] Verify all complete successfully

---

### T14. Manual Testing

**Priority**: P1 | **Effort**: S | **Dependencies**: All above

#### T14.1 Create manual test checklist
- [ ] Document all test cases
- [ ] Create test data (sample audio files)
- [ ] Define expected results
- [ ] Assign test execution

**File**: `docs/transcription-feature/manual-test-plan.md`

---

#### T14.2 Execute manual tests
- [ ] Test on clean install
- [ ] Test with existing data
- [ ] Test all user workflows
- [ ] Document bugs/issues

---

## Phase 6: Documentation

### T15. Code Documentation

**Priority**: P2 | **Effort**: S | **Dependencies**: All code complete

#### T15.1 Add docstrings to all new methods
- [ ] TranscriptionManager methods
- [ ] Modified GUI methods
- [ ] Follow Google docstring format
- [ ] Include examples where helpful

---

#### T15.2 Add inline comments for complex logic
- [ ] Transcription workflow
- [ ] Retry logic
- [ ] Concurrency management
- [ ] Error handling

---

### T16. User Documentation

**Priority**: P2 | **Effort**: S | **Dependencies**: Feature complete

#### T16.1 Create user guide
- [ ] How to configure Gemini API key
- [ ] How to transcribe a recording
- [ ] How to view transcription
- [ ] Troubleshooting common issues

**File**: `docs/user-guide/transcription.md`

---

#### T16.2 Update README
- [ ] Add transcription feature to feature list
- [ ] Update screenshots if applicable
- [ ] Add link to user guide

**File**: `README.md`

---

## Phase 7: Polish & Optimization

### T17. Performance Optimization

**Priority**: P3 | **Effort**: S | **Dependencies**: All above

#### T17.1 Profile transcription workflow
- [ ] Measure time for each operation
- [ ] Identify bottlenecks
- [ ] Optimize critical paths

---

#### T17.2 Optimize tree view updates
- [ ] Minimize redraws during status updates
- [ ] Batch updates if possible
- [ ] Profile UI responsiveness

---

### T18. Accessibility

**Priority**: P3 | **Effort**: XS | **Dependencies**: UI complete

#### T18.1 Add keyboard shortcuts
- [ ] Add shortcut for "Quick Transcribe" (e.g., Ctrl+T)
- [ ] Add to menu bar if applicable
- [ ] Document in help

---

#### T18.2 Improve screen reader support
- [ ] Add ARIA labels to transcription column
- [ ] Announce status changes
- [ ] Test with screen reader

---

## Phase 8: Deployment

### T19. Pre-Release

**Priority**: P0 | **Effort**: XS | **Dependencies**: All above

#### T19.1 Final code review
- [ ] Review all changes
- [ ] Check for code smells
- [ ] Verify adherence to patterns
- [ ] Get team approval

---

#### T19.2 Final testing
- [ ] Run full test suite
- [ ] Execute manual tests
- [ ] Test on different environments
- [ ] Verify no regressions

---

### T20. Release

**Priority**: P0 | **Effort**: XS | **Dependencies**: T19.2

#### T20.1 Create release branch
- [ ] Branch from main
- [ ] Tag with version number
- [ ] Update CHANGELOG.md

---

#### T20.2 Deploy to users
- [ ] Build distribution
- [ ] Test installation
- [ ] Publish release
- [ ] Announce to users

---

## Summary

**Total Tasks**: 80+
**Estimated Effort**: ~120-150 hours
**Recommended Team Size**: 1-2 developers
**Timeline**: 3-4 weeks (with testing & polish)

### Critical Path

1. T1 (TranscriptionManager) → T3 (TreeView) → T4 (FileActions) → T13 (Integration Tests) → T19/T20 (Release)

### Parallel Workstreams

- **Stream 1**: Core infrastructure (T1, T2)
- **Stream 2**: UI integration (T3, T4, T5)
- **Stream 3**: Configuration (T6, T7)
- **Stream 4**: Testing (T12, T13, T14)

### Risk Mitigation

- Start with P0 tasks
- Implement stub methods early for integration
- Test incrementally (don't wait until the end)
- Use feature flags to hide incomplete features
- Keep main branch stable with feature branches
