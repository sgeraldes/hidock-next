# HiNotes Authentication System Analysis

**Date:** 2025-11-06
**Analyzed Files:**
- `E:\Code\hidock-next\archive\h1e.calendar.hinotes.hidock.com.har` (Microsoft Calendar)
- `E:\Code\hidock-next\archive\h1e.calendar.hinotes.hidock.com-google-calendar.har` (Google Calendar)

---

## Executive Summary

**Key Finding:** HiNotes uses a **64-character alphanumeric AccessToken** as a custom header for ALL API requests. This token appears to be:
- Generated server-side upon user login
- Stored in browser localStorage/cookies
- Required for every single API endpoint (no public endpoints found)
- A session token (not JWT) that encodes to 48 random bytes

**Critical Discovery:** Both HAR files were captured AFTER login - they do NOT contain the login flow itself. The AccessToken was already present in the first API request, indicating it was loaded from browser storage at page initialization.

---

## Section 1: AccessToken Discovery

### 1.1 Token Format Analysis

**Example Token (from HAR):**
```
2u78Nu6tQ9t2NFNoS4IdJflPDBoDqL2uThyVaeGsUiqFDYJIVXm9anhtNqUC9Nu2
```

**Token Characteristics:**
- **Length:** 64 characters
- **Alphabet:** Alphanumeric only (a-z, A-Z, 0-9) - no special chars like `+`, `/`, `=`
- **Format:** Custom Base64-like encoding (URL-safe alphabet)
- **Decoded:** 48 bytes of binary data (random session identifier)
- **Type:** Opaque session token (NOT JWT - no header/payload/signature structure)

```python
# Decoded token (hex representation):
# daeefc36eead43db763453684b821d25f94f0c1a03a8bdae4e1c9569e1ac522a
# 850d82485579bd6a786d36a502f4dbb6
```

### 1.2 Token Usage Pattern

**HTTP Header:**
```http
AccessToken: 2u78Nu6tQ9t2NFNoS4IdJflPDBoDqL2uThyVaeGsUiqFDYJIVXm9anhtNqUC9Nu2
```

**NOT in:**
- Authorization header (standard OAuth/Bearer pattern)
- Cookies
- Query parameters
- Request body

**Used in ALL API requests:**
- ✅ User info: `/v1/user/info`
- ✅ Calendar sync: `/v1/calendar/oauth2/authorize`
- ✅ Device status: `/v1/user/device/status`
- ✅ Notes: `/v2/note/list`
- ✅ Every single endpoint (23 unique endpoints analyzed)

### 1.3 Token Lifecycle

**Observed Behavior:**
1. Token present from FIRST API request in HAR capture
2. Token used consistently across ~77 requests in Microsoft HAR
3. Token used consistently across all requests in Google HAR
4. No token refresh observed during captured sessions
5. No expiry information in responses

**Hypothesis:**
- Token likely has long TTL (hours to days)
- Stored in `localStorage` or `sessionStorage`
- Loaded by JavaScript on page init (before first API call)

---

## Section 2: Login Flow Analysis

### 2.1 What We KNOW

**HiNotes Authentication Facts:**
1. Every API endpoint requires `AccessToken` header
2. No public/unauthenticated endpoints exist
3. Token acquisition happens BEFORE the captured HAR sessions
4. The web app uses Microsoft OAuth and Google OAuth for **calendar integration only**, NOT for HiNotes login

### 2.2 What We DON'T KNOW (Missing from HAR)

The HAR files do NOT contain:
- ❌ HiNotes user login endpoint (e.g., `/v1/auth/login`)
- ❌ User registration endpoint
- ❌ Token generation response
- ❌ Token refresh mechanism
- ❌ Logout endpoint
- ❌ Password/credential submission

**Why?** The user was already logged into HiNotes before starting the HAR capture.

### 2.3 Reverse-Engineered Login Flow (Hypothesis)

Based on standard patterns and observed API structure:

```
┌─────────────────────────────────────────────────────────────┐
│ HYPOTHETICAL LOGIN SEQUENCE                                  │
└─────────────────────────────────────────────────────────────┘

User Action          →  Request                    →  Response
────────────────────────────────────────────────────────────────
1. Visit HiNotes     →  GET hinotes.hidock.com     →  HTML/JS
   web app               Load React app

2. Enter email/pwd   →  POST /v1/auth/login (?)    →  {
   Click "Login"          Content-Type:                "error": 0,
                          application/json             "message": "success",
                          Body: {                      "data": {
                            "email": "user@email",       "accessToken": "...",
                            "password": "..."            "user": { ... }
                          }                            }
                                                      }

3. Store token       →  JavaScript executes:
                        localStorage.setItem('accessToken', '...')
                        localStorage.setItem('userInfo', '...')

4. Make API calls    →  All requests include:
                        AccessToken: <token>

5. Calendar OAuth    →  Microsoft/Google login    →  OAuth code
   (OPTIONAL)            (SEPARATE from HiNotes)

6. Exchange OAuth    →  POST /v1/calendar/oauth2/ →  Stores OAuth
   code                  authorize                    tokens
                        AccessToken: <hinotes_token>  server-side
                        Body: { "code": "...",
                                "platform": "microsoft" }
```

