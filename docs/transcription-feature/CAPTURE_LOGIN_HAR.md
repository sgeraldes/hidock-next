# How to Capture HiDock Login HAR File

We need to capture the actual login flow to discover the authentication endpoint and implement proper login.

## Prerequisites

- Chrome, Edge, or Firefox browser
- HiDock account credentials
- 5 minutes

## Steps to Capture Login HAR

### 1. Open Browser in Incognito/Private Mode

**Chrome/Edge:**
- Press `Ctrl + Shift + N` (Windows) or `Cmd + Shift + N` (Mac)
- Opens new incognito window

**Firefox:**
- Press `Ctrl + Shift + P` (Windows) or `Cmd + Shift + P` (Mac)
- Opens new private window

**Why Incognito?**
- Ensures you're logged out
- No cached tokens
- Fresh login flow from scratch

### 2. Open Developer Tools

- Press `F12` or `Ctrl + Shift + I` (Windows) or `Cmd + Option + I` (Mac)
- Developer Tools panel opens (usually at bottom or side)

### 3. Go to Network Tab

- Click **"Network"** tab in Developer Tools
- You should see an empty list (no requests yet)

### 4. Enable HAR Recording

**Chrome/Edge:**
- Network tab should already be recording (red circle in top-left)
- If not, click the record button (circle icon)
- Check **"Preserve log"** checkbox (important!)

**Firefox:**
- Network tab should already be recording
- Check **"Persist Logs"** checkbox (important!)

### 5. Navigate to HiNotes

- In the address bar, type: `https://hinotes.hidock.com`
- Press Enter
- Wait for page to load completely

### 6. Log In

**Important:** Perform a COMPLETE login flow:

1. Enter your **username** or **email**
2. Enter your **password**
3. Click **"Login"** or **"Sign In"** button
4. Wait until you're fully logged in and see the main HiNotes interface
5. **Optional:** Navigate to calendar page to capture calendar API calls too

### 7. Export HAR File

**Chrome/Edge:**
1. Right-click anywhere in the Network tab request list
2. Select **"Save all as HAR with content"**
3. Save as: `hinotes-login-YYYY-MM-DD.har`
4. Choose location: `E:\Code\hidock-next\archive\`

**Firefox:**
1. Right-click anywhere in the Network tab request list
2. Select **"Save All As HAR"**
3. Save as: `hinotes-login-YYYY-MM-DD.har`
4. Choose location: `E:\Code\hidock-next\archive\`

### 8. Verify HAR File

Check that the HAR file captured the login:

1. Open the HAR file in a text editor
2. Search for keywords like:
   - `"login"`
   - `"auth"`
   - `"AccessToken"`
   - `"password"`
   - Your username/email (should appear in request body)

If you find these, you've successfully captured the login flow!

## What We're Looking For

From the HAR file, we need to extract:

### 1. Login Endpoint
```
POST https://hinotes.hidock.com/v1/auth/login
```
or similar

### 2. Login Request Format
```json
{
  "username": "user@example.com",
  "password": "********",
  "rememberMe": true
}
```
or similar

### 3. Login Response Format
```json
{
  "code": 200,
  "msg": "success",
  "data": {
    "accessToken": "2u78Nu6tQ9t2NFNoS4Id...",
    "userId": "12345",
    "email": "user@example.com",
    "expiresIn": 604800
  }
}
```
or similar

### 4. Token Refresh Endpoint (if exists)
```
POST https://hinotes.hidock.com/v1/auth/refresh
```

## Security Note

**⚠️ The HAR file contains your actual password and access token!**

Before sharing or committing:
1. **DO NOT** commit the HAR file to Git
2. Open in text editor and search for your password
3. Replace with `"********"` or `"REDACTED"`
4. Replace access token with `"TOKEN_REDACTED"`
5. Keep original HAR file private and safe

## Troubleshooting

### "I don't see a login page"

If HiNotes automatically logs you in (remembered session):
1. **Logout first:** Find logout button in HiNotes
2. **OR:** Clear browser cookies:
   - Chrome: `Ctrl + Shift + Delete` → Clear browsing data → Cookies
   - Firefox: `Ctrl + Shift + Delete` → Cookies
3. Try again in incognito mode

### "Network tab is empty"

Make sure:
- Developer Tools were open BEFORE navigating to page
- "Preserve log" or "Persist Logs" is checked
- Recording is enabled (red circle)

### "HAR file is too large"

This is normal! HAR files can be 10-50 MB.
- We only need the login requests, but capturing everything is fine
- Large file = complete capture = good

### "Can't find login endpoint in HAR"

Search for these patterns:
- URL contains: `login`, `auth`, `signin`, `authenticate`
- Method: `POST`
- Request body contains: password field
- Response contains: token or accessToken

## What Happens Next

Once you provide the HAR file (or describe what you find):

1. I'll analyze the login endpoint
2. Extract request/response format
3. Implement `HiDockAuthService` class
4. Create login dialog UI
5. Add encrypted token storage
6. Implement automatic token refresh
7. Handle expiry gracefully

## Quick Alternative (If You Can't Capture HAR)

If you have trouble capturing HAR, you can manually inspect the login:

1. Open Developer Tools → Network tab
2. Login to HiNotes
3. Find the login request (look for POST requests)
4. Click on it
5. Take screenshots of:
   - **Request URL**
   - **Request Headers**
   - **Request Payload** (body)
   - **Response** (preview and raw)
6. Send me the screenshots (redact password!)

---

**Ready?** Go capture that HAR file! Once you have it, either:
- Place it in `E:\Code\hidock-next\archive\` and let me know
- Or describe what you found and I'll implement it

Let me know when you have the HAR file! 🚀
