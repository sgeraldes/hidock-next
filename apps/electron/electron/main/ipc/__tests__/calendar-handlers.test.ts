import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ipcMain } from 'electron'
import { registerCalendarHandlers } from '../calendar-handlers'

// Mock electron
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() }
}))

// Mock config service
vi.mock('../../services/config', () => ({
  getConfig: vi.fn(),
  updateConfig: vi.fn()
}))

// Mock calendar-sync service
vi.mock('../../services/calendar-sync', () => ({
  syncCalendar: vi.fn(),
  getLastSyncTime: vi.fn()
}))

// Mock database
vi.mock('../../services/database', () => ({
  clearAllMeetings: vi.fn()
}))

describe('Calendar IPC Handlers', () => {
  let handlers: Record<string, Function> = {}

  // Default config returned by getConfig
  const defaultConfig = {
    calendar: {
      icsUrl: 'https://calendar.example.com/feed.ics',
      syncEnabled: false,
      syncIntervalMinutes: 15,
      lastSyncAt: null
    }
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    handlers = {}

    const { getConfig } = await import('../../services/config')
    vi.mocked(getConfig).mockReturnValue(defaultConfig as any)

    vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: Function) => {
      handlers[channel] = handler
      return undefined as any
    })

    registerCalendarHandlers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should register all expected handlers', () => {
    const expectedChannels = [
      'calendar:sync',
      'calendar:clear-and-sync',
      'calendar:get-last-sync',
      'calendar:set-url',
      'calendar:toggle-auto-sync',
      'calendar:set-interval',
      'calendar:get-settings'
    ]

    for (const channel of expectedChannels) {
      expect(ipcMain.handle).toHaveBeenCalledWith(channel, expect.any(Function))
    }
  })

  describe('calendar:sync', () => {
    it('should sync calendar when ICS URL is configured', async () => {
      const { syncCalendar } = await import('../../services/calendar-sync')
      const syncResult = { success: true, meetingsCount: 12 }
      vi.mocked(syncCalendar).mockResolvedValue(syncResult as any)

      const result = await handlers['calendar:sync'](null)

      expect(syncCalendar).toHaveBeenCalledWith('https://calendar.example.com/feed.ics')
      expect(result).toEqual(syncResult)
    })

    it('should return error when no ICS URL is configured', async () => {
      const { getConfig } = await import('../../services/config')
      vi.mocked(getConfig).mockReturnValue({
        calendar: { icsUrl: '', syncEnabled: false, syncIntervalMinutes: 15, lastSyncAt: null }
      } as any)

      const result = await handlers['calendar:sync'](null)

      expect(result).toEqual({
        success: false,
        error: 'No calendar URL configured',
        meetingsCount: 0
      })
    })
  })

  describe('calendar:clear-and-sync', () => {
    it('should clear meetings then sync when URL is configured', async () => {
      const { clearAllMeetings } = await import('../../services/database')
      const { syncCalendar } = await import('../../services/calendar-sync')
      const syncResult = { success: true, meetingsCount: 8 }
      vi.mocked(syncCalendar).mockResolvedValue(syncResult as any)

      const result = await handlers['calendar:clear-and-sync'](null)

      expect(clearAllMeetings).toHaveBeenCalled()
      expect(syncCalendar).toHaveBeenCalledWith('https://calendar.example.com/feed.ics')
      expect(result).toEqual(syncResult)
    })

    it('should return error when no ICS URL is configured', async () => {
      const { getConfig } = await import('../../services/config')
      const { clearAllMeetings } = await import('../../services/database')
      vi.mocked(getConfig).mockReturnValue({
        calendar: { icsUrl: '', syncEnabled: false, syncIntervalMinutes: 15, lastSyncAt: null }
      } as any)

      const result = await handlers['calendar:clear-and-sync'](null)

      expect(clearAllMeetings).not.toHaveBeenCalled()
      expect(result).toEqual({
        success: false,
        error: 'No calendar URL configured',
        meetingsCount: 0
      })
    })
  })

  describe('calendar:get-last-sync', () => {
    it('should return last sync time', async () => {
      const { getLastSyncTime } = await import('../../services/calendar-sync')
      vi.mocked(getLastSyncTime).mockReturnValue('2025-06-15T10:30:00Z')

      const result = await handlers['calendar:get-last-sync'](null)

      expect(result).toBe('2025-06-15T10:30:00Z')
    })

    it('should return null when never synced', async () => {
      const { getLastSyncTime } = await import('../../services/calendar-sync')
      vi.mocked(getLastSyncTime).mockReturnValue(null)

      const result = await handlers['calendar:get-last-sync'](null)

      expect(result).toBeNull()
    })
  })

  describe('calendar:set-url', () => {
    it('should update the ICS URL and return updated settings', async () => {
      const { updateConfig, getConfig } = await import('../../services/config')
      const updatedCalendar = {
        icsUrl: 'https://new-calendar.example.com/feed.ics',
        syncEnabled: false,
        syncIntervalMinutes: 15,
        lastSyncAt: null
      }
      vi.mocked(getConfig).mockReturnValue({ calendar: updatedCalendar } as any)
      vi.mocked(updateConfig).mockResolvedValue(undefined)

      const result = await handlers['calendar:set-url'](null, 'https://new-calendar.example.com/feed.ics')

      expect(updateConfig).toHaveBeenCalledWith('calendar', {
        icsUrl: 'https://new-calendar.example.com/feed.ics'
      })
      expect(result).toEqual({ success: true, data: updatedCalendar })
    })

    it('should return validation error for invalid URL', async () => {
      const result = await handlers['calendar:set-url'](null, 'not-a-valid-url')

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('should return error on update failure', async () => {
      const { updateConfig } = await import('../../services/config')
      vi.mocked(updateConfig).mockRejectedValue(new Error('Write failed'))

      const result = await handlers['calendar:set-url'](null, 'https://valid.example.com/feed.ics')

      expect(result).toEqual({ success: false, error: 'Write failed' })
    })
  })

  describe('calendar:toggle-auto-sync', () => {
    it('should enable auto-sync and return updated settings', async () => {
      const { updateConfig, getConfig } = await import('../../services/config')
      const { syncCalendar } = await import('../../services/calendar-sync')
      const updatedCalendar = {
        icsUrl: 'https://calendar.example.com/feed.ics',
        syncEnabled: true,
        syncIntervalMinutes: 15,
        lastSyncAt: null
      }
      // First call during handler registration, subsequent calls in toggle handler
      vi.mocked(getConfig).mockReturnValue({ calendar: updatedCalendar } as any)
      vi.mocked(updateConfig).mockResolvedValue(undefined)
      vi.mocked(syncCalendar).mockResolvedValue({ success: true, meetingsCount: 0 } as any)

      const result = await handlers['calendar:toggle-auto-sync'](null, true)

      expect(updateConfig).toHaveBeenCalledWith('calendar', { syncEnabled: true })
      expect(result).toEqual({ success: true, data: updatedCalendar })
    })

    it('should disable auto-sync', async () => {
      const { updateConfig, getConfig } = await import('../../services/config')
      const updatedCalendar = {
        icsUrl: 'https://calendar.example.com/feed.ics',
        syncEnabled: false,
        syncIntervalMinutes: 15,
        lastSyncAt: null
      }
      vi.mocked(getConfig).mockReturnValue({ calendar: updatedCalendar } as any)
      vi.mocked(updateConfig).mockResolvedValue(undefined)

      const result = await handlers['calendar:toggle-auto-sync'](null, false)

      expect(updateConfig).toHaveBeenCalledWith('calendar', { syncEnabled: false })
      expect(result).toEqual({ success: true, data: updatedCalendar })
    })

    it('should return validation error for non-boolean input', async () => {
      const result = await handlers['calendar:toggle-auto-sync'](null, 'yes')

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  describe('calendar:set-interval', () => {
    it('should update sync interval and return updated settings', async () => {
      const { updateConfig, getConfig } = await import('../../services/config')
      const updatedCalendar = {
        icsUrl: 'https://calendar.example.com/feed.ics',
        syncEnabled: false,
        syncIntervalMinutes: 30,
        lastSyncAt: null
      }
      vi.mocked(getConfig).mockReturnValue({ calendar: updatedCalendar } as any)
      vi.mocked(updateConfig).mockResolvedValue(undefined)

      const result = await handlers['calendar:set-interval'](null, 30)

      expect(updateConfig).toHaveBeenCalledWith('calendar', { syncIntervalMinutes: 30 })
      expect(result).toEqual({ success: true, data: updatedCalendar })
    })

    it('should restart auto-sync with new interval if sync is enabled', async () => {
      const { updateConfig, getConfig } = await import('../../services/config')
      const { syncCalendar } = await import('../../services/calendar-sync')
      const updatedCalendar = {
        icsUrl: 'https://calendar.example.com/feed.ics',
        syncEnabled: true,
        syncIntervalMinutes: 60,
        lastSyncAt: null
      }
      vi.mocked(getConfig).mockReturnValue({ calendar: updatedCalendar } as any)
      vi.mocked(updateConfig).mockResolvedValue(undefined)
      vi.mocked(syncCalendar).mockResolvedValue({ success: true, meetingsCount: 0 } as any)

      const result = await handlers['calendar:set-interval'](null, 60)

      expect(updateConfig).toHaveBeenCalledWith('calendar', { syncIntervalMinutes: 60 })
      expect(result.success).toBe(true)
    })

    it('should return validation error for invalid interval', async () => {
      const result = await handlers['calendar:set-interval'](null, 0)

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('should return validation error for interval exceeding max (1440 minutes)', async () => {
      const result = await handlers['calendar:set-interval'](null, 1500)

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('should return error on update failure', async () => {
      const { updateConfig } = await import('../../services/config')
      vi.mocked(updateConfig).mockRejectedValue(new Error('Disk full'))

      const result = await handlers['calendar:set-interval'](null, 30)

      expect(result).toEqual({ success: false, error: 'Disk full' })
    })
  })

  describe('calendar:get-settings', () => {
    it('should return current calendar settings', async () => {
      const result = await handlers['calendar:get-settings'](null)

      expect(result).toEqual(defaultConfig.calendar)
    })
  })

  describe('auto-sync initialization', () => {
    it('should not start auto-sync when syncEnabled is false', async () => {
      const { syncCalendar } = await import('../../services/calendar-sync')

      // The default config has syncEnabled: false
      // registerCalendarHandlers() was called in beforeEach

      expect(syncCalendar).not.toHaveBeenCalled()
    })

    it('should start auto-sync when syncEnabled is true and icsUrl is set', async () => {
      const { getConfig } = await import('../../services/config')
      const { syncCalendar } = await import('../../services/calendar-sync')

      vi.mocked(getConfig).mockReturnValue({
        calendar: {
          icsUrl: 'https://calendar.example.com/feed.ics',
          syncEnabled: true,
          syncIntervalMinutes: 15,
          lastSyncAt: null
        }
      } as any)
      vi.mocked(syncCalendar).mockResolvedValue({ success: true, meetingsCount: 0 } as any)

      // Re-register to trigger initialization with new config
      handlers = {}
      vi.mocked(ipcMain.handle).mockClear()
      vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: Function) => {
        handlers[channel] = handler
        return undefined as any
      })
      registerCalendarHandlers()

      // syncCalendar is called immediately on start when auto-sync is enabled
      // Need to flush the microtask queue
      await vi.advanceTimersByTimeAsync(0)

      expect(syncCalendar).toHaveBeenCalledWith('https://calendar.example.com/feed.ics')
    })
  })
})
