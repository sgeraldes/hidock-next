/**
 * Contacts Store (Domain)
 *
 * Manages CRUD operations on contacts/people entities.
 * Provides loading, creating, updating, deleting, and selecting contacts.
 */

import { create } from 'zustand'
import type { Person } from '@/types/knowledge'

interface ContactsState {
  // State
  contacts: Person[]
  selectedContact: Person | null
  loading: boolean
  error: string | null
  searchQuery: string
  total: number

  // Actions
  loadContacts: (search?: string, type?: string, limit?: number, offset?: number) => Promise<void>
  selectContact: (id: string) => Promise<void>
  updateContact: (id: string, updates: {
    name?: string
    email?: string | null
    notes?: string
    type?: string
    role?: string
    company?: string
    tags?: string[]
  }) => Promise<void>
  deleteContact: (id: string) => Promise<void>
  setSearchQuery: (query: string) => void
  clearSelection: () => void
  clearError: () => void
}

export const useContactsStore = create<ContactsState>((set, get) => ({
  contacts: [],
  selectedContact: null,
  loading: false,
  error: null,
  searchQuery: '',
  total: 0,

  loadContacts: async (search, type, limit = 100, offset = 0) => {
    set({ loading: true, error: null })
    try {
      const result = await window.electronAPI.contacts.getAll({
        search,
        type: type as any,
        limit,
        offset
      })
      if (result.success) {
        const mapped = result.data.contacts.map((c: any): Person => ({
          id: c.id,
          name: c.name,
          email: c.email,
          type: c.type || 'unknown',
          role: c.role,
          company: c.company,
          notes: c.notes,
          tags: c.tags ? (typeof c.tags === 'string' ? JSON.parse(c.tags) : c.tags) : [],
          firstSeenAt: c.first_seen_at || c.firstSeenAt,
          lastSeenAt: c.last_seen_at || c.lastSeenAt,
          interactionCount: c.meeting_count || c.interactionCount || 0,
          createdAt: c.created_at || c.createdAt || new Date().toISOString()
        }))
        set({ contacts: mapped, total: result.data.total, loading: false })
      } else {
        const msg = (result as any).error?.message || 'Failed to load contacts'
        set({ error: msg, loading: false })
      }
    } catch (err) {
      console.error('ContactsStore: Failed to load contacts:', err)
      set({ error: err instanceof Error ? err.message : 'Failed to load contacts', loading: false })
    }
  },

  selectContact: async (id: string) => {
    set({ loading: true, error: null })
    try {
      const result = await window.electronAPI.contacts.getById(id)
      if (result.success && result.data.contact) {
        const c = result.data.contact as any
        const person: Person = {
          id: c.id,
          name: c.name,
          email: c.email,
          type: c.type || 'unknown',
          role: c.role,
          company: c.company,
          notes: c.notes,
          tags: c.tags ? (typeof c.tags === 'string' ? JSON.parse(c.tags) : c.tags) : [],
          firstSeenAt: c.first_seen_at || c.firstSeenAt,
          lastSeenAt: c.last_seen_at || c.lastSeenAt,
          interactionCount: c.meeting_count || c.interactionCount || 0,
          createdAt: c.created_at || c.createdAt || new Date().toISOString()
        }
        set({ selectedContact: person, loading: false })
      } else {
        set({ error: 'Contact not found', loading: false })
      }
    } catch (err) {
      console.error('ContactsStore: Failed to select contact:', err)
      set({ error: err instanceof Error ? err.message : 'Failed to load contact', loading: false })
    }
  },

  updateContact: async (id, updates) => {
    try {
      const result = await window.electronAPI.contacts.update({ id, ...updates })
      if (result.success) {
        // Refresh contacts list and selected contact
        const state = get()
        await state.loadContacts(state.searchQuery)
        if (state.selectedContact?.id === id) {
          await state.selectContact(id)
        }
      } else {
        const msg = (result as any).error?.message || 'Failed to update contact'
        set({ error: msg })
      }
    } catch (err) {
      console.error('ContactsStore: Failed to update contact:', err)
      set({ error: err instanceof Error ? err.message : 'Failed to update contact' })
    }
  },

  deleteContact: async (id) => {
    try {
      const result = await window.electronAPI.contacts.delete(id)
      if (result.success) {
        const state = get()
        set({
          contacts: state.contacts.filter(c => c.id !== id),
          selectedContact: state.selectedContact?.id === id ? null : state.selectedContact,
          total: state.total - 1
        })
      } else {
        const msg = (result as any).error?.message || 'Failed to delete contact'
        set({ error: msg })
      }
    } catch (err) {
      console.error('ContactsStore: Failed to delete contact:', err)
      set({ error: err instanceof Error ? err.message : 'Failed to delete contact' })
    }
  },

  setSearchQuery: (query) => set({ searchQuery: query }),
  clearSelection: () => set({ selectedContact: null }),
  clearError: () => set({ error: null })
}))