### 2.4 User Info Response Structure

From `/v1/user/info`:

```json
{
  "error": 0,
  "message": "success",
  "data": {
    "id": "5459419178391982080",
    "type": "pro",
    "name": "Sebastian",
    "email": "seba.situx@gmail.com",
    "language": "en",
    "avatar": "https://hinotes.hidock.com//p/b5c3b1f279860e07ceb3bb9a642eaae3/80x80-x",
    "timeLimit": 1900,
    "countLimit": 30,
    "membershipEndDate": null,
    "totalNoteCount": 50,
    "totalNoteDuration": 1687,
    "limitations": [
      {
        "tag": "max.record.time",
        "frequency": "everytime",
        "limitation": 14700,
        "unitName": "second"
      },
      {
        "tag": "max.upload.size",
        "frequency": "everytime",
        "limitation": 1000,
        "unitName": "MB"
      },
      {
        "tag": "max.audio.duration",
        "frequency": "everytime",
        "limitation": 14700,
        "unitName": "second"
      }
    ],
    "kickstarter": false,
    "region": "AR",
    "makuake": false,
    "professionalRole": "Manager"
  }
}
```

**Standard Response Format:**
```json
{
  "error": 0,          // 0 = success, >0 = error code
  "message": "string", // Human-readable message
  "data": null | {}    // Response payload
}
```

---

## Section 3: Token Acquisition Methods

### 3.1 Method A: Extract from Browser (Quick & Dirty)

**How to get YOUR token:**

