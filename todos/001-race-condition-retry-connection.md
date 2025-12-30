---
id: "001"
title: "Fix race condition in handleRetryConnection"
status: pending
priority: P1
category: bug
source: feature-code-reviewer
created: 2025-12-30
files:
  - apps/electron/src/pages/Library.tsx
---

# Fix race condition in handleRetryConnection

## Problem

In `Library.tsx`, the `handleRetryConnection` function has a race condition where it sets `connectionError` to `null` before the async operation completes. If the retry fails, the error state is lost.

## Location

`apps/electron/src/pages/Library.tsx` - `handleRetryConnection` function

## Current Code

```typescript
const handleRetryConnection = async () => {
  setConnectionError(null)  // Clears error before knowing if retry succeeds
  try {
    await window.api.device.connect()
  } catch (err) {
    setConnectionError(err instanceof Error ? err.message : 'Connection failed')
  }
}
```

## Suggested Fix

```typescript
const handleRetryConnection = async () => {
  setIsRetrying(true)
  try {
    await window.api.device.connect()
    setConnectionError(null)  // Only clear on success
  } catch (err) {
    setConnectionError(err instanceof Error ? err.message : 'Connection failed')
  } finally {
    setIsRetrying(false)
  }
}
```

## Impact

- Users may see incorrect connection state during retry
- Error messages may flash or disappear unexpectedly
- Potential for confusing UX during connection issues

## Acceptance Criteria

- [ ] Error state only cleared after successful connection
- [ ] Loading/retry state shown during connection attempt
- [ ] Error preserved if retry fails
