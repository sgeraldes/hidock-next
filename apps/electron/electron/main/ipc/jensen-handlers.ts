/**
 * Jensen IPC handlers — exposes all Jensen device commands to the renderer.
 *
 * This is a temporary migration bridge (Phase 1). In Phase 3 the renderer will
 * use useDevicePipeline instead of calling these channels directly.
 *
 * Push event patterns:
 *  - Broadcast  : BrowserWindow.getAllWindows()[0].webContents.send() — state, connect, disconnect
 *  - Targeted   : event.sender.send() — download chunks/progress, realtime data
 *
 * Security: All user-supplied values are validated with Zod before reaching the device.
 */

import { ipcMain, BrowserWindow } from 'electron'
import { getJensenDevice } from '../services/jensen'
import {
  JensenDeleteFileSchema,
  JensenSetAutoRecordSchema,
  JensenDownloadFileSchema,
  JensenRealtimeDataSchema,
  JensenBluetoothScanSchema,
} from './jensen-validation'

// ---------------------------------------------------------------------------
// Download abort controller — allows jensen:cancelDownload to abort in-flight downloads
// ---------------------------------------------------------------------------

let currentDownloadAbort: AbortController | null = null

// ---------------------------------------------------------------------------
// Serialize device lifecycle operations (connect / tryConnect / disconnect /
// reset). Rapid UI clicks otherwise interleave open/setup/read-loop with
// reset/close, corrupting device state (ACCESS lock, "no recordings"). This
// runs them one-at-a-time in arrival order; a failed op never breaks the chain.
// ---------------------------------------------------------------------------

let deviceOpChain: Promise<unknown> = Promise.resolve()

