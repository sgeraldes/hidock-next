/**
 * Library Store
 *
 * Manages Library view state including filters, view preferences, and selection.
 * Uses persist middleware for view preferences that should survive app restart.
 */

import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { persist, createJSONStorage } from 'zustand/middleware'
import {
  FilterMode,
  SemanticLocationFilter,
  ExclusiveLocationFilter
} from '@/types/unified-recording'
import type { SourceTypeFilter } from '@/features/library/utils/sourceType'
import type { DurationPreset } from '@/features/library/utils/durationFilter'
import { LibraryError } from '@/features/library/utils/errorHandling'
import { validateId } from '@/lib/utils'

export type SortBy = 'date' | 'duration' | 'name' | 'quality'
export type SortOrder = 'asc' | 'desc'

/**
 * How the source-scoped AI assistant is docked in the Library.
 * - `pinned`: permanent third pane (the classic 3-pane layout).
 * - `floating`: 2-pane layout with the assistant open as a right-docked overlay.
 * - `collapsed`: 2-pane layout with the assistant reduced to an icon rail.
 * Persisted so the choice survives navigation and restart.
 */
export type AssistantDock = 'pinned' | 'floating' | 'collapsed'

interface LibraryState {
  // View preferences (persisted)
  viewMode: 'compact' | 'card'
  sortBy: SortBy
  sortOrder: SortOrder

  // Filter state (persisted)
  filterMode: FilterMode
  semanticFilter: SemanticLocationFilter
  exclusiveFilter: ExclusiveLocationFilter
  categoryFilter: string | null
  qualityFilter: string | null
  statusFilter: string | null
  sourceTypeFilter: SourceTypeFilter
  durationPreset: DurationPreset
  searchQuery: string

  // Source-scoped AI assistant docking (persisted)
  assistantDock: AssistantDock

  // Selection state (transient - not persisted)
  selectedIds: Set<string>

  // Expansion state (transient - not persisted)
  expandedRowIds: Set<string>

  // Transcript expansion state (transient - not persisted)
  expandedTranscripts: Set<string>

  // Panel state (persisted)
  panelSizes: number[]
  // The list/left-column width (percent of the desktop pane group). Persisted on
  // its own so the resizable split the user sets is REMEMBERED across navigation
  // and restart, independent of the assistant dock mode (which reshapes the
  // pane group). This is the single source of truth for "the list column width".
  listPaneSize: number
  // Whether the list pane is collapsed to a thin icon rail (like the dockable
  // assistant). Lets the reader reclaim the full width when the list is a narrow
  // rail; one click on the rail brings the list back. Persisted so the choice
  // survives navigation and restart.
  listCollapsed: boolean
  selectedSourceId: string | null

  // Error state (transient - not persisted)
  recordingErrors: Map<string, LibraryError>

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
  setFilterMode: (mode: FilterMode) => void
  setSemanticFilter: (filter: SemanticLocationFilter) => void
  setExclusiveFilter: (filter: ExclusiveLocationFilter) => void
  setCategoryFilter: (filter: string | null) => void
  setQualityFilter: (filter: string | null) => void
  setStatusFilter: (filter: string | null) => void
  setSourceTypeFilter: (filter: SourceTypeFilter) => void
  setDurationPreset: (preset: DurationPreset) => void
  setSearchQuery: (query: string) => void
  clearFilters: () => void

  // Assistant docking
  setAssistantDock: (dock: AssistantDock) => void

  // Selection
  selectSingle: (id: string) => void
  toggleSelection: (id: string) => void
  selectAll: (ids: string[]) => void
  selectRange: (ids: string[], startId: string, endId: string) => void
  clearSelection: () => void

  // Row expansion
  toggleRowExpansion: (id: string) => void
  expandRow: (id: string) => void
  collapseRow: (id: string) => void
  collapseAllRows: () => void

  // Transcript expansion
  toggleTranscriptExpansion: (id: string) => void
  collapseAllTranscripts: () => void

  // Error management
  setRecordingError: (id: string, error: LibraryError) => void
  clearRecordingError: (id: string) => void
  clearAllErrors: () => void

  // Panel state
  setPanelSizes: (sizes: number[]) => void
  setListPaneSize: (size: number) => void
  setListCollapsed: (collapsed: boolean) => void
  toggleListCollapsed: () => void
  setSelectedSourceId: (id: string | null) => void

  // Scroll
  setScrollOffset: (offset: number) => void
}

type LibraryStore = LibraryState & LibraryActions

const initialState: LibraryState = {
  viewMode: 'compact',
  sortBy: 'date',
  sortOrder: 'desc',
  filterMode: 'semantic',
  semanticFilter: 'all',
  exclusiveFilter: 'all',
  categoryFilter: null,
  qualityFilter: null,
  statusFilter: null,
  sourceTypeFilter: 'all',
  durationPreset: 'all',
  searchQuery: '',
  // Default to the two-pane layout with the assistant collapsed to an icon rail.
  assistantDock: 'collapsed',
  selectedIds: new Set(),
  expandedRowIds: new Set(),
  expandedTranscripts: new Set(),
  panelSizes: [25, 45, 30],
  listPaneSize: 25,
  listCollapsed: false,
  selectedSourceId: null,
  recordingErrors: new Map(),
  scrollOffset: 0
}

