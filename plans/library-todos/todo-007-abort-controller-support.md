# TODO-007: Add AbortController Support for Bulk Operations

## Status: PENDING

## Phase: 4 (Bulk Operations Enhancement)

## Priority: MEDIUM

## Summary
Implement AbortController for cancelling in-progress bulk download and transcription operations.

## Problem
- No way to cancel bulk operations mid-execution
- Users must wait for all operations or close the app
- Network requests continue even when user wants to stop

## Acceptance Criteria
- [ ] Downloads can be cancelled via AbortController
- [ ] Transcription queue can be cleared mid-operation
- [ ] Cancel updates item status to "cancelled"
- [ ] Cancellation triggers cleanup (partial downloads removed)
- [ ] UI shows cancelled state appropriately

## Implementation Notes
```typescript
// In OperationController or download service
const abortController = new AbortController()

const downloadFile = async (url: string, options: { signal: AbortSignal }) => {
  const response = await fetch(url, { signal: options.signal })
  // ...
}

// Cancel all pending downloads
abortController.abort()
```

## Files to Modify
- `apps/electron/src/components/OperationController.tsx`
- `apps/electron/src/pages/Library.tsx` (cancel button handler)

## Dependencies
- TODO-005 (BulkProgressModal provides cancel button)
