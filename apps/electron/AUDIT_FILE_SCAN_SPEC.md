# Audit Report: File Listing and Device Sync Specification

**Date:** 2026-03-04
**Auditor:** Claude Code
**Spec:** File list scan must provide Activity Log feedback and correct queue population

---

## Executive Summary

**Status:** FAILING (3 of 8 acceptance criteria violated)

The file scan implementation in `hidock-device.ts` is missing critical user-facing Activity Log feedback. While the technical implementation (USB communication, caching, concurrency control) is solid, users receive no clear feedback about what the scan is doing or what it found.

**Critical Issues:**
- No "Scanning device files..." entry when scan starts (FS-01)
- No "Found N files on device" entry after scan completes (FS-02)
- No "0 files" friendly message when device is empty (FS-03)
- No comparison logging for new vs already-synced files (FS-04)

---

## Spec Compliance Matrix

| # | Criterion | Status | Code Location | Severity |
|---|-----------|--------|---------------|----------|
| 1 | Scan starts with Activity Log entry "Scanning device files..." | FAILING | `hidock-device.ts:779-1034` | HIGH |
| 2 | Scan result logged: "Found N files on device" | FAILING | `hidock-device.ts:1004` | HIGH |
| 3 | New vs synced files comparison result logged | FAILING | `useDeviceSubscriptions.ts:95-125` | MEDIUM |
| 4 | Spinner active during scan, stops when complete | PASSING | Device page manages `deviceSyncing` state | - |
| 5 | Auto-download queues new files if enabled | PASSING | `useDeviceSubscriptions.ts:95-125` | - |
| 6 | Repeated scans don't create duplicate queue entries | PASSING | 2-second debounce + cache (line 790-799) | - |
| 7 | Scan works without internet connection | PASSING | No HTTP requests in `listRecordings()` | - |
| 8 | Scan handles 0 files on device gracefully | FAILING | Returns empty array, no user message | MEDIUM |

---

## Bugs Found

### FS-01: Missing "Scanning" Activity Log Entry

**Severity:** HIGH
**File:** `apps/electron/src/services/hidock-device.ts`
**Line:** 779 (start of `listRecordings()`)

**Current Behavior:**
```typescript
async listRecordings(...) {
  // Immediately checks connection and starts USB operation
  // NO user-facing log that scan is starting
  this.logActivity('usb-out', 'CMD: List Files', ...) // Line 958 - too technical
}
```

**Expected Behavior:**
```typescript
async listRecordings(...) {
  this.logActivity('info', 'Scanning device files...', 'Checking for recordings on device')
  // ... existing code ...
}
```

**Impact:** Users don't know when a file scan has started. They only see the low-level USB command log ('usb-out') which is not user-friendly.

**Test Coverage:** `hidock-device-scan.test.ts:92-120`

---

### FS-02: Missing "Found N Files" Result Log

**Severity:** HIGH
**File:** `apps/electron/src/services/hidock-device.ts`
**Line:** 1004

**Current Behavior:**
```typescript
// Line 1004 - only logs technical USB-level message
this.logActivity('usb-in', 'File List Received', `${files.length} files found`)
```

**Expected Behavior:**
```typescript
// After line 1004, add user-facing success message:
this.logActivity('info', 'Scan complete', `Found ${files.length} recording${files.length !== 1 ? 's' : ''} on device`)
```

**Impact:** Users see "File List Received" (USB protocol detail) instead of "Found 3 recordings on device" (user outcome).

**Test Coverage:** `hidock-device-scan.test.ts:122-177`

---

### FS-03: No User-Friendly Message for Empty Device

**Severity:** MEDIUM
**File:** `apps/electron/src/services/hidock-device.ts`
**Line:** 1004-1011

**Current Behavior:**
```typescript
// When device has 0 files, logs "File List Received: 0 files found"
// No distinction between empty device vs scan failure
```

**Expected Behavior:**
```typescript
if (files.length === 0) {
  this.logActivity('info', 'No recordings found', 'Device storage is empty')
} else {
  this.logActivity('info', 'Scan complete', `Found ${files.length} recording${files.length !== 1 ? 's' : ''} on device`)
}
```

**Impact:** Users with new/formatted devices see technical "0 files found" instead of friendly "No recordings yet".

**Test Coverage:** `hidock-device-scan.test.ts:179-206`

---

### FS-04: Missing Sync Comparison Logging

**Severity:** MEDIUM
**File:** `apps/electron/src/hooks/useDeviceSubscriptions.ts`
**Line:** 95-125

**Current Behavior:**
```typescript
// useDeviceSubscriptions.ts:95-125
// After calling downloadService.getFilesToSync(), determines which files need downloading
// Queues downloads silently
// Only logs "Auto-sync triggered: N new recordings to download" (line 109)
// Does NOT log how many were already synced
```

**Expected Behavior:**
```typescript
const syncedCount = reconcileResults.filter(r => r.skipReason).length
const newCount = toSync.length

if (newCount > 0) {
  deviceService.log('info', 'Sync check complete',
    `${newCount} new recording${newCount !== 1 ? 's' : ''} to download, ${syncedCount} already synced`)
} else {
  // Existing: "All files synced" message
}
```

**Impact:** Users can't tell at a glance how many files are new vs already downloaded. The Activity Log should show "3 new, 7 already synced" for better transparency.

**Test Coverage:** `hidock-device-scan.test.ts:208-245`

---

## Passing Criteria (No Action Required)

