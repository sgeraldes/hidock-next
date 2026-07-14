import { ipcMain } from 'electron'
import { getConfig, saveConfig, updateConfig, AppConfig, RETIRED_GEMINI_MODELS } from '../services/config'
import { initializeFileStorage } from '../services/file-storage'
import { listGeminiTranscriptionModels } from '../services/gemini-models'
import { success, error as errorResult } from '../types/api'
import { emitActivityLog } from '../services/activity-log'

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
      emitActivityLog('info', 'Settings saved')
      return success(getConfig())
    } catch (err) {
      console.error('[config:set] Error:', err)
      emitActivityLog('error', 'Failed to save settings', err instanceof Error ? err.message : undefined)
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
        if (section === 'storage') {
          await initializeFileStorage()
        }
        emitActivityLog('info', `Settings updated: ${String(section)}`)
        return success(getConfig())
      } catch (err) {
        console.error(`[config:update-section] Error updating ${String(section)}:`, err)
        emitActivityLog('error', `Failed to update ${String(section)} settings`, err instanceof Error ? err.message : undefined)
        return errorResult(
          'VALIDATION_ERROR',
          err instanceof Error ? err.message : `Failed to update ${String(section)} settings`,
          err
        )
      }
    }
  )

  // List the audio-transcription-capable Gemini models available to the saved
  // API key (live from the API; falls back to a concrete list when unreachable).
  ipcMain.handle('config:listGeminiModels', async () => {
    try {
      const key = getConfig().transcription.geminiApiKey
      const result = await listGeminiTranscriptionModels(key, RETIRED_GEMINI_MODELS)
      return success(result)
    } catch (err) {
      console.error('[config:listGeminiModels] Error:', err)
      return errorResult(
        'SERVICE_UNAVAILABLE',
        err instanceof Error ? err.message : 'Failed to list Gemini models',
        err
      )
    }
  })

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
