---
id: "011"
title: "Use useTransition for filter changes"
status: pending
priority: P2
category: performance
source: performance-oracle
created: 2025-12-30
files:
  - apps/electron/src/pages/Library.tsx
---

# Use useTransition for filter changes

## Problem

Filter changes (type, date, status) block the UI while re-filtering large datasets. Users experience unresponsive filter controls.

## Location

`apps/electron/src/pages/Library.tsx`

## Current Behavior

```typescript
const [typeFilter, setTypeFilter] = useState<string>('all')

// Blocks UI while filtering
const handleTypeChange = (type: string) => {
  setTypeFilter(type)  // Synchronous, blocks rendering
}
```

## Suggested Fix

```typescript
import { useTransition, useState } from 'react'

const [typeFilter, setTypeFilter] = useState<string>('all')
const [isPending, startTransition] = useTransition()

const handleTypeChange = (type: string) => {
  startTransition(() => {
    setTypeFilter(type)  // Non-blocking update
  })
}

// Show pending state
return (
  <div className={isPending ? 'opacity-50' : ''}>
    {/* filter UI */}
  </div>
)
```

## Impact

- Filter dropdowns feel sluggish
- UI freezes during filter operations
- Poor perceived performance

## Acceptance Criteria

- [ ] Filter changes wrapped in useTransition
- [ ] Visual feedback during pending state (opacity, spinner)
- [ ] UI remains responsive during filtering
- [ ] Works with search debouncing
