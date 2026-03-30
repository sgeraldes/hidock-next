# Calendar Integration Guide: OAuth2 Flow & API Analysis

## Executive Summary

This document provides a comprehensive analysis of the OAuth2 authentication flows and calendar API integration for both **Microsoft Outlook/Office 365** and **Google Calendar**, extracted from HAR file analysis of the HiDock web application.

**Key Finding**: The calendar integration uses a **backend-mediated OAuth2 flow** where:
1. Frontend redirects user to provider's OAuth consent page
2. User authenticates and grants permissions
3. Provider redirects back with authorization code
4. Frontend sends code to backend (`hinotes.hidock.com`)
5. Backend exchanges code for tokens and stores them
6. Backend makes all Calendar API calls on behalf of the user
7. Frontend queries backend API for calendar events

**No direct Calendar API calls from frontend** - all calendar operations go through the HiDock backend.

---

## Architecture Overview

```
┌─────────────┐         ┌──────────────────┐         ┌─────────────────┐
│   Desktop   │         │  HiDock Backend  │         │  Calendar API   │
│     App     │◄───────►│  (hinotes.cloud) │◄───────►│ (MS/Google)     │
│             │  HTTPS  │                  │  OAuth2 │                 │
└─────────────┘         └──────────────────┘         └─────────────────┘
      │                          │
      │    AccessToken           │
      │  (Session Auth)          │  Stores OAuth tokens
      │                          │  Makes API calls
      └──────────────────────────┘
```

### Authentication Model

- **User Session**: Desktop app authenticates with HiDock backend using `AccessToken` header
- **OAuth Tokens**: Backend stores and manages provider OAuth tokens (never exposed to frontend)
- **API Calls**: All calendar operations proxied through backend

---

## Microsoft Outlook/Office 365 Integration

### 1. OAuth2 Authorization Flow

**Flow Type**: Authorization Code Flow (OAuth 2.0)

#### Step 1: Initiate Authorization

Desktop app opens browser to Microsoft authorization endpoint:

```
GET https://login.microsoftonline.com/common/oauth2/v2.0/authorize
```

**Query Parameters**:
```
client_id=287048ad-e335-4cbd-8d76-658acb0785d5
response_type=code
redirect_uri=https://hinotes.hidock.com/auth
scope=openid offline_access Calendars.Read
prompt=select_account
state={"calendar":{"read":true,"write":false},"contact":{"read":false,"write":false},"platform":"microsoft"}
```

**Parameter Details**:
| Parameter | Value | Purpose |
|-----------|-------|---------|
| `client_id` | `287048ad-e335-4cbd-8d76-658acb0785d5` | HiDock's registered app ID |
| `response_type` | `code` | Authorization Code Flow |
| `redirect_uri` | `https://hinotes.hidock.com/auth` | Callback URL |
| `scope` | `openid offline_access Calendars.Read` | Permissions requested |
| `prompt` | `select_account` | Force account picker |
| `state` | JSON object | Custom state tracking |

**Scopes Explained**:
- `openid`: Basic OpenID Connect authentication
- `offline_access`: Get refresh token for long-term access
- `Calendars.Read`: Read-only calendar access (use `Calendars.ReadWrite` for write)

**State Parameter** (JSON):
```json
{
  "calendar": {
    "read": true,
    "write": false
  },
  "contact": {
    "read": false,
    "write": false
  },
  "platform": "microsoft"
}
```

#### Step 2: User Authentication & Consent

User sees Microsoft login page where they:
1. Enter Microsoft account credentials
2. Complete MFA if enabled
3. Review and grant calendar permissions
4. Click "Accept"

**User Experience**: Standard Microsoft login page with organization branding (if applicable)

#### Step 3: Authorization Code Callback

Microsoft redirects browser back to:

```
GET https://hinotes.hidock.com/auth?code={AUTHORIZATION_CODE}&state={STATE_JSON}
```

**Example**:
```
https://hinotes.hidock.com/auth?code=1.AQ8AVL4PiACadUa7ZzDdmLnrP61IcCg1471MjXZlissHhdV9AAQPAA.AgABBAIAAABlMNzVhAPUTrARzfQjWPtKAwDs_wUA9P-apjt0pY8jX3l6mFJFqmNyZeWc0uFV_e3ImYHqklthRgikrJb1J74ecC4RJLo-5WoPgNT29IlDlOpQSVJekVVxoEyrI1r7EAxdNXOzXCRqPULI2GZfjgwXBUzexriKQFM49KW7Z2kZ75fEyb0EjtYmT_kPHqdLIAGObS...&state={"calendar":{"read":true,"write":false},"contact":{"read":false,"write":false},"platform":"microsoft"}
```

#### Step 4: Token Exchange (Backend)

Frontend sends authorization code to backend:

```http
POST https://hinotes.hidock.com/v1/calendar/oauth2/authorize
Content-Type: application/json
AccessToken: {USER_SESSION_TOKEN}

{
  "code": "1.AQ8AVL4PiACadUa7ZzDdmLnrP...",
  "platform": "microsoft",
  "scope_list": [
    {
      "action": ["read"],
      "type": "calendar"
    }
  ]
}
```

**Backend Process** (not visible in HAR):
1. Validates authorization code
2. Exchanges code for access token with Microsoft Token Endpoint:
   ```
   POST https://login.microsoftonline.com/common/oauth2/v2.0/token
   ```
3. Receives access token + refresh token
4. Stores tokens securely linked to user account
5. Returns success to frontend

**Response**:
```json
{
  "error": 0,
  "message": "success",
  "data": null
}
```

#### Step 5: Sync Calendar (Initial)

Frontend triggers initial calendar sync:

```http
POST https://hinotes.hidock.com/v1/calendar/microsoft/sync
AccessToken: {USER_SESSION_TOKEN}
```

**Response**:
```json
{
  "error": 0,
  "message": "success",
  "data": null
}
```

**Backend Process**:
- Uses stored Microsoft access token
- Calls Microsoft Graph API to fetch calendar events
- Stores events in backend database
- Handles pagination, recurring events, etc.

---

### 2. Calendar API Endpoints

