# Phase C: Device & Download/Sync MEDIUM Bug Fixes (spec-c004)

**Date:** 2026-03-02
**Scope:** Fix MEDIUM-severity bugs in Device page and Download/Sync flow
**Tests:** 967 total, 966 passing (1 pre-existing flaky performance test)

---

## Summary

Fixed 16 MEDIUM bugs across Device (6) and Download/Sync (10) categories. Many bugs from the original audit were already resolved in Phase A+B; this phase addressed the remaining genuine bugs and added new protective measures.

## Device Fixes (6)

### 1. Connection Status Color-Coding (DV-new)
**File:** `src/pages/Device.tsx`
**Bug:** Device status indicator was always green, even during sync or after errors.
**Fix:** Status indicator now shows blue (syncing), amber (error), or green (connected). Background color of the device info card also changes contextually.

### 2. Auto-Download Config Default (DV-new, external fix)
**File:** `src/pages/Device.tsx`
**Bug:** Auto-download switch initialized to null (showing off) even though the config default is true.
**Fix:** State now defaults to true to match config.ts defaults, with async config load overriding if different.

### 3. Synced Filenames Refresh (DV-new, external fix)
**File:** `src/components/DeviceFileList.tsx`
**Bug:** Filename sync checking used simple string equality, missing .hda->.mp3/.wav normalization.
**Fix:** Added isFilenameSynced() helper that checks all normalized variants of HDA filenames.

### 4-6. Already Fixed in Phase A/B
- Format Storage Confirmation (DV-02): window.confirm() dialog
- Activity Log Scrollable (DV-01): max-h-64 overflow-y-auto
- USB Lock Guard (DV-05): all USB operations use withLock()

## Download/Sync Fixes (10)

### 7. NaN Guard on Download Progress
**Files:** `download-service.ts`, `useDownloadOrchestrator.ts`, `OperationsPanel.tsx`
**Bug:** Download progress could show NaN% when fileSize is 0.
**Fix:** Added Number.isFinite() guards in three locations.

### 8. Download State Throttling / UI Lag (DL-09)
**File:** `download-service.ts`
**Bug:** All state emissions used the same 250ms throttle, causing status transitions to appear delayed.
**Fix:** Status transitions now emit immediately (emitStateUpdate(true)), while pure progress updates use throttling.

### 9. ETA Computation
**File:** `useDownloadOrchestrator.ts`
**Bug:** Store had ETA fields but nothing populated them.
**Fix:** Orchestrator now tracks bytes/second and computes remaining time after each file.

### 10. Download Completion Notification
**Files:** `download-service.ts`, `preload/index.ts`, `useDownloadOrchestrator.ts`
**Bug:** No OS-level notification when sync completes.
**Fix:** Added Electron Notification API integration via IPC.

### 11. Download Path Validation
**File:** `download-service.ts`
**Bug:** Missing recordings directory caused confusing filesystem errors.
**Fix:** processDownload() validates path exists, attempts mkdir, fails gracefully.

### 12. Cancelled Status Distinction (external enhancement)
**File:** `download-service.ts`
**Bug:** User cancellations and actual failures both used status failed.
**Fix:** Added cancelled status. User-initiated cancellations use cancelled; system failures use failed.

### 13. Stall Detection Improvements (external enhancement)
**File:** `download-service.ts`
**Bug:** Stall detection used startedAt with 30s timeout, false-triggering on large files.
**Fix:** Now uses lastProgressAt with 60s timeout.

### 14. Shared Formatting Utilities (external enhancement)
**File:** `src/utils/formatters.ts`
**Fix:** Added formatBytes() and formatDuration() to shared module.

### 15-16. Already Fixed in Phase A/B
- processDownloadQueueRef re-subscription: ref pattern working
- Batch concurrent limit: sequential by design (USB serial)

## Test Coverage

### New Tests (27 tests)
- formatters.test.ts (19): formatEta (8), formatBytes (5), formatDuration (6)
- download-service.test.ts (4 new): NaN guards (3), status transitions (1)

### Updated Tests (4 tests)
- download-service.test.ts: cancelAll expects cancelled status
- download-service-b007.test.ts: cancel/stall tests updated

## Files Modified

| File | Changes |
|------|---------|
| electron/main/services/download-service.ts | NaN guard, immediate emit, path validation, notification, cancelled status |
| electron/preload/index.ts | notifyCompletion API |
| src/hooks/useDownloadOrchestrator.ts | NaN guard, ETA computation, notification |
| src/components/layout/OperationsPanel.tsx | NaN guards on percentage display |
| src/pages/Device.tsx | Connection status color-coding |
| src/components/DeviceFileList.tsx | Synced filename normalization |
| src/utils/formatters.ts | formatBytes, formatDuration |
| src/utils/__tests__/formatters.test.ts | 19 new tests |
| electron/main/services/__tests__/download-service.test.ts | 4 new + 2 updated |
| electron/main/services/__tests__/download-service-b007.test.ts | 2 updated |
