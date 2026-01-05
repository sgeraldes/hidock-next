# TODO-007: Add AbortController Support for Bulk Operations

## Status: PENDING

## Phase: 4 (Bulk Operations Enhancement)

## Priority: HIGH (upgraded from MEDIUM - foundational for TODO-005, TODO-009)

## Summary
Implement AbortController infrastructure via a `useBulkOperation` hook that provides cancellation, progress tracking, and status management for bulk download and transcription operations.

## Problem
- No way to cancel bulk operations mid-execution
- Users must wait for all operations or close the app
- Network requests continue even when user wants to stop
- Current `downloadAbortRef` in OperationController is a simple boolean, not a proper AbortController

## Acceptance Criteria
- [ ] Downloads can be cancelled via AbortController signal
- [ ] Transcription queue can be cleared mid-operation
- [ ] Cancel updates item status to "cancelled" (not "failed")
- [ ] Cancellation triggers cleanup (partial downloads removed)
- [ ] UI shows cancelled state appropriately
- [ ] `useBulkOperation` hook provides unified interface for all consumers

---

## Interface Definition (CRITICAL - consumed by TODO-005, TODO-006, TODO-009)

### File: `apps/electron/src/hooks/useBulkOperation.ts`

```typescript
import { LibraryError } from '@/features/library/utils/errorHandling'

export type BulkItemStatus = 'pending' | 'processing' | 'success' | 'failed' | 'cancelled'

export interface BulkOperationItem<T = unknown> {
  id: string
  data: T
  status: BulkItemStatus
  error?: LibraryError
  progress?: number // 0-100 for items with progress (downloads)
}

export interface BulkOperationOptions<T> {
  items: Array<{ id: string; data: T }>
  operation: (item: T, signal: AbortSignal, onProgress?: (percent: number) => void) => Promise<void>
  onItemStatusChange?: (id: string, status: BulkItemStatus, error?: LibraryError) => void
  onComplete?: (results: BulkOperationResult) => void
}

export interface BulkOperationResult {
  succeeded: string[]
  failed: Array<{ id: string; error: LibraryError }>
  cancelled: string[]
  wasAborted: boolean
}

export interface BulkOperationState {
  isRunning: boolean
  items: Map<string, BulkOperationItem>
  progress: { current: number; total: number }
  abort: () => void
  retry: (ids: string[]) => void
}

export function useBulkOperation<T>(options: BulkOperationOptions<T>): BulkOperationState
```

### Usage Pattern (for TODO-005)

```typescript
const bulkOp = useBulkOperation({
  items: selectedRecordings.map(r => ({ id: r.id, data: r })),
  operation: async (recording, signal, onProgress) => {
    await downloadRecording(recording, { signal, onProgress })
  },
  onItemStatusChange: (id, status, error) => {
    // Update UI immediately per item
  },
  onComplete: (results) => {
    // Show BulkResultSummary (TODO-006)
  }
})

// In cancel button:
<Button onClick={bulkOp.abort}>Cancel</Button>
```

---

## Signal Propagation Path

```
Library.tsx
    └── useBulkOperation() creates AbortController
            ├── BulkProgressModal receives abort() function via props
            │       └── Cancel button calls abort()
            │
            ├── Each operation receives signal parameter
            │       └── processDownload(item, signal)
            │           └── deviceService.downloadRecording(..., { signal })
            │
            └── TODO-009: useEnrichmentBatcher receives signal
                    └── Cancels pending enrichment queries on abort
```

---

## Implementation Notes

### Step 1: Create useBulkOperation hook

```typescript
// apps/electron/src/hooks/useBulkOperation.ts
export function useBulkOperation<T>(options: BulkOperationOptions<T>): BulkOperationState {
  const [items, setItems] = useState<Map<string, BulkOperationItem>>(() => new Map())
  const [isRunning, setIsRunning] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)

  const start = useCallback(async () => {
    abortControllerRef.current = new AbortController()
    const signal = abortControllerRef.current.signal
    setIsRunning(true)

    // Initialize all items as pending
    const initialItems = new Map(
      options.items.map(({ id, data }) => [id, { id, data, status: 'pending' as const }])
    )
    setItems(initialItems)

    const results: BulkOperationResult = {
      succeeded: [],
      failed: [],
      cancelled: [],
      wasAborted: false
    }

    for (const { id, data } of options.items) {
      if (signal.aborted) {
        // Mark remaining as cancelled
        setItems(prev => {
          const next = new Map(prev)
          for (const [itemId, item] of next) {
            if (item.status === 'pending') {
              next.set(itemId, { ...item, status: 'cancelled' })
              results.cancelled.push(itemId)
            }
          }
          return next
        })
        results.wasAborted = true
        break
      }

      // Update to processing
      setItems(prev => new Map(prev).set(id, { ...prev.get(id)!, status: 'processing' }))
      options.onItemStatusChange?.(id, 'processing')

      try {
        await options.operation(data, signal, (progress) => {
          setItems(prev => new Map(prev).set(id, { ...prev.get(id)!, progress }))
        })
        setItems(prev => new Map(prev).set(id, { ...prev.get(id)!, status: 'success' }))
        options.onItemStatusChange?.(id, 'success')
        results.succeeded.push(id)
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          setItems(prev => new Map(prev).set(id, { ...prev.get(id)!, status: 'cancelled' }))
          options.onItemStatusChange?.(id, 'cancelled')
          results.cancelled.push(id)
        } else {
          const libraryError = parseError(error)
          setItems(prev => new Map(prev).set(id, { ...prev.get(id)!, status: 'failed', error: libraryError }))
          options.onItemStatusChange?.(id, 'failed', libraryError)
          results.failed.push({ id, error: libraryError })
        }
      }
    }

    setIsRunning(false)
    options.onComplete?.(results)
  }, [options])

  const abort = useCallback(() => {
    abortControllerRef.current?.abort()
  }, [])

  const retry = useCallback((ids: string[]) => {
    // Re-run operation on specific items
    // Implementation: filter options.items to only retry ids, call start()
  }, [])

  // Auto-start on mount
  useEffect(() => { start() }, [])

  return {
    isRunning,
    items,
    progress: {
      current: [...items.values()].filter(i => i.status === 'success' || i.status === 'failed').length,
      total: items.size
    },
    abort,
    retry
  }
}
```

### Step 2: Migrate OperationController

Replace `downloadAbortRef.current = false` boolean with AbortController:

```typescript
// Before (line 48)
const downloadAbortRef = useRef(false)

// After
const downloadAbortControllerRef = useRef<AbortController | null>(null)

// In processDownloadQueue:
downloadAbortControllerRef.current = new AbortController()
const signal = downloadAbortControllerRef.current.signal

// Pass signal to processDownload
const success = await processDownload(item, signal)

// In processDownload, check signal:
if (signal.aborted) {
  return { status: 'cancelled' }
}
```

---

## Files to Create
- `apps/electron/src/hooks/useBulkOperation.ts`

## Files to Modify
- `apps/electron/src/components/OperationController.tsx` (migrate from boolean ref to AbortController)
- `apps/electron/src/pages/Library.tsx` (use useBulkOperation for bulk actions)

## Dependencies
- TODO-004 (uses `parseError` from errorHandling.ts for categorizing errors)

## Depended On By
- TODO-005 (BulkProgressModal uses useBulkOperation for cancel button and status)
- TODO-006 (BulkResultSummary receives BulkOperationResult)
- TODO-009 (Enrichment batching uses signal for cancellation)
