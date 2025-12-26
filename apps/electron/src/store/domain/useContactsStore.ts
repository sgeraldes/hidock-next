/**
 * Contacts Store
 *
 * Manages contact state including list, selection, and search.
 */

import { create } from 'zustand'
import type { Contact, Meeting } from '@/types'
import type { ContactsStore } from '@/types/stores'

export const useContactsStore = create<ContactsStore>((set, get) => ({
  // State
  contacts: [],
  selectedContact: null,
  selectedContactMeetings: [],
  loading: false,
  searchQuery: '',
  total: 0,

  // Actions
  loadContacts: async (search?: string) => {
    set({ loading: true })
    try {
      const result = await window.electronAPI.contacts.getAll({ search })

      if (result.success) {
        set({
          contacts: result.data.contacts,
          total: result.data.total,
          loading: false
        })
      } else {
        console.error('Failed to load contacts:', result.error)
        set({ loading: false })
      }
    } catch (error) {
      console.error('Failed to load contacts:', error)
      set({ loading: false })
    }
  },

  selectContact: async (id: string | null) => {
    if (!id) {
      set({ selectedContact: null, selectedContactMeetings: [] })
      return
    }

    set({ loading: true })
    try {
      const result = await window.electronAPI.contacts.getById(id)

      if (result.success) {
        set({
          selectedContact: result.data.contact,
          selectedContactMeetings: result.data.meetings,
          loading: false
        })
      } else {
        console.error('Failed to load contact:', result.error)
        set({ loading: false })
      }
    } catch (error) {
      console.error('Failed to load contact:', error)
      set({ loading: false })
    }
  },

  updateContact: async (id: string, notes: string) => {
    try {
      const result = await window.electronAPI.contacts.update({ id, notes })

      if (result.success) {
        // Update local state
        set((state) => ({
          contacts: state.contacts.map((c) =>
            c.id === id ? { ...c, notes } : c
          ),
          selectedContact: state.selectedContact?.id === id
            ? { ...state.selectedContact, notes }
            : state.selectedContact
        }))
      } else {
        console.error('Failed to update contact:', result.error)
      }
    } catch (error) {
      console.error('Failed to update contact:', error)
    }
  },

  setSearchQuery: (query: string) => {
    set({ searchQuery: query })
    // Debounced search would be handled by the component
    get().loadContacts(query || undefined)
  },

  clearSelection: () => {
    set({ selectedContact: null, selectedContactMeetings: [] })
  }
}))
