# Download/Sync Flow Test Plan

**Date:** 2026-02-27
**Purpose:** Manual and automated testing for DL-01 through DL-15 bug fixes
**Priority:** Critical path testing for download reliability

---

## Test Environment Setup

### Prerequisites
- HiDock device (H1, H1E, or P1 model)
- USB connection
- Sample recording files on device (various sizes: small <1MB, medium 10-50MB, large >100MB)
- Windows 11 (primary target platform)

### Configuration
1. Enable QA Logs: Settings → Developer → QA Logs (toggle ON)
2. Open Browser DevTools: View → Toggle Developer Tools
3. Monitor Console for QA log entries

---

## Manual Test Cases

### TEST-DL-01: Memory Amplification Fix (CRITICAL)

**Priority:** P0 - Must pass before release

**Objective:** Verify that large file downloads do not cause memory amplification and app crashes.

**Test Steps:**
1. Connect HiDock device with large recording (>100MB)
2. Open Task Manager (Windows) or Activity Monitor (macOS)
3. Note baseline memory usage of the Electron app
4. Go to Device page
5. Click "Sync All" to download the large file
6. Monitor memory usage during download

**Expected Results:**
- ✅ Memory usage increases gradually (proportional to file size)
- ✅ Peak memory increase is ~110-120% of file size (not 16x)
- ✅ App remains responsive during download
- ✅ Download completes successfully
- ✅ File is saved correctly to disk
- ✅ No console errors related to memory

**Failure Indicators:**
- ❌ Memory usage spikes to 16x file size or more
- ❌ App freezes or becomes unresponsive
- ❌ App crashes with "out of memory" error
- ❌ Download stalls indefinitely

**Notes:**
- Test with multiple file sizes: 50MB, 100MB, 200MB
- Expected memory overhead: ~20% for buffering (e.g., 100MB file = ~120MB peak usage)
- If memory spikes to 1.6GB for a 100MB file, DL-01 fix did not work

---

### TEST-DL-02: Initial Progress Display

**Priority:** P1

**Objective:** Verify that sidebar shows progress immediately after queue creation.

**Test Steps:**
1. Connect HiDock device with multiple recordings (5+ files)
2. Go to Device page
3. Click "Sync All"
4. Immediately look at sidebar (within 1 second)

**Expected Results:**
- ✅ Sidebar "Downloads" section appears immediately
- ✅ Shows "0/N" count before first file starts downloading
- ✅ Overall progress bar visible (even at 0%)

**Failure Indicators:**
- ❌ Sidebar is blank for several seconds after clicking Sync All
- ❌ First file starts downloading before sidebar appears

---

### TEST-DL-03: Filename Truncation

**Priority:** P2

**Objective:** Verify that HiDock filename dates are preserved in sidebar display.

**Test Steps:**
1. Download a file with standard HiDock naming (e.g., REC_20260225_143012.wav)
2. Observe filename in sidebar during download

**Expected Results:**
- ✅ Date portion (20260225) is visible in truncated name
- ✅ If truncated, format is "REC_20260225_1430..." (not "REC_202602...")

**Failure Indicators:**
- ❌ Date is cut off mid-number
- ❌ Only "REC_..." is shown without date

---

### TEST-DL-11: Subscription Re-initialization

**Priority:** P1

**Objective:** Verify that device subscriptions are not duplicated on status changes.

**Test Steps:**
1. Enable QA Logs in settings
2. Open Console (DevTools)
3. Connect HiDock device
4. Watch for log messages as device initializes
5. Count occurrences of "[useDeviceSubscriptions] Subscribing to device state"

**Expected Results:**
- ✅ Subscription log appears exactly ONCE during connection
- ✅ No duplicate subscriptions during status changes (connecting → initializing → ready)
- ✅ Console shows 8+ status updates but only 1 subscription initialization

**Failure Indicators:**
- ❌ Multiple "[useDeviceSubscriptions] Subscribing to device state" messages
- ❌ Subscription count matches status change count (8+)

---

### TEST-DL-12: Stall Detection Abort

**Priority:** P1

**Objective:** Verify that stalled downloads are aborted (not just marked failed).

**Test Steps:**
1. Start downloading a file
2. During download, physically disconnect USB cable (or simulate network interruption)
3. Wait 60+ seconds for stall detection
4. Observe console logs and UI

**Expected Results:**
- ✅ After 60s, toast notification: "Download stalled"
- ✅ Console log: "Download aborted by user" or similar
- ✅ Download status changes to "failed"
- ✅ No hanging USB operations

**Failure Indicators:**
- ❌ Download marked as failed but USB operation continues
- ❌ Device becomes unresponsive to new operations
- ❌ Must disconnect/reconnect device to recover

