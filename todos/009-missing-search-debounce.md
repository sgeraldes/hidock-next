---
id: "009"
title: "Add search debouncing"
status: completed
completed: 2025-12-30
priority: P2
category: performance
source: performance-oracle
created: 2025-12-30
files:
  - apps/electron/src/pages/Library.tsx
---

# Add search debouncing

## Problem

Search input triggers filtering on every keystroke. With large datasets (5000+ recordings), this causes:
- 250ms+ lag per keystroke
- UI jank during typing
- Unnecessary re-renders

## Location

`apps/electron/src/pages/Library.tsx` - search input handling

## Current Code

```typescript
const [searchTerm, setSearchTerm] = useState('')

// Filters run on every searchTerm change
const filteredSources = useMemo(() => {
  return sources.filter(s =>
    s.title.toLowerCase().includes(searchTerm.toLowerCase())
  )
}, [sources, searchTerm])  // Runs on every keystroke
```

## Suggested Fix

```typescript
import { useDeferredValue } from 'react'
// or use lodash debounce

const [searchTerm, setSearchTerm] = useState('')
const deferredSearchTerm = useDeferredValue(searchTerm)

const filteredSources = useMemo(() => {
  return sources.filter(s =>
    s.title.toLowerCase().includes(deferredSearchTerm.toLowerCase())
  )
}, [sources, deferredSearchTerm])
```

Or with debounce:

```typescript
import { useMemo, useState, useCallback } from 'react'
import debounce from 'lodash/debounce'

const [searchTerm, setSearchTerm] = useState('')
const [debouncedSearch, setDebouncedSearch] = useState('')

const updateSearch = useCallback(
  debounce((value: string) => setDebouncedSearch(value), 300),
  []
)

const handleSearchChange = (value: string) => {
  setSearchTerm(value)  // Immediate UI update
  updateSearch(value)   // Debounced filter
}
```

## Impact

- Typing feels sluggish with large datasets
- Unnecessary CPU usage during search
- Poor UX for power users with many recordings

## Acceptance Criteria

- [ ] Search debounced (200-300ms delay)
- [ ] Input value updates immediately (no typing lag)
- [ ] Filtering runs after debounce delay
- [ ] Performance verified with 5000+ items
