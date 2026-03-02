# CHANGES_spec-b007: Download/Sync + Transcription + Settings + State Mgmt (18 HIGH bugs)

## Summary

Fixed 18 HIGH-priority bugs across Download/Sync, Transcription, Settings, and State Management subsystems.

## Download/Sync (9 bugs)

### B-DWN-001: Stall detection aborts but doesn't clean up queue
**File:** `electron/main/services/download-service.ts`
- Added delayed cleanup (5s) after stall detection marks items as failed
- Stalled items are removed from both memory queue and database after the renderer sees the failed state

### B-DWN-002: Download queue memory leak
**File:** `electron/main/services/download-service.ts`
- Reduced prune threshold from 50 to 10 completed items retained
- Added auto-pruning of failed items older than 24 hours in `pruneCompletedItems()`

### B-DWN-003: .hda files not handled
**File:** `electron/main/services/download-service.ts`
- Added `DownloadService.normalizeFilename()` static method for `.hda -> .mp3` extension normalization
- `queueDownloads()` now checks both original and normalized filenames for duplicates and sync status
- Exported `normalizeHdaFilename` function for external use and testing

### B-DWN-004: clearCompleted doesn't remove from database
**File:** `electron/main/services/download-service.ts`
- Added `removeFromDatabase()` call for each item in `clearCompleted()`

### B-DWN-005: cancelAll doesn't persist state
**File:** `electron/main/services/download-service.ts`
- Added `persistQueueItem()` call for each cancelled item in `cancelAll()`

### B-DWN-006: cancelDownload has no delayed cleanup
**File:** `electron/main/services/download-service.ts`
- Added 5-second delayed cleanup after `cancelDownload()` marks item as failed
- Removes from both memory queue and database after delay

### B-DWN-007: Retry doesn't check if file already synced
**File:** `electron/main/services/download-service.ts`
- `retryFailed()` now calls `isFileAlreadySynced()` before resetting each failed item
- Files that were synced in the meantime are removed from the queue instead of retried

### B-DWN-008: Renderer-side stall detection redundant
**File:** `src/hooks/useDownloadOrchestrator.ts`
- Removed entire renderer-side stall detection (Map-based heartbeat, 15s interval, toast notifications)
- Stall detection is now handled exclusively by main process `DownloadService.checkForStalledDownloads()`

### B-DWN-009: getState() creates new array every call
**File:** `electron/main/services/download-service.ts`
- Added `private dirty = true` and `private cachedQueueArray` fields
- `getState()` now returns cached array when no mutations have occurred
- Added `markDirty()` calls to all methods that modify the queue

## Transcription Queue (4 bugs)

### B-TXN-001: Immediate retry with no backoff
**File:** `electron/main/services/transcription.ts`
- Implemented exponential backoff: `backoffMs = Math.min(30000 * Math.pow(2, retryCount), 120000)`
- Retry schedule: 30s, 60s, 120s (capped)
- Failed items are only re-queued if enough time has elapsed since failure

### B-TXN-002: Progress hardcoded at 50%
**File:** `electron/main/services/transcription.ts`
- Added `setInterval` progress ticker (every 3s) that increments progress during API calls
- Ticker caps at 90% (below 95% reserved for completion stages)
- Ticker syncs with actual progress callback values
- Cleanup ensured with `finally` block

### B-TXN-003: Unsafe `as any` casts for retry_count
**File:** `electron/main/services/transcription.ts`
- Removed `(item as any).retry_count` casts (2 occurrences)
- `QueueItem` interface already has `retry_count: number`, so typed access works directly

### B-TXN-004: Store retry not contingent on IPC success
**File:** `src/store/features/useTranscriptionStore.ts`
- Retry now awaits `updateQueueItem` IPC call success before updating local store state
- If IPC returns falsy value, local state is not changed and error is logged
- `processQueue` is only called after successful IPC update
- Updated tests to handle async behavior (flush promises, mock returns `true`)

## Settings (4 bugs)

### B-SET-001: configLoading starts false
**File:** `src/store/domain/useConfigStore.ts`
- Changed initial `configLoading` from `false` to `true`
- UI shows loading state immediately until config is fetched from main process

### B-SET-002: Storage info errors silent
**File:** `src/pages/Settings.tsx`
- Added `storageError` state tracking
- Added error banner with destructive styling and retry button in Storage card
- `loadStorageInfo()` now captures and surfaces errors to the user

### B-SET-003: Config errors not recoverable
**File:** `src/store/domain/useConfigStore.ts`
- `updateConfig()` now saves `previousConfig` before the IPC call
- On failure, restores the previous config via `set({ config: previousConfig })`

### B-SET-004: QA logging not synced to preload
**File:** `electron/preload/index.ts`
- Added `isQaLogsEnabled()` function that reads from localStorage bridge (`hidock-ui-store` key)
- Exposed via `contextBridge.exposeInMainWorld('isQaLogsEnabled', ...)`
- Added `Window.isQaLogsEnabled` type declaration

## State Management (1 bug)

### B-SM-001: isDownloading/getDownloadProgress over-subscription
**File:** `src/store/useAppStore.ts`
- Added `@deprecated` JSDoc annotations to `isDownloading` and `getDownloadProgress` interface declarations
- Annotations point to `useIsDownloading(id)` and `useDownloadProgress(id)` selector hooks as replacements
- Removed old TODO comment (replaced with proper deprecation annotations)

## Tests

### New Test Files
- `electron/main/services/__tests__/download-service-b007.test.ts` (13 tests)
  - `.hda` normalization (6 tests)
  - Database cleanup on clearCompleted
  - CancelAll persistence
  - CancelDownload delayed cleanup
  - Retry sync-check skipping
  - Dirty-flag caching (2 tests)
  - Stall detection cleanup
- `electron/main/services/__tests__/transcription-b007.test.ts` (5 tests)
  - Exponential backoff calculation (5 tests)

### Updated Test Files
- `src/store/__tests__/useTranscriptionStore.test.ts`
  - Updated mock to return `true` from `updateQueueItem` (B-TXN-004)
  - Added `processQueue` mock
  - Made retry tests async with `flushPromises()` helper

### Test Results
- 56 test files passed
- 839 tests passed
- 0 failures

## Files Modified
| File | Changes |
|------|---------|
| `electron/main/services/download-service.ts` | B-DWN-001 through B-DWN-009 |
| `src/hooks/useDownloadOrchestrator.ts` | B-DWN-008 (removed stall detection) |
| `electron/main/services/transcription.ts` | B-TXN-001, B-TXN-002, B-TXN-003 |
| `src/store/features/useTranscriptionStore.ts` | B-TXN-004 |
| `src/pages/Settings.tsx` | B-SET-002 |
| `src/store/domain/useConfigStore.ts` | B-SET-001, B-SET-003 |
| `electron/preload/index.ts` | B-SET-004 |
| `src/store/useAppStore.ts` | B-SM-001 |
| `src/store/__tests__/useTranscriptionStore.test.ts` | Updated for B-TXN-004 |
| `electron/main/services/__tests__/download-service-b007.test.ts` | New |
| `electron/main/services/__tests__/transcription-b007.test.ts` | New |