**Setup Tip:**
- Test with medium-sized file (10-30MB) for observable stall window

---

### TEST-DL-13: Progress Counter Accuracy

**Priority:** P2

**Objective:** Verify that progress counter only counts successful downloads.

**Test Steps:**
1. Queue 5 files for download
2. Let 2 files download successfully
3. Disconnect USB to cause next 3 to fail
4. Observe overall progress counter during and after failures

**Expected Results:**
- ✅ Progress shows "2/5" after 2 successful downloads
- ✅ Failed downloads do NOT increment completed counter
- ✅ Final toast: "Downloaded 2, failed 3"

**Failure Indicators:**
- ❌ Progress shows "5/5" even with failures
- ❌ Progress bar reaches 100% despite failed items

---

### TEST-DL-14: Cancel Button USB Abort

**Priority:** P1 - Critical safety feature

**Objective:** Verify that cancel button stops in-progress USB transfer immediately.

**Test Steps:**
1. Start downloading a large file (50MB+)
2. Wait until download is 20-30% complete
3. Click "Cancel" button (X icon) in sidebar
4. Observe USB activity LED on device (if available)

**Expected Results:**
- ✅ Download stops within 1-2 seconds
- ✅ Progress bar stops updating
- ✅ Toast notification: "Sync cancelled"
- ✅ USB activity LED stops (if device has one)
- ✅ Device remains responsive to new operations

**Failure Indicators:**
- ❌ Download continues for 10+ seconds after cancel
- ❌ Device becomes unresponsive
- ❌ Must restart app to regain device control

---

### TEST-DL-15: Retry UI Outside Device Page

**Priority:** P2

**Objective:** Verify that failed downloads can be retried from sidebar.

**Test Steps:**
1. Cause download failures (disconnect USB mid-download)
2. Navigate away from Device page (go to Library or Calendar)
3. Observe sidebar "Downloads" section

**Expected Results:**
- ✅ Sidebar shows "(N failed)" count
- ✅ "Retry N Failed" button appears
- ✅ Clicking retry re-queues failed downloads
- ✅ Toast: "Re-queued N failed downloads"

**Failure Indicators:**
- ❌ No indication of failed downloads outside Device page
- ❌ Retry button missing
- ❌ Must return to Device page to retry

---

## Automated Test Cases (Unit Tests)

### Unit Test: Buffer Conversion (DL-01)

**File:** `src/hooks/__tests__/useDownloadOrchestrator.test.ts`

**Test Case:**
```typescript
describe('useDownloadOrchestrator - DL-01 Buffer Conversion', () => {
  it('should convert Uint8Array to Buffer before IPC', async () => {
    const mockData = new Uint8Array([1, 2, 3, 4, 5])
    const mockProcessDownload = vi.fn()

    window.electronAPI = {
      downloadService: {
        processDownload: mockProcessDownload
      }
    }

    // Simulate download process
    // ... test logic ...

    // Verify Buffer was passed, not Uint8Array
    expect(mockProcessDownload).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Buffer)
    )

    // Verify data integrity
    const passedBuffer = mockProcessDownload.mock.calls[0][1]
    expect(Buffer.isBuffer(passedBuffer)).toBe(true)
    expect(passedBuffer.length).toBe(5)
  })
})
```

### Unit Test: Initial Progress Emission (DL-02)

**Test Case:**
```typescript
it('should emit initial progress immediately after queue creation', async () => {
  const setDeviceSyncState = vi.fn()

  // Trigger queue processing
  await processDownloadQueue()

  // Verify immediate call with 0 progress
  expect(setDeviceSyncState).toHaveBeenCalledWith(
    expect.objectContaining({
      deviceSyncing: true,
      deviceSyncProgress: { current: 0, total: expect.any(Number) }
    })
  )
})
```

### Unit Test: Completed Item Cleanup (DL-07)

**File:** `electron/main/services/__tests__/download-service.test.ts`

**Test Case:**
```typescript
it('should prune completed items after 2 seconds', async () => {
  const service = getDownloadService()

  // Queue and complete a download
  await service.processDownload('test.wav', Buffer.from([1, 2, 3]))

  // Verify item exists immediately
  const stateImmediate = service.getState()
  expect(stateImmediate.queue.length).toBe(1)

  // Wait for cleanup timeout
  await new Promise(resolve => setTimeout(resolve, 2500))

  // Verify item removed
  const stateAfter = service.getState()
  expect(stateAfter.queue.length).toBe(0)
})
```

### Unit Test: Stall Detection Abort (DL-12)

