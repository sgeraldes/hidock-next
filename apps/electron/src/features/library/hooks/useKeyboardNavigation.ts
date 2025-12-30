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
  onToggleSelection: (id: string) => void
  onSelectAll: (ids: string[]) => void
  onClearSelection: () => void
  onOpenDetail?: (id: string) => void
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
  onToggleSelection,
  onSelectAll,
  onClearSelection,
  onOpenDetail,
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
          event.preventDefault()
          if (focusedIndex >= 0 && focusedIndex < items.length && onOpenDetail) {
            onOpenDetail(items[focusedIndex])
          }
          break

        case 'Escape':
          event.preventDefault()
          if (selectedIds.size > 0) {
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
    [items, focusedIndex, selectedIds.size, onToggleSelection, onSelectAll, onClearSelection, onOpenDetail, isEnabled]
  )

  return {
    focusedIndex,
    setFocusedIndex,
    handleKeyDown,
    containerRef
  }
}
