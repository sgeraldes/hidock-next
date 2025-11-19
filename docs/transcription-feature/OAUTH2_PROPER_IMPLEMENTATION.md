# OAuth2 Proper Implementation Guide - Desktop App

## Overview

We're implementing **direct OAuth2 authentication** with Microsoft and Google, just like HiNotes does. This means:

- ✅ Our own OAuth app registrations (Microsoft Azure AD + Google Cloud)
- ✅ Industry-standard OAuth2 flows
- ✅ Direct API access (no middleman)
- ✅ Production-ready security

## What HiNotes Does (Analysis from HAR)

### Microsoft OAuth Flow (HiNotes):
```
Authorization URL: https://login.microsoftonline.com/common/oauth2/v2.0/authorize
Client ID: 287048ad-e335-4cbd-8d76-658acb0785d5
Redirect URI: https://hinotes.hidock.com/auth
Scopes: openid offline_access Calendars.Read
Response Type: code (authorization code flow)
```

### Google OAuth Flow (HiNotes):
```
Authorization URL: https://accounts.google.com/o/oauth2/v2/auth
Client ID: 122776600569-vi9kuatv0lltcut7f8hrpq5e5ln7qf3j.apps.googleusercontent.com
Redirect URI: https://hinotes.hidock.com/auth
Scopes: openid https://www.googleapis.com/auth/calendar
Response Type: code
```

**Key Observation:** HiNotes uses **web-based OAuth** with their own domain as redirect URI.

## The Proper Way for Desktop App

For a **desktop application**, we have 3 proper approaches:

### ✅ **Approach 1: Localhost Redirect (Recommended)**

**How it works:**
1. Desktop app starts local HTTP server on `http://localhost:8080/callback`
2. Opens browser to OAuth URL with redirect to localhost
3. User logs in via browser
4. Browser redirects to `http://localhost:8080/callback?code=...`
5. Local server captures authorization code
6. App exchanges code for access token
7. Local server shuts down

**Pros:**
- Standard OAuth2 flow
- No custom domain needed
- Works offline after initial auth
- Secure (localhost is trusted)

**Cons:**
- Need to open port on localhost
- Slightly more complex setup

### ✅ **Approach 2: Device Code Flow (Simplest)**

**How it works:**
1. App requests device code from OAuth provider
2. App shows user a code (e.g., "ABC-DEF-123")
3. App shows URL: "Go to microsoft.com/devicelogin"
4. User enters code on any device
5. App polls OAuth provider until user completes
6. App receives access token

**Pros:**
- Simplest implementation
- No web server needed
- Works on any device
- Great for CLI/console apps

**Cons:**
- Extra step for user (manual code entry)
- Slightly less polished UX

### ✅ **Approach 3: PKCE Flow with Localhost (Most Secure)**

**How it works:**
- Same as Approach 1, but adds PKCE (Proof Key for Code Exchange)
- Generates `code_verifier` and `code_challenge`
- No client secret needed (public client)
- Protects against authorization code interception

**Pros:**
- Most secure for public clients
- Industry best practice
- Microsoft/Google recommended

**Cons:**
- More complex implementation
- Requires PKCE support (both providers support it)

---

## **Recommendation: PKCE with Localhost**

This is the **proper, production-ready approach** for desktop apps:
- Secure (PKCE protects against MITM attacks)
- Standard (OAuth 2.1 recommended flow)
- Good UX (browser-based login)
- No client secret needed

---

## Implementation Plan

### Phase 1: Register OAuth Apps

#### A. Microsoft Azure AD

**Steps:**
1. Go to: https://portal.azure.com
2. Navigate to: **Azure Active Directory** → **App registrations** → **New registration**
3. Fill in:
   - **Name:** "HiDock Desktop - Calendar Integration"
   - **Supported account types:** "Accounts in any organizational directory and personal Microsoft accounts"
   - **Redirect URI:**
     - Platform: **Public client/native (mobile & desktop)**
     - URI: `http://localhost:8080/callback`
4. Click **Register**

**After Registration:**
- Copy **Application (client) ID** → We'll need this
- Go to **Authentication** tab:
  - Enable "Allow public client flows" → **Yes**
  - Add platform: **Mobile and desktop applications**
  - Add redirect URI: `http://localhost:8080/callback`
- Go to **API permissions** tab:
  - Add permission → **Microsoft Graph** → **Delegated permissions**
  - Add: `Calendars.Read`
  - Add: `offline_access` (for refresh tokens)
  - Add: `User.Read` (basic profile)

**No client secret needed** (public client with PKCE)

#### B. Google Cloud Console

**Steps:**
1. Go to: https://console.cloud.google.com
2. Create new project: **"HiDock Desktop Calendar"**
3. Enable **Google Calendar API**:
   - Library → Search "Google Calendar API" → Enable