All calendar operations go through HiDock backend. Frontend never calls Microsoft Graph directly.

#### Check Connection Status

```http
POST https://hinotes.hidock.com/v1/calendar/status
AccessToken: {USER_SESSION_TOKEN}
```

**Response**:
```json
{
  "error": 0,
  "message": "success",
  "data": {
    "connected": true
  }
}
```

#### Fetch Calendar Events

```http
GET https://hinotes.hidock.com/v1/calendar/event/list?start_time=2025-10-26+00:00:00&end_time=2025-12-06+23:59:59&tz_offset=180
AccessToken: {USER_SESSION_TOKEN}
```

**Query Parameters**:
- `start_time`: Start date/time (format: `YYYY-MM-DD HH:MM:SS`)
- `end_time`: End date/time (format: `YYYY-MM-DD HH:MM:SS`)
- `tz_offset`: Timezone offset in minutes (e.g., 180 = UTC+3)

**Response Structure**:
```json
{
  "error": 0,
  "message": "success",
  "data": [
    {
      "date": "2025-12-05",
      "events": [
        {
          "calendarEvent": {
            "id": "5663825132255354880",
            "userId": "5459419178391982080",
            "eventId": "AAMkAGEyYjA4ZDlkLWMzNjUtNDI3Ny1hZjdhLWY4N2JjZDQ3ZmI5YQ...",
            "calendarId": "AQMkAGEyYjA4ZDlkLWMzNjUtNDI3NwAtYWY3YS1mODdiY2Q0N2ZiOWEA...",
            "createdTime": "2025-09-11 22:58:02.0",
            "owner": "sebastian.geraldes@example.com",
            "location": "Microsoft Teams Meeting",
            "title": "Delivery Technical Weekly",
            "status": "accepted",
            "updatedTime": "2025-10-31 14:00:15.0",
            "startTime": "2025-12-05 14:00:00.0",
            "endTime": "2025-12-05 15:00:00.0",
            "noteId": null,
            "deviceState": "none",
            "meetingWay": "teams",
            "deviceStartTime": "2025-12-05 13:30:00.0",
            "deviceEndTime": "2025-12-05 15:07:30.0"
          },
          "calendarEventMeetingSetting": {
            "id": "5663825132490235904",
            "userId": "5459419178391982080",
            "eventId": "5663825132255354880",
            "createTime": "2025-09-11 23:04:45.092",
            "updateTime": "2025-09-11 23:04:45.092",
            "attendeeCount": null,
            "aiEngine": "openai",
            "mainLanguage": "auto",
            "promptTemplate": "a0d420d597cd401eb23fc57569d01114",
            "operatingSystem": null,
            "title": null
          }
        }
      ]
    }
  ]
}
```

#### Trigger Calendar Sync

```http
POST https://hinotes.hidock.com/v1/calendar/microsoft/sync
AccessToken: {USER_SESSION_TOKEN}
```

Forces backend to refresh calendar data from Microsoft Graph.

#### Device State Notification

```http
POST https://hinotes.hidock.com/v1/calendar/event/device_state/notice
AccessToken: {USER_SESSION_TOKEN}
Content-Type: application/json

{
  // Device state update payload
}
```

Used to sync calendar events to HiDock hardware device.

---

### 3. Event Data Structure

#### Calendar Event Fields

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `id` | string | Backend database ID | `"5663825132255354880"` |
| `userId` | string | HiDock user ID | `"5459419178391982080"` |
| `eventId` | string | Microsoft Graph event ID | `"AAMkAGEyYjA4ZDlkLW..."` |
| `calendarId` | string | Microsoft calendar ID | `"AQMkAGEyYjA4ZDlkLW..."` |
| `title` | string | Event subject/title | `"Delivery Technical Weekly"` |
| `startTime` | string | Start date/time (UTC) | `"2025-12-05 14:00:00.0"` |
| `endTime` | string | End date/time (UTC) | `"2025-12-05 15:00:00.0"` |
| `location` | string | Meeting location | `"Microsoft Teams Meeting"` |
| `owner` | string | Event organizer email | `"user@example.com"` |
| `status` | string | Acceptance status | `"accepted"`, `"tentative"`, `"declined"` |
| `createdTime` | string | Event creation time | `"2025-09-11 22:58:02.0"` |
| `updatedTime` | string | Last update time | `"2025-10-31 14:00:15.0"` |
| `meetingWay` | string | Meeting type | `"teams"`, `"zoom"`, `"physical"` |
| `deviceState` | string | Device sync state | `"none"`, `"synced"`, `"pending"` |
| `deviceStartTime` | string | Device adjusted start | `"2025-12-05 13:30:00.0"` |
| `deviceEndTime` | string | Device adjusted end | `"2025-12-05 15:07:30.0"` |
| `noteId` | string/null | Linked HiDock note ID | `null` or note ID |

#### Meeting Settings

Each event has associated AI transcription settings:

```json
{
  "id": "5663825132490235904",
  "userId": "5459419178391982080",
  "eventId": "5663825132255354880",
  "createTime": "2025-09-11 23:04:45.092",
  "updateTime": "2025-09-11 23:04:45.092",
  "attendeeCount": null,
  "aiEngine": "openai",
  "mainLanguage": "auto",
  "promptTemplate": "a0d420d597cd401eb23fc57569d01114",
  "operatingSystem": null,
  "title": null
}
```

---

## Google Calendar Integration

### 1. OAuth2 Authorization Flow

**Flow Type**: Authorization Code Flow (OAuth 2.0)

#### Step 1: Initiate Authorization

Desktop app opens browser to Google authorization endpoint:

```
GET https://accounts.google.com/o/oauth2/auth
```

**Query Parameters**:
```
client_id=122776600569-vi9kuatv0lltcut7f8hrpq5e5ln7qf3j.apps.googleusercontent.com
redirect_uri=https://hinotes.hidock.com/auth
response_type=code
scope=openid https://www.googleapis.com/auth/calendar
access_type=offline
prompt=consent
state={"calendar":{"read":true,"write":true},"contact":{"read":false,"write":false},"platform":"google"}
```

