/**
 * Comprehensive tests for useAppStore
 *
 * Tests cover core store functionality (excluding async actions that call electronAPI):
 * - Initial state verification
 * - Device connection state: setDeviceState, setConnectionStatus
 * - Activity log: addActivityLogEntry, clearActivityLog (with max entries cap)
 * - Device sync state: setDeviceSyncState, clearDeviceSyncState, cancelDeviceSync
 * - Download queue: addToDownloadQueue, updateDownloadProgress, removeFromDownloadQueue
 * - Download queries: isDownloading, getDownloadProgress
 * - Calendar UI state: setCalendarView, setCurrentDate, navigateWeek, navigateMonth, goToToday
 * - Unified recordings: setUnifiedRecordings, setUnifiedRecordingsLoading,
 *   setUnifiedRecordingsError, markUnifiedRecordingsLoaded, invalidateUnifiedRecordings
 * - Meetings: setMeetings
 * - Map integrity for downloadQueue
 * - State isolation and edge cases
 *
 * NOTE: loadMeetings and syncCalendar are async and call window.electronAPI, so they
 * are not tested here. They would require mocking the full electronAPI.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { useAppStore } from '@/store/useAppStore'
import type { HiDockDeviceState, ConnectionStatus, ActivityLogEntry } from '@/services/hidock-device'

// Reset store before each test
beforeEach(() => {
  const store = useAppStore.getState()

  // Reset meetings
  store.setMeetings([])

  // Reset unified recordings
  store.setUnifiedRecordings([])
  store.setUnifiedRecordingsLoading(false)
  store.setUnifiedRecordingsError(null)
  store.invalidateUnifiedRecordings()
  // Reset counter-based loading (B-LIB-001)
  useAppStore.setState({ unifiedRecordingsLoadingCount: 0 })

  // Reset calendar
  store.setCurrentDate(new Date(2026, 1, 26)) // Fixed date for deterministic tests
  store.setCalendarView('week')

  // Reset device state
  store.setDeviceState({
    connected: false,
    model: 'unknown',
    serialNumber: null,
    firmwareVersion: null,
    storage: null,
    settings: null,
    recordingCount: 0
  })
  store.setConnectionStatus({ step: 'idle', message: 'Not connected' })
  store.clearActivityLog()

  // Reset sync state
  store.clearDeviceSyncState()

  // Reset download queue
  const queue = store.downloadQueue
  queue.forEach((_, id) => {
    useAppStore.getState().removeFromDownloadQueue(id)
  })
})

describe('useAppStore', () => {
  describe('Initial State', () => {
    it('has correct default state values', () => {
      const state = useAppStore.getState()

      expect(state.meetings).toEqual([])
      expect(state.meetingsLoading).toBe(false)
      expect(state.lastCalendarSync).toBeNull()
      expect(state.calendarSyncing).toBe(false)
      expect(state.unifiedRecordings).toEqual([])
      expect(state.unifiedRecordingsLoaded).toBe(false)
      expect(state.unifiedRecordingsLoading).toBe(false)
      expect(state.unifiedRecordingsError).toBeNull()
      expect(state.calendarView).toBe('week')
      expect(state.deviceState.connected).toBe(false)
      expect(state.deviceState.model).toBe('unknown')
      expect(state.connectionStatus.step).toBe('idle')
      expect(state.activityLog).toEqual([])
      expect(state.deviceSyncing).toBe(false)
      expect(state.deviceSyncProgress).toBeNull()
      expect(state.downloadQueue.size).toBe(0)
    })
  })

  describe('Device Connection State', () => {
    it('setDeviceState updates full device state', () => {
      const { setDeviceState } = useAppStore.getState()

      const newState: HiDockDeviceState = {
        connected: true,
        model: 'H1' as any,
        serialNumber: 'SN-12345',
        firmwareVersion: '2.1.0',
        storage: {
          used: 500000,
          capacity: 4000000,
          freePercent: 87.5
        },
        settings: null,
        recordingCount: 15
      }

      setDeviceState(newState)

      const state = useAppStore.getState().deviceState
      expect(state.connected).toBe(true)
      expect(state.model).toBe('H1')
      expect(state.serialNumber).toBe('SN-12345')
      expect(state.firmwareVersion).toBe('2.1.0')
      expect(state.storage).toEqual({
        used: 500000,
        capacity: 4000000,
        freePercent: 87.5
      })
      expect(state.recordingCount).toBe(15)
    })

    it('setDeviceState replaces entire state object', () => {
      const { setDeviceState } = useAppStore.getState()

      setDeviceState({
        connected: true,
        model: 'H1' as any,
        serialNumber: 'SN-001',
        firmwareVersion: '1.0',
        storage: null,
        settings: null,
        recordingCount: 5
      })

      setDeviceState({
        connected: false,
        model: 'unknown' as any,
        serialNumber: null,
        firmwareVersion: null,
        storage: null,
        settings: null,
        recordingCount: 0
      })

      const state = useAppStore.getState().deviceState
      expect(state.connected).toBe(false)
      expect(state.serialNumber).toBeNull()
    })

    it('setConnectionStatus updates connection status', () => {
      const { setConnectionStatus } = useAppStore.getState()

      setConnectionStatus({ step: 'requesting', message: 'Requesting device access...' })

      const status = useAppStore.getState().connectionStatus
      expect(status.step).toBe('requesting')
      expect(status.message).toBe('Requesting device access...')
    })

    it('setConnectionStatus supports progress field', () => {
      const { setConnectionStatus } = useAppStore.getState()

      setConnectionStatus({ step: 'getting-info', message: 'Getting device info...', progress: 50 })

      const status = useAppStore.getState().connectionStatus
      expect(status.progress).toBe(50)
    })

    it('setConnectionStatus transitions through connection steps', () => {
      const { setConnectionStatus } = useAppStore.getState()
      const steps: ConnectionStatus[] = [
        { step: 'idle', message: 'Not connected' },
        { step: 'requesting', message: 'Requesting...' },
        { step: 'opening', message: 'Opening...' },
        { step: 'getting-info', message: 'Getting info...' },
        { step: 'ready', message: 'Connected' }
      ]

      steps.forEach((status) => {
        setConnectionStatus(status)
        expect(useAppStore.getState().connectionStatus).toEqual(status)
      })
    })
  })

  describe('Activity Log', () => {
    it('addActivityLogEntry adds entry to log', () => {
      const { addActivityLogEntry } = useAppStore.getState()

      const entry: ActivityLogEntry = {
        timestamp: new Date(),
        type: 'info',
        message: 'Device connected'
      }

      addActivityLogEntry(entry)

      const log = useAppStore.getState().activityLog
      expect(log.length).toBe(1)
      expect(log[0]).toEqual(entry)
    })

    it('addActivityLogEntry preserves entry order', () => {
      const { addActivityLogEntry } = useAppStore.getState()

      addActivityLogEntry({ timestamp: new Date(), type: 'info', message: 'First' })
      addActivityLogEntry({ timestamp: new Date(), type: 'success', message: 'Second' })
      addActivityLogEntry({ timestamp: new Date(), type: 'error', message: 'Third' })

      const log = useAppStore.getState().activityLog
      expect(log.length).toBe(3)
      expect(log[0].message).toBe('First')
      expect(log[1].message).toBe('Second')
      expect(log[2].message).toBe('Third')
    })

    it('addActivityLogEntry caps at 100 entries', () => {
      const { addActivityLogEntry } = useAppStore.getState()

      for (let i = 0; i < 110; i++) {
        addActivityLogEntry({
          timestamp: new Date(),
          type: 'info',
          message: `Entry ${i}`
        })
      }

      const log = useAppStore.getState().activityLog
      expect(log.length).toBe(100)
      // Should keep the most recent entries (last 100 of 110)
      expect(log[0].message).toBe('Entry 10')
      expect(log[99].message).toBe('Entry 109')
    })

    it('addActivityLogEntry supports all entry types', () => {
      const { addActivityLogEntry } = useAppStore.getState()
      const types: ActivityLogEntry['type'][] = ['info', 'success', 'error', 'usb-out', 'usb-in', 'warning']

      types.forEach((type) => {
        addActivityLogEntry({
          timestamp: new Date(),
          type,
          message: `Type: ${type}`
        })
      })

      expect(useAppStore.getState().activityLog.length).toBe(6)
    })

    it('addActivityLogEntry supports optional details', () => {
      const { addActivityLogEntry } = useAppStore.getState()

      addActivityLogEntry({
        timestamp: new Date(),
        type: 'error',
        message: 'USB error',
        details: 'Timeout on endpoint 0x82'
      })

      const entry = useAppStore.getState().activityLog[0]
      expect(entry.details).toBe('Timeout on endpoint 0x82')
    })

    it('clearActivityLog removes all entries', () => {
      const store = useAppStore.getState()

      store.addActivityLogEntry({ timestamp: new Date(), type: 'info', message: 'Entry 1' })
      store.addActivityLogEntry({ timestamp: new Date(), type: 'info', message: 'Entry 2' })

      useAppStore.getState().clearActivityLog()

      expect(useAppStore.getState().activityLog).toEqual([])
    })
  })

  describe('Device Sync State', () => {
    it('setDeviceSyncState updates individual sync fields', () => {
      const { setDeviceSyncState } = useAppStore.getState()

      setDeviceSyncState({ deviceSyncing: true })
      expect(useAppStore.getState().deviceSyncing).toBe(true)

      setDeviceSyncState({
        deviceSyncProgress: { current: 3, total: 10 }
      })
      expect(useAppStore.getState().deviceSyncProgress).toEqual({ current: 3, total: 10 })
    })

    it('setDeviceSyncState preserves unspecified fields', () => {
      const { setDeviceSyncState } = useAppStore.getState()

      setDeviceSyncState({ deviceSyncing: true, deviceFileDownloading: 'recording.wav' })
      setDeviceSyncState({ deviceFileProgress: 50 })

      const state = useAppStore.getState()
      expect(state.deviceSyncing).toBe(true)
      expect(state.deviceFileDownloading).toBe('recording.wav')
      expect(state.deviceFileProgress).toBe(50)
    })

    it('setDeviceSyncState handles ETA tracking fields', () => {
      const { setDeviceSyncState } = useAppStore.getState()
      const startTime = Date.now()

      setDeviceSyncState({
        deviceSyncStartTime: startTime,
        deviceSyncBytesDownloaded: 500000,
        deviceSyncTotalBytes: 2000000,
        deviceSyncEta: 45
      })

      const state = useAppStore.getState()
      expect(state.deviceSyncStartTime).toBe(startTime)
      expect(state.deviceSyncBytesDownloaded).toBe(500000)
      expect(state.deviceSyncTotalBytes).toBe(2000000)
      expect(state.deviceSyncEta).toBe(45)
    })

    it('setDeviceSyncState allows null for nullable fields', () => {
      const { setDeviceSyncState } = useAppStore.getState()

      setDeviceSyncState({
        deviceSyncProgress: { current: 5, total: 10 },
        deviceFileDownloading: 'file.wav',
        deviceSyncStartTime: Date.now(),
        deviceSyncEta: 30
      })

      setDeviceSyncState({
        deviceSyncProgress: null,
        deviceFileDownloading: null,
        deviceSyncStartTime: null,
        deviceSyncEta: null
      })

      const state = useAppStore.getState()
      expect(state.deviceSyncProgress).toBeNull()
      expect(state.deviceFileDownloading).toBeNull()
      expect(state.deviceSyncStartTime).toBeNull()
      expect(state.deviceSyncEta).toBeNull()
    })

    it('clearDeviceSyncState resets all sync fields to defaults', () => {
      const { setDeviceSyncState, clearDeviceSyncState } = useAppStore.getState()

      setDeviceSyncState({
        deviceSyncing: true,
        deviceSyncProgress: { current: 5, total: 10 },
        deviceFileDownloading: 'recording.wav',
        deviceFileProgress: 75,
        deviceSyncStartTime: Date.now(),
        deviceSyncBytesDownloaded: 500000,
        deviceSyncTotalBytes: 2000000,
        deviceSyncEta: 30
      })

      clearDeviceSyncState()

      const state = useAppStore.getState()
      expect(state.deviceSyncing).toBe(false)
      expect(state.deviceSyncProgress).toBeNull()
      expect(state.deviceFileDownloading).toBeNull()
      expect(state.deviceFileProgress).toBe(0)
      expect(state.deviceSyncStartTime).toBeNull()
      expect(state.deviceSyncBytesDownloaded).toBe(0)
      expect(state.deviceSyncTotalBytes).toBe(0)
      expect(state.deviceSyncEta).toBeNull()
    })

    it('cancelDeviceSync sets deviceSyncing to false', () => {
      const { setDeviceSyncState, cancelDeviceSync } = useAppStore.getState()

      setDeviceSyncState({ deviceSyncing: true })
      expect(useAppStore.getState().deviceSyncing).toBe(true)

      cancelDeviceSync()
      expect(useAppStore.getState().deviceSyncing).toBe(false)
    })
  })

  describe('Download Queue', () => {
    it('addToDownloadQueue adds item to queue', () => {
      const { addToDownloadQueue } = useAppStore.getState()

      addToDownloadQueue('dl-1', 'recording.wav', 1024000)

      const queue = useAppStore.getState().downloadQueue
      expect(queue.size).toBe(1)
      const item = queue.get('dl-1')
      expect(item).toBeDefined()
      expect(item!.filename).toBe('recording.wav')
      expect(item!.progress).toBe(0)
      expect(item!.size).toBe(1024000)
    })

    it('addToDownloadQueue adds multiple items', () => {
      const { addToDownloadQueue } = useAppStore.getState()

      addToDownloadQueue('dl-1', 'file1.wav', 500000)
      addToDownloadQueue('dl-2', 'file2.wav', 750000)
      addToDownloadQueue('dl-3', 'file3.wav', 1000000)

      expect(useAppStore.getState().downloadQueue.size).toBe(3)
    })

    it('addToDownloadQueue overwrites existing item with same id', () => {
      const { addToDownloadQueue } = useAppStore.getState()

      addToDownloadQueue('dl-1', 'original.wav', 500000)
      addToDownloadQueue('dl-1', 'replacement.wav', 750000)

      const queue = useAppStore.getState().downloadQueue
      expect(queue.size).toBe(1)
      expect(queue.get('dl-1')!.filename).toBe('replacement.wav')
      expect(queue.get('dl-1')!.size).toBe(750000)
    })

    it('updateDownloadProgress updates progress for existing item', () => {
      const { addToDownloadQueue, updateDownloadProgress } = useAppStore.getState()

      addToDownloadQueue('dl-1', 'recording.wav', 1000000)
      updateDownloadProgress('dl-1', 50)

      const item = useAppStore.getState().downloadQueue.get('dl-1')
      expect(item!.progress).toBe(50)
    })

    it('updateDownloadProgress does nothing for non-existent item', () => {
      const { updateDownloadProgress } = useAppStore.getState()

      updateDownloadProgress('non-existent', 50)

      expect(useAppStore.getState().downloadQueue.size).toBe(0)
    })

    it('updateDownloadProgress preserves filename and size', () => {
      const { addToDownloadQueue, updateDownloadProgress } = useAppStore.getState()

      addToDownloadQueue('dl-1', 'recording.wav', 1000000)
      updateDownloadProgress('dl-1', 75)

      const item = useAppStore.getState().downloadQueue.get('dl-1')
      expect(item!.filename).toBe('recording.wav')
      expect(item!.size).toBe(1000000)
      expect(item!.progress).toBe(75)
    })

    it('removeFromDownloadQueue removes item', () => {
      const { addToDownloadQueue, removeFromDownloadQueue } = useAppStore.getState()

      addToDownloadQueue('dl-1', 'file1.wav', 500000)
      addToDownloadQueue('dl-2', 'file2.wav', 750000)

      removeFromDownloadQueue('dl-1')

      const queue = useAppStore.getState().downloadQueue
      expect(queue.size).toBe(1)
      expect(queue.has('dl-1')).toBe(false)
      expect(queue.has('dl-2')).toBe(true)
    })

    it('removeFromDownloadQueue is safe for non-existent item', () => {
      const { addToDownloadQueue, removeFromDownloadQueue } = useAppStore.getState()

      addToDownloadQueue('dl-1', 'file.wav', 500000)
      removeFromDownloadQueue('non-existent')

      expect(useAppStore.getState().downloadQueue.size).toBe(1)
    })
  })

  describe('Download Queries', () => {
    it('isDownloading returns true for queued item', () => {
      const { addToDownloadQueue } = useAppStore.getState()

      addToDownloadQueue('dl-1', 'file.wav', 500000)

      expect(useAppStore.getState().isDownloading('dl-1')).toBe(true)
    })

    it('isDownloading returns false for non-queued item', () => {
      expect(useAppStore.getState().isDownloading('non-existent')).toBe(false)
    })

    it('isDownloading returns false after removal', () => {
      const { addToDownloadQueue, removeFromDownloadQueue } = useAppStore.getState()

      addToDownloadQueue('dl-1', 'file.wav', 500000)
      removeFromDownloadQueue('dl-1')

      expect(useAppStore.getState().isDownloading('dl-1')).toBe(false)
    })

    it('getDownloadProgress returns progress for queued item', () => {
      const { addToDownloadQueue, updateDownloadProgress } = useAppStore.getState()

      addToDownloadQueue('dl-1', 'file.wav', 500000)
      updateDownloadProgress('dl-1', 65)

      expect(useAppStore.getState().getDownloadProgress('dl-1')).toBe(65)
    })

    it('getDownloadProgress returns 0 for newly queued item', () => {
      const { addToDownloadQueue } = useAppStore.getState()

      addToDownloadQueue('dl-1', 'file.wav', 500000)

      expect(useAppStore.getState().getDownloadProgress('dl-1')).toBe(0)
    })

    it('getDownloadProgress returns null for non-queued item', () => {
      expect(useAppStore.getState().getDownloadProgress('non-existent')).toBeNull()
    })
  })

  describe('Calendar UI State', () => {
    it('setCalendarView changes view type', () => {
      const { setCalendarView } = useAppStore.getState()
      const views = ['day', 'workweek', 'week', 'month'] as const

      views.forEach((view) => {
        setCalendarView(view)
        expect(useAppStore.getState().calendarView).toBe(view)
      })
    })

    it('setCurrentDate updates current date', () => {
      const { setCurrentDate } = useAppStore.getState()
      const date = new Date(2026, 5, 15) // June 15, 2026

      setCurrentDate(date)

      expect(useAppStore.getState().currentDate).toEqual(date)
    })

    it('navigateWeek moves forward by 7 days', () => {
      const { setCurrentDate, navigateWeek } = useAppStore.getState()
      const startDate = new Date(2026, 1, 26) // Feb 26, 2026

      setCurrentDate(startDate)
      navigateWeek('next')

      const newDate = useAppStore.getState().currentDate
      expect(newDate.getDate()).toBe(5) // March 5
      expect(newDate.getMonth()).toBe(2) // March
    })

    it('navigateWeek moves backward by 7 days', () => {
      const { setCurrentDate, navigateWeek } = useAppStore.getState()
      const startDate = new Date(2026, 1, 26) // Feb 26, 2026

      setCurrentDate(startDate)
      navigateWeek('prev')

      const newDate = useAppStore.getState().currentDate
      expect(newDate.getDate()).toBe(19) // Feb 19
      expect(newDate.getMonth()).toBe(1) // February
    })

    it('navigateMonth moves forward by 1 month', () => {
      const { setCurrentDate, navigateMonth } = useAppStore.getState()
      const startDate = new Date(2026, 1, 26) // Feb 26, 2026

      setCurrentDate(startDate)
      navigateMonth('next')

      const newDate = useAppStore.getState().currentDate
      expect(newDate.getMonth()).toBe(2) // March
    })

    it('navigateMonth moves backward by 1 month', () => {
      const { setCurrentDate, navigateMonth } = useAppStore.getState()
      const startDate = new Date(2026, 1, 26) // Feb 26, 2026

      setCurrentDate(startDate)
      navigateMonth('prev')

      const newDate = useAppStore.getState().currentDate
      expect(newDate.getMonth()).toBe(0) // January
    })

    it('goToToday resets to current date', () => {
      const { setCurrentDate, goToToday } = useAppStore.getState()

      // Set to a past date
      setCurrentDate(new Date(2020, 0, 1))
      goToToday()

      const today = new Date()
      const storeDate = useAppStore.getState().currentDate
      // Should be today (same day)
      expect(storeDate.getFullYear()).toBe(today.getFullYear())
      expect(storeDate.getMonth()).toBe(today.getMonth())
      expect(storeDate.getDate()).toBe(today.getDate())
    })
  })

  describe('Unified Recordings', () => {
    it('setUnifiedRecordings sets recordings array', () => {
      const { setUnifiedRecordings } = useAppStore.getState()
      const recordings = [
        {
          id: 'rec-1',
          filename: 'meeting.wav',
          size: 1000,
          duration: 60,
          dateRecorded: new Date(),
          transcriptionStatus: 'none' as const,
          location: 'local-only' as const,
          localPath: '/path/to/meeting.wav',
          syncStatus: 'synced' as const
        }
      ]

      setUnifiedRecordings(recordings)

      expect(useAppStore.getState().unifiedRecordings).toEqual(recordings)
    })

    it('setUnifiedRecordings replaces existing recordings', () => {
      const { setUnifiedRecordings } = useAppStore.getState()

      setUnifiedRecordings([
        {
          id: 'old-1',
          filename: 'old.wav',
          size: 500,
          duration: 30,
          dateRecorded: new Date(),
          transcriptionStatus: 'none' as const,
          location: 'local-only' as const,
          localPath: '/old.wav',
          syncStatus: 'synced' as const
        }
      ])

      setUnifiedRecordings([])

      expect(useAppStore.getState().unifiedRecordings).toEqual([])
    })

    it('setUnifiedRecordingsLoading sets loading flag', () => {
      const { setUnifiedRecordingsLoading } = useAppStore.getState()

      setUnifiedRecordingsLoading(true)
      expect(useAppStore.getState().unifiedRecordingsLoading).toBe(true)

      setUnifiedRecordingsLoading(false)
      expect(useAppStore.getState().unifiedRecordingsLoading).toBe(false)
    })

    it('setUnifiedRecordingsError sets error message', () => {
      const { setUnifiedRecordingsError } = useAppStore.getState()

      setUnifiedRecordingsError('Failed to load recordings')
      expect(useAppStore.getState().unifiedRecordingsError).toBe('Failed to load recordings')
    })

    it('setUnifiedRecordingsError clears with null', () => {
      const { setUnifiedRecordingsError } = useAppStore.getState()

      setUnifiedRecordingsError('Error')
      setUnifiedRecordingsError(null)
      expect(useAppStore.getState().unifiedRecordingsError).toBeNull()
    })

    it('markUnifiedRecordingsLoaded sets loaded flag to true', () => {
      const { markUnifiedRecordingsLoaded } = useAppStore.getState()

      markUnifiedRecordingsLoaded()
      expect(useAppStore.getState().unifiedRecordingsLoaded).toBe(true)
    })

    it('invalidateUnifiedRecordings sets loaded flag to false', () => {
      const { markUnifiedRecordingsLoaded, invalidateUnifiedRecordings } = useAppStore.getState()

      markUnifiedRecordingsLoaded()
      invalidateUnifiedRecordings()
      expect(useAppStore.getState().unifiedRecordingsLoaded).toBe(false)
    })

    // B-LIB-001: Counter-based loading tests
    it('incrementUnifiedRecordingsLoading increases count and sets loading true', () => {
      const { incrementUnifiedRecordingsLoading } = useAppStore.getState()

      incrementUnifiedRecordingsLoading()
      expect(useAppStore.getState().unifiedRecordingsLoadingCount).toBe(1)
      expect(useAppStore.getState().unifiedRecordingsLoading).toBe(true)
    })

    it('decrementUnifiedRecordingsLoading decreases count', () => {
      const { incrementUnifiedRecordingsLoading, decrementUnifiedRecordingsLoading } = useAppStore.getState()

      incrementUnifiedRecordingsLoading()
      incrementUnifiedRecordingsLoading()
      decrementUnifiedRecordingsLoading()
      expect(useAppStore.getState().unifiedRecordingsLoadingCount).toBe(1)
      expect(useAppStore.getState().unifiedRecordingsLoading).toBe(true)
    })

    it('decrementUnifiedRecordingsLoading sets loading false when count reaches 0', () => {
      const { incrementUnifiedRecordingsLoading, decrementUnifiedRecordingsLoading } = useAppStore.getState()

      incrementUnifiedRecordingsLoading()
      decrementUnifiedRecordingsLoading()
      expect(useAppStore.getState().unifiedRecordingsLoadingCount).toBe(0)
      expect(useAppStore.getState().unifiedRecordingsLoading).toBe(false)
    })

    it('decrementUnifiedRecordingsLoading does not go below 0', () => {
      const { decrementUnifiedRecordingsLoading } = useAppStore.getState()

      decrementUnifiedRecordingsLoading()
      decrementUnifiedRecordingsLoading()
      expect(useAppStore.getState().unifiedRecordingsLoadingCount).toBe(0)
      expect(useAppStore.getState().unifiedRecordingsLoading).toBe(false)
    })

    it('multiple concurrent increments track correctly', () => {
      const { incrementUnifiedRecordingsLoading, decrementUnifiedRecordingsLoading } = useAppStore.getState()

      // Simulate multiple async operations starting
      incrementUnifiedRecordingsLoading()
      incrementUnifiedRecordingsLoading()
      incrementUnifiedRecordingsLoading()
      expect(useAppStore.getState().unifiedRecordingsLoadingCount).toBe(3)
      expect(useAppStore.getState().unifiedRecordingsLoading).toBe(true)

      // First two complete
      decrementUnifiedRecordingsLoading()
      decrementUnifiedRecordingsLoading()
      expect(useAppStore.getState().unifiedRecordingsLoadingCount).toBe(1)
      expect(useAppStore.getState().unifiedRecordingsLoading).toBe(true) // Still loading

      // Last one completes
      decrementUnifiedRecordingsLoading()
      expect(useAppStore.getState().unifiedRecordingsLoadingCount).toBe(0)
      expect(useAppStore.getState().unifiedRecordingsLoading).toBe(false) // Now done
    })
  })

  describe('Meetings', () => {
    it('setMeetings sets meetings array', () => {
      const { setMeetings } = useAppStore.getState()

      const meetings = [
        { id: 'm-1', subject: 'Standup', startTime: new Date().toISOString(), endTime: new Date().toISOString() }
      ]

      setMeetings(meetings as any)

      expect(useAppStore.getState().meetings.length).toBe(1)
      expect((useAppStore.getState().meetings[0] as any).subject).toBe('Standup')
    })

    it('setMeetings replaces existing meetings', () => {
      const { setMeetings } = useAppStore.getState()

      setMeetings([{ id: 'm-1' } as any])
      setMeetings([{ id: 'm-2' } as any, { id: 'm-3' } as any])

      expect(useAppStore.getState().meetings.length).toBe(2)
    })
  })

  describe('Map Integrity', () => {
    it('downloadQueue is always a Map instance', () => {
      const store = useAppStore.getState()

      expect(store.downloadQueue).toBeInstanceOf(Map)

      store.addToDownloadQueue('dl-1', 'file.wav', 500000)
      expect(useAppStore.getState().downloadQueue).toBeInstanceOf(Map)

      store.updateDownloadProgress('dl-1', 50)
      expect(useAppStore.getState().downloadQueue).toBeInstanceOf(Map)

      store.removeFromDownloadQueue('dl-1')
      expect(useAppStore.getState().downloadQueue).toBeInstanceOf(Map)
    })

    it('download queue operations create new Map instances (immutability)', () => {
      const store = useAppStore.getState()

      store.addToDownloadQueue('dl-1', 'file1.wav', 500000)
      const mapAfterFirst = useAppStore.getState().downloadQueue

      store.addToDownloadQueue('dl-2', 'file2.wav', 750000)
      const mapAfterSecond = useAppStore.getState().downloadQueue

      expect(mapAfterFirst).not.toBe(mapAfterSecond)
    })
  })

  describe('State Isolation', () => {
    it('device state changes do not affect calendar state', () => {
      const store = useAppStore.getState()

      store.setCalendarView('month')
      store.setDeviceState({
        connected: true,
        model: 'H1' as any,
        serialNumber: 'SN-001',
        firmwareVersion: '1.0',
        storage: null,
        settings: null,
        recordingCount: 5
      })

      expect(useAppStore.getState().calendarView).toBe('month')
    })

    it('download queue changes do not affect sync state', () => {
      const store = useAppStore.getState()

      store.setDeviceSyncState({ deviceSyncing: true })
      store.addToDownloadQueue('dl-1', 'file.wav', 500000)
      store.removeFromDownloadQueue('dl-1')

      expect(useAppStore.getState().deviceSyncing).toBe(true)
    })

    it('unified recordings state is independent of meetings', () => {
      const store = useAppStore.getState()

      store.setMeetings([{ id: 'm-1' } as any])
      store.setUnifiedRecordings([])
      store.markUnifiedRecordingsLoaded()

      expect(useAppStore.getState().meetings.length).toBe(1)
      expect(useAppStore.getState().unifiedRecordingsLoaded).toBe(true)
    })

    it('activity log is independent of connection status', () => {
      const store = useAppStore.getState()

      store.addActivityLogEntry({
        timestamp: new Date(),
        type: 'info',
        message: 'Test entry'
      })

      store.setConnectionStatus({ step: 'ready', message: 'Connected' })

      expect(useAppStore.getState().activityLog.length).toBe(1)
      expect(useAppStore.getState().connectionStatus.step).toBe('ready')

      store.clearActivityLog()
      expect(useAppStore.getState().connectionStatus.step).toBe('ready')
    })
  })

  describe('Edge Cases', () => {
    it('handles rapid download queue operations', () => {
      const store = useAppStore.getState()

      for (let i = 0; i < 50; i++) {
        store.addToDownloadQueue(`dl-${i}`, `file-${i}.wav`, i * 1000)
      }

      expect(useAppStore.getState().downloadQueue.size).toBe(50)

      for (let i = 0; i < 50; i++) {
        useAppStore.getState().updateDownloadProgress(`dl-${i}`, i * 2)
      }

      expect(useAppStore.getState().downloadQueue.get('dl-25')!.progress).toBe(50)
    })

    it('handles multiple navigation operations', () => {
      const { setCurrentDate, navigateWeek, navigateMonth } = useAppStore.getState()
      const startDate = new Date(2026, 1, 26) // Feb 26, 2026

      setCurrentDate(startDate)
      navigateWeek('next')
      navigateWeek('next')
      navigateMonth('next')
      navigateWeek('prev')

      // Date should be deterministic through the chain
      const finalDate = useAppStore.getState().currentDate
      expect(finalDate).toBeInstanceOf(Date)
      // Feb 26 + 7 + 7 = Mar 12, + 1 month = Apr 12, - 7 = Apr 5
      expect(finalDate.getMonth()).toBe(3) // April
      expect(finalDate.getDate()).toBe(5)
    })

    it('maintains state integrity after many operations', () => {
      const store = useAppStore.getState()

      // Perform many operations across different state areas
      store.setDeviceState({
        connected: true,
        model: 'P1' as any,
        serialNumber: 'SN-999',
        firmwareVersion: '3.0',
        storage: { used: 1000, capacity: 5000, freePercent: 80 },
        settings: null,
        recordingCount: 42
      })
      store.setConnectionStatus({ step: 'ready', message: 'Connected' })
      store.addActivityLogEntry({ timestamp: new Date(), type: 'success', message: 'Connected' })
      store.setDeviceSyncState({ deviceSyncing: true, deviceSyncProgress: { current: 1, total: 5 } })
      store.addToDownloadQueue('dl-1', 'file.wav', 999)
      store.updateDownloadProgress('dl-1', 50)
      store.setCalendarView('month')
      store.setUnifiedRecordingsLoading(true)

      const finalState = useAppStore.getState()
      expect(finalState.deviceState.connected).toBe(true)
      expect(finalState.deviceState.recordingCount).toBe(42)
      expect(finalState.connectionStatus.step).toBe('ready')
      expect(finalState.activityLog.length).toBe(1)
      expect(finalState.deviceSyncing).toBe(true)
      expect(finalState.downloadQueue.size).toBe(1)
      expect(finalState.downloadQueue.get('dl-1')!.progress).toBe(50)
      expect(finalState.calendarView).toBe('month')
      expect(finalState.unifiedRecordingsLoading).toBe(true)
    })
  })
})
