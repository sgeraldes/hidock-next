import { create } from 'zustand'
import type { Meeting, Recording, AppConfig, CalendarSyncResult } from '@/types'
import type { HiDockDeviceState, ConnectionStatus, ActivityLogEntry } from '@/services/hidock-device'

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
  deviceRecordings: Recording[]
  recordingsLoading: boolean

  // Unified recordings (persists across page navigation)
  unifiedRecordings: any[] // UnifiedRecording[] - using any to avoid circular imports
  unifiedRecordingsLoaded: boolean
  unifiedRecordingsLoading: boolean
  unifiedRecordingsError: string | null

  // UI State
  currentDate: Date
  calendarView: 'day' | 'workweek' | 'week' | 'month'
  sidebarOpen: boolean
  selectedMeetingId: string | null

  // Device state (updated by OperationController)
  deviceState: HiDockDeviceState
  connectionStatus: ConnectionStatus
  activityLog: ActivityLogEntry[]

  // Device sync state (for sidebar indicator)
  deviceSyncing: boolean
  deviceSyncProgress: { current: number; total: number } | null
  deviceFileDownloading: string | null
  deviceFileProgress: number
  // ETA tracking
  deviceSyncStartTime: number | null
  deviceSyncBytesDownloaded: number
  deviceSyncTotalBytes: number
  deviceSyncEta: number | null // seconds remaining

  // Download queue state (persists across page navigation)
  downloadQueue: Map<string, { filename: string; progress: number; size: number }>

  // Actions
  setConfig: (config: AppConfig) => void
  loadConfig: () => Promise<void>
  updateConfig: <K extends keyof AppConfig>(section: K, values: Partial<AppConfig[K]>) => Promise<void>

  setMeetings: (meetings: Meeting[]) => void
  loadMeetings: (startDate?: string, endDate?: string) => Promise<void>
  syncCalendar: () => Promise<CalendarSyncResult>

  setRecordings: (recordings: Recording[]) => void
  setDeviceRecordings: (recordings: Recording[]) => void
  loadAllRecordings: () => Promise<void> // Load both database and device recordings
  loadRecordings: () => Promise<void>

  // Unified recordings actions (persists across page navigation)
  setUnifiedRecordings: (recordings: any[]) => void
  setUnifiedRecordingsLoading: (loading: boolean) => void
  setUnifiedRecordingsError: (error: string | null) => void
  markUnifiedRecordingsLoaded: () => void
  invalidateUnifiedRecordings: () => void // Force reload on next access

  setCurrentDate: (date: Date) => void
  setCalendarView: (view: 'day' | 'workweek' | 'week' | 'month') => void
  toggleSidebar: () => void
  setSelectedMeetingId: (id: string | null) => void

  navigateWeek: (direction: 'prev' | 'next') => void
  navigateMonth: (direction: 'prev' | 'next') => void
  goToToday: () => void

  // Device state actions (updated by OperationController)
  setDeviceState: (state: HiDockDeviceState) => void
  setConnectionStatus: (status: ConnectionStatus) => void
  addActivityLogEntry: (entry: ActivityLogEntry) => void
  clearActivityLog: () => void

  // Device sync actions
  setDeviceSyncState: (state: {
    deviceSyncing?: boolean
    deviceSyncProgress?: { current: number; total: number } | null
    deviceFileDownloading?: string | null
    deviceFileProgress?: number
    deviceSyncStartTime?: number | null
    deviceSyncBytesDownloaded?: number
    deviceSyncTotalBytes?: number
    deviceSyncEta?: number | null
  }) => void
  clearDeviceSyncState: () => void
  cancelDeviceSync: () => void

  // Download queue actions
  addToDownloadQueue: (id: string, filename: string, size: number) => void
  updateDownloadProgress: (id: string, progress: number) => void
  removeFromDownloadQueue: (id: string) => void
  isDownloading: (id: string) => boolean
  getDownloadProgress: (id: string) => number | null
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
  deviceRecordings: [],
  recordingsLoading: false,

  // Unified recordings initial state
  unifiedRecordings: [],
  unifiedRecordingsLoaded: false,
  unifiedRecordingsLoading: false,
  unifiedRecordingsError: null,

  currentDate: new Date(),
  calendarView: 'week',
  sidebarOpen: true,
  selectedMeetingId: null,

  // Device state initial state
  deviceState: {
    connected: false,
    model: 'unknown',
    serialNumber: null,
    firmwareVersion: null,
    storage: null,
    settings: null,
    recordingCount: 0
  },
  connectionStatus: { step: 'idle', message: 'Not connected' },
  activityLog: [],

  // Device sync initial state
  deviceSyncing: false,
  deviceSyncProgress: null,
  deviceFileDownloading: null,
  deviceFileProgress: 0,
  deviceSyncStartTime: null,
  deviceSyncBytesDownloaded: 0,
  deviceSyncTotalBytes: 0,
  deviceSyncEta: null,

  // Download queue initial state
  downloadQueue: new Map(),

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
  setDeviceRecordings: (recordings) => set({ deviceRecordings: recordings }),

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

  loadAllRecordings: async () => {
    set({ recordingsLoading: true })
    try {
      // Load all recordings from database (includes device-only, local-only, both)
      const recordings = await window.electronAPI.recordings.getAll()
      set({ recordings, recordingsLoading: false })
    } catch (error) {
      console.error('Failed to load all recordings:', error)
      set({ recordingsLoading: false })
    }
  },

  // Unified recordings actions
  setUnifiedRecordings: (recordings) => set({ unifiedRecordings: recordings }),
  setUnifiedRecordingsLoading: (loading) => set({ unifiedRecordingsLoading: loading }),
  setUnifiedRecordingsError: (error) => set({ unifiedRecordingsError: error }),
  markUnifiedRecordingsLoaded: () => set({ unifiedRecordingsLoaded: true }),
  invalidateUnifiedRecordings: () => set({ unifiedRecordingsLoaded: false }),

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

  goToToday: () => set({ currentDate: new Date() }),

  // Device state actions
  setDeviceState: (deviceState) => set({ deviceState }),
  setConnectionStatus: (connectionStatus) => set({ connectionStatus }),
  addActivityLogEntry: (entry) => set((state) => {
    const MAX_LOG_ENTRIES = 100
    const newLog = [...state.activityLog, entry]
    return { activityLog: newLog.slice(-MAX_LOG_ENTRIES) }
  }),
  clearActivityLog: () => set({ activityLog: [] }),

  // Device sync actions
  setDeviceSyncState: (state) => set((prev) => ({
    deviceSyncing: state.deviceSyncing ?? prev.deviceSyncing,
    deviceSyncProgress: state.deviceSyncProgress !== undefined ? state.deviceSyncProgress : prev.deviceSyncProgress,
    deviceFileDownloading: state.deviceFileDownloading !== undefined ? state.deviceFileDownloading : prev.deviceFileDownloading,
    deviceFileProgress: state.deviceFileProgress ?? prev.deviceFileProgress,
    deviceSyncStartTime: state.deviceSyncStartTime !== undefined ? state.deviceSyncStartTime : prev.deviceSyncStartTime,
    deviceSyncBytesDownloaded: state.deviceSyncBytesDownloaded ?? prev.deviceSyncBytesDownloaded,
    deviceSyncTotalBytes: state.deviceSyncTotalBytes ?? prev.deviceSyncTotalBytes,
    deviceSyncEta: state.deviceSyncEta !== undefined ? state.deviceSyncEta : prev.deviceSyncEta,
  })),

  clearDeviceSyncState: () => set({
    deviceSyncing: false,
    deviceSyncProgress: null,
    deviceFileDownloading: null,
    deviceFileProgress: 0,
    deviceSyncStartTime: null,
    deviceSyncBytesDownloaded: 0,
    deviceSyncTotalBytes: 0,
    deviceSyncEta: null,
  }),

  // Cancel is signaled via state - DownloadController checks this
  cancelDeviceSync: () => set({ deviceSyncing: false }),

  // Download queue actions
  addToDownloadQueue: (id, filename, size) => set((state) => {
    const newQueue = new Map(state.downloadQueue)
    newQueue.set(id, { filename, progress: 0, size })
    return { downloadQueue: newQueue }
  }),

  updateDownloadProgress: (id, progress) => set((state) => {
    const item = state.downloadQueue.get(id)
    if (!item) return state
    const newQueue = new Map(state.downloadQueue)
    newQueue.set(id, { ...item, progress })
    return { downloadQueue: newQueue }
  }),

  removeFromDownloadQueue: (id) => set((state) => {
    const newQueue = new Map(state.downloadQueue)
    newQueue.delete(id)
    return { downloadQueue: newQueue }
  }),

  isDownloading: (id) => get().downloadQueue.has(id),

  getDownloadProgress: (id) => {
    const item = get().downloadQueue.get(id)
    return item ? item.progress : null
  },
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
