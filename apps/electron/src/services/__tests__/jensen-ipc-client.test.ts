/**
 * JensenIpcClient unit tests
 *
 * Verifies that every method delegates to window.electronAPI.jensen.*
 * and that event wiring (onconnect / ondisconnect) works correctly.
 * All tests use mocked IPC — no real USB hardware is involved.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { JensenIpcClient } from '../jensen-ipc-client'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type JensenApiMock = {
  connect: ReturnType<typeof vi.fn>
  tryConnect: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
  reset: ReturnType<typeof vi.fn>
  isConnected: ReturnType<typeof vi.fn>
  getModel: ReturnType<typeof vi.fn>
  isP1Device: ReturnType<typeof vi.fn>
  getDeviceInfo: ReturnType<typeof vi.fn>
  getCardInfo: ReturnType<typeof vi.fn>
  getFileCount: ReturnType<typeof vi.fn>
  getSettings: ReturnType<typeof vi.fn>
  setTime: ReturnType<typeof vi.fn>
  setAutoRecord: ReturnType<typeof vi.fn>
  listFiles: ReturnType<typeof vi.fn>
  downloadFile: ReturnType<typeof vi.fn>
  cancelDownload: ReturnType<typeof vi.fn>
  deleteFile: ReturnType<typeof vi.fn>
  formatCard: ReturnType<typeof vi.fn>
  getRealtimeSettings: ReturnType<typeof vi.fn>
  startRealtime: ReturnType<typeof vi.fn>
  pauseRealtime: ReturnType<typeof vi.fn>
  stopRealtime: ReturnType<typeof vi.fn>
  getRealtimeData: ReturnType<typeof vi.fn>
  getBatteryStatus: ReturnType<typeof vi.fn>
  startBluetoothScan: ReturnType<typeof vi.fn>
  stopBluetoothScan: ReturnType<typeof vi.fn>
  getBluetoothStatus: ReturnType<typeof vi.fn>
  onStateChanged: ReturnType<typeof vi.fn>
  onConnect: ReturnType<typeof vi.fn>
  onDisconnect: ReturnType<typeof vi.fn>
  onDownloadProgress: ReturnType<typeof vi.fn>
  onDownloadChunk: ReturnType<typeof vi.fn>
  onScanProgress: ReturnType<typeof vi.fn>
}

function createJensenApiMock(): JensenApiMock {
  return {
    connect: vi.fn().mockResolvedValue(true),
    tryConnect: vi.fn().mockResolvedValue(true),
    disconnect: vi.fn().mockResolvedValue(null),
    reset: vi.fn().mockResolvedValue(true),
    isConnected: vi.fn().mockResolvedValue(true),
    getModel: vi.fn().mockResolvedValue('hidock-h1'),
    isP1Device: vi.fn().mockResolvedValue(false),
    getDeviceInfo: vi.fn().mockResolvedValue({ versionCode: '1.0', versionNumber: 1, serialNumber: 'SN001', model: 'hidock-h1' }),
    getCardInfo: vi.fn().mockResolvedValue({ used: 100, capacity: 1000, free: 900, status: '0' }),
    getFileCount: vi.fn().mockResolvedValue({ count: 5 }),
    getSettings: vi.fn().mockResolvedValue({ autoRecord: true, autoPlay: false }),
    setTime: vi.fn().mockResolvedValue({ result: 'success' }),
    setAutoRecord: vi.fn().mockResolvedValue({ result: 'success' }),
    listFiles: vi.fn().mockResolvedValue([]),
    downloadFile: vi.fn().mockResolvedValue(true),
    cancelDownload: vi.fn().mockResolvedValue(null),
    deleteFile: vi.fn().mockResolvedValue({ result: 'success' }),
    formatCard: vi.fn().mockResolvedValue({ result: 'success' }),
    getRealtimeSettings: vi.fn().mockResolvedValue({ enabled: true }),
    startRealtime: vi.fn().mockResolvedValue({ result: 'success' }),
    pauseRealtime: vi.fn().mockResolvedValue({ result: 'success' }),
    stopRealtime: vi.fn().mockResolvedValue({ result: 'success' }),
    getRealtimeData: vi.fn().mockResolvedValue({ rest: 0, data: new Uint8Array(0) }),
    getBatteryStatus: vi.fn().mockResolvedValue({ status: 'idle', batteryLevel: 80 }),
    startBluetoothScan: vi.fn().mockResolvedValue({ result: 'success' }),
    stopBluetoothScan: vi.fn().mockResolvedValue({ result: 'success' }),
    getBluetoothStatus: vi.fn().mockResolvedValue({ connected: false }),
    // Event subscription mocks: return unsubscribe functions
    onStateChanged: vi.fn().mockReturnValue(() => {}),
    onConnect: vi.fn().mockReturnValue(() => {}),
    onDisconnect: vi.fn().mockReturnValue(() => {}),
    onDownloadProgress: vi.fn().mockReturnValue(() => {}),
    onDownloadChunk: vi.fn().mockReturnValue(() => {}),
    onScanProgress: vi.fn().mockReturnValue(() => {}),
  }
}

function setupWindowMock(jensenMock: JensenApiMock) {
  ;(globalThis as any).window = {
    electronAPI: {
      jensen: jensenMock,
    },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('JensenIpcClient', () => {
  let jensenMock: JensenApiMock
  let client: JensenIpcClient

  beforeEach(() => {
    jensenMock = createJensenApiMock()
    setupWindowMock(jensenMock)
    client = new JensenIpcClient()
  })

  afterEach(() => {
    client.destroy()
    delete (globalThis as any).window
  })

  // ─── Constructor: event subscriptions ────────────────────────────────────

  describe('constructor event wiring', () => {
    it('subscribes to onStateChanged on construction', () => {
      expect(jensenMock.onStateChanged).toHaveBeenCalledTimes(1)
    })

    it('subscribes to onConnect on construction', () => {
      expect(jensenMock.onConnect).toHaveBeenCalledTimes(1)
    })

    it('subscribes to onDisconnect on construction', () => {
      expect(jensenMock.onDisconnect).toHaveBeenCalledTimes(1)
    })
  })

  // ─── onconnect / ondisconnect callback wiring ────────────────────────────

  describe('onconnect / ondisconnect callbacks', () => {
    it('invokes assigned onconnect callback when connect event fires', () => {
      const connectSpy = vi.fn()
      client.onconnect = connectSpy

      // Extract the handler that was passed to onConnect
      const [[handler]] = jensenMock.onConnect.mock.calls
      handler()

      expect(connectSpy).toHaveBeenCalledTimes(1)
    })

    it('invokes assigned ondisconnect callback when disconnect event fires', () => {
      const disconnectSpy = vi.fn()
      client.ondisconnect = disconnectSpy

      const [[handler]] = jensenMock.onDisconnect.mock.calls
      handler()

      expect(disconnectSpy).toHaveBeenCalledTimes(1)
    })

    it('does not throw if onconnect is null when connect event fires', () => {
      client.onconnect = null
      const [[handler]] = jensenMock.onConnect.mock.calls
      expect(() => handler()).not.toThrow()
    })

    it('does not throw if ondisconnect is null when disconnect event fires', () => {
      client.ondisconnect = null
      const [[handler]] = jensenMock.onDisconnect.mock.calls
      expect(() => handler()).not.toThrow()
    })
  })

  // ─── State synchronization from onStateChanged ───────────────────────────

  describe('state sync from onStateChanged', () => {
    it('updates _connected when state-changed event fires', () => {
      expect(client.isConnected()).toBe(false) // initial

      const [[stateHandler]] = jensenMock.onStateChanged.mock.calls
      stateHandler({ connected: true, model: 'hidock-h1', serialNumber: 'SN123', versionCode: '1.0', versionNumber: 1 })

      expect(client.isConnected()).toBe(true)
    })

    it('updates serialNumber from state-changed event', () => {
      const [[stateHandler]] = jensenMock.onStateChanged.mock.calls
      stateHandler({ connected: true, model: 'hidock-p1', serialNumber: 'SN999', versionCode: '2.0', versionNumber: 2 })

      expect(client.serialNumber).toBe('SN999')
    })

    it('updates versionCode from state-changed event', () => {
      const [[stateHandler]] = jensenMock.onStateChanged.mock.calls
      stateHandler({ connected: true, model: 'hidock-h1e', serialNumber: null, versionCode: '3.5', versionNumber: 3 })

      expect(client.versionCode).toBe('3.5')
    })
  })

  // ─── Core device operations: IPC delegation ──────────────────────────────

  describe('connect()', () => {
    it('delegates to window.electronAPI.jensen.connect', async () => {
      jensenMock.connect.mockResolvedValue(true)
      const result = await client.connect()
      expect(jensenMock.connect).toHaveBeenCalledTimes(1)
      expect(result).toBe(true)
    })

    it('returns false when IPC returns null', async () => {
      jensenMock.connect.mockResolvedValue(null)
      const result = await client.connect()
      expect(result).toBe(false)
    })
  })

  describe('tryConnect()', () => {
    it('delegates to window.electronAPI.jensen.tryConnect', async () => {
      jensenMock.tryConnect.mockResolvedValue(true)
      const result = await client.tryConnect()
      expect(jensenMock.tryConnect).toHaveBeenCalledTimes(1)
      expect(result).toBe(true)
    })

    it('ignores the preAuthorizedDevice arg (IPC manages its own device)', async () => {
      // The IPC surface cannot accept a USBDevice; we just verify it does not pass it
      const fakeDevice = {} as USBDevice
      await client.tryConnect(fakeDevice)
      // IPC should still be called without any device arg
      expect(jensenMock.tryConnect).toHaveBeenCalledWith()
    })
  })

  describe('disconnect()', () => {
    it('delegates to window.electronAPI.jensen.disconnect', async () => {
      await client.disconnect()
      expect(jensenMock.disconnect).toHaveBeenCalledTimes(1)
    })
  })

  describe('reset()', () => {
    it('delegates to window.electronAPI.jensen.reset', async () => {
      jensenMock.reset.mockResolvedValue(true)
      const result = await client.reset()
      expect(jensenMock.reset).toHaveBeenCalledTimes(1)
      expect(result).toBe(true)
    })
  })

  describe('isConnected()', () => {
    it('returns false initially (before any state update)', () => {
      expect(client.isConnected()).toBe(false)
    })

    it('returns true after a connect state-changed event', () => {
      const [[stateHandler]] = jensenMock.onStateChanged.mock.calls
      stateHandler({ connected: true, model: null, serialNumber: null, versionCode: null, versionNumber: null })
      expect(client.isConnected()).toBe(true)
    })
  })

  describe('getModel()', () => {
    it('returns "unknown" initially', () => {
      expect(client.getModel()).toBe('unknown')
    })

    it('returns model from state-changed event', () => {
      const [[stateHandler]] = jensenMock.onStateChanged.mock.calls
      stateHandler({ connected: true, model: 'hidock-p1', serialNumber: null, versionCode: null, versionNumber: null })
      expect(client.getModel()).toBe('hidock-p1')
    })
  })

  describe('isP1Device()', () => {
    it('returns false for non-P1 model', () => {
      const [[stateHandler]] = jensenMock.onStateChanged.mock.calls
      stateHandler({ connected: true, model: 'hidock-h1', serialNumber: null, versionCode: null, versionNumber: null })
      expect(client.isP1Device()).toBe(false)
    })

    it('returns true for hidock-p1', () => {
      const [[stateHandler]] = jensenMock.onStateChanged.mock.calls
      stateHandler({ connected: true, model: 'hidock-p1', serialNumber: null, versionCode: null, versionNumber: null })
      expect(client.isP1Device()).toBe(true)
    })

    it('returns true for hidock-p1-mini', () => {
      const [[stateHandler]] = jensenMock.onStateChanged.mock.calls
      stateHandler({ connected: true, model: 'hidock-p1-mini', serialNumber: null, versionCode: null, versionNumber: null })
      expect(client.isP1Device()).toBe(true)
    })
  })

  // ─── Device info & settings ───────────────────────────────────────────────

  describe('getDeviceInfo()', () => {
    it('delegates to IPC', async () => {
      const info = { versionCode: '1.0', versionNumber: 1, serialNumber: 'SN1', model: 'hidock-h1' as const }
      jensenMock.getDeviceInfo.mockResolvedValue(info)
      const result = await client.getDeviceInfo()
      expect(jensenMock.getDeviceInfo).toHaveBeenCalledTimes(1)
      expect(result).toEqual(info)
    })
  })

  describe('getCardInfo()', () => {
    it('delegates to IPC', async () => {
      const cardInfo = { used: 200, capacity: 1000, free: 800, status: '0' }
      jensenMock.getCardInfo.mockResolvedValue(cardInfo)
      const result = await client.getCardInfo()
      expect(result).toEqual(cardInfo)
    })
  })

  describe('getFileCount()', () => {
    it('delegates to IPC', async () => {
      jensenMock.getFileCount.mockResolvedValue({ count: 42 })
      const result = await client.getFileCount()
      expect(result).toEqual({ count: 42 })
    })
  })

  describe('getSettings()', () => {
    it('delegates to IPC', async () => {
      const settings = { autoRecord: true, autoPlay: false }
      jensenMock.getSettings.mockResolvedValue(settings)
      const result = await client.getSettings()
      expect(result).toEqual(settings)
    })
  })

  describe('setTime()', () => {
    it('delegates to IPC (ignores renderer-supplied date)', async () => {
      jensenMock.setTime.mockResolvedValue({ result: 'success' })
      const date = new Date('2026-01-01T00:00:00Z')
      const result = await client.setTime(date)
      // IPC handler uses main-process time; no date arg expected on the wire
      expect(jensenMock.setTime).toHaveBeenCalledWith()
      expect(result).toEqual({ result: 'success' })
    })
  })

  describe('setAutoRecord()', () => {
    it('delegates enabled=true to IPC', async () => {
      jensenMock.setAutoRecord.mockResolvedValue({ result: 'success' })
      await client.setAutoRecord(true)
      expect(jensenMock.setAutoRecord).toHaveBeenCalledWith(true)
    })

    it('delegates enabled=false to IPC', async () => {
      await client.setAutoRecord(false)
      expect(jensenMock.setAutoRecord).toHaveBeenCalledWith(false)
    })
  })

  // ─── File operations ──────────────────────────────────────────────────────

  describe('listFiles()', () => {
    it('delegates to IPC and returns file list', async () => {
      const files = [{ name: 'test.wav', createDate: '2026-01-01', createTime: '12:00', time: null, duration: 30, version: 1, length: 100, signature: 'abc' }]
      jensenMock.listFiles.mockResolvedValue(files)
      const result = await client.listFiles()
      expect(jensenMock.listFiles).toHaveBeenCalledTimes(1)
      expect(result).toEqual(files)
    })

    it('wires up onScanProgress for the duration of the call', async () => {
      jensenMock.listFiles.mockResolvedValue([])
      const onProgress = vi.fn()
      await client.listFiles(onProgress)

      // onScanProgress should have been subscribed
      expect(jensenMock.onScanProgress).toHaveBeenCalledTimes(1)
    })

    it('calls the onProgress callback when scan-progress event fires', async () => {
      let capturedScanHandler: ((data: { current: number; total: number }) => void) | null = null
      jensenMock.onScanProgress.mockImplementation((handler) => {
        capturedScanHandler = handler
        return () => {}
      })
      jensenMock.listFiles.mockImplementation(async () => {
        // Simulate scan progress event while listing
        if (capturedScanHandler) capturedScanHandler({ current: 5, total: 100 })
        return []
      })

      const onProgress = vi.fn()
      await client.listFiles(onProgress)

      expect(onProgress).toHaveBeenCalledWith(5, 100)
    })

    it('unsubscribes onScanProgress after call completes', async () => {
      const unsub = vi.fn()
      jensenMock.onScanProgress.mockReturnValue(unsub)
      jensenMock.listFiles.mockResolvedValue([])

      await client.listFiles(vi.fn())

      expect(unsub).toHaveBeenCalledTimes(1)
    })

    it('returns null when IPC returns null', async () => {
      jensenMock.listFiles.mockResolvedValue(null)
      const result = await client.listFiles()
      expect(result).toBeNull()
    })
  })

  describe('deleteFile()', () => {
    it('delegates filename to IPC', async () => {
      jensenMock.deleteFile.mockResolvedValue({ result: 'success' })
      const result = await client.deleteFile('test.wav')
      expect(jensenMock.deleteFile).toHaveBeenCalledWith('test.wav')
      expect(result).toEqual({ result: 'success' })
    })
  })

  describe('formatCard()', () => {
    it('delegates to IPC', async () => {
      jensenMock.formatCard.mockResolvedValue({ result: 'success' })
      const result = await client.formatCard()
      expect(jensenMock.formatCard).toHaveBeenCalledTimes(1)
      expect(result).toEqual({ result: 'success' })
    })
  })

  // ─── downloadFile chunk assembly ──────────────────────────────────────────

  describe('downloadFile()', () => {
    it('returns false immediately when signal is already aborted', async () => {
      const abortController = new AbortController()
      abortController.abort()

      const onChunk = vi.fn()
      const result = await client.downloadFile('test.wav', 1000, onChunk, undefined, abortController.signal)

      expect(result).toBe(false)
      expect(jensenMock.downloadFile).not.toHaveBeenCalled()
    })

    it('subscribes to onDownloadChunk before invoking IPC downloadFile', async () => {
      jensenMock.downloadFile.mockResolvedValue(true)
      await client.downloadFile('test.wav', 1000, vi.fn())
      expect(jensenMock.onDownloadChunk).toHaveBeenCalledTimes(1)
    })

    it('does NOT subscribe to onDownloadProgress when no onProgress is provided', async () => {
      jensenMock.downloadFile.mockResolvedValue(true)
      await client.downloadFile('test.wav', 1000, vi.fn())
      expect(jensenMock.onDownloadProgress).not.toHaveBeenCalled()
    })

    it('subscribes to onDownloadProgress when onProgress is provided', async () => {
      jensenMock.downloadFile.mockResolvedValue(true)
      await client.downloadFile('test.wav', 1000, vi.fn(), vi.fn())
      expect(jensenMock.onDownloadProgress).toHaveBeenCalledTimes(1)
    })

    it('passes chunks to onChunk callback when download-chunk events fire', async () => {
      let capturedChunkHandler: ((data: { filename: string; data: Uint8Array }) => void) | null = null
      jensenMock.onDownloadChunk.mockImplementation((handler) => {
        capturedChunkHandler = handler
        return () => {}
      })

      const chunk1 = new Uint8Array([1, 2, 3])
      const chunk2 = new Uint8Array([4, 5, 6])

      jensenMock.downloadFile.mockImplementation(async () => {
        // Simulate chunks arriving during download
        if (capturedChunkHandler) {
          capturedChunkHandler({ filename: 'test.wav', data: chunk1 })
          capturedChunkHandler({ filename: 'test.wav', data: chunk2 })
        }
        return true
      })

      const receivedChunks: Uint8Array[] = []
      const onChunk = (data: Uint8Array) => receivedChunks.push(data)

      const result = await client.downloadFile('test.wav', 6, onChunk)

      expect(result).toBe(true)
      expect(receivedChunks).toHaveLength(2)
      expect(receivedChunks[0]).toEqual(chunk1)
      expect(receivedChunks[1]).toEqual(chunk2)
    })

    it('filters out chunks for other filenames', async () => {
      let capturedChunkHandler: ((data: { filename: string; data: Uint8Array }) => void) | null = null
      jensenMock.onDownloadChunk.mockImplementation((handler) => {
        capturedChunkHandler = handler
        return () => {}
      })

      jensenMock.downloadFile.mockImplementation(async () => {
        if (capturedChunkHandler) {
          capturedChunkHandler({ filename: 'OTHER.wav', data: new Uint8Array([99]) })
          capturedChunkHandler({ filename: 'test.wav', data: new Uint8Array([1, 2]) })
        }
        return true
      })

      const receivedChunks: Uint8Array[] = []
      await client.downloadFile('test.wav', 2, (data) => receivedChunks.push(data))

      expect(receivedChunks).toHaveLength(1)
      expect(receivedChunks[0]).toEqual(new Uint8Array([1, 2]))
    })

    it('drains trailing chunk events that arrive after the invoke resolves', async () => {
      // Regression: the jensen:download-chunk events travel on a different IPC
      // channel than the downloadFile invoke reply. Under load the invoke can
      // resolve while batched chunks are still queued; tearing the listener
      // down immediately would drop them and truncate the file.
      let capturedChunkHandler: ((data: { filename: string; data: Uint8Array }) => void) | null = null
      const unsubChunk = vi.fn()
      jensenMock.onDownloadChunk.mockImplementation((handler) => {
        capturedChunkHandler = handler
        return unsubChunk
      })

      jensenMock.downloadFile.mockImplementation(async () => {
        // Deliver only part of the file, then resolve the invoke (it "wins" the race)…
        capturedChunkHandler?.({ filename: 'test.wav', data: new Uint8Array([1, 2]) })
        // …and let the remaining chunk arrive AFTER the invoke promise resolves.
        setTimeout(() => {
          capturedChunkHandler?.({ filename: 'test.wav', data: new Uint8Array([3, 4]) })
        }, 10)
        return true
      })

      const receivedChunks: Uint8Array[] = []
      await client.downloadFile('test.wav', 4, (data) => receivedChunks.push(data))

      // The trailing chunk was drained, not dropped — full file received.
      const total = receivedChunks.reduce((n, c) => n + c.length, 0)
      expect(total).toBe(4)
      // Cleanup still ran, but only after draining.
      expect(unsubChunk).toHaveBeenCalledTimes(1)
    })

    it('invokes onProgress callback when download-progress events fire', async () => {
      let capturedProgressHandler: ((data: { filename: string; bytesReceived: number; totalBytes: number }) => void) | null = null
      jensenMock.onDownloadProgress.mockImplementation((handler) => {
        capturedProgressHandler = handler
        return () => {}
      })

      jensenMock.downloadFile.mockImplementation(async () => {
        if (capturedProgressHandler) {
          capturedProgressHandler({ filename: 'test.wav', bytesReceived: 500, totalBytes: 1000 })
        }
        return true
      })

      const progressValues: number[] = []
      await client.downloadFile('test.wav', 1000, vi.fn(), (received) => progressValues.push(received))

      expect(progressValues).toEqual([500])
    })

    it('unsubscribes chunk and progress listeners after download completes', async () => {
      const unsubChunk = vi.fn()
      const unsubProgress = vi.fn()
      jensenMock.onDownloadChunk.mockReturnValue(unsubChunk)
      jensenMock.onDownloadProgress.mockReturnValue(unsubProgress)
      jensenMock.downloadFile.mockResolvedValue(true)

      await client.downloadFile('test.wav', 100, vi.fn(), vi.fn())

      expect(unsubChunk).toHaveBeenCalledTimes(1)
      expect(unsubProgress).toHaveBeenCalledTimes(1)
    })

    it('calls cancelDownload via IPC when abort signal fires', async () => {
      const abortController = new AbortController()
      let resolveDownload: (value: boolean) => void = () => {}

      jensenMock.downloadFile.mockImplementation(() =>
        new Promise<boolean>((resolve) => { resolveDownload = resolve })
      )
      jensenMock.onDownloadChunk.mockReturnValue(() => {})
      jensenMock.cancelDownload.mockResolvedValue(null)

      const downloadPromise = client.downloadFile('test.wav', 1000, vi.fn(), undefined, abortController.signal)

      // Trigger abort after download starts
      abortController.abort()
      resolveDownload(false)

      await downloadPromise

      expect(jensenMock.cancelDownload).toHaveBeenCalledTimes(1)
    })

    it('passes filename and fileSize to IPC downloadFile', async () => {
      jensenMock.downloadFile.mockResolvedValue(true)
      await client.downloadFile('recording.wav', 2048, vi.fn())
      expect(jensenMock.downloadFile).toHaveBeenCalledWith('recording.wav', 2048)
    })
  })

  // ─── Realtime streaming ───────────────────────────────────────────────────

  describe('getRealtimeSettings()', () => {
    it('delegates to IPC', async () => {
      jensenMock.getRealtimeSettings.mockResolvedValue({ enabled: true })
      const result = await client.getRealtimeSettings()
      expect(result).toEqual({ enabled: true })
    })
  })

  describe('startRealtime()', () => {
    it('delegates to IPC', async () => {
      jensenMock.startRealtime.mockResolvedValue({ result: 'success' })
      const result = await client.startRealtime()
      expect(result).toEqual({ result: 'success' })
    })
  })

  describe('getRealtimeData()', () => {
    it('delegates offset to IPC', async () => {
      jensenMock.getRealtimeData.mockResolvedValue({ rest: 0, data: new Uint8Array([1, 2, 3]) })
      const result = await client.getRealtimeData(42)
      expect(jensenMock.getRealtimeData).toHaveBeenCalledWith(42)
      expect(result).not.toBeNull()
    })
  })

  // ─── Battery & Bluetooth ──────────────────────────────────────────────────

  describe('getBatteryStatus()', () => {
    it('delegates to IPC', async () => {
      jensenMock.getBatteryStatus.mockResolvedValue({ status: 'charging', batteryLevel: 65 })
      const result = await client.getBatteryStatus()
      expect(result).toEqual({ status: 'charging', batteryLevel: 65 })
    })
  })

  describe('startBluetoothScan()', () => {
    it('passes duration to IPC', async () => {
      await client.startBluetoothScan(30)
      expect(jensenMock.startBluetoothScan).toHaveBeenCalledWith(30)
    })

    it('passes undefined when no duration provided', async () => {
      await client.startBluetoothScan()
      expect(jensenMock.startBluetoothScan).toHaveBeenCalledWith(undefined)
    })
  })

  describe('getBluetoothStatus()', () => {
    it('delegates to IPC', async () => {
      jensenMock.getBluetoothStatus.mockResolvedValue({ connected: true })
      const result = await client.getBluetoothStatus()
      expect(result).toEqual({ connected: true })
    })
  })

  // ─── Lock state (safe defaults) ───────────────────────────────────────────

  describe('isOperationInProgress()', () => {
    it('returns false (safe default — main process serialises)', () => {
      expect(client.isOperationInProgress()).toBe(false)
    })
  })

  describe('getLockHolder()', () => {
    it('returns null (safe default)', () => {
      expect(client.getLockHolder()).toBeNull()
    })
  })

  // ─── No-op USB listener methods ───────────────────────────────────────────

  describe('setupUsbConnectListener()', () => {
    it('is a no-op (main process owns USB lifecycle)', () => {
      expect(() => client.setupUsbConnectListener()).not.toThrow()
    })
  })

  describe('removeUsbConnectListener()', () => {
    it('is a no-op (main process owns USB lifecycle)', () => {
      expect(() => client.removeUsbConnectListener()).not.toThrow()
    })
  })

  // ─── destroy() ────────────────────────────────────────────────────────────

  describe('destroy()', () => {
    it('calls all cleanup functions', () => {
      const cleanupState = vi.fn()
      const cleanupConnect = vi.fn()
      const cleanupDisconnect = vi.fn()

      jensenMock.onStateChanged.mockReturnValue(cleanupState)
      jensenMock.onConnect.mockReturnValue(cleanupConnect)
      jensenMock.onDisconnect.mockReturnValue(cleanupDisconnect)

      const freshClient = new JensenIpcClient()
      freshClient.destroy()

      expect(cleanupState).toHaveBeenCalledTimes(1)
      expect(cleanupConnect).toHaveBeenCalledTimes(1)
      expect(cleanupDisconnect).toHaveBeenCalledTimes(1)
    })
  })

  // ─── Edge cases ───────────────────────────────────────────────────────────

  describe('graceful degradation when window.electronAPI is unavailable', () => {
    it('does not throw when window is undefined during construction', () => {
      const originalWindow = (globalThis as any).window
      delete (globalThis as any).window

      expect(() => new JensenIpcClient()).not.toThrow()

      ;(globalThis as any).window = originalWindow
    })

    it('does not throw when window.electronAPI.jensen is missing', () => {
      (globalThis as any).window = { electronAPI: {} }

      expect(() => new JensenIpcClient()).not.toThrow()
    })
  })
})
