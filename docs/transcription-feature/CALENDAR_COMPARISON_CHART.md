# Calendar Integration: Microsoft vs Google - Detailed Comparison

## Quick Reference Matrix

| Aspect | Microsoft Outlook/O365 | Google Calendar | Notes |
|--------|------------------------|-----------------|-------|
| **OAuth Authorization URL** | `login.microsoftonline.com/common/oauth2/v2.0/authorize` | `accounts.google.com/o/oauth2/auth` | Both use standard OAuth 2.0 |
| **Token Exchange URL** | `login.microsoftonline.com/common/oauth2/v2.0/token` | `oauth2.googleapis.com/token` | POST with authorization code |
| **Client ID** | `287048ad-e335-4cbd-8d76-658acb0785d5` | `122776600569-vi9kuatv0lltcut7f8hrpq5e5ln7qf3j.apps.googleusercontent.com` | HiDock's registered apps |
| **Redirect URI** | `https://hinotes.hidock.com/auth` | `https://hinotes.hidock.com/auth` | Identical for both |
| **Read-Only Scope** | `Calendars.Read` | `https://www.googleapis.com/auth/calendar` | Google has no separate read scope |
| **Read-Write Scope** | `Calendars.ReadWrite` | `https://www.googleapis.com/auth/calendar` | Same as read for Google |
| **Additional Scopes** | `openid offline_access` | `openid` | Microsoft requires explicit offline_access |
| **Refresh Token Parameter** | `scope=offline_access` | `access_type=offline` | Different methods, same result |
| **Consent Prompt** | `prompt=select_account` | `prompt=consent` | MS shows account picker, Google shows consent |
| **State Parameter** | `{"platform": "microsoft", ...}` | `{"platform": "google", ...}` | JSON with permissions tracking |

---

## OAuth Flow Comparison

### Microsoft Flow Characteristics

```
User Experience:
1. Microsoft login page (familiar blue branding)
2. Email/phone input
3. Password entry
4. MFA challenge (if enabled)
5. Account picker (if multiple accounts)
6. Permission consent screen
7. Redirect to HiDock

Typical Duration: 20-60 seconds
```

**Unique Features**:
- Supports work/school accounts (Azure AD)
- Supports personal accounts (Microsoft Account)
- Uses `/common` tenant for both account types
- Account picker shows organization name

**Consent Screen Shows**:
- "View your basic profile"
- "Maintain access to data you have given it access to"
- "Sign you in and read your profile"
- "Read your calendars"

### Google Flow Characteristics

```
User Experience:
1. Google account selection (if multiple accounts)
2. Password entry (if not logged in)
3. Detailed permission consent screen
4. "Allow" button
5. Redirect to HiDock

Typical Duration: 15-40 seconds
```

**Unique Features**:
- Shows all Google accounts logged into browser
- Always shows consent screen (due to `prompt=consent`)
- Lists detailed permissions in plain language
- Shows app name and verification status

**Consent Screen Shows**:
- "This will allow HiDock to:"
- "See, edit, share, and permanently delete all the calendars you can access using Google Calendar"
- App logo and verification status

---

## API Endpoint Comparison

### Microsoft Graph API

**Base URL**: `https://graph.microsoft.com/v1.0`

**Get Events Endpoint**:
```
GET /me/calendarView?startDateTime=2025-12-01T00:00:00Z&endDateTime=2025-12-31T23:59:59Z
```

**Headers**:
```
Authorization: Bearer {access_token}
Content-Type: application/json
Prefer: outlook.timezone="UTC"
```

**Response Structure**:
```json
{
  "@odata.context": "https://graph.microsoft.com/v1.0/$metadata#users('...')/calendarView",
  "value": [
    {
      "id": "AAMkAGEy...",
      "subject": "Team Meeting",
      "start": {
        "dateTime": "2025-12-05T14:00:00.0000000",
        "timeZone": "UTC"
      },
      "end": {
        "dateTime": "2025-12-05T15:00:00.0000000",
        "timeZone": "UTC"
      },
      "location": {
        "displayName": "Microsoft Teams Meeting",
        "locationType": "default"
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
      "attendees": [...]
    }
  ]
}
```

**Pagination**:
- Uses `@odata.nextLink` for next page
- Default: 10 events per page
- Max: 999 events per page (use `$top` parameter)

### Google Calendar API

**Base URL**: `https://www.googleapis.com/calendar/v3`

**Get Events Endpoint**:
```
GET /calendars/primary/events?timeMin=2025-12-01T00:00:00Z&timeMax=2025-12-31T23:59:59Z&singleEvents=true&orderBy=startTime
```