4. Create OAuth credentials:
   - Credentials → **Create Credentials** → **OAuth client ID**
   - Application type: **Desktop app**
   - Name: "HiDock Desktop"
   - Click **Create**

**After Creation:**
- Download JSON credentials file
- Copy **Client ID** and **Client Secret**
- Add authorized redirect URI: `http://localhost:8080/callback`

**OAuth consent screen:**
- User type: **External** (for public use)
- App name: "HiDock Desktop"
- Scopes: Add `https://www.googleapis.com/auth/calendar.readonly`

---

### Phase 2: Implementation Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    Desktop Application                       │
│                                                              │
│  ┌────────────────────────────────────────────────────┐     │
│  │  OAuth Manager                                     │     │
│  │  - Generate PKCE code_verifier/challenge          │     │
│  │  - Start localhost web server                     │     │
│  │  - Open browser to authorization URL              │     │
│  │  - Capture authorization code                     │     │
│  │  - Exchange code for tokens                       │     │
│  │  - Store tokens securely                          │     │
│  └────────────────────────────────────────────────────┘     │
│                       │                                      │
└───────────────────────┼──────────────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────────────────┐
│                    Browser (User)                            │
│  - User logs into Microsoft/Google                           │
│  - User grants calendar permissions                          │
│  - Browser redirects to http://localhost:8080/callback       │
└──────────────────────────────────────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────────────────┐
│              OAuth Provider (Microsoft/Google)               │
│  - Validates login                                           │
│  - Returns authorization code                                │
│  - Exchanges code for access token                           │
│  - Returns refresh token                                     │
└──────────────────────────────────────────────────────────────┘
```

---

### Phase 3: Code Implementation

#### File Structure:
```
apps/desktop/src/
├── oauth2_manager.py          # Main OAuth2 manager
├── oauth2_providers.py        # Microsoft/Google provider configs
├── oauth2_pkce.py            # PKCE helper functions
├── oauth2_server.py          # Localhost callback server
├── microsoft_calendar_api.py  # Direct Microsoft Graph API
├── google_calendar_api.py     # Direct Google Calendar API
└── calendar_oauth_dialog.py   # UI for OAuth flow (updated)
```

#### Key Components:

**1. PKCE Implementation (`oauth2_pkce.py`):**
```python
import base64
import hashlib
import secrets

def generate_code_verifier() -> str:
    """Generate PKCE code verifier (43-128 chars)."""
    return base64.urlsafe_b64encode(secrets.token_bytes(32)).decode('utf-8').rstrip('=')

def generate_code_challenge(verifier: str) -> str:
    """Generate PKCE code challenge from verifier."""
    digest = hashlib.sha256(verifier.encode('utf-8')).digest()
    return base64.urlsafe_b64encode(digest).decode('utf-8').rstrip('=')
```

**2. Localhost Callback Server (`oauth2_server.py`):**
```python
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse
import threading

class OAuth2CallbackHandler(BaseHTTPRequestHandler):
    """Handles OAuth2 redirect callback."""
    authorization_code = None
    error = None

    def do_GET(self):
        """Handle GET request with authorization code."""
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)

        if 'code' in params:
            OAuth2CallbackHandler.authorization_code = params['code'][0]
            self.send_response(200)
            self.send_header('Content-type', 'text/html')
            self.end_headers()
            self.wfile.write(b'<html><body><h1>Success!</h1><p>You can close this window.</p></body></html>')
        elif 'error' in params:
            OAuth2CallbackHandler.error = params['error'][0]
            self.send_response(400)
            self.end_headers()

    def log_message(self, format, *args):
        pass  # Suppress logs

