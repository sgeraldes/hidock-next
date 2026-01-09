---
id: "016"
title: "Fix missing useCallback dependencies"
status: completed
priority: P2
category: bug
source: typescript-reviewer
created: 2025-12-30
files:
  - apps/electron/src/pages/Library.tsx
---

# Fix missing useCallback dependencies

## Problem

Several `useCallback` hooks in `Library.tsx` have incomplete dependency arrays, which can cause stale closures and incorrect behavior.

## Location

`apps/electron/src/pages/Library.tsx`

## Example Issues

```typescript
// Missing dependency on 'sources'
const handleSelectAll = useCallback(() => {
  const allIds = sources.map(s => s.id)  // Uses 'sources'
  selectAll(allIds)
}, [selectAll])  // Should include 'sources'

// Missing dependency on 'selectedIds'
const handleBulkDelete = useCallback(async () => {
  await window.api.recordings.deleteMany([...selectedIds])  // Uses 'selectedIds'
  clearSelection()
}, [clearSelection])  // Should include 'selectedIds'
```

## Suggested Fix

```typescript
const handleSelectAll = useCallback(() => {
  const allIds = sources.map(s => s.id)
  selectAll(allIds)
}, [sources, selectAll])

const handleBulkDelete = useCallback(async () => {
  await window.api.recordings.deleteMany([...selectedIds])
  clearSelection()
}, [selectedIds, clearSelection])
```

## How to Find All Issues

```bash
# ESLint exhaustive-deps rule should catch these
npm run lint -- --rule 'react-hooks/exhaustive-deps: error'
```

## Impact

- Callbacks use stale values
- Operations affect wrong items
- Hard-to-debug race conditions

## Acceptance Criteria

- [ ] All useCallback hooks have complete deps
- [ ] All useMemo hooks have complete deps
- [ ] Enable exhaustive-deps ESLint rule
- [ ] No stale closure issues
