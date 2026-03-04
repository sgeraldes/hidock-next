# Activity Log Visibility Spec - Audit Report

**Date**: 2026-03-04
**Auditor**: Claude Code
**Spec Version**: Activity Log Visibility v1.0

## Executive Summary

**Status**: ⚠️ PARTIAL COMPLIANCE
**Test Results**: 8 of 10 criteria failing

The Activity Log bridge infrastructure is correctly implemented and functioning for calendar sync, transcription, and downloads. However, **file list sync operations (criterion #1 and #2) are completely silent** — no activity log entries are emitted when the device is scanned for recordings.

**Critical User Impact**: When users click "Scan Device" or a device connects and auto-sync triggers, they have **zero visibility** that the scan is happening. The Activity Log remains empty until downloads begin, creating confusion about whether the system is working.

---

## Spec Compliance Matrix

| # | Criterion | Status | Implementation | Timing |
|---|-----------|--------|----------------|--------|
| 1 | File list sync "Scanning device files..." | ❌ **FAIL** | Missing in `hidock-device.ts` | N/A - Not implemented |
| 2 | File list sync "Found N files on device" | ❌ **FAIL** | Missing in `hidock-device.ts` | N/A - Not implemented |
| 3 | Download "Starting download: [filename]" | ✅ **PASS** | `useDownloadOrchestrator.ts:85` | When queue item starts |
| 4 | Download "Download complete: [filename]" | ✅ **PASS** | `useDownloadOrchestrator.ts:137` | On success |
| 5 | Download "Download failed: [filename] — [reason]" | ✅ **PASS** | `useDownloadOrchestrator.ts:110, 152` | On failure |
| 6 | Calendar "Syncing calendar..." | ✅ **PASS** | `calendar-sync.ts:411` | When sync starts |
| 7 | Calendar "Loaded N meetings" / "failed: [reason]" | ✅ **PASS** | `calendar-sync.ts:466, 476` | On success/failure |
| 8 | Transcription "Transcribing: [filename]" | ✅ **PASS** | `transcription.ts:191` | When processing starts |
| 9 | Transcription "complete/failed: [filename]" | ✅ **PASS** | `transcription.ts:233, 248` | On complete/failure |
| 10 | Real-time delivery (not batched) | ✅ **PASS** | `activity-log.ts` IPC bridge | All services emit immediately |

**Compliance Rate**: 8/10 (80%)

---

## Bugs Found

### AL-001: File List Sync Missing Start Log ❌ CRITICAL

**Status**: BROKEN
**Severity**: HIGH
**Criterion**: #1 - "Scanning device files..." entry when listRecordings() starts

**Location**: `apps/electron/src/services/hidock-device.ts` - `listRecordings()` method (lines ~779-900)

**Issue**: No `logActivity('info', 'Scanning device files...', ...)` call when file list operation begins.

**Expected Behavior**:
```typescript
// At start of listRecordings()
this.logActivity('info', 'Scanning device files...', 'Reading file list from device')
```

**Current Behavior**: Silent operation. User sees nothing in Activity Log.

**User Impact**:
- Users click "Scan Device" → nothing happens in Activity Log
- Device connects → auto-sync starts silently
- No feedback that the app is working
- Users think the app is frozen or broken

**Test Evidence**: 3 failing tests in `hidock-device-activity-log.test.ts`:
- "SHOULD emit 'Scanning device files...' when listRecordings() starts"
- "SHOULD emit scan start BEFORE any USB operations"
- "SHOULD emit scan start even when device not connected"

---

### AL-002: File List Sync Missing Completion Log ❌ CRITICAL

**Status**: BROKEN
**Severity**: HIGH
**Criterion**: #2 - "Found N files on device" when complete

**Location**: `apps/electron/src/services/hidock-device.ts` - `listRecordings()` method after file list is retrieved (around line ~900)

**Issue**: No `logActivity('success', 'Found N files on device', ...)` call when file list operation completes.

**Expected Behavior**:
```typescript
// After successful file list retrieval
const fileCount = recordings.length
this.logActivity(
  'success',
  `Found ${fileCount} file${fileCount !== 1 ? 's' : ''} on device`,
  `${fileCount} recordings available`
)
```

**Current Behavior**: Silent completion. User doesn't know if scan succeeded or how many files exist.

**User Impact**:
- No confirmation that scan completed successfully
- User doesn't know how many recordings were found
- Empty device (0 files) looks identical to failed scan
- Users must manually click into Library to see file count

**Test Evidence**: 5 failing tests in `hidock-device-activity-log.test.ts`:
- "SHOULD emit 'Found N files on device' when listRecordings() completes"
- "SHOULD emit completion with count of 0 when no files found"
- "SHOULD include file count in completion message"
- "SHOULD emit completion IMMEDIATELY after USB operation"
- "SHOULD emit both start and completion entries in correct order"

---

## Implementation Analysis

### What Works ✅

1. **Activity Log Bridge (IPC)** - `activity-log.ts`
   - `emitActivityLog()` function correctly broadcasts to all renderer windows
   - IPC channel `activity-log:entry` properly exposed in preload
   - Main process services (calendar, transcription) can emit logs
   - Real-time delivery confirmed

2. **Calendar Sync Logs** - `calendar-sync.ts`
   - Line 411: "Syncing calendar..." when sync starts
   - Line 466: "Calendar sync complete - Loaded N meetings" on success
   - Line 476: "Calendar sync failed: [reason]" on error
   - Full coverage of sync lifecycle

3. **Transcription Logs** - `transcription.ts`
   - Line 191: "Transcribing recording" when processing starts
   - Line 233: "Transcription complete" on success
   - Line 248: "Transcription failed: [reason]" on error
   - Full coverage of transcription lifecycle

4. **Download Logs** - `useDownloadOrchestrator.ts`
   - Line 85: "Starting download" when download begins
   - Line 137: "Download complete" on success
   - Lines 110, 152: "Download failed: [reason]" on error
   - Full coverage of download lifecycle

5. **Subscription Pipeline** - `useDeviceSubscriptions.ts`
   - Line 143: Subscribes to `onActivityLogEntry` from main process
   - Line 144-150: Correctly forwards entries to `addActivityLogEntry`
   - Both renderer-side and main-process logs are captured

### What's Missing ❌

**File List Sync Operations** - `hidock-device.ts`

The `listRecordings()` method (lines 779-900+) performs these operations:
1. Connection check
2. Debounce check (returns cached data if recent)
3. Lock acquisition (prevents concurrent scans)
4. USB file list retrieval
5. File parsing and recording object creation
6. Cache update

**None of these steps emit activity log entries** except one error case:
- Line 786: "Cannot list files - Device not connected" (error only)

**Missing entries**:
- Start: "Scanning device files..." when operation begins
- Progress: "Found N/M files..." during USB transfer (optional but nice)
- Success: "Found N files on device" when complete
- Error: "Scan failed: [reason]" for USB errors, timeout, etc.

---

## Code Locations

### Files Analyzed

1. **Activity Log Bridge**
   - `apps/electron/electron/main/services/activity-log.ts` - IPC emission
   - `apps/electron/electron/preload/index.ts` - IPC channel exposure (line 801-808)
   - `apps/electron/src/hooks/useDeviceSubscriptions.ts` - Subscription (line 142-151)

2. **Service Implementations**
   - `apps/electron/electron/main/services/calendar-sync.ts` - Calendar logs (lines 411, 466, 476)
   - `apps/electron/electron/main/services/transcription.ts` - Transcription logs (lines 191, 233, 248)
   - `apps/electron/src/hooks/useDownloadOrchestrator.ts` - Download logs (lines 85, 137, 110, 152)
   - `apps/electron/src/services/hidock-device.ts` - **MISSING FILE LIST LOGS** (lines 779-900+)

3. **Test Files**
   - `apps/electron/electron/main/services/__tests__/activity-log-integration.test.ts` - Bridge tests (20 tests, all pass)
   - `apps/electron/src/services/__tests__/hidock-device-activity-log.test.ts` - Device tests (10 tests, 8 fail)

---

## Test Results

### Passing Tests (20/20) ✅

All tests in `activity-log-integration.test.ts` pass:
- Activity log bridge IPC channel works
- emitActivityLog() broadcasts to all windows
- Handles destroyed windows gracefully
- Real-time delivery confirmed
- Timestamp included in all entries
- Multi-window support verified

### Failing Tests (8/10) ❌

Tests in `hidock-device-activity-log.test.ts`:

**BUG AL-001 Tests (3 failing)**:
1. ❌ "SHOULD emit 'Scanning device files...' when listRecordings() starts"
   - Expected: `logActivity('info', 'Scanning device files...', ...)`
   - Actual: No entry emitted
   - Error: `expected undefined to be defined`

2. ❌ "SHOULD emit scan start BEFORE any USB operations"
   - Expected: Log entry within 10ms of call
   - Actual: No entry exists at all
   - Error: `expected undefined to be defined`

3. ❌ "SHOULD emit scan start even when device not connected"
   - Expected: Start entry + error entry
   - Actual: Only error entry ("Cannot list files")
   - Error: `expected undefined to be defined`

**BUG AL-002 Tests (5 failing)**:
4. ❌ "SHOULD emit 'Found N files on device' when listRecordings() completes"
   - Expected: `logActivity('success', 'Found N files on device', ...)`
   - Actual: No entry emitted
   - Error: `expected undefined to be defined`

5. ❌ "SHOULD emit completion with count of 0 when no files found"
   - Expected: "Found 0 files on device" success message
   - Actual: No entry emitted
   - Error: `expected undefined to be defined`

6. ❌ "SHOULD include file count in completion message"
   - Expected: Message containing number (e.g., "Found 5 files")
   - Actual: No entry exists
   - Error: `expected undefined to be defined`

7. ❌ "SHOULD emit completion IMMEDIATELY after USB operation"
   - Expected: Entry within 100ms of completion
   - Actual: No entry exists
   - Error: `expected undefined to be defined`

8. ❌ "SHOULD emit both start and completion entries in correct order"
   - Expected: Start entry → Completion entry
   - Actual: Neither entry exists
   - Error: `expected undefined to be defined`

**Passing Tests (2)**:
9. ✅ "SHOULD show user-friendly messages (not technical jargon)"
10. ✅ "SHOULD emit 'Scan failed: [reason]' if listRecordings() throws"
    - Only passes because error log exists for disconnect case

---

## Recommendations

### Priority 1: Fix File List Sync Logging (AL-001, AL-002)

**Add these two logActivity calls to `hidock-device.ts` in `listRecordings()` method:**

```typescript
async listRecordings(
  onProgress?: (filesFound: number, expectedFiles: number) => void,
  forceRefresh: boolean = false
): Promise<HiDockRecording[]> {
  // ... existing connection/debounce checks ...

  // ✅ ADD THIS: Log scan start
  this.logActivity('info', 'Scanning device files...', 'Reading file list from device')

  try {
    // ... existing USB file list retrieval ...
    const recordings = /* parse files */

    // ✅ ADD THIS: Log scan completion
    const fileCount = recordings.length
    this.logActivity(
      'success',
      `Found ${fileCount} file${fileCount !== 1 ? 's' : ''} on device`,
      `${fileCount} recordings available`
    )

    return recordings
  } catch (error) {
    // ✅ ENHANCE THIS: Better error logging
    this.logActivity('error', 'Device scan failed', error.message)
    throw error
  }
}
```

### Priority 2: Enhanced Error Logging

Currently only logs "Cannot list files - Device not connected". Should also log:
- USB timeout errors
- Permission denied errors
- Device disconnected during scan
- Malformed file list data

### Priority 3: Optional Progress Reporting

For large file lists (100+ files), consider:
```typescript
this.logActivity('info', 'Scanning device files...', `Found ${currentCount}/${totalCount} files`)
```

---

## Architecture Review

### Activity Log Bridge Pattern ✅

The main process → renderer activity log bridge is correctly implemented:

```
Main Process Services (transcription, calendar, download)
  ↓ emitActivityLog()
  ↓ activity-log.ts
  ↓ BrowserWindow.webContents.send('activity-log:entry', entry)
  ↓
Preload Script (context isolation)
  ↓ ipcRenderer.on('activity-log:entry', handler)
  ↓ window.electronAPI.onActivityLogEntry(callback)
  ↓
Renderer Process (useDeviceSubscriptions)
  ↓ addActivityLogEntry(entry)
  ↓ useAppStore
  ↓ Activity Log UI
```

This pattern is **working correctly** for calendar sync, transcription, and downloads.

### Renderer-Side Logging ⚠️

The `hidock-device.ts` service runs in the **renderer process** and uses `deviceService.logActivity()` directly (not the main process bridge). This is correct for renderer-side operations.

**However**: `listRecordings()` method **does not call `logActivity()`** at all (except for disconnect error).

---

## Test Coverage

### Integration Tests

- ✅ **Activity Log Bridge**: 20/20 tests pass
  - IPC channel delivery
  - Multi-window support
  - Destroyed window handling
  - Real-time delivery
  - Timestamp validation

- ❌ **File List Sync**: 8/10 tests fail
  - Start entry missing (3 tests)
  - Completion entry missing (5 tests)
  - Error handling present (2 tests pass)

### Missing Test Coverage

1. **Progress reporting during long scans** (not spec'd but useful)
2. **USB timeout error logging** (spec'd but not tested)
3. **Multiple concurrent scan attempts** (should be prevented by lock)
4. **Cache invalidation scenarios** (debounce vs forceRefresh)

---

## User Experience Impact

### Current UX (Broken) ❌

1. User clicks "Scan Device" button
2. **Nothing appears in Activity Log** ← Silent operation
3. Eventually downloads start appearing
4. User confused: "Did the scan work? How many files are there?"

### Expected UX (After Fix) ✅

1. User clicks "Scan Device" button
2. Activity Log shows: "Scanning device files..." ← Immediate feedback
3. Activity Log shows: "Found 5 files on device" ← Clear result
4. Downloads start: "Starting download: recording_001.hda" ← Clear progression

### Real-World Scenario

**Problem**: User connects device with 50 recordings. Auto-sync triggers `listRecordings()`. USB file list transfer takes 2-3 seconds. During this time:
- No activity log entries
- UI shows "Device Connected" but nothing else
- User doesn't know if sync started
- Activity Log is empty

**After Fix**: Activity Log shows:
```
[18:30:15] Device Connected (info)
[18:30:15] Scanning device files... (info)
[18:30:18] Found 50 files on device (success)
[18:30:18] Starting download: recording_001.hda (info)
[18:30:22] Download complete: recording_001.hda (success)
...
```

---

## Conclusion

The Activity Log infrastructure is **correctly implemented and functional**. The main process bridge works perfectly for calendar sync, transcription, and downloads. All 20 bridge tests pass.

**The only missing piece is file list sync logging** — a simple fix requiring two `logActivity()` calls in `hidock-device.ts`. This is a **high-priority user-facing bug** that creates confusion about whether the app is working.

### Fix Complexity: LOW
- Lines of code to add: ~10
- Files to modify: 1 (`hidock-device.ts`)
- Risk: Minimal (just adding log statements)
- Test verification: 8 failing tests will pass

### Priority: HIGH
- User impact: Severe (no feedback during critical operation)
- Frequency: Every device scan, every auto-sync
- Workaround: None (users just have to wait blindly)

---

## Appendix: Test Commands

```bash
# Run all activity log tests
cd apps/electron
npm run test:run -- __tests__/activity-log

# Run integration tests only (20 tests, all pass)
npm run test:run -- electron/main/services/__tests__/activity-log-integration.test.ts

# Run device service tests (10 tests, 8 fail)
npm run test:run -- src/services/__tests__/hidock-device-activity-log.test.ts
```

---

**Report Generated**: 2026-03-04 18:31 UTC
**Next Action**: Implement fix for AL-001 and AL-002 in `hidock-device.ts`
