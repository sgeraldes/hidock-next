/**
 * useLibraryFilters Hook
 *
 * Provides filter state and filtering logic for the Library.
 * Uses the persisted LibraryStore for filter state.
 */

import { useMemo, useCallback, useEffect, useState, useTransition } from 'react'
import { UnifiedRecording, hasLocalPath, isDeviceOnly, LocationFilter } from '@/types/unified-recording'
import { useLibraryStore, SortBy, SortOrder } from '@/store/useLibraryStore'

interface UseLibraryFiltersResult {
  // Filter state
  locationFilter: string
  categoryFilter: string
  qualityFilter: string
  statusFilter: string
  searchQuery: string
  debouncedSearchQuery: string

  // Sorting
  sortBy: SortBy
  sortOrder: SortOrder

  // UI state
  isFiltering: boolean // True when filter operations are pending

  // Actions
  setLocationFilter: (filter: string) => void
  setCategoryFilter: (filter: string) => void
  setQualityFilter: (filter: string) => void
  setStatusFilter: (filter: string) => void
  setSearchQuery: (query: string) => void
  setSortBy: (sortBy: SortBy) => void
  toggleSortOrder: () => void
  clearFilters: () => void

  // Filtered data
  filteredRecordings: UnifiedRecording[]

  // Stats
  bulkCounts: {
    deviceOnly: number
    needsTranscription: number
  }
}

/**
 * Custom hook for managing Library filters with debounced search
 */
export function useLibraryFilters(recordings: UnifiedRecording[]): UseLibraryFiltersResult {
  // useTransition for smoother filter operations on large lists
  const [isPending, startTransition] = useTransition()

  // Get state from store
  const locationFilter = useLibraryStore((state) => state.locationFilter)
  const categoryFilter = useLibraryStore((state) => state.categoryFilter)
  const qualityFilter = useLibraryStore((state) => state.qualityFilter)
  const statusFilter = useLibraryStore((state) => state.statusFilter)
  const searchQuery = useLibraryStore((state) => state.searchQuery)
  const sortBy = useLibraryStore((state) => state.sortBy)
  const sortOrder = useLibraryStore((state) => state.sortOrder)

  // Get actions from store
  const storeSetLocationFilter = useLibraryStore((state) => state.setLocationFilter)
  const storeSetCategoryFilter = useLibraryStore((state) => state.setCategoryFilter)
  const storeSetQualityFilter = useLibraryStore((state) => state.setQualityFilter)
  const storeSetStatusFilter = useLibraryStore((state) => state.setStatusFilter)
  const storeSetSearchQuery = useLibraryStore((state) => state.setSearchQuery)
  const storeSetSortBy = useLibraryStore((state) => state.setSortBy)
  const storeToggleSortOrder = useLibraryStore((state) => state.toggleSortOrder)
  const storeClearFilters = useLibraryStore((state) => state.clearFilters)

  // Wrap filter actions in startTransition for smoother UI updates
  const setLocationFilter = useCallback(
    (filter: string) => {
      startTransition(() => storeSetLocationFilter(filter as LocationFilter))
    },
    [storeSetLocationFilter]
  )

  const setCategoryFilter = useCallback(
    (filter: string) => {
      startTransition(() => storeSetCategoryFilter(filter))
    },
    [storeSetCategoryFilter]
  )

  const setQualityFilter = useCallback(
    (filter: string) => {
      startTransition(() => storeSetQualityFilter(filter))
    },
    [storeSetQualityFilter]
  )

  const setStatusFilter = useCallback(
    (filter: string) => {
      startTransition(() => storeSetStatusFilter(filter))
    },
    [storeSetStatusFilter]
  )

  const setSortBy = useCallback(
    (newSortBy: SortBy) => {
      startTransition(() => storeSetSortBy(newSortBy))
    },
    [storeSetSortBy]
  )

  const toggleSortOrder = useCallback(() => {
    startTransition(() => storeToggleSortOrder())
  }, [storeToggleSortOrder])

  const clearFilters = useCallback(() => {
    startTransition(() => storeClearFilters())
  }, [storeClearFilters])

  // Debounced search (300ms delay)
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState(searchQuery)

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery)
    }, 300)

    return () => clearTimeout(timer)
  }, [searchQuery])

  // Wrapper for setSearchQuery (no transition needed - debounce handles this)
  const setSearchQuery = useCallback(
    (query: string) => {
      storeSetSearchQuery(query)
    },
    [storeSetSearchQuery]
  )

  // Filter recordings based on all criteria
  const filteredRecordings = useMemo(() => {
    let result = recordings.filter((rec) => {
      // Location filter
      if (locationFilter !== 'all' && rec.location !== locationFilter) {
        return false
      }

      // Category filter
      if (categoryFilter !== 'all' && rec.category !== categoryFilter) {
        return false
      }

      // Quality filter
      if (qualityFilter !== 'all' && rec.quality !== qualityFilter) {
        return false
      }

      // Status filter
      if (statusFilter !== 'all' && rec.status !== statusFilter) {
        return false
      }

      // Search filter (uses debounced value)
      if (debouncedSearchQuery) {
        const query = debouncedSearchQuery.toLowerCase()
        const filename = rec.filename.toLowerCase()
        const meetingSubject = rec.meetingSubject?.toLowerCase() || ''
        const title = rec.title?.toLowerCase() || ''
        return filename.includes(query) || meetingSubject.includes(query) || title.includes(query)
      }

      return true
    })

    // Sort results
    result = result.sort((a, b) => {
      let comparison = 0

      switch (sortBy) {
        case 'date':
          comparison = a.dateRecorded.getTime() - b.dateRecorded.getTime()
          break
        case 'duration':
          comparison = (a.duration || 0) - (b.duration || 0)
          break
        case 'name':
          comparison = (a.title || a.filename).localeCompare(b.title || b.filename)
          break
        case 'quality':
          const qualityOrder = { valuable: 0, archived: 1, 'low-value': 2, garbage: 3, unrated: 4 }
          const aQuality = a.quality || 'unrated'
          const bQuality = b.quality || 'unrated'
          comparison = (qualityOrder[aQuality] || 4) - (qualityOrder[bQuality] || 4)
          break
      }

      return sortOrder === 'desc' ? -comparison : comparison
    })

    return result
  }, [recordings, locationFilter, categoryFilter, qualityFilter, statusFilter, debouncedSearchQuery, sortBy, sortOrder])

  // Compute bulk operation counts
  const bulkCounts = useMemo(() => {
    const deviceOnly = filteredRecordings.filter((r) => isDeviceOnly(r)).length
    const needsTranscription = filteredRecordings.filter(
      (r) => hasLocalPath(r) && (r.transcriptionStatus === 'none' || r.transcriptionStatus === 'error')
    ).length
    return { deviceOnly, needsTranscription }
  }, [filteredRecordings])

  return {
    // Filter state
    locationFilter,
    categoryFilter,
    qualityFilter,
    statusFilter,
    searchQuery,
    debouncedSearchQuery,

    // Sorting
    sortBy,
    sortOrder,

    // UI state
    isFiltering: isPending,

    // Actions
    setLocationFilter,
    setCategoryFilter,
    setQualityFilter,
    setStatusFilter,
    setSearchQuery,
    setSortBy,
    toggleSortOrder,
    clearFilters,

    // Filtered data
    filteredRecordings,

    // Stats
    bulkCounts
  }
}
