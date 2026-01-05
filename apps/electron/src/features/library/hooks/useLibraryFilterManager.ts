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
  setCategoryFilter: (filter: string | null) => void
  setQualityFilter: (filter: string | null) => void
  setStatusFilter: (filter: string | null) => void
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
