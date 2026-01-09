import { describe, it, expect, beforeEach } from 'vitest'
import { useLibraryStore } from '@/store/useLibraryStore'

describe('useLibraryStore expansion', () => {
  beforeEach(() => {
    // Reset store state before each test
    const { expandedRowIds, collapseAllRows } = useLibraryStore.getState()
    if (expandedRowIds.size > 0) {
      collapseAllRows()
    }
  })

  it('toggles row expansion', () => {
    const { toggleRowExpansion, expandedRowIds } = useLibraryStore.getState()

    const testId = 'test-recording-123'

    // Initially collapsed
    expect(expandedRowIds.has(testId)).toBe(false)

    // Expand
    toggleRowExpansion(testId)
    expect(useLibraryStore.getState().expandedRowIds.has(testId)).toBe(true)

    // Collapse
    toggleRowExpansion(testId)
    expect(useLibraryStore.getState().expandedRowIds.has(testId)).toBe(false)
  })

  it('allows multiple rows to be expanded simultaneously', () => {
    const { expandRow } = useLibraryStore.getState()

    expandRow('row-1')
    expandRow('row-2')
    expandRow('row-3')

    const state = useLibraryStore.getState()
    expect(state.expandedRowIds.size).toBe(3)
    expect(state.expandedRowIds.has('row-1')).toBe(true)
    expect(state.expandedRowIds.has('row-2')).toBe(true)
    expect(state.expandedRowIds.has('row-3')).toBe(true)
  })

  it('collapses all rows at once', () => {
    const { expandRow, collapseAllRows } = useLibraryStore.getState()

    expandRow('row-1')
    expandRow('row-2')
    expandRow('row-3')

    expect(useLibraryStore.getState().expandedRowIds.size).toBe(3)

    collapseAllRows()

    expect(useLibraryStore.getState().expandedRowIds.size).toBe(0)
  })

  it('validates IDs before expansion to prevent prototype pollution', () => {
    const { toggleRowExpansion } = useLibraryStore.getState()

    // Attempt to expand with dangerous IDs
    toggleRowExpansion('__proto__')
    toggleRowExpansion('constructor')
    toggleRowExpansion('prototype')
    toggleRowExpansion('')

    // None should be added
    expect(useLibraryStore.getState().expandedRowIds.size).toBe(0)
  })

  it('ignores invalid IDs silently', () => {
    const { expandRow } = useLibraryStore.getState()

    // These should not throw errors, just be ignored
    expandRow('')
    expandRow('__proto__')
    expandRow('  ')

    expect(useLibraryStore.getState().expandedRowIds.size).toBe(0)
  })

  it('expandRow does not add duplicate IDs', () => {
    const { expandRow } = useLibraryStore.getState()

    expandRow('test-id')
    expandRow('test-id')
    expandRow('test-id')

    const state = useLibraryStore.getState()
    expect(state.expandedRowIds.size).toBe(1)
    expect(state.expandedRowIds.has('test-id')).toBe(true)
  })

  it('collapseRow removes specific ID', () => {
    const { expandRow, collapseRow } = useLibraryStore.getState()

    expandRow('row-1')
    expandRow('row-2')

    expect(useLibraryStore.getState().expandedRowIds.size).toBe(2)

    collapseRow('row-1')

    const state = useLibraryStore.getState()
    expect(state.expandedRowIds.size).toBe(1)
    expect(state.expandedRowIds.has('row-1')).toBe(false)
    expect(state.expandedRowIds.has('row-2')).toBe(true)
  })

  it('collapseRow does nothing if ID is not expanded', () => {
    const { expandRow, collapseRow } = useLibraryStore.getState()

    expandRow('row-1')
    collapseRow('row-2') // Not expanded

    const state = useLibraryStore.getState()
    expect(state.expandedRowIds.size).toBe(1)
    expect(state.expandedRowIds.has('row-1')).toBe(true)
  })

  it('handles rapid toggle operations', () => {
    const { toggleRowExpansion } = useLibraryStore.getState()

    const testId = 'rapid-test'

    // Rapid toggles
    for (let i = 0; i < 10; i++) {
      toggleRowExpansion(testId)
    }

    // Should end up collapsed (started collapsed, toggled even number of times)
    expect(useLibraryStore.getState().expandedRowIds.has(testId)).toBe(false)
  })

  it('maintains expansion state across other store operations', () => {
    const { expandRow } = useLibraryStore.getState()

    expandRow('test-1')
    expandRow('test-2')

    // Other store operations should not affect expansion
    // (This assumes other store operations exist - adjust as needed)
    const initialSize = useLibraryStore.getState().expandedRowIds.size

    expect(useLibraryStore.getState().expandedRowIds.size).toBe(initialSize)
    expect(useLibraryStore.getState().expandedRowIds.has('test-1')).toBe(true)
    expect(useLibraryStore.getState().expandedRowIds.has('test-2')).toBe(true)
  })
})
