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
// Serialize device operations (connect / tryConnect / disconnect / reset /
// listFiles / getFileCount). Rapid UI clicks otherwise interleave open/setup/
// read-loop with reset/close, OR start a file-list scan during/after a
// disconnect — corrupting device state (ACCESS lock, "no recordings"). This runs
// them one-at-a-time in arrival order; a failed op never breaks the chain.
//
// disconnect/reset additionally call device.abortInFlight() *before* queueing,
// so they preempt a running (or stalled) scan/download instead of waiting behind
// it in the chain.
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
// Live-recording poll
//
// The HiDock exposes no push notification for its physical record button, so we
// poll GET_RECORDING_FILE (CMD 18) while connected. The device answers with the
// in-progress recording's filename, or an empty body when idle. On change we
// broadcast `jensen:recording-changed` so the renderer can light up the "Recording
// now" indicators.
//
// Poll discipline (this was the source of a protocol desync — see below):
//  1. It does NOT start on connect. It starts only after the FIRST file-list
//     scan completes (startRecordingPoll() is called from jensen:listFiles), so
//     it can never fire during the connect handshake / device-info / initial
//     scan. Kicking a 5s-timeout CMD 18 into that window is what desynced the
//     command/response pairing (SN null, empty list, stalled downloads).
//  2. It is SKIPPED (not queued) whenever a transfer or scan is in flight
//     (device.isOperationInProgress() or an active download abort) — a skipped
//     poll is free; a queued one would add latency to the transfer.
//  3. On a timed-out / failed read it BACKS OFF to 60s so a slow or busy device
//     isn't hammered; a healthy read restores the 20s cadence.
// It is still issued through the serializeDeviceOp chain, and the device's own
// command lock is the final backstop — a poll can never interleave on the bus.
//
// Inherent limit: this only works while the app is CONNECTED. A device recording
// while the app is closed/disconnected is invisible until the next connect.
// ---------------------------------------------------------------------------

const RECORDING_POLL_INTERVAL_MS = 20_000
const RECORDING_POLL_BACKOFF_MS = 60_000
const RECORDING_POLL_KICKOFF_MS = 1500

let recordingPollTimer: ReturnType<typeof setInterval> | null = null
let recordingPollKickoff: ReturnType<typeof setTimeout> | null = null
let recordingPollIntervalMs = RECORDING_POLL_INTERVAL_MS
// undefined = unknown (never read yet); string = actively recording; null = idle.
let lastRecordingFilename: string | null | undefined = undefined

function scheduleRecordingPoll(intervalMs: number): void {
  if (recordingPollTimer) clearInterval(recordingPollTimer)
  recordingPollIntervalMs = intervalMs
  recordingPollTimer = setInterval(() => {
    void pollRecordingOnce()
  }, intervalMs)
}

async function pollRecordingOnce(): Promise<void> {
  const device = getJensenDevice()
  if (!device.isConnected()) return
  // Do NOT interleave with an in-flight transfer / scan on the USB bus.
  if (device.isOperationInProgress() || currentDownloadAbort) return

  let result: { recording: string | null } | null = null
  try {
    result = await serializeDeviceOp(() => device.getRecordingFile())
  } catch {
    return
  }

  if (!result) {
    // Timeout / transient failure — back off so we don't retry a struggling
    // device every 20s (which risks repeated timeouts under heavy activity).
    if (device.isConnected() && recordingPollIntervalMs !== RECORDING_POLL_BACKOFF_MS) {
      scheduleRecordingPoll(RECORDING_POLL_BACKOFF_MS)
    }
    return // keep the last known state
  }

  // Healthy read — restore the normal cadence if we had backed off.
  if (recordingPollIntervalMs !== RECORDING_POLL_INTERVAL_MS) {
    scheduleRecordingPoll(RECORDING_POLL_INTERVAL_MS)
  }

  const filename = result.recording && result.recording.length > 0 ? result.recording : null
  if (filename !== lastRecordingFilename) {
    lastRecordingFilename = filename
    broadcast('jensen:recording-changed', { recording: filename })
  }
}

