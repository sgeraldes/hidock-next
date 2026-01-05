# TODO-005: Create BulkProgressModal Component

## Status: PENDING

## Phase: 4 (Bulk Operations Enhancement)

## Priority: HIGH

## Summary
Create a modal/drawer component that shows detailed per-item progress during bulk operations (download, transcribe, delete).

## Problem
- Current BulkActionsBar only shows overall progress (e.g., "3/8")
- No visibility into which items succeeded vs failed
- No expandable error details
- No cancel button during operations

## Acceptance Criteria
- [ ] Modal shows overall progress: "3 of 8 files downloaded"
- [ ] Per-item status with icons: success (✓), failed (✗), pending (○), in-progress (spinner)
- [ ] Failed items show expandable error details
- [ ] Cancel button to abort remaining operations
- [ ] Smooth animations for status changes

## Proposed Component

```tsx
interface BulkProgressModalProps {
  isOpen: boolean
  onClose: () => void
  operation: 'download' | 'transcribe' | 'delete'
  items: Array<{
    id: string
    title: string
    status: 'pending' | 'in_progress' | 'success' | 'failed'
    error?: string
  }>
  onCancel: () => void
}
```

## Files to Create
- `apps/electron/src/features/library/components/BulkProgressModal.tsx`

## Files to Modify
- `apps/electron/src/features/library/components/index.ts` (add export)
- `apps/electron/src/pages/Library.tsx` (integrate modal)

## Dependencies
- TODO-007 (AbortController support for cancellation)
