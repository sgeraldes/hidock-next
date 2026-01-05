---
id: "017"
title: "Remove filter state duplication in Library.tsx"
status: pending
priority: P2
category: tech-debt
source: typescript-reviewer
created: 2025-12-30
files:
  - apps/electron/src/pages/Library.tsx
  - apps/electron/src/store/useLibraryStore.ts
---

# Remove filter state duplication in Library.tsx

## Problem

Filter state exists in two places:
1. Local component state in `Library.tsx`
2. Global store in `useLibraryStore.ts`

This creates confusion about source of truth and potential sync issues.

## Current Code

```typescript
// Library.tsx - Local state
const [searchTerm, setSearchTerm] = useState('')
const [typeFilter, setTypeFilter] = useState<string>('all')
const [dateFilter, setDateFilter] = useState<DateRange | null>(null)

// useLibraryStore.ts - Global state
interface LibraryState {
  filters: {
    search: string
    type: string
    dateRange: DateRange | null
  }
}
```

## Suggested Fix

Use only the store for filter state:

```typescript
// Library.tsx
const { filters, setFilters } = useLibraryStore()

// No local filter state
// const [searchTerm, setSearchTerm] = useState('') // REMOVE

const handleSearchChange = (value: string) => {
  setFilters({ ...filters, search: value })
}
```

Or use only local state and remove from store:

```typescript
// useLibraryStore.ts
interface LibraryState {
  // Remove filters from here
  selectedIds: Set<string>
  viewMode: 'grid' | 'list'
}

// Library.tsx
const [filters, setFilters] = useState<LibraryFilters>(defaultFilters)
```

## Impact

- Unclear which state to read/update
- Potential sync bugs
- Confusing for new developers

## Acceptance Criteria

- [ ] Single source of truth for filters
- [ ] Remove duplicate state
- [ ] Document where filter state lives
- [ ] Update all usages
