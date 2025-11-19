# Calendar OAuth2 Flow Diagrams

This document provides visual sequence diagrams for the OAuth2 authentication flows.

## Microsoft Outlook/Office 365 Flow

```
┌─────────────┐         ┌──────────────┐         ┌──────────────────┐         ┌─────────────────┐
│  Desktop    │         │   Browser    │         │  HiDock Backend  │         │   Microsoft     │
│     App     │         │              │         │ hinotes.hidock   │         │   Azure AD      │
└──────┬──────┘         └──────┬───────┘         └────────┬─────────┘         └────────┬────────┘
       │                       │                          │                            │
       │ 1. Open OAuth URL     │                          │                            │
       │──────────────────────>│                          │                            │
       │                       │                          │                            │
       │                       │ 2. GET /oauth2/v2.0/authorize                         │
       │                       │   ?client_id=287048ad...                              │
       │                       │   &scope=Calendars.Read                               │
       │                       │   &redirect_uri=https://hinotes.hidock.com/auth       │
       │                       │───────────────────────────────────────────────────────>│
       │                       │                          │                            │
       │                       │         3. Login Page    │                            │
       │                       │<───────────────────────────────────────────────────────│
       │                       │                          │                            │
       │ 4. User enters        │                          │                            │
       │    credentials        │                          │                            │
       │    & grants consent   │                          │                            │
       │                       │                          │                            │
       │                       │ 5. POST credentials      │                            │
       │                       │───────────────────────────────────────────────────────>│
       │                       │                          │                            │
       │                       │ 6. 302 Redirect          │                            │
       │                       │    Location: https://hinotes.hidock.com/auth?code=... │
       │                       │<───────────────────────────────────────────────────────│
       │                       │                          │                            │
       │                       │ 7. GET /auth?code=...    │                            │
       │                       │─────────────────────────>│                            │
       │                       │                          │                            │
       │                       │ 8. Web Page (JS)         │                            │
       │                       │<─────────────────────────│                            │
       │                       │                          │                            │
       │                       │ 9. POST /v1/calendar/oauth2/authorize                 │
       │                       │    {code: "...", platform: "microsoft"}               │
       │                       │─────────────────────────>│                            │
       │                       │                          │                            │
       │                       │                          │ 10. POST /oauth2/v2.0/token│
       │                       │                          │     grant_type=authorization_code
       │                       │                          │     code=...               │
       │                       │                          │───────────────────────────>│
       │                       │                          │                            │
       │                       │                          │ 11. Access Token Response  │
       │                       │                          │     {access_token, refresh_token}
       │                       │                          │<───────────────────────────│
       │                       │                          │                            │
       │                       │                          │ 12. Store tokens in DB     │
       │                       │                          │◄──┐                        │
       │                       │                          │   │                        │
       │                       │                          │   │                        │
       │                       │ 13. {"error": 0, "message": "success"}                │
       │                       │<─────────────────────────│                            │
       │                       │                          │                            │
       │                       │ 14. Success page         │                            │
       │                       │    "Calendar connected!" │                            │
       │                       │<─────────────────────────│                            │
       │                       │                          │                            │
       │ 15. Poll status       │                          │                            │
       │   OR user clicks      │                          │                            │
       │   "Done"              │                          │                            │
       │                       │                          │                            │
       │ 16. POST /v1/calendar/status                     │                            │
       │   (with AccessToken)  │                          │                            │
       │──────────────────────────────────────────────────>│                            │
       │                       │                          │                            │
       │ 17. {"connected": true}                          │                            │
       │<──────────────────────────────────────────────────│                            │
       │                       │                          │                            │
       │ 18. POST /v1/calendar/microsoft/sync             │                            │
       │──────────────────────────────────────────────────>│                            │
       │                       │                          │                            │
       │                       │                          │ 19. GET /v1.0/me/calendarView
       │                       │                          │     Authorization: Bearer {...}
       │                       │                          │───────────────────────────>│
       │                       │                          │                            │
       │                       │                          │ 20. Calendar events JSON   │
       │                       │                          │<───────────────────────────│
       │                       │                          │                            │
       │                       │                          │ 21. Store in DB            │
       │                       │                          │◄──┐                        │
       │                       │                          │   │                        │
       │                       │                          │   │                        │
       │ 22. {"error": 0, "message": "success"}           │                            │
       │<──────────────────────────────────────────────────│                            │
       │                       │                          │                            │
       │ 23. GET /v1/calendar/event/list?start_time=...   │                            │
       │──────────────────────────────────────────────────>│                            │
       │                       │                          │                            │
       │ 24. Calendar events (from DB)                    │                            │
       │<──────────────────────────────────────────────────│                            │
       │                       │                          │                            │
       │ 25. Display events    │                          │                            │
       │◄──┐                   │                          │                            │
       │   │                   │                          │                            │
       │   │                   │                          │                            │
```