export const useLibraryStore = create<LibraryStore>()(
  persist(
    (set, _get) => ({
      ...initialState,

      // View mode
      setViewMode: (mode) => set({ viewMode: mode }),
      toggleViewMode: () => set((state) => ({ viewMode: state.viewMode === 'compact' ? 'card' : 'compact' })),

      // Sorting
      setSortBy: (sortBy) => set({ sortBy }),
      setSortOrder: (order) => set({ sortOrder: order }),
      toggleSortOrder: () => set((state) => ({ sortOrder: state.sortOrder === 'asc' ? 'desc' : 'asc' })),

      // Filters
      setFilterMode: (mode) => set({ filterMode: mode }),
      setSemanticFilter: (filter) => set({ semanticFilter: filter }),
      setExclusiveFilter: (filter) => set({ exclusiveFilter: filter }),
      setCategoryFilter: (filter) => set({ categoryFilter: filter }),
      setQualityFilter: (filter) => set({ qualityFilter: filter }),
      setStatusFilter: (filter) => set({ statusFilter: filter }),
      setSourceTypeFilter: (filter) => set({ sourceTypeFilter: filter }),
      setDurationPreset: (preset) => set({ durationPreset: preset }),
      setSearchQuery: (query) => set({ searchQuery: query }),
      clearFilters: () =>
        set({
          filterMode: 'semantic',
          semanticFilter: 'all',
          exclusiveFilter: 'all',
          categoryFilter: null,
          qualityFilter: null,
          statusFilter: null,
          sourceTypeFilter: 'all',
          durationPreset: 'all',
          searchQuery: '',
          // C-005: Clear stale expansion state when filters reset to prevent accumulation
          expandedTranscripts: new Set()
        }),

      // Assistant docking
      setAssistantDock: (dock) => set({ assistantDock: dock }),

      // Selection
      selectSingle: (id) =>
        set({ selectedIds: new Set([id]), selectedSourceId: id }),

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

      // Row expansion
      toggleRowExpansion: (id) => {
        if (!validateId(id)) {
          console.warn('[LibraryStore] Invalid ID for expansion:', id)
          return
        }
        set((state) => {
          const newExpanded = new Set(state.expandedRowIds)
          if (newExpanded.has(id)) {
            newExpanded.delete(id)
          } else {
            newExpanded.add(id)
          }
          return { expandedRowIds: newExpanded }
        })
      },

      expandRow: (id) => {
        if (!validateId(id)) {
          console.warn('[LibraryStore] Invalid ID for expansion:', id)
          return
        }
        set((state) => {
          const newExpanded = new Set(state.expandedRowIds)
          newExpanded.add(id)
          return { expandedRowIds: newExpanded }
        })
      },

      collapseRow: (id) => {
        if (!validateId(id)) {
          console.warn('[LibraryStore] Invalid ID for collapse:', id)
          return
        }
        set((state) => {
          const newExpanded = new Set(state.expandedRowIds)
          newExpanded.delete(id)
          return { expandedRowIds: newExpanded }
        })
      },

      collapseAllRows: () => set({ expandedRowIds: new Set() }),

      // Transcript expansion
      toggleTranscriptExpansion: (id) =>
        set((state) => {
          const newExpanded = new Set(state.expandedTranscripts)
          if (newExpanded.has(id)) {
            newExpanded.delete(id)
          } else {
            newExpanded.add(id)
          }
          return { expandedTranscripts: newExpanded }
        }),

      collapseAllTranscripts: () => set({ expandedTranscripts: new Set() }),

      // Error management
      setRecordingError: (id, error) =>
        set((state) => {
          const newErrors = new Map(state.recordingErrors)
          newErrors.set(id, error)
          return { recordingErrors: newErrors }
        }),

      clearRecordingError: (id) =>
        set((state) => {
          const newErrors = new Map(state.recordingErrors)
          newErrors.delete(id)
          return { recordingErrors: newErrors }
        }),

      clearAllErrors: () => set({ recordingErrors: new Map() }),

      // Panel state
      setPanelSizes: (sizes) => set({ panelSizes: sizes }),
      setListPaneSize: (size) => set({ listPaneSize: size }),
      setListCollapsed: (collapsed) => set({ listCollapsed: collapsed }),
      toggleListCollapsed: () => set((state) => ({ listCollapsed: !state.listCollapsed })),
      setSelectedSourceId: (id) => set({ selectedSourceId: id }),

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
        filterMode: state.filterMode,
        semanticFilter: state.semanticFilter,
        exclusiveFilter: state.exclusiveFilter,
        categoryFilter: state.categoryFilter,
        qualityFilter: state.qualityFilter,
        statusFilter: state.statusFilter,
        sourceTypeFilter: state.sourceTypeFilter,
        durationPreset: state.durationPreset,
        assistantDock: state.assistantDock,
        panelSizes: state.panelSizes,
        listPaneSize: state.listPaneSize,
        listCollapsed: state.listCollapsed
        // searchQuery intentionally not persisted - should start fresh
        // selectedIds intentionally not persisted - transient
        // expandedRowIds intentionally not persisted - transient
        // selectedSourceId intentionally not persisted - should start fresh
        // scrollOffset intentionally not persisted - transient
      })
    }
  )
)

// Selector hooks for performance (avoid re-renders when unrelated state changes)
export const useLibraryViewMode = () => useLibraryStore((state) => state.viewMode)
export const useLibrarySelection = () => useLibraryStore((state) => state.selectedIds)
export const useLibrarySorting = () =>
  useLibraryStore(useShallow((state) => ({
    sortBy: state.sortBy,
    sortOrder: state.sortOrder
  })))
export const useLibraryAssistantDock = () => useLibraryStore((state) => state.assistantDock)