**Parameter Details**:
| Parameter | Value | Purpose |
|-----------|-------|---------|
| `client_id` | `122776600569-vi9kuatv0lltcut7f8hrpq5e5ln7qf3j...` | HiDock's Google OAuth client ID |
| `response_type` | `code` | Authorization Code Flow |
| `redirect_uri` | `https://hinotes.hidock.com/auth` | Callback URL |
| `scope` | `openid https://www.googleapis.com/auth/calendar` | Permissions |
| `access_type` | `offline` | Request refresh token |
| `prompt` | `consent` | Always show consent screen |
| `state` | JSON object | Custom state tracking |

**Scopes**:
- `openid`: OpenID Connect authentication
- `https://www.googleapis.com/auth/calendar`: Full calendar read/write access

**State Parameter** (JSON):
```json
{
  "calendar": {
    "read": true,
    "write": true
  },
  "contact": {
    "read": false,
    "write": false
  },
  "platform": "google"
}
```

#### Step 2: User Authentication & Consent

User sees Google login page where they:
1. Select/enter Google account
2. Review calendar permissions
3. Click "Allow"

**User Experience**: Standard Google consent screen showing:
- App name: "HiDock"
- Requested permissions: "See, edit, share, and permanently delete all calendars you can access using Google Calendar"

#### Step 3: Authorization Code Callback

Google redirects browser back to:

```
GET https://hinotes.hidock.com/auth?state={STATE_JSON}&code={AUTHORIZATION_CODE}&scope={GRANTED_SCOPES}
```

**Example**:
```
https://hinotes.hidock.com/auth?state=%7B%22calendar%22:%7B%22read%22:true,%22write%22:true%7D,%22contact%22:%7B%22read%22:false,%22write%22:false%7D,%22platform%22:%22google%22%7D&code=4/0Ab32j93JpAyXMUmmErgIfH6DMesTpL1gAQ9hQiLUbQdonPIDKyzteBGyGgmMcki7NpULFQ&scope=https://www.googleapis.com/auth/calendar openid
```

**Query Parameters**:
- `code`: Authorization code (long-lived, single use)
- `state`: Original state parameter (echoed back)
- `scope`: Space-separated granted scopes

#### Step 4: Token Exchange (Backend)

Frontend sends authorization code to backend:

```http
POST https://hinotes.hidock.com/v1/calendar/oauth2/authorize
Content-Type: application/json
AccessToken: {USER_SESSION_TOKEN}

{
  "code": "4/0Ab32j93JpAyXMUmmErgIfH6DMesT...",
  "platform": "google",
  "scope_list": [
    {
      "action": ["read", "write"],
      "type": "calendar"
    }
  ]
}
```

**Backend Process** (not visible in HAR):
1. Validates authorization code
2. Exchanges code for tokens with Google Token Endpoint:
   ```
   POST https://oauth2.googleapis.com/token
   ```
3. Receives access token + refresh token
4. Stores tokens securely
5. Returns success

**Response**:
```json
{
  "error": 0,
  "message": "success",
  "data": null
}
```

#### Step 5: Sync Calendar (Initial)

Frontend triggers initial calendar sync:

```http
POST https://hinotes.hidock.com/v1/calendar/google/sync
AccessToken: {USER_SESSION_TOKEN}
```

**Response**:
```json
{
  "error": 0,
  "message": "success",
  "data": null
}
```

---

### 2. Calendar API Endpoints

Identical to Microsoft Outlook endpoints (shared backend interface):

#### Check Connection Status

```http
POST https://hinotes.hidock.com/v1/calendar/status
AccessToken: {USER_SESSION_TOKEN}
```

#### Fetch Calendar Events

```http
GET https://hinotes.hidock.com/v1/calendar/event/list?start_time=2025-10-26+00:00:00&end_time=2025-12-06+23:59:59&tz_offset=180
AccessToken: {USER_SESSION_TOKEN}
```

**Response format identical to Microsoft** - backend normalizes Google Calendar data to same structure.

#### Trigger Calendar Sync

```http
POST https://hinotes.hidock.com/v1/calendar/google/sync
AccessToken: {USER_SESSION_TOKEN}
```

---

### 3. Event Data Structure

**Same structure as Microsoft events** - backend provides unified interface regardless of provider.

---

## Side-by-Side Comparison

| Feature | Microsoft Outlook/O365 | Google Calendar |
|---------|------------------------|-----------------|
| **OAuth Endpoint** | `login.microsoftonline.com/common/oauth2/v2.0/authorize` | `accounts.google.com/o/oauth2/auth` |
| **Token Endpoint** | `login.microsoftonline.com/common/oauth2/v2.0/token` | `oauth2.googleapis.com/token` |
| **Client ID** | `287048ad-e335-4cbd-8d76-658acb0785d5` | `122776600569-vi9kuatv0lltcut7f8hrpq5e5ln7qf3j.apps.googleusercontent.com` |
| **Redirect URI** | `https://hinotes.hidock.com/auth` | `https://hinotes.hidock.com/auth` |
| **Scopes (Read)** | `openid offline_access Calendars.Read` | `openid https://www.googleapis.com/auth/calendar` |
| **Scopes (Write)** | `openid offline_access Calendars.ReadWrite` | Same as read (full access) |
| **Refresh Token** | `offline_access` scope | `access_type=offline` parameter |
| **Consent Prompt** | `prompt=select_account` | `prompt=consent` |
| **State Parameter** | JSON with `platform: "microsoft"` | JSON with `platform: "google"` |
| **Backend Sync** | `POST /v1/calendar/microsoft/sync` | `POST /v1/calendar/google/sync` |
| **Calendar API** | Microsoft Graph API (v1.0) | Google Calendar API (v3) |
| **Graph Endpoint** | `https://graph.microsoft.com/v1.0/me/calendar` | `https://www.googleapis.com/calendar/v3/calendars/primary/events` |
| **Event Format** | Normalized by backend | Normalized by backend |

---

## Implementation Guide for HiDock Desktop App

### Requirements

1. **HTTP Library**: `requests` (already in project)
2. **Web Browser Integration**:
   - `webbrowser` module (standard library)
   - OR embedded browser (e.g., `webview`, `cefpython`)
