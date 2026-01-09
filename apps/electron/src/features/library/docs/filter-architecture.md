# Library Filter Architecture

## Overview

The Library feature uses a layered hook architecture for filter state management, combining Zustand for persistence with React hooks for derived state and performance optimization.

## Architecture Layers

### Layer 1: State Store (`useLibraryStore`)

**File:** `apps/electron/src/store/useLibraryStore.ts`

**Purpose:** Central source of truth for all Library state including filters

**Responsibilities:**
- Stores filter state (location, category, quality, status, search query)
- Provides filter actions (setters and clearFilters)
- Persists filters across app restarts using Zustand persist middleware
- Manages other Library state (view mode, sorting, selection, etc.)

**Filter State:**
```typescript
interface LibraryState {
  locationFilter: LocationFilter      // 'all' | 'device' | 'local' | 'cloud'
  categoryFilter: string | null       // e.g., 'meeting', 'interview', etc.
  qualityFilter: string | null        // e.g., 'valuable', 'normal', 'low'
  statusFilter: string | null         // e.g., 'ready', 'processing', 'error'
  searchQuery: string                 // Text search query
}
```

**Filter Actions:**
```typescript
interface LibraryActions {
  setLocationFilter: (filter: LocationFilter) => void
  setCategoryFilter: (filter: string | null) => void
  setQualityFilter: (filter: string | null) => void
  setStatusFilter: (filter: string | null) => void
  setSearchQuery: (query: string) => void
  clearFilters: () => void
}
```

**Persistence:**
- Filters are persisted to localStorage via Zustand persist middleware
- Search query is intentionally NOT persisted (starts fresh each session)
- Store name: `hidock-library-store`

### Layer 2: Filter Manager (`useLibraryFilterManager`)

**File:** `apps/electron/src/features/library/hooks/useLibraryFilterManager.ts`

**Purpose:** Provides filter state + actions + derived values in a cohesive interface

**Responsibilities:**
- Subscribes to filter state from `useLibraryStore` using granular selectors
- Subscribes to filter actions from `useLibraryStore`
- Computes derived filter state (`hasActiveFilters`, `activeFilterCount`)
- Memoizes derived state to prevent unnecessary recalculations
- Provides unified interface for filter management

**Derived State:**
```typescript
{
  hasActiveFilters: boolean      // true if any filter is active
  activeFilterCount: number      // count of active filters (0-5)
}
```

**Active Filter Rules:**
- `locationFilter !== 'all'` → counts as active
- `categoryFilter !== null` → counts as active
- `qualityFilter !== null` → counts as active
- `statusFilter !== null` → counts as active
- `searchQuery.trim() !== ''` → counts as active (ignores whitespace-only)

**Performance:**
- Uses granular Zustand selectors to minimize re-renders
- Uses `useMemo` for derived state computation
- Only recomputes when filter values change

**Example Usage:**
```typescript
const {
  // State
  locationFilter,
  categoryFilter,
  searchQuery,

  // Derived
  hasActiveFilters,
  activeFilterCount,

  // Actions
  setLocationFilter,
  clearFilters
} = useLibraryFilterManager()
```

### Layer 3: Transition Wrapper (`useTransitionFilters`)

**File:** `apps/electron/src/features/library/hooks/useTransitionFilters.ts`

**Purpose:** Wraps filter updates in React transitions to prevent UI blocking

**Responsibilities:**
- Delegates to `useLibraryFilterManager` for state and actions
- Wraps all filter setters in `startTransition` for non-blocking updates
- Provides `isPending` state to indicate ongoing transitions
- Uses `useCallback` to maintain stable action references

**When to Use:**
- Large datasets (5000+ recordings)
- Expensive filtering operations
- UI components that need to stay responsive during filter changes

**Transition Behavior:**
- Filter updates are queued as low-priority transitions
- UI remains responsive during filtering
- `isPending` is true while transition is in progress
- State reads are NOT wrapped (read directly from filter manager)

**Example Usage:**
```typescript
const {
  // State (passed through from useLibraryFilterManager)
  locationFilter,
  hasActiveFilters,

  // Transition state
  isPending,

  // Actions (wrapped in startTransition)
  setLocationFilter,
  clearFilters
} = useTransitionFilters()

// Show loading indicator during transitions
{isPending && <Spinner />}
```

## Hook Selection Guide

### When to Use `useLibraryStore` Directly

**Use Case:** Need access to non-filter state or multiple state slices

```typescript
// Access multiple state areas
const viewMode = useLibraryStore(state => state.viewMode)
const locationFilter = useLibraryStore(state => state.locationFilter)
const setViewMode = useLibraryStore(state => state.setViewMode)
```

**Pros:**
- Maximum flexibility
- Access to all store state and actions
- Fine-grained performance control with custom selectors

**Cons:**
- More verbose
- Must manually create selectors
- No derived filter state

### When to Use `useLibraryFilterManager`

**Use Case:** Need filter state, actions, and derived values together

```typescript
// Filter panel component
function FilterPanel() {
  const {
    categoryFilter,
    setCategoryFilter,
    hasActiveFilters,
    clearFilters
  } = useLibraryFilterManager()

  return (
    <>
      <CategorySelect value={categoryFilter} onChange={setCategoryFilter} />
      {hasActiveFilters && <Button onClick={clearFilters}>Clear</Button>}
    </>
  )
}
```

