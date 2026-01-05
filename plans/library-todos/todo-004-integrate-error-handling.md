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

## Dependencies
- None (utilities already exist)
