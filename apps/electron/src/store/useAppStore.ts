import { create } from 'zustand'
import type { Meeting, Recording, AppConfig, CalendarSyncResult } from '@/types'

interface AppState {
  // Config
  config: AppConfig | null
  configLoading: boolean

  // Calendar
  meetings: Meeting[]
  meetingsLoading: boolean
  lastCalendarSync: string | null
  calendarSyncing: boolean

  // Recordings
  recordings: Recording[]
  recordingsLoading: boolean

  // UI State
  currentDate: Date
  calendarView: 'day' | 'workweek' | 'week' | 'month'
  sidebarOpen: boolean
  selectedMeetingId: string | null

  // Actions
  setConfig: (config: AppConfig) => void
  loadConfig: () => Promise<void>
  updateConfig: <K extends keyof AppConfig>(section: K, values: Partial<AppConfig[K]>) => Promise<void>

  setMeetings: (meetings: Meeting[]) => void
  loadMeetings: (startDate?: string, endDate?: string) => Promise<void>
  syncCalendar: () => Promise<CalendarSyncResult>

  setRecordings: (recordings: Recording[]) => void
  loadRecordings: () => Promise<void>

  setCurrentDate: (date: Date) => void
  setCalendarView: (view: 'day' | 'workweek' | 'week' | 'month') => void
  toggleSidebar: () => void
  setSelectedMeetingId: (id: string | null) => void

  navigateWeek: (direction: 'prev' | 'next') => void
  navigateMonth: (direction: 'prev' | 'next') => void
  goToToday: () => void
}

export const useAppStore = create<AppState>((set, get) => ({
  // Initial state
  config: null,
  configLoading: false,

  meetings: [],
  meetingsLoading: false,
  lastCalendarSync: null,
  calendarSyncing: false,

  recordings: [],
  recordingsLoading: false,

  currentDate: new Date(),
  calendarView: 'week',
  sidebarOpen: true,
  selectedMeetingId: null,

  // Config actions
  setConfig: (config) => set({ config }),

  loadConfig: async () => {
    set({ configLoading: true })
    try {
      const config = await window.electronAPI.config.get()
      set({ config, configLoading: false })
    } catch (error) {
      console.error('Failed to load config:', error)
      set({ configLoading: false })
    }
  },

  updateConfig: async (section, values) => {
    try {
      const newConfig = await window.electronAPI.config.updateSection(section, values)
      set({ config: newConfig })
    } catch (error) {
      console.error('Failed to update config:', error)
    }
  },

  // Meeting actions
  setMeetings: (meetings) => set({ meetings }),

  loadMeetings: async (startDate, endDate) => {
    set({ meetingsLoading: true })
    try {
      const meetings = await window.electronAPI.meetings.getAll(startDate, endDate)
      set({ meetings, meetingsLoading: false })
    } catch (error) {
      console.error('Failed to load meetings:', error)
      set({ meetingsLoading: false })
    }
  },

  syncCalendar: async () => {
    set({ calendarSyncing: true })
    try {
      const result = await window.electronAPI.calendar.sync()
      if (result.success) {
        // Reload meetings after sync
        const { currentDate, calendarView } = get()
        const startDate = getViewStartDate(currentDate, calendarView)
        const endDate = getViewEndDate(currentDate, calendarView)
        await get().loadMeetings(startDate.toISOString(), endDate.toISOString())
        set({ lastCalendarSync: result.lastSync || new Date().toISOString() })
      }
      set({ calendarSyncing: false })
      return result
    } catch (error) {
      console.error('Failed to sync calendar:', error)
      set({ calendarSyncing: false })
      return { success: false, meetingsCount: 0, error: String(error) }
    }
  },

  // Recording actions
  setRecordings: (recordings) => set({ recordings }),

  loadRecordings: async () => {
    set({ recordingsLoading: true })
    try {
      const recordings = await window.electronAPI.recordings.getAll()
      set({ recordings, recordingsLoading: false })
    } catch (error) {
      console.error('Failed to load recordings:', error)
      set({ recordingsLoading: false })
    }
  },

  // UI actions
  setCurrentDate: (date) => set({ currentDate: date }),
  setCalendarView: (view) => set({ calendarView: view }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSelectedMeetingId: (id) => set({ selectedMeetingId: id }),

  navigateWeek: (direction) => {
    const { currentDate } = get()
    const newDate = new Date(currentDate)
    newDate.setDate(newDate.getDate() + (direction === 'next' ? 7 : -7))
    set({ currentDate: newDate })
  },

  navigateMonth: (direction) => {
    const { currentDate } = get()
    const newDate = new Date(currentDate)
    newDate.setMonth(newDate.getMonth() + (direction === 'next' ? 1 : -1))
    set({ currentDate: newDate })
  },

  goToToday: () => set({ currentDate: new Date() })
}))

// Helper functions
function getViewStartDate(date: Date, view: 'day' | 'workweek' | 'week' | 'month'): Date {
  const start = new Date(date)
  if (view === 'day') {
    // Just the current day
  } else if (view === 'workweek' || view === 'week') {
    const day = start.getDay()
    const diff = start.getDate() - day + (day === 0 ? -6 : 1) // Monday start
    start.setDate(diff)
  } else {
    start.setDate(1)
  }
  start.setHours(0, 0, 0, 0)
  return start
}

function getViewEndDate(date: Date, view: 'day' | 'workweek' | 'week' | 'month'): Date {
  const end = new Date(date)
  if (view === 'day') {
    // Just the current day
  } else if (view === 'workweek') {
    const start = getViewStartDate(date, view)
    end.setTime(start.getTime())
    end.setDate(end.getDate() + 4) // Mon-Fri
  } else if (view === 'week') {
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
