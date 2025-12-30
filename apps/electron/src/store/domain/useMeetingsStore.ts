/**
 * Meetings Store (Domain)
 *
 * Manages Meeting entities - calendar events synced from ICS.
 * This is a pure domain store focused on CRUD operations.
 * Uses subscribeWithSelector middleware for fine-grained subscriptions.
 */

import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { Meeting } from '@/types'

export interface MeetingsStore {
  // State
  items: Meeting[]
  byId: Map<string, Meeting>
  loading: boolean
  error: string | null

  // CRUD Actions
  setItems: (items: Meeting[]) => void
  addItem: (item: Meeting) => void
  updateItem: (id: string, updates: Partial<Meeting>) => void
  removeItem: (id: string) => void

  // Async Actions
  loadItems: (startDate?: string, endDate?: string) => Promise<void>
  refreshItem: (id: string) => Promise<void>
}

export const useMeetingsStore = create<MeetingsStore>()(
  subscribeWithSelector((set, get) => ({
    // Initial state
    items: [],
    byId: new Map(),
    loading: false,
    error: null,

    // CRUD Actions
    setItems: (items) => {
      const byId = new Map<string, Meeting>()
      items.forEach((item) => byId.set(item.id, item))
      set({ items, byId })
    },

    addItem: (item) => {
      set((state) => {
        const byId = new Map(state.byId)
        byId.set(item.id, item)
        return {
          items: [...state.items, item],
          byId
        }
      })
    },

    updateItem: (id, updates) => {
      set((state) => {
        const existing = state.byId.get(id)
        if (!existing) return state

        const updated = { ...existing, ...updates }
        const byId = new Map(state.byId)
        byId.set(id, updated)

        return {
          items: state.items.map((item) => (item.id === id ? updated : item)),
          byId
        }
      })
    },

    removeItem: (id) => {
      set((state) => {
        const byId = new Map(state.byId)
        byId.delete(id)
        return {
          items: state.items.filter((item) => item.id !== id),
          byId
        }
      })
    },

    // Async Actions
    loadItems: async (startDate, endDate) => {
      set({ loading: true, error: null })
      try {
        const meetings = await window.electronAPI.meetings.getAll(startDate, endDate)
        get().setItems(meetings)
        set({ loading: false })
      } catch (error) {
        console.error('Failed to load meetings:', error)
        set({ loading: false, error: String(error) })
      }
    },

    refreshItem: async (id) => {
      try {
        const result = await window.electronAPI.meetings.getById(id)
        if (result.success) {
          get().updateItem(id, result.data)
        }
      } catch (error) {
        console.error(`Failed to refresh meeting ${id}:`, error)
      }
    }
  }))
)

// =============================================================================
// Selector Hooks
// =============================================================================

/**
 * Get a meeting by ID
 */
export const useMeetingById = (id: string | null) => {
  return useMeetingsStore((state) => (id ? state.byId.get(id) : null))
}

/**
 * Get meetings by date (matches start_time date)
 */
export const useMeetingsByDate = (date: Date) => {
  return useMeetingsStore((state) => {
    const targetDate = date.toISOString().split('T')[0] // Get YYYY-MM-DD
    return state.items.filter((meeting) => {
      const meetingDate = new Date(meeting.start_time).toISOString().split('T')[0]
      return meetingDate === targetDate
    })
  })
}

/**
 * Get meetings within a date range
 */
export const useMeetingsByDateRange = (startDate: Date, endDate: Date) => {
  return useMeetingsStore((state) => {
    const start = startDate.getTime()
    const end = endDate.getTime()
    return state.items.filter((meeting) => {
      const meetingTime = new Date(meeting.start_time).getTime()
      return meetingTime >= start && meetingTime <= end
    })
  })
}

/**
 * Get recurring meetings
 */
export const useRecurringMeetings = () => {
  return useMeetingsStore((state) => state.items.filter((meeting) => meeting.is_recurring === 1))
}

/**
 * Get meetings by organizer email
 */
export const useMeetingsByOrganizer = (organizerEmail: string | null) => {
  return useMeetingsStore((state) =>
    organizerEmail
      ? state.items.filter((meeting) => meeting.organizer_email === organizerEmail)
      : []
  )
}
