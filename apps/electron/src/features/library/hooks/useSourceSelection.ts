/**
 * useSourceSelection Hook
 *
 * Provides selection state and logic for bulk operations in the Library.
 */

import { useCallback, useRef } from 'react'
import { useLibraryStore } from '@/store/useLibraryStore'

interface UseSourceSelectionResult {
  // State
  selectedIds: Set<string>
  selectedCount: number

  // Actions
  toggleSelection: (id: string) => void
  selectAll: (ids: string[]) => void
  clearSelection: () => void
  isSelected: (id: string) => boolean

  // Shift+Click range selection
  handleSelectionClick: (id: string, shiftKey: boolean, allIds: string[]) => void
}

/**
 * Custom hook for managing source selection with range selection support
 */
export function useSourceSelection(): UseSourceSelectionResult {
  // Track the last selected item for range selection
  const lastSelectedRef = useRef<string | null>(null)

  // Get state and actions from store
  const selectedIds = useLibraryStore((state) => state.selectedIds)
  const toggleSelection = useLibraryStore((state) => state.toggleSelection)
  const selectAll = useLibraryStore((state) => state.selectAll)
  const selectRange = useLibraryStore((state) => state.selectRange)
  const clearSelection = useLibraryStore((state) => state.clearSelection)
  const isSelected = useLibraryStore((state) => state.isSelected)

  // Handle selection with Shift+Click for range selection
  const handleSelectionClick = useCallback(
    (id: string, shiftKey: boolean, allIds: string[]) => {
      if (shiftKey && lastSelectedRef.current) {
        // Range selection
        selectRange(allIds, lastSelectedRef.current, id)
      } else {
        // Single selection toggle
        toggleSelection(id)
        lastSelectedRef.current = id
      }
    },
    [selectRange, toggleSelection]
  )

  // Wrapper for clearSelection that also resets last selected
  const handleClearSelection = useCallback(() => {
    clearSelection()
    lastSelectedRef.current = null
  }, [clearSelection])

  return {
    selectedIds,
    selectedCount: selectedIds.size,
    toggleSelection,
    selectAll,
    clearSelection: handleClearSelection,
    isSelected,
    handleSelectionClick
  }
}
