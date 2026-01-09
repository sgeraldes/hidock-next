# TODO-004: Integrate Error Handling Utilities

## Status: PENDING

## Phase: 3 (Error Handling & Recovery)

## Priority: HIGH

## Summary
Integrate the existing `errorHandling.ts` utilities into components to provide user-friendly error recovery for audio playback, downloads, and transcription failures.

## Problem
- `errorHandling.ts` has comprehensive error utilities (`parseError`, `withRetry`, `getRecoveryAction`)
- These utilities are NOT used by actual components
- No visual error indicators on SourceRow/SourceCard for file-not-found scenarios
- No retry buttons for failed operations

## Acceptance Criteria
- [ ] AudioPlayer uses `parseError()` for error categorization
- [ ] SourceRow shows error badge for missing files
- [ ] SourceCard shows retry button for failed downloads
- [ ] SourceDetailDrawer shows transcription errors with retry
- [ ] `withRetry()` is used for download operations in OperationController
- [ ] User-friendly error messages appear via toast

## Files to Modify
- `apps/electron/src/components/AudioPlayer.tsx`
- `apps/electron/src/components/OperationController.tsx`
- `apps/electron/src/features/library/components/SourceRow.tsx`
- `apps/electron/src/features/library/components/SourceCard.tsx`
- `apps/electron/src/features/library/components/SourceDetailDrawer.tsx`

## Implementation Notes
```typescript
// Example: AudioPlayer error handling
import { parseError, getErrorMessage, getRecoveryAction } from '@/features/library/utils/errorHandling'

const handlePlayError = (error: Error, recording: UnifiedRecording) => {
  const parsedError = parseError(error)
  toast.error(getErrorMessage(parsedError))

  const recovery = getRecoveryAction(parsedError)
  if (recovery) {
    // Show recovery action button
  }
}
```

## Specific Integration Requirements

### AudioPlayer.tsx Integration

- [ ] Wrap play() in try-catch using parseError()
- [ ] Handle NotFoundError → show "File missing" toast + disable play button
- [ ] Handle NotSupportedError → show "Unsupported format" toast
- [ ] Handle NetworkError → show "Download required" badge
- [ ] Add error state to component (shows badge on SourceRow/Card)

### OperationController.tsx Integration

- [ ] Wrap downloadFile() in withRetry(fn, { maxRetries: 3 })
- [ ] Exponential backoff: 1s, 2s, 4s
- [ ] Persist retry count in download state
- [ ] Show retry button after max retries exceeded
- [ ] Handle AbortError → mark as cancelled, not failed

### SourceRow.tsx Integration

- [ ] Display error badge if recording.error exists
- [ ] Tooltip shows error message
- [ ] Badge colors: red (error), yellow (missing file), blue (processing)

### SourceCard.tsx Integration

- [ ] Show retry button for failed downloads
- [ ] Disable play button for missing files
- [ ] Show error message in card footer

### SourceDetailDrawer.tsx Integration

- [ ] Transcription errors shown with full message
- [ ] Retry button triggers retryTranscription()
- [ ] Error details expandable section

---

## Test Requirements

### Unit Tests
- [ ] parseError correctly categorizes each error type
- [ ] withRetry respects maxRetries limit
- [ ] getRecoveryAction returns appropriate actions

### Integration Tests
- [ ] Download fails → retry → succeeds
- [ ] Audio file missing → badge shown → user notified
- [ ] Transcription timeout → retry with longer timeout

### Manual Tests
- [ ] Disconnect network during download → error shown → reconnect → retry works
- [ ] Corrupt audio file → appropriate error message
- [ ] Rate limited API → backoff works

---

## Error State Architecture (CRITICAL - consumed by TODO-005, TODO-006)

### Option A: Recording Error Map in LibraryStore (RECOMMENDED)

```typescript
// In apps/electron/src/store/useLibraryStore.ts

import { LibraryError } from '@/features/library/utils/errorHandling'

interface LibraryState {
  // ... existing filter state from Phase 1 ...

  // Error state (new)
  recordingErrors: Map<string, LibraryError>

  // Actions
  setRecordingError: (id: string, error: LibraryError) => void
  clearRecordingError: (id: string) => void
  clearAllErrors: () => void
}

// Implementation
setRecordingError: (id, error) => set(state => ({
  recordingErrors: new Map(state.recordingErrors).set(id, error)
})),
clearRecordingError: (id) => set(state => {
  const next = new Map(state.recordingErrors)
  next.delete(id)
  return { recordingErrors: next }
}),
clearAllErrors: () => set({ recordingErrors: new Map() })
```

### Why Option A over extending UnifiedRecording:

1. **Separation of concerns** - Errors are UI state, not data model
2. **Easier to clear** - Don't need to mutate recording objects
3. **Testing** - Can mock error state independently
4. **Performance** - Only re-renders components subscribed to error state

### Usage in Components

```typescript
// In SourceRow.tsx
const error = useLibraryStore(state => state.recordingErrors.get(recording.id))
const showErrorBadge = !!error

// In SourceCard.tsx
const { recordingErrors, clearRecordingError } = useLibraryStore()
const error = recordingErrors.get(recording.id)

const handleRetry = () => {
  clearRecordingError(recording.id)
  onRetryDownload()
}
```

### Integration with TODO-007 (useBulkOperation)

The `onItemStatusChange` callback in useBulkOperation should update LibraryStore:

```typescript
// In Library.tsx
const bulkOp = useBulkOperation({
  // ...
  onItemStatusChange: (id, status, error) => {
    if (error) {
      setRecordingError(id, error)
    } else if (status === 'success') {
      clearRecordingError(id)
    }
  }
})
```

---

## Dependencies
- None (utilities already exist)

## Depended On By
- TODO-005 (BulkProgressModal displays LibraryError from items)
- TODO-006 (BulkResultSummary shows LibraryError with retryable flag)
- TODO-007 (useBulkOperation uses parseError to create LibraryError)