**Headers**:
```
Authorization: Bearer {access_token}
```

**Response Structure**:
```json
{
  "kind": "calendar#events",
  "etag": "\"p33c...",
  "summary": "user@gmail.com",
  "updated": "2025-11-06T10:00:00.000Z",
  "timeZone": "UTC",
  "items": [
    {
      "kind": "calendar#event",
      "id": "abc123xyz",
      "status": "confirmed",
      "summary": "Team Meeting",
      "location": "Google Meet",
      "start": {
        "dateTime": "2025-12-05T14:00:00Z",
        "timeZone": "UTC"
      },
      "end": {
        "dateTime": "2025-12-05T15:00:00Z",
        "timeZone": "UTC"
      },
      "organizer": {
        "email": "john@example.com",
        "displayName": "John Doe"
      },
      "hangoutLink": "https://meet.google.com/abc-defg-hij",
      "attendees": [...]
    }
  ]
}
```

**Pagination**:
- Uses `nextPageToken` query parameter
- Default: 250 events per page
- Max: 2500 events per page (use `maxResults` parameter)

---

## Event Field Mapping

HiDock backend normalizes both formats to unified structure:

| HiDock Field | Microsoft Graph | Google Calendar | Notes |
|--------------|----------------|-----------------|-------|
| `title` | `subject` | `summary` | Event name |
| `startTime` | `start.dateTime` | `start.dateTime` | ISO 8601 format |
| `endTime` | `end.dateTime` | `end.dateTime` | ISO 8601 format |
| `location` | `location.displayName` | `location` | String vs object |
| `owner` | `organizer.emailAddress.address` | `organizer.email` | Email address |
| `status` | `responseStatus.response` | `status` | Different values |
| `eventId` | `id` | `id` | Provider's ID |
| `meetingWay` | Derived from `isOnlineMeeting` | Derived from `hangoutLink` | Backend logic |

### Status Value Mapping

| HiDock Status | Microsoft | Google |
|---------------|-----------|--------|
| `accepted` | `accepted` | `confirmed` |
| `tentative` | `tentative` | `tentative` |
| `declined` | `declined` | `cancelled` |

### Meeting Type Detection

| HiDock `meetingWay` | Microsoft Indicators | Google Indicators |
|---------------------|---------------------|-------------------|
| `teams` | `isOnlineMeeting: true` + Teams URL | N/A |
| `google_meet` | N/A | `hangoutLink` present |
| `zoom` | `location` contains "zoom.us" | `location` contains "zoom.us" |
| `physical` | No online meeting indicators | No online meeting indicators |

---

## Scope Permissions Comparison

### Microsoft Scopes

| Scope | Permission Level | Access Granted |
|-------|-----------------|----------------|
| `openid` | Basic | User ID, basic profile |
| `offline_access` | Special | Refresh token for long-term access |
| `Calendars.Read` | Read-only | View calendar events |
| `Calendars.ReadWrite` | Read-write | View, create, edit, delete events |
| `Calendars.Read.Shared` | Read-only (delegated) | Access shared calendars |
| `Calendars.ReadWrite.Shared` | Read-write (delegated) | Edit shared calendars |

**Microsoft Scope Granularity**: Fine-grained (separate read/write)

### Google Scopes

| Scope | Permission Level | Access Granted |
|-------|-----------------|----------------|
| `openid` | Basic | User ID |
| `https://www.googleapis.com/auth/calendar` | Read-write | Full calendar access |
| `https://www.googleapis.com/auth/calendar.readonly` | Read-only | View calendar events |
| `https://www.googleapis.com/auth/calendar.events` | Read-write (events only) | Manage events, not calendars |

**Google Scope Granularity**: Coarse-grained (fewer options)

**Note**: HiDock uses full access scope for both providers (for consistency)

---

## Token Lifetime Comparison

| Token Type | Microsoft | Google |
|------------|-----------|--------|
| **Access Token** | 60-90 minutes | 60 minutes |
| **Refresh Token** | Long-lived (months/years) | Long-lived (months/years) |
| **Refresh Token Expiry** | 90 days if unused | 6 months if unused |
| **Token Revocation** | User can revoke at account.microsoft.com | User can revoke at myaccount.google.com |

**Refresh Behavior**:
- **Microsoft**: Returns new access token, keeps same refresh token (unless expired)
- **Google**: Returns new access token, may return new refresh token

---

## Rate Limits Comparison

### Microsoft Graph API

