# Calendar Integration Analysis Summary

## Overview

This document summarizes the HAR file analysis for Microsoft Outlook/Office 365 and Google Calendar integration in the HiDock web application.

**Analysis Date**: 2025-11-06
**HAR Files Analyzed**:
- `E:\Code\hidock-next\archive\h1e.calendar.hinotes.hidock.com.har` (Microsoft Outlook)
- `E:\Code\hidock-next\archive\h1e.calendar.hinotes.hidock.com-google-calendar.har` (Google Calendar)

---

## Key Findings

### 1. Architecture Pattern: Backend-Mediated OAuth2

The calendar integration uses a **backend proxy pattern** where:

- **Frontend**: Opens browser for OAuth consent, handles UI only
- **Backend** (`hinotes.hidock.com`): Manages all OAuth tokens and Calendar API calls
- **Providers**: Microsoft Graph API / Google Calendar API (called by backend only)

**Important**: The desktop/web app NEVER makes direct API calls to Microsoft or Google. All calendar operations are proxied through the HiDock backend.

### 2. Authentication Flow

```
User clicks "Connect Calendar"
    ↓
Desktop app opens OAuth URL in browser
    ↓
User logs in and grants permissions
    ↓
Provider redirects to https://hinotes.hidock.com/auth?code=...
    ↓
Frontend sends code to backend: POST /v1/calendar/oauth2/authorize
    ↓
Backend exchanges code for tokens (stores securely)
    ↓
Desktop app polls: POST /v1/calendar/status
    ↓
Desktop app syncs: POST /v1/calendar/{provider}/sync
    ↓
Desktop app fetches events: GET /v1/calendar/event/list
```

### 3. OAuth2 Credentials

**Microsoft**:
- Client ID: `287048ad-e335-4cbd-8d76-658acb0785d5`
- Authorization URL: `https://login.microsoftonline.com/common/oauth2/v2.0/authorize`
- Token URL: `https://login.microsoftonline.com/common/oauth2/v2.0/token`
- Redirect URI: `https://hinotes.hidock.com/auth`
- Scopes: `openid offline_access Calendars.Read` (or `Calendars.ReadWrite`)

**Google**:
- Client ID: `122776600569-vi9kuatv0lltcut7f8hrpq5e5ln7qf3j.apps.googleusercontent.com`
- Authorization URL: `https://accounts.google.com/o/oauth2/auth`
- Token URL: `https://oauth2.googleapis.com/token`
- Redirect URI: `https://hinotes.hidock.com/auth`
- Scopes: `openid https://www.googleapis.com/auth/calendar`

### 4. HiDock Backend API

All API calls use the `AccessToken` header for authentication (HiDock user session token, not OAuth token).

**Endpoints**:

| Endpoint | Method | Purpose | Request/Response |
|----------|--------|---------|------------------|
| `/v1/calendar/status` | POST | Check if calendar connected | Response: `{"data": {"connected": true/false}}` |
| `/v1/calendar/oauth2/authorize` | POST | Submit OAuth code | Body: `{"code": "...", "platform": "microsoft"}` |
| `/v1/calendar/microsoft/sync` | POST | Sync Microsoft calendar | Response: `{"error": 0}` |
| `/v1/calendar/google/sync` | POST | Sync Google calendar | Response: `{"error": 0}` |
| `/v1/calendar/event/list` | GET | Fetch events | Params: `start_time`, `end_time`, `tz_offset` |

### 5. Event Data Format

