# HiDock Calendar Integration Plan

## Overview
Integrate Microsoft Outlook calendar functionality to automatically match meeting information with audio recordings based on timestamps.

## Integration Options Analysis

### 1. Microsoft Outlook Desktop (COM Interface) - RECOMMENDED
- **What it is**: Direct integration with locally installed Outlook via Windows COM
- **Requirements**: Outlook desktop app installed and configured
- **Pros**: 
  - Most reliable and fast
  - Works with all Outlook account types (Exchange, O365, IMAP)
  - No additional authentication needed (uses existing Outlook session)
  - Can access all calendar data Outlook has access to
- **Cons**: Windows-only, requires Outlook to be installed
- **Implementation**: Already partially implemented in `simple_outlook_integration.py`

### 2. Microsoft Graph API (O365/Azure)
- **What it is**: Direct API access to Microsoft 365 calendar
- **Requirements**: User credentials + app registration in Azure
- **Pros**: 
  - Works without Outlook installed
  - Cross-platform
  - Direct O365 access
- **Cons**: 
  - Requires complex OAuth2 setup
  - Only works with O365/Exchange Online
  - User must provide credentials

### 3. Exchange Web Services (EWS)
- **What it is**: SOAP-based API for Exchange servers
- **Requirements**: Exchange server access + credentials
- **Pros**: Works with on-premises Exchange
- **Cons**: 
  - Being deprecated by Microsoft
  - Complex authentication
  - Limited future support

## RECOMMENDED SOLUTION: Enhanced Outlook COM Integration

### Phase 1: Improve Current COM Integration
1. **Fix existing `simple_outlook_integration.py`**:
   - Better error handling when Outlook is not running
   - Automatic Outlook startup if needed
   - Support for multiple Outlook profiles
   - Better date/time matching logic

2. **Add GUI calendar status indicator**:
   - Show "Calendar: Connected" or "Calendar: Not Available"
   - Display last sync time
   - Show number of meetings found for today

3. **Enhanced meeting matching**:
   - Match by timestamp overlap (not just exact times)
   - Support for recurring meetings
   - Handle time zones properly
   - Match by meeting location if available

### Phase 2: Add Graph API as Fallback (Optional)
- Only if COM fails and user specifically requests it
- Require user to provide O365 credentials
- Store credentials securely (encrypted)

### Phase 3: Advanced Features (Future)
- Meeting participant information
- Meeting notes/agenda integration
- Automatic meeting categorization
- Meeting summary generation using AI

## Implementation Plan

### Step 1: Fix Current COM Integration (Immediate)
```python
# Enhance simple_outlook_integration.py
class OutlookIntegration:
    def __init__(self):
        self.outlook_app = None
        self.is_available = False
        self.last_error = None
        
    def initialize(self):
        # Try to connect to existing Outlook instance
        # If not running, try to start it
        # Handle multiple profiles
        
    def get_events_for_date_range(self, start_date, end_date):
        # Get calendar events with better filtering
        # Handle recurring events
        # Return structured event data
        
    def find_meeting_for_timestamp(self, timestamp, tolerance_minutes=15):
        # Find meeting that overlaps with given timestamp
        # Return meeting details or None
```

### Step 2: Update GUI Integration (Immediate)
```python
# In gui_main_window.py
1. Add calendar status indicator to status bar
2. Add meeting column to file list (already planned)
3. Show meeting info in file details
4. Add calendar sync button/menu item
```

### Step 3: Enhanced Meeting Data Display (Immediate)
- Meeting subject
- Meeting organizer
- Meeting location
- Meeting duration
- Attendee count

### Step 4: Settings Integration (Immediate)
- Enable/disable calendar integration
- Set matching tolerance (minutes)
- Choose which calendars to include
- Refresh interval settings

## User Experience Flow

### First Time Setup:
1. User opens HiDock application
2. Calendar integration automatically detects if Outlook is available
3. Status bar shows "Calendar: Connected" or "Calendar: Not Available"
4. If available, calendar data is automatically integrated

### Daily Usage:
1. User connects HiDock device
2. Files are loaded and automatically enhanced with meeting info
3. File list shows meeting subjects in new "Meeting" column
4. User can see which recordings correspond to which meetings

### No Additional User Input Required:
- No login screens
- No credential entry
- No complex setup
- Works automatically if Outlook is configured

## Technical Requirements

### Dependencies:
- `pywin32` (already available) - for COM interface
- No additional packages needed for Phase 1

### File Changes Required:
1. `simple_outlook_integration.py` - enhance existing code
2. `simple_calendar_mixin.py` - improve integration
3. `gui_main_window.py` - add status indicator and meeting column
4. `settings_window.py` - add calendar settings (future)

## Testing Plan
1. Test with Outlook running vs not running
2. Test with different Outlook profiles
3. Test meeting matching accuracy
4. Test with recurring meetings
5. Test timezone handling
6. Test with large numbers of meetings

## Approval Required For:
- Which specific meeting fields to display in GUI
- Calendar status indicator design/placement
- Settings options to include
- Error handling approach when Outlook unavailable

## APPROVED SPECIFICATIONS:
1. **Meeting Column Content**: Show meeting subject and organizer name
2. **Calendar Status Location**: Status bar - "Calendar: Connected" or "Calendar: Not Available"
3. **Matching Tolerance**: 15 minutes (default, can be adjusted later)
4. **No Meeting Found**: Show "No Meeting" in greyed out text, with manual configuration option
5. **Refresh Options**: Automatic sync + manual "Refresh Calendar" button/menu item
6. **Manual Override**: Option to manually name/configure meetings for files with no match

---

**This plan focuses on making the existing COM integration work properly first, with minimal user setup required. Please review and approve before I proceed with implementation.**