**Throttling Limits**:
- 10,000 requests per 10 minutes per user
- Per-app throttling varies by tenant
- 503 response with `Retry-After` header when throttled

**Best Practices**:
- Use `$top` and `$skip` for pagination
- Implement exponential backoff
- Cache responses when possible

### Google Calendar API

**Quota Limits**:
- 1,000,000 queries per day (default)
- 10 queries per second per user
- 500 queries per 100 seconds per user

**Error Codes**:
- 403: Rate limit exceeded
- 429: Too many requests

**Best Practices**:
- Use `maxResults` for pagination
- Implement exponential backoff (1, 2, 4, 8 seconds)
- Use `If-None-Match` with ETags for caching

---

## Error Handling Comparison

### Microsoft Error Responses

```json
{
  "error": {
    "code": "ErrorAccessDenied",
    "message": "Access is denied. Check credentials and try again.",
    "innerError": {
      "request-id": "abc-123",
      "date": "2025-11-06T10:00:00"
    }
  }
}
```

**Common Error Codes**:
- `ErrorAccessDenied`: Invalid or expired token
- `ErrorInvalidRequest`: Malformed request
- `ErrorItemNotFound`: Calendar/event doesn't exist
- `ErrorThrottled`: Rate limit exceeded

### Google Error Responses

```json
{
  "error": {
    "errors": [
      {
        "domain": "global",
        "reason": "authError",
        "message": "Invalid Credentials",
        "locationType": "header",
        "location": "Authorization"
      }
    ],
    "code": 401,
    "message": "Invalid Credentials"
  }
}
```

**Common Error Codes**:
- `401`: Invalid or expired token
- `403`: Insufficient permissions or rate limit
- `404`: Calendar/event not found
- `429`: Rate limit exceeded (retry after delay)

---

## Feature Support Comparison

| Feature | Microsoft | Google | Notes |
|---------|-----------|--------|-------|
| **Recurring Events** | Yes | Yes | Both expand with `singleEvents=true` |
| **All-Day Events** | Yes | Yes | Different date format (date vs dateTime) |
| **Multiple Calendars** | Yes | Yes | Requires separate API calls per calendar |
| **Attendee Responses** | Yes | Yes | Both include response status |
| **Attachments** | Yes | Limited | MS has better attachment support |
| **Private Events** | Yes | Yes | Both support privacy settings |
| **Event Colors** | Yes | Yes | Different color schemes |
| **Time Zones** | Yes | Yes | Both support per-event time zones |
| **Reminders** | Yes | Yes | Different reminder formats |
| **Online Meetings** | Teams (native) | Meet (native) | Both support other platforms via URL |
| **Free/Busy Info** | Yes | Yes | Separate API endpoints |

---

## Webhook/Push Notification Support

### Microsoft Graph API

**Change Notifications**:
```
POST https://graph.microsoft.com/v1.0/subscriptions
{
  "changeType": "created,updated,deleted",
  "notificationUrl": "https://your-app.com/notifications",
  "resource": "/me/events",
  "expirationDateTime": "2025-11-13T00:00:00Z"
}
```

**Characteristics**:
- Max subscription duration: 4230 minutes (2.9 days) for calendar
- Requires HTTPS endpoint with valid SSL
- Sends notification with `@odata.type` and `resource` info
- Requires validation handshake

### Google Calendar API

**Push Notifications**:
```
POST https://www.googleapis.com/calendar/v3/calendars/primary/events/watch
{
  "id": "unique-channel-id",
  "type": "web_hook",
  "address": "https://your-app.com/notifications"
}
```

**Characteristics**:
- Max subscription duration: 30 days
- Requires verified domain
- Sends notification with `X-Goog-Resource-State` header
- Manual renewal required before expiration

**Note**: HiDock backend uses polling instead of webhooks (simpler, no server setup needed)

---

## Security Comparison

| Security Aspect | Microsoft | Google |
|----------------|-----------|--------|
| **OAuth Flow** | Authorization Code | Authorization Code |
| **PKCE Support** | Yes (recommended for public clients) | Yes (recommended) |
| **Client Secret** | Required for confidential clients | Required for confidential clients |
| **Token Storage** | Encrypted at rest (backend) | Encrypted at rest (backend) |
| **Scope Consent** | Per-scope granularity | Bundled permissions |
| **Token Revocation** | Yes, at account.microsoft.com | Yes, at myaccount.google.com |
| **App Verification** | Required for production | Required for production |
| **Data Access Review** | User can review at account.microsoft.com | User can review at myaccount.google.com |

