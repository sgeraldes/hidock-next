import { create } from 'zustand'
import type { Meeting, CalendarSyncResult } from '@/types'
import type { HiDockDeviceState, ConnectionStatus, ActivityLogEntry } from '@/services/hidock-device'
import type { UnifiedRecording } from '@/types/unified-recording'
// CA-10: CalendarViewType shared between store and calendar-utils
import type { CalendarViewType } from '@/lib/calendar-utils'

/**
 * Returns the canonical download queue key for a recording.
 * The standard key is `deviceFilename` (original device filename with extension).
 * Returns null for recordings that are not downloadable (local-only).
 */
export function getDownloadQueueKey(recording: UnifiedRecording): string | null {
  if (recording.location === 'device-only' || recording.location === 'both') {
    return recording.deviceFilename
  }
  return null
}

interface AppState {
  // Calendar
  meetings: Meeting[]
  meetingsLoading: boolean
  lastCalendarSync: string | null
  calendarSyncing: boolean

  // Unified recordings (persists across page navigation)
  unifiedRecordings: UnifiedRecording[]
  unifiedRecordingsLoaded: boolean
  unifiedRecordingsLoading: boolean
  unifiedRecordingsLoadingCount: number
  unifiedRecordingsError: string | null

  // UI State
  currentDate: Date
  calendarView: CalendarViewType

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
  setMeetings: (meetings: Meeting[]) => void
  loadMeetings: (startDate?: string, endDate?: string) => Promise<void>
  syncCalendar: () => Promise<CalendarSyncResult>
  setLastCalendarSync: (lastSync: string | null) => void
  setCalendarSyncing: (syncing: boolean) => void

  // Unified recordings actions (persists across page navigation)
  setUnifiedRecordings: (recordings: UnifiedRecording[]) => void
  setUnifiedRecordingsLoading: (loading: boolean) => void
  incrementUnifiedRecordingsLoading: () => void
  decrementUnifiedRecordingsLoading: () => void
  setUnifiedRecordingsError: (error: string | null) => void
  markUnifiedRecordingsLoaded: () => void
  invalidateUnifiedRecordings: () => void // Force reload on next access

  setCurrentDate: (date: Date) => void
  setCalendarView: (view: CalendarViewType) => void
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
  clearDownloadQueue: () => void
  /**
   * @deprecated Use `useIsDownloading(id)` selector hook instead.
   * This method uses `get()` which causes over-subscription - the caller re-renders
   * on any store change, not just downloadQueue changes.
   */
  isDownloading: (id: string) => boolean
  /**
   * @deprecated Use `useDownloadProgress(id)` selector hook instead.
   * This method uses `get()` which causes over-subscription - the caller re-renders
   * on any store change, not just downloadQueue changes.
   */
  getDownloadProgress: (id: string) => number | null
}

