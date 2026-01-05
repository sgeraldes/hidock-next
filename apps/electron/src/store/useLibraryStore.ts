/**
 * Library Store
 *
 * Manages Library view state including filters, view preferences, and selection.
 * Uses persist middleware for view preferences that should survive app restart.
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { LocationFilter } from '@/types/unified-recording'

export type SortBy = 'date' | 'duration' | 'name' | 'quality'
export type SortOrder = 'asc' | 'desc'

interface LibraryState {
  // View preferences (persisted)
  viewMode: 'compact' | 'card'
  sortBy: SortBy
  sortOrder: SortOrder

  // Filter state (persisted)
  locationFilter: LocationFilter
  categoryFilter: string | null
  qualityFilter: string | null
  statusFilter: string | null
  searchQuery: string

  // Selection state (transient - not persisted)
  selectedIds: Set<string>

  // Scroll position (transient)
  scrollOffset: number
}

interface LibraryActions {
  // View mode
  setViewMode: (mode: 'compact' | 'card') => void
  toggleViewMode: () => void

  // Sorting
  setSortBy: (sortBy: SortBy) => void
  setSortOrder: (order: SortOrder) => void
  toggleSortOrder: () => void

  // Filters
  setLocationFilter: (filter: LocationFilter) => void
  setCategoryFilter: (filter: string | null) => void
  setQualityFilter: (filter: string | null) => void
  setStatusFilter: (filter: string | null) => void
  setSearchQuery: (query: string) => void
  clearFilters: () => void

  // Selection
  toggleSelection: (id: string) => void
  selectAll: (ids: string[]) => void
  selectRange: (ids: string[], startId: string, endId: string) => void
  clearSelection: () => void
  isSelected: (id: string) => boolean

  // Scroll
  setScrollOffset: (offset: number) => void
}

type LibraryStore = LibraryState & LibraryActions

const initialState: LibraryState = {
  viewMode: 'compact',
  sortBy: 'date',
  sortOrder: 'desc',
  locationFilter: 'all',
  categoryFilter: null,
  qualityFilter: null,
  statusFilter: null,
  searchQuery: '',
  selectedIds: new Set(),
  scrollOffset: 0
}

export const useLibraryStore = create<LibraryStore>()(
  persist(
    (set, get) => ({
      ...initialState,

      // View mode
      setViewMode: (mode) => set({ viewMode: mode }),
      toggleViewMode: () => set((state) => ({ viewMode: state.viewMode === 'compact' ? 'card' : 'compact' })),

      // Sorting
      setSortBy: (sortBy) => set({ sortBy }),
      setSortOrder: (order) => set({ sortOrder: order }),
      toggleSortOrder: () => set((state) => ({ sortOrder: state.sortOrder === 'asc' ? 'desc' : 'asc' })),

      // Filters
      setLocationFilter: (filter) => set({ locationFilter: filter }),
      setCategoryFilter: (filter) => set({ categoryFilter: filter }),
      setQualityFilter: (filter) => set({ qualityFilter: filter }),
      setStatusFilter: (filter) => set({ statusFilter: filter }),
      setSearchQuery: (query) => set({ searchQuery: query }),
      clearFilters: () =>
        set({
          locationFilter: 'all',
          categoryFilter: null,
          qualityFilter: null,
          statusFilter: null,
          searchQuery: ''
        }),

      // Selection
      toggleSelection: (id) =>
        set((state) => {
          const newSelected = new Set(state.selectedIds)
          if (newSelected.has(id)) {
            newSelected.delete(id)
          } else {
            newSelected.add(id)
          }
          return { selectedIds: newSelected }
        }),

      selectAll: (ids) => set({ selectedIds: new Set(ids) }),

      selectRange: (ids, startId, endId) => {
        const startIndex = ids.indexOf(startId)
        const endIndex = ids.indexOf(endId)
        if (startIndex === -1 || endIndex === -1) return

        const [from, to] = startIndex < endIndex ? [startIndex, endIndex] : [endIndex, startIndex]
        const rangeIds = ids.slice(from, to + 1)

        set((state) => {
          const newSelected = new Set(state.selectedIds)
          rangeIds.forEach((id) => newSelected.add(id))
          return { selectedIds: newSelected }
        })
      },

      clearSelection: () => set({ selectedIds: new Set() }),

      isSelected: (id) => get().selectedIds.has(id),

      // Scroll
      setScrollOffset: (offset) => set({ scrollOffset: offset })
    }),
    {
      name: 'hidock-library-store',
      storage: createJSONStorage(() => localStorage),
      // Only persist view preferences and filters, not selection or scroll
      partialize: (state) => ({
        viewMode: state.viewMode,
        sortBy: state.sortBy,
        sortOrder: state.sortOrder,
        locationFilter: state.locationFilter,
        categoryFilter: state.categoryFilter,
        qualityFilter: state.qualityFilter,
        statusFilter: state.statusFilter
        // searchQuery intentionally not persisted - should start fresh
        // selectedIds intentionally not persisted - transient
        // scrollOffset intentionally not persisted - transient
      })
    }
  )
)

// Selector hooks for performance (avoid re-renders when unrelated state changes)
export const useLibraryViewMode = () => useLibraryStore((state) => state.viewMode)
export const useLibraryFilters = () =>
  useLibraryStore((state) => ({
    locationFilter: state.locationFilter,
    categoryFilter: state.categoryFilter,
    qualityFilter: state.qualityFilter,
    statusFilter: state.statusFilter,
    searchQuery: state.searchQuery
  }))
export const useLibrarySelection = () => useLibraryStore((state) => state.selectedIds)
export const useLibrarySorting = () =>
  useLibraryStore((state) => ({
    sortBy: state.sortBy,
    sortOrder: state.sortOrder
  }))
