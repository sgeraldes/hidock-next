# Backend P1 Security Review Findings

**Priority**: P2
**Category**: Security
**Component**: Backend Domain Services (Phase 0)
**Worktree**: `G:/Code/hidock-worktree-1-backend`

## Overview

Code review of P1 security fixes implemented in commit `b3c08200`. Focus on sanitization logic, input validation, and data broadcasting security.

---

## SECURITY-001: Incomplete Path Sanitization in event-bus.ts (P2)

**File**: `apps/electron/electron/main/services/event-bus.ts`
**Lines**: 58-61

### Issue

The regex pattern for sanitizing file paths only matches Windows absolute paths:
```typescript
sanitized.payload.reason = sanitized.payload.reason.replace(/[A-Za-z]:[\\/][^\s]+/g, '[path]')
```

**Gaps**:
1. **Unix/Linux paths not covered**: Paths like `/home/user/file.txt` or `/var/log/app.log` won't be sanitized
2. **UNC paths not covered**: Windows network paths like `\\server\share\file.txt` won't be sanitized
3. **Relative paths with sensitive info**: Paths like `../../secrets/key.pem` won't be sanitized
4. **Whitespace in paths**: Pattern breaks on paths with spaces (uses `[^\s]+` which stops at whitespace)

### Security Impact

**Medium Risk**: Sensitive system paths could leak to renderer process, revealing:
- User directory structure
- System configuration locations
- Network share mappings
- Application installation paths

### Recommendation

Replace the current regex with a comprehensive path sanitization:

```typescript
// Sanitize file paths across all platforms
if (sanitized.payload.reason && typeof sanitized.payload.reason === 'string') {
  let reason = sanitized.payload.reason

  // Windows absolute paths (C:\, D:\, etc.)
  reason = reason.replace(/[A-Za-z]:[\\\/](?:[^\\\/\s]+[\\\/])*[^\\\/\s]*/g, '[path]')

  // UNC paths (\\server\share\...)
  reason = reason.replace(/\\\\[^\\\/\s]+\\[^\\\/\s]+(?:\\[^\\\/\s]+)*/g, '[path]')

  // Unix absolute paths (/home/..., /var/..., etc.)
  reason = reason.replace(/\/(?:[^\/\s]+\/)*[^\/\s]+/g, (match) => {
    // Only sanitize if it looks like a real path (contains multiple segments)
    return match.split('/').filter(Boolean).length >= 2 ? '[path]' : match
  })

  // Relative paths with parent traversal (../)
  reason = reason.replace(/(?:\.\.\/)+[^\s]*/g, '[path]')

  sanitized.payload.reason = reason
}
```

**OR** use a path extraction library like `path` module for more robust detection.

### Testing

Add test cases:
```typescript
// Test Windows paths
expect(sanitize('Error at C:\\Users\\John\\file.txt')).not.toContain('C:\\Users\\John')
expect(sanitize('Failed: C:\\Program Files\\App\\config.json')).toBe('Failed: [path]')

// Test Unix paths
expect(sanitize('Error at /home/user/secret.key')).toBe('Error at [path]')
expect(sanitize('Config: /etc/app/database.conf')).toBe('Config: [path]')

// Test UNC paths
expect(sanitize('Network: \\\\server\\share\\file.txt')).toBe('Network: [path]')

// Test paths with spaces
expect(sanitize('Error at C:\\Program Files\\My App\\file.txt')).toBe('Error at [path]')

// Test relative traversal
expect(sanitize('Loaded: ../../secrets/key.pem')).toBe('Loaded: [path]')
```

---

## SECURITY-002: Email Sanitization Too Simplistic (P3)

**File**: `apps/electron/electron/main/services/event-bus.ts`
**Lines**: 63-69

### Issue

Email detection only checks for `@` character:
```typescript
if (sanitized.payload.assessedBy.includes('@')) {
  sanitized.payload.assessedBy = 'user'
}
```

