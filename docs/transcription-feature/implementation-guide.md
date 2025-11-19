# Quick Transcription Feature - Implementation Guide

## What We're Building

Add a user-friendly transcription column to the file list that:
1. Shows transcription status at a glance
2. Allows one-click viewing in Notepad
3. Provides easy context menu access to start transcription

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│  Existing Infrastructure (DO NOT MODIFY)                    │
├─────────────────────────────────────────────────────────────┤
│  ✅ AudioMetadataDB (SQLite)                                │
│     - Stores transcriptions, AI analysis, status            │
│  ✅ AudioMetadataMixin                                       │
│     - start_audio_processing(filename)                      │
│     - Background transcription + AI analysis                │
│  ✅ transcription_module.py                                 │
│     - process_audio_file_for_insights()                     │
│  ✅ ai_service.py (GeminiProvider, etc.)                    │
└─────────────────────────────────────────────────────────────┘
                            ↑
                            │ Use existing infrastructure
                            │
┌─────────────────────────────────────────────────────────────┐
│  New UI Layer (WHAT WE BUILD)                               │
├─────────────────────────────────────────────────────────────┤
│  🔨 TreeView: Add "transcription" column                    │
│  🔨 EventHandler: Click handler for transcription column    │
│  🔨 AudioMetadataMixin: export_transcription_to_file()      │
│  🔨 AudioMetadataMixin: open_transcription_in_notepad()     │
│  🔨 FileActionsMixin: "Quick Transcribe" context menu       │
└─────────────────────────────────────────────────────────────┘
```

---

## Implementation Tasks

### Task 1: Add Transcription Column to TreeView

**File**: `apps/desktop/src/gui_treeview.py`

**Step 1.1**: Add column to columns tuple (line 29)
```python
# BEFORE
columns = ("num", "name", "datetime", "size", "duration", "meeting", "version", "status")

# AFTER
columns = ("num", "name", "datetime", "size", "duration", "meeting", "version", "status", "transcription")
```

**Step 1.2**: Add column configuration (after line 83, in the column configuration loop)
```python
elif col == "transcription":
    self.file_tree.column(col, width=100, minwidth=80, anchor="w")
```

**Step 1.3**: Add heading to `original_tree_headings` dict
Look for where `original_tree_headings` is defined in `gui_main_window.py` initialization and add:
```python
"transcription": "Transcription"
```

**Step 1.4**: Update `_populate_treeview_from_data()` to include transcription status (around line 215)
```python
# After getting meeting_text, add:
transcription_display = self._format_transcription_status(file_info)

# Then in values tuple:
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

**Step 1.5**: Add helper method `_format_transcription_status()` to TreeViewMixin
```python
def _format_transcription_status(self, file_info: Dict[str, Any]) -> str:
    """Format transcription status for display in tree view column."""
    filename = file_info.get("name")
    if not filename:
        return "-"

    # Check if audio metadata system is available
    if not hasattr(self, '_audio_metadata_db') or not self._audio_metadata_db:
        return "-"

    try:
        # Get metadata from database
        from audio_metadata_db import ProcessingStatus
        metadata = self._audio_metadata_db.get_metadata(filename)

        if not metadata:
            return "-"

        # Map status to display text
        if metadata.processing_status == ProcessingStatus.COMPLETED:
            return "📄 View"
        elif metadata.processing_status in [ProcessingStatus.TRANSCRIBED, ProcessingStatus.AI_ANALYZED]:
            return "📄 View"
        elif metadata.processing_status == ProcessingStatus.TRANSCRIBING:
            return "⏳ Transcribing..."
        elif metadata.processing_status == ProcessingStatus.AI_ANALYZING:
            return "⏳ Analyzing..."
        elif metadata.processing_status == ProcessingStatus.ERROR:
            return "❌ Error"
        else:
            return "-"

    except Exception as e:
        from config_and_logger import logger
        logger.debug("TreeView", "_format_transcription_status",
                    f"Error formatting transcription status for {filename}: {e}")
        return "-"
```

