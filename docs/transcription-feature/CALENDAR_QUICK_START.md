# Calendar Integration Quick Start Guide

This is a condensed guide for quickly implementing calendar integration in the HiDock Desktop App.

## TL;DR - What You Need to Know

1. **Current Implementation**: Web app uses backend-mediated OAuth flow through `hinotes.hidock.com`
2. **OAuth Provider Credentials**:
   - Microsoft Client ID: `287048ad-e335-4cbd-8d76-658acb0785d5`
   - Google Client ID: `122776600569-vi9kuatv0lltcut7f8hrpq5e5ln7qf3j.apps.googleusercontent.com`
3. **Backend API**: All calendar operations go through HiDock backend (no direct MS/Google API calls)
4. **Authentication**: Use `AccessToken` header for all HiDock API calls
5. **User Flow**: Open browser → User logs in → Backend stores tokens → Desktop polls status → Fetch events

---

## Option 1: Quick Implementation (Use HiDock Backend)

### Step 1: Initiate Calendar Connection

```python
import webbrowser
import json
import urllib.parse

def connect_microsoft_calendar():
    """Open browser for user to connect Microsoft calendar"""
    params = {
        'client_id': '287048ad-e335-4cbd-8d76-658acb0785d5',
        'response_type': 'code',
        'redirect_uri': 'https://hinotes.hidock.com/auth',
        'scope': 'openid offline_access Calendars.Read',
        'prompt': 'select_account',
        'state': json.dumps({
            'calendar': {'read': True, 'write': False},
            'platform': 'microsoft'
        })
    }

    url = f"https://login.microsoftonline.com/common/oauth2/v2.0/authorize?{urllib.parse.urlencode(params)}"
    webbrowser.open(url)

    print("Please complete authorization in your browser...")
    return wait_for_connection()

def connect_google_calendar():
    """Open browser for user to connect Google Calendar"""
    params = {
        'client_id': '122776600569-vi9kuatv0lltcut7f8hrpq5e5ln7qf3j.apps.googleusercontent.com',
        'response_type': 'code',
        'redirect_uri': 'https://hinotes.hidock.com/auth',
        'scope': 'openid https://www.googleapis.com/auth/calendar',
        'access_type': 'offline',
        'prompt': 'consent',
        'state': json.dumps({
            'calendar': {'read': True, 'write': True},
            'platform': 'google'
        })
    }

    url = f"https://accounts.google.com/o/oauth2/auth?{urllib.parse.urlencode(params)}"
    webbrowser.open(url)

    print("Please complete authorization in your browser...")
    return wait_for_connection()
```

### Step 2: Poll for Connection Status

```python
import requests
import time

def wait_for_connection(access_token, timeout=120, poll_interval=2):
    """Wait for user to complete OAuth flow"""
    start_time = time.time()

    while time.time() - start_time < timeout:
        if check_calendar_status(access_token):
            return True
        time.sleep(poll_interval)

    return False

def check_calendar_status(access_token):
    """Check if calendar is connected"""
    url = "https://hinotes.hidock.com/v1/calendar/status"
    headers = {
        'AccessToken': access_token,
        'Content-Type': 'application/x-www-form-urlencoded'
    }

    try:
        response = requests.post(url, headers=headers)
        response.raise_for_status()
        data = response.json()
        return data['data']['connected']
    except Exception as e:
        print(f"Error checking status: {e}")
        return False
```

### Step 3: Sync and Fetch Events

```python
def sync_calendar(access_token, provider='microsoft'):
    """Trigger backend to sync calendar"""
    url = f"https://hinotes.hidock.com/v1/calendar/{provider}/sync"
    headers = {'AccessToken': access_token}

    response = requests.post(url, headers=headers)
    response.raise_for_status()
    return response.json()

def get_calendar_events(access_token, start_date, end_date, tz_offset=0):
    """Fetch calendar events from HiDock backend"""
    url = "https://hinotes.hidock.com/v1/calendar/event/list"
    headers = {'AccessToken': access_token}
    params = {
        'start_time': f"{start_date} 00:00:00",
        'end_time': f"{end_date} 23:59:59",
        'tz_offset': tz_offset
    }

    response = requests.get(url, headers=headers, params=params)
    response.raise_for_status()
    return response.json()['data']

def parse_events(data):
    """Parse date-grouped events into flat list"""
    events = []
    for date_group in data:
        for event_wrapper in date_group['events']:
            event = event_wrapper['calendarEvent']
            events.append({
                'id': event['id'],
                'title': event['title'],
                'start_time': event['startTime'],
                'end_time': event['endTime'],
                'location': event['location'],
                'organizer': event['owner'],
                'status': event['status'],
                'meeting_type': event['meetingWay'],
            })
    return events
```

