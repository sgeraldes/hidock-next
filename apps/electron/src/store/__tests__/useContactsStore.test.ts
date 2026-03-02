/**
 * Tests for useContactsStore
 *
 * Tests cover synchronous store functionality:
 * - Initial state verification
 * - setSearchQuery
 * - clearSelection
 * - clearError
 *
 * NOTE: Async actions (loadContacts, selectContact, updateContact, deleteContact)
 * call window.electronAPI and would require full IPC mocking.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { useContactsStore } from '@/store/domain/useContactsStore'

beforeEach(() => {
  // Reset store to initial state
  useContactsStore.setState({
    contacts: [],
    selectedContact: null,
    loading: false,
    error: null,
    searchQuery: '',
    total: 0
  })
})

describe('useContactsStore', () => {
  it('should have correct initial state', () => {
    const state = useContactsStore.getState()
    expect(state.contacts).toEqual([])
    expect(state.selectedContact).toBeNull()
    expect(state.loading).toBe(false)
    expect(state.error).toBeNull()
    expect(state.searchQuery).toBe('')
    expect(state.total).toBe(0)
  })

  it('should set search query', () => {
    useContactsStore.getState().setSearchQuery('test query')
    expect(useContactsStore.getState().searchQuery).toBe('test query')
  })

  it('should clear selection', () => {
    useContactsStore.setState({
      selectedContact: {
        id: '1',
        name: 'Test',
        email: null,
        type: 'unknown',
        role: null,
        company: null,
        notes: null,
        tags: [],
        firstSeenAt: '2025-01-01',
        lastSeenAt: '2025-01-02',
        interactionCount: 0,
        createdAt: '2025-01-01'
      }
    })
    expect(useContactsStore.getState().selectedContact).not.toBeNull()

    useContactsStore.getState().clearSelection()
    expect(useContactsStore.getState().selectedContact).toBeNull()
  })

  it('should clear error', () => {
    useContactsStore.setState({ error: 'Some error' })
    expect(useContactsStore.getState().error).toBe('Some error')

    useContactsStore.getState().clearError()
    expect(useContactsStore.getState().error).toBeNull()
  })

  it('should expose loadContacts, selectContact, updateContact, deleteContact actions', () => {
    const state = useContactsStore.getState()
    expect(typeof state.loadContacts).toBe('function')
    expect(typeof state.selectContact).toBe('function')
    expect(typeof state.updateContact).toBe('function')
    expect(typeof state.deleteContact).toBe('function')
  })
})