3. **Local HTTP Server**: To receive OAuth callback
   - `http.server` (standard library)
   - OR use HiDock web interface as intermediary

### Implementation Strategy

There are **two approaches** to implement calendar integration in the desktop app:

#### Approach 1: Local Callback Server (Recommended for Desktop)

**Architecture**:
```
Desktop App → Opens Browser → OAuth Provider → Redirects to localhost:PORT → Desktop App Receives Code
```

**Pros**:
- Works offline after initial auth
- No dependency on HiDock web interface
- Full control over user experience

**Cons**:
- Need to register `http://localhost:PORT` as redirect URI
- Firewall/port issues on some systems
- More complex implementation

**Implementation Steps**:

1. **Start Local HTTP Server**:
   ```python
   import http.server
   import urllib.parse
   from threading import Thread

   class OAuthCallbackHandler(http.server.BaseHTTPRequestHandler):
       auth_code = None

       def do_GET(self):
           # Parse query parameters
           query = urllib.parse.urlparse(self.path).query
           params = urllib.parse.parse_qs(query)

           if 'code' in params:
               OAuthCallbackHandler.auth_code = params['code'][0]

               # Return success page
               self.send_response(200)
               self.send_header('Content-type', 'text/html')
               self.end_headers()
               self.wfile.write(b"<html><body><h1>Success!</h1><p>You can close this window.</p></body></html>")
           else:
               self.send_error(400, "Missing authorization code")

   def start_callback_server(port=8080):
       server = http.server.HTTPServer(('localhost', port), OAuthCallbackHandler)
       thread = Thread(target=server.handle_request)
       thread.start()
       return server
   ```

2. **Initiate OAuth Flow**:
   ```python
   import webbrowser
   import urllib.parse
   import json

   def start_oauth_flow(provider='microsoft', port=8080):
       # Start local server
       server = start_callback_server(port)

       # Build OAuth URL
       if provider == 'microsoft':
           auth_url = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
           params = {
               'client_id': 'YOUR_CLIENT_ID',  # Register your own app
               'response_type': 'code',
               'redirect_uri': f'http://localhost:{port}/callback',
               'scope': 'openid offline_access Calendars.Read',
               'prompt': 'select_account',
               'state': json.dumps({
                   'calendar': {'read': True, 'write': False},
                   'platform': 'microsoft'
               })
           }
       else:  # google
           auth_url = "https://accounts.google.com/o/oauth2/auth"
           params = {
               'client_id': 'YOUR_CLIENT_ID.apps.googleusercontent.com',
               'response_type': 'code',
               'redirect_uri': f'http://localhost:{port}/callback',
               'scope': 'openid https://www.googleapis.com/auth/calendar',
               'access_type': 'offline',
               'prompt': 'consent',
               'state': json.dumps({
                   'calendar': {'read': True, 'write': True},
                   'platform': 'google'
               })
           }

       # Build full URL
       full_url = f"{auth_url}?{urllib.parse.urlencode(params)}"

       # Open browser
       webbrowser.open(full_url)

       # Wait for callback (with timeout)
       import time
       timeout = 120  # 2 minutes
       start_time = time.time()

       while OAuthCallbackHandler.auth_code is None:
           if time.time() - start_time > timeout:
               raise TimeoutError("OAuth authorization timed out")
           time.sleep(0.5)

       # Get the code
       auth_code = OAuthCallbackHandler.auth_code
       OAuthCallbackHandler.auth_code = None  # Reset for next use

       return auth_code
   ```

3. **Exchange Code for Tokens**:
   ```python
   import requests

   def exchange_code_for_tokens(auth_code, provider='microsoft', redirect_uri='http://localhost:8080/callback'):
       if provider == 'microsoft':
           token_url = "https://login.microsoftonline.com/common/oauth2/v2.0/token"
           data = {
               'client_id': 'YOUR_CLIENT_ID',
               'client_secret': 'YOUR_CLIENT_SECRET',  # Store securely!
               'code': auth_code,
               'redirect_uri': redirect_uri,
               'grant_type': 'authorization_code'
           }
       else:  # google
           token_url = "https://oauth2.googleapis.com/token"
           data = {
               'client_id': 'YOUR_CLIENT_ID.apps.googleusercontent.com',
               'client_secret': 'YOUR_CLIENT_SECRET',
               'code': auth_code,
               'redirect_uri': redirect_uri,
               'grant_type': 'authorization_code'
           }

       response = requests.post(token_url, data=data)
       response.raise_for_status()

       tokens = response.json()
       # tokens = {
       #     'access_token': '...',
       #     'refresh_token': '...',
       #     'expires_in': 3600,
       #     'token_type': 'Bearer'
       # }

       return tokens
   ```

4. **Store Tokens Securely**:
   ```python
   import json
   import os
   from cryptography.fernet import Fernet

   # Generate encryption key (do this once, store securely)
   # key = Fernet.generate_key()

   def save_tokens(tokens, provider, config_dir='~/.hidock'):
       config_dir = os.path.expanduser(config_dir)
       os.makedirs(config_dir, exist_ok=True)

       # Load encryption key
       key_file = os.path.join(config_dir, '.key')
       if os.path.exists(key_file):
           with open(key_file, 'rb') as f:
               key = f.read()
       else:
           key = Fernet.generate_key()
           with open(key_file, 'wb') as f:
               f.write(key)

       # Encrypt tokens
       fernet = Fernet(key)
       encrypted = fernet.encrypt(json.dumps(tokens).encode())

       # Save to file
       token_file = os.path.join(config_dir, f'{provider}_tokens.enc')
       with open(token_file, 'wb') as f:
           f.write(encrypted)

   def load_tokens(provider, config_dir='~/.hidock'):
       config_dir = os.path.expanduser(config_dir)

       # Load encryption key
       key_file = os.path.join(config_dir, '.key')
       with open(key_file, 'rb') as f:
           key = f.read()

       # Load and decrypt tokens
       token_file = os.path.join(config_dir, f'{provider}_tokens.enc')
       with open(token_file, 'rb') as f:
           encrypted = f.read()

       fernet = Fernet(key)
       decrypted = fernet.decrypt(encrypted)

       return json.loads(decrypted)
   ```