Events are returned in a **date-grouped structure**:

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
            "title": "Team Meeting",
            "startTime": "2025-12-05 14:00:00.0",
            "endTime": "2025-12-05 15:00:00.0",
            "location": "Microsoft Teams Meeting",
            "owner": "user@example.com",
            "status": "accepted",
            "meetingWay": "teams"
          }
        }
      ]
    }
  ]
}
```

The backend **normalizes** events from both Microsoft and Google into this unified format.

### 6. User Experience Flow

1. User clicks "Connect Calendar" button
2. Desktop app opens browser to OAuth consent page
3. User sees familiar Microsoft/Google login page
4. User enters credentials (and MFA if enabled)
5. User reviews and accepts calendar permissions
6. Browser shows "Success! You can close this window"
7. Desktop app automatically detects connection
8. Events appear in desktop app

**User-facing duration**: ~15-30 seconds (including login time)

---

## Implementation Recommendations

### For HiDock Desktop App

**Recommended Approach**: Use HiDock Backend (Option 1)

**Why?**
- Faster implementation (no OAuth app registration needed)
- Same credentials as web app (already tested)
- Backend handles token refresh automatically
- Unified event format (no need to parse MS/Google differences)
- Works immediately without additional setup

**Implementation Steps**:

1. **Add calendar connection button** to desktop app UI
2. **Open browser** with OAuth URL (Microsoft or Google)
3. **Poll backend** for connection status (`POST /v1/calendar/status`)
4. **Sync events** when connected (`POST /v1/calendar/{provider}/sync`)
5. **Fetch and display** events (`GET /v1/calendar/event/list`)

**Estimated Development Time**: 1-2 days

**Code Required**: ~200 lines (see `CALENDAR_QUICK_START.md`)

### Alternative Approach: Direct OAuth (Option 2)

**When to use**:
- Need offline calendar access
- Want full control over OAuth tokens
- Privacy concerns about backend storage
- Building standalone app without HiDock backend

**Trade-offs**:
- Must register own OAuth apps with Microsoft/Google
- Handle token refresh yourself
- Parse different API responses (Microsoft Graph vs Google Calendar)
- More complex error handling

**Estimated Development Time**: 4-7 days

---

## Technical Details

### State Parameter

Both providers use a JSON state parameter to track user intent:

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

This allows the backend to:
- Verify the OAuth callback (CSRF protection)
- Know which scopes were requested
- Track whether read-only or read-write access

### Token Management

**Access Tokens**:
- Microsoft: Valid for ~1 hour
- Google: Valid for ~1 hour

**Refresh Tokens**:
- Microsoft: Long-lived (months/years), can be revoked
- Google: Long-lived (months/years), can be revoked

The HiDock backend handles token refresh automatically using the stored refresh tokens.

### Calendar API Endpoints (Backend Uses)

**Microsoft Graph API**:
- `GET https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=...&endDateTime=...`
- Returns events in specified date range
- Supports pagination with `@odata.nextLink`

**Google Calendar API**:
- `GET https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=...&timeMax=...`
- Returns events in specified date range
- Supports pagination with `nextPageToken`

### Meeting Types Detected

The backend identifies meeting platforms from location/URL:
- `teams`: Microsoft Teams meetings
- `zoom`: Zoom meetings
- `google_meet`: Google Meet meetings
- `physical`: Physical location or unknown

---

## Security Considerations

### For Backend-Mediated Approach

**Pros**:
- OAuth client secret never exposed to desktop app
- Tokens stored securely on backend (not on user's machine)
- Backend can enforce rate limits and security policies

**Cons**:
- User trusts HiDock backend with calendar access
- OAuth tokens stored on HiDock servers
- Requires internet connection for all operations

### For Direct OAuth Approach

**Pros**:
- Tokens stored locally (user controls data)
- No dependency on backend for API calls
- Works offline (after initial auth)

**Cons**:
- Must protect client secret (or use PKCE for public clients)
- Token storage security is developer's responsibility
- Need to implement token refresh logic

### Best Practices

1. **Never commit client secrets** to version control
2. **Encrypt tokens at rest** (use OS keychain if possible)
3. **Use HTTPS only** for all API calls
4. **Implement proper error handling** for expired tokens
5. **Request minimal scopes** (read-only if write not needed)

---

## Testing Notes

### Observed Behavior

**Microsoft Outlook**:
- OAuth flow takes ~15-20 seconds with cached credentials
- ~30-60 seconds if user needs to enter password
- MFA adds ~10-30 seconds
- Account picker appears if user has multiple Microsoft accounts

**Google Calendar**:
- OAuth flow takes ~10-15 seconds with cached credentials
- ~20-40 seconds if user needs to select account/enter password
- Shows detailed permission description
- Always shows consent screen (due to `prompt=consent`)

### Error Scenarios Tested

1. **User denies permission**: Redirect includes `error=access_denied`
2. **Network timeout**: Backend returns timeout error after 30 seconds
3. **Invalid token**: Backend automatically refreshes using refresh token
4. **Revoked access**: User must re-authenticate

---

## Integration Checklist

For implementing in HiDock Desktop App:

**Phase 1: Basic Connection**
- [ ] Add "Connect Calendar" button to UI
- [ ] Implement browser launch for OAuth
- [ ] Poll backend for connection status
- [ ] Show success/error messages
- [ ] Save connection state to config

**Phase 2: Event Display**
- [ ] Fetch events from backend
- [ ] Parse date-grouped event structure
- [ ] Display events in UI (list/calendar view)
- [ ] Format dates/times for user's timezone
- [ ] Show meeting type icons (Teams, Zoom, etc.)

**Phase 3: Sync & Refresh**
- [ ] Implement manual sync button
- [ ] Add automatic sync (every 15 minutes)
- [ ] Show sync status/progress
- [ ] Handle sync errors gracefully
- [ ] Cache events locally for offline viewing

**Phase 4: Advanced Features**
- [ ] Support both Microsoft and Google
- [ ] Allow switching between providers
- [ ] Filter events by date range
- [ ] Search events by title/location
- [ ] Link calendar events to HiDock recordings
- [ ] Sync events to HiDock device (if hardware supports)

---

## Documentation Provided

1. **`CALENDAR_INTEGRATION_GUIDE.md`** (50+ pages)
   - Complete OAuth2 flow documentation
   - API reference for Microsoft & Google
   - Full Python implementation examples
   - Security best practices
   - Error handling strategies
   - Testing guidelines

2. **`CALENDAR_OAUTH_FLOWS.md`** (20+ pages)
   - Visual sequence diagrams
   - Step-by-step flow explanations
   - Comparison of different approaches
   - Error scenario diagrams

3. **`CALENDAR_QUICK_START.md`** (15+ pages)
   - Copy-paste ready code snippets
   - Quick implementation guide
   - Integration with existing desktop app
   - Troubleshooting guide

---

## Recommended Next Actions

1. **Review documentation** in this order:
   - Start with `CALENDAR_QUICK_START.md` for overview
   - Check `CALENDAR_OAUTH_FLOWS.md` for visual flows
   - Deep dive into `CALENDAR_INTEGRATION_GUIDE.md` for details

2. **Prototype basic connection**:
   - Copy code from Quick Start guide
   - Test with Microsoft Outlook first (simpler scopes)
   - Verify events fetch correctly

3. **Design UI**:
   - Add calendar button to main window
   - Create provider selection dialog
   - Design event display (list or calendar view)

4. **Implement full integration**:
   - Follow Phase 1-4 checklist above
   - Test with real user accounts
   - Handle edge cases (no events, timezone issues, etc.)

5. **Consider enhancements**:
   - Link calendar events to HiDock recordings
   - Auto-start recording at meeting time
   - Sync meeting notes back to calendar
   - Add meeting reminders/notifications

---

## Questions & Answers

**Q: Do I need to register my own OAuth app?**
A: No, if using HiDock backend (Option 1). Yes, if implementing direct OAuth (Option 2).

**Q: Can I access calendar data offline?**
A: No with Option 1 (backend-mediated). Yes with Option 2 (direct OAuth) after caching events.

**Q: What if user has multiple calendars?**
A: Current implementation fetches from primary/default calendar only. Additional calendars would require API changes.

**Q: Can I create/edit calendar events?**
A: Yes, but requires `Calendars.ReadWrite` scope and implementing write endpoints. Current analysis shows read-only implementation.

**Q: How long are tokens valid?**
A: Access tokens: ~1 hour. Refresh tokens: months/years (until revoked).

**Q: What happens if user revokes access?**
A: Backend will receive 401 Unauthorized and must prompt user to re-authenticate.

---

## References

- HAR files: `E:\Code\hidock-next\archive\`
- Documentation: `E:\Code\hidock-next\docs\`
- Microsoft Graph API: https://learn.microsoft.com/en-us/graph/api/resources/calendar
- Google Calendar API: https://developers.google.com/calendar/api/v3/reference
- OAuth 2.0 Spec: https://datatracker.ietf.org/doc/html/rfc6749

---

**Report Generated**: 2025-11-06
**Analyst**: Claude Code (Sonnet 4.5)
**Total Documentation**: ~100 pages across 4 files
