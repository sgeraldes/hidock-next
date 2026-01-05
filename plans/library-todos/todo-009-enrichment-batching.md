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
- None