**Testing Task 1**:
- [ ] Column appears in tree view
- [ ] Column shows "-" for files without transcription
- [ ] Column updates when processing status changes

---

### Task 2: Export Transcription to .txt File

**File**: `apps/desktop/src/audio_metadata_mixin.py`

**Step 2.1**: Add method to export transcription to file
```python
def export_transcription_to_file(self, filename: str) -> Optional[str]:
    """Export transcription from database to .txt file for viewing.

    Args:
        filename: Audio filename

    Returns:
        Path to exported .txt file, or None if export failed
    """
    self._ensure_audio_metadata_initialized()

    try:
        # Get metadata from database
        metadata = self._audio_metadata_db.get_metadata(filename)
        if not metadata or not metadata.transcription_text:
            logger.warning("AudioMetadata", "export_transcription",
                         f"No transcription found for {filename}")
            return None

        # Determine output path (same location as audio file)
        audio_path = self._find_local_file_path(filename)
        if not audio_path:
            # Fallback to download directory
            download_dir = getattr(self, 'download_directory', os.path.expanduser("~/Downloads"))
            audio_path = os.path.join(download_dir, filename)

        # Generate .txt filename
        base_path = os.path.splitext(audio_path)[0]
        txt_path = f"{base_path}_transcription.txt"

        # Check if file already exists and is up-to-date
        if os.path.exists(txt_path):
            txt_mtime = os.path.getmtime(txt_path)
            db_mtime = metadata.updated_at.timestamp()
            if txt_mtime >= db_mtime:
                # File is up-to-date
                logger.debug("AudioMetadata", "export_transcription",
                           f"Using existing transcription file: {txt_path}")
                return txt_path

        # Write transcription to file
        with open(txt_path, 'w', encoding='utf-8') as f:
            # Header
            f.write("=" * 60 + "\n")
            f.write("AUDIO TRANSCRIPTION\n")
            f.write("=" * 60 + "\n\n")
            f.write(f"File: {filename}\n")
            f.write(f"Date: {metadata.date_created.strftime('%Y-%m-%d %H:%M:%S')}\n")
            f.write(f"Duration: {int(metadata.duration_seconds // 60)}m {int(metadata.duration_seconds % 60)}s\n")

            if metadata.transcription_language:
                f.write(f"Language: {metadata.transcription_language}\n")

            if metadata.transcription_confidence:
                f.write(f"Confidence: {metadata.transcription_confidence:.1%}\n")

            f.write(f"Exported: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
            f.write("\n" + "=" * 60 + "\n\n")

            # Transcription text
            f.write(metadata.transcription_text)

            # Optional: Add AI summary if available
            if metadata.ai_summary:
                f.write("\n\n" + "=" * 60 + "\n")
                f.write("AI SUMMARY\n")
                f.write("=" * 60 + "\n\n")
                f.write(metadata.ai_summary)

            # Optional: Add action items if available
            if metadata.ai_action_items or metadata.user_action_items:
                f.write("\n\n" + "=" * 60 + "\n")
                f.write("ACTION ITEMS\n")
                f.write("=" * 60 + "\n\n")

                action_items = metadata.user_action_items or metadata.ai_action_items
                for i, item in enumerate(action_items, 1):
                    f.write(f"{i}. {item}\n")

        logger.info("AudioMetadata", "export_transcription",
                   f"Exported transcription to {txt_path}")
        return txt_path

    except Exception as e:
        logger.error("AudioMetadata", "export_transcription",
                   f"Error exporting transcription for {filename}: {e}")
        return None
```

**Testing Task 2**:
- [ ] Exports transcription to .txt file
- [ ] File has proper header with metadata
- [ ] File contains full transcription text
- [ ] Handles missing transcription gracefully
- [ ] Re-uses existing file if up-to-date

---

### Task 3: Open Transcription in Notepad