**Gaps**:
1. No validation that it's actually an email format
2. Username formats like `DOMAIN\username` won't be sanitized
3. Doesn't handle arrays of emails or comma-separated lists
4. Other PII patterns not detected (phone numbers, API keys, tokens)

### Security Impact

**Low Risk**: May leak usernames in non-email formats, but email addresses are properly caught.

### Recommendation

```typescript
// Sanitize PII fields more comprehensively
if (sanitized.payload.assessedBy && typeof sanitized.payload.assessedBy === 'string') {
  let assessedBy = sanitized.payload.assessedBy

  // Email addresses
  assessedBy = assessedBy.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, 'user')

  // Domain\username format
  assessedBy = assessedBy.replace(/[A-Z]+\\[a-zA-Z0-9._-]+/g, 'user')

  // Remove any remaining @ symbols (partial emails)
  if (assessedBy.includes('@')) {
    assessedBy = 'user'
  }

  sanitized.payload.assessedBy = assessedBy
}
```

---

## SECURITY-003: Deep Clone via JSON May Lose Data Types (P3)

**File**: `apps/electron/electron/main/services/event-bus.ts`
**Lines**: 48-49

### Issue

Using `JSON.parse(JSON.stringify(event))` for deep cloning:
```typescript
const sanitized = JSON.parse(JSON.stringify(event))
```