5. **Refresh Access Token**:
   ```python
   def refresh_access_token(refresh_token, provider='microsoft'):
       if provider == 'microsoft':
           token_url = "https://login.microsoftonline.com/common/oauth2/v2.0/token"
           data = {
               'client_id': 'YOUR_CLIENT_ID',
               'client_secret': 'YOUR_CLIENT_SECRET',
               'refresh_token': refresh_token,
               'grant_type': 'refresh_token'
           }
       else:  # google
           token_url = "https://oauth2.googleapis.com/token"
           data = {
               'client_id': 'YOUR_CLIENT_ID.apps.googleusercontent.com',
               'client_secret': 'YOUR_CLIENT_SECRET',
               'refresh_token': refresh_token,
               'grant_type': 'refresh_token'
           }

       response = requests.post(token_url, data=data)
       response.raise_for_status()

       return response.json()
   ```

6. **Fetch Calendar Events**:
   ```python
   def get_calendar_events(access_token, provider='microsoft', start_date='2025-01-01', end_date='2025-12-31'):
       if provider == 'microsoft':
           # Microsoft Graph API
           url = "https://graph.microsoft.com/v1.0/me/calendarView"
           headers = {
               'Authorization': f'Bearer {access_token}',
               'Content-Type': 'application/json'
           }
           params = {
               'startDateTime': f'{start_date}T00:00:00Z',
               'endDateTime': f'{end_date}T23:59:59Z',
               '$orderby': 'start/dateTime',
               '$top': 100
           }
       else:  # google
           # Google Calendar API
           url = "https://www.googleapis.com/calendar/v3/calendars/primary/events"
           headers = {
               'Authorization': f'Bearer {access_token}'
           }
           params = {
               'timeMin': f'{start_date}T00:00:00Z',
               'timeMax': f'{end_date}T23:59:59Z',
               'orderBy': 'startTime',
               'singleEvents': 'true',
               'maxResults': 100
           }

       response = requests.get(url, headers=headers, params=params)
       response.raise_for_status()

       return response.json()
   ```

7. **Complete Integration Class**:
   ```python
   import time
   from datetime import datetime, timedelta

   class CalendarService:
       def __init__(self, provider='microsoft', client_id=None, client_secret=None):
           self.provider = provider
           self.client_id = client_id
           self.client_secret = client_secret
           self.tokens = None
           self.token_expiry = None

       def authenticate(self):
           """Start OAuth flow and get tokens"""
           # Get authorization code
           auth_code = start_oauth_flow(self.provider)

           # Exchange for tokens
           self.tokens = exchange_code_for_tokens(auth_code, self.provider)

           # Calculate expiry
           self.token_expiry = datetime.now() + timedelta(seconds=self.tokens['expires_in'])

           # Save tokens
           save_tokens(self.tokens, self.provider)

           return True

       def load_saved_tokens(self):
           """Load previously saved tokens"""
           try:
               self.tokens = load_tokens(self.provider)
               # Assume token might be expired, will refresh on first use
               self.token_expiry = datetime.now()
               return True
           except FileNotFoundError:
               return False

       def ensure_valid_token(self):
           """Ensure we have a valid access token"""
           if self.tokens is None:
               raise Exception("Not authenticated. Call authenticate() first.")

           # Check if token expired or about to expire
           if datetime.now() >= self.token_expiry - timedelta(minutes=5):
               # Refresh token
               new_tokens = refresh_access_token(self.tokens['refresh_token'], self.provider)

               # Update access token, keep refresh token if not provided
               self.tokens['access_token'] = new_tokens['access_token']
               if 'refresh_token' in new_tokens:
                   self.tokens['refresh_token'] = new_tokens['refresh_token']

               self.token_expiry = datetime.now() + timedelta(seconds=new_tokens['expires_in'])

               # Save updated tokens
               save_tokens(self.tokens, self.provider)

       def get_events(self, start_date, end_date):
           """Fetch calendar events"""
           self.ensure_valid_token()

           events_data = get_calendar_events(
               self.tokens['access_token'],
               self.provider,
               start_date,
               end_date
           )

           # Normalize event format
           return self._normalize_events(events_data)

       def _normalize_events(self, events_data):
           """Convert provider-specific format to unified format"""
           normalized = []

           if self.provider == 'microsoft':
               events = events_data.get('value', [])
               for event in events:
                   normalized.append({
                       'id': event['id'],
                       'title': event.get('subject', ''),
                       'start_time': event['start']['dateTime'],
                       'end_time': event['end']['dateTime'],
                       'location': event.get('location', {}).get('displayName', ''),
                       'organizer': event.get('organizer', {}).get('emailAddress', {}).get('address', ''),
                       'status': event.get('responseStatus', {}).get('response', ''),
                       'is_teams_meeting': event.get('isOnlineMeeting', False),
                       'online_meeting_url': event.get('onlineMeeting', {}).get('joinUrl', '')
                   })
           else:  # google
               events = events_data.get('items', [])
               for event in events:
                   start = event['start'].get('dateTime', event['start'].get('date'))
                   end = event['end'].get('dateTime', event['end'].get('date'))

                   normalized.append({
                       'id': event['id'],
                       'title': event.get('summary', ''),
                       'start_time': start,
                       'end_time': end,
                       'location': event.get('location', ''),
                       'organizer': event.get('organizer', {}).get('email', ''),
                       'status': event.get('status', ''),
                       'is_teams_meeting': 'hangoutLink' in event,
                       'online_meeting_url': event.get('hangoutLink', '')
                   })

           return normalized
   ```

8. **Usage Example**:
   ```python
   # Initialize calendar service
   calendar = CalendarService(
       provider='microsoft',
       client_id='YOUR_CLIENT_ID',
       client_secret='YOUR_CLIENT_SECRET'
   )

   # Try to load saved tokens
   if not calendar.load_saved_tokens():
       # First time - need to authenticate
       calendar.authenticate()

   # Get events for next 7 days
   from datetime import date, timedelta
   start = date.today().isoformat()
   end = (date.today() + timedelta(days=7)).isoformat()

   events = calendar.get_events(start, end)

   for event in events:
       print(f"{event['title']} - {event['start_time']}")
   ```

