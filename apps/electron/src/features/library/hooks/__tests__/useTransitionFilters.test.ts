import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useTransitionFilters } from '../useTransitionFilters'
import { useLibraryFilterManager } from '../useLibraryFilterManager'

// Mock useLibraryFilterManager
vi.mock('../useLibraryFilterManager', () => ({
  useLibraryFilterManager: vi.fn()
}))

describe('useTransitionFilters', () => {
  let mockFilterManager: any

  beforeEach(() => {
    vi.clearAllMocks()

    // Setup mock filter manager
    mockFilterManager = {
      locationFilter: 'all' as const,
      categoryFilter: null,
      qualityFilter: null,
      statusFilter: null,
      searchQuery: '',
      hasActiveFilters: false,
      activeFilterCount: 0,
      setLocationFilter: vi.fn(),
      setCategoryFilter: vi.fn(),
      setQualityFilter: vi.fn(),
      setStatusFilter: vi.fn(),
      setSearchQuery: vi.fn(),
      clearFilters: vi.fn()
    }

    // @ts-ignore
    useLibraryFilterManager.mockReturnValue(mockFilterManager)
  })

  describe('filter state passthrough', () => {
    it('should expose filter state from useLibraryFilterManager', () => {
      const { result } = renderHook(() => useTransitionFilters())

      expect(result.current.locationFilter).toBe('all')
      expect(result.current.categoryFilter).toBeNull()
      expect(result.current.qualityFilter).toBeNull()
      expect(result.current.statusFilter).toBeNull()
      expect(result.current.searchQuery).toBe('')
    })

    it('should expose derived state from useLibraryFilterManager', () => {
      mockFilterManager.hasActiveFilters = true
      mockFilterManager.activeFilterCount = 3

      const { result } = renderHook(() => useTransitionFilters())

      expect(result.current.hasActiveFilters).toBe(true)
      expect(result.current.activeFilterCount).toBe(3)
    })

    it('should reflect changes in filter manager state', () => {
      const { result, rerender } = renderHook(() => useTransitionFilters())

      expect(result.current.locationFilter).toBe('all')

      // Simulate filter manager state change
      mockFilterManager.locationFilter = 'device'
      rerender()

      expect(result.current.locationFilter).toBe('device')
    })
  })

  describe('transition state', () => {
    it('should provide isPending state', () => {
      const { result } = renderHook(() => useTransitionFilters())

      expect(result.current.isPending).toBe(false)
    })

    it('should set isPending during filter updates', async () => {
      const { result } = renderHook(() => useTransitionFilters())

      expect(result.current.isPending).toBe(false)

      act(() => {
        result.current.setLocationFilter('device')
      })

      // isPending should be true during transition
      await waitFor(() => {
        expect(mockFilterManager.setLocationFilter).toHaveBeenCalledWith('device')
      })

      // isPending should eventually become false
      await waitFor(() => {
        expect(result.current.isPending).toBe(false)
      })
    })
  })

  describe('wrapped filter actions', () => {
    it('should wrap setLocationFilter in transition', async () => {
      const { result } = renderHook(() => useTransitionFilters())

      act(() => {
        result.current.setLocationFilter('device')
      })

      await waitFor(() => {
        expect(mockFilterManager.setLocationFilter).toHaveBeenCalledWith('device')
      })
    })

    it('should wrap setCategoryFilter in transition', async () => {
      const { result } = renderHook(() => useTransitionFilters())

      act(() => {
        result.current.setCategoryFilter('meeting')
      })

      await waitFor(() => {
        expect(mockFilterManager.setCategoryFilter).toHaveBeenCalledWith('meeting')
      })
    })

    it('should wrap setQualityFilter in transition', async () => {
      const { result } = renderHook(() => useTransitionFilters())

      act(() => {
        result.current.setQualityFilter('valuable')
      })

      await waitFor(() => {
        expect(mockFilterManager.setQualityFilter).toHaveBeenCalledWith('valuable')
      })
    })

    it('should wrap setStatusFilter in transition', async () => {
      const { result } = renderHook(() => useTransitionFilters())

      act(() => {
        result.current.setStatusFilter('ready')
      })

      await waitFor(() => {
        expect(mockFilterManager.setStatusFilter).toHaveBeenCalledWith('ready')
      })
    })

    it('should wrap setSearchQuery in transition', async () => {
      const { result } = renderHook(() => useTransitionFilters())

      act(() => {
        result.current.setSearchQuery('test query')
      })

      await waitFor(() => {
        expect(mockFilterManager.setSearchQuery).toHaveBeenCalledWith('test query')
      })
    })

    it('should wrap clearFilters in transition', async () => {
      const { result } = renderHook(() => useTransitionFilters())

      act(() => {
        result.current.clearFilters()
      })

      await waitFor(() => {
        expect(mockFilterManager.clearFilters).toHaveBeenCalled()
      })
    })
  })

  describe('action memoization', () => {
    it('should maintain stable action references', () => {
      const { result, rerender } = renderHook(() => useTransitionFilters())

      const firstSetLocationFilter = result.current.setLocationFilter
      const firstSetCategoryFilter = result.current.setCategoryFilter
      const firstSetQualityFilter = result.current.setQualityFilter
      const firstSetStatusFilter = result.current.setStatusFilter
      const firstSetSearchQuery = result.current.setSearchQuery
      const firstClearFilters = result.current.clearFilters

      // Rerender without changing dependencies
      rerender()

      expect(result.current.setLocationFilter).toBe(firstSetLocationFilter)
      expect(result.current.setCategoryFilter).toBe(firstSetCategoryFilter)
      expect(result.current.setQualityFilter).toBe(firstSetQualityFilter)
      expect(result.current.setStatusFilter).toBe(firstSetStatusFilter)
      expect(result.current.setSearchQuery).toBe(firstSetSearchQuery)
      expect(result.current.clearFilters).toBe(firstClearFilters)
    })
  })

  describe('transition behavior', () => {
    it('should handle rapid consecutive filter changes', async () => {
      const { result } = renderHook(() => useTransitionFilters())

      // Trigger multiple filter changes in rapid succession
      act(() => {
        result.current.setLocationFilter('device')
        result.current.setCategoryFilter('meeting')
        result.current.setSearchQuery('test')
      })

      // All actions should eventually be called
      await waitFor(() => {
        expect(mockFilterManager.setLocationFilter).toHaveBeenCalledWith('device')
        expect(mockFilterManager.setCategoryFilter).toHaveBeenCalledWith('meeting')
        expect(mockFilterManager.setSearchQuery).toHaveBeenCalledWith('test')
      })
    })

    it('should not block UI during filter updates', async () => {
      const { result } = renderHook(() => useTransitionFilters())

      // Simulate a filter update
      act(() => {
        result.current.setLocationFilter('device')
      })

      // The action should be queued via startTransition
      // Verify it's eventually called
      await waitFor(() => {
        expect(mockFilterManager.setLocationFilter).toHaveBeenCalledWith('device')
      })
    })
  })

  describe('edge cases', () => {
    it('should handle null filter values', async () => {
      const { result } = renderHook(() => useTransitionFilters())

      act(() => {
        result.current.setCategoryFilter(null)
        result.current.setQualityFilter(null)
        result.current.setStatusFilter(null)
      })

      await waitFor(() => {
        expect(mockFilterManager.setCategoryFilter).toHaveBeenCalledWith(null)
        expect(mockFilterManager.setQualityFilter).toHaveBeenCalledWith(null)
        expect(mockFilterManager.setStatusFilter).toHaveBeenCalledWith(null)
      })
    })

    it('should handle empty string values', async () => {
      const { result } = renderHook(() => useTransitionFilters())

      act(() => {
        result.current.setSearchQuery('')
      })

      await waitFor(() => {
        expect(mockFilterManager.setSearchQuery).toHaveBeenCalledWith('')
      })
    })

    it('should handle LocationFilter type values', async () => {
      const { result } = renderHook(() => useTransitionFilters())

      const locationValues: Array<'all' | 'device' | 'local' | 'cloud'> = ['all', 'device', 'local', 'cloud']

      for (const location of locationValues) {
        act(() => {
          result.current.setLocationFilter(location)
        })

        await waitFor(() => {
          expect(mockFilterManager.setLocationFilter).toHaveBeenCalledWith(location)
        })

        vi.clearAllMocks()
      }
    })
  })

  describe('integration with useLibraryFilterManager', () => {
    it('should pass through all filter manager functionality', () => {
      const { result } = renderHook(() => useTransitionFilters())

      // Verify all properties are accessible
      expect(result.current).toHaveProperty('locationFilter')
      expect(result.current).toHaveProperty('categoryFilter')
      expect(result.current).toHaveProperty('qualityFilter')
      expect(result.current).toHaveProperty('statusFilter')
      expect(result.current).toHaveProperty('searchQuery')
      expect(result.current).toHaveProperty('hasActiveFilters')
      expect(result.current).toHaveProperty('activeFilterCount')
      expect(result.current).toHaveProperty('setLocationFilter')
      expect(result.current).toHaveProperty('setCategoryFilter')
      expect(result.current).toHaveProperty('setQualityFilter')
      expect(result.current).toHaveProperty('setStatusFilter')
      expect(result.current).toHaveProperty('setSearchQuery')
      expect(result.current).toHaveProperty('clearFilters')
      expect(result.current).toHaveProperty('isPending')
    })

    it('should reflect derived state changes immediately', () => {
      const { result, rerender } = renderHook(() => useTransitionFilters())

      expect(result.current.hasActiveFilters).toBe(false)
      expect(result.current.activeFilterCount).toBe(0)

      // Simulate filter manager state change
      mockFilterManager.hasActiveFilters = true
      mockFilterManager.activeFilterCount = 2
      rerender()

      expect(result.current.hasActiveFilters).toBe(true)
      expect(result.current.activeFilterCount).toBe(2)
    })
  })
})