export const useAppStore = create<AppState>((set, get) => ({
  // Initial state
  meetings: [],
  meetingsLoading: false,
  lastCalendarSync: null,
  calendarSyncing: false,

  // Unified recordings initial state
  unifiedRecordings: [],
  unifiedRecordingsLoaded: false,
  unifiedRecordingsLoading: false,
  unifiedRecordingsLoadingCount: 0,
  unifiedRecordingsError: null,

  currentDate: new Date(),
  calendarView: 'week',
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

  // Meeting actions
  setMeetings: (meetings) => set({ meetings }),
  setLastCalendarSync: (lastSync) => set({ lastCalendarSync: lastSync }),
  setCalendarSyncing: (syncing) => set({ calendarSyncing: syncing }),

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

  // Unified recordings actions
  setUnifiedRecordings: (recordings) => set({ unifiedRecordings: recordings }),
  setUnifiedRecordingsLoading: (loading) => set({ unifiedRecordingsLoading: loading }),
  incrementUnifiedRecordingsLoading: () => set((state) => {
    const newCount = state.unifiedRecordingsLoadingCount + 1
    return { unifiedRecordingsLoadingCount: newCount, unifiedRecordingsLoading: newCount > 0 }
  }),
  decrementUnifiedRecordingsLoading: () => set((state) => {
    const newCount = Math.max(0, state.unifiedRecordingsLoadingCount - 1)
    return { unifiedRecordingsLoadingCount: newCount, unifiedRecordingsLoading: newCount > 0 }
  }),
  setUnifiedRecordingsError: (error) => set({ unifiedRecordingsError: error }),
  markUnifiedRecordingsLoaded: () => set({ unifiedRecordingsLoaded: true }),
  invalidateUnifiedRecordings: () => set({ unifiedRecordingsLoaded: false }),

  // UI actions
  setCurrentDate: (date) => set({ currentDate: date }),
  setCalendarView: (view) => set({ calendarView: view }),

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

  // Cancel is signaled via state - useDownloadOrchestrator checks this
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

  clearDownloadQueue: () => set({ downloadQueue: new Map() }),

  // SM-M01: Deprecated methods that use get() causing over-subscription.
  // Components should use useIsDownloading(id) and useDownloadProgress(id) selector hooks instead.
  isDownloading: (id) => {
    if (import.meta.env.DEV) {
      console.warn(
        '[useAppStore] isDownloading() is deprecated and causes over-subscription. ' +
        'Use the useIsDownloading(id) selector hook instead.'
      )
    }
    return get().downloadQueue.has(id)
  },

  getDownloadProgress: (id) => {
    if (import.meta.env.DEV) {
      console.warn(
        '[useAppStore] getDownloadProgress() is deprecated and causes over-subscription. ' +
        'Use the useDownloadProgress(id) selector hook instead.'
      )
    }
    const item = get().downloadQueue.get(id)
    return item ? item.progress : null
  },
}))

// Helper functions
function getViewStartDate(date: Date, view: CalendarViewType): Date {
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

function getViewEndDate(date: Date, view: CalendarViewType): Date {
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

// ========================================
// Granular Selectors (SM-02 fix)
// ========================================
// Export individual selectors to prevent over-subscription and unnecessary re-renders.
// Components should use these instead of destructuring the entire store.

// Calendar selectors
export const useMeetings = () => useAppStore((s) => s.meetings)
export const useMeetingsLoading = () => useAppStore((s) => s.meetingsLoading)
export const useLastCalendarSync = () => useAppStore((s) => s.lastCalendarSync)
export const useCalendarSyncing = () => useAppStore((s) => s.calendarSyncing)
export const useCalendarView = () => useAppStore((s) => s.calendarView)
export const useCurrentDate = () => useAppStore((s) => s.currentDate)
// Calendar action selectors (B-CAL-001: named actions replace raw setState)
export const useSetLastCalendarSync = () => useAppStore((s) => s.setLastCalendarSync)
export const useSetCalendarSyncing = () => useAppStore((s) => s.setCalendarSyncing)

// Device state selectors
export const useDeviceState = () => useAppStore((s) => s.deviceState)
export const useConnectionStatus = () => useAppStore((s) => s.connectionStatus)
export const useDeviceConnected = () => useAppStore((s) => s.deviceState.connected)
export const useActivityLog = () => useAppStore((s) => s.activityLog)

// Device sync selectors
export const useDeviceSyncing = () => useAppStore((s) => s.deviceSyncing)
export const useDeviceSyncProgress = () => useAppStore((s) => s.deviceSyncProgress)
export const useDeviceSyncEta = () => useAppStore((s) => s.deviceSyncEta)

// Download queue selectors
export const useDownloadQueue = () => useAppStore((s) => s.downloadQueue)
export const useIsDownloading = (id: string) => useAppStore((s) => s.downloadQueue.has(id))
export const useDownloadProgress = (id: string) => useAppStore((s) => s.downloadQueue.get(id)?.progress ?? null)

// Unified recordings selectors
export const useUnifiedRecordings = () => useAppStore((s) => s.unifiedRecordings)
export const useUnifiedRecordingsLoading = () => useAppStore((s) => s.unifiedRecordingsLoading)
export const useUnifiedRecordingsError = () => useAppStore((s) => s.unifiedRecordingsError)