// Idempotent — safe to call after every scan. Starts the poll the first time the
// device has fully initialized (a file-list scan has completed).
function startRecordingPoll(): void {
  if (recordingPollTimer) return
  lastRecordingFilename = undefined
  scheduleRecordingPoll(RECORDING_POLL_INTERVAL_MS)
  // Early first read so the indicator appears without waiting a full interval.
  // The busy-guard skips it if a follow-up op is still running.
  recordingPollKickoff = setTimeout(() => {
    void pollRecordingOnce()
  }, RECORDING_POLL_KICKOFF_MS)
}

function stopRecordingPoll(): void {
  if (recordingPollTimer) {
    clearInterval(recordingPollTimer)
    recordingPollTimer = null
  }
  if (recordingPollKickoff) {
    clearTimeout(recordingPollKickoff)
    recordingPollKickoff = null
  }
  recordingPollIntervalMs = RECORDING_POLL_INTERVAL_MS
  const wasRecording = !!lastRecordingFilename
  lastRecordingFilename = undefined
  // Clear the indicator on disconnect (a device unplugged mid-record must not
  // leave a stale "Recording now" card).
  if (wasRecording) broadcast('jensen:recording-changed', { recording: null })
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
  // NOTE: device.onconnect/ondisconnect are wired once below (the canonical
  // registration). sendState() is used by the operation handlers' finally blocks.

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
      // Abort an in-flight download so it stops being saved. The device keeps
      // streaming the rest of the file regardless; gracefulCloseDevice then drains
      // that out of the IN FIFO before closing (see below). The 'disconnect' reason
      // tells downloadFile's settlement that TEARDOWN owns the drain — so it resolves
      // false and stands down instead of advancing the command queue mid-stream.
      if (currentDownloadAbort) currentDownloadAbort.abort('disconnect')

      // Do NOT preempt an in-flight scan: disconnect is serialized, so it waits
      // for the running listFiles/getFileCount to finish first. That lets the
      // device stream its file list to the end-of-list marker and empty its USB
      // FIFO before we close — otherwise the leftover bytes are read on the NEXT
      // connect instead of the device-info response ("Failed to get device info",
      // recovered only after a second disconnect/connect). For downloads (not
      // serialized) the abort above + the drain in gracefulCloseDevice play the
      // same role. Teardown then runs on an idle device and closes cleanly via
      // stopPoll (no reset).
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
      getJensenDevice().abortInFlight()
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
      if (!getJensenDevice().isConnected()) return null
      return await serializeDeviceOp(() => getJensenDevice().getFileCount())
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
      // Never scan a device that isn't connected (e.g. a scan requested during or
      // right after a disconnect) — returning null lets the renderer keep its
      // cached list instead of mistaking an interrupted scan for an empty device.
      if (!getJensenDevice().isConnected()) return null
      const onProgress = (filesFound: number, expectedFiles: number) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('jensen:scan-progress', { current: filesFound, total: expectedFiles })
        }
      }
      const result = await serializeDeviceOp(() => getJensenDevice().listFiles(onProgress))
      // Device has now fully initialized (device-info handshake + a completed
      // file-list scan). Only NOW is it safe to start the live-recording poll —
      // starting it during the connect handshake is what desynced the protocol.
      // Idempotent: no-op on subsequent rescans.
      if (result !== null && getJensenDevice().isConnected()) startRecordingPoll()
      return result
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
        // 'user-cancel' reason: downloadFile's settlement drains to quiescence and,
        // only once the bus is proven quiet, releases the slot so the connection
        // stays usable (unlike the 'disconnect' reason, which stands down for teardown).
        currentDownloadAbort.abort('user-cancel')
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
    // NOTE: the live-recording poll is intentionally NOT started here. It starts
    // only after the first file-list scan completes (see the jensen:listFiles
    // handler) so a CMD 18 poll can never fire during the connect handshake and
    // desync the protocol.
  }

  jensen.ondisconnect = () => {
    stopRecordingPoll()
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