#### Approach 2: Use HiDock Web Backend (Easier, Current Implementation)

**Architecture**:
```
Desktop App → Opens Browser → HiDock Web → OAuth Provider → Callback to Web → Desktop App Polls Status
```

**Pros**:
- Simpler implementation
- No need to register separate OAuth app
- Backend handles all API calls
- Unified event format

**Cons**:
- Requires internet connection
- Dependent on HiDock web service
- Less control over user experience

**Implementation Steps**:

1. **Check if User is Logged In to HiDock**:
   ```python
   import requests

   def get_hidock_access_token():
       """Get AccessToken from config or prompt user to login"""
       # Load from config
       access_token = config.get('hidock_access_token')

       if not access_token:
           # User needs to login to HiDock first
           # Open HiDock login page
           import webbrowser
           webbrowser.open('https://hinotes.hidock.com/login')

           # Prompt for access token (or implement web login flow)
           access_token = input("Enter your HiDock access token: ")

           # Save to config
           config.set('hidock_access_token', access_token)

       return access_token
   ```

2. **Initiate Calendar Connection**:
   ```python
   def connect_calendar(provider='microsoft'):
       """Open browser to connect calendar"""
       access_token = get_hidock_access_token()

       # Build OAuth URL (same as web app)
       if provider == 'microsoft':
           auth_url = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
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
       else:  # google
           auth_url = "https://accounts.google.com/o/oauth2/auth"
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

       full_url = f"{auth_url}?{urllib.parse.urlencode(params)}"

       # Open browser
       import webbrowser
       webbrowser.open(full_url)

       # Poll for connection status
       print("Please complete the authorization in your browser...")

       for i in range(60):  # Try for 60 seconds
           time.sleep(1)

           status = check_calendar_status(access_token)
           if status['connected']:
               print("Calendar connected successfully!")
               return True

       print("Timeout waiting for calendar connection")
       return False
   ```

3. **Check Calendar Connection Status**:
   ```python
   def check_calendar_status(access_token):
       """Check if calendar is connected"""
       url = "https://hinotes.hidock.com/v1/calendar/status"
       headers = {
           'AccessToken': access_token,
           'Content-Type': 'application/x-www-form-urlencoded'
       }

       response = requests.post(url, headers=headers)
       response.raise_for_status()

       data = response.json()
       return data['data']  # {'connected': True/False}
   ```

4. **Sync Calendar Events**:
   ```python
   def sync_calendar(access_token, provider='microsoft'):
       """Trigger backend to sync calendar"""
       url = f"https://hinotes.hidock.com/v1/calendar/{provider}/sync"
       headers = {
           'AccessToken': access_token
       }

       response = requests.post(url, headers=headers)
       response.raise_for_status()

       return response.json()
   ```

5. **Fetch Calendar Events**:
   ```python
   def get_calendar_events(access_token, start_date, end_date, tz_offset=0):
       """Fetch calendar events from HiDock backend"""
       url = "https://hinotes.hidock.com/v1/calendar/event/list"
       headers = {
           'AccessToken': access_token
       }
       params = {
           'start_time': f"{start_date} 00:00:00",
           'end_time': f"{end_date} 23:59:59",
           'tz_offset': tz_offset  # Minutes from UTC (e.g., 180 = UTC+3)
       }

       response = requests.get(url, headers=headers, params=params)
       response.raise_for_status()

       data = response.json()
       return data['data']  # List of date groups with events
   ```

6. **Complete Integration Class**:
   ```python
   class HiDockCalendarService:
       def __init__(self, access_token):
           self.access_token = access_token

       def connect_calendar(self, provider='microsoft'):
           """Connect calendar provider"""
           return connect_calendar(provider)

       def is_connected(self):
           """Check if calendar is connected"""
           status = check_calendar_status(self.access_token)
           return status['connected']

       def sync(self, provider='microsoft'):
           """Sync calendar events from provider"""
           return sync_calendar(self.access_token, provider)

       def get_events(self, start_date, end_date, tz_offset=0):
           """Get calendar events"""
           return get_calendar_events(self.access_token, start_date, end_date, tz_offset)

       def parse_events(self, data):
           """Parse event data into flat list"""
           events = []
           for date_group in data:
               for event_wrapper in date_group['events']:
                   event = event_wrapper['calendarEvent']
                   settings = event_wrapper.get('calendarEventMeetingSetting', {})

                   events.append({
                       'id': event['id'],
                       'title': event['title'],
                       'start_time': event['startTime'],
                       'end_time': event['endTime'],
                       'location': event['location'],
                       'organizer': event['owner'],
                       'status': event['status'],
                       'meeting_type': event['meetingWay'],
                       'ai_engine': settings.get('aiEngine'),
                       'language': settings.get('mainLanguage')
                   })

           return events
   ```

7. **Usage Example**:
   ```python
   # Initialize
   access_token = get_hidock_access_token()
   calendar = HiDockCalendarService(access_token)

   # Connect calendar (first time)
   if not calendar.is_connected():
       calendar.connect_calendar('microsoft')

   # Sync latest events
   calendar.sync('microsoft')

   # Get events for next 7 days
   from datetime import date, timedelta
   start = date.today().isoformat()
   end = (date.today() + timedelta(days=7)).isoformat()

   data = calendar.get_events(start, end)
   events = calendar.parse_events(data)

   for event in events:
       print(f"{event['title']} - {event['start_time']}")
   ```

---

### Comparison: Approach 1 vs Approach 2