### Step 4: Complete Usage Example

```python
from datetime import date, timedelta

# Get HiDock access token (user must be logged in)
access_token = "YOUR_HIDOCK_ACCESS_TOKEN"  # From config

# Connect calendar
print("Connecting Microsoft Calendar...")
if connect_microsoft_calendar(access_token):
    print("Calendar connected!")

    # Sync events
    print("Syncing events...")
    sync_calendar(access_token, 'microsoft')

    # Fetch events for next 7 days
    start = date.today().isoformat()
    end = (date.today() + timedelta(days=7)).isoformat()

    data = get_calendar_events(access_token, start, end)
    events = parse_events(data)

    # Display events
    print(f"\nUpcoming events ({len(events)}):")
    for event in events:
        print(f"  {event['start_time']} - {event['title']}")
else:
    print("Connection timeout or failed")
```

---

## Option 2: Advanced Implementation (Direct OAuth)

For direct OAuth without HiDock backend, you need to:

1. **Register your own OAuth apps** with Microsoft and Google
2. **Implement local callback server** to receive authorization code
3. **Handle token exchange and refresh** yourself
4. **Call Microsoft Graph / Google Calendar APIs** directly

### Prerequisites

- Microsoft Azure AD app registration (get your own client ID/secret)
- Google Cloud project with Calendar API enabled (get your own credentials)
- Register `http://localhost:8080/callback` as redirect URI

### Minimal Implementation

```python
import http.server
import webbrowser
import requests
from threading import Thread
from urllib.parse import urlparse, parse_qs

class OAuthCallbackHandler(http.server.BaseHTTPRequestHandler):
    auth_code = None

    def do_GET(self):
        query = urlparse(self.path).query
        params = parse_qs(query)

        if 'code' in params:
            OAuthCallbackHandler.auth_code = params['code'][0]
            self.send_response(200)
            self.send_header('Content-type', 'text/html')
            self.end_headers()
            self.wfile.write(b"<h1>Success!</h1><p>You can close this window.</p>")
        else:
            self.send_error(400)

    def log_message(self, format, *args):
        pass  # Suppress logs

def start_oauth_flow(provider='microsoft'):
    """Start OAuth flow with local callback"""
    # Start local server
    server = http.server.HTTPServer(('localhost', 8080), OAuthCallbackHandler)
    thread = Thread(target=server.handle_request)
    thread.start()

    # Build OAuth URL
    if provider == 'microsoft':
        params = {
            'client_id': 'YOUR_CLIENT_ID',
            'response_type': 'code',
            'redirect_uri': 'http://localhost:8080/callback',
            'scope': 'openid offline_access Calendars.Read'
        }
        url = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
    else:  # google
        params = {
            'client_id': 'YOUR_CLIENT_ID.apps.googleusercontent.com',
            'response_type': 'code',
            'redirect_uri': 'http://localhost:8080/callback',
            'scope': 'openid https://www.googleapis.com/auth/calendar',
            'access_type': 'offline'
        }
        url = "https://accounts.google.com/o/oauth2/auth"

    # Open browser
    import urllib.parse
    full_url = f"{url}?{urllib.parse.urlencode(params)}"
    webbrowser.open(full_url)

    # Wait for callback
    import time
    timeout = 120
    start_time = time.time()
    while OAuthCallbackHandler.auth_code is None:
        if time.time() - start_time > timeout:
            raise TimeoutError("OAuth timeout")
        time.sleep(0.5)

    code = OAuthCallbackHandler.auth_code
    OAuthCallbackHandler.auth_code = None
    return code

def exchange_code_for_tokens(code, provider='microsoft'):
    """Exchange authorization code for tokens"""
    if provider == 'microsoft':
        url = "https://login.microsoftonline.com/common/oauth2/v2.0/token"
        data = {
            'client_id': 'YOUR_CLIENT_ID',
            'client_secret': 'YOUR_CLIENT_SECRET',
            'code': code,
            'redirect_uri': 'http://localhost:8080/callback',
            'grant_type': 'authorization_code'
        }
    else:  # google
        url = "https://oauth2.googleapis.com/token"
        data = {
            'client_id': 'YOUR_CLIENT_ID.apps.googleusercontent.com',
            'client_secret': 'YOUR_CLIENT_SECRET',
            'code': code,
            'redirect_uri': 'http://localhost:8080/callback',
            'grant_type': 'authorization_code'
        }

    response = requests.post(url, data=data)
    response.raise_for_status()
    return response.json()

def get_calendar_events_direct(access_token, provider='microsoft'):
    """Fetch events directly from provider API"""
    if provider == 'microsoft':
        url = "https://graph.microsoft.com/v1.0/me/calendarView"
        params = {
            'startDateTime': '2025-11-01T00:00:00Z',
            'endDateTime': '2025-12-31T23:59:59Z'
        }
    else:  # google
        url = "https://www.googleapis.com/calendar/v3/calendars/primary/events"
        params = {
            'timeMin': '2025-11-01T00:00:00Z',
            'timeMax': '2025-12-31T23:59:59Z',
            'singleEvents': 'true'
        }

    headers = {'Authorization': f'Bearer {access_token}'}
    response = requests.get(url, headers=headers, params=params)
    response.raise_for_status()
    return response.json()

# Usage
code = start_oauth_flow('microsoft')
tokens = exchange_code_for_tokens(code, 'microsoft')
events = get_calendar_events_direct(tokens['access_token'], 'microsoft')
```

