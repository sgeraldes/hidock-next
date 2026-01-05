# TODO-004: Migrate Library.tsx Filter State to Store

## Status: PENDING

## Phase: 1 (Foundation) - REQUIRED for completion

## Priority: HIGH

## Summary
Migrate Library.tsx from local useState for filters to useLibraryStore to achieve filter persistence across navigation.

## Problem
- Library.tsx uses local `useState` for all filter state (lines 37-41)
- useLibraryStore already has filter state with persistence
- Filter values reset when navigating away from Library and back
- This violates Phase 1 success criteria: "Filter state persists during navigation"

## Current Implementation (Library.tsx lines 37-41)
```typescript
const [locationFilter, setLocationFilter] = useState<LocationFilter>('all')
const [categoryFilter, setCategoryFilter] = useState<string>('all')
const [qualityFilter, setQualityFilter] = useState<string>('all')
const [statusFilter, setStatusFilter] = useState<string>('all')
const [searchQuery, setSearchQuery] = useState('')
```

## Acceptance Criteria
- [ ] Library.tsx no longer uses local state for filters
- [ ] Filter values persist when navigating away and back
- [ ] Filter reset works correctly (uses store's clearFilters)
- [ ] LibraryFilters component receives actions from store
- [ ] Tests validate filter persistence

## Implementation

### Option A: Direct Store Selectors (Simple)
```typescript
// Library.tsx - Replace local state with store selectors
const locationFilter = useLibraryStore((state) => state.locationFilter)
const categoryFilter = useLibraryStore((state) => state.categoryFilter)
const qualityFilter = useLibraryStore((state) => state.qualityFilter)
const statusFilter = useLibraryStore((state) => state.statusFilter)
const searchQuery = useLibraryStore((state) => state.searchQuery)

const setLocationFilter = useLibraryStore((state) => state.setLocationFilter)
const setCategoryFilter = useLibraryStore((state) => state.setCategoryFilter)
const setQualityFilter = useLibraryStore((state) => state.setQualityFilter)
const setStatusFilter = useLibraryStore((state) => state.setStatusFilter)
const setSearchQuery = useLibraryStore((state) => state.setSearchQuery)
const clearFilters = useLibraryStore((state) => state.clearFilters)
```

### Option B: Use useLibraryFilterManager Hook (If TODO-003 completed first)
```typescript
import { useLibraryFilterManager } from '@/features/library/hooks'

const {
  locationFilter,
  categoryFilter,
  qualityFilter,
  statusFilter,
  searchQuery,
  setLocationFilter,
  setCategoryFilter,
  setQualityFilter,
  setStatusFilter,
  setSearchQuery,
  clearFilters,
  hasActiveFilters,
  activeFilterCount
} = useLibraryFilterManager()
```

## Files to Modify
- `apps/electron/src/pages/Library.tsx` (main changes)
- `apps/electron/src/pages/__tests__/Library.test.tsx` (if exists, update mocks)

## Dependencies
- If using Option B: Depends on TODO-003 (useLibraryFilterManager)
- If using Option A: No dependencies

## Detailed Steps

### Step 1: Add Store Import
```typescript
import { useLibraryStore } from '@/store/useLibraryStore'
```

### Step 2: Replace useState with Store Selectors
Remove lines 37-41 and replace with store selectors (see Option A above)

### Step 3: Update useDeferredValue Usage
```typescript
// Keep the deferred value for performance
const deferredSearchQuery = useDeferredValue(searchQuery)
```

### Step 4: Verify LibraryFilters Props
Ensure LibraryFilters receives the store actions, not local setters.

### Step 5: Test Persistence
```bash
# Start app
npm run dev

# Navigate to Library, set filters
# Navigate to Calendar
# Navigate back to Library
# Verify filters are preserved
```

### Step 6: Run Tests
```bash
npm run test:run
```

### Step 7: Commit
```bash
git add apps/electron/src/pages/Library.tsx
git commit -m "feat(library): migrate filter state to store for persistence

- Replaced local useState with useLibraryStore selectors
- Filter values now persist across navigation
- Meets Phase 1 success criteria for filter persistence"
```

## Rollback Plan
```bash
# Restore previous version
git checkout HEAD~1 -- apps/electron/src/pages/Library.tsx
```

## Post-Completion Checklist
- [ ] All filter state from store, not local
- [ ] Filters persist when navigating away and back
- [ ] Reset filters works
- [ ] Tests pass
- [ ] Commit created
