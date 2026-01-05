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

## Dependencies
- None (utilities already exist)