---

## Integration with Existing Desktop App

### Add to `config_and_logger.py`

```python
DEFAULT_CONFIG = {
    # ... existing config ...
    "calendar": {
        "provider": None,  # 'microsoft' or 'google'
        "connected": False,
        "auto_sync": True,
        "sync_interval_minutes": 15,
        "sync_days_ahead": 7,
        "sync_days_back": 1
    }
}
```

### Add to `gui_main_window.py` (or create new mixin)

```python
class CalendarMixin:
    def setup_calendar_ui(self):
        """Add calendar button to UI"""
        self.calendar_button = ctk.CTkButton(
            self.sidebar_frame,
            text="Calendar",
            command=self.open_calendar_dialog
        )
        self.calendar_button.grid(row=10, column=0, padx=20, pady=10)

    def open_calendar_dialog(self):
        """Open calendar connection dialog"""
        from tkinter import messagebox

        if not self.config.get('hidock_access_token'):
            messagebox.showerror(
                "Error",
                "Please log in to HiDock first"
            )
            return

        # Show provider selection dialog
        dialog = CalendarProviderDialog(self)
        provider = dialog.get_result()

        if provider:
            self.connect_calendar(provider)

    def connect_calendar(self, provider):
        """Connect calendar provider"""
        access_token = self.config.get('hidock_access_token')

        # Show connecting message
        self.status_label.configure(text=f"Connecting to {provider} calendar...")

        # Open browser for OAuth
        if provider == 'microsoft':
            connect_microsoft_calendar()
        else:
            connect_google_calendar()

        # Poll for connection in background thread
        import threading
        thread = threading.Thread(
            target=self._wait_for_calendar_connection,
            args=(access_token, provider)
        )
        thread.daemon = True
        thread.start()

    def _wait_for_calendar_connection(self, access_token, provider):
        """Wait for calendar connection (runs in background)"""
        if wait_for_connection(access_token):
            # Update config
            self.config['calendar']['provider'] = provider
            self.config['calendar']['connected'] = True
            save_config(self.config)

            # Sync events
            sync_calendar(access_token, provider)

            # Update UI (must be done in main thread)
            self.after(0, self._on_calendar_connected, provider)

    def _on_calendar_connected(self, provider):
        """Update UI after calendar connection"""
        self.status_label.configure(
            text=f"{provider.capitalize()} calendar connected!"
        )
        # Show success message
        from tkinter import messagebox
        messagebox.showinfo(
            "Success",
            f"Your {provider} calendar has been connected!"
        )

    def fetch_calendar_events(self):
        """Fetch calendar events"""
        if not self.config['calendar']['connected']:
            return []

        access_token = self.config.get('hidock_access_token')
        provider = self.config['calendar']['provider']

        # Get date range
        from datetime import date, timedelta
        start = (date.today() - timedelta(days=1)).isoformat()
        end = (date.today() + timedelta(days=7)).isoformat()

        # Fetch events
        data = get_calendar_events(access_token, start, end)
        return parse_events(data)
```

### Create Calendar Provider Dialog

