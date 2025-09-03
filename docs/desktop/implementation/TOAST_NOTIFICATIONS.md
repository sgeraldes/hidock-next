# Toast Notification System

**File:** `toast_notification.py`  
**Purpose:** Provides prominent, user-friendly notifications for connection errors and other important feedback

## Overview

The toast notification system was implemented to solve the problem of inadequate error feedback when device connections failed. Previously, errors were only shown in:

1. **Status bar** - Gets truncated and overwritten immediately 
2. **Console logs** - Not visible to end users
3. **Error dialogs** - Intrusive for expected conditions like device-busy

## Features

### ToastNotification Class

**Individual toast notifications with:**
- 4 types: `success`, `warning`, `error`, `info` 
- Color-coded appearance with appropriate icons (✓, ⚠, ✕, ⓘ)
- Configurable duration (3-8 seconds based on importance)
- Manual dismiss with close button (×)
- Auto-positioning (top-right by default)
- Responsive design with text wrapping

### ToastManager Class

**Manages multiple toasts:**
- **Stacking:** Multiple toasts stack vertically with spacing
- **Auto-cleanup:** Removes dismissed toasts and restacks remaining ones
- **Convenience methods:** `show_success()`, `show_warning()`, `show_error()`, `show_info()`
- **Prevents overlap:** Calculates positions to avoid covering other UI elements

## Usage in HiDock Next

### Initialization

```python
# In gui_main_window.py
from toast_notification import ToastManager

class HiDockToolGUI:
    def __init__(self):
        # ... other initialization ...
        self.toast_manager = ToastManager(self)
```

### Connection Error Handling

```python
# In gui_actions_device.py

# Device Busy (Warning - 6 seconds)
self.toast_manager.show_warning(
    message="Device is currently in use by another application. Please close any other apps using the HiDock device and try again.",
    title="Device Busy",
    duration=6000
)

# Access Denied (Error - 8 seconds) 
self.toast_manager.show_error(
    message="Access denied: Device may be in use by another application or need administrator permissions. Please close other apps or try running as administrator.",
    title="Access Denied",
    duration=8000
)

# Success Connection (Success - 3 seconds)
self.toast_manager.show_success(
    message=f"Connected to {device_info.get('model', 'HiDock')} device successfully.",
    title="Device Connected", 
    duration=3000
)
```

### Quick Usage Functions

```python
from toast_notification import show_error_toast, show_success_toast

# Quick error toast
show_error_toast(parent_window, "Connection failed", "Error")

# Quick success toast  
show_success_toast(parent_window, "File downloaded successfully")
```

## Design Decisions

### Duration Guidelines
- **Success messages:** 3 seconds (quick confirmation)
- **Info messages:** 4 seconds (general information)
- **Warning messages:** 6 seconds (need attention but not critical)
- **Error messages:** 7-8 seconds (critical, need time to read and act)

### Positioning
- **Top-right by default:** Standard UI convention
- **Offset from window edge:** 20px margin
- **Screen boundary awareness:** Adjusts if window is near screen edge
- **Stacking:** 90px vertical spacing between multiple toasts

### Color Schemes
- **Success:** Green background (#4CAF50) with checkmark icon
- **Warning:** Orange background (#FF9800) with warning icon  
- **Error:** Red background (#F44336) with X icon
- **Info:** Blue background (#2196F3) with info icon

### User Experience
- **Non-intrusive:** Appears over content but doesn't block interaction
- **Dismissible:** Users can close manually if needed
- **Prominent:** Large enough to notice, colored to convey importance
- **Actionable:** Messages include specific next steps

## Technical Implementation

### CustomTkinter Integration
- Uses `CTkToplevel` for overlay windows
- `CTkFrame` and `CTkLabel` for content
- Integrates with app's color scheme and fonts
- Respects CustomTkinter theming system

### Threading Safety
- Uses `threading.Timer` for auto-dismiss functionality
- All GUI updates happen on main thread via `self.after()`
- Proper cleanup prevents memory leaks

### Window Management
- `overrideredirect(True)` removes window decorations
- `wm_attributes("-topmost", True)` keeps toasts visible
- `wm_attributes("-alpha", 0.95)` for subtle transparency
- Proper geometry calculations for multi-monitor setups

## Future Enhancements

### Potential Improvements
1. **Animation:** Fade in/out animations for smoother appearance
2. **Sound:** Optional notification sounds for different types
3. **Persistence:** Option to keep error toasts until manually dismissed
4. **Action buttons:** Add "Retry" or "Help" buttons to error toasts
5. **Rich content:** Support for images or progress bars in toasts

### Integration Points
- File operation feedback (download complete, errors)
- AI processing status (transcription started, completed, failed)
- Settings changes confirmation
- Update notifications
- Device health warnings

## Testing

The toast system can be tested by:

1. **Connection errors:** Try connecting with device busy or insufficient permissions
2. **Multiple toasts:** Trigger several errors quickly to test stacking
3. **Manual dismiss:** Test close button functionality
4. **Auto-dismiss:** Verify toasts disappear after specified duration
5. **Window positioning:** Test with different window positions and sizes

## Dependencies

- **CustomTkinter:** For UI components and theming
- **Threading:** For auto-dismiss timers
- **Tkinter:** For window management and geometry

The toast system is self-contained with no external dependencies beyond the existing project requirements.