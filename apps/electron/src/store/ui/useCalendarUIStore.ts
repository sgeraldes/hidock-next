/**
 * Calendar UI Store (UI)
 *
 * Manages UI state specific to the Calendar page.
 * Includes selected date, view mode, and calendar-specific UI interactions.
 * Persists view preferences using persist middleware.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type CalendarViewMode = 'day' | 'week' | 'month'

export interface CalendarUIStore {
  // State
  selectedDate: Date
  viewMode: CalendarViewMode
  selectedMeetingId: string | null

  // Actions
  setSelectedDate: (date: Date) => void
  setViewMode: (mode: CalendarViewMode) => void
  setSelectedMeetingId: (id: string | null) => void
  navigateDate: (direction: 'prev' | 'next') => void
  goToToday: () => void
}

export const useCalendarUIStore = create<CalendarUIStore>()(
  persist(
    (set, get) => ({
      // Initial state
      selectedDate: new Date(),
      viewMode: 'week',
      selectedMeetingId: null,

      // Actions
      setSelectedDate: (date) => {
        set({ selectedDate: date })
      },

      setViewMode: (mode) => {
        set({ viewMode: mode })
      },

      setSelectedMeetingId: (id) => {
        set({ selectedMeetingId: id })
      },

      navigateDate: (direction) => {
        const { selectedDate, viewMode } = get()
        const newDate = new Date(selectedDate)

        switch (viewMode) {
          case 'day':
            newDate.setDate(newDate.getDate() + (direction === 'next' ? 1 : -1))
            break
          case 'week':
            newDate.setDate(newDate.getDate() + (direction === 'next' ? 7 : -7))
            break
          case 'month':
            newDate.setMonth(newDate.getMonth() + (direction === 'next' ? 1 : -1))
            break
        }

        set({ selectedDate: newDate })
      },

      goToToday: () => {
        set({ selectedDate: new Date() })
      }
    }),
    {
      name: 'calendar-ui-store', // localStorage key
      partialize: (state) => ({
        // Only persist view mode
        viewMode: state.viewMode
      })
    }
  )
)

// =============================================================================
// Helper Functions for Date Calculations
// =============================================================================

/**
 * Get the start date for the current view
 */
export const getViewStartDate = (date: Date, view: CalendarViewMode): Date => {
  const start = new Date(date)
  if (view === 'day') {
    // Just the current day
  } else if (view === 'week') {
    const day = start.getDay()
    const diff = start.getDate() - day + (day === 0 ? -6 : 1) // Monday start
    start.setDate(diff)
  } else {
    // month
    start.setDate(1)
  }
  start.setHours(0, 0, 0, 0)
  return start
}

/**
 * Get the end date for the current view
 */
export const getViewEndDate = (date: Date, view: CalendarViewMode): Date => {
  const end = new Date(date)
  if (view === 'day') {
    // Just the current day
  } else if (view === 'week') {
    const start = getViewStartDate(date, view)
    end.setTime(start.getTime())
    end.setDate(end.getDate() + 6)
  } else {
    // month
    end.setMonth(end.getMonth() + 1)
    end.setDate(0) // Last day of current month
  }
  end.setHours(23, 59, 59, 999)
  return end
}

// =============================================================================
// Selector Hooks
// =============================================================================

/**
 * Get the date range for the current view
 */
export const useViewDateRange = () => {
  return useCalendarUIStore((state) => {
    const start = getViewStartDate(state.selectedDate, state.viewMode)
    const end = getViewEndDate(state.selectedDate, state.viewMode)
    return { start, end }
  })
}

/**
 * Check if a date is in the current view
 */
export const useIsDateInView = (date: Date) => {
  return useCalendarUIStore((state) => {
    const start = getViewStartDate(state.selectedDate, state.viewMode)
    const end = getViewEndDate(state.selectedDate, state.viewMode)
    const dateTime = date.getTime()
    return dateTime >= start.getTime() && dateTime <= end.getTime()
  })
}

/**
 * Check if a specific meeting is selected
 */
export const useIsMeetingSelected = (id: string) => {
  return useCalendarUIStore((state) => state.selectedMeetingId === id)
}
