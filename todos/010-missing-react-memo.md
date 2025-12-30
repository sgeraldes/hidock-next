---
id: "010"
title: "Add React.memo to list item components"
status: pending
priority: P2
category: performance
source: performance-oracle
created: 2025-12-30
files:
  - apps/electron/src/features/library/components/SourceCard.tsx
  - apps/electron/src/features/library/components/SourceRow.tsx
---

# Add React.memo to list item components

## Problem

List item components (`SourceCard`, `SourceRow`) are not memoized. When any state changes in the parent, all visible list items re-render unnecessarily.

## Location

- `apps/electron/src/features/library/components/SourceCard.tsx`
- `apps/electron/src/features/library/components/SourceRow.tsx`

## Current Code

```typescript
// SourceCard.tsx
export function SourceCard({ source, isSelected, onSelect }: Props) {
  // ... renders card
}

// SourceRow.tsx
export function SourceRow({ source, isSelected, onSelect }: Props) {
  // ... renders row
}
```

## Suggested Fix

```typescript
// SourceCard.tsx
import { memo } from 'react'

export const SourceCard = memo(function SourceCard({
  source,
  isSelected,
  onSelect
}: Props) {
  // ... renders card
})

// SourceRow.tsx
export const SourceRow = memo(function SourceRow({
  source,
  isSelected,
  onSelect
}: Props) {
  // ... renders row
})
```

Also ensure callbacks are stable:

```typescript
// In Library.tsx
const handleSelect = useCallback((id: string) => {
  toggleSelection(id)
}, [toggleSelection])
```

## Impact

- 100+ unnecessary re-renders when filtering
- Visible lag when scrolling large lists
- Higher memory pressure from recreated elements

## Acceptance Criteria

- [ ] SourceCard wrapped in React.memo
- [ ] SourceRow wrapped in React.memo
- [ ] Parent callbacks wrapped in useCallback
- [ ] Verify with React DevTools Profiler
- [ ] No unnecessary re-renders on filter/search change