```python
import customtkinter as ctk

class CalendarProviderDialog(ctk.CTkToplevel):
    def __init__(self, parent):
        super().__init__(parent)

        self.title("Connect Calendar")
        self.geometry("400x250")

        self.result = None

        # Title
        label = ctk.CTkLabel(
            self,
            text="Select Calendar Provider",
            font=("Arial", 16, "bold")
        )
        label.pack(pady=20)

        # Microsoft button
        ms_button = ctk.CTkButton(
            self,
            text="Microsoft Outlook / Office 365",
            command=lambda: self.select_provider('microsoft'),
            width=300,
            height=40
        )
        ms_button.pack(pady=10)

        # Google button
        google_button = ctk.CTkButton(
            self,
            text="Google Calendar",
            command=lambda: self.select_provider('google'),
            width=300,
            height=40
        )
        google_button.pack(pady=10)

        # Cancel button
        cancel_button = ctk.CTkButton(
            self,
            text="Cancel",
            command=self.destroy,
            fg_color="gray",
            width=300
        )
        cancel_button.pack(pady=10)

        # Make modal
        self.transient(parent)
        self.grab_set()
        self.wait_window()

    def select_provider(self, provider):
        self.result = provider
        self.destroy()

    def get_result(self):
        return self.result
```

---

## API Endpoints Reference

### HiDock Backend API

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/v1/calendar/status` | POST | Check if calendar connected |
| `/v1/calendar/oauth2/authorize` | POST | Submit OAuth authorization code |
| `/v1/calendar/microsoft/sync` | POST | Sync Microsoft calendar |
| `/v1/calendar/google/sync` | POST | Sync Google calendar |
| `/v1/calendar/event/list` | GET | Fetch calendar events |

**Required Header**: `AccessToken: {your_hidock_access_token}`

### Query Parameters for `/event/list`

- `start_time`: Start date/time (format: `YYYY-MM-DD HH:MM:SS`)
- `end_time`: End date/time (format: `YYYY-MM-DD HH:MM:SS`)
- `tz_offset`: Timezone offset in minutes (e.g., -300 for EST)

---

## Event Data Structure

```json
{
  "calendarEvent": {
    "id": "5663825132255354880",
    "title": "Team Meeting",
    "startTime": "2025-12-05 14:00:00.0",
    "endTime": "2025-12-05 15:00:00.0",
    "location": "Microsoft Teams Meeting",
    "owner": "user@example.com",
    "status": "accepted",
    "meetingWay": "teams"
  }
}
```

**Key Fields**:
- `title`: Event subject/title
- `startTime`: Start date/time (UTC)
- `endTime`: End date/time (UTC)
- `location`: Meeting location or platform
- `owner`: Event organizer email
- `status`: Response status (`accepted`, `tentative`, `declined`)
- `meetingWay`: Meeting type (`teams`, `zoom`, `google_meet`, `physical`)

---

## Troubleshooting

### "Calendar not connected" after OAuth

**Solution**: Wait longer (up to 60 seconds) for backend to process tokens

### "AccessToken invalid"

**Solution**: User needs to re-login to HiDock web interface

### OAuth popup blocked

**Solution**: Check browser popup blocker settings

### No events returned

**Solution**:
1. Check date range is correct
2. Verify user has events in their calendar
3. Try triggering sync manually: `POST /v1/calendar/{provider}/sync`

---

## Next Steps

1. **Implement basic connection** using Option 1 (HiDock backend)
2. **Add calendar button** to main window UI
3. **Test with Microsoft Outlook** first (simpler scopes)
4. **Add Google Calendar** support
5. **Implement event display** in desktop app
6. **Add auto-sync** on timer (every 15 minutes)
7. **Sync calendar events to HiDock device** (if supported)

---

## Testing Checklist

- [ ] Microsoft calendar connection works
- [ ] Google calendar connection works
- [ ] Events fetch correctly
- [ ] Date range filtering works
- [ ] Sync updates events
- [ ] Connection persists after app restart
- [ ] Error handling for denied permissions
- [ ] Error handling for network failures
- [ ] UI updates after connection
- [ ] Multiple accounts support (if needed)

---

## Resources

- Full implementation guide: `CALENDAR_INTEGRATION_GUIDE.md`
- OAuth flow diagrams: `CALENDAR_OAUTH_FLOWS.md`
- Microsoft Graph API: https://learn.microsoft.com/en-us/graph/api/resources/calendar
- Google Calendar API: https://developers.google.com/calendar/api/v3/reference

---

**Last Updated**: 2025-11-06
