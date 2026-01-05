/**
 * useTransitionFilters Hook
 *
 * Wraps filter state updates with React's useTransition to prevent UI blocking
 * during expensive filtering operations on large datasets (5000+ items).
 *
 * This hook provides the same interface as useLibraryFilterManager but wraps
 * all filter setters in startTransition for non-blocking updates.
 */

import { useTransition, useCallback } from 'react'
import { useLibraryFilterManager } from './useLibraryFilterManager'
import { LocationFilter } from '@/types/unified-recording'

interface UseTransitionFiltersResult {
  // State
  locationFilter: LocationFilter
  categoryFilter: string | null
  qualityFilter: string | null
  statusFilter: string | null
  searchQuery: string

  // Derived state
  hasActiveFilters: boolean
  activeFilterCount: number

  // Transition state
  isPending: boolean

  // Actions (wrapped in transition)
  setLocationFilter: (filter: LocationFilter) => void
  setCategoryFilter: (filter: string | null) => void
  setQualityFilter: (filter: string | null) => void
  setStatusFilter: (filter: string | null) => void
  setSearchQuery: (query: string) => void
  clearFilters: () => void
}

/**
 * Custom hook for managing Library filter state with transitions.
 *
 * Wraps all filter updates in React's startTransition to keep the UI responsive
 * during expensive filtering operations. Shows isPending during transitions.
 */
export function useTransitionFilters(): UseTransitionFiltersResult {
  const filterManager = useLibraryFilterManager()
  const [isPending, startTransition] = useTransition()

  // Wrap filter setters in startTransition
  const setLocationFilter = useCallback(
    (filter: LocationFilter) => {
      startTransition(() => {
        filterManager.setLocationFilter(filter)
      })
    },
    [filterManager]
  )

  const setCategoryFilter = useCallback(
    (filter: string | null) => {
      startTransition(() => {
        filterManager.setCategoryFilter(filter)
      })
    },
    [filterManager]
  )

  const setQualityFilter = useCallback(
    (filter: string | null) => {
      startTransition(() => {
        filterManager.setQualityFilter(filter)
      })
    },
    [filterManager]
  )

  const setStatusFilter = useCallback(
    (filter: string | null) => {
      startTransition(() => {
        filterManager.setStatusFilter(filter)
      })
    },
    [filterManager]
  )

  const setSearchQuery = useCallback(
    (query: string) => {
      startTransition(() => {
        filterManager.setSearchQuery(query)
      })
    },
    [filterManager]
  )

  const clearFilters = useCallback(() => {
    startTransition(() => {
      filterManager.clearFilters()
    })
  }, [filterManager])

  return {
    // State (read directly, no transition needed)
    locationFilter: filterManager.locationFilter,
    categoryFilter: filterManager.categoryFilter,
    qualityFilter: filterManager.qualityFilter,
    statusFilter: filterManager.statusFilter,
    searchQuery: filterManager.searchQuery,

    // Derived state
    hasActiveFilters: filterManager.hasActiveFilters,
    activeFilterCount: filterManager.activeFilterCount,

    // Transition state
    isPending,

    // Actions (wrapped)
    setLocationFilter,
    setCategoryFilter,
    setQualityFilter,
    setStatusFilter,
    setSearchQuery,
    clearFilters
  }
}