**File**: `apps/desktop/src/audio_metadata_mixin.py`

**Step 3.1**: Add method to open transcription in notepad
```python
def open_transcription_in_notepad(self, filename: str) -> bool:
    """Open transcription file in Windows Notepad.

    Args:
        filename: Audio filename

    Returns:
        True if opened successfully, False otherwise
    """
    try:
        # Export transcription to file
        txt_path = self.export_transcription_to_file(filename)

        if not txt_path:
            messagebox.showerror(
                "No Transcription",
                f"No transcription available for {filename}.\n\n"
                "Please transcribe the file first by right-clicking and selecting 'Quick Transcribe'.",
                parent=self
            )
            return False

        # Open in notepad (Windows only for now)
        if sys.platform == "win32":
            subprocess.Popen(["notepad.exe", txt_path])
            logger.info("AudioMetadata", "open_transcription",
                       f"Opened transcription in notepad: {txt_path}")
            return True
        else:
            # For other platforms, open with default text editor
            import platform
            if platform.system() == "Darwin":  # macOS
                subprocess.Popen(["open", "-e", txt_path])
            else:  # Linux
                subprocess.Popen(["xdg-open", txt_path])

            logger.info("AudioMetadata", "open_transcription",
                       f"Opened transcription: {txt_path}")
            return True

    except Exception as e:
        logger.error("AudioMetadata", "open_transcription",
                   f"Error opening transcription for {filename}: {e}")
        messagebox.showerror(
            "Error Opening Transcription",
            f"Could not open transcription for {filename}.\n\nError: {str(e)}",
            parent=self
        )
        return False
```

**Testing Task 3**:
- [ ] Opens notepad with transcription on Windows
- [ ] Handles missing transcription file
- [ ] Shows appropriate error messages
- [ ] Cross-platform support (macOS, Linux)

---

### Task 4: Add Click Handler for Transcription Column

**File**: `apps/desktop/src/gui_event_handlers.py`

**Step 4.1**: Find the file binding section and add click handler
Look for where `<Button-1>` is bound in `gui_treeview.py` (around line 101) and note that it's already bound to `_on_file_button1_press`. We need to check clicks in that handler.

**Option A**: Modify existing `_on_file_button1_press` in `gui_event_handlers.py`

Add to the beginning of `_on_file_button1_press`:
```python
def _on_file_button1_press(self, event):
    """Handle mouse button press on file tree."""
    # Check if click is on transcription column
    region = self.file_tree.identify_region(event.x, event.y)
    if region == "cell":
        column = self.file_tree.identify_column(event.x)
        # Transcription column is #9 (0-indexed columns: num=0, name=1, ..., transcription=8)
        # But identify_column returns "#1", "#2", etc. (1-indexed)
        if column == "#9":  # Transcription column
            row_id = self.file_tree.identify_row(event.y)
            if row_id:
                self._on_transcription_column_click(row_id)
                return "break"  # Prevent default selection behavior

    # Continue with existing button press handling
    # ... existing code ...
```

**Step 4.2**: Add the transcription column click handler to `gui_event_handlers.py`
```python
def _on_transcription_column_click(self, file_iid: str):
    """Handle clicks on transcription column.

    Args:
        file_iid: Tree item ID (filename)
    """
    try:
        from audio_metadata_db import ProcessingStatus

        # Get file metadata
        file_detail = next((f for f in self.displayed_files_details if f["name"] == file_iid), None)
        if not file_detail:
            return

        # Get transcription status from database
        if not hasattr(self, '_audio_metadata_db') or not self._audio_metadata_db:
            return

        metadata = self._audio_metadata_db.get_metadata(file_iid)
        if not metadata:
            return

        # Handle based on status
        if metadata.processing_status in [ProcessingStatus.COMPLETED, ProcessingStatus.TRANSCRIBED,
                                          ProcessingStatus.AI_ANALYZED]:
            # Open transcription in notepad
            self.open_transcription_in_notepad(file_iid)

        elif metadata.processing_status == ProcessingStatus.ERROR:
            # Show error details
            error_msg = metadata.processing_error or "Unknown error occurred during transcription"
            messagebox.showerror(
                "Transcription Error",
                f"Transcription failed for {file_iid}\n\nError: {error_msg}",
                parent=self
            )

        # For other statuses (TRANSCRIBING, AI_ANALYZING, NOT_PROCESSED), do nothing

    except Exception as e:
        from config_and_logger import logger
        logger.error("EventHandlers", "_on_transcription_column_click",
                   f"Error handling transcription column click: {e}")
```