1. **Login to HiNotes web app** (https://hinotes.hidock.com)
2. **Open browser DevTools** (F12)
3. **Go to Network tab**
4. **Filter for "XHR" or "Fetch"**
5. **Trigger any API call** (e.g., click "Notes" tab)
6. **Click on a request** (e.g., `/v1/user/info`)
7. **Go to "Headers" section**
8. **Find `AccessToken` header**
9. **Copy the value** (64 characters)

**Alternative (localStorage):**
```javascript
// Open browser console (F12 → Console tab)
// Try these commands:

// Check all localStorage keys
Object.keys(localStorage)

// Common key names to try:
localStorage.getItem('accessToken')
localStorage.getItem('token')
localStorage.getItem('hinotes_token')
localStorage.getItem('user')

// Check sessionStorage too
Object.keys(sessionStorage)
```

**Pros:**
- ✅ Instant - get token in 30 seconds
- ✅ No reverse engineering needed
- ✅ Guaranteed to work

**Cons:**
- ❌ Manual process every time token expires
- ❌ Token expiry unknown (could be hours, days, or weeks)
- ❌ Not scalable for multiple users
- ❌ Security risk if token is hardcoded

**Token Lifespan Estimate:** Unknown - likely 1-7 days based on typical web app patterns.

---

### 3.2 Method B: Implement Basic Login (Compromise)

**Assumption:** HiNotes has a login endpoint we haven't captured.

**Likely endpoint patterns:**
```
POST /v1/auth/login
POST /v1/user/login
POST /v1/auth/signin
POST /v2/auth/login
```

**Request Format (hypothesis):**
```http
POST /v1/auth/login HTTP/1.1
Host: hinotes.hidock.com
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "plaintext_password"
}
```

**Expected Response:**
```json
{
  "error": 0,
  "message": "success",
  "data": {
    "accessToken": "2u78Nu6tQ9t2NFNoS4IdJflPDBoDqL2uThyVaeGsUiqFDYJIVXm9anhtNqUC9Nu2",
    "user": {
      "id": "...",
      "email": "...",
      "name": "..."
    }
  }
}
```

**Implementation:**
1. User enters HiNotes email/password in Desktop app settings
2. Desktop app POSTs to login endpoint
3. Store token encrypted in `hidock_config.json`
4. Use token for all API requests
5. Manual re-login when token expires

**Pros:**
- ✅ One-time setup per user
- ✅ More professional than manual extraction
- ✅ Can be automated

**Cons:**
- ❌ Requires discovering the login endpoint
- ❌ Storing passwords is risky (even if hashed)
- ❌ No automatic token refresh
- ❌ Still manual when token expires

**Discovery Method:**
To find the login endpoint, we need to:
1. Capture HAR from a fresh incognito browser session
2. Login to HiNotes from scratch
3. Find the POST request that returns the token

---

### 3.3 Method C: Full OAuth-Style Flow (Proper)

**Best Practice Implementation:**

```python
class HiNotesAuthService:
    """
    Manages HiNotes authentication with automatic token refresh.
    """

    def __init__(self, config_file='hidock_config.json'):
        self.config_file = config_file
        self.base_url = 'https://hinotes.hidock.com'
        self.token = None
        self.token_expiry = None
        self.user_info = None

    def login(self, email: str, password: str) -> bool:
        """
        Authenticate user and store token.

        Args:
            email: User's HiNotes email
            password: User's password (will be securely handled)

        Returns:
            True if login successful
        """
        # Hash password client-side if needed
        # (check if HiNotes uses bcrypt/argon2)

        response = requests.post(
            f'{self.base_url}/v1/auth/login',  # Hypothetical endpoint
            json={
                'email': email,
                'password': password
            },
            headers={'Content-Type': 'application/json'}
        )

        if response.status_code == 200:
            data = response.json()
            if data['error'] == 0:
                self.token = data['data']['accessToken']
                self.user_info = data['data']['user']

                # Save encrypted
                self._save_token()
                return True

        return False

    def _save_token(self):
        """Save token encrypted to config."""
        # Use cryptography.fernet for encryption
        from cryptography.fernet import Fernet

        # Generate or load encryption key
        key = self._get_or_create_key()
        fernet = Fernet(key)

        encrypted_token = fernet.encrypt(self.token.encode())

        config = self._load_config()
        config['hinotes_auth'] = {
            'encrypted_token': encrypted_token.decode(),
            'user_email': self.user_info['email']
        }
        self._save_config(config)

    def get_token(self) -> str:
        """
        Get current valid token, refreshing if needed.
        """
        if self.token is None:
            # Try to load from config
            self._load_token()

        # Check if token is still valid
        if self._is_token_valid():
            return self.token
        else:
            # Need to re-authenticate
            raise AuthenticationRequired("Token expired, please login again")

    def make_authenticated_request(self, method: str, endpoint: str, **kwargs):
        """
        Make API request with authentication.
        """
        token = self.get_token()

        headers = kwargs.get('headers', {})
        headers['AccessToken'] = token
        kwargs['headers'] = headers

        url = f'{self.base_url}{endpoint}'
        response = requests.request(method, url, **kwargs)

        # Check for 401 Unauthorized
        if response.status_code == 401:
            # Token expired
            self.token = None
            raise AuthenticationRequired("Token expired")

        return response

    def get_user_info(self):
        """Fetch current user info."""
        response = self.make_authenticated_request(
            'POST',
            '/v1/user/info',
            data='blank_or_empty_body'  # Based on HAR
        )

        if response.status_code == 200:
            data = response.json()
            if data['error'] == 0:
                return data['data']

        return None
```

**Pros:**
- ✅ Professional architecture
- ✅ Automatic token management
- ✅ Secure storage (encrypted)
- ✅ Error handling for expired tokens
- ✅ Reusable for all HiNotes API calls

**Cons:**
- ❌ Requires discovering login endpoint
- ❌ Higher implementation complexity
- ❌ Need to handle token refresh mechanism (if it exists)

**Estimated Implementation Time:** 4-8 hours

---

## Section 4: Complete API Endpoint Inventory

### 4.1 All Discovered Endpoints

**v1 Endpoints (15 total):**
```
POST   /v1/calendar/event/device_state/notice
GET    /v1/calendar/event/list
GET    /v1/calendar/event/sync/device
POST   /v1/calendar/microsoft/sync
POST   /v1/calendar/oauth2/authorize
POST   /v1/calendar/status
POST   /v1/entry/info
POST   /v1/folder/list
GET    /v1/promotion/setting/get
POST   /v1/template/list
POST   /v1/user/country/list
POST   /v1/user/device/status
POST   /v1/user/info
POST   /v1/user/setting/ai_engine/list
POST   /v1/user/setting/get
```

**v2 Endpoints (8 total):**
```
POST   /v2/device/firmware/latest
POST   /v2/device/optimize/check
POST   /v2/device/settings
POST   /v2/integration/disconnect
GET    /v2/integration/list
POST   /v2/note/latest
POST   /v2/note/list
POST   /v2/tag/cluster
```

**ALL require AccessToken header** - no public endpoints found.

### 4.2 Key Endpoint Examples

#### `/v1/user/info` - Get User Details
```http
POST /v1/user/info HTTP/1.1
Host: hinotes.hidock.com
AccessToken: 2u78Nu6tQ9t2NFNoS4IdJflPDBoDqL2uThyVaeGsUiqFDYJIVXm9anhtNqUC9Nu2
Content-Type: application/x-www-form-urlencoded
Content-Length: 0

Response:
{
  "error": 0,
  "message": "success",
  "data": {
    "id": "5459419178391982080",
    "type": "pro",
    "name": "Sebastian",
    "email": "seba.situx@gmail.com",
    ...
  }
}
```

#### `/v1/user/device/status` - Check Device Ownership
```http
POST /v1/user/device/status HTTP/1.1
Host: hinotes.hidock.com
AccessToken: <token>
Content-Type: application/x-www-form-urlencoded

deviceSn=HD1E243505435

Response:
{
  "error": 0,
  "message": "success",
  "data": {
    "owner": null,
    "ownership": "mine",
    "accessibility": "read-write",
    "name": "HiDock Workstation"
  }
}
```

#### `/v1/calendar/oauth2/authorize` - Link Calendar Account
```http
POST /v1/calendar/oauth2/authorize HTTP/1.1
Host: hinotes.hidock.com
AccessToken: <token>
Content-Type: application/json

{
  "code": "1.AQ8AVL4PiACadUa7ZzDdmLnrP61IcCg1471MjXZlissHhdV9AAQPAA.AgABBAIAAABlMNzVhAP...",
  "platform": "microsoft",
  "scope_list": [
    {
      "type": "calendar",
      "action": ["read"]
    }
  ]
}

Response:
{
  "error": 0,
  "message": "success",
  "data": null
}
```

### 4.3 Response Error Codes

**Standard Format:**
```json
{
  "error": <code>,
  "message": "<description>",
  "data": null
}
```

**Error Codes (observed):**
- `0` - Success
- `401` - Likely unauthorized (token expired/invalid) - **hypothesis**
- Other codes not observed in HAR files

---

## Section 5: Implementation Recommendations

### 5.1 For HiDock Desktop App: RECOMMENDED APPROACH

**Phase 1: Quick Start (Week 1)**
→ **Method A: Manual Token Extraction**

**Why:**
- Get calendar sync working immediately
- Validate API integration works
- Gather usage data before investing in full auth

**Implementation:**
```python
# apps/desktop/src/hinotes_service.py

class HiNotesService:
    def __init__(self, config):
        self.config = config
        self.base_url = 'https://hinotes.hidock.com'
        self.token = config.get('hinotes_access_token')

    def is_configured(self) -> bool:
        """Check if HiNotes token is set."""
        return bool(self.token)

    def configure_token(self, token: str):
        """Set AccessToken from user input."""
        self.token = token
        self.config['hinotes_access_token'] = token
        save_config(self.config)

    def get_user_info(self):
        """Fetch user info to validate token."""
        response = requests.post(
            f'{self.base_url}/v1/user/info',
            headers={'AccessToken': self.token}
        )

        if response.status_code == 200:
            data = response.json()
            if data['error'] == 0:
                return data['data']

        return None

    def get_calendar_events(self, start_time, end_time):
        """Fetch calendar events."""
        params = {
            'start_time': start_time,
            'end_time': end_time,
            'tz_offset': 180  # User's timezone offset
        }

        response = requests.get(
            f'{self.base_url}/v1/calendar/event/list',
            params=params,
            headers={'AccessToken': self.token}
        )

        if response.status_code == 200:
            data = response.json()
            if data['error'] == 0:
                return data['data']

        return None
```

**UI Flow:**
1. Add "HiNotes Integration" section in Settings
2. Add "Configure HiNotes Token" button
3. Show instructions dialog with screenshots:
   - How to open DevTools
   - How to find AccessToken header
   - Copy-paste field
4. Add "Validate Token" button → calls `/v1/user/info`
5. Display user email/name when valid

**User Instructions (in app dialog):**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Configure HiNotes Calendar Integration
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

To connect your HiNotes calendar:

1. Open https://hinotes.hidock.com in your browser
2. Login to your HiNotes account
3. Press F12 to open Developer Tools
4. Go to the "Network" tab
5. Click on any note or navigate in HiNotes
6. Click on any request (e.g., "user/info")
7. Scroll down to "Request Headers"
8. Find "AccessToken" header
9. Copy the 64-character value
10. Paste it below

[                                            ]
  ↑ Paste your AccessToken here (64 chars)

[Validate Token]  [Cancel]  [Save]

⚠ Note: This token may expire after some time.
   If calendar sync stops working, repeat this process.
```

---

**Phase 2: Automatic Login (Month 2-3)**
→ **Method B: Discover Login Endpoint**

**Action Items:**
1. **Capture fresh login HAR:**
   - Open incognito browser
   - Start HAR recording
   - Go to hinotes.hidock.com
   - Complete login flow
   - Save HAR file

2. **Analyze login endpoint:**
   - Find POST request that returns token
   - Document request format
   - Check if password is hashed client-side

3. **Implement login UI:**
   - Email + password fields in Settings
   - "Login to HiNotes" button
   - Store token encrypted

4. **Handle token expiry:**
   - Catch 401 errors
   - Show "Re-login required" dialog
   - Auto-retry after re-login

---

**Phase 3: Production-Ready (Optional)**
→ **Method C: Full Auth Service**

Only if:
- Multiple users report token expiry issues
- HiDock Desktop gets 1000+ active users
- HiNotes API becomes critical feature

---

### 5.2 Security Considerations

**Token Storage:**
```python
# DON'T: Store in plaintext
config['hinotes_token'] = token

# DO: Encrypt with Fernet
from cryptography.fernet import Fernet

def encrypt_token(token: str) -> str:
    # Use machine-specific key (tied to Windows DPAPI or similar)
    key = get_or_create_machine_key()
    fernet = Fernet(key)
    encrypted = fernet.encrypt(token.encode())
    return encrypted.decode()

def decrypt_token(encrypted: str) -> str:
    key = get_or_create_machine_key()
    fernet = Fernet(key)
    decrypted = fernet.decrypt(encrypted.encode())
    return decrypted.decode()
```

**Windows-Specific (Recommended):**
```python
import win32crypt

def encrypt_token_windows(token: str) -> bytes:
    """Use Windows DPAPI for encryption."""
    return win32crypt.CryptProtectData(token.encode())

def decrypt_token_windows(encrypted: bytes) -> str:
    """Decrypt using Windows DPAPI."""
    return win32crypt.CryptUnprotectData(encrypted)[1].decode()
```

---

### 5.3 Testing Strategy

**Validation Tests:**
```python
def test_token_validity():
    """Check if token is still valid."""
    service = HiNotesService(config)
    user_info = service.get_user_info()

    assert user_info is not None
    assert 'email' in user_info
    assert 'id' in user_info

def test_token_expiry_handling():
    """Simulate expired token."""
    service = HiNotesService(config)
    service.token = "invalid_expired_token"

    with pytest.raises(AuthenticationRequired):
        service.get_user_info()

def test_calendar_events_fetch():
    """Test calendar API integration."""
    service = HiNotesService(config)

    from datetime import datetime, timedelta
    start = datetime.now()
    end = start + timedelta(days=7)

    events = service.get_calendar_events(
        start.strftime('%Y-%m-%d %H:%M:%S'),
        end.strftime('%Y-%m-%d %H:%M:%S')
    )

    assert events is not None
    assert isinstance(events, list)
```

---

## Section 6: Action Plan

### Immediate Next Steps

**OPTION 1: Fast Track (Recommended for MVP)**
1. ✅ Read this document
2. ⏭ Implement Method A (manual token extraction)
3. ⏭ Add UI in Settings window for token input
4. ⏭ Implement `/v1/calendar/event/list` API call
5. ⏭ Test with real HiNotes account
6. ⏭ Ship feature to users with "beta" label
7. ⏭ Gather feedback on token expiry issues

**Timeline:** 1-2 days

---

**OPTION 2: Proper Implementation**
1. ⏭ Capture fresh login HAR (incognito browser)
2. ⏭ Analyze login endpoint
3. ⏭ Implement Method B (email/password login)
4. ⏭ Add encrypted token storage
5. ⏭ Implement token expiry handling
6. ⏭ Test thoroughly
7. ⏭ Ship production-ready feature

**Timeline:** 1-2 weeks

---

### Questions to Answer

**To proceed with Method A (Quick Start):**
- ✅ No blockers - can start immediately

**To proceed with Method B (Login Flow):**
- ❓ What is the HiNotes login endpoint?
  - **Action:** Capture HAR from fresh login
- ❓ Is password hashed client-side?
  - **Action:** Inspect login POST request
- ❓ Does token ever expire?
  - **Action:** Test with old token after days/weeks
- ❓ Is there a refresh token mechanism?
  - **Action:** Check login response for refresh token

**To proceed with Method C (Full Service):**
- ❓ How often do tokens expire?
  - **Action:** Monitor token lifetime in production
- ❓ What is the error response for expired token?
  - **Action:** Test with expired token
- ❓ Is there a token validation endpoint?
  - **Action:** Look for `/v1/auth/validate` or similar

---

## Section 7: Code Examples

### 7.1 Quick & Dirty: Extract Token from HAR

```python
#!/usr/bin/env python3
"""
Extract AccessToken from HAR file.
Usage: python extract_token.py captured.har
"""

import json
import sys

def extract_token_from_har(har_file: str) -> str:
    """Extract AccessToken from HAR file."""
    with open(har_file, 'r', encoding='utf-8') as f:
        har = json.load(f)

    for entry in har['log']['entries']:
        for header in entry['request']['headers']:
            if header['name'] == 'AccessToken':
                return header['value']

    return None

if __name__ == '__main__':
    if len(sys.argv) != 2:
        print("Usage: python extract_token.py <har_file>")
        sys.exit(1)

    token = extract_token_from_har(sys.argv[1])

    if token:
        print(f"Found AccessToken:")
        print(token)
        print(f"\nLength: {len(token)} characters")
    else:
        print("No AccessToken found in HAR file")
```

### 7.2 Compromise: Simple Login Function

```python
"""
HiNotes authentication - simple login approach.
"""

import requests
import json
from pathlib import Path

class HiNotesAuth:
    BASE_URL = "https://hinotes.hidock.com"

    def __init__(self, config_file='hinotes_auth.json'):
        self.config_file = Path(config_file)
        self.token = None
        self._load_token()

    def login(self, email: str, password: str) -> bool:
        """
        Login to HiNotes and store token.

        NOTE: Endpoint is hypothetical - need to discover actual endpoint!
        """
        # Try common login endpoint patterns
        endpoints = [
            '/v1/auth/login',
            '/v1/user/login',
            '/v2/auth/login',
            '/api/login'
        ]

        for endpoint in endpoints:
            try:
                response = requests.post(
                    f'{self.BASE_URL}{endpoint}',
                    json={'email': email, 'password': password},
                    headers={'Content-Type': 'application/json'},
                    timeout=10
                )

                if response.status_code == 200:
                    data = response.json()
                    if data.get('error') == 0:
                        self.token = data['data']['accessToken']
                        self._save_token()
                        return True

            except Exception as e:
                continue

        return False

    def _save_token(self):
        """Save token to config file."""
        self.config_file.write_text(json.dumps({
            'accessToken': self.token
        }))

    def _load_token(self):
        """Load token from config file."""
        if self.config_file.exists():
            data = json.loads(self.config_file.read_text())
            self.token = data.get('accessToken')

    def is_authenticated(self) -> bool:
        """Check if we have a token."""
        return bool(self.token)

    def get_headers(self) -> dict:
        """Get headers for API requests."""
        return {'AccessToken': self.token}

    def validate_token(self) -> bool:
        """Validate token by calling user info endpoint."""
        if not self.token:
            return False

        try:
            response = requests.post(
                f'{self.BASE_URL}/v1/user/info',
                headers=self.get_headers()
            )

            if response.status_code == 200:
                data = response.json()
                return data.get('error') == 0
        except:
            pass

        return False

# Usage
if __name__ == '__main__':
    auth = HiNotesAuth()

    if not auth.is_authenticated():
        email = input("HiNotes email: ")
        password = input("Password: ")

        if auth.login(email, password):
            print("✅ Login successful!")
        else:
            print("❌ Login failed")
    else:
        if auth.validate_token():
            print("✅ Token is valid")
        else:
            print("❌ Token expired, please login again")
```

### 7.3 Proper: Full Authentication Service Class

```python
"""
Production-ready HiNotes authentication service.
"""

import requests
import json
from pathlib import Path
from datetime import datetime, timedelta
from typing import Optional, Dict, Any
import logging

# Windows-specific encryption
try:
    import win32crypt
    WINDOWS_ENCRYPTION = True
except ImportError:
    from cryptography.fernet import Fernet
    WINDOWS_ENCRYPTION = False

logger = logging.getLogger(__name__)

class AuthenticationRequired(Exception):
    """Raised when token is expired or invalid."""
    pass

class HiNotesAuthService:
    """
    Full-featured HiNotes authentication service.

    Features:
    - Secure token storage (Windows DPAPI or Fernet)
    - Automatic token validation
    - Error handling
    - Logging
    - Session management
    """

    BASE_URL = "https://hinotes.hidock.com"

    def __init__(self, config_dir: Path):
        self.config_dir = Path(config_dir)
        self.config_dir.mkdir(parents=True, exist_ok=True)

        self.token_file = self.config_dir / 'hinotes_token.enc'
        self.user_file = self.config_dir / 'hinotes_user.json'

        self.token: Optional[str] = None
        self.user_info: Optional[Dict[str, Any]] = None

        self._load_session()

    # ─────────────────────────────────────────────────────────
    # Authentication Methods
    # ─────────────────────────────────────────────────────────

    def login(self, email: str, password: str) -> bool:
        """
        Authenticate with HiNotes and store token securely.

        Args:
            email: User's HiNotes email
            password: User's password

        Returns:
            True if login successful

        Raises:
            requests.RequestException: On network errors
        """
        logger.info(f"Attempting login for {email}")

        # TODO: Discover actual endpoint
        endpoint = '/v1/auth/login'

        try:
            response = requests.post(
                f'{self.BASE_URL}{endpoint}',
                json={'email': email, 'password': password},
                headers={'Content-Type': 'application/json'},
                timeout=10
            )

            response.raise_for_status()
            data = response.json()

            if data.get('error') == 0:
                self.token = data['data']['accessToken']
                self.user_info = data['data'].get('user', {})

                self._save_session()
                logger.info(f"Login successful for {email}")
                return True
            else:
                logger.error(f"Login failed: {data.get('message')}")
                return False

        except requests.RequestException as e:
            logger.error(f"Login request failed: {e}")
            raise

    def logout(self):
        """Clear stored session."""
        logger.info("Logging out")

        self.token = None
        self.user_info = None

        if self.token_file.exists():
            self.token_file.unlink()
        if self.user_file.exists():
            self.user_file.unlink()

    def is_authenticated(self) -> bool:
        """Check if we have a token (doesn't validate it)."""
        return bool(self.token)

    def validate_token(self) -> bool:
        """
        Validate token by making API request.

        Returns:
            True if token is valid
        """
        if not self.token:
            return False

        try:
            response = self._make_request('POST', '/v1/user/info')
            return response.status_code == 200
        except:
            return False

    # ─────────────────────────────────────────────────────────
    # API Request Methods
    # ─────────────────────────────────────────────────────────

    def get_token(self) -> str:
        """
        Get current token, ensuring it's valid.

        Returns:
            Valid AccessToken

        Raises:
            AuthenticationRequired: If token is invalid/expired
        """
        if not self.token:
            raise AuthenticationRequired("No token available, please login")

        # Could add expiry checking here if we discover token TTL
        return self.token

    def _make_request(self, method: str, endpoint: str, **kwargs) -> requests.Response:
        """
        Make authenticated API request.

        Args:
            method: HTTP method
            endpoint: API endpoint path
            **kwargs: Additional requests parameters

        Returns:
            Response object

        Raises:
            AuthenticationRequired: If token is invalid
        """
        token = self.get_token()

        headers = kwargs.pop('headers', {})
        headers['AccessToken'] = token

        url = f'{self.BASE_URL}{endpoint}'

        logger.debug(f"{method} {endpoint}")

        response = requests.request(method, url, headers=headers, **kwargs)

        # Check for authentication errors
        if response.status_code == 401:
            logger.warning("Token expired or invalid")
            self.token = None
            raise AuthenticationRequired("Token expired, please login again")

        return response

    # ─────────────────────────────────────────────────────────
    # HiNotes API Methods
    # ─────────────────────────────────────────────────────────

    def get_user_info(self) -> Optional[Dict[str, Any]]:
        """Fetch current user information."""
        try:
            response = self._make_request('POST', '/v1/user/info')

            if response.status_code == 200:
                data = response.json()
                if data.get('error') == 0:
                    self.user_info = data['data']
                    return self.user_info
        except Exception as e:
            logger.error(f"Failed to fetch user info: {e}")

        return None

    def get_calendar_events(
        self,
        start_time: datetime,
        end_time: datetime,
        tz_offset: int = 0
    ) -> Optional[list]:
        """
        Fetch calendar events in date range.

        Args:
            start_time: Start of range
            end_time: End of range
            tz_offset: Timezone offset in minutes

        Returns:
            List of calendar events
        """
        params = {
            'start_time': start_time.strftime('%Y-%m-%d %H:%M:%S'),
            'end_time': end_time.strftime('%Y-%m-%d %H:%M:%S'),
            'tz_offset': tz_offset
        }

        try:
            response = self._make_request(
                'GET',
                '/v1/calendar/event/list',
                params=params
            )

            if response.status_code == 200:
                data = response.json()
                if data.get('error') == 0:
                    return data.get('data', [])
        except Exception as e:
            logger.error(f"Failed to fetch calendar events: {e}")

        return None

    def check_device_status(self, device_sn: str) -> Optional[Dict[str, Any]]:
        """
        Check device ownership/status.

        Args:
            device_sn: Device serial number (e.g., "HD1E243505435")

        Returns:
            Device status dict
        """
        try:
            response = self._make_request(
                'POST',
                '/v1/user/device/status',
                data=f'deviceSn={device_sn}',
                headers={'Content-Type': 'application/x-www-form-urlencoded'}
            )

            if response.status_code == 200:
                data = response.json()
                if data.get('error') == 0:
                    return data['data']
        except Exception as e:
            logger.error(f"Failed to check device status: {e}")

        return None

    # ─────────────────────────────────────────────────────────
    # Token Storage (Encrypted)
    # ─────────────────────────────────────────────────────────

    def _save_session(self):
        """Save token and user info securely."""
        if not self.token:
            return

        # Encrypt and save token
        if WINDOWS_ENCRYPTION:
            encrypted = win32crypt.CryptProtectData(self.token.encode())
            self.token_file.write_bytes(encrypted)
        else:
            key = self._get_or_create_key()
            fernet = Fernet(key)
            encrypted = fernet.encrypt(self.token.encode())
            self.token_file.write_bytes(encrypted)

        # Save user info (not sensitive)
        if self.user_info:
            self.user_file.write_text(json.dumps(self.user_info, indent=2))

        logger.info("Session saved")

    def _load_session(self):
        """Load token and user info from storage."""
        if not self.token_file.exists():
            return

        try:
            # Decrypt token
            encrypted = self.token_file.read_bytes()

            if WINDOWS_ENCRYPTION:
                decrypted = win32crypt.CryptUnprotectData(encrypted)[1]
                self.token = decrypted.decode()
            else:
                key = self._get_or_create_key()
                fernet = Fernet(key)
                decrypted = fernet.decrypt(encrypted)
                self.token = decrypted.decode()

            # Load user info
            if self.user_file.exists():
                self.user_info = json.loads(self.user_file.read_text())

            logger.info("Session loaded")

        except Exception as e:
            logger.error(f"Failed to load session: {e}")
            # Clean up corrupted files
            self.logout()

    def _get_or_create_key(self) -> bytes:
        """Get or create Fernet encryption key."""
        key_file = self.config_dir / 'hinotes.key'

        if key_file.exists():
            return key_file.read_bytes()
        else:
            key = Fernet.generate_key()
            key_file.write_bytes(key)
            return key


# ─────────────────────────────────────────────────────────────
# Usage Example
# ─────────────────────────────────────────────────────────────

def main():
    """Example usage of HiNotesAuthService."""
    from pathlib import Path

    # Initialize service
    config_dir = Path.home() / '.hidock' / 'hinotes'
    service = HiNotesAuthService(config_dir)

    # Login if needed
    if not service.is_authenticated():
        email = input("HiNotes email: ")
        password = input("Password: ")

        try:
            if service.login(email, password):
                print("✅ Login successful!")
            else:
                print("❌ Login failed")
                return
        except Exception as e:
            print(f"❌ Error: {e}")
            return

    # Validate token
    if service.validate_token():
        print("✅ Token is valid")
    else:
        print("❌ Token expired")
        return

    # Get user info
    user = service.get_user_info()
    if user:
        print(f"\nLogged in as: {user['name']} ({user['email']})")
        print(f"Account type: {user['type']}")
        print(f"Total notes: {user['totalNoteCount']}")

    # Get calendar events
    from datetime import datetime, timedelta

    start = datetime.now()
    end = start + timedelta(days=7)

    events = service.get_calendar_events(start, end, tz_offset=180)
    if events:
        print(f"\nFound {len(events)} calendar events")
    else:
        print("\nNo calendar events found (or not configured)")

if __name__ == '__main__':
    main()
```

---

## Appendix A: Glossary

- **AccessToken**: Custom header used by HiNotes API (64-char alphanumeric string)
- **HAR**: HTTP Archive format - records all network traffic from browser
- **JWT**: JSON Web Token - self-contained token with header/payload/signature (NOT used by HiNotes)
- **OAuth**: Standard authorization protocol (used for calendar integration, not HiNotes login)
- **Session Token**: Opaque token issued by server, validated server-side (used by HiNotes)
- **DPAPI**: Windows Data Protection API - OS-level encryption for sensitive data

---

## Appendix B: Related Documentation

- `E:\Code\hidock-next\docs\transcription-feature\AI_TRANSCRIPTION_INVESTIGATION.md` - Original transcription feature investigation
- `E:\Code\hidock-next\archive\*.har` - HAR capture files analyzed
- `E:\Code\hidock-next\apps\desktop\src\transcription_module.py` - Existing transcription code

---

## Appendix C: Questions for HiDock Team

If you have contact with HiDock/HiNotes developers, ask:

1. **Login Endpoint**: What is the official login endpoint? (`/v1/auth/login`?)
2. **Token Expiry**: How long does the AccessToken remain valid?
3. **Token Refresh**: Is there a refresh token mechanism?
4. **Public API**: Any plans for a public API with proper OAuth?
5. **Rate Limits**: Are there rate limits on API requests?
6. **Device Registration**: How is device pairing handled? (seems to use serial number)
7. **Error Codes**: Full list of error codes and meanings?
8. **API Documentation**: Is there any internal API documentation?

---

## Document History

| Date | Version | Changes |
|------|---------|---------|
| 2025-11-06 | 1.0 | Initial analysis of HAR files |

---

**End of Document**
