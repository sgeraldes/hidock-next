/**
 * DevicePipeline IPC handlers (Slice 4 of the USB Device Pipeline refactor).
 *
 * Bridges the main-process DevicePipelineService to the renderer:
 *  - `device-pipeline:get-state` returns the current projected PipelineState.
 *  - User-action channels (connect/disconnect/sync/cancel/delete/format) delegate
 *    to the single DevicePipelineService instance.
 *  - The service's EventEmitter `'state'` / `'files'` events are bridged to the
 *    renderer via broadcast (`device-pipeline:state` / `device-pipeline:files`),
 *    mirroring the jensen-handlers broadcast pattern.
 *
 * ⚠ INERT / ADDITIVE (Slice 4). The live app keeps using the OLD device path
 * (useDeviceSubscriptions / useDownloadOrchestrator / jensen-handlers). This
 * bridge is registered so its state/getState/action IPC is reachable, but it
 * MUST NOT call initAutoConnect() or register any USB 'connect' listener — that
 * would compete with the existing auto-connect path and cause USB-bus
 * contention. Cutover to this path is a later supervised slice.
 *
 * All `device-pipeline:` channels are namespaced so they cannot collide with
 * existing channels.
 */

import { ipcMain, BrowserWindow } from 'electron'
import { getDevicePipelineService } from '../services/device-pipeline'
import type { DevicePipelineService } from '../services/device-pipeline'

// ---------------------------------------------------------------------------
// Broadcast helper — sends to the first available window (jensen-handlers pattern)
// ---------------------------------------------------------------------------

function broadcast(channel: string, payload?: unknown): void {
  const wins = BrowserWindow.getAllWindows()
  if (wins.length === 0) return
  const win = wins[0]
  if (!win.webContents.isDestroyed()) {
    win.webContents.send(channel, payload)
  }
}

// ---------------------------------------------------------------------------
// Guard against double-binding the EventEmitter bridge across re-registration
// (registerIpcHandlers is called once, but tests re-register repeatedly).
// ---------------------------------------------------------------------------

let bridgeBoundPipeline: DevicePipelineService | null = null

/**
 * Allow injecting a pipeline instance in unit tests; the running app uses the
 * real singleton via getDevicePipelineService().
 */
export function registerDevicePipelineHandlers(
  pipeline: DevicePipelineService = getDevicePipelineService()
): void {
  // -------------------------------------------------------------------------
  // EventEmitter → renderer bridge
  //
  // Bind the 'state' / 'files' listeners exactly once per pipeline instance so
  // repeated registration (or test re-runs) never accumulates duplicate
  // broadcasts on the same emitter.
  // -------------------------------------------------------------------------

  if (bridgeBoundPipeline !== pipeline) {
    if (bridgeBoundPipeline) {
      bridgeBoundPipeline.removeAllListeners('state')
      bridgeBoundPipeline.removeAllListeners('files')
    }
    pipeline.on('state', (state) => {
      broadcast('device-pipeline:state', state)
    })
    pipeline.on('files', (files) => {
      broadcast('device-pipeline:files', files)
    })
    bridgeBoundPipeline = pipeline
  }

  // -------------------------------------------------------------------------
  // State projection (renderer's ONE authoritative read of pipeline state)
  // -------------------------------------------------------------------------

  ipcMain.handle('device-pipeline:get-state', () => {
    return pipeline.getState()
  })

  ipcMain.handle('device-pipeline:get-files', () => {
    return pipeline.getFiles()
  })

  // -------------------------------------------------------------------------
  // User actions — delegate to the single DevicePipelineService instance.
  // Errors are swallowed to null so a failed action never rejects the renderer
  // invoke (consistent with jensen-handlers).
  // -------------------------------------------------------------------------

  ipcMain.handle('device-pipeline:connect', async () => {
    try {
      return await pipeline.connect()
    } catch {
      return false
    }
  })

  ipcMain.handle('device-pipeline:disconnect', async () => {
    try {
      await pipeline.disconnect()
      return null
    } catch {
      return null
    }
  })

  ipcMain.handle('device-pipeline:sync', async () => {
    try {
      await pipeline.manualSync()
      return null
    } catch {
      return null
    }
  })

  ipcMain.handle('device-pipeline:cancel', async () => {
    try {
      await pipeline.cancelDownloads()
      return null
    } catch {
      return null
    }
  })

  ipcMain.handle('device-pipeline:delete-file', async (_event, args) => {
    try {
      const filename = typeof args === 'string' ? args : args?.filename
      if (typeof filename !== 'string' || filename.length === 0) return null
      return await pipeline.deleteFile(filename)
    } catch {
      return null
    }
  })

  ipcMain.handle('device-pipeline:format', async () => {
    try {
      return await pipeline.formatDevice()
    } catch {
      return null
    }
  })

  console.log('DevicePipeline IPC handlers registered (8 channels, inert/not-cutover)')
}

/** Test-only: reset the bridge-binding guard between suites. */
export function __resetDevicePipelineBridgeForTests(): void {
  bridgeBoundPipeline = null
}
