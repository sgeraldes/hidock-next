/**
 * useLibraryFilterManager Hook
 *
 * Provides filter state and actions for the Library view.
 * Wraps the useLibraryStore to provide a cohesive filter management interface.
 *
 * This hook provides state + actions + derived values following the useSourceSelection pattern.
 */

import { useMemo } from 'react'
import { useLibraryStore } from '@/store/useLibraryStore'
import {
  FilterMode,
  SemanticLocationFilter,
  ExclusiveLocationFilter
} from '@/types/unified-recording'

interface UseLibraryFilterManagerResult {
  // State
  filterMode: FilterMode
  semanticFilter: SemanticLocationFilter
  exclusiveFilter: ExclusiveLocationFilter
  categoryFilter: string | null
  qualityFilter: string | null
  statusFilter: string | null
  searchQuery: string

  // Derived state
  hasActiveFilters: boolean
  activeFilterCount: number

  // Actions
  setFilterMode: (mode: FilterMode) => void
  setSemanticFilter: (filter: SemanticLocationFilter) => void
  setExclusiveFilter: (filter: ExclusiveLocationFilter) => void
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
  const filterMode = useLibraryStore((state) => state.filterMode)
  const semanticFilter = useLibraryStore((state) => state.semanticFilter)
  const exclusiveFilter = useLibraryStore((state) => state.exclusiveFilter)
  const categoryFilter = useLibraryStore((state) => state.categoryFilter)
  const qualityFilter = useLibraryStore((state) => state.qualityFilter)
  const statusFilter = useLibraryStore((state) => state.statusFilter)
  const searchQuery = useLibraryStore((state) => state.searchQuery)

  // Get filter actions from store
  const setFilterMode = useLibraryStore((state) => state.setFilterMode)
  const setSemanticFilter = useLibraryStore((state) => state.setSemanticFilter)
  const setExclusiveFilter = useLibraryStore((state) => state.setExclusiveFilter)
  const setCategoryFilter = useLibraryStore((state) => state.setCategoryFilter)
  const setQualityFilter = useLibraryStore((state) => state.setQualityFilter)
  const setStatusFilter = useLibraryStore((state) => state.setStatusFilter)
  const setSearchQuery = useLibraryStore((state) => state.setSearchQuery)
  const clearFilters = useLibraryStore((state) => state.clearFilters)

  // Compute derived state
  const { hasActiveFilters, activeFilterCount } = useMemo(() => {
    const activeFilter = filterMode === 'semantic' ? semanticFilter : exclusiveFilter
    let count = 0
    if (activeFilter !== 'all') count++
    if (categoryFilter !== null) count++
    if (qualityFilter !== null) count++
    if (statusFilter !== null) count++
    if (searchQuery.trim() !== '') count++

    return {
      hasActiveFilters: count > 0,
      activeFilterCount: count
    }
  }, [filterMode, semanticFilter, exclusiveFilter, categoryFilter, qualityFilter, statusFilter, searchQuery])

  return {
    // State
    filterMode,
    semanticFilter,
    exclusiveFilter,
    categoryFilter,
    qualityFilter,
    statusFilter,
    searchQuery,

    // Derived state
    hasActiveFilters,
    activeFilterCount,

    // Actions
    setFilterMode,
    setSemanticFilter,
    setExclusiveFilter,
    setCategoryFilter,
    setQualityFilter,
    setStatusFilter,
    setSearchQuery,
    clearFilters
  }
}
