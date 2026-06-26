// @vitest-environment node

/**
 * Unit tests for Jensen IPC handlers.
 *
 * Verifies:
 * - All 27 request/response channels are registered via ipcMain.handle
 * - Input validation rejects path traversal and malformed data
 * - cancelDownload aborts in-progress downloads
 * - Download handler sends chunk events via event.sender
 * - Scan progress events are sent during listFiles
 * - isDestroyed() guard prevents sends to closed windows
 * - Error handling returns null to renderer (never throws)
 *
 * HOISTING NOTE: vi.mock() factories are hoisted before variable declarations.
 * Shared mutable state (mockHandlers, mockJensenImpl) is declared as top-level
 * objects whose properties are mutated, not reassigned — this is safe across
 * the hoist boundary.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Shared registries — populated by vi.mock factories at module load time
// NOTE: These must be plain object literals (not `new Map`, not `const x = ...`
// with a complex RHS) so they survive the vi.mock hoist.
// ---------------------------------------------------------------------------

/** IPC handlers registered via ipcMain.handle() */
const mockHandlers: Record<string, (event: any, args?: any) => any> = {}

/** Send calls recorded on broadcast window's webContents */
const broadcastSendCalls: Array<[string, any]> = []

/** Controls whether the broadcast window appears destroyed */
const broadcastWindowState = { destroyed: false }

// ---------------------------------------------------------------------------
// Mock electron — must come before any import that transitively loads it
// ---------------------------------------------------------------------------

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: any, args?: any) => any) => {
      mockHandlers[channel] = fn
    },
  },
  BrowserWindow: {
    getAllWindows: () => [
      {
        webContents: {
          isDestroyed: () => broadcastWindowState.destroyed,
          send: (channel: string, payload: any) => {
            broadcastSendCalls.push([channel, payload])
          },
        },
      },
    ],
  },
}))

// ---------------------------------------------------------------------------
// Mock usb (transitively required by jensen.ts)
// ---------------------------------------------------------------------------

const mockWebUSBInstance = {
  getDevices: vi.fn().mockResolvedValue([]),
  requestDevice: vi.fn().mockRejectedValue(new Error('no device')),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
}

vi.mock('usb', () => ({
  // Must use `function` keyword — arrow functions cannot be `new`-ed
  WebUSB: function WebUSBMock() {
    return mockWebUSBInstance
  },
}))

// ---------------------------------------------------------------------------
// Mock the Jensen service — expose a spy-able device object
// vi.mock factory cannot reference `mockJensen` (hoisting), so we use
// a stable wrapper object and reassign its inner methods in beforeEach.
// ---------------------------------------------------------------------------

const mockJensen: any = {
  connect: vi.fn().mockResolvedValue(false),
  tryConnect: vi.fn().mockResolvedValue(false),
  disconnect: vi.fn().mockResolvedValue(undefined),
  abortInFlight: vi.fn(),
  reset: vi.fn().mockResolvedValue(false),
  isConnected: vi.fn().mockReturnValue(false),
  getModel: vi.fn().mockReturnValue('unknown'),
  isP1Device: vi.fn().mockReturnValue(false),
  getDeviceInfo: vi.fn().mockResolvedValue(null),
  getCardInfo: vi.fn().mockResolvedValue(null),
  getFileCount: vi.fn().mockResolvedValue(null),
  getSettings: vi.fn().mockResolvedValue(null),
  setTime: vi.fn().mockResolvedValue(null),
  setAutoRecord: vi.fn().mockResolvedValue(null),
  listFiles: vi.fn().mockResolvedValue([]),
  downloadFile: vi.fn().mockResolvedValue(true),
  deleteFile: vi.fn().mockResolvedValue({ result: 'success' }),
  formatCard: vi.fn().mockResolvedValue({ result: 'success' }),
  getRealtimeSettings: vi.fn().mockResolvedValue(null),
  startRealtime: vi.fn().mockResolvedValue(null),
  pauseRealtime: vi.fn().mockResolvedValue(null),
  stopRealtime: vi.fn().mockResolvedValue(null),
  getRealtimeData: vi.fn().mockResolvedValue(null),
  getBatteryStatus: vi.fn().mockResolvedValue(null),
  startBluetoothScan: vi.fn().mockResolvedValue(null),
  stopBluetoothScan: vi.fn().mockResolvedValue(null),
  getBluetoothStatus: vi.fn().mockResolvedValue(null),
  serialNumber: 'SN123',
  versionCode: '1.0.0',
  versionNumber: 327714,
  onconnect: undefined as (() => void) | undefined,
  ondisconnect: undefined as (() => void) | undefined,
  setupUsbConnectListener: vi.fn(),
}

