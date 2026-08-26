import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useKeyboardNavigation } from '../useKeyboardNavigation'

interface HarnessProps {
  items?: string[]
  selectedIds?: Set<string>
  isEnabled?: boolean
  onClearSelection?: () => void
}

function Harness({
  items = [],
  selectedIds = new Set<string>(),
  isEnabled = false,
  onClearSelection = vi.fn()
}: HarnessProps) {
  const { handleKeyDown } = useKeyboardNavigation({
    items,
    selectedIds,
    onToggleSelection: vi.fn(),
    onSelectAll: vi.fn(),
    onClearSelection,
    isEnabled
  })

  return <div data-testid="library-list" tabIndex={0} onKeyDown={handleKeyDown} />
}

describe('useKeyboardNavigation selection reset', () => {
  it('clears retained selection with Escape when filtering leaves an empty, disabled list', () => {
    const onClearSelection = vi.fn()
    const { getByTestId } = render(
      <Harness selectedIds={new Set(['hidden-recording'])} onClearSelection={onClearSelection} />
    )

    fireEvent.keyDown(getByTestId('library-list'), { key: 'Escape' })

    expect(onClearSelection).toHaveBeenCalledTimes(1)
  })

  it('does not consume Escape when there is no selection to clear', () => {
    const onClearSelection = vi.fn()
    const { getByTestId } = render(<Harness onClearSelection={onClearSelection} />)
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })

    getByTestId('library-list').dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
    expect(onClearSelection).not.toHaveBeenCalled()
  })
})