| Aspect | Approach 1 (Local OAuth) | Approach 2 (HiDock Backend) |
|--------|-------------------------|----------------------------|
| **Complexity** | High | Low |
| **Setup Required** | Register OAuth app with MS/Google | None (use HiDock's app) |
| **Dependencies** | `requests`, `cryptography` | `requests` only |
| **Internet Required** | Only during auth | Always |
| **Token Management** | App manages tokens | Backend manages tokens |
| **API Calls** | Direct to MS Graph / Google Calendar | Through HiDock backend |
| **Data Format** | Provider-specific, need normalization | Pre-normalized by backend |
| **Privacy** | Tokens stored locally | Tokens stored on HiDock servers |
| **Offline Support** | Yes (after auth) | No |
| **Maintenance** | Handle API changes yourself | HiDock handles API changes |

**Recommendation**:
- Use **Approach 2** for faster implementation and easier maintenance
- Switch to **Approach 1** later if you need:
  - Offline calendar access
  - Full control over data
  - Independence from HiDock backend

---

## Calendar API Documentation

### Microsoft Graph API

**Base URL**: `https://graph.microsoft.com/v1.0`

**Key Endpoints**:
- `GET /me/calendar` - Get user's default calendar
- `GET /me/calendars` - List all calendars
- `GET /me/calendarView?startDateTime={start}&endDateTime={end}` - Get events in date range
- `POST /me/events` - Create new event
- `PATCH /me/events/{id}` - Update event
- `DELETE /me/events/{id}` - Delete event

**Authorization Header**:
```
Authorization: Bearer {access_token}
```

**Example Event Object**:
```json
{
  "id": "AAMkAGEyYjA4ZDlkLWMzNjUtNDI3Ny1hZjdhLWY4N2JjZDQ3ZmI5YQ...",
  "subject": "Team Meeting",
  "start": {
    "dateTime": "2025-12-05T14:00:00",
    "timeZone": "UTC"
  },
  "end": {
    "dateTime": "2025-12-05T15:00:00",
    "timeZone": "UTC"
  },
  "location": {
    "displayName": "Microsoft Teams Meeting"
  },
  "organizer": {
    "emailAddress": {
      "name": "John Doe",
      "address": "john@example.com"
    }
  },
  "isOnlineMeeting": true,
  "onlineMeeting": {
    "joinUrl": "https://teams.microsoft.com/l/meetup-join/..."
  },
  "attendees": [
    {
      "emailAddress": {
        "name": "Jane Smith",
        "address": "jane@example.com"
      },
      "status": {
        "response": "accepted",
        "time": "2025-12-01T10:00:00Z"
      }
    }
  ]
}
```

**Documentation**: https://learn.microsoft.com/en-us/graph/api/resources/calendar

---

### Google Calendar API

**Base URL**: `https://www.googleapis.com/calendar/v3`

**Key Endpoints**:
- `GET /calendars/primary` - Get primary calendar
- `GET /users/me/calendarList` - List all calendars
- `GET /calendars/primary/events?timeMin={start}&timeMax={end}` - Get events in date range
- `POST /calendars/primary/events` - Create new event
- `PATCH /calendars/primary/events/{id}` - Update event
- `DELETE /calendars/primary/events/{id}` - Delete event

**Authorization Header**:
```
Authorization: Bearer {access_token}
```

**Example Event Object**:
```json
{
  "id": "abc123xyz",
  "summary": "Team Meeting",
  "start": {
    "dateTime": "2025-12-05T14:00:00Z",
    "timeZone": "UTC"
  },
  "end": {
    "dateTime": "2025-12-05T15:00:00Z",
    "timeZone": "UTC"
  },
  "location": "Google Meet",
  "organizer": {
    "email": "john@example.com",
    "displayName": "John Doe"
  },
  "hangoutLink": "https://meet.google.com/abc-defg-hij",
  "attendees": [
    {
      "email": "jane@example.com",
      "displayName": "Jane Smith",
      "responseStatus": "accepted"
    }
  ],
  "status": "confirmed"
}
```

**Documentation**: https://developers.google.com/calendar/api/v3/reference

---

## Error Handling

### Common OAuth Errors

| Error Code | Description | Solution |
|------------|-------------|----------|
| `invalid_client` | Invalid client ID/secret | Verify OAuth app credentials |
| `invalid_grant` | Invalid or expired authorization code | Restart OAuth flow |
| `redirect_uri_mismatch` | Redirect URI doesn't match registered | Check OAuth app config |
| `access_denied` | User declined authorization | Prompt user to try again |
| `invalid_scope` | Invalid scope requested | Check available scopes |
| `unauthorized_client` | App not authorized for grant type | Check OAuth app settings |

### Token Refresh Errors

```python
def safe_api_call(func):
    """Decorator to handle token expiration"""
    def wrapper(self, *args, **kwargs):
        try:
            return func(self, *args, **kwargs)
        except requests.HTTPError as e:
            if e.response.status_code == 401:
                # Token expired, refresh and retry
                self.ensure_valid_token()
                return func(self, *args, **kwargs)
            else:
                raise
    return wrapper
```

### API Rate Limits

**Microsoft Graph**:
- 10,000 requests per 10 minutes per user
- Use `Retry-After` header on 429 responses

**Google Calendar**:
- 1,000,000 queries per day
- 10 queries per second per user
- Use exponential backoff on rate limit errors

---

## Security Best Practices

### Token Storage

1. **Never store in plain text**
   - Encrypt tokens at rest
   - Use OS keychain/credential manager when possible

2. **Never commit to version control**
   - Add token files to `.gitignore`
   - Use environment variables for client secrets

3. **Minimal scope principle**
   - Only request scopes you need
   - Use read-only scopes when possible

### Client Secret Management

```python
import os

# Load from environment
CLIENT_SECRET = os.environ.get('CALENDAR_CLIENT_SECRET')

# Or from secure config file (encrypted)
import json
from cryptography.fernet import Fernet

def load_secret():
    with open('.secret.key', 'rb') as f:
        key = f.read()

    fernet = Fernet(key)

    with open('config.enc', 'rb') as f:
        encrypted_config = f.read()

    decrypted = fernet.decrypt(encrypted_config)
    config = json.loads(decrypted)

    return config['client_secret']
```

### Network Security

1. **Use HTTPS only**
   - Never send tokens over HTTP
   - Validate SSL certificates

2. **Implement timeout**
   ```python
   response = requests.get(url, headers=headers, timeout=10)
   ```

3. **Validate redirect URIs**
   ```python
   from urllib.parse import urlparse

   def is_valid_redirect(uri):
       parsed = urlparse(uri)
       return parsed.scheme == 'https' and parsed.netloc == 'hinotes.hidock.com'
   ```

---

## Testing

### Mock OAuth Flow

```python
import unittest
from unittest.mock import patch, MagicMock

class TestCalendarIntegration(unittest.TestCase):

    @patch('webbrowser.open')
    @patch('requests.post')
    def test_oauth_flow(self, mock_post, mock_browser):
        # Mock authorization code callback
        OAuthCallbackHandler.auth_code = 'test_auth_code'

        # Mock token exchange
        mock_post.return_value = MagicMock(
            status_code=200,
            json=lambda: {
                'access_token': 'test_access_token',
                'refresh_token': 'test_refresh_token',
                'expires_in': 3600
            }
        )

        # Test OAuth flow
        calendar = CalendarService('microsoft', 'test_client_id', 'test_secret')
        result = calendar.authenticate()

        self.assertTrue(result)
        self.assertIsNotNone(calendar.tokens)
        self.assertEqual(calendar.tokens['access_token'], 'test_access_token')

    @patch('requests.get')
    def test_get_events(self, mock_get):
        # Mock API response
        mock_get.return_value = MagicMock(
            status_code=200,
            json=lambda: {
                'value': [
                    {
                        'id': '123',
                        'subject': 'Test Event',
                        'start': {'dateTime': '2025-12-05T14:00:00'},
                        'end': {'dateTime': '2025-12-05T15:00:00'}
                    }
                ]
            }
        )

        calendar = CalendarService('microsoft')
        calendar.tokens = {'access_token': 'test_token'}
        calendar.token_expiry = datetime.now() + timedelta(hours=1)

        events = calendar.get_events('2025-12-01', '2025-12-31')

        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]['title'], 'Test Event')
```

---

## Appendix: Complete cURL Examples

### Microsoft OAuth Flow

```bash
# Step 1: Authorization (open in browser)
https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=287048ad-e335-4cbd-8d76-658acb0785d5&response_type=code&redirect_uri=https://hinotes.hidock.com/auth&scope=openid%20offline_access%20Calendars.Read&prompt=select_account&state=%7B%22calendar%22%3A%7B%22read%22%3Atrue%2C%22write%22%3Afalse%7D%2C%22platform%22%3A%22microsoft%22%7D

# Step 2: Token Exchange
curl -X POST https://login.microsoftonline.com/common/oauth2/v2.0/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "client_secret=YOUR_CLIENT_SECRET" \
  -d "code=AUTHORIZATION_CODE" \
  -d "redirect_uri=http://localhost:8080/callback" \
  -d "grant_type=authorization_code"

# Step 3: Get Calendar Events
curl -X GET "https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=2025-12-01T00:00:00Z&endDateTime=2025-12-31T23:59:59Z" \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "Content-Type: application/json"

# Step 4: Refresh Token
curl -X POST https://login.microsoftonline.com/common/oauth2/v2.0/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "client_secret=YOUR_CLIENT_SECRET" \
  -d "refresh_token=REFRESH_TOKEN" \
  -d "grant_type=refresh_token"
```

### Google OAuth Flow

```bash
# Step 1: Authorization (open in browser)
https://accounts.google.com/o/oauth2/auth?client_id=122776600569-vi9kuatv0lltcut7f8hrpq5e5ln7qf3j.apps.googleusercontent.com&redirect_uri=https://hinotes.hidock.com/auth&response_type=code&scope=openid%20https://www.googleapis.com/auth/calendar&access_type=offline&prompt=consent&state=%7B%22calendar%22%3A%7B%22read%22%3Atrue%2C%22write%22%3Atrue%7D%2C%22platform%22%3A%22google%22%7D

# Step 2: Token Exchange
curl -X POST https://oauth2.googleapis.com/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=YOUR_CLIENT_ID.apps.googleusercontent.com" \
  -d "client_secret=YOUR_CLIENT_SECRET" \
  -d "code=AUTHORIZATION_CODE" \
  -d "redirect_uri=http://localhost:8080/callback" \
  -d "grant_type=authorization_code"

# Step 3: Get Calendar Events
curl -X GET "https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=2025-12-01T00:00:00Z&timeMax=2025-12-31T23:59:59Z&orderBy=startTime&singleEvents=true" \
  -H "Authorization: Bearer ACCESS_TOKEN"

# Step 4: Refresh Token
curl -X POST https://oauth2.googleapis.com/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=YOUR_CLIENT_ID.apps.googleusercontent.com" \
  -d "client_secret=YOUR_CLIENT_SECRET" \
  -d "refresh_token=REFRESH_TOKEN" \
  -d "grant_type=refresh_token"
```

### HiDock Backend API

```bash
# Step 1: Check Calendar Status
curl -X POST https://hinotes.hidock.com/v1/calendar/status \
  -H "AccessToken: YOUR_HIDOCK_ACCESS_TOKEN" \
  -H "Content-Type: application/x-www-form-urlencoded"

# Step 2: Sync Calendar
curl -X POST https://hinotes.hidock.com/v1/calendar/microsoft/sync \
  -H "AccessToken: YOUR_HIDOCK_ACCESS_TOKEN"

# Step 3: Get Events
curl -X GET "https://hinotes.hidock.com/v1/calendar/event/list?start_time=2025-12-01+00:00:00&end_time=2025-12-31+23:59:59&tz_offset=0" \
  -H "AccessToken: YOUR_HIDOCK_ACCESS_TOKEN"
```

---

## References

- [Microsoft Identity Platform OAuth 2.0](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow)
- [Microsoft Graph API Calendar](https://learn.microsoft.com/en-us/graph/api/resources/calendar)
- [Google OAuth 2.0](https://developers.google.com/identity/protocols/oauth2)
- [Google Calendar API](https://developers.google.com/calendar/api/v3/reference)
- [OAuth 2.0 RFC 6749](https://datatracker.ietf.org/doc/html/rfc6749)
- [RFC 6750 - Bearer Token Usage](https://datatracker.ietf.org/doc/html/rfc6750)

---

**Document Version**: 1.0
**Last Updated**: 2025-11-06
**Author**: Extracted from HAR file analysis
