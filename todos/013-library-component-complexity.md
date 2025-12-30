---
id: "013"
title: "Reduce Library.tsx complexity"
status: pending
priority: P2
category: architecture
source: architecture-strategist, code-simplicity-reviewer
created: 2025-12-30
files:
  - apps/electron/src/pages/Library.tsx
---

# Reduce Library.tsx complexity

## Problem

`Library.tsx` is 705 lines with 10+ responsibilities:
- Data fetching
- Filtering logic
- Selection management
- Keyboard navigation
- View mode switching
- Detail drawer management
- Connection error handling
- Loading states
- Empty states
- Grid/list rendering

## Current Metrics

- Lines: 705
- useState calls: 12+
- useEffect calls: 5+
- Event handlers: 15+
- Responsibilities: 10+

## Suggested Refactoring

### Extract Custom Hooks

```typescript
// useLibraryData.ts - Data fetching
const { sources, isLoading, error, refresh } = useLibraryData()

// useLibrarySelection.ts - Selection logic
const { selectedIds, toggle, selectAll, clear } = useLibrarySelection()

// useLibraryFilters.ts - Filter state
const { filters, setFilter, filteredSources } = useLibraryFilters(sources)
```

### Extract Components

```typescript
// LibraryToolbar.tsx - Search, filters, view toggle
<LibraryToolbar
  filters={filters}
  onFilterChange={setFilter}
  viewMode={viewMode}
  onViewModeChange={setViewMode}
/>

// LibraryContent.tsx - Grid/list rendering
<LibraryContent
  sources={filteredSources}
  viewMode={viewMode}
  selectedIds={selectedIds}
  onSelect={toggle}
/>

// LibraryEmptyState.tsx
<LibraryEmptyState type={emptyType} />
```

### Target Structure

```
Library.tsx (~200 lines)
├── LibraryToolbar.tsx (~100 lines)
├── LibraryContent.tsx (~150 lines)
├── LibraryEmptyState.tsx (~50 lines)
└── hooks/
    ├── useLibraryData.ts
    ├── useLibrarySelection.ts
    └── useLibraryFilters.ts
```

## Impact

- Hard to find relevant code
- High cognitive load for changes
- Difficult to test individual features
- Risk of unintended side effects

## Acceptance Criteria

- [ ] Library.tsx under 300 lines
- [ ] No more than 5 useState calls in main component
- [ ] Each extracted hook has tests
- [ ] Each extracted component is focused
- [ ] No functional changes (refactor only)