### Key Microsoft Flow Steps

1. **Desktop app opens browser** with OAuth URL
2. **Browser navigates** to Microsoft login page
3. **User authenticates** (username/password, MFA if enabled)
4. **User grants consent** to calendar permissions
5. **Microsoft redirects** back to HiDock with authorization code
6. **HiDock frontend** sends code to backend
7. **Backend exchanges** code for access + refresh tokens
8. **Backend stores tokens** securely in database
9. **Desktop app polls** for connection status
10. **Desktop app triggers sync** to fetch calendar events
11. **Backend calls** Microsoft Graph API with stored token
12. **Desktop app fetches events** from HiDock backend

---

## Google Calendar Flow

```
┌─────────────┐         ┌──────────────┐         ┌──────────────────┐         ┌─────────────────┐
│  Desktop    │         │   Browser    │         │  HiDock Backend  │         │     Google      │
│     App     │         │              │         │ hinotes.hidock   │         │  Accounts API   │
└──────┬──────┘         └──────┬───────┘         └────────┬─────────┘         └────────┬────────┘
       │                       │                          │                            │
       │ 1. Open OAuth URL     │                          │                            │
       │──────────────────────>│                          │                            │
       │                       │                          │                            │
       │                       │ 2. GET /o/oauth2/auth                                 │
       │                       │   ?client_id=122776600569...                          │
       │                       │   &scope=calendar                                     │
       │                       │   &access_type=offline                                │
       │                       │   &redirect_uri=https://hinotes.hidock.com/auth       │
       │                       │───────────────────────────────────────────────────────>│
       │                       │                          │                            │
       │                       │         3. Login/Consent Page                         │
       │                       │<───────────────────────────────────────────────────────│
       │                       │                          │                            │
       │ 4. User selects       │                          │                            │
       │    Google account     │                          │                            │
       │    & grants consent   │                          │                            │
       │                       │                          │                            │
       │                       │ 5. POST consent approval │                            │
       │                       │───────────────────────────────────────────────────────>│
       │                       │                          │                            │
       │                       │ 6. 302 Redirect          │                            │
       │                       │    Location: https://hinotes.hidock.com/auth?         │
       │                       │              code=...&scope=...                       │
       │                       │<───────────────────────────────────────────────────────│
       │                       │                          │                            │
       │                       │ 7. GET /auth?code=...&scope=...                       │
       │                       │─────────────────────────>│                            │
       │                       │                          │                            │
       │                       │ 8. Web Page (JS)         │                            │
       │                       │<─────────────────────────│                            │
       │                       │                          │                            │
       │                       │ 9. POST /v1/calendar/oauth2/authorize                 │
       │                       │    {code: "...", platform: "google"}                  │
       │                       │─────────────────────────>│                            │
       │                       │                          │                            │
       │                       │                          │ 10. POST /token            │
       │                       │                          │     grant_type=authorization_code
       │                       │                          │     code=...               │
       │                       │                          │───────────────────────────>│
       │                       │                          │                            │
       │                       │                          │ 11. Token Response         │
       │                       │                          │     {access_token, refresh_token}
       │                       │                          │<───────────────────────────│
       │                       │                          │                            │
       │                       │                          │ 12. Store tokens in DB     │
       │                       │                          │◄──┐                        │
       │                       │                          │   │                        │
       │                       │                          │   │                        │
       │                       │ 13. {"error": 0, "message": "success"}                │
       │                       │<─────────────────────────│                            │
       │                       │                          │                            │
       │ 14. Poll status       │                          │                            │
       │──────────────────────────────────────────────────>│                            │
       │                       │                          │                            │
       │ 15. {"connected": true}                          │                            │
       │<──────────────────────────────────────────────────│                            │
       │                       │                          │                            │
       │ 16. POST /v1/calendar/google/sync                │                            │
       │──────────────────────────────────────────────────>│                            │
       │                       │                          │                            │
       │                       │                          │ 17. GET /calendar/v3/calendars/primary/events
       │                       │                          │     Authorization: Bearer {...}
       │                       │                          │───────────────────────────>│
       │                       │                          │                            │
       │                       │                          │ 18. Events JSON            │
       │                       │                          │<───────────────────────────│
       │                       │                          │                            │
       │                       │                          │ 19. Normalize & store      │
       │                       │                          │◄──┐                        │
       │                       │                          │   │                        │
       │                       │                          │   │                        │
       │ 20. {"error": 0}     │                          │                            │
       │<──────────────────────────────────────────────────│                            │
       │                       │                          │                            │
       │ 21. GET /v1/calendar/event/list                  │                            │
       │──────────────────────────────────────────────────>│                            │
       │                       │                          │                            │
       │ 22. Events (normalized)                          │                            │
       │<──────────────────────────────────────────────────│                            │
       │                       │                          │                            │
```

