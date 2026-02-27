# TODO-004: Fix USB Cancellation to Actually Abort Transfers

**Priority**: CRITICAL - Showstopper #4
**Phase**: A
**Domain**: Device Page + Download/Sync Pipeline
**Audit Reference**: COMPREHENSIVE_BUG_AUDIT_WAVE2.md - Device CRITICAL + Download/Sync CRITICAL

## Problem

USB transfer cancellation doesn't actually abort the underlying USB transfer. The UI says "cancelled" but the transfer continues in the background, wasting bandwidth and device resources.

## Current State

From audit findings:
- **Device Page**: USB transfer cancellation doesn't abort
- **Download/Sync**: `cancelDownloads()` doesn't actually cancel USB transfers
- Cancel button updates UI state but doesn't stop the transfer
- USB read/write operations continue after "cancel" clicked
- Transfer completes in background even though UI shows cancelled

## Root Cause

Likely patterns:

**Pattern 1: Cancellation only sets flag, doesn't abort I/O**
```typescript
cancelTransfer() {
  this.cancelled = true // WRONG: doesn't stop USB operations
}
```

**Pattern 2: No AbortController or cancellation token**
```typescript
async function transferFile(file) {
  // No way to cancel mid-transfer
  await usbDevice.write(data)
}
```

**Pattern 3: Cancel handler doesn't reach USB layer**
```typescript
// Frontend
onClick={() => cancelDownload(id)} // Sets state

// Service
cancelDownload(id) {
  queue.remove(id) // WRONG: doesn't abort active transfer
}

// USB layer
async transfer() {
  // No cancellation signal reaches here
}
```

## What's Missing

1. **AbortController pattern** for async USB operations
2. **Cancellation propagation** from UI → service → USB layer
3. **Cleanup of in-flight transfers** when cancelled
4. **USB-level abort** (may need to close endpoints, reset device)

## Files Affected

From audit domains:
- `src/pages/Device.tsx` - Cancel button handler
- `src/hooks/useDownloadOrchestrator.ts` - `cancelDownloads()` implementation
- `electron/main/services/download-service.ts` - Download queue management
- `electron/main/services/hidock-device.ts` (or Jensen service) - USB transfer operations
- `electron/main/ipc/recording-handlers.ts` - Cancel IPC handler

## Dependencies

- USB device API (PyUSB or node-usb equivalent)
- Understanding of Jensen protocol for device communication
- AbortSignal pattern in Node.js/Electron
- Download queue architecture

## Acceptance Criteria

### Functional Requirements
- [ ] Cancel button immediately stops USB read/write operations
- [ ] Partially transferred files are not saved (or marked as incomplete)
- [ ] Device USB endpoints are properly closed/reset on cancel
- [ ] Multiple simultaneous transfers can all be cancelled
- [ ] Download queue is cleaned up after cancellation

### Technical Requirements
- [ ] AbortController passed through full call chain (UI → IPC → service → USB)
- [ ] USB read/write operations check abort signal
- [ ] Cancellation properly closes USB endpoints
- [ ] No lingering event listeners after cancel
- [ ] Stall detection doesn't interfere with manual cancel

### UI/UX
- [ ] Cancel button shows immediate feedback (loading spinner)
- [ ] Progress stops immediately (not after transfer completes)
- [ ] Status updates to "Cancelled" only after abort completes
- [ ] Error handling for "cancel during cancel" edge case
- [ ] All tests pass

## Testing

**Manual Test:**
1. Start downloading a large file (>50MB)
2. Click cancel after 10% progress
3. Verify:
   - USB activity stops immediately (network monitor / device LED)
   - Progress bar stops updating
   - File not saved or marked incomplete
   - Device still usable after cancel

**Automated Test:**
```typescript
test('cancel stops USB transfer mid-operation', async () => {
  const abortController = new AbortController()
  const transferPromise = device.transferFile(file, abortController.signal)

  setTimeout(() => abortController.abort(), 100) // Cancel mid-transfer

  await expect(transferPromise).rejects.toThrow('AbortError')
  expect(device.isTransferActive()).toBe(false)
})
```

## Related Bugs

- Device CRITICAL: USB transfer cancellation doesn't abort
- Download/Sync CRITICAL: `cancelDownloads()` doesn't actually cancel USB
- Download/Sync CRITICAL: Stall detection marks failed but doesn't abort USB (related issue)