**Problems**:
1. Loses `Date` objects (converts to strings)
2. Loses `undefined` values
3. Loses functions (shouldn't be in events anyway, but worth noting)
4. Loses `Map`, `Set`, `RegExp` objects
5. Circular references cause exceptions

### Security Impact

**Low Risk**: Not a security vulnerability per se, but could cause unexpected behavior if event payloads contain these types. Date strings should work fine for this use case.

### Recommendation

Since events should be serializable anyway (for IPC), this is acceptable. Add a comment:

```typescript
/**
 * Deep clone to avoid mutation
 * Note: Uses JSON serialization, so only serializable data is preserved
 * (no Date objects, undefined, functions, etc. - which is fine for IPC)
 */
const sanitized = JSON.parse(JSON.stringify(event)) as T
```

**Alternative**: Use `structuredClone()` if available (Node 17+):
```typescript
const sanitized = structuredClone(event)
```

---

## SECURITY-004: Missing Sanitization for Arrays (P2)

**File**: `apps/electron/electron/main/services/event-bus.ts`
**Lines**: 47-73

### Issue

Sanitization only handles top-level `payload` object. Arrays or nested objects containing sensitive data won't be sanitized.

**Example vulnerable payload**:
```typescript
{
  type: 'storage:cleanup-suggested',
  payload: {
    recordingIds: ['id1', 'id2'],  // OK
    details: [
      { reason: 'Old file at C:\\Users\\John\\secret.txt' },  // NOT SANITIZED!
      { assessedBy: 'john@company.com' }  // NOT SANITIZED!
    ]
  }
}
```

### Security Impact

**Medium Risk**: Nested sensitive data could leak if new event types are added with nested structures.

### Recommendation

Make sanitization recursive:

```typescript
function sanitizeEventPayload<T extends DomainEvent>(event: T): T {
  const sanitized = JSON.parse(JSON.stringify(event)) as T

  // Recursively sanitize all string fields in payload
  if (sanitized.payload && typeof sanitized.payload === 'object') {
    sanitizeObject(sanitized.payload)
  }

  return sanitized
}

function sanitizeObject(obj: any): void {
  if (obj === null || typeof obj !== 'object') return

  for (const key in obj) {
    const value = obj[key]

    if (typeof value === 'string') {
      // Apply all sanitization rules
      let sanitized = value

      // Remove file paths
      sanitized = sanitized.replace(/[A-Za-z]:[\\\/][^\s]*/g, '[path]')
      sanitized = sanitized.replace(/\\\\[^\\\/\s]+\\[^\s]*/g, '[path]')
      sanitized = sanitized.replace(/\/(?:[^\/\s]+\/)+[^\/\s]*/g, '[path]')

      // Remove emails
      if (key.toLowerCase().includes('email') || key.toLowerCase().includes('by')) {
        sanitized = sanitized.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, 'user')
      }

      obj[key] = sanitized
    } else if (typeof value === 'object') {
      // Recurse into nested objects/arrays
      sanitizeObject(value)
    }
  }

  // Remove known sensitive fields
  delete obj.internal
  delete obj.systemData
  delete obj.credentials
  delete obj.token
  delete obj.apiKey
}
```

---

## SECURITY-005: No Rate Limiting on Event Broadcasting (P3)

**File**: `apps/electron/electron/main/services/event-bus.ts`
**Lines**: 99-116

### Issue

No rate limiting on events sent to renderer process. A rapid burst of events could:
1. Overwhelm renderer process
2. Cause performance degradation
3. Potential DoS vector if attacker can trigger many events

### Security Impact

**Low Risk**: Internal DoS risk only (not exposed to external attackers), but could affect app stability.

### Recommendation

Add event throttling:

```typescript
class DomainEventBus extends EventEmitter {
  private mainWindow: BrowserWindow | null = null
  private listenerCount: Map<string, number> = new Map()
  private readonly MAX_LISTENERS_PER_EVENT = 20
  private rendererEventQueue: T[] = []
  private rendererEventTimestamps: number[] = []
  private readonly MAX_EVENTS_PER_SECOND = 50

  private canSendToRenderer(): boolean {
    const now = Date.now()
    const oneSecondAgo = now - 1000

    // Remove timestamps older than 1 second
    this.rendererEventTimestamps = this.rendererEventTimestamps.filter(ts => ts > oneSecondAgo)

    return this.rendererEventTimestamps.length < this.MAX_EVENTS_PER_SECOND
  }

  emitDomainEvent<T extends DomainEvent>(event: T): void {
    const enrichedEvent: T = { ...event, timestamp: event.timestamp || new Date().toISOString() }

    // Emit to internal listeners (no throttling)
    this.emit(event.type, enrichedEvent)
    this.emit('*', enrichedEvent)

    // Throttle renderer broadcasts
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      if (this.canSendToRenderer()) {
        const sanitized = sanitizeEventPayload(enrichedEvent)
        this.mainWindow.webContents.send('domain-event', sanitized)
        this.rendererEventTimestamps.push(Date.now())
      } else {
        console.warn(`[EventBus] Renderer event rate limit exceeded, dropping event: ${event.type}`)
      }
    }

    console.log(`[EventBus] Emitted: ${event.type}`, enrichedEvent.payload)
  }
}
```

---

## Summary

| ID | Issue | Priority | Risk | Status |
|----|-------|----------|------|--------|
| SECURITY-001 | Incomplete path sanitization | P2 | Medium | Open |
| SECURITY-002 | Email sanitization too simple | P3 | Low | Open |
| SECURITY-003 | JSON clone loses types | P3 | Low | Open |
| SECURITY-004 | Missing nested sanitization | P2 | Medium | Open |
| SECURITY-005 | No rate limiting | P3 | Low | Open |

## Recommended Action Plan

1. **Immediate (P2)**:
   - Fix SECURITY-001 (path sanitization)
   - Fix SECURITY-004 (nested sanitization)

2. **Next Sprint (P3)**:
   - Enhance SECURITY-002 (email patterns)
   - Add SECURITY-005 (rate limiting)
   - Document SECURITY-003 (expected behavior)

3. **Add Tests**: Create comprehensive test suite for `sanitizeEventPayload()`

---

**Reviewed by**: Claude Opus 4.5
**Date**: 2025-12-26
**Worktree**: hidock-worktree-1-backend
**Commit**: b3c08200
