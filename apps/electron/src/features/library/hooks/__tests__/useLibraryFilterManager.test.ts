import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useLibraryFilterManager } from '../useLibraryFilterManager'
import { useLibraryStore } from '@/store/useLibraryStore'

// Mock the store
vi.mock('@/store/useLibraryStore', () => ({
  useLibraryStore: vi.fn()
}))

describe('useLibraryFilterManager', () => {
  let storeState: any
  let storeActions: any

  beforeEach(() => {
    vi.clearAllMocks()

    // Setup mock store state
    storeState = {
      locationFilter: 'all' as const,
      categoryFilter: null,
      qualityFilter: null,
      statusFilter: null,
      searchQuery: ''
    }

    // Setup mock store actions
    storeActions = {
      setLocationFilter: vi.fn((filter) => {
        storeState.locationFilter = filter
      }),
      setCategoryFilter: vi.fn((filter) => {
        storeState.categoryFilter = filter
      }),
      setQualityFilter: vi.fn((filter) => {
        storeState.qualityFilter = filter
      }),
      setStatusFilter: vi.fn((filter) => {
        storeState.statusFilter = filter
      }),
      setSearchQuery: vi.fn((query) => {
        storeState.searchQuery = query
      }),
      clearFilters: vi.fn(() => {
        storeState.locationFilter = 'all'
        storeState.categoryFilter = null
        storeState.qualityFilter = null
        storeState.statusFilter = null
        storeState.searchQuery = ''
      })
    }

    // Mock useLibraryStore implementation
    // @ts-ignore
    useLibraryStore.mockImplementation((selector) => {
      const fullState = { ...storeState, ...storeActions }
      return selector(fullState)
    })
  })

  describe('initial state', () => {
    it('should return default filter state', () => {
      const { result } = renderHook(() => useLibraryFilterManager())

      expect(result.current.locationFilter).toBe('all')
      expect(result.current.categoryFilter).toBeNull()
      expect(result.current.qualityFilter).toBeNull()
      expect(result.current.statusFilter).toBeNull()
      expect(result.current.searchQuery).toBe('')
    })

    it('should indicate no active filters initially', () => {
      const { result } = renderHook(() => useLibraryFilterManager())

      expect(result.current.hasActiveFilters).toBe(false)
      expect(result.current.activeFilterCount).toBe(0)
    })
  })

  describe('filter state', () => {
    it('should reflect filter changes from store', () => {
      storeState.locationFilter = 'device'
      storeState.categoryFilter = 'meeting'
      storeState.searchQuery = 'test query'

      const { result } = renderHook(() => useLibraryFilterManager())

      expect(result.current.locationFilter).toBe('device')
      expect(result.current.categoryFilter).toBe('meeting')
      expect(result.current.searchQuery).toBe('test query')
    })
  })

  describe('derived state', () => {
    it('should count location filter as active when not "all"', () => {
      storeState.locationFilter = 'device'

      const { result } = renderHook(() => useLibraryFilterManager())

      expect(result.current.hasActiveFilters).toBe(true)
      expect(result.current.activeFilterCount).toBe(1)
    })

    it('should count category filter as active when set', () => {
      storeState.categoryFilter = 'meeting'

      const { result } = renderHook(() => useLibraryFilterManager())

      expect(result.current.hasActiveFilters).toBe(true)
      expect(result.current.activeFilterCount).toBe(1)
    })

    it('should count quality filter as active when set', () => {
      storeState.qualityFilter = 'valuable'

      const { result } = renderHook(() => useLibraryFilterManager())

      expect(result.current.hasActiveFilters).toBe(true)
      expect(result.current.activeFilterCount).toBe(1)
    })

    it('should count status filter as active when set', () => {
      storeState.statusFilter = 'ready'

      const { result } = renderHook(() => useLibraryFilterManager())

      expect(result.current.hasActiveFilters).toBe(true)
      expect(result.current.activeFilterCount).toBe(1)
    })

    it('should count search query as active when not empty', () => {
      storeState.searchQuery = 'test'

      const { result } = renderHook(() => useLibraryFilterManager())

      expect(result.current.hasActiveFilters).toBe(true)
      expect(result.current.activeFilterCount).toBe(1)
    })

    it('should not count search query with only whitespace as active', () => {
      storeState.searchQuery = '   '

      const { result } = renderHook(() => useLibraryFilterManager())

      expect(result.current.hasActiveFilters).toBe(false)
      expect(result.current.activeFilterCount).toBe(0)
    })

    it('should count multiple active filters correctly', () => {
      storeState.locationFilter = 'device'
      storeState.categoryFilter = 'meeting'
      storeState.qualityFilter = 'valuable'
      storeState.searchQuery = 'test'

      const { result } = renderHook(() => useLibraryFilterManager())

      expect(result.current.hasActiveFilters).toBe(true)
      expect(result.current.activeFilterCount).toBe(4)
    })

    it('should count all filters when all are active', () => {
      storeState.locationFilter = 'device'
      storeState.categoryFilter = 'meeting'
      storeState.qualityFilter = 'valuable'
      storeState.statusFilter = 'ready'
      storeState.searchQuery = 'test'

      const { result } = renderHook(() => useLibraryFilterManager())

      expect(result.current.hasActiveFilters).toBe(true)
      expect(result.current.activeFilterCount).toBe(5)
    })
  })

  describe('filter actions', () => {
    it('should provide setLocationFilter action', () => {
      const { result } = renderHook(() => useLibraryFilterManager())

      act(() => {
        result.current.setLocationFilter('device')
      })

      expect(storeActions.setLocationFilter).toHaveBeenCalledWith('device')
    })

    it('should provide setCategoryFilter action', () => {
      const { result } = renderHook(() => useLibraryFilterManager())

      act(() => {
        result.current.setCategoryFilter('meeting')
      })

      expect(storeActions.setCategoryFilter).toHaveBeenCalledWith('meeting')
    })

    it('should provide setQualityFilter action', () => {
      const { result } = renderHook(() => useLibraryFilterManager())

      act(() => {
        result.current.setQualityFilter('valuable')
      })

      expect(storeActions.setQualityFilter).toHaveBeenCalledWith('valuable')
    })

    it('should provide setStatusFilter action', () => {
      const { result } = renderHook(() => useLibraryFilterManager())

      act(() => {
        result.current.setStatusFilter('ready')
      })

      expect(storeActions.setStatusFilter).toHaveBeenCalledWith('ready')
    })

    it('should provide setSearchQuery action', () => {
      const { result } = renderHook(() => useLibraryFilterManager())

      act(() => {
        result.current.setSearchQuery('test query')
      })

      expect(storeActions.setSearchQuery).toHaveBeenCalledWith('test query')
    })

    it('should provide clearFilters action', () => {
      const { result } = renderHook(() => useLibraryFilterManager())

      act(() => {
        result.current.clearFilters()
      })

      expect(storeActions.clearFilters).toHaveBeenCalled()
    })
  })

  describe('memoization', () => {
    it('should memoize derived state based on filter values', () => {
      const { result, rerender } = renderHook(() => useLibraryFilterManager())

      const firstHasActiveFilters = result.current.hasActiveFilters
      const firstActiveFilterCount = result.current.activeFilterCount

      // Rerender without changing filter state
      rerender()

      expect(result.current.hasActiveFilters).toBe(firstHasActiveFilters)
      expect(result.current.activeFilterCount).toBe(firstActiveFilterCount)
    })

    it('should recompute derived state when filters change', () => {
      const { result, rerender } = renderHook(() => useLibraryFilterManager())

      expect(result.current.activeFilterCount).toBe(0)

      // Change filter state
      storeState.locationFilter = 'device'
      rerender()

      expect(result.current.activeFilterCount).toBe(1)
    })
  })

  describe('edge cases', () => {
    it('should handle null filter values', () => {
      storeState.categoryFilter = null
      storeState.qualityFilter = null
      storeState.statusFilter = null

      const { result } = renderHook(() => useLibraryFilterManager())

      expect(result.current.categoryFilter).toBeNull()
      expect(result.current.qualityFilter).toBeNull()
      expect(result.current.statusFilter).toBeNull()
      expect(result.current.activeFilterCount).toBe(0)
    })

    it('should handle empty string search query', () => {
      storeState.searchQuery = ''

      const { result } = renderHook(() => useLibraryFilterManager())

      expect(result.current.searchQuery).toBe('')
      expect(result.current.hasActiveFilters).toBe(false)
    })

    it('should handle clearing filters from active state', () => {
      storeState.locationFilter = 'device'
      storeState.categoryFilter = 'meeting'
      storeState.searchQuery = 'test'

      const { result, rerender } = renderHook(() => useLibraryFilterManager())

      expect(result.current.activeFilterCount).toBe(3)

      // Clear filters
      storeState.locationFilter = 'all'
      storeState.categoryFilter = null
      storeState.searchQuery = ''
      rerender()

      expect(result.current.activeFilterCount).toBe(0)
      expect(result.current.hasActiveFilters).toBe(false)
    })
  })
})