### Key Google Flow Steps

1. **Desktop app opens browser** with OAuth URL (includes `access_type=offline` for refresh token)
2. **Browser navigates** to Google account selection/login
3. **User selects account** (or logs in if not signed in)
4. **Consent screen** shows requested permissions
5. **User clicks "Allow"**
6. **Google redirects** with authorization code + granted scopes
7. **HiDock frontend** sends code to backend
8. **Backend exchanges** code for tokens
9. **Backend stores tokens** in database
10. **Desktop app polls** for connection status
11. **Desktop app triggers sync**
12. **Backend calls** Google Calendar API
13. **Backend normalizes** event data to unified format
14. **Desktop app fetches** events from HiDock backend

---

## Alternative Flow: Direct OAuth (Desktop App)

If implementing OAuth directly in desktop app (Approach 1):

```
┌─────────────┐         ┌──────────────┐         ┌─────────────────┐
│  Desktop    │         │   Browser    │         │   OAuth         │
│     App     │         │              │         │   Provider      │
└──────┬──────┘         └──────┬───────┘         └────────┬────────┘
       │                       │                          │
       │ 1. Start local HTTP   │                          │
       │    server on port 8080│                          │
       │◄──┐                   │                          │
       │   │                   │                          │
       │   │                   │                          │
       │ 2. Open OAuth URL     │                          │
       │   redirect_uri=       │                          │
       │   localhost:8080      │                          │
       │──────────────────────>│                          │
       │                       │                          │
       │                       │ 3. GET /authorize        │
       │                       │─────────────────────────>│
       │                       │                          │
       │                       │ 4. Login/Consent         │
       │                       │<─────────────────────────│
       │                       │                          │
       │ 5. User authorizes    │                          │
       │                       │                          │
       │                       │ 6. 302 Redirect          │
       │                       │    http://localhost:8080/callback?code=...
       │                       │<─────────────────────────│
       │                       │                          │
       │                       │ 7. GET /callback?code=...│
       │<──────────────────────│                          │
       │                       │                          │
       │ 8. Extract code       │                          │
       │    from request       │                          │
       │◄──┐                   │                          │
       │   │                   │                          │
       │   │                   │                          │
       │ 9. Send success page  │                          │
       │─────────────────────>│                          │
       │                       │                          │
       │ 10. POST /token       │                          │
       │    grant_type=authorization_code                 │
       │    code=...           │                          │
       │──────────────────────────────────────────────────>│
       │                       │                          │
       │ 11. {access_token, refresh_token}                │
       │<──────────────────────────────────────────────────│
       │                       │                          │
       │ 12. Encrypt & store   │                          │
       │     tokens locally    │                          │
       │◄──┐                   │                          │
       │   │                   │                          │
       │   │                   │                          │
       │ 13. Shutdown local    │                          │
       │     HTTP server       │                          │
       │◄──┐                   │                          │
       │   │                   │                          │
       │   │                   │                          │
       │ 14. GET /calendar     │                          │
       │    Authorization:     │                          │
       │    Bearer {token}     │                          │
       │──────────────────────────────────────────────────>│
       │                       │                          │
       │ 15. Events JSON       │                          │
       │<──────────────────────────────────────────────────│
       │                       │                          │
```

---

## Token Refresh Flow

When access token expires:

```
┌─────────────┐         ┌──────────────────┐         ┌─────────────────┐
│  Desktop    │         │  HiDock Backend  │         │   OAuth         │
│     App     │         │  OR Direct API   │         │   Provider      │
└──────┬──────┘         └────────┬─────────┘         └────────┬────────┘
       │                         │                            │
       │ 1. GET /calendar/events │                            │
       │    Authorization:       │                            │
       │    Bearer {expired}     │                            │
       │────────────────────────>│                            │
       │                         │                            │
       │                         │ 2. GET /calendar           │
       │                         │    Authorization: Bearer   │
       │                         │───────────────────────────>│
       │                         │                            │
       │                         │ 3. 401 Unauthorized        │
       │                         │<───────────────────────────│
       │                         │                            │
       │                         │ 4. POST /token             │
       │                         │    grant_type=refresh_token│
       │                         │    refresh_token=...       │
       │                         │───────────────────────────>│
       │                         │                            │
       │                         │ 5. {access_token, ...}     │
       │                         │<───────────────────────────│
       │                         │                            │
       │                         │ 6. Update stored token     │
       │                         │◄──┐                        │
       │                         │   │                        │
       │                         │   │                        │
       │                         │ 7. Retry GET /calendar     │
       │                         │    with new token          │
       │                         │───────────────────────────>│
       │                         │                            │
       │                         │ 8. Events JSON             │
       │                         │<───────────────────────────│
       │                         │                            │
       │ 9. Events data          │                            │
       │<────────────────────────│                            │
       │                         │                            │
```

