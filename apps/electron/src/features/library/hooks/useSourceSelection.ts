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
  /** Plain click: select JUST this row AND set the shift-range anchor on it. */
  selectSingle: (id: string) => void
  toggleSelection: (id: string) => void
  selectAll: (ids: string[]) => void
  clearSelection: () => void

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
  const storeSelectSingle = useLibraryStore((state) => state.selectSingle)
  const toggleSelection = useLibraryStore((state) => state.toggleSelection)
  const selectAll = useLibraryStore((state) => state.selectAll)
  const selectRange = useLibraryStore((state) => state.selectRange)
  const clearSelection = useLibraryStore((state) => state.clearSelection)

  // Plain click: select JUST this row AND make it the range anchor. Without
  // this, the anchor only updates on ctrl+click, so a plain click followed by
  // a shift+click ranged from a STALE anchor and the in-between rows never got
  // selected (2026-07-22 report: "shift click is working ackward").
  const selectSingle = useCallback(
    (id: string) => {
      storeSelectSingle(id)
      lastSelectedRef.current = id
    },
    [storeSelectSingle]
  )

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
    selectSingle,
    toggleSelection,
    selectAll,
    clearSelection: handleClearSelection,
    handleSelectionClick
  }
}
