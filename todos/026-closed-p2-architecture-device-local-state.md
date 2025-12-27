---
id: "026"
priority: P2
status: closed
category: architecture
title: Device.tsx Maintains Local State Instead of Using Store
files:
  - apps/electron/src/pages/Device.tsx
  - apps/electron/src/store/useAppStore.ts
created: 2024-12-27
---

# Device.tsx Maintains Local State Instead of Using Store

## Problem

Device.tsx uses local useState hooks for device state that should be read from the Zustand store. This creates duplicate state, potential drift, and violates the established architecture pattern.

## Location

`apps/electron/src/pages/Device.tsx`

## Current Code

```typescript
// Device.tsx currently has local state:
const [deviceState, setDeviceState] = useState<HiDockDeviceState>(() => deviceService.getState())
const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(() => deviceService.getConnectionStatus())
const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([])

// Plus subscriptions to keep them in sync:
useEffect(() => {
  const unsubState = deviceService.onStateChange(setDeviceState)
  const unsubStatus = deviceService.onStatusChange(setConnectionStatus)
  const unsubActivity = deviceService.onActivity((entry) => {
    setActivityLog(prev => [...prev.slice(-99), entry])
  })
  return () => { ... }
}, [])
```

## Architecture Violation

The correct pattern is:
```
Components → Zustand Store → OperationController → Services
     ↑                              ↓
     └──────── reads from ──────────┘
```

Device.tsx should ONLY read from the store, never subscribe to services directly.

## Solution

1. **Remove local state from Device.tsx:**

```typescript
// BEFORE: Local state
const [deviceState, setDeviceState] = useState(...)

// AFTER: Read from store
const { deviceState, connectionStatus, activityLog } = useAppStore()
```

2. **Remove duplicate subscriptions:**

```typescript
// REMOVE this entire useEffect from Device.tsx:
useEffect(() => {
  const unsubState = deviceService.onStateChange(setDeviceState)
  // ... etc
}, [])

// OperationController already handles subscriptions
```

3. **Verify OperationController handles all subscriptions:**

```typescript
// In OperationController.tsx (already implemented):
useEffect(() => {
  const unsubStateChange = deviceService.onStateChange((state) => {
    setDeviceState(state)  // Updates store
  })
  const unsubStatusChange = deviceService.onStatusChange((status) => {
    setConnectionStatus(status)  // Updates store
  })
  const unsubActivity = deviceService.onActivity((entry) => {
    addActivityLogEntry(entry)  // Updates store
  })
  return () => { ... }
}, [])
```

## Files to Modify

1. **Device.tsx**: Remove local state, use store
2. **Verify useAppStore.ts**: Has deviceState, connectionStatus, activityLog (already added)
3. **Verify OperationController.tsx**: Has subscriptions (already added)

## Benefits

- Single source of truth for device state
- No state drift between components
- Cleaner component code (just reads, no subscriptions)
- Better debugging (all state in one place)
- Reduced memory (no duplicate state)

## Testing

- [ ] Device page shows correct state after navigation
- [ ] State persists when navigating away and back
- [ ] Activity log shows entries from any page
- [ ] No duplicate log entries
- [ ] No console errors about missing state

## Acceptance Criteria

- [ ] Device.tsx has no local useState for device/connection/activity state
- [ ] Device.tsx reads exclusively from useAppStore
- [ ] No duplicate service subscriptions
- [ ] All tests pass
