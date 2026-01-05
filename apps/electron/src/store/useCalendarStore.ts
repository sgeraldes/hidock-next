/**
 * Calendar Store
 *
 * Manages calendar state including meetings, current date, view mode, and sync status.
 * Split from the monolithic useAppStore for better separation of concerns.
 */

import { create } from 'zustand'
import type { CalendarSyncResult } from '@/types'
import type { CalendarStore } from '@/types/stores'

// Helper functions
function getViewStartDate(date: Date, view: 'week' | 'month'): Date {
  const start = new Date(date)
  if (view === 'week') {
    const day = start.getDay()
    const diff = start.getDate() - day + (day === 0 ? -6 : 1) // Monday start
    start.setDate(diff)
  } else {
    start.setDate(1)
  }
  start.setHours(0, 0, 0, 0)
  return start
}

function getViewEndDate(date: Date, view: 'week' | 'month'): Date {
  const end = new Date(date)
  if (view === 'week') {
    const start = getViewStartDate(date, view)
    end.setTime(start.getTime())
    end.setDate(end.getDate() + 6)
  } else {
    end.setMonth(end.getMonth() + 1)
    end.setDate(0) // Last day of current month
  }
  end.setHours(23, 59, 59, 999)
  return end
}

export const useCalendarStore = create<CalendarStore>((set, get) => ({
  // State
  meetings: [],
  loading: false,
  syncing: false,
  currentDate: new Date(),
  view: 'week',
  lastSyncAt: null,

  // Actions
  loadMeetings: async (startDate?: string, endDate?: string) => {
    set({ loading: true })
    try {
      // If no dates provided, use current view
      let start = startDate
      let end = endDate
      if (!start || !end) {
        const { currentDate, view } = get()
        start = getViewStartDate(currentDate, view).toISOString()
        end = getViewEndDate(currentDate, view).toISOString()
      }

      const meetings = await window.electronAPI.meetings.getAll(start, end)
      set({ meetings, loading: false })
    } catch (error) {
      console.error('Failed to load meetings:', error)
      set({ loading: false })
    }
  },

  syncCalendar: async (): Promise<{ success: boolean; meetingsCount: number; error?: string }> => {
    set({ syncing: true })
    try {
      const result: CalendarSyncResult = await window.electronAPI.calendar.sync()
      if (result.success) {
        // Reload meetings after sync
        await get().loadMeetings()
        set({ lastSyncAt: result.lastSync || new Date().toISOString() })
      }
      set({ syncing: false })
      return result
    } catch (error) {
      console.error('Failed to sync calendar:', error)
      set({ syncing: false })
      return { success: false, meetingsCount: 0, error: String(error) }
    }
  },

  navigateWeek: (direction: 'prev' | 'next') => {
    const { currentDate } = get()
    const newDate = new Date(currentDate)
    newDate.setDate(newDate.getDate() + (direction === 'next' ? 7 : -7))
    set({ currentDate: newDate })
    // Reload meetings for new date range
    get().loadMeetings()
  },

  navigateMonth: (direction: 'prev' | 'next') => {
    const { currentDate } = get()
    const newDate = new Date(currentDate)
    newDate.setMonth(newDate.getMonth() + (direction === 'next' ? 1 : -1))
    set({ currentDate: newDate })
    // Reload meetings for new date range
    get().loadMeetings()
  },

  setView: (view: 'week' | 'month') => {
    set({ view })
    // Reload meetings for new view
    get().loadMeetings()
  },

  goToToday: () => {
    set({ currentDate: new Date() })
    get().loadMeetings()
  },

  setCurrentDate: (date: Date) => {
    set({ currentDate: date })
    get().loadMeetings()
  }
}))
