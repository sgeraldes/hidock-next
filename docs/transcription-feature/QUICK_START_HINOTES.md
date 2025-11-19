# HiNotes Integration - Quick Start Guide

**For:** HiDock Desktop App developers
**Goal:** Get calendar sync working in < 30 minutes
**Approach:** Manual token extraction (Phase 1 - MVP)

---

## What You Need

1. ✅ HiNotes account (https://hinotes.hidock.com)
2. ✅ Chrome/Edge browser
3. ✅ 5 minutes

---

## Step 1: Get Your AccessToken (2 minutes)

### Option A: From Browser DevTools

1. **Login** to https://hinotes.hidock.com
2. **Open DevTools**: Press `F12`
3. **Go to Network tab**
4. **Click on "Notes"** in the web app (to trigger API request)
5. **Click on any request** (e.g., `user/info`)
6. **Scroll down** to "Request Headers"
7. **Find `AccessToken`** header
8. **Copy the 64-character value**

```
Example:
AccessToken: 2u78Nu6tQ9t2NFNoS4IdJflPDBoDqL2uThyVaeGsUiqFDYJIVXm9anhtNqUC9Nu2
```

### Option B: From HAR File

If you already have a HAR file:

```python
python -c "
import json
har = json.load(open('your_file.har'))
for e in har['log']['entries']:
    for h in e['request']['headers']:
        if h['name'] == 'AccessToken':
            print(h['value'])
            break
"
```

---

## Step 2: Test the Service (5 minutes)

```bash
cd E:\Code\hidock-next\apps\desktop

# Run the service test
python src/hinotes_service.py
```

**You'll be prompted to paste your token.**

**Expected output:**
```
HiNotes not configured.
...
Paste AccessToken: 2u78Nu6tQ9t2NFNoS4IdJflPDBoDqL2uThyVaeGsUiqFDYJIVXm9anhtNqUC9Nu2

✅ Token configured

🔍 Validating token...
✅ Token is valid

👤 User Info:
  Name: John Doe
  Email: john@example.com
  Type: pro
  Notes: 50
  Duration: 1687s

📅 Calendar Status:
  {...}

📆 Upcoming Events (next 7 days):
  Found 3 events
  - Team Meeting
  - Project Review
  - Lunch with Client

✅ All tests passed!
```

---

## Step 3: Use in Your Code (10 minutes)

### Example 1: Get Calendar Events

```python
from hinotes_service import HiNotesService
from config_and_logger import load_config
from datetime import datetime, timedelta

# Initialize
config = load_config()
service = HiNotesService(config)

# Check if configured
if not service.is_configured():
    print("Please configure HiNotes in Settings")
    return

# Get events for next week
start = datetime.now()
end = start + timedelta(days=7)

events = service.get_calendar_events(
    start_time=start,
    end_time=end,
    tz_offset_minutes=-300  # Adjust for your timezone
)

if events:
    for event in events:
        print(f"{event['title']} - {event['start']}")
```

### Example 2: Validate User

```python
# Validate token and get user info
if service.validate_token():
    user = service.get_user_info()
    print(f"Logged in as: {user['name']}")
else:
    print("Token expired, please reconfigure")
```

### Example 3: Check Device Status

```python
# Check if device is registered to this HiNotes account
device_sn = "HD1E243505435"  # Your device serial number

status = service.check_device_status(device_sn)

if status:
    if status['ownership'] == 'mine':
        print(f"✅ Device {device_sn} is yours!")
    else:
        print(f"❌ Device belongs to someone else")
```

---

## Step 4: Add UI to Desktop App (15 minutes)

### In `settings_window.py`:

```python
def create_hinotes_section(self):
    """Add HiNotes configuration section."""
    from hinotes_service import HiNotesService

    frame = customtkinter.CTkFrame(self)
    frame.pack(pady=10, padx=10, fill="x")

    label = customtkinter.CTkLabel(
        frame,
        text="HiNotes Calendar Integration",
        font=("", 14, "bold")
    )
    label.pack(pady=5)

    # Check current status
    service = HiNotesService(self.config)

    if service.is_configured():
        # Show current user
        user = service.get_user_info()
        if user:
            status_label = customtkinter.CTkLabel(
                frame,
                text=f"✅ Connected as: {user['email']}",
                text_color="green"
            )
        else:
            status_label = customtkinter.CTkLabel(
                frame,
                text="⚠️ Token may be expired",
                text_color="orange"
            )
        status_label.pack(pady=5)

        # Disconnect button
        disconnect_btn = customtkinter.CTkButton(
            frame,
            text="Disconnect",
            command=lambda: self.disconnect_hinotes(service)
        )
        disconnect_btn.pack(pady=5)

    else:
        # Show configuration UI
        info_label = customtkinter.CTkLabel(
            frame,
            text="Sync your HiDock calendar with Microsoft/Google Calendar",
            wraplength=400
        )
        info_label.pack(pady=5)

        configure_btn = customtkinter.CTkButton(
            frame,
            text="Configure HiNotes",
            command=self.show_hinotes_config_dialog
        )
        configure_btn.pack(pady=5)

def show_hinotes_config_dialog(self):
    """Show dialog to configure HiNotes token."""
    dialog = customtkinter.CTkToplevel(self)
    dialog.title("Configure HiNotes")
    dialog.geometry("600x400")

    # Instructions
    instructions = """
To connect HiNotes calendar:

1. Open https://hinotes.hidock.com in your browser
2. Login to your HiNotes account
3. Press F12 to open Developer Tools
4. Go to the "Network" tab
5. Click on any note or navigate in HiNotes
6. Click on any request (e.g., "user/info")
7. Scroll down to "Request Headers"
8. Find the "AccessToken" header
9. Copy the 64-character value
10. Paste it below

⚠️ Note: This token may expire after some time.
   If calendar sync stops working, repeat this process.
"""

    instructions_label = customtkinter.CTkLabel(
        dialog,
        text=instructions,
        justify="left",
        wraplength=550
    )
    instructions_label.pack(pady=10, padx=10)

    # Token input
    token_entry = customtkinter.CTkEntry(
        dialog,
        width=500,
        placeholder_text="Paste 64-character AccessToken here"
    )
    token_entry.pack(pady=10)

    # Status label
    status_label = customtkinter.CTkLabel(dialog, text="")
    status_label.pack(pady=5)

    def validate_and_save():
        token = token_entry.get().strip()

        if not token:
            status_label.configure(text="❌ Please enter a token", text_color="red")
            return

        from hinotes_service import HiNotesService
        service = HiNotesService(self.config)

        try:
            # Configure token
            service.configure_token(token)

            # Validate by fetching user info
            user = service.get_user_info()

            if user:
                status_label.configure(
                    text=f"✅ Success! Connected as {user['email']}",
                    text_color="green"
                )
                # Close dialog after 2 seconds
                dialog.after(2000, dialog.destroy)
            else:
                status_label.configure(
                    text="❌ Token is invalid or expired",
                    text_color="red"
                )
                service.clear_configuration()

        except ValueError as e:
            status_label.configure(text=f"❌ {e}", text_color="red")
        except Exception as e:
            status_label.configure(
                text=f"❌ Error: {e}",
                text_color="red"
            )

    # Buttons
    button_frame = customtkinter.CTkFrame(dialog)
    button_frame.pack(pady=10)

    validate_btn = customtkinter.CTkButton(
        button_frame,
        text="Validate & Save",
        command=validate_and_save
    )
    validate_btn.pack(side="left", padx=5)

    cancel_btn = customtkinter.CTkButton(
        button_frame,
        text="Cancel",
        command=dialog.destroy
    )
    cancel_btn.pack(side="left", padx=5)

def disconnect_hinotes(self, service):
    """Disconnect HiNotes integration."""
    service.clear_configuration()
    # Refresh settings window
    self.destroy()
    from gui_main_window import HiDockToolGUI
    HiDockToolGUI.open_settings(self.master)
```

---

## Troubleshooting

### "Token is invalid or expired"

**Solution:** Get a fresh token from browser (repeat Step 1)

**Why it happens:** Tokens have an expiry time (unknown, likely 1-7 days)

---

### "HiNotes not configured"

**Solution:** Run through Step 1-2 to configure the token

---

### "No calendar events found"

**Possible causes:**
1. Calendar not connected in HiNotes web app
   - **Fix:** Go to https://hinotes.hidock.com → Settings → Calendar → Connect Microsoft/Google

2. No events in date range
   - **Fix:** Check your calendar has events in the requested date range

3. Wrong timezone offset
   - **Fix:** Adjust `tz_offset_minutes` parameter

---

### API Request Errors

**Check:**
```python
import logging
logging.basicConfig(level=logging.DEBUG)

# Now run your code - you'll see detailed API logs
service.get_user_info()
```

---

## What's Next?

### Phase 2: Automatic Login (Future)

Once we discover the login endpoint, we'll upgrade to:
- Username/password input in Settings
- Automatic token refresh
- Better error handling

**See:** `docs/transcription-feature/HINOTES_AUTHENTICATION_ANALYSIS.md` Section 3.2

---

### Phase 3: Full Calendar Sync

Features to implement:
- Sync calendar events to HiDock device
- Two-way sync (device → calendar)
- Event reminders
- Meeting note attachment

**See:** `docs/transcription-feature/HINOTES_AUTHENTICATION_ANALYSIS.md` Section 5

---

## API Reference

### HiNotesService Methods

#### `is_configured() -> bool`
Check if token is set

#### `configure_token(token: str) -> bool`
Set AccessToken from user input

#### `validate_token() -> bool`
Test if token is valid

#### `get_user_info() -> dict`
Get current user details

#### `get_calendar_events(start, end, tz_offset) -> list`
Fetch calendar events in date range

#### `get_calendar_status() -> dict`
Get calendar integration status

#### `check_device_status(device_sn: str) -> dict`
Check device ownership

---

## Full Example: Calendar Display

```python
"""
Example: Display upcoming calendar events in GUI
"""

import customtkinter
from datetime import datetime, timedelta
from hinotes_service import HiNotesService
from config_and_logger import load_config

class CalendarWidget(customtkinter.CTkFrame):
    def __init__(self, parent):
        super().__init__(parent)

        self.config = load_config()
        self.service = HiNotesService(self.config)

        # Title
        title = customtkinter.CTkLabel(
            self,
            text="📅 Upcoming Events",
            font=("", 16, "bold")
        )
        title.pack(pady=10)

        # Events list
        self.events_frame = customtkinter.CTkScrollableFrame(self)
        self.events_frame.pack(fill="both", expand=True, padx=10, pady=10)

        # Refresh button
        refresh_btn = customtkinter.CTkButton(
            self,
            text="Refresh",
            command=self.load_events
        )
        refresh_btn.pack(pady=5)

        # Load events
        self.load_events()

    def load_events(self):
        """Load and display calendar events."""
        # Clear existing
        for widget in self.events_frame.winfo_children():
            widget.destroy()

        if not self.service.is_configured():
            label = customtkinter.CTkLabel(
                self.events_frame,
                text="HiNotes not configured.\nPlease set up in Settings.",
                text_color="gray"
            )
            label.pack(pady=20)
            return

        # Fetch events (next 7 days)
        start = datetime.now()
        end = start + timedelta(days=7)

        import time
        tz_offset = -int(time.timezone / 60)

        events = self.service.get_calendar_events(start, end, tz_offset)

        if not events:
            label = customtkinter.CTkLabel(
                self.events_frame,
                text="No upcoming events",
                text_color="gray"
            )
            label.pack(pady=20)
            return

        # Display events
        for event in events:
            self.create_event_widget(event)

    def create_event_widget(self, event):
        """Create widget for single event."""
        frame = customtkinter.CTkFrame(self.events_frame)
        frame.pack(fill="x", pady=5, padx=5)

        # Event title
        title = customtkinter.CTkLabel(
            frame,
            text=event.get('title', 'Untitled'),
            font=("", 12, "bold")
        )
        title.pack(anchor="w", padx=10, pady=(5, 0))

        # Event time
        time_str = event.get('start', '')
        time_label = customtkinter.CTkLabel(
            frame,
            text=f"🕐 {time_str}",
            text_color="gray"
        )
        time_label.pack(anchor="w", padx=10, pady=(0, 5))

# Usage in main window
def add_calendar_widget(self):
    """Add calendar widget to main window."""
    calendar = CalendarWidget(self.main_frame)
    calendar.pack(fill="both", expand=True, padx=10, pady=10)
```

---

## Files Reference

- **Implementation:** `E:\Code\hidock-next\apps\desktop\src\hinotes_service.py`
- **Full Analysis:** `E:\Code\hidock-next\docs\transcription-feature\HINOTES_AUTHENTICATION_ANALYSIS.md`
- **HAR Files:** `E:\Code\hidock-next\archive\*.har`

---

## Questions?

**For API issues:**
- Check logs: `python src/hinotes_service.py` with `logging.DEBUG`
- Verify token is 64 characters
- Try getting fresh token from browser

**For implementation help:**
- See full examples in `HINOTES_AUTHENTICATION_ANALYSIS.md`
- Check API endpoint list in Section 4.1

**For future development:**
- See recommended approach in Section 5
- Phase 2 = automatic login
- Phase 3 = full calendar sync

---

**Last Updated:** 2025-11-06
