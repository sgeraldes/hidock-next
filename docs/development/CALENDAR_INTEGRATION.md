# Calendar Integration System Documentation

## Overview

The HiDock Desktop Application features comprehensive calendar integration with Microsoft Outlook, providing automatic meeting detection and association for audio recordings. This system enhances the user experience by automatically matching recordings with calendar meetings based on time correlation.

## ⚠️ **Platform Compatibility**

**🪟 Windows Only**: Calendar integration currently works only on Windows using the Outlook COM API.

- ✅ **Windows**: Full Outlook COM integration
- ❌ **macOS**: Not available (EventKit integration planned)
- ❌ **Linux**: Not available (cross-platform solution planned)

## Recent Improvements (August 2025)

### Major Fixes and Enhancements

#### 1. Force Refresh Calendar - Complete Fix
- **Problem**: Force refresh was clearing meeting data but not repopulating it properly
- **Solution**: 
  - Fixed missing file list passing to refresh function
  - Implemented proper cache clearing and repopulation
  - Added force refresh mode flag to prevent "Syncing..." during refresh
  - Files without meetings now correctly show empty string

#### 2. Visual Feedback System
- **Added Visual Overlays**:
  - Semi-transparent overlay during Force Refresh operations
  - Custom overlay for "Check Selected Files for Meetings"
  - Real-time progress indicators showing current file being processed
  - Animated activity dots to show active processing

#### 3. Date Filtering Fix for Recurring Meetings
- **Problem**: Recurring meetings weren't being filtered correctly by date range
- **Solution**:
  - Fixed `IncludeRecurrences` placement in Outlook COM queries
  - Implemented day-by-day approach for short date ranges (≤14 days)
  - Fixed date format handling for different locales
  - Prevented max integer overflow when filtering with recurrences

#### 4. Check Selected Files - Now Actually Live
- **Problem**: Was using cached data instead of querying Outlook directly
- **Solution**:
  - Clear internal cache before processing
  - Direct COM queries for each selected file
  - Visual progress for each file being checked
  - Proper error handling per file

## Architecture

### Core Components