---

## Implementation Complexity

| Task | Microsoft | Google | Winner |
|------|-----------|--------|--------|
| **OAuth Setup** | Medium | Easy | Google |
| **App Registration** | Azure Portal (complex) | Google Cloud Console (simpler) | Google |
| **Scope Configuration** | More options, more complex | Fewer options, simpler | Google |
| **API Documentation** | Excellent | Excellent | Tie |
| **Error Messages** | Clear and detailed | Clear and detailed | Tie |
| **SDK Quality** | Excellent (official SDKs) | Excellent (official SDKs) | Tie |
| **Testing** | Graph Explorer available | Try It feature available | Tie |
| **Event Format** | Complex (nested objects) | Simpler (flat-ish structure) | Google |
| **Pagination** | OData (standard) | Custom tokens | Microsoft |
| **Overall** | More powerful, more complex | Simpler, less flexible | Depends on needs |

---

## Recommendation for HiDock Desktop

### Use Backend-Mediated Approach (Current Web Implementation)

**Why?**
1. **Identical implementation** for Microsoft and Google
2. **No OAuth app registration** needed (use HiDock's apps)
3. **Unified event format** (backend normalizes differences)
4. **Token management handled** by backend (refresh, revocation, etc.)
5. **Faster development** (~2 days vs ~7 days)

**Trade-off**: Requires internet connection and HiDock backend availability

### If Going Direct OAuth Route

**Recommendation**:
1. **Start with Microsoft** (larger enterprise market share)
2. **Use PKCE** for security (no client secret in desktop app)
3. **Implement Google** second (similar flow, easier API)
4. **Consider using SDK** (Microsoft Graph SDK or Google API client)

---

## Testing Recommendations

### Test Scenarios for Both Providers

- [ ] **First-time connection** (no cached credentials)
- [ ] **Re-authentication** (with cached credentials)
- [ ] **Multiple accounts** (user has many MS/Google accounts)
- [ ] **MFA enabled** (Microsoft requires 2FA)
- [ ] **Permission denial** (user clicks "Deny")
- [ ] **Token expiration** (access token expires)
- [ ] **Token refresh** (use refresh token to get new access token)
- [ ] **Revoked access** (user revokes in account settings)
- [ ] **Network failure** (during OAuth or API call)
- [ ] **Rate limiting** (make many requests quickly)
- [ ] **Empty calendar** (user has no events)
- [ ] **Large calendar** (user has 1000+ events)
- [ ] **Recurring events** (daily, weekly, monthly patterns)
- [ ] **All-day events** (no specific time)
- [ ] **Multi-day events** (conference, vacation)
- [ ] **Different time zones** (event in PST, user in EST)
- [ ] **Online meetings** (Teams, Meet, Zoom)
- [ ] **Cancelled events** (status = cancelled/declined)

### Provider-Specific Scenarios

**Microsoft-Only**:
- [ ] Work/school account (Azure AD)
- [ ] Personal account (Microsoft Account)
- [ ] Hybrid account (both)
- [ ] Shared calendar access
- [ ] Delegated calendar access

**Google-Only**:
- [ ] Gmail account
- [ ] Google Workspace account
- [ ] Multiple Google calendars
- [ ] Shared calendar (read-only)

---

## Quick Decision Matrix

Choose **Microsoft** if:
- Target audience is enterprise/business users
- Need fine-grained permissions (read-only vs read-write)
- Integration with Microsoft ecosystem (Teams, Outlook, etc.)

Choose **Google** if:
- Target audience is consumers/individuals
- Want simpler OAuth setup
- Prefer simpler API responses

Choose **Both** (recommended):
- Maximum user coverage
- Support both enterprise and consumer users
- Backend-mediated approach makes it easy to support both

---

## Resources

### Microsoft Documentation
- Graph API Overview: https://learn.microsoft.com/en-us/graph/overview
- Calendar API Reference: https://learn.microsoft.com/en-us/graph/api/resources/calendar
- OAuth 2.0 Guide: https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
- Graph Explorer (testing): https://developer.microsoft.com/en-us/graph/graph-explorer

### Google Documentation
- Calendar API Overview: https://developers.google.com/calendar/api/guides/overview
- API Reference: https://developers.google.com/calendar/api/v3/reference
- OAuth 2.0 Guide: https://developers.google.com/identity/protocols/oauth2
- OAuth Playground (testing): https://developers.google.com/oauthplayground/

---

**Last Updated**: 2025-11-06
**Analysis Source**: HAR file inspection of HiDock web app
