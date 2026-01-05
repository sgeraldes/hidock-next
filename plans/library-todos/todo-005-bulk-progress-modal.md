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
- [ ] Per-item status with icons: success (✓), failed (✗), pending (○), in-progress (spinner), cancelled (⊘)
- [ ] Failed items show expandable error details with recovery action
- [ ] Cancel button to abort remaining operations
- [ ] Smooth animations for status changes
- [ ] Accessible: focus trap, ARIA live regions for status updates

---

## State Ownership (CRITICAL)

**BulkProgressModal does NOT own bulk operation state.**

State flow:
1. `Library.tsx` creates bulk operation via `useBulkOperation()` (from TODO-007)
2. `Library.tsx` passes `bulkOp.items` and `bulkOp.abort` to BulkProgressModal as props
3. BulkProgressModal is a PURE DISPLAY component - no internal state machine
4. On completion, `Library.tsx` captures `BulkOperationResult` and passes to BulkResultSummary

```
Library.tsx (state owner)
    │
    ├── useBulkOperation() ─────────────────────────────┐
    │   └── returns { items, abort, progress, retry }   │
    │                                                    │
    └── <BulkProgressModal                              │
          isOpen={bulkOp.isRunning}                     │
          items={[...bulkOp.items.values()]}  ◄─────────┘
          progress={bulkOp.progress}
          onCancel={bulkOp.abort}
          onClose={handleClose}
        />
```

---

## Proposed Component

```tsx
import { LibraryError } from '@/features/library/utils/errorHandling'
import { BulkOperationItem, BulkItemStatus } from '@/hooks/useBulkOperation'

interface BulkProgressModalProps {
  isOpen: boolean
  onClose: () => void
  operation: 'download' | 'transcribe' | 'delete'
  items: BulkOperationItem[]
  progress: { current: number; total: number }
  onCancel: () => void
}

// Note: Uses BulkOperationItem from TODO-007 which includes:
// - status: BulkItemStatus (includes 'cancelled')
// - error?: LibraryError (not string)
```

### Accessibility Requirements

```tsx
<Dialog
  open={isOpen}
  onOpenChange={(open) => !open && onClose()}
  aria-labelledby="bulk-progress-title"
  aria-describedby="bulk-progress-description"
>
  <DialogContent>
    <DialogTitle id="bulk-progress-title">
      {operation === 'download' ? 'Downloading' : operation === 'transcribe' ? 'Transcribing' : 'Deleting'} Files
    </DialogTitle>
    <DialogDescription id="bulk-progress-description">
      {progress.current} of {progress.total} complete
    </DialogDescription>

    {/* Live region for screen readers */}
    <div role="status" aria-live="polite" className="sr-only">
      {progress.current} of {progress.total} items processed
    </div>

    {/* Item list */}
    <ul role="list" aria-label="Operation progress">
      {items.map(item => (
        <li key={item.id} aria-label={`${item.title}: ${item.status}`}>
          <StatusIcon status={item.status} />
          <span>{item.title}</span>
          {item.error && (
            <details>
              <summary>Error details</summary>
              <p>{item.error.message}</p>
              {item.error.recoverable && (
                <p className="text-sm text-muted-foreground">
                  {getRecoveryAction(item.error)?.label}
                </p>
              )}
            </details>
          )}
        </li>
      ))}
    </ul>

    <DialogFooter>
      <Button onClick={onCancel} variant="destructive">
        Cancel Remaining
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

---

## Close Behavior

| Condition | Close Button Behavior |
|-----------|----------------------|
| Operation running | Disabled (must cancel first) |
| Operation complete (no failures) | Closes modal, clears state |
| Operation complete (with failures) | Closes modal, shows BulkResultSummary (TODO-006) |
| Operation cancelled | Closes modal, shows BulkResultSummary with cancelled count |

---

## Files to Create
- `apps/electron/src/features/library/components/BulkProgressModal.tsx`

## Files to Modify
- `apps/electron/src/features/library/components/index.ts` (add export)
- `apps/electron/src/pages/Library.tsx` (integrate modal with useBulkOperation)

## Dependencies
- TODO-007 (MUST complete first - provides useBulkOperation hook and BulkOperationItem type)
- TODO-004 (uses LibraryError type and getRecoveryAction for error display)

## Depended On By
- TODO-006 (BulkResultSummary shows after BulkProgressModal closes)