---

## State Parameter Flow

The `state` parameter is used to:
1. Prevent CSRF attacks
2. Pass custom data through OAuth flow
3. Track user intent (read vs read/write permissions)

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

**Flow**:
```
Desktop App
    │
    ├─► Generate state JSON
    │   {calendar: {read: true}, platform: "microsoft"}
    │
    └─► URL encode and include in OAuth URL
        ↓
OAuth Provider
    │
    └─► Echo back state in redirect
        ↓
HiDock Backend / Desktop App
    │
    ├─► Parse state JSON
    │
    ├─► Verify matches expected state
    │
    └─► Use to determine which scopes to request
```

---

## Error Scenarios

### User Denies Permission

```
┌─────────────┐         ┌──────────────┐         ┌─────────────────┐
│  Desktop    │         │   Browser    │         │   OAuth         │
│     App     │         │              │         │   Provider      │
└──────┬──────┘         └──────┬───────┘         └────────┬────────┘
       │                       │                          │
       │ 1. Open OAuth URL     │                          │
       │──────────────────────>│                          │
       │                       │                          │
       │                       │ 2. GET /authorize        │
       │                       │─────────────────────────>│
       │                       │                          │
       │                       │ 3. Login/Consent         │
       │                       │<─────────────────────────│
       │                       │                          │
       │ 4. User clicks "Deny" │                          │
       │                       │                          │
       │                       │ 5. 302 Redirect          │
       │                       │    Location: ...?error=access_denied
       │                       │<─────────────────────────│
       │                       │                          │
       │                       │ 6. GET /callback?        │
       │                       │    error=access_denied&  │
       │                       │    error_description=... │
       │<──────────────────────│                          │
       │                       │                          │
       │ 7. Show error message │                          │
       │    "Calendar access   │                          │
       │     was denied"       │                          │
       │◄──┐                   │                          │
       │   │                   │                          │
```

### Token Expired & Refresh Failed

```
┌─────────────┐         ┌─────────────────┐
│  Desktop    │         │   OAuth         │
│     App     │         │   Provider      │
└──────┬──────┘         └────────┬────────┘
       │                         │
       │ 1. POST /token          │
       │    grant_type=          │
       │    refresh_token        │
       │────────────────────────>│
       │                         │
       │ 2. 400 Bad Request      │
       │    {error: "invalid_grant"}
       │<────────────────────────│
       │                         │
       │ 3. Clear stored tokens  │
       │◄──┐                     │
       │   │                     │
       │   │                     │
       │ 4. Prompt user to       │
       │    re-authenticate      │
       │◄──┐                     │
       │   │                     │
       │   │                     │
       │ 5. Restart OAuth flow   │
       │────────────────────────>│
       │                         │
```

---

## Comparison: Direct vs Backend-Mediated

### Backend-Mediated (Current HiDock Implementation)

**Pros**:
- No OAuth app registration needed
- Backend handles token refresh automatically
- Unified event format across providers
- Works across all platforms (web, desktop, mobile)

**Cons**:
- Requires internet connection always
- Tokens stored on HiDock servers
- Privacy considerations
- Dependent on backend availability

### Direct OAuth (Desktop Only)

**Pros**:
- Works offline (after initial auth)
- Tokens stored locally
- Full control over data
- No backend dependency for API calls

**Cons**:
- Need to register OAuth apps with MS/Google
- Handle token refresh yourself
- Need to normalize different API formats
- Platform-specific redirect URI (localhost)

---

## Security Considerations

### PKCE (Proof Key for Code Exchange)

For native apps, PKCE should be used:

```
┌─────────────┐         ┌─────────────────┐
│  Desktop    │         │   OAuth         │
│     App     │         │   Provider      │
└──────┬──────┘         └────────┬────────┘
       │                         │
       │ 1. Generate             │
       │    code_verifier        │
       │    (random 43-128 chars)│
       │◄──┐                     │
       │   │                     │
       │   │                     │
       │ 2. Generate             │
       │    code_challenge =     │
       │    SHA256(verifier)     │
       │◄──┐                     │
       │   │                     │
       │   │                     │
       │ 3. GET /authorize?      │
       │    ...&                 │
       │    code_challenge=...&  │
       │    code_challenge_method=S256
       │────────────────────────>│
       │                         │
       │ 4. Authorization flow   │
       │<───────────────────────>│
       │                         │
       │ 5. POST /token?         │
       │    ...&                 │
       │    code_verifier=...    │
       │────────────────────────>│
       │                         │
       │ 6. Verify challenge     │
       │    matches verifier     │
       │                    ┌───>│
       │                    │    │
       │                    │    │
       │ 7. Return tokens    │    │
       │<────────────────────────│
       │                         │
```

---

**Document Version**: 1.0
**Last Updated**: 2025-11-06