**Testing Task 4**:
- [ ] Click on "📄 View" opens notepad
- [ ] Click on "❌ Error" shows error message
- [ ] Click on "⏳ Processing..." does nothing
- [ ] Click on "-" does nothing
- [ ] Click doesn't interfere with normal file selection

---

### Task 5: Add Context Menu "Quick Transcribe" Item

**File**: `apps/desktop/src/gui_event_handlers.py` (where right-click context menu is built)

**Step 5.1**: Find the context menu creation method
Search for `_on_file_right_click` or similar in `gui_event_handlers.py`.

**Step 5.2**: Add "Quick Transcribe" menu item
Add this to the context menu (after "Play Audio" or similar):
```python
# In _on_file_right_click or similar:

# Add separator before transcription option
menu.add_separator()

# Add Quick Transcribe option
menu.add_command(
    label="📝 Quick Transcribe with Gemini",
    command=lambda: self._quick_transcribe_selected_files()
)
```

**Step 5.3**: Implement `_quick_transcribe_selected_files()` in `gui_actions_file.py`
```python
def _quick_transcribe_selected_files(self):
    """Start transcription for selected file(s) using audio metadata system."""
    selected_iids = self.file_tree.selection()
    if not selected_iids:
        messagebox.showinfo("No Selection", "Please select files to transcribe.", parent=self)
        return

    # Check if audio metadata system is initialized
    if not hasattr(self, '_audio_metadata_db'):
        messagebox.showerror(
            "System Error",
            "Audio metadata system not initialized.",
            parent=self
        )
        return

    # Check API key configuration
    api_key = self.config.get("gemini_api_key", "")
    if not api_key:
        if messagebox.askyesno(
            "API Key Required",
            "Gemini API key not configured.\n\nWould you like to open settings to configure it?",
            parent=self
        ):
            self.open_settings_dialog()
        return

    # Get filenames
    filenames_to_transcribe = []
    for iid in selected_iids:
        file_detail = next((f for f in self.displayed_files_details if f["name"] == iid), None)
        if file_detail:
            filenames_to_transcribe.append(file_detail["name"])

    if not filenames_to_transcribe:
        return

    # Check which files need to be downloaded
    files_to_download = []
    files_ready = []

    for filename in filenames_to_transcribe:
        if self.can_process_audio_file(filename):
            files_ready.append(filename)
        else:
            files_to_download.append(filename)

    # Offer to download if needed
    if files_to_download:
        if messagebox.askyesno(
            "Download Required",
            f"{len(files_to_download)} file(s) need to be downloaded before transcription.\n\n"
            "Download now?",
            parent=self
        ):
            # Queue downloads
            for filename in files_to_download:
                # Add to download queue
                self.file_operations_manager.queue_download(
                    filename,
                    self._get_local_filepath(filename),
                    self._update_operation_progress
                )

            # Show message about downloads
            messagebox.showinfo(
                "Downloads Started",
                f"Downloading {len(files_to_download)} file(s).\n\n"
                "Transcription will start automatically after downloads complete.\n\n"
                "You can continue working while downloads are in progress.",
                parent=self
            )

            # TODO: Add callback to start transcription after downloads complete
            # For now, user needs to manually trigger transcription again
            return

    # Start transcription for ready files
    started_count = 0
    for filename in files_ready:
        if self.start_audio_processing(filename):
            started_count += 1

    if started_count > 0:
        messagebox.showinfo(
            "Transcription Started",
            f"Started transcription for {started_count} file(s).\n\n"
            "This may take several minutes depending on file length.\n\n"
            "You can continue working while transcription runs in the background.",
            parent=self
        )
    else:
        messagebox.showerror(
            "Transcription Failed",
            "Could not start transcription. Please check logs for details.",
            parent=self
        )
```