**Test Case:**
```typescript
it('should abort USB transfer when stall detected', async () => {
  const abortController = new AbortController()
  const mockAbort = vi.spyOn(abortController, 'abort')

  // Simulate stalled download (no progress for 60s)
  // ... test logic ...

  // Verify abort was called
  expect(mockAbort).toHaveBeenCalled()
})
```

### Unit Test: Progress Counter Accuracy (DL-13)

**Test Case:**
```typescript
it('should only count completed downloads in progress', async () => {
  // Queue 3 files, fail 1
  const items = [
    { filename: 'file1.wav', fileSize: 1000 },
    { filename: 'file2.wav', fileSize: 1000 },
    { filename: 'file3.wav', fileSize: 1000 }
  ]

  // Simulate: file1 success, file2 fail, file3 success
  // ... test logic ...

  // Verify final progress
  const state = useAppStore.getState()
  expect(state.deviceSyncProgress).toEqual({
    current: 2, // Only successful downloads
    total: 3
  })
})
```

---

## Integration Test Cases

### INT-01: End-to-End Download Flow

**Objective:** Verify complete download flow from queue creation to file save.

**Test Steps:**
1. Mock USB device with 3 files
2. Trigger auto-sync
3. Verify all stages: queue → downloading → completed → saved to disk

**Assertions:**
- Queue created in download service
- Progress updates received
- Files saved to correct location
- Database records updated
- synced_files table updated

---

### INT-02: Cancel During Multi-File Download

**Objective:** Verify cancel works correctly mid-sync.

**Test Steps:**
1. Queue 5 files
2. Cancel after 2nd file starts downloading
3. Verify cleanup

**Assertions:**
- In-progress download stops
- Remaining files stay in queue (or are marked cancelled)
- Device remains usable

---

## Performance Test Cases

### PERF-01: Memory Stability (DL-01)

**Load Test:**
- Download 10 files sequentially (each 100MB)
- Monitor memory usage throughout
- Expected: Memory stabilizes between downloads (no leak)

### PERF-02: Progress Update Frequency (DL-09)

**Measurement:**
- Count IPC messages during 100MB download
- Expected: ~400 progress updates (250ms throttle = 4 per second for 100s download)
- Verify no dropped frames in UI

---

## Regression Test Cases

### REG-01: Device Connection Flow

**Test:** Verify all DL fixes don't break device connection.

**Steps:**
1. Connect device
2. Verify status transitions: disconnected → connecting → initializing → ready
3. Verify auto-sync triggers (if enabled)

### REG-02: Manual Download from Library

**Test:** Verify individual file downloads still work.

**Steps:**
1. Navigate to Library page
2. Click download button on single recording
3. Verify download completes

### REG-03: Transcription After Download

**Test:** Verify transcription flow works after download fixes.

**Steps:**
1. Download a recording
2. Trigger transcription
3. Verify transcription completes

---

## Test Execution Checklist

### Pre-Release Testing (Critical Path)

- [ ] TEST-DL-01 (Memory) - P0
- [ ] TEST-DL-14 (Cancel) - P0
- [ ] TEST-DL-11 (Subscriptions) - P1
- [ ] TEST-DL-12 (Stall Abort) - P1
- [ ] REG-01 (Connection) - P1

### Full Testing (Complete Coverage)

- [ ] All manual test cases (TEST-DL-01 through TEST-DL-15)
- [ ] All unit tests passing
- [ ] All integration tests passing
- [ ] Performance tests within acceptable ranges
- [ ] All regression tests passing

---

## Bug Triage Matrix

| Test Failure | Severity | Action |
|--------------|----------|--------|
| TEST-DL-01 fails | CRITICAL | Block release, immediate fix required |
| TEST-DL-14 fails | HIGH | Block release, fix required |
| TEST-DL-11 fails | HIGH | Fix before release if possible |
| TEST-DL-12 fails | MEDIUM | Can ship with known issue + hotfix plan |
| TEST-DL-02 fails | LOW | Cosmetic, can defer |
| TEST-DL-03 fails | LOW | Cosmetic, can defer |

---

## Test Report Template

### Test Execution Report

**Date:** YYYY-MM-DD
**Tester:** [Name]
**Build:** [Commit SHA]
**Platform:** [OS + Version]

| Test ID | Status | Notes |
|---------|--------|-------|
| TEST-DL-01 | ✅ PASS | Memory stayed under 150MB for 100MB file |
| TEST-DL-02 | ✅ PASS | Sidebar appeared immediately |
| ... | ... | ... |

**Critical Failures:** [List any P0/P1 failures]

**Recommendation:** [SHIP / DO NOT SHIP / NEEDS RETEST]

---

*Generated: 2026-02-27*
*Author: Claude Sonnet 4.5*
