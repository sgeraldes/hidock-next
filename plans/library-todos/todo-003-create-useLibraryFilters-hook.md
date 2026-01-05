# TODO-003: Create useLibraryFilters Hook File

## Status: PENDING

## Phase: 1 (Foundation)

## Priority: MEDIUM (Reclassified after analysis)

## Summary
Create a dedicated `useLibraryFilters.ts` hook file in the features/library/hooks directory. This hook wraps the Zustand store selectors and provides both filter state AND filter actions in a cohesive interface.

## ⚠️ CRITICAL: Namespace Collision Resolution

**ISSUE**: A `useLibraryFilters` hook ALREADY EXISTS in `store/useLibraryStore.ts` (lines 166-173).

**DECISION**: Keep store selector as `useLibraryFilters` (state-only), name new hook `useLibraryFilterManager` (state + actions + derived).

**Rationale**:
- Store selector is lightweight and useful for read-only consumers
- New hook provides full management interface following `useSourceSelection` pattern
- No breaking changes to existing code

## Recommendation: **Option A - Create Wrapper Hook with Different Name**

### Justification

1. **Consistency with plan**: The implementation plan calls for a dedicated hook in the hooks directory
2. **Pattern conformance**: The `useSourceSelection.ts` hook demonstrates the project pattern - hooks that provide complete interfaces (state + actions + derived values)
3. **No breaking changes**: Existing `useLibraryFilters` consumers continue working
4. **Enhanced functionality**: New hook provides:
   - All filter state (from store)
   - All filter actions (from store)
   - Derived state like `hasActiveFilters`
   - Stable callback references via `useCallback`

## Current Implementation

```typescript
// In store/useLibraryStore.ts (lines 166-173) - KEEP THIS
export const useLibraryFilters = () =>
  useLibraryStore((state) => ({
    locationFilter: state.locationFilter,
    categoryFilter: state.categoryFilter,
    qualityFilter: state.qualityFilter,
    statusFilter: state.statusFilter,
    searchQuery: state.searchQuery
  }))
```

**Problem**: This only returns state, not actions. Components must separately import actions.

## Acceptance Criteria
- [ ] Hook file created at `features/library/hooks/useLibraryFilters.ts`
- [ ] Hook provides all filter state
- [ ] Hook provides all filter actions
- [ ] Hook provides derived state (`hasActiveFilters`, `activeFilterCount`)
- [ ] Hook follows `useSourceSelection.ts` pattern
- [ ] Index file exports hook

---

## Complete Implementation

### File: `apps/electron/src/features/library/hooks/useLibraryFilterManager.ts`

```typescript
/**
 * useLibraryFilterManager Hook
 *
 * Provides filter state and actions for the Library view.
 * Wraps the useLibraryStore to provide a cohesive filter management interface.
 *
 * NOTE: This is different from useLibraryFilters in the store which only provides state.
 * This hook provides state + actions + derived values following the useSourceSelection pattern.
 */

import { useMemo } from 'react'
import { useLibraryStore } from '@/store/useLibraryStore'
import { LocationFilter } from '@/types/unified-recording'

interface UseLibraryFilterManagerResult {
  // State
  locationFilter: LocationFilter
  categoryFilter: string | null
  qualityFilter: string | null
  statusFilter: string | null
  searchQuery: string

  // Derived state
  hasActiveFilters: boolean
  activeFilterCount: number

  // Actions
  setLocationFilter: (filter: LocationFilter) => void
  setCategoryFilter: (filter: string) => void
  setQualityFilter: (filter: string) => void
  setStatusFilter: (filter: string) => void
  setSearchQuery: (query: string) => void
  clearFilters: () => void
}

/**
 * Custom hook for managing Library filter state.
 *
 * Provides both filter state and actions from the Zustand store,
 * along with derived values for filter status.
 */
export function useLibraryFilterManager(): UseLibraryFilterManagerResult {
  // Get filter state from store
  const locationFilter = useLibraryStore((state) => state.locationFilter)
  const categoryFilter = useLibraryStore((state) => state.categoryFilter)
  const qualityFilter = useLibraryStore((state) => state.qualityFilter)
  const statusFilter = useLibraryStore((state) => state.statusFilter)
  const searchQuery = useLibraryStore((state) => state.searchQuery)

  // Get filter actions from store
  const setLocationFilter = useLibraryStore((state) => state.setLocationFilter)
  const setCategoryFilter = useLibraryStore((state) => state.setCategoryFilter)
  const setQualityFilter = useLibraryStore((state) => state.setQualityFilter)
  const setStatusFilter = useLibraryStore((state) => state.setStatusFilter)
  const setSearchQuery = useLibraryStore((state) => state.setSearchQuery)
  const clearFilters = useLibraryStore((state) => state.clearFilters)

  // Compute derived state
  const { hasActiveFilters, activeFilterCount } = useMemo(() => {
    let count = 0
    if (locationFilter !== 'all') count++
    if (categoryFilter !== null) count++
    if (qualityFilter !== null) count++
    if (statusFilter !== null) count++
    if (searchQuery.trim() !== '') count++

    return {
      hasActiveFilters: count > 0,
      activeFilterCount: count
    }
  }, [locationFilter, categoryFilter, qualityFilter, statusFilter, searchQuery])

  return {
    // State
    locationFilter,
    categoryFilter,
    qualityFilter,
    statusFilter,
    searchQuery,

    // Derived state
    hasActiveFilters,
    activeFilterCount,

    // Actions
    setLocationFilter,
    setCategoryFilter,
    setQualityFilter,
    setStatusFilter,
    setSearchQuery,
    clearFilters
  }
}
```