### FS-05: Spinner Management
**Status:** PASSING
**Evidence:** `Device.tsx` manages `deviceSyncing` state which controls the spinner. `useDeviceSubscriptions.ts` sets `deviceSyncing: true` when auto-sync starts (line 117), and `useDownloadOrchestrator.ts` clears it when downloads complete (line 258).

### FS-06: Auto-Download Queueing
**Status:** PASSING
**Evidence:** `useDeviceSubscriptions.ts:95-125` calls `downloadService.startSession()` when auto-sync is enabled and new files are detected. Uses 4-layer reconciliation via `getFilesToSync()` to determine which files need downloading.

### FS-07: Duplicate Prevention
**Status:** PASSING
**Evidence:**
- 2-second debounce prevents rapid-fire scans (`hidock-device.ts:790-799`)
- Cache prevents redundant USB operations when file count unchanged (`hidock-device.ts:887-902`)
- `listRecordingsLock` prevents concurrent scans (`hidock-device.ts:907-947`)

### FS-08: Offline Operation
**Status:** PASSING
**Evidence:** `listRecordings()` makes no HTTP/network requests. All operations are USB-local. Device scan works without internet.

### FS-09: Empty Device Handling (Technical)
**Status:** PASSING (Technical Only)
**Evidence:** `listRecordings()` returns empty array when device has 0 files. No exceptions thrown. However, user-facing log message is missing (see FS-03).

---

## Test File Details

**Location:** `apps/electron/src/services/__tests__/hidock-device-scan.test.ts`

**Test Suite:** "File List Scan - Activity Log and Queue Population"

**Total Tests:** 13
- FS-01: 1 test (should log "Scanning device files...")
- FS-02: 2 tests (scan result logging)
- FS-03: 2 tests (zero files handling)
- FS-04: 1 test (comparison logging)
- FS-05: 2 tests (offline operation)
- FS-06: 1 test (progress reporting)
- FS-07: 2 tests (duplicate prevention)
- FS-08: 2 tests (error handling)

**Current Status:** All tests fail due to missing Activity Log entries (expected failures documenting spec violations).

---

## Recommendations

### Priority 1: Add User-Facing Activity Log Entries (FS-01, FS-02, FS-03)

**File:** `apps/electron/src/services/hidock-device.ts`
**Lines to Modify:** 779 (start), 1004 (end)

```typescript
// Line 779: Add scan start message BEFORE checking connection
this.logActivity('info', 'Scanning device files...', 'Checking for recordings on device')

// Line 1004-1011: Replace USB-level log with user-facing message
if (files.length === 0) {
  this.logActivity('info', 'No recordings found', 'Device storage is empty')
} else {
  this.logActivity('info', 'Scan complete', `Found ${files.length} recording${files.length !== 1 ? 's' : ''} on device`)
}
// Keep existing USB-level log for debugging (it's useful for QA)
this.logActivity('usb-in', 'File List Received', `${files.length} files found`)
```

### Priority 2: Add Sync Comparison Logging (FS-04)

**File:** `apps/electron/src/hooks/useDeviceSubscriptions.ts`
**Lines to Modify:** 105-125

```typescript
const reconcileResults = await window.electronAPI.downloadService.getFilesToSync(...)
const toSync = reconcileResults.filter(result => !result.skipReason)
const syncedCount = reconcileResults.length - toSync.length

if (toSync.length > 0) {
  // Add comparison result before starting downloads
  deviceService.log('info', 'Sync check complete',
    `${toSync.length} new recording${toSync.length !== 1 ? 's' : ''} to download, ${syncedCount} already synced`)

  // Existing: queue downloads and start session
  await window.electronAPI.downloadService.startSession(filesToQueue)
  // ...
} else {
  // Existing: "All files synced" message (line 123)
  deviceService.log('success', 'All files synced', 'No new recordings to download')
}
```

### Priority 3: Improve Activity Log UX

**Consideration:** The current Activity Log mixes USB protocol details (`usb-out`, `usb-in`) with user outcomes (`info`, `success`, `error`). Consider:
1. Keeping technical logs for debugging (toggle with QA Logs setting)
2. Showing only user-facing logs in the default Activity sidebar view
3. Adding a "Show Technical Logs" toggle in Activity Log header

---

## Appendix: Code References

### Key Files
- `apps/electron/src/services/hidock-device.ts` - Device service (listRecordings method)
- `apps/electron/src/hooks/useDeviceSubscriptions.ts` - Auto-sync trigger
- `apps/electron/src/hooks/useDownloadOrchestrator.ts` - Download queue management
- `apps/electron/src/pages/Device.tsx` - Device page UI (sync button, spinner)

### Related Architecture Decisions
- FL-02: Debounce rapid-fire scans (2-second window)
- FL-06: Status updates during init wait
- DL-06: 4-layer reconciliation for accurate sync status
- B-DEV-007: Force refresh after downloads complete

### Test Execution
```bash
cd apps/electron
npm run test:run -- src/services/__tests__/hidock-device-scan.test.ts
```

Expected result: 3 tests fail (FS-01, FS-02, FS-04), documenting the spec violations.

---

## Conclusion

The file scan implementation is **technically sound** but **user-facing feedback is incomplete**. Adding 3 Activity Log entries (scan start, scan result, comparison) will bring the implementation into full spec compliance.

**Estimated Fix Time:** 30 minutes
**Risk:** Low (only adding log statements, no logic changes)
**Impact:** High (significant UX improvement for users monitoring device sync)
