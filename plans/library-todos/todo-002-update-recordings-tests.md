# TODO-002: Update or Remove Recordings Tests

## Status: PENDING

## Phase: 1 (Foundation)

## Priority: HIGH

## Summary
Transform the test file from testing old `Recordings.tsx` to testing new `Library.tsx` component. The existing test patterns and mocks provide a foundation to build upon.

## Problem
- Test file exists at `apps/electron/src/pages/__tests__/Recordings.test.tsx`
- Tests reference the old Recordings component
- Need to update tests for Library component

## Decision: UPDATE (Not Delete)

The test file should be **updated** (renamed and rewritten), not deleted because:
- Tests provide regression protection for core functionality
- The existing mock patterns are reusable
- Test structure follows project conventions

## Acceptance Criteria
- [ ] Test file renamed to `Library.test.tsx`
- [ ] Tests import and test `Library` component
- [ ] All existing test functionality preserved
- [ ] New tests added for Library-specific features
- [ ] All tests pass

---

## Analysis: Current vs New Component

| Feature | Recordings.tsx (old) | Library.tsx (new) |
|---------|---------------------|-------------------|
| Lines | ~700+ | ~768 |
| Components | Inline rendering | Uses feature components from `@/features/library/components` |
| Selection | None | Full selection with `useSourceSelection` hook |
| Bulk Actions | Basic | Dedicated `BulkActionsBar` component |
| Keyboard Nav | None | `useKeyboardNavigation` hook |
| Accessibility | Minimal | `LiveRegion` for announcements |
| Device Disconnect | None | `DeviceDisconnectBanner` component |
| State Management | Local | Uses `useLibraryStore` |

---

## Detailed Implementation Steps

### Step 1: Analyze Current Tests

Current `Recordings.test.tsx` tests:
- Imports: `Recordings` from `../Recordings`
- Mocks: `useUnifiedRecordings`, `useAudioControls`, `useUIStore`, `useAppStore`, `@tanstack/react-virtual`, `electronAPI`
- Test cases: Verifies knowledge capture fields (`title`, `quality`) displayed

### Step 2: Rename Test File

```bash
cd G:\Code\hidock-next\apps\electron\src\pages\__tests__

# Rename the file
mv Recordings.test.tsx Library.test.tsx
```

### Step 3: Update Test File

Replace the contents of `Library.test.tsx`:

```typescript
import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { Library } from '../Library'

// Mock hooks
vi.mock('@/hooks/useUnifiedRecordings', () => ({
  useUnifiedRecordings: vi.fn()
}))

vi.mock('@/store/useUIStore', () => ({
  useUIStore: vi.fn(() => ({
    currentlyPlayingId: null,
    setCurrentlyPlayingId: vi.fn()
  }))
}))

vi.mock('@/store/useAppStore', () => ({
  useAppStore: vi.fn(() => ({
    isConnected: false,
    deviceInfo: null
  }))
}))

vi.mock('@/store/useLibraryStore', () => ({
  useLibraryStore: vi.fn((selector) => {
    const state = {
      viewMode: 'compact',
      sortBy: 'date',
      sortOrder: 'desc',
      locationFilter: 'all',
      categoryFilter: null,
      qualityFilter: null,
      statusFilter: null,
      searchQuery: '',
      selectedIds: new Set(),
      scrollOffset: 0,
      setViewMode: vi.fn(),
      toggleViewMode: vi.fn(),
      clearSelection: vi.fn()
    }
    return typeof selector === 'function' ? selector(state) : state
  }),
  useLibraryViewMode: vi.fn(() => 'compact'),
  useLibraryFilters: vi.fn(() => ({
    locationFilter: 'all',
    categoryFilter: null,
    qualityFilter: null,
    statusFilter: null,
    searchQuery: ''
  })),
  useLibrarySelection: vi.fn(() => new Set())
}))

vi.mock('@/components/OperationController', () => ({
  useAudioControls: vi.fn(() => ({
    play: vi.fn(),
    pause: vi.fn(),
    isPlaying: false
  }))
}))

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: () => ({
    getVirtualItems: () => [],
    getTotalSize: () => 0,
    scrollToIndex: vi.fn()
  })
}))

vi.mock('@/lib/ipc-client', () => ({
  electronAPI: {
    invoke: vi.fn(),
    on: vi.fn(() => vi.fn()),
    openExternal: vi.fn()
  }
}))

import { useUnifiedRecordings } from '@/hooks/useUnifiedRecordings'

const mockRecording = {
  id: 'test-123',
  displayTitle: 'Test Recording',
  quality: 'high',
  duration: 120,
  recordedAt: new Date().toISOString(),
  location: 'local-only',
  isProcessed: false,
  isProcessing: false,
  hasTranscript: false
}

describe('Library', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useUnifiedRecordings).mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
      refetch: vi.fn()
    })
  })

  const renderLibrary = () => {
    return render(
      <MemoryRouter>
        <Library />
      </MemoryRouter>
    )
  }

  describe('Loading State', () => {
    it('renders loading state initially', () => {
      vi.mocked(useUnifiedRecordings).mockReturnValue({
        data: [],
        isLoading: true,
        error: null,
        refetch: vi.fn()
      })

      renderLibrary()
      // Library shows skeleton or loading indicator
      expect(screen.getByRole('main')).toBeInTheDocument()
    })
  })

  describe('Empty State', () => {
    it('shows empty state when no recordings exist', () => {
      vi.mocked(useUnifiedRecordings).mockReturnValue({
        data: [],
        isLoading: false,
        error: null,
        refetch: vi.fn()
      })

      renderLibrary()
      expect(screen.getByText(/no knowledge captured/i)).toBeInTheDocument()
    })
  })

  describe('Recording Display', () => {
    it('displays knowledge capture fields when recordings exist', async () => {
      vi.mocked(useUnifiedRecordings).mockReturnValue({
        data: [mockRecording],
        isLoading: false,
        error: null,
        refetch: vi.fn()
      })

      renderLibrary()

      await waitFor(() => {
        expect(screen.getByText('Test Recording')).toBeInTheDocument()
      })
    })
  })

  describe('View Mode Toggle', () => {
    it('renders view mode toggle buttons', () => {
      renderLibrary()
      // Compact and Card view buttons should be present
      expect(screen.getByRole('button', { name: /compact/i })).toBeInTheDocument()
    })
  })

  describe('Filters', () => {
    it('renders filter controls', () => {
      renderLibrary()
      // Search input should be present
      expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument()
    })
  })
})
```

### Step 4: Run Tests

```bash
cd G:\Code\hidock-next\apps\electron

# Run the specific test file
npm run test -- --run src/pages/__tests__/Library.test.tsx

# Run all tests to verify no regressions
npm run test -- --run
```

### Step 5: Commit Changes

```bash
cd G:\Code\hidock-next

git add apps/electron/src/pages/__tests__/Library.test.tsx
git add -A  # Include any deleted Recordings.test.tsx

git commit -m "test(library): rename and update tests from Recordings to Library

- Renamed Recordings.test.tsx to Library.test.tsx
- Updated imports to use Library component
- Added mock for useLibraryStore
- Added tests for empty state, view toggle, filters
- Maintains existing test patterns and conventions

Part of library phase 1 cleanup."
```

---

## New Test Cases Needed

### Required Tests
1. **Loading state** - Shows loading indicator during data fetch
2. **Empty state** - Shows appropriate message when no recordings
3. **Recording display** - Displays recording fields (title, quality, duration)
4. **View mode toggle** - Compact/Card view switching works
5. **Filter rendering** - Filter controls are present

### Optional Tests (Phase 2+)
- Selection behavior
- Bulk actions visibility
- Keyboard navigation
- Device disconnect banner
- Accessibility (ARIA attributes)

---

## Rollback Plan

```bash
cd G:\Code\hidock-next

# Restore original file
git checkout HEAD -- apps/electron/src/pages/__tests__/Recordings.test.tsx
```

---

## Post-Completion Checklist

- [ ] Test file renamed to `Library.test.tsx`
- [ ] All imports updated to use Library
- [ ] Mocks updated for new dependencies
- [ ] Tests pass
- [ ] Commit created with descriptive message
- [ ] TODO-002 status updated to COMPLETED
