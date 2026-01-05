# TODO-009: Implement Enrichment Query Batching

## Status: PENDING

## Phase: 6 (Performance Optimization)

## Priority: MEDIUM

## Summary
Optimize transcript and meeting enrichment queries by batching, prioritizing visible items, and implementing background loading.

## Problem
- All enrichment happens eagerly on all items
- No batch size limiting (could hammer database with 5000 queries)
- Visible items not prioritized (user sees loading for items not on screen)
- Performance degrades with large datasets

## Acceptance Criteria
- [ ] Batch size limited to 100 items per query
- [ ] Visible items enriched first (based on virtualizer range)
- [ ] Off-screen items loaded in background
- [ ] Progress indication for enrichment loading
- [ ] Stale data handling (re-enrich on refocus)

## Implementation Notes
```typescript
// Get visible range from virtualizer
const visibleRange = virtualizer.getVirtualItems()
const visibleIds = visibleRange.map(item => recordings[item.index].id)

// Prioritize visible items for enrichment
const enrichQueue = [
  ...visibleIds,                    // First: visible items
  ...otherIds.slice(0, 100)         // Then: batch of off-screen
]
```

## Files to Modify
- `apps/electron/src/hooks/useUnifiedRecordings.ts`
- `apps/electron/src/pages/Library.tsx`

## Dependencies
- TODO-007 (AbortController for cancelling enrichment when filter changes or navigation occurs)

## Signal Integration with TODO-007

Enrichment batching needs cancellation support for:
1. **User navigates away** - Cancel pending enrichment queries
2. **Filter changes** - Cancel current batch, re-prioritize for new visible set
3. **Rapid scrolling** - Cancel off-screen enrichment, prioritize new visible range

### Interface

```typescript
interface UseEnrichmentBatcherOptions {
  visibleIds: string[]
  allIds: string[]
  batchSize?: number // default 100
  signal?: AbortSignal // from parent component or useBulkOperation
}

interface EnrichmentState {
  enrichedIds: Set<string>
  pendingIds: Set<string>
  isEnriching: boolean
}

function useEnrichmentBatcher(options: UseEnrichmentBatcherOptions): EnrichmentState
```

### Usage Pattern

```typescript
// In Library.tsx
const abortController = useRef(new AbortController())

// On filter change, cancel and restart enrichment
useEffect(() => {
  abortController.current.abort()
  abortController.current = new AbortController()
}, [filters])

const enrichment = useEnrichmentBatcher({
  visibleIds: virtualizer.getVirtualItems().map(v => recordings[v.index].id),
  allIds: recordings.map(r => r.id),
  signal: abortController.current.signal
})
```
