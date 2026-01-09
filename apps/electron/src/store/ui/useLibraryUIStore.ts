/**
 * Library UI Store (UI)
 *
 * Manages UI state specific to the Library (formerly Recordings) page.
 * Includes filters, selection, view mode, and sorting preferences.
 * Persists view preferences using persist middleware.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { QualityRating } from '../features/useQualityStore'

export type LibrarySource = 'all' | 'meetings' | 'interviews' | '1-on-1s' | 'brainstorms' | 'notes'
export type LibraryViewMode = 'list' | 'grid' | 'compact'
export type LibrarySortBy = 'date' | 'title' | 'duration' | 'quality'
export type LibrarySortOrder = 'asc' | 'desc'

export interface LibraryDateRange {
  start: Date
  end: Date
}

export interface LibraryUIStore {
  // Filters
  qualityFilter: QualityRating | null
  sourceFilter: LibrarySource
  dateRange: LibraryDateRange | null
  searchQuery: string

  // Selection
  selectedIds: Set<string>
  isMultiSelectMode: boolean

  // View Preferences (persisted)
  viewMode: LibraryViewMode
  sortBy: LibrarySortBy
  sortOrder: LibrarySortOrder

  // Filter Actions
  setQualityFilter: (quality: QualityRating | null) => void
  setSourceFilter: (source: LibrarySource) => void
  setDateRange: (range: LibraryDateRange | null) => void
  setSearchQuery: (query: string) => void
  clearFilters: () => void

  // Selection Actions
  toggleSelection: (id: string) => void
  selectAll: (ids: string[]) => void
  clearSelection: () => void
  setMultiSelectMode: (enabled: boolean) => void

  // View Actions
  setViewMode: (mode: LibraryViewMode) => void
  setSortBy: (sortBy: LibrarySortBy) => void
  toggleSortOrder: () => void
}

export const useLibraryUIStore = create<LibraryUIStore>()(
  persist(
    (set, _get) => ({
      // Initial state - Filters
      qualityFilter: null,
      sourceFilter: 'all',
      dateRange: null,
      searchQuery: '',

      // Initial state - Selection
      selectedIds: new Set(),
      isMultiSelectMode: false,

      // Initial state - View Preferences (persisted)
      viewMode: 'list',
      sortBy: 'date',
      sortOrder: 'desc',

      // Filter Actions
      setQualityFilter: (quality) => {
        set({ qualityFilter: quality })
      },

      setSourceFilter: (source) => {
        set({ sourceFilter: source })
      },

      setDateRange: (range) => {
        set({ dateRange: range })
      },

      setSearchQuery: (query) => {
        set({ searchQuery: query })
      },

      clearFilters: () => {
        set({
          qualityFilter: null,
          sourceFilter: 'all',
          dateRange: null,
          searchQuery: ''
        })
      },

      // Selection Actions
      toggleSelection: (id) => {
        set((state) => {
          const selectedIds = new Set(state.selectedIds)
          if (selectedIds.has(id)) {
            selectedIds.delete(id)
          } else {
            selectedIds.add(id)
          }
          return { selectedIds }
        })
      },

      selectAll: (ids) => {
        set({ selectedIds: new Set(ids) })
      },

      clearSelection: () => {
        set({ selectedIds: new Set(), isMultiSelectMode: false })
      },

      setMultiSelectMode: (enabled) => {
        set({ isMultiSelectMode: enabled })
        if (!enabled) {
          set({ selectedIds: new Set() })
        }
      },

      // View Actions
      setViewMode: (mode) => {
        set({ viewMode: mode })
      },

      setSortBy: (sortBy) => {
        set({ sortBy })
      },

      toggleSortOrder: () => {
        set((state) => ({
          sortOrder: state.sortOrder === 'asc' ? 'desc' : 'asc'
        }))
      }
    }),
    {
      name: 'library-ui-store', // localStorage key
      partialize: (state) => ({
        // Only persist these view preferences
        viewMode: state.viewMode,
        sortBy: state.sortBy,
        sortOrder: state.sortOrder
      })
    }
  )
)

// =============================================================================
// Selector Hooks
// =============================================================================

/**
 * Check if any filters are active
 */
export const useHasActiveFilters = () => {
  return useLibraryUIStore(
    (state) =>
      state.qualityFilter !== null ||
      state.sourceFilter !== 'all' ||
      state.dateRange !== null ||
      state.searchQuery !== ''
  )
}

/**
 * Get selected item count
 */
export const useSelectedCount = () => {
  return useLibraryUIStore((state) => state.selectedIds.size)
}

/**
 * Check if an item is selected
 */
export const useIsSelected = (id: string) => {
  return useLibraryUIStore((state) => state.selectedIds.has(id))
}

/**
 * Get all selected IDs as array
 */
export const useSelectedIds = () => {
  return useLibraryUIStore((state) => Array.from(state.selectedIds))
}
