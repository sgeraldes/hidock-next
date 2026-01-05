# TODO-006: Create BulkResultSummary Component

## Status: PENDING

## Phase: 4 (Bulk Operations Enhancement)

## Priority: HIGH

## Summary
Create a summary dialog that appears after bulk operations complete, showing success/failure counts and allowing retry of failed items.

## Problem
- No feedback after bulk operations complete
- Users don't know which items failed or why
- No way to retry just the failed items

## Acceptance Criteria
- [ ] Shows after bulk operation completes
- [ ] Displays: "7 succeeded, 1 failed"
- [ ] Lists failed items with error messages
- [ ] "Retry Failed" button re-queues only failed items
- [ ] "Dismiss" button closes and clears state
- [ ] Accessible (proper ARIA labels)

## Proposed Component

```tsx
interface BulkResultSummaryProps {
  isOpen: boolean
  onClose: () => void
  operation: 'Download' | 'Transcribe' | 'Delete'
  succeeded: number
  failed: number
  errors: Array<{ id: string; title: string; message: string }>
  onRetryFailed: (ids: string[]) => void
}
```

## Files to Create
- `apps/electron/src/features/library/components/BulkResultSummary.tsx`

## Files to Modify
- `apps/electron/src/features/library/components/index.ts`
- `apps/electron/src/pages/Library.tsx`

## Dependencies
- TODO-005 (BulkProgressModal - shares state)
