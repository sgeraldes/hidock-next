import { ipcMain } from 'electron'
import {
  getWaveformCache,
  setWaveformCache,
  clearWaveformCache
} from '../services/waveform-cache'

/**
 * IPC handlers for the disk-backed waveform peak cache.
 * See electron/main/services/waveform-cache.ts.
 */
export function registerWaveformCacheHandlers(): void {
  ipcMain.handle('waveform:getCache', async (_event, recordingId: string, fileSize?: number) => {
    return getWaveformCache(recordingId, fileSize)
  })

  ipcMain.handle(
    'waveform:setCache',
    async (_event, recordingId: string, peaks: number[], duration?: number, fileSize?: number) => {
      return setWaveformCache(recordingId, peaks, duration ?? 0, fileSize ?? 0)
    }
  )

  ipcMain.handle('waveform:clearCache', async (_event, recordingId: string) => {
    return clearWaveformCache(recordingId)
  })

  console.log('[WaveformCache] IPC handlers registered')
}