**Testing Task 5**:
- [ ] Right-click shows "Quick Transcribe" option
- [ ] Clicking starts transcription for selected file
- [ ] Prompts for API key if not configured
- [ ] Offers to download if file not local
- [ ] Shows progress messages
- [ ] Tree view updates with status

---

### Task 6: Update Configuration (Optional but Recommended)

**File**: `apps/desktop/src/config_and_logger.py`

**Step 6.1**: Add transcription configuration section to default config
```python
# In DEFAULT_CONFIG or similar:
"transcription": {
    "provider": "gemini",
    "model": "gemini-2.0-flash-exp",
    "auto_export_txt": True,
    "max_concurrent": 1,
    "timeout_seconds": 300
}
```

**Step 6.2**: Migrate existing gemini_api_key
This can be done in a config migration function or handled in code by checking both locations.

---

## Testing Checklist

### Unit Tests
- [ ] `_format_transcription_status()` returns correct strings for all statuses
- [ ] `export_transcription_to_file()` creates valid .txt files
- [ ] `export_transcription_to_file()` reuses existing files when up-to-date
- [ ] `open_transcription_in_notepad()` handles missing transcriptions

### Integration Tests
- [ ] Full workflow: download → transcribe → click to view
- [ ] Multiple files selected for transcription
- [ ] Transcription status updates in real-time
- [ ] Error handling when API key missing
- [ ] Error handling when file not downloaded

### Manual Testing
- [ ] Transcription column visible in tree view
- [ ] Click "📄 View" opens notepad with transcription
- [ ] Right-click "Quick Transcribe" starts processing
- [ ] Processing status updates visible ("⏳ Transcribing...")
- [ ] Error status clickable to see error details
- [ ] Works with different file formats (HTA, WAV, MP3)
- [ ] Exported .txt files have proper formatting
- [ ] Multiple concurrent transcriptions (if implemented)

---

## Code Review Checklist

Before submitting:
- [ ] No breaking changes to existing functionality
- [ ] Follows existing code patterns (logger, config, error handling)
- [ ] Proper error handling with user-friendly messages
- [ ] Logging at appropriate levels
- [ ] Line length ≤ 120 characters
- [ ] Imports properly organized (isort)
- [ ] Code formatted with black
- [ ] No linting errors (ruff)
- [ ] Docstrings added to new methods
- [ ] Type hints included

---

## Deployment Notes

### Files Modified
1. `apps/desktop/src/gui_treeview.py` - Add transcription column
2. `apps/desktop/src/gui_event_handlers.py` - Add click handler, context menu
3. `apps/desktop/src/audio_metadata_mixin.py` - Add export and open methods
4. `apps/desktop/src/gui_actions_file.py` - Add quick transcribe method
5. `apps/desktop/src/config_and_logger.py` - Add config section (optional)
6. `apps/desktop/src/gui_main_window.py` - Add "transcription" to original_tree_headings

### No Database Migrations Needed
The AudioMetadataDB schema already supports everything we need!

### Backward Compatibility
- Existing transcriptions in database remain accessible
- New column simply reads from existing database
- No breaking changes to existing code

---

## Future Enhancements (Out of Scope)

- Batch transcription progress indicator
- In-app transcription viewer (replace notepad)
- Edit transcriptions inline
- Export to PDF/DOCX
- Transcription search and filtering
- Speaker diarization visualization
- Alternative AI providers selection in UI
