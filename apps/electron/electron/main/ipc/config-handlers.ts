import { ipcMain } from 'electron'
import { getConfig, saveConfig, updateConfig, AppConfig } from '../services/config'

export function registerConfigHandlers(): void {
  // Get full config
  ipcMain.handle('config:get', async () => {
    return getConfig()
  })

  // Save full config
  ipcMain.handle('config:set', async (_, newConfig: Partial<AppConfig>) => {
    await saveConfig(newConfig)
    return getConfig()
  })

  // Update a specific section
  ipcMain.handle(
    'config:update-section',
    async <K extends keyof AppConfig>(_, section: K, values: Partial<AppConfig[K]>) => {
      await updateConfig(section, values)
      return getConfig()
    }
  )

  // Get specific value
  ipcMain.handle('config:get-value', async <K extends keyof AppConfig>(_, key: K) => {
    const config = getConfig()
    return config[key]
  })
}