### File: `apps/electron/src/features/library/hooks/index.ts` (Updated)

```typescript
export { useSourceSelection } from './useSourceSelection'
export { useKeyboardNavigation } from './useKeyboardNavigation'
export { useLibraryFilterManager } from './useLibraryFilterManager'
```

---

## Detailed Implementation Steps

### Step 1: Create Hook File

```bash
cd G:\Code\hidock-next\apps\electron\src\features\library\hooks
```

Create `useLibraryFilters.ts` with the code above.

### Step 2: Update Index Export

Edit `index.ts` to add the export:

```typescript
export { useSourceSelection } from './useSourceSelection'
export { useKeyboardNavigation } from './useKeyboardNavigation'
export { useLibraryFilters } from './useLibraryFilters'
```

### Step 3: Verify TypeScript

```bash
cd G:\Code\hidock-next\apps\electron

npm run typecheck
```

### Step 4: Run Tests

```bash
npm run test -- --run
```

### Step 5: Commit

```bash
cd G:\Code\hidock-next

git add apps/electron/src/features/library/hooks/useLibraryFilters.ts
git add apps/electron/src/features/library/hooks/index.ts

git commit -m "feat(library): add useLibraryFilters hook with derived state

- Created dedicated useLibraryFilters hook following useSourceSelection pattern
- Provides filter state, actions, and derived values (hasActiveFilters, activeFilterCount)
- Wraps useLibraryStore for cohesive filter management interface
- Added export to hooks index

Part of library phase 1 completion."
```

---

## Architecture Notes

### Why This Approach?

1. **Separation of Concerns**: The Zustand store manages raw state and persistence. The hook provides a consumer-friendly interface with derived values.

2. **Render Optimization**: By selecting individual state slices, React only re-renders when specific filter values change.

3. **Testability**: The hook can be mocked in component tests without mocking the entire store.

4. **Encapsulation**: Future enhancements (URL sync, analytics) can be added without changing consumers.

### Benefits

1. **Immediate**: Consistent architecture with documented plan
2. **Immediate**: Derived state (`hasActiveFilters`) available for UI
3. **Future**: Foundation for migrating `Library.tsx` from local state to store
4. **Future**: Single point for adding filter-related features

---

## Post-Completion Checklist

- [ ] Hook file created at correct location
- [ ] Index exports the hook
- [ ] TypeScript compiles without errors
- [ ] Tests pass
- [ ] Commit created with descriptive message
- [ ] TODO-003 status updated to COMPLETED

---

## Related Issue

**Note**: After this hook is created, `Library.tsx` should be updated in a separate task to use `useLibraryFilters` instead of local `useState`. This will enable filter persistence across navigation.