class OAuth2LocalServer:
    """Local HTTP server for OAuth2 callback."""

    def __init__(self, port=8080):
        self.port = port
        self.server = None
        self.thread = None

    def start(self):
        """Start server in background thread."""
        self.server = HTTPServer(('localhost', self.port), OAuth2CallbackHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def wait_for_code(self, timeout=120):
        """Wait for authorization code (blocking)."""
        import time
        start = time.time()
        while time.time() - start < timeout:
            if OAuth2CallbackHandler.authorization_code:
                code = OAuth2CallbackHandler.authorization_code
                OAuth2CallbackHandler.authorization_code = None
                return code
            if OAuth2CallbackHandler.error:
                error = OAuth2CallbackHandler.error
                OAuth2CallbackHandler.error = None
                raise Exception(f"OAuth error: {error}")
            time.sleep(0.5)
        raise TimeoutError("OAuth callback timeout")

    def stop(self):
        """Stop server."""
        if self.server:
            self.server.shutdown()
```

**3. OAuth2 Manager (`oauth2_manager.py`):**
```python
import webbrowser
import requests
from urllib.parse import urlencode
from oauth2_pkce import generate_code_verifier, generate_code_challenge
from oauth2_server import OAuth2LocalServer

class OAuth2Manager:
    """Manages OAuth2 authentication flow."""

    def __init__(self, provider_config):
        self.config = provider_config
        self.server = None

    def authorize(self):
        """Start OAuth2 authorization flow."""
        # 1. Generate PKCE codes
        code_verifier = generate_code_verifier()
        code_challenge = generate_code_challenge(code_verifier)

        # 2. Start local server
        self.server = OAuth2LocalServer(port=8080)
        self.server.start()

        # 3. Build authorization URL
        params = {
            'client_id': self.config['client_id'],
            'response_type': 'code',
            'redirect_uri': 'http://localhost:8080/callback',
            'scope': self.config['scope'],
            'code_challenge': code_challenge,
            'code_challenge_method': 'S256',
            'response_mode': 'query',
        }

        auth_url = f"{self.config['auth_url']}?{urlencode(params)}"

        # 4. Open browser
        webbrowser.open(auth_url)

        # 5. Wait for callback
        try:
            authorization_code = self.server.wait_for_code(timeout=120)

            # 6. Exchange code for tokens
            tokens = self._exchange_code_for_tokens(
                authorization_code,
                code_verifier
            )

            return tokens

        finally:
            self.server.stop()

    def _exchange_code_for_tokens(self, code, verifier):
        """Exchange authorization code for access/refresh tokens."""
        data = {
            'client_id': self.config['client_id'],
            'grant_type': 'authorization_code',
            'code': code,
            'redirect_uri': 'http://localhost:8080/callback',
            'code_verifier': verifier,
        }

        # Add client_secret if provider requires it (Google does, Microsoft doesn't for public clients)
        if 'client_secret' in self.config:
            data['client_secret'] = self.config['client_secret']

        response = requests.post(self.config['token_url'], data=data)
        response.raise_for_status()

        return response.json()
```

**4. Provider Configurations (`oauth2_providers.py`):**
```python
# Microsoft Configuration (for Desktop App - TO BE FILLED AFTER REGISTRATION)
MICROSOFT_CONFIG = {
    'provider': 'microsoft',
    'client_id': 'YOUR_AZURE_APP_CLIENT_ID_HERE',  # From Azure AD registration
    'auth_url': 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    'token_url': 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    'scope': 'openid offline_access Calendars.Read User.Read',
    'graph_endpoint': 'https://graph.microsoft.com/v1.0',
}

# Google Configuration (for Desktop App - TO BE FILLED AFTER REGISTRATION)
GOOGLE_CONFIG = {
    'provider': 'google',
    'client_id': 'YOUR_GOOGLE_CLIENT_ID_HERE',  # From Google Cloud Console
    'client_secret': 'YOUR_GOOGLE_CLIENT_SECRET_HERE',  # Google requires secret even for desktop
    'auth_url': 'https://accounts.google.com/o/oauth2/v2/auth',
    'token_url': 'https://oauth2.googleapis.com/token',
    'scope': 'openid https://www.googleapis.com/auth/calendar.readonly',
    'api_endpoint': 'https://www.googleapis.com/calendar/v3',
}
```

---

### Phase 4: Direct API Access

#### Microsoft Graph API (`microsoft_calendar_api.py`):
```python
import requests
from datetime import datetime

class MicrosoftCalendarAPI:
    """Direct Microsoft Graph API client."""

    def __init__(self, access_token):
        self.access_token = access_token
        self.base_url = 'https://graph.microsoft.com/v1.0'

    def get_events(self, start_date, end_date):
        """Fetch calendar events."""
        url = f"{self.base_url}/me/calendarview"

        params = {
            'startDateTime': start_date.isoformat(),
            'endDateTime': end_date.isoformat(),
            '$select': 'subject,start,end,location,organizer,attendees',
            '$orderby': 'start/dateTime',
            '$top': 100,
        }

        headers = {
            'Authorization': f'Bearer {self.access_token}',
            'Content-Type': 'application/json',
        }

        response = requests.get(url, headers=headers, params=params)
        response.raise_for_status()

        data = response.json()
        return data.get('value', [])
```

#### Google Calendar API (`google_calendar_api.py`):
```python
import requests
from datetime import datetime

class GoogleCalendarAPI:
    """Direct Google Calendar API client."""

    def __init__(self, access_token):
        self.access_token = access_token
        self.base_url = 'https://www.googleapis.com/calendar/v3'

    def get_events(self, start_date, end_date):
        """Fetch calendar events."""
        url = f"{self.base_url}/calendars/primary/events"

        params = {
            'timeMin': start_date.isoformat() + 'Z',
            'timeMax': end_date.isoformat() + 'Z',
            'orderBy': 'startTime',
            'singleEvents': 'true',
            'maxResults': 100,
        }

        headers = {
            'Authorization': f'Bearer {self.access_token}',
        }

        response = requests.get(url, headers=headers, params=params)
        response.raise_for_status()

        data = response.json()
        return data.get('items', [])
```

---

## Security Best Practices

### ✅ **PKCE Flow:**
- Always use PKCE for desktop apps
- Never hardcode client secrets
- Generate unique code_verifier per auth session

### ✅ **Token Storage:**
- Store access/refresh tokens encrypted
- Use OS keychain when possible (macOS Keychain, Windows Credential Manager)
- Never log tokens

### ✅ **Localhost Server:**
- Use random available port if 8080 taken
- Shut down server after receiving callback
- Timeout after 2 minutes

### ✅ **Refresh Tokens:**
- Store refresh tokens securely
- Auto-refresh access tokens before expiry
- Handle refresh token expiry gracefully

---

## User Experience Flow

```
1. User clicks "Connect Calendar"
2. App shows: "Opening browser to sign in..."
3. Browser opens to Microsoft/Google login
4. User logs in with their account
5. Browser shows: "Grant calendar access?"
6. User clicks "Allow"
7. Browser redirects to localhost:8080
8. App receives authorization code
9. App exchanges for access token
10. App shows: "✓ Connected as user@example.com"
11. Browser shows: "Success! You can close this window"
12. App can now access calendar!
```

**Time:** 15-30 seconds total

---

## Configuration Files

**`.gitignore` additions:**
```
# OAuth credentials (NEVER commit these!)
oauth_credentials.json
.oauth_tokens/
client_secret_*.json
```

**Token storage format (`~/.hidock/oauth_tokens.json`):**
```json
{
  "microsoft": {
    "access_token": "eyJ0eXAiOiJKV1QiLCJhbGc...",
    "refresh_token": "0.AXoA_...",
    "expires_at": "2025-11-06T12:30:00Z",
    "scope": "Calendars.Read offline_access"
  },
  "google": {
    "access_token": "ya29.a0AfH6SMB...",
    "refresh_token": "1//0gHfG...",
    "expires_at": "2025-11-06T11:45:00Z",
    "scope": "https://www.googleapis.com/auth/calendar.readonly"
  }
}
```

---

## Testing

### Test Microsoft OAuth:
```python
from oauth2_manager import OAuth2Manager
from oauth2_providers import MICROSOFT_CONFIG

manager = OAuth2Manager(MICROSOFT_CONFIG)
tokens = manager.authorize()

print(f"Access Token: {tokens['access_token'][:20]}...")
print(f"Refresh Token: {tokens.get('refresh_token', 'N/A')[:20]}...")
print(f"Expires In: {tokens.get('expires_in')} seconds")
```

### Test Calendar API:
```python
from microsoft_calendar_api import MicrosoftCalendarAPI
from datetime import datetime, timedelta

api = MicrosoftCalendarAPI(access_token)
events = api.get_events(
    start_date=datetime.now(),
    end_date=datetime.now() + timedelta(days=7)
)

for event in events:
    print(f"- {event['subject']}: {event['start']['dateTime']}")
```

---

## Timeline

### Day 1: Setup (2 hours)
- Register Microsoft Azure AD app
- Register Google Cloud Console app
- Update oauth2_providers.py with credentials

### Day 2: Core Implementation (4-6 hours)
- Implement PKCE helper
- Implement localhost callback server
- Implement OAuth2Manager
- Test Microsoft OAuth flow
- Test Google OAuth flow

### Day 3: API Integration (4-6 hours)
- Implement Microsoft Graph API client
- Implement Google Calendar API client
- Test event fetching
- Handle pagination

### Day 4: Token Management (3-4 hours)
- Implement encrypted token storage
- Implement automatic token refresh
- Handle expiry gracefully

### Day 5: UI Integration (2-3 hours)
- Update calendar connection dialog
- Add provider selection
- Add status indicators
- Test full flow

### Day 6: Polish & Testing (2-3 hours)
- Error handling
- User feedback
- Edge cases
- Production testing

**Total:** 17-24 hours (3-5 days)

---

## Next Steps

1. **You:** Register OAuth apps (1 hour)
   - Microsoft Azure AD
   - Google Cloud Console
   - Get client IDs

2. **Me:** Implement OAuth2 system (1-2 days)
   - PKCE flow
   - Localhost server
   - Token management
   - API clients

3. **Test Together:** Verify everything works (1 hour)

**Ready to register those OAuth apps?** 🚀