```
┌─────────────────────────────────────────────────────────┐
│                    GUI Layer                            │
│  ┌─────────────────────────────────────────────────┐   │
│  │         gui_main_window.py                      │   │
│  │  - Force Refresh Calendar                       │   │
│  │  - Check Selected Files                         │   │
│  │  - Visual Overlays                              │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                 Async Calendar Layer                    │
│  ┌─────────────────────────────────────────────────┐   │
│  │         AsyncCalendarMixin                      │   │
│  │  - Background worker thread                     │   │
│  │  - Batch processing                             │   │
│  │  - Chunk-based queries                          │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                  Cache Layer                            │
│  ┌─────────────────────────────────────────────────┐   │
│  │         CalendarCacheManager                    │   │
│  │  - SQLite database (~/.hidock/calendar_cache.db)│   │
│  │  - Meeting cache with expiry                    │   │
│  │  - File-meeting mappings                        │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│              Outlook Integration Layer                  │
│  ┌─────────────────────────────────────────────────┐   │
│  │         SimpleOutlookIntegration                │   │
│  │  - COM interface to Outlook                     │   │
│  │  - Date range queries                           │   │
│  │  - Meeting matching algorithms                  │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### File Structure

- **`gui_main_window.py`** - Main GUI with calendar menu items and overlays
- **`async_calendar_mixin.py`** - Async calendar operations with worker thread
- **`calendar_cache_manager.py`** - SQLite cache for meeting data
- **`simple_outlook_integration.py`** - Direct Outlook COM interface
- **Database**: `~/.hidock/calendar_cache.db`

## User Features

### Force Refresh Calendar

Located in View menu, this feature:
1. Shows full-screen overlay with progress
2. Clears entire calendar cache
3. Re-queries Outlook for all displayed files
4. Updates Meeting column with fresh data
5. Shows summary of files with meetings found

**Visual Feedback**:
- Overlay with "Refreshing Calendar Data" title
- Animated progress dots
- File count being processed
- Status bar updates
- Success dialog with statistics

### Check Selected Files for Meetings

Right-click context menu option that:
1. Shows overlay for selected files only
2. Queries Outlook directly (bypasses cache)
3. Shows real-time progress per file
4. Updates only selected files in TreeView

**Visual Feedback**:
- Overlay with "Checking Selected Files for Meetings"
- File-by-file progress display
- Individual file status updates
- Success dialog with match count

### Meeting Column Display

The Meeting column shows information in this priority:
1. **Processing Status** - "Transcribing...", "Analyzing...", etc.
2. **User Title** - If user has set custom title (audio metadata)
3. **Calendar Meeting** - Subject from matched Outlook meeting
4. **Empty String** - No meeting found (shows blank, not "No Meeting")

## Technical Details

### Date Range Filtering

The system uses different approaches based on date range:
- **≤14 days**: Day-by-day queries for accuracy with recurring meetings
- **>14 days**: Bulk query with post-processing

### Recurring Meeting Handling

```python
# Correct order for recurring meetings
appointments = calendar.Items
appointments.IncludeRecurrences = True  # Must be BEFORE Sort
appointments.Sort("[Start]")
filtered = appointments.Restrict(filter_string)
```

### Cache Management

#### Cache Expiry
- Meeting cache: 24 hours (configurable)
- File-meeting mappings: Permanent until force refresh

#### Force Refresh Process
1. Set `_force_refresh_mode = True` flag
2. Clear all cache tables
3. Refresh Outlook connection
4. Re-process all displayed files
5. Clear force refresh flag

### Status Management

#### Preventing "Syncing..." Persistence
- Force refresh mode flag prevents sync status display
- Callback explicitly clears any remaining status
- 2-second auto-clear timer as fallback
- Empty string for no-meeting files (not "Syncing...")

## Configuration

### Settings (hidock_config.json)

```json
{
  "calendar_integration_enabled": true,
  "calendar_chunking_period": "1 Week",
  "calendar_cache_expiry_hours": 24,
  "calendar_sync_on_startup": true
}
```

### Chunking Periods
- **1 Day**: Daily chunks for high-frequency meetings
- **1 Week**: Default, good balance
- **2 Weeks**: Bi-weekly for less frequent meetings
- **1 Month**: Monthly chunks for sparse calendars

## Troubleshooting

### Common Issues and Solutions

#### "Syncing..." Stuck After Refresh
- **Fixed**: Force refresh now properly clears status
- **Fallback**: Restart app if issue persists

#### No Meetings Found
1. Ensure Outlook is running
2. Check calendar permissions
3. Try Force Refresh Calendar
4. Verify date/time on recordings

#### Slow Performance
- Reduce calendar chunking period
- Clear cache regularly
- Check Outlook responsiveness

#### Wrong Meetings Matched
- Adjust tolerance in settings
- Check recording timestamps
- Verify timezone settings

### Diagnostic Tools

The following diagnostic scripts are available in `hidock-desktop-app/`:

- `check_calendar_date.py` - Check specific date for meetings
- `check_calendar_cache.py` - Inspect cache database
- `diagnose_calendar_date.py` - Comprehensive date diagnosis
- `check_meeting_times.py` - Verify meeting time matching
- `test_date_formats.py` - Test Outlook date filtering

## Best Practices

### Performance Optimization
1. Use appropriate chunking period for your calendar density
2. Enable cache for better performance
3. Force refresh only when necessary
4. Process files in batches

### User Experience
1. Always show visual feedback during operations
2. Clear status messages after operations
3. Provide meaningful error messages
4. Show operation statistics in dialogs

### Development Guidelines
1. Always clear force refresh flag after operation
2. Handle all error cases with proper cleanup
3. Use debug logging for troubleshooting
4. Test with various calendar configurations

## API Reference

### AsyncCalendarMixin Methods

```python
# Force refresh with callback
refresh_calendar_data_async(callback=None, current_files=None) -> bool

# Enhance files with calendar data
enhance_files_with_meeting_data_sync(files: List[Dict]) -> List[Dict]

# Get cache statistics
get_calendar_cache_statistics() -> Dict[str, Any]
```

### SimpleOutlookIntegration Methods

```python
# Get meetings for specific date
get_meetings_for_date(target_date: datetime) -> List[SimpleMeeting]

# Get meetings for date range
get_meetings_for_date_range(start_date: datetime, end_date: datetime) -> List[SimpleMeeting]

# Find meeting for recording time
find_meeting_for_recording(recording_time: datetime, tolerance_minutes: int = 15) -> Optional[SimpleMeeting]

# Refresh calendar connection
refresh_calendar_data() -> bool
```

## Future Enhancements

### Planned Features
1. Support for multiple calendar sources (Google, Office 365 web)
2. Manual meeting association UI
3. Bulk meeting assignment tool
4. Calendar preview in tooltip
5. Meeting details sidebar
6. Export meeting summaries

### Under Consideration
- iCalendar (.ics) file import
- Exchange Web Services support
- CalDAV protocol support
- Meeting recording reminders
- Automatic meeting notes generation

## Related Documentation

- [Audio Metadata System](./AUDIO_METADATA_SYSTEM.md)
- [GUI Architecture](./GUI_ARCHITECTURE.md)
- [Testing Guide](../testing/TESTING_GUIDE.md)
- [Configuration Guide](../SETUP.md)