vi.mock('../../services/jensen', () => ({
  getJensenDevice: () => mockJensen,
}))

// ---------------------------------------------------------------------------
// Import and register handlers under test
// ---------------------------------------------------------------------------

import { registerJensenHandlers } from '../jensen-handlers'

// ---------------------------------------------------------------------------
// Helper to build a fake IPC event with a spy-able sender
// ---------------------------------------------------------------------------

function makeEvent(destroyed = false) {
  return {
    sender: {
      isDestroyed: vi.fn(() => destroyed),
      send: vi.fn(),
    },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('registerJensenHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    broadcastSendCalls.length = 0
    broadcastWindowState.destroyed = false
    // Re-register handlers so mockHandlers is fully populated
    Object.keys(mockHandlers).forEach((k) => delete mockHandlers[k])
    registerJensenHandlers()
  })

  // -------------------------------------------------------------------------
  // Channel registration
  // -------------------------------------------------------------------------

  const expectedChannels = [
    'jensen:connect',
    'jensen:tryConnect',
    'jensen:disconnect',
    'jensen:reset',
    'jensen:isConnected',
    'jensen:getModel',
    'jensen:isP1Device',
    'jensen:getDeviceInfo',
    'jensen:getCardInfo',
    'jensen:getFileCount',
    'jensen:getSettings',
    'jensen:setTime',
    'jensen:setAutoRecord',
    'jensen:listFiles',
    'jensen:downloadFile',
    'jensen:cancelDownload',
    'jensen:deleteFile',
    'jensen:formatCard',
    'jensen:getRealtimeSettings',
    'jensen:startRealtime',
    'jensen:pauseRealtime',
    'jensen:stopRealtime',
    'jensen:getRealtimeData',
    'jensen:getBatteryStatus',
    'jensen:startBluetoothScan',
    'jensen:stopBluetoothScan',
    'jensen:getBluetoothStatus',
  ]

  it('registers all 27 request/response channels', () => {
    expect(expectedChannels).toHaveLength(27)
    for (const channel of expectedChannels) {
      expect(mockHandlers[channel], `Missing handler for ${channel}`).toBeDefined()
    }
  })

  // -------------------------------------------------------------------------
  // Core operations
  // -------------------------------------------------------------------------

  it('jensen:connect delegates to jensen.connect()', async () => {
    mockJensen.connect.mockResolvedValue(true)
    const result = await mockHandlers['jensen:connect'](makeEvent())
    expect(mockJensen.connect).toHaveBeenCalledTimes(1)
    expect(result).toBe(true)
  })

  it('jensen:isConnected returns boolean', async () => {
    mockJensen.isConnected.mockReturnValue(true)
    const result = await mockHandlers['jensen:isConnected'](makeEvent())
    expect(result).toBe(true)
  })

  it('jensen:disconnect returns null', async () => {
    const result = await mockHandlers['jensen:disconnect'](makeEvent())
    expect(mockJensen.disconnect).toHaveBeenCalledTimes(1)
    expect(result).toBeNull()
  })

  it('jensen:getModel returns model string', async () => {
    mockJensen.getModel.mockReturnValue('hidock-h1')
    const result = await mockHandlers['jensen:getModel'](makeEvent())
    expect(result).toBe('hidock-h1')
  })

  // -------------------------------------------------------------------------
  // Input validation
  // -------------------------------------------------------------------------

  it('jensen:deleteFile rejects path traversal filenames', async () => {
    const result = await mockHandlers['jensen:deleteFile'](makeEvent(), { filename: '../secret.hda' })
    expect(result).toBeNull()
    expect(mockJensen.deleteFile).not.toHaveBeenCalled()
  })

  it('jensen:deleteFile rejects filenames with null bytes', async () => {
    const result = await mockHandlers['jensen:deleteFile'](makeEvent(), { filename: 'file\0name.hda' })
    expect(result).toBeNull()
    expect(mockJensen.deleteFile).not.toHaveBeenCalled()
  })

  it('jensen:deleteFile rejects absolute paths', async () => {
    const result = await mockHandlers['jensen:deleteFile'](makeEvent(), { filename: '/etc/passwd' })
    expect(result).toBeNull()
    expect(mockJensen.deleteFile).not.toHaveBeenCalled()
  })

  it('jensen:deleteFile accepts valid filenames', async () => {
    mockJensen.deleteFile.mockResolvedValue({ result: 'success' })
    const result = await mockHandlers['jensen:deleteFile'](makeEvent(), { filename: 'recording.hda' })
    expect(mockJensen.deleteFile).toHaveBeenCalledWith('recording.hda')
    expect(result).toEqual({ result: 'success' })
  })

  it('jensen:downloadFile rejects path traversal filenames', async () => {
    const result = await mockHandlers['jensen:downloadFile'](makeEvent(), {
      filename: '../../secret.hda',
      fileSize: 1000,
    })
    expect(result).toBeNull()
    expect(mockJensen.downloadFile).not.toHaveBeenCalled()
  })

  it('jensen:downloadFile rejects negative fileSize', async () => {
    const result = await mockHandlers['jensen:downloadFile'](makeEvent(), {
      filename: 'recording.hda',
      fileSize: -1,
    })
    expect(result).toBeNull()
    expect(mockJensen.downloadFile).not.toHaveBeenCalled()
  })

  it('jensen:downloadFile rejects fileSize exceeding 2GB', async () => {
    const result = await mockHandlers['jensen:downloadFile'](makeEvent(), {
      filename: 'recording.hda',
      fileSize: 3_000_000_000,
    })
    expect(result).toBeNull()
    expect(mockJensen.downloadFile).not.toHaveBeenCalled()
  })

  it('jensen:setAutoRecord rejects non-boolean', async () => {
    const result = await mockHandlers['jensen:setAutoRecord'](makeEvent(), { enabled: 'yes' })
    expect(result).toBeNull()
    expect(mockJensen.setAutoRecord).not.toHaveBeenCalled()
  })

  it('jensen:setAutoRecord accepts boolean', async () => {
    mockJensen.setAutoRecord.mockResolvedValue({ result: 'success' })
    const result = await mockHandlers['jensen:setAutoRecord'](makeEvent(), { enabled: true })
    expect(mockJensen.setAutoRecord).toHaveBeenCalledWith(true)
    expect(result).toEqual({ result: 'success' })
  })

  it('jensen:getRealtimeData rejects negative offset', async () => {
    const result = await mockHandlers['jensen:getRealtimeData'](makeEvent(), { offset: -5 })
    expect(result).toBeNull()
    expect(mockJensen.getRealtimeData).not.toHaveBeenCalled()
  })

  it('jensen:getRealtimeData accepts zero offset', async () => {
    mockJensen.getRealtimeData.mockResolvedValue(null)
    await mockHandlers['jensen:getRealtimeData'](makeEvent(), { offset: 0 })
    expect(mockJensen.getRealtimeData).toHaveBeenCalledWith(0)
  })

  // -------------------------------------------------------------------------
  // Download handler — chunk batching and progress events
  // -------------------------------------------------------------------------

  it('jensen:downloadFile sends chunk events via event.sender', async () => {
    const event = makeEvent(false)
    const chunkData = new Uint8Array(100).fill(0xaa)

    mockJensen.downloadFile.mockImplementation(
      async (_filename: string, _size: number, onChunk: (d: Uint8Array) => void) => {
        onChunk(chunkData)
        return true
      }
    )

    const result = await mockHandlers['jensen:downloadFile'](event, {
      filename: 'test.hda',
      fileSize: 100,
    })

    expect(result).toBe(true)
    // chunk should have been flushed on completion
    const chunkCalls = (event.sender.send as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => c[0] === 'jensen:download-chunk'
    )
    expect(chunkCalls.length).toBeGreaterThan(0)
    expect(chunkCalls[0][1]).toMatchObject({ filename: 'test.hda' })
  })

  it('jensen:downloadFile sends progress events via event.sender', async () => {
    const event = makeEvent(false)

    mockJensen.downloadFile.mockImplementation(
      async (_filename: string, _size: number, _onChunk: any, onProgress: (n: number) => void) => {
        onProgress(512)
        return true
      }
    )

    await mockHandlers['jensen:downloadFile'](event, {
      filename: 'test.hda',
      fileSize: 1024,
    })

    expect(event.sender.send).toHaveBeenCalledWith('jensen:download-progress', {
      filename: 'test.hda',
      bytesReceived: 512,
      totalBytes: 1024,
    })
  })

  it('jensen:downloadFile does not send progress to destroyed window', async () => {
    const event = makeEvent(true) // isDestroyed = true

    mockJensen.downloadFile.mockImplementation(
      async (_filename: string, _size: number, _onChunk: any, onProgress: (n: number) => void) => {
        onProgress(100)
        return true
      }
    )

    await mockHandlers['jensen:downloadFile'](event, {
      filename: 'test.hda',
      fileSize: 1000,
    })

    const progressCalls = (event.sender.send as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => c[0] === 'jensen:download-progress'
    )
    expect(progressCalls).toHaveLength(0)
  })

  // -------------------------------------------------------------------------
  // cancelDownload
  // -------------------------------------------------------------------------

  it('jensen:cancelDownload is safe when no download is in progress', async () => {
    const result = await mockHandlers['jensen:cancelDownload'](makeEvent())
    expect(result).toBeNull()
  })

  it('jensen:cancelDownload aborts an in-progress download', async () => {
    let capturedSignal: AbortSignal | undefined

    mockJensen.downloadFile.mockImplementation(
      async (
        _filename: string,
        _size: number,
        _onChunk: any,
        _onProgress: any,
        signal: AbortSignal
      ) => {
        capturedSignal = signal
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => resolve())
          setTimeout(resolve, 5000) // fallback so test doesn't hang
        })
        return false
      }
    )

    // Start download without awaiting — let it run asynchronously
    const downloadPromise = mockHandlers['jensen:downloadFile'](makeEvent(), {
      filename: 'big.hda',
      fileSize: 100_000_000,
    })

    // Let the download handler start and register the AbortController
    await new Promise((r) => setTimeout(r, 20))

    // Cancel the download
    await mockHandlers['jensen:cancelDownload'](makeEvent())

    // Verify signal was aborted
    expect(capturedSignal?.aborted).toBe(true)

    // Download promise should resolve now
    const result = await downloadPromise
    expect(result).toBe(false)
  })

  // -------------------------------------------------------------------------
  // listFiles — scan progress events
  // -------------------------------------------------------------------------

  it('jensen:listFiles sends scan-progress events during file listing', async () => {
    const event = makeEvent(false)
    mockJensen.isConnected.mockReturnValue(true)

    mockJensen.listFiles.mockImplementation(
      async (onProgress: (found: number, expected: number) => void) => {
        onProgress(1, 10)
        onProgress(5, 10)
        onProgress(10, 10)
        return []
      }
    )

    await mockHandlers['jensen:listFiles'](event)

    const progressCalls = (event.sender.send as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => c[0] === 'jensen:scan-progress'
    )
    expect(progressCalls).toHaveLength(3)
    expect(progressCalls[0][1]).toEqual({ current: 1, total: 10 })
    expect(progressCalls[2][1]).toEqual({ current: 10, total: 10 })
  })

  it('jensen:listFiles does not send scan-progress to destroyed window', async () => {
    const event = makeEvent(true) // isDestroyed = true
    mockJensen.isConnected.mockReturnValue(true)

    mockJensen.listFiles.mockImplementation(
      async (onProgress: (found: number, expected: number) => void) => {
        onProgress(1, 5)
        return []
      }
    )

    await mockHandlers['jensen:listFiles'](event)

    const progressCalls = (event.sender.send as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => c[0] === 'jensen:scan-progress'
    )
    expect(progressCalls).toHaveLength(0)
  })

  it('jensen:listFiles returns null without scanning when the device is disconnected', async () => {
    mockJensen.isConnected.mockReturnValue(false)
    const result = await mockHandlers['jensen:listFiles'](makeEvent())
    expect(result).toBeNull()
    expect(mockJensen.listFiles).not.toHaveBeenCalled()
  })

  it('jensen:getFileCount returns null without querying when the device is disconnected', async () => {
    mockJensen.isConnected.mockReturnValue(false)
    const result = await mockHandlers['jensen:getFileCount'](makeEvent())
    expect(result).toBeNull()
    expect(mockJensen.getFileCount).not.toHaveBeenCalled()
  })

  it('jensen:disconnect preempts in-flight work via abortInFlight() before disconnecting', async () => {
    await mockHandlers['jensen:disconnect'](makeEvent())
    expect(mockJensen.abortInFlight).toHaveBeenCalledTimes(1)
    expect(mockJensen.disconnect).toHaveBeenCalledTimes(1)
    expect(mockJensen.abortInFlight.mock.invocationCallOrder[0]).toBeLessThan(
      mockJensen.disconnect.mock.invocationCallOrder[0]
    )
  })

  it('jensen:reset preempts in-flight work via abortInFlight() before resetting', async () => {
    await mockHandlers['jensen:reset'](makeEvent())
    expect(mockJensen.abortInFlight).toHaveBeenCalledTimes(1)
    expect(mockJensen.reset).toHaveBeenCalledTimes(1)
    expect(mockJensen.abortInFlight.mock.invocationCallOrder[0]).toBeLessThan(
      mockJensen.reset.mock.invocationCallOrder[0]
    )
  })

  // -------------------------------------------------------------------------
  // Error handling — all handlers return null on error, never throw
  // -------------------------------------------------------------------------

  it('jensen:connect returns null when jensen throws', async () => {
    mockJensen.connect.mockRejectedValue(new Error('USB error'))
    const result = await mockHandlers['jensen:connect'](makeEvent())
    expect(result).toBeNull()
  })

  it('jensen:getDeviceInfo returns null when jensen throws', async () => {
    mockJensen.getDeviceInfo.mockRejectedValue(new Error('USB error'))
    const result = await mockHandlers['jensen:getDeviceInfo'](makeEvent())
    expect(result).toBeNull()
  })

  it('jensen:listFiles returns null when jensen throws', async () => {
    mockJensen.isConnected.mockReturnValue(true)
    mockJensen.listFiles.mockRejectedValue(new Error('USB error'))
    const result = await mockHandlers['jensen:listFiles'](makeEvent())
    expect(result).toBeNull()
  })

  it('jensen:deleteFile returns null when jensen throws', async () => {
    mockJensen.deleteFile.mockRejectedValue(new Error('USB error'))
    const result = await mockHandlers['jensen:deleteFile'](makeEvent(), { filename: 'file.hda' })
    expect(result).toBeNull()
  })

  // -------------------------------------------------------------------------
  // setTime uses main process time (no args required)
  // -------------------------------------------------------------------------

  it('jensen:setTime calls jensen.setTime() with a Date (main process time)', async () => {
    mockJensen.setTime.mockResolvedValue({ result: 'success' })
    await mockHandlers['jensen:setTime'](makeEvent())
    expect(mockJensen.setTime).toHaveBeenCalledTimes(1)
    const passedDate = mockJensen.setTime.mock.calls[0][0]
    expect(passedDate).toBeInstanceOf(Date)
  })

  // -------------------------------------------------------------------------
  // Connection-state broadcasts (consumed by the renderer JensenIpcClient)
  // -------------------------------------------------------------------------

  describe('connection-state push events', () => {
    it('wires device.onconnect / device.ondisconnect on registration', () => {
      expect(typeof mockJensen.onconnect).toBe('function')
      expect(typeof mockJensen.ondisconnect).toBe('function')
    })

    it('device connect fires jensen:connect-event + jensen:state-changed', () => {
      mockJensen.isConnected.mockReturnValue(true)
      mockJensen.onconnect()
      const channels = broadcastSendCalls.map(([c]) => c)
      expect(channels).toContain('jensen:connect-event')
      const state = broadcastSendCalls.find(([c]) => c === 'jensen:state-changed')
      expect(state?.[1]).toMatchObject({ connected: true })
    })

    it('device disconnect fires jensen:disconnect-event + jensen:state-changed', () => {
      mockJensen.isConnected.mockReturnValue(false)
      mockJensen.ondisconnect()
      const channels = broadcastSendCalls.map(([c]) => c)
      expect(channels).toContain('jensen:disconnect-event')
      const state = broadcastSendCalls.find(([c]) => c === 'jensen:state-changed')
      expect(state?.[1]).toMatchObject({ connected: false })
    })

    it('jensen:connect handler broadcasts state afterwards', async () => {
      mockJensen.connect.mockResolvedValue(true)
      mockJensen.isConnected.mockReturnValue(true)
      await mockHandlers['jensen:connect'](makeEvent())
      const channels = broadcastSendCalls.map(([c]) => c)
      expect(channels).toContain('jensen:state-changed')
    })

    it('jensen:disconnect handler broadcasts state even though it returns null', async () => {
      await mockHandlers['jensen:disconnect'](makeEvent())
      const channels = broadcastSendCalls.map(([c]) => c)
      expect(channels).toContain('jensen:state-changed')
    })
  })
})
