# TODO-006: Create BulkResultSummary Component

## Status: PENDING

## Phase: 4 (Bulk Operations Enhancement)

## Priority: HIGH

## Summary
Create a summary dialog that appears after bulk operations complete, showing success/failure/cancelled counts and allowing retry of failed items.

## Problem
- No feedback after bulk operations complete
- Users don't know which items failed or why
- No way to retry just the failed items

## Acceptance Criteria
- [ ] Shows after bulk operation completes (or is cancelled)
- [ ] Displays: "7 succeeded, 1 failed, 2 cancelled"
- [ ] Lists failed items with error messages and retryable indicator
- [ ] "Retry Failed" button re-queues only failed items (if any are retryable)
- [ ] "Dismiss" button closes and clears state
- [ ] Accessible (proper ARIA labels, live region)

---

## State Flow (receives from TODO-005/007)

```
Library.tsx
    │
    ├── useBulkOperation() onComplete callback receives BulkOperationResult
    │       └── { succeeded: string[], failed: [{id, error}], cancelled: string[], wasAborted: boolean }
    │
    └── <BulkResultSummary
          isOpen={showResultSummary}
          result={bulkOperationResult}  ◄── Uses BulkOperationResult from TODO-007
          onRetry={bulkOp.retry}
          onClose={handleDismiss}
        />
```

---

## Proposed Component

```tsx
import { LibraryError } from '@/features/library/utils/errorHandling'
import { BulkOperationResult } from '@/hooks/useBulkOperation'

interface BulkResultSummaryProps {
  isOpen: boolean
  onClose: () => void
  operation: 'Download' | 'Transcribe' | 'Delete'
  result: BulkOperationResult
  // Uses BulkOperationResult which has:
  // - succeeded: string[]
  // - failed: Array<{ id: string; error: LibraryError }>
  // - cancelled: string[]
  // - wasAborted: boolean
  onRetryFailed: (ids: string[]) => void
}

// Title format based on result
function getTitle(result: BulkOperationResult, operation: string): string {
  if (result.wasAborted) {
    return `${operation} Cancelled`
  }
  if (result.failed.length === 0) {
    return `${operation} Complete`
  }
  return `${operation} Completed with Errors`
}
```

### Using LibraryError for Retry Logic

```tsx
// Only show retry for retryable errors
const retryableItems = result.failed.filter(f => f.error.retryable)

{retryableItems.length > 0 && (
  <Button onClick={() => onRetryFailed(retryableItems.map(f => f.id))}>
    Retry {retryableItems.length} Failed
  </Button>
)}

// Show why some items can't be retried
{result.failed.length > retryableItems.length && (
  <p className="text-sm text-muted-foreground">
    {result.failed.length - retryableItems.length} items cannot be retried
    (file deleted, permission denied, etc.)
  </p>
)}
```

### Accessibility

```tsx
<Dialog
  open={isOpen}
  onOpenChange={(open) => !open && onClose()}
  aria-labelledby="result-summary-title"
>
  <DialogContent>
    <DialogTitle id="result-summary-title">
      {getTitle(result, operation)}
    </DialogTitle>

    {/* Summary stats */}
    <dl role="list" aria-label="Operation results">
      <div>
        <dt>Succeeded</dt>
        <dd>{result.succeeded.length}</dd>
      </div>
      {result.failed.length > 0 && (
        <div>
          <dt>Failed</dt>
          <dd>{result.failed.length}</dd>
        </div>
      )}
      {result.cancelled.length > 0 && (
        <div>
          <dt>Cancelled</dt>
          <dd>{result.cancelled.length}</dd>
        </div>
      )}
    </dl>

    {/* Error list with LibraryError details */}
    {result.failed.length > 0 && (
      <ul role="list" aria-label="Failed items">
        {result.failed.map(({ id, error }) => (
          <li key={id}>
            <span>{getRecordingTitle(id)}</span>
            <span className="text-destructive">{error.message}</span>
            {error.retryable && (
              <span className="text-xs">(can retry)</span>
            )}
          </li>
        ))}
      </ul>
    )}
  </DialogContent>
</Dialog>
```

---

## Files to Create
- `apps/electron/src/features/library/components/BulkResultSummary.tsx`

## Files to Modify
- `apps/electron/src/features/library/components/index.ts`
- `apps/electron/src/pages/Library.tsx`

## Dependencies
- TODO-007 (provides BulkOperationResult type with proper error structure)
- TODO-004 (LibraryError type with `retryable` flag)
- TODO-005 (displayed after BulkProgressModal closes)