**Pros:**
- Clean, cohesive API
- Includes derived state (hasActiveFilters, activeFilterCount)
- Optimized selectors for performance
- Less boilerplate

**Cons:**
- Filter-specific (doesn't include sorting, view mode, etc.)
- Not wrapped in transitions (may block UI on large datasets)

### When to Use `useTransitionFilters`

**Use Case:** Large datasets where filter updates might block the UI

```typescript
// Main library view with 5000+ recordings
function Library() {
  const {
    locationFilter,
    setLocationFilter,
    isPending
  } = useTransitionFilters()

  // Filter changes won't block UI
  // isPending indicates transition in progress
}
```

**Pros:**
- Non-blocking filter updates
- UI stays responsive during expensive operations
- Provides `isPending` for loading indicators
- Same interface as `useLibraryFilterManager`

**Cons:**
- Slight delay before filter updates take effect
- Adds complexity for small datasets where it's unnecessary

## Data Flow

```
User Action (e.g., click filter button)
    ↓
useTransitionFilters action (wrapped in startTransition)
    ↓
useLibraryFilterManager action (passes through)
    ↓
useLibraryStore setter (updates Zustand state)
    ↓
Zustand persist middleware (saves to localStorage)
    ↓
Store subscribers notified (Zustand selectors)
    ↓
useLibraryFilterManager selectors update
    ↓
useTransitionFilters receives updated state
    ↓
Component re-renders with new filter state
    ↓
RecordingList applies filters to data
```

## Persistence Behavior

### What Gets Persisted

Filters persist across app restarts in localStorage:
- `locationFilter`
- `categoryFilter`
- `qualityFilter`
- `statusFilter`

### What Doesn't Get Persisted

These reset to defaults on app restart:
- `searchQuery` - Intentionally reset for fresh start
- Selection state - Transient per session
- Scroll position - Transient per session

### Persistence Key

- Storage: `localStorage`
- Key: `hidock-library-store`
- Format: JSON (via `createJSONStorage`)

## Testing

### Test Files

1. **`useLibraryFilterManager.test.ts`**
   - Initial state
   - Filter state reflection from store
   - Derived state computation
   - Filter actions
   - Memoization
   - Edge cases (null, empty strings, whitespace)

2. **`useTransitionFilters.test.ts`**
   - Filter state passthrough
   - Transition state (isPending)
   - Wrapped actions
   - Action memoization
   - Rapid consecutive updates
   - Integration with useLibraryFilterManager

### Running Tests

```bash
cd apps/electron

# Run all tests
npm test

# Run filter tests specifically
npm test -- hooks/__tests__/useLibraryFilterManager.test.ts
npm test -- hooks/__tests__/useTransitionFilters.test.ts

# Run with UI
npm run test:ui
```

## Common Patterns

### Clearing a Single Filter

```typescript
const { setCategoryFilter } = useLibraryFilterManager()

// Clear by setting to null
setCategoryFilter(null)
```

### Clearing All Filters

```typescript
const { clearFilters } = useLibraryFilterManager()

// Resets all filters to defaults
clearFilters()
```

### Checking for Active Filters

```typescript
const { hasActiveFilters, activeFilterCount } = useLibraryFilterManager()

if (hasActiveFilters) {
  console.log(`${activeFilterCount} filters active`)
}
```

### Showing Loading During Transitions

```typescript
const { isPending, setSearchQuery } = useTransitionFilters()

return (
  <>
    <SearchInput onChange={setSearchQuery} disabled={isPending} />
    {isPending && <LoadingSpinner />}
  </>
)
```

## Migration Notes

### Legacy Code (Before Filter Refactor)

**Old Pattern:**
```typescript
// Component-local state (not persisted, duplicated)
const [filters, setFilters] = useState({
  location: 'all',
  category: null,
  search: ''
})
```

**New Pattern:**
```typescript
// Global store state (persisted, single source of truth)
const { locationFilter, categoryFilter, searchQuery } = useTransitionFilters()
```

### Benefits of New Architecture

1. **Single Source of Truth:** Filters stored in one place (Zustand store)
2. **Persistence:** Filters survive page navigation and app restarts
3. **Performance:** Granular selectors and transitions prevent UI blocking
4. **Testability:** Hooks are unit-testable with mocked stores
5. **Derived State:** `hasActiveFilters` and `activeFilterCount` computed automatically
6. **Type Safety:** Full TypeScript support with proper types

## Future Enhancements

Potential improvements to consider:

1. **Filter Presets:** Save/load named filter combinations
2. **Filter History:** Undo/redo filter changes
3. **Advanced Filters:** Date ranges, duration ranges, quality thresholds
4. **Filter Sharing:** URL-based filter state for sharing
5. **Filter Analytics:** Track which filters are used most

## Related Files

- `apps/electron/src/store/useLibraryStore.ts` - Core store
- `apps/electron/src/features/library/hooks/useLibraryFilterManager.ts` - Filter manager hook
- `apps/electron/src/features/library/hooks/useTransitionFilters.ts` - Transition wrapper
- `apps/electron/src/features/library/components/Library.tsx` - Main consumer
- `apps/electron/src/types/unified-recording.ts` - Type definitions
