/**
 * useKeyboardNavigation Hook
 *
 * Provides keyboard navigation for the Library list.
 * Supports Arrow Up/Down, Home/End, Space, Enter, Escape, Ctrl+A.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

interface UseKeyboardNavigationOptions {
  items: string[]
  selectedIds: Set<string>
  expandedIds?: Set<string>
  onToggleSelection: (id: string) => void
  onSelectAll: (ids: string[]) => void
  onClearSelection: () => void
  onOpenDetail?: (id: string) => void
  onToggleExpand?: (id: string) => void
  onExpandRow?: (id: string) => void
  onCollapseRow?: (id: string) => void
  onCollapseAllRows?: () => void
  isEnabled?: boolean
}

interface UseKeyboardNavigationResult {
  focusedIndex: number
  setFocusedIndex: (index: number) => void
  handleKeyDown: (event: React.KeyboardEvent) => void
  containerRef: React.RefObject<HTMLDivElement>
}

export function useKeyboardNavigation({
  items,
  selectedIds,
  expandedIds,
  onToggleSelection,
  onSelectAll,
  onClearSelection,
  onOpenDetail,
  onToggleExpand,
  onExpandRow,
  onCollapseRow,
  onCollapseAllRows,
  isEnabled = true
}: UseKeyboardNavigationOptions): UseKeyboardNavigationResult {
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)

  // Reset focused index when items change significantly
  useEffect(() => {
    if (focusedIndex >= items.length) {
      setFocusedIndex(Math.max(0, items.length - 1))
    }
  }, [items.length, focusedIndex])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (!isEnabled || items.length === 0) return

      const { key, ctrlKey, metaKey } = event
      const modKey = ctrlKey || metaKey
      const currentItemId = focusedIndex >= 0 && focusedIndex < items.length ? items[focusedIndex] : null

      switch (key) {
        case 'ArrowDown':
          event.preventDefault()
          setFocusedIndex((prev) => {
            const next = prev < items.length - 1 ? prev + 1 : prev
            return next
          })
          break

        case 'ArrowUp':
          event.preventDefault()
          setFocusedIndex((prev) => {
            const next = prev > 0 ? prev - 1 : 0
            return next
          })
          break

        case 'ArrowRight':
          // Expand row when collapsed
          event.preventDefault()
          if (currentItemId && onExpandRow && expandedIds && !expandedIds.has(currentItemId)) {
            onExpandRow(currentItemId)
          }
          break

        case 'ArrowLeft':
          // Collapse row when expanded
          event.preventDefault()
          if (currentItemId && onCollapseRow && expandedIds && expandedIds.has(currentItemId)) {
            onCollapseRow(currentItemId)
          }
          break

        case 'Home':
          event.preventDefault()
          setFocusedIndex(0)
          break

        case 'End':
          event.preventDefault()
          setFocusedIndex(items.length - 1)
          break

        case ' ':
          event.preventDefault()
          if (focusedIndex >= 0 && focusedIndex < items.length) {
            onToggleSelection(items[focusedIndex])
          }
          break

        case 'Enter':
          // Ctrl+Enter: Toggle expansion
          // Enter alone: Open detail (existing behavior)
          event.preventDefault()
          if (modKey && currentItemId && onToggleExpand) {
            onToggleExpand(currentItemId)
          } else if (focusedIndex >= 0 && focusedIndex < items.length && onOpenDetail) {
            onOpenDetail(items[focusedIndex])
          }
          break

        case 'Escape':
          event.preventDefault()
          // Collapse all expanded rows if any exist, otherwise clear selection
          if (expandedIds && expandedIds.size > 0 && onCollapseAllRows) {
            onCollapseAllRows()
          } else if (selectedIds.size > 0) {
            onClearSelection()
          }
          break

        case 'a':
        case 'A':
          if (modKey) {
            event.preventDefault()
            onSelectAll(items)
          }
          break

        default:
          break
      }
    },
    [
      items,
      focusedIndex,
      selectedIds.size,
      expandedIds,
      onToggleSelection,
      onSelectAll,
      onClearSelection,
      onOpenDetail,
      onToggleExpand,
      onExpandRow,
      onCollapseRow,
      onCollapseAllRows,
      isEnabled
    ]
  )

  return {
    focusedIndex,
    setFocusedIndex,
    handleKeyDown,
    containerRef
  }
}
