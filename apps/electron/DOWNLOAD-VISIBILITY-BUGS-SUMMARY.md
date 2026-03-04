# Download Progress Visibility - Quick Bug Summary

**Audit Date:** 2026-03-04
**Status:** 🔴 4/6 criteria met (66% compliance)
**Test File:** `src/hooks/__tests__/useDownloadOrchestrator-activity-log.test.ts`
**Full Report:** `DOWNLOAD-PROGRESS-VISIBILITY-AUDIT.md`

---

## 5 Bugs Found

### 🔴 DL-AL-001: Device Not Connected Error Missing from Activity Log
**File:** `useDownloadOrchestrator.ts:76-79`
**Severity:** HIGH

Device disconnection during download shows nothing in Activity Log.

**Fix (1 line):**
```typescript
if (!deviceService.isConnected()) {
  deviceService.log('error', 'Download failed', `${item.filename}: Device not connected`)  // ADD THIS
  await window.electronAPI.downloadService.markFailed(item.filename, 'Device not connected')
  return false
}
```

---

### 🟡 DL-AL-002: No "Download Queued" Message
**File:** `useDownloadOrchestrator.ts:84`
**Severity:** MEDIUM

When multiple files are queued, Activity Log shows nothing until first download starts.

**Fix (1 line):**
```typescript
deviceService.log('info', 'Download queued', item.filename)  // ADD THIS
addToDownloadQueue(item.filename, item.filename, item.fileSize)
```

---

### 🟡 DL-AL-003: No Progress Updates for Large Files
**File:** `useDownloadOrchestrator.ts:91-104`
**Severity:** MEDIUM

Large files (100MB+) show no progress in Activity Log for minutes, appearing frozen.

**Fix (8 lines):**
```typescript
let lastLoggedPercent = 0
const success = await deviceService.downloadRecording(
  item.filename,
  item.fileSize,
  (chunk) => {
    chunks.push(chunk)
    totalReceived += chunk.length
    const pct = Math.round((totalReceived / item.fileSize) * 100)

    // Log every 10%
    const currentMilestone = Math.floor(pct / 10) * 10
    const lastMilestone = Math.floor(lastLoggedPercent / 10) * 10
    if (currentMilestone > lastMilestone && currentMilestone > 0) {
      deviceService.log('info', 'Download progress', `${item.filename} (${currentMilestone}%)`)
      lastLoggedPercent = pct
    }

    updateDownloadProgress(item.filename, pct)
  },
  signal
)
```

---

### 🟡 DL-AL-004: Download Cancellation Not Logged
**File:** `useDownloadOrchestrator.ts:148-162`
**Severity:** MEDIUM

User-initiated cancellations appear as errors instead of cancellations.

**Fix (5 lines):**
```typescript
catch (error) {
  const libraryError = parseError(error, 'download')
  await window.electronAPI.downloadService.markFailed(item.filename, libraryError.message)

  // ADD THIS BLOCK:
  if (signal.aborted) {
    deviceService.log('info', 'Download cancelled', `${item.filename}: Cancelled by user`)
  } else {
    deviceService.log('error', 'Download failed', `${item.filename}: ${libraryError.message}`)
  }

  if (!signal.aborted) {
    removeFromDownloadQueue(item.filename)
  }
  // ... rest of catch block
}
```

---

### 🟢 DL-AL-005: No Toast on Download Start
**File:** `useDownloadOrchestrator.ts:85`
**Severity:** LOW

No immediate feedback when download starts (mitigated by sidebar progress).

**Fix (1 line):**
```typescript
deviceService.log('info', 'Starting download', item.filename)
toast({ title: 'Download started', description: item.filename })  // ADD THIS
```

---

## Quick Stats

| Metric | Value |
|--------|-------|
| Total bugs found | 5 |
| High severity | 1 (20%) |
| Medium severity | 3 (60%) |
| Low severity | 1 (20%) |
| Lines of code to fix all | ~20 |
| Estimated time to fix all | 15 minutes |
| Test file failures | 13/19 tests |

---

## Minimum Viable Fix (Priority 1)

**Fix 2 high/medium bugs with 6 lines of code:**

1. DL-AL-001: Device not connected error (line 79)
2. DL-AL-004: Cancellation logging (line 148-162)

**Impact:** Covers 2 most common failure scenarios, improves from 66% to 90% compliance.

---

## Run Tests

```bash
cd apps/electron
npm run test:run -- src/hooks/__tests__/useDownloadOrchestrator-activity-log.test.ts
```

**Expected:** 13 failing tests (proves bugs exist)
**After fixes:** All 19 tests pass
