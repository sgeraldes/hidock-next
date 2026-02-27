# TODO-007: Download/Sync Pipeline Critical Bugs (4 remaining)

**Priority**: CRITICAL
**Phase**: A
**Domain**: Download/Sync Pipeline
**Audit Reference**: COMPREHENSIVE_BUG_AUDIT_WAVE2.md - Download/Sync CRITICAL

## Problem

4 remaining CRITICAL bugs in download/sync pipeline (after showstopper fixes):

1. **Device reconnection double-subscribes all listeners** (covered in TODO-003)
2. **Auto-sync triggered twice per connection** - Duplicate downloads
3. **cancelDownloads() doesn't actually cancel USB** (covered in TODO-004)
4. **Stall detection aborts but doesn't clean up queue**

## Current State

From audit findings:
- Auto-sync fires twice when device connects
- Download queue left in inconsistent state after stall abort
- Cancelled downloads not properly cleaned up
- Race condition between auto-sync triggers

## Impact

- **Duplicate downloads**: Same file downloaded twice on connect
- **Wasted bandwidth**: Unnecessary USB transfers
- **Queue corruption**: Stall abort leaves queue dirty
- **Resource leaks**: Cancelled transfers not cleaned up

## Files Affected

- `src/hooks/useDeviceSubscriptions.ts` - Device connection handlers
- `src/hooks/useDownloadOrchestrator.ts` - Download coordination
- `electron/main/services/download-service.ts` - Download queue
- `electron/main/services/device-service.ts` - Device lifecycle

## Dependencies

- Device connection lifecycle
- Download queue architecture
- Stall detection implementation
- Auto-sync trigger logic

## Acceptance Criteria

### Auto-Sync Duplicate Prevention
- [ ] Auto-sync fires exactly once per device connection
- [ ] Debounce or flag prevents duplicate triggers
- [ ] Test: connect device 100 times, verify single sync each time

### Stall Detection Cleanup
- [ ] Stall abort properly cleans up queue state
- [ ] Partial downloads marked as failed or removed
- [ ] Queue left in consistent state after abort
- [ ] Test: force stall, verify clean queue after abort

### General
- [ ] Download queue always consistent
- [ ] No orphaned downloads after cancel/stall
- [ ] All tests pass

## Related Bugs

- Download/Sync CRITICAL: Auto-sync triggered twice per connection
- Download/Sync HIGH: Stall detection aborts but doesn't clean up queue
