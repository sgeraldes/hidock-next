---
id: "007"
title: "Consolidate duplicate stores"
status: pending
priority: P1
category: architecture
source: architecture-strategist, pattern-recognition
created: 2025-12-30
files:
  - apps/electron/src/store/useLibraryStore.ts
  - apps/electron/src/store/ui/useLibraryUIStore.ts
---

# Consolidate duplicate stores

## Problem

Two stores manage similar Library state:
- `useLibraryStore` - Main library state
- `useLibraryUIStore` - UI state (viewMode, filters, selectedIds)

Both have overlapping concerns (selectedIds, filters, viewMode), causing confusion about source of truth.

## Current State

```typescript
// useLibraryStore.ts
interface LibraryState {
  selectedIds: Set<string>
  viewMode: 'grid' | 'list'
  filters: LibraryFilters
  // ...
}

// useLibraryUIStore.ts
interface LibraryUIState {
  viewMode: 'grid' | 'list'
  selectedIds: Set<string>
  searchTerm: string
  // ...
}
```

## Suggested Fix

### Option A: Single Store with Slices
```typescript
// useLibraryStore.ts
interface LibraryState {
  // Data
  sources: Source[]
  isLoading: boolean
  error: string | null

  // UI
  viewMode: 'grid' | 'list'
  selectedIds: Set<string>
  filters: LibraryFilters
  searchTerm: string

  // Actions
  setViewMode: (mode: 'grid' | 'list') => void
  toggleSelection: (id: string) => void
  // ...
}
```

### Option B: Clear Separation
- `useLibraryDataStore` - Server data only (sources, loading, error)
- `useLibraryUIStore` - UI state only (viewMode, selection, filters)

No overlap between stores.

## Impact

- Developers unsure which store to use
- Potential state synchronization bugs
- Larger bundle from duplicate code

## Acceptance Criteria

- [ ] Decide on single-store or clear-separation approach
- [ ] Migrate all usages to consolidated pattern
- [ ] Delete redundant store
- [ ] Update tests
- [ ] Document store architecture
