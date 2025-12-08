import { ipcMain } from 'electron'
import { getConfig, updateConfig } from '../services/config'
import { syncCalendar, getLastSyncTime, CalendarSyncResult } from '../services/calendar-sync'

let syncInterval: NodeJS.Timeout | null = null

export function registerCalendarHandlers(): void {
  // Sync calendar now
  ipcMain.handle('calendar:sync', async (): Promise<CalendarSyncResult> => {
    const config = getConfig()

    if (!config.calendar.icsUrl) {
      return {
        success: false,
        error: 'No calendar URL configured',
        meetingsCount: 0
      }
    }

    return await syncCalendar(config.calendar.icsUrl)
  })

  // Get last sync time
  ipcMain.handle('calendar:get-last-sync', async () => {
    return getLastSyncTime()
  })

  // Set ICS URL
  ipcMain.handle('calendar:set-url', async (_, url: string) => {
    await updateConfig('calendar', { icsUrl: url })
    return getConfig().calendar
  })

  // Toggle auto-sync
  ipcMain.handle('calendar:toggle-auto-sync', async (_, enabled: boolean) => {
    await updateConfig('calendar', { syncEnabled: enabled })

    if (enabled) {
      startAutoSync()
    } else {
      stopAutoSync()
    }

    return getConfig().calendar
  })

  // Set sync interval
  ipcMain.handle('calendar:set-interval', async (_, minutes: number) => {
    await updateConfig('calendar', { syncIntervalMinutes: minutes })

    // Restart auto-sync with new interval
    const config = getConfig()
    if (config.calendar.syncEnabled) {
      stopAutoSync()
      startAutoSync()
    }

    return getConfig().calendar
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

function stopAutoSync(): void {
  if (syncInterval) {
    clearInterval(syncInterval)
    syncInterval = null
    console.log('Calendar auto-sync stopped')
  }
}
