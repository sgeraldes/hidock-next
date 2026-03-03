import { ipcMain } from 'electron'
import { getConfig, updateConfig } from '../services/config'
import { syncCalendar, getLastSyncTime, CalendarSyncResult } from '../services/calendar-sync'
import { clearAllMeetings } from '../services/database'
import {
  SetIcsUrlSchema,
  ToggleAutoSyncSchema,
  SetSyncIntervalSchema
} from './validation'

let syncInterval: NodeJS.Timeout | null = null

export function registerCalendarHandlers(): void {
  // Sync calendar now
  // AUD2-010: Verify sync result and catch unexpected errors at the IPC boundary
  ipcMain.handle('calendar:sync', async (): Promise<CalendarSyncResult> => {
    const config = getConfig()

    if (!config.calendar.icsUrl) {
      return {
        success: false,
        error: 'No calendar URL configured',
        meetingsCount: 0
      }
    }

    try {
      const result = await syncCalendar(config.calendar.icsUrl)
      // AUD2-010: Verify result is well-formed before returning to renderer
      if (!result || typeof result.success !== 'boolean') {
        console.error('[calendar:sync] syncCalendar returned malformed result:', result)
        return { success: false, error: 'Sync returned an invalid result', meetingsCount: 0 }
      }
      return result
    } catch (error) {
      // AUD2-010: Guard against unexpected throws that bypass syncCalendar's internal catch
      const message = error instanceof Error ? error.message : 'Unknown sync error'
      console.error('[calendar:sync] Unexpected error:', error)
      return { success: false, error: message, meetingsCount: 0 }
    }
  })

  // Clear all meetings and perform a fresh sync
  // AUD2-010: Same verification pattern as calendar:sync
  ipcMain.handle('calendar:clear-and-sync', async (): Promise<CalendarSyncResult> => {
    const config = getConfig()

    if (!config.calendar.icsUrl) {
      return {
        success: false,
        error: 'No calendar URL configured',
        meetingsCount: 0
      }
    }

    try {
      clearAllMeetings()
      const result = await syncCalendar(config.calendar.icsUrl)
      if (!result || typeof result.success !== 'boolean') {
        console.error('[calendar:clear-and-sync] syncCalendar returned malformed result:', result)
        return { success: false, error: 'Sync returned an invalid result', meetingsCount: 0 }
      }
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown sync error'
      console.error('[calendar:clear-and-sync] Unexpected error:', error)
      return { success: false, error: message, meetingsCount: 0 }
    }
  })

  // Get last sync time
  ipcMain.handle('calendar:get-last-sync', async () => {
    return getLastSyncTime()
  })

  // Set ICS URL
  ipcMain.handle('calendar:set-url', async (_, url: unknown) => {
    try {
      const result = SetIcsUrlSchema.safeParse({ url })
      if (!result.success) {
        return { success: false, error: result.error.issues[0]?.message || 'Invalid URL' }
      }

      await updateConfig('calendar', { icsUrl: result.data.url })
      return { success: true, data: getConfig().calendar }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  })

  // Toggle auto-sync
  ipcMain.handle('calendar:toggle-auto-sync', async (_, enabled: unknown) => {
    try {
      const result = ToggleAutoSyncSchema.safeParse({ enabled })
      if (!result.success) {
        return { success: false, error: result.error.issues[0]?.message || 'Invalid enabled value' }
      }

      await updateConfig('calendar', { syncEnabled: result.data.enabled })

      if (result.data.enabled) {
        startAutoSync()
      } else {
        stopAutoSync()
      }

      return { success: true, data: getConfig().calendar }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  })

  // Set sync interval
  ipcMain.handle('calendar:set-interval', async (_, minutes: unknown) => {
    try {
      const result = SetSyncIntervalSchema.safeParse({ minutes })
      if (!result.success) {
        return { success: false, error: result.error.issues[0]?.message || 'Invalid interval' }
      }

      await updateConfig('calendar', { syncIntervalMinutes: result.data.minutes })

      // Restart auto-sync with new interval
      const config = getConfig()
      if (config.calendar.syncEnabled) {
        stopAutoSync()
        startAutoSync()
      }

      return { success: true, data: getConfig().calendar }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  })

  // Get calendar settings
  ipcMain.handle('calendar:get-settings', async () => {
    return getConfig().calendar
  })

  // Initialize auto-sync if enabled
  const config = getConfig()
  if (config.calendar.syncEnabled && config.calendar.icsUrl) {
    startAutoSync()
  }
}

function startAutoSync(): void {
  stopAutoSync() // Clear any existing interval

  const config = getConfig()
  const intervalMs = config.calendar.syncIntervalMinutes * 60 * 1000

  console.log(`Starting calendar auto-sync every ${config.calendar.syncIntervalMinutes} minutes`)

  // Sync immediately on start
  if (config.calendar.icsUrl) {
    syncCalendar(config.calendar.icsUrl).catch((err) => {
      console.error('Initial calendar sync failed:', err)
    })
  }

  // Set up periodic sync
  syncInterval = setInterval(async () => {
    const currentConfig = getConfig()
    if (currentConfig.calendar.icsUrl) {
      try {
        await syncCalendar(currentConfig.calendar.icsUrl)
      } catch (err) {
        console.error('Calendar sync failed:', err)
      }
    }
  }, intervalMs)
}

/**
 * Stop the calendar auto-sync interval.
 * B-CAL-002: Exported so it can be called during app quit cleanup.
 */
export function stopAutoSync(): void {
  if (syncInterval) {
    clearInterval(syncInterval)
    syncInterval = null
    console.log('Calendar auto-sync stopped')
  }
}