function serializeDeviceOp<T>(op: () => Promise<T>): Promise<T> {
  const run = deviceOpChain.then(op, op)
  deviceOpChain = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

// ---------------------------------------------------------------------------
// Broadcast helper — sends to the first available window
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
// Handler registration
// ---------------------------------------------------------------------------

export function registerJensenHandlers(): void {
  // -------------------------------------------------------------------------
  // Connection-state push events
  //
  // The renderer (JensenIpcClient) keeps no device state of its own — it relies
  // on these broadcasts to know whether the device is connected and to fire the
  // renderer-side onconnect/ondisconnect callbacks. The device fires onconnect
  // after a successful (auto-)connect and ondisconnect on disconnect / physical
  // unplug; explicit operations also push state below.
  // -------------------------------------------------------------------------

  const device = getJensenDevice()

  const sendState = (): void => {
    broadcast('jensen:state-changed', {
      connected: device.isConnected(),
      model: device.getModel(),
      serialNumber: device.serialNumber,
      versionCode: device.versionCode,
      versionNumber: device.versionNumber,
    })
  }

  device.onconnect = () => {
    broadcast('jensen:connect-event')
    sendState()
  }
  device.ondisconnect = () => {
    broadcast('jensen:disconnect-event')
    sendState()
  }

  // -------------------------------------------------------------------------
  // Core device operations
  // -------------------------------------------------------------------------

  ipcMain.handle('jensen:connect', async () => {
    try {
      return await serializeDeviceOp(() => getJensenDevice().connect())
    } catch {
      return null
    } finally {
      sendState()
    }
  })

  ipcMain.handle('jensen:tryConnect', async () => {
    try {
      return await serializeDeviceOp(() => getJensenDevice().tryConnect())
    } catch {
      return null
    } finally {
      sendState()
    }
  })

  ipcMain.handle('jensen:disconnect', async () => {
    try {
      await serializeDeviceOp(() => getJensenDevice().disconnect())
      return null
    } catch {
      return null
    } finally {
      sendState()
    }
  })

  ipcMain.handle('jensen:reset', async () => {
    try {
      return await serializeDeviceOp(() => getJensenDevice().reset())
    } catch {
      return null
    } finally {
      sendState()
    }
  })

  ipcMain.handle('jensen:isConnected', async () => {
    try {
      return getJensenDevice().isConnected()
    } catch {
      return false
    }
  })

  ipcMain.handle('jensen:getModel', async () => {
    try {
      return getJensenDevice().getModel()
    } catch {
      return null
    }
  })

  ipcMain.handle('jensen:isP1Device', async () => {
    try {
      return getJensenDevice().isP1Device()
    } catch {
      return false
    }
  })

  // -------------------------------------------------------------------------
  // Device info & settings
  // -------------------------------------------------------------------------

  ipcMain.handle('jensen:getDeviceInfo', async () => {
    try {
      return await getJensenDevice().getDeviceInfo()
    } catch {
      return null
    }
  })

  ipcMain.handle('jensen:getCardInfo', async () => {
    try {
      return await getJensenDevice().getCardInfo()
    } catch {
      return null
    }
  })

  ipcMain.handle('jensen:getFileCount', async () => {
    try {
      return await getJensenDevice().getFileCount()
    } catch {
      return null
    }
  })

  ipcMain.handle('jensen:getSettings', async () => {
    try {
      return await getJensenDevice().getSettings()
    } catch {
      return null
    }
  })

  // Uses main process time (design decision: prevents renderer from setting arbitrary device time)
  ipcMain.handle('jensen:setTime', async () => {
    try {
      return await getJensenDevice().setTime(new Date())
    } catch {
      return null
    }
  })

  ipcMain.handle('jensen:setAutoRecord', async (_event, args) => {
    try {
      const { enabled } = JensenSetAutoRecordSchema.parse(args)
      return await getJensenDevice().setAutoRecord(enabled)
    } catch {
      return null
    }
  })

  // -------------------------------------------------------------------------
  // File operations
  // -------------------------------------------------------------------------

  ipcMain.handle('jensen:listFiles', async (event) => {
    try {
      const onProgress = (filesFound: number, expectedFiles: number) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('jensen:scan-progress', { current: filesFound, total: expectedFiles })
        }
      }
      return await getJensenDevice().listFiles(onProgress)
    } catch {
      return null
    }
  })

  ipcMain.handle('jensen:downloadFile', async (event, args) => {
    try {
      const { filename, fileSize } = JensenDownloadFileSchema.parse(args)

      const abortController = new AbortController()
      currentDownloadAbort = abortController

      const BATCH_SIZE = 262144 // 256 KB
      let pendingBuffer: Buffer[] = []
      let pendingSize = 0

      const flushChunks = (): void => {
        if (pendingBuffer.length === 0) return
        if (event.sender.isDestroyed()) return
        const merged = Buffer.concat(pendingBuffer, pendingSize)
        event.sender.send('jensen:download-chunk', { filename, data: merged })
        pendingBuffer = []
        pendingSize = 0
      }

      const onChunk = (data: Uint8Array): void => {
        pendingBuffer.push(Buffer.from(data))
        pendingSize += data.length
        if (pendingSize >= BATCH_SIZE) flushChunks()
      }

      const onProgress = (received: number): void => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('jensen:download-progress', {
            filename,
            bytesReceived: received,
            totalBytes: fileSize,
          })
        }
      }

      try {
        const result = await getJensenDevice().downloadFile(
          filename,
          fileSize,
          onChunk,
          onProgress,
          abortController.signal
        )
        flushChunks() // flush any remaining buffered chunks
        return result
      } finally {
        currentDownloadAbort = null
      }
    } catch {
      return null
    }
  })

  ipcMain.handle('jensen:cancelDownload', async () => {
    try {
      if (currentDownloadAbort) {
        currentDownloadAbort.abort()
      }
      return null
    } catch {
      return null
    }
  })

  ipcMain.handle('jensen:deleteFile', async (_event, args) => {
    try {
      const { filename } = JensenDeleteFileSchema.parse(args)
      return await getJensenDevice().deleteFile(filename)
    } catch {
      return null
    }
  })

  ipcMain.handle('jensen:formatCard', async () => {
    try {
      return await getJensenDevice().formatCard()
    } catch {
      return null
    }
  })

  // -------------------------------------------------------------------------
  // Realtime streaming (P1 / P1 Mini)
  // -------------------------------------------------------------------------

  ipcMain.handle('jensen:getRealtimeSettings', async () => {
    try {
      return await getJensenDevice().getRealtimeSettings()
    } catch {
      return null
    }
  })

  ipcMain.handle('jensen:startRealtime', async () => {
    try {
      return await getJensenDevice().startRealtime()
    } catch {
      return null
    }
  })

  ipcMain.handle('jensen:pauseRealtime', async () => {
    try {
      return await getJensenDevice().pauseRealtime()
    } catch {
      return null
    }
  })

  ipcMain.handle('jensen:stopRealtime', async () => {
    try {
      return await getJensenDevice().stopRealtime()
    } catch {
      return null
    }
  })

  ipcMain.handle('jensen:getRealtimeData', async (event, args) => {
    try {
      const { offset } = JensenRealtimeDataSchema.parse(args)
      const result = await getJensenDevice().getRealtimeData(offset)
      if (result && !event.sender.isDestroyed()) {
        event.sender.send('jensen:realtime-data', {
          rest: result.rest,
          data: Buffer.from(result.data),
        })
      }
      return result
    } catch {
      return null
    }
  })

  // -------------------------------------------------------------------------
  // Battery & Bluetooth (P1 only)
  // -------------------------------------------------------------------------

  ipcMain.handle('jensen:getBatteryStatus', async () => {
    try {
      return await getJensenDevice().getBatteryStatus()
    } catch {
      return null
    }
  })

  ipcMain.handle('jensen:startBluetoothScan', async (_event, args) => {
    try {
      const { duration } = JensenBluetoothScanSchema.parse(args ?? {})
      return await getJensenDevice().startBluetoothScan(duration)
    } catch {
      return null
    }
  })

  ipcMain.handle('jensen:stopBluetoothScan', async () => {
    try {
      return await getJensenDevice().stopBluetoothScan()
    } catch {
      return null
    }
  })

  ipcMain.handle('jensen:getBluetoothStatus', async () => {
    try {
      return await getJensenDevice().getBluetoothStatus()
    } catch {
      return null
    }
  })

  // -------------------------------------------------------------------------
  // Wire up push event callbacks on the singleton Jensen device
  // -------------------------------------------------------------------------

  const jensen = getJensenDevice()

  jensen.onconnect = () => {
    broadcast('jensen:connect-event')
    broadcast('jensen:state-changed', {
      connected: true,
      model: jensen.getModel(),
      serialNumber: jensen.serialNumber,
      versionCode: jensen.versionCode,
      versionNumber: jensen.versionNumber,
    })
  }

  jensen.ondisconnect = () => {
    broadcast('jensen:disconnect-event')
    broadcast('jensen:state-changed', {
      connected: false,
      model: jensen.getModel(),
      serialNumber: null,
      versionCode: null,
      versionNumber: null,
    })
  }

  console.log('Jensen IPC handlers registered (27 channels)')
}
