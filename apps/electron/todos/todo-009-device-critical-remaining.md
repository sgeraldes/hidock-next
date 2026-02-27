# TODO-009: Device Page Critical Bugs (3 remaining)

**Priority**: CRITICAL
**Phase**: A
**Domain**: Device Page
**Audit Reference**: COMPREHENSIVE_BUG_AUDIT_WAVE2.md - Device Page CRITICAL

## Problem

3 remaining CRITICAL bugs in Device page (after file operations showstopper):

1. **USB transfer cancellation doesn't abort** (covered in TODO-004)
2. **Connection timeout doesn't cancel USB** - Transfer continues after timeout
3. **Recordings list never displayed** (covered in TODO-001)

This todo focuses on the connection timeout bug.

## Current State

From audit findings:
- Connection timeout fires but doesn't cancel active USB transfers
- Transfer continues in background after timeout
- Device appears "disconnected" but USB still active
- Timeout cleanup doesn't abort pending operations

## Impact

- **Resource leaks**: USB transfers continue after timeout
- **Confused state**: Device shows disconnected but transfers active
- **Deadlocks**: Next connection blocked by lingering transfer

## Root Cause

Timeout handler doesn't propagate cancellation to USB layer:
```typescript
setTimeout(() => {
  this.connected = false // WRONG: doesn't abort transfers
}, TIMEOUT)
```

## Files Affected

- `electron/main/services/device-service.ts` - Connection timeout logic
- `electron/main/services/hidock-device.ts` - USB operations
- `src/hooks/useDeviceConnection.ts` - Connection state UI

## Dependencies

- Connection timeout configuration
- USB abort implementation (from TODO-004)
- Device state machine

## Acceptance Criteria

- [ ] Connection timeout aborts all active USB transfers
- [ ] Device state properly cleaned up after timeout
- [ ] Next connection can proceed after timeout
- [ ] Test: start transfer, trigger timeout, verify abort

## Related Bugs

- Device HIGH: Connection timeout doesn't cancel USB
- Related to TODO-004 (USB cancellation)
