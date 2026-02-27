import { ipcMain } from 'electron'
import { getConfig, saveConfig, updateConfig, AppConfig } from '../services/config'
import { success, error as errorResult } from '../types/api'

export function registerConfigHandlers(): void {
  // Get full config
  ipcMain.handle('config:get', async () => {
    try {
      return success(getConfig())
    } catch (err) {
      console.error('[config:get] Error:', err)
      return errorResult(
        'SERVICE_UNAVAILABLE',
        err instanceof Error ? err.message : 'Failed to load configuration',
        err
      )
    }
  })

  // Save full config
  ipcMain.handle('config:set', async (_, newConfig: Partial<AppConfig>) => {
    try {
      await saveConfig(newConfig)
      return success(getConfig())
    } catch (err) {
      console.error('[config:set] Error:', err)
      return errorResult(
        'VALIDATION_ERROR',
        err instanceof Error ? err.message : 'Failed to save configuration',
        err
      )
    }
  })

  // Update a specific section
  ipcMain.handle(
    'config:update-section',
    async <K extends keyof AppConfig>(_, section: K, values: Partial<AppConfig[K]>) => {
      try {
        await updateConfig(section, values)
        return success(getConfig())
      } catch (err) {
        console.error(`[config:update-section] Error updating ${String(section)}:`, err)
        return errorResult(
          'VALIDATION_ERROR',
          err instanceof Error ? err.message : `Failed to update ${String(section)} settings`,
          err
        )
      }
    }
  )

  // Get specific value
  ipcMain.handle('config:get-value', async <K extends keyof AppConfig>(_, key: K) => {
    try {
      const config = getConfig()
      return success(config[key])
    } catch (err) {
      console.error(`[config:get-value] Error getting ${String(key)}:`, err)
      return errorResult(
        'SERVICE_UNAVAILABLE',
        err instanceof Error ? err.message : `Failed to get ${String(key)} value`,
        err
      )
    }
  })
}
