---
id: "029"
priority: P2
status: closed
category: architecture
title: Duplicate Device Subscriptions in OperationController and Device.tsx
files:
  - apps/electron/src/components/OperationController.tsx
  - apps/electron/src/pages/Device.tsx
created: 2024-12-27
---

# Duplicate Device Subscriptions

## Problem

Both OperationController.tsx and Device.tsx subscribe to the same device events (onStateChange, onStatusChange, onActivity). This causes:
- Duplicate event handlers
- Wasted memory
- Potential for state drift
- Harder debugging

## Location

- `apps/electron/src/components/OperationController.tsx` (lines ~348-385)
- `apps/electron/src/pages/Device.tsx` (lines ~70-100)

## Current Code

**OperationController.tsx:**
```typescript
useEffect(() => {
  const unsubStateChange = deviceService.onStateChange((state) => {
    setDeviceState(state)  // Updates Zustand store
  })
  const unsubStatusChange = deviceService.onStatusChange((status) => {
    setConnectionStatus(status)
  })
  const unsubActivity = deviceService.onActivity((entry) => {
    addActivityLogEntry(entry)
  })
  // ... cleanup
}, [])
```

**Device.tsx:**
```typescript
useEffect(() => {
  const unsubState = deviceService.onStateChange(setDeviceState)  // Local state
  const unsubStatus = deviceService.onStatusChange(setConnectionStatus)  // Local state
  const unsubActivity = deviceService.onActivity((entry) => {
    setActivityLog(prev => [...prev.slice(-99), entry])  // Local state
  })
  // ... cleanup
}, [])
```

## Solution

1. **Remove subscriptions from Device.tsx entirely:**

```typescript
// Device.tsx should ONLY read from store
export function DevicePage() {
  // Read from store (no local state, no subscriptions)
  const {
    deviceState,
    connectionStatus,
    activityLog
  } = useAppStore()

  // NO useEffect for device subscriptions
  // OperationController handles all subscriptions

  return (
    // ... render using store state
  )
}
```

2. **Verify OperationController is the single subscription point:**

```typescript
// OperationController.tsx (keep as-is, it's correct)
useEffect(() => {
  // Single point of subscription to device service
  const unsubStateChange = deviceService.onStateChange((state) => {
    setDeviceState(state)  // Updates store
  })
  // ... other subscriptions
}, [])
```

3. **Add guard to prevent duplicate subscriptions:**

```typescript
// In OperationController.tsx
const deviceSubscriptionsInitialized = useRef(false)

useEffect(() => {
  if (deviceSubscriptionsInitialized.current) {
    console.warn('[OperationController] Duplicate subscription attempt blocked')
    return
  }
  deviceSubscriptionsInitialized.current = true

  // ... subscribe
}, [])
```

## Verification

After fixing, run this in console to verify:
```javascript
// Should show only 1 subscription per event type
__deviceService.getSubscriptionCounts()
// Expected: { state: 1, status: 1, activity: 1 }
```

## Related Todo

This is related to #026 (Device.tsx local state). Fixing #026 will also fix this issue since removing local state from Device.tsx will remove the need for its subscriptions.

## Testing

- [ ] Only OperationController subscribes to device events
- [ ] Device.tsx renders correctly from store data
- [ ] No duplicate event handlers
- [ ] Subscription count stays at 1 per event type

## Acceptance Criteria

- [ ] Device.tsx has zero device service subscriptions
- [ ] OperationController is single subscription point
- [ ] Guard prevents accidental duplicate subscriptions
- [ ] Device state updates correctly on all pages
