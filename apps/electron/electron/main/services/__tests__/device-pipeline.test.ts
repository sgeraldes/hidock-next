// @vitest-environment node

/**
 * Unit tests for DevicePipelineService (Slice 3 of the USB Device Pipeline).
 *
 * MOCK-ONLY — NO real USB hardware is touched (CLAUDE.md device-safety rules).
 * JensenDevice, DownloadService, config, and the transcription funnel are all
 * hand-rolled mocks injected via the constructor.
 *
 * Coverage:
 *  - Strict phase sequence on connect (connecting → init → scan → reconcile →
 *    download → idle) and the SCAN-skip variant.
 *  - shouldScan() cache logic.
 *  - Init total-failure → reset + retry → error; partial init success continues.
 *  - SCOPED downloads: only the reconciled set is downloaded, sequentially.
 *  - Auto-connect handler honours config AT EVENT TIME (gate true → connects,
 *    false → ignored), and live toggling.
 *  - manualSync / cancelDownloads / disconnect transitions.
 *  - The transcription funnel is invoked (gate not duplicated) after a download.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { FileInfo } from '@hidock/jensen-protocol'
import {
  DevicePipelineService,
  type PipelineJensen,
  type PipelineDownloadService,
  type PipelineUsbEvents,
  type PipelineState
} from '../device-pipeline'

// ---------------------------------------------------------------------------
// Mock builders
// ---------------------------------------------------------------------------

function makeFileInfo(name: string, length = 1000): FileInfo {
  return {
    name,
    createDate: '2026-06-25',
    createTime: '10:00:00',
    time: new Date('2026-06-25T10:00:00Z'),
    duration: 60,
    version: 5,
    length,
    signature: 'sig'
  }
}

function makeJensen(overrides: Partial<PipelineJensen> = {}): PipelineJensen {
  const base: PipelineJensen = {
    connect: vi.fn().mockResolvedValue(true),
    tryConnect: vi.fn().mockResolvedValue(true),
    disconnect: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn().mockResolvedValue(true),
    isConnected: vi.fn().mockReturnValue(true),
    getModel: vi.fn().mockReturnValue('hidock-h1e'),
    getDeviceInfo: vi
      .fn()
      .mockResolvedValue({ serialNumber: 'SN123', versionCode: '6.2.5', versionNumber: 327733 }),
    getCardInfo: vi.fn().mockResolvedValue({ used: 100, capacity: 1000, free: 900 }),
    getFileCount: vi.fn().mockResolvedValue({ count: 2 }),
    getSettings: vi.fn().mockResolvedValue({ autoRecord: true }),
    setTime: vi.fn().mockResolvedValue({ result: 'success' }),
    setAutoRecord: vi.fn().mockResolvedValue({ result: 'success' }),
    listFiles: vi.fn().mockResolvedValue([makeFileInfo('a.hda'), makeFileInfo('b.hda')]),
    downloadFile: vi.fn().mockImplementation(
      async (
        _filename: string,
        size: number,
        onChunk: (d: Uint8Array) => void,
        onProgress?: (n: number) => void
      ) => {
        onChunk(new Uint8Array(size))
        onProgress?.(size)
        return true
      }
    ),
    deleteFile: vi.fn().mockResolvedValue({ result: 'success' }),
    formatCard: vi.fn().mockResolvedValue({ result: 'success' }),
    serialNumber: 'SN123',
    versionCode: '6.2.5',
    onconnect: undefined,
    ondisconnect: undefined
  }
  return { ...base, ...overrides }
}

function makeDownloadService(
  overrides: Partial<PipelineDownloadService> = {}
): PipelineDownloadService {
  const base: PipelineDownloadService = {
    // By default, every device file needs syncing (no skipReason).
    getFilesToSync: vi.fn((deviceFiles) =>
      deviceFiles.map((f) => ({ ...f }))
    ),
    processDownload: vi.fn().mockResolvedValue({ success: true, filePath: '/rec/x.mp3' }),
    cancelActiveDownloads: vi.fn().mockReturnValue(0)
  }
  return { ...base, ...overrides }
}

/** Capture every state emitted so we can assert the phase ORDER. */
function trackPhases(svc: DevicePipelineService): string[] {
  const phases: string[] = []
  svc.on('state', (s: PipelineState) => phases.push(s.phase))
  return phases
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DevicePipelineService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('phase sequence on connect', () => {
    it('runs connecting → initializing → scanning → reconciling → downloading → idle', async () => {
      const jensen = makeJensen()
      const dl = makeDownloadService()
      const svc = new DevicePipelineService(jensen, dl)
      const phases = trackPhases(svc)

      await svc.connect()

      expect(phases).toContain('connecting')
      // Strict linear order of the core phases.
      const order = ['connecting', 'initializing', 'scanning', 'reconciling', 'downloading', 'idle']
      const filtered = phases.filter((p) => order.includes(p))
      // Each core phase appears, and the first occurrences are in order.
      const firstIdx = order.map((p) => filtered.indexOf(p))
      expect(firstIdx.every((i) => i >= 0)).toBe(true)
      const sorted = [...firstIdx].sort((a, b) => a - b)
      expect(firstIdx).toEqual(sorted)
      expect(svc.getState().phase).toBe('idle')
    })

    it('populates device state from init commands', async () => {
      const jensen = makeJensen()
      const svc = new DevicePipelineService(jensen, makeDownloadService())
      await svc.connect()

      const dev = svc.getState().device
      expect(dev).not.toBeNull()
      expect(dev?.serialNumber).toBe('SN123')
      expect(dev?.firmwareVersion).toBe('6.2.5')
      expect(dev?.recordingCount).toBe(2)
      expect(dev?.settings).toEqual({ autoRecord: true })
      expect(dev?.storage).toEqual({ used: 100, capacity: 1000, freePercent: 90 })
    })

    it('emits the scanned file list', async () => {
      const jensen = makeJensen()
      const svc = new DevicePipelineService(jensen, makeDownloadService())
      const filesEmitted: FileInfo[][] = []
      svc.on('files', (f: FileInfo[]) => filesEmitted.push(f))

      await svc.connect()

      expect(filesEmitted.length).toBeGreaterThan(0)
      expect(svc.getFiles().map((f) => f.name)).toEqual(['a.hda', 'b.hda'])
    })

    it('goes straight to idle when reconcile yields nothing to download', async () => {
      const jensen = makeJensen()
      // Everything already synced → skipReason set on all.
      const dl = makeDownloadService({
        getFilesToSync: vi.fn((deviceFiles) =>
          deviceFiles.map((f) => ({ ...f, skipReason: 'already synced' }))
        )
      })
      const svc = new DevicePipelineService(jensen, dl)
      const phases = trackPhases(svc)

      await svc.connect()

      expect(phases).not.toContain('downloading')
      expect(jensen.downloadFile).not.toHaveBeenCalled()
      expect(svc.getState().phase).toBe('idle')
    })

    it('sets error phase when the manual connect fails', async () => {
      const jensen = makeJensen({ connect: vi.fn().mockResolvedValue(false) })
      const svc = new DevicePipelineService(jensen, makeDownloadService())

      const ok = await svc.connect()

      expect(ok).toBe(false)
      expect(svc.getState().phase).toBe('error')
      expect(jensen.getDeviceInfo).not.toHaveBeenCalled()
    })
  })

    describe('shouldScan() cache logic', () => {
      it('passes and publishes the streaming onNewFiles callback', async () => {
        const first = makeFileInfo('streamed.hda')
        const listFiles = vi.fn(async (_progress, _expected, onNewFiles) => {
          onNewFiles?.([first])
          return [first]
        })
        const jensen = makeJensen({ listFiles })
        const svc = new DevicePipelineService(jensen, makeDownloadService())
        const snapshots: string[][] = []
        svc.on('files', files => snapshots.push(files.map(file => file.name)))

        await svc.connect()

        expect(listFiles.mock.calls[0][2]).toEqual(expect.any(Function))
        expect(snapshots).toContainEqual(['streamed.hda'])
      })

    it('scans on first connect (no cache)', async () => {
      const jensen = makeJensen()
      const svc = new DevicePipelineService(jensen, makeDownloadService())
      await svc.connect()
      expect(jensen.listFiles).toHaveBeenCalledTimes(1)
    })

    it('skips scan on reconnect when recording count is unchanged', async () => {
      const jensen = makeJensen()
      const svc = new DevicePipelineService(jensen, makeDownloadService())
      await svc.connect()
      expect(jensen.listFiles).toHaveBeenCalledTimes(1)

      // Reconnect with the SAME count and a still-populated cache → skip scan.
      // (connect() does not clear the cache; disconnect does.)
      vi.clearAllMocks()
      ;(jensen.getFileCount as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 2 })
      await svc.connect()
      expect(jensen.listFiles).not.toHaveBeenCalled()
    })

    it('re-scans when the recording count changed', async () => {
      const jensen = makeJensen()
      const svc = new DevicePipelineService(jensen, makeDownloadService())
      await svc.connect()

      vi.clearAllMocks()
      ;(jensen.getFileCount as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 5 })
      ;(jensen.listFiles as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeFileInfo('a.hda'),
        makeFileInfo('b.hda'),
        makeFileInfo('c.hda')
      ])
      await svc.connect()
      expect(jensen.listFiles).toHaveBeenCalledTimes(1)
    })

    it('shouldScan() reports true when count is zero even with a cache', async () => {
      const jensen = makeJensen({ getFileCount: vi.fn().mockResolvedValue({ count: 0 }) })
      const svc = new DevicePipelineService(jensen, makeDownloadService())
      // Initialize state so device.recordingCount = 0.
      await svc.initialize()
      expect(svc.shouldScan()).toBe(true)
    })
  })

  describe('init failure → reset + retry → error', () => {
    it('returns false from initialize() when ALL commands fail', async () => {
      const jensen = makeJensen({
        getDeviceInfo: vi.fn().mockResolvedValue(null),
        getCardInfo: vi.fn().mockResolvedValue(null),
        getFileCount: vi.fn().mockResolvedValue(null),
        getSettings: vi.fn().mockResolvedValue(null),
        setTime: vi.fn().mockResolvedValue(null)
      })
      const svc = new DevicePipelineService(jensen, makeDownloadService())
      expect(await svc.initialize()).toBe(false)
    })

    it('total init failure → reset + tryConnect + retry, then error if retry also fails', async () => {
      const jensen = makeJensen({
        getDeviceInfo: vi.fn().mockResolvedValue(null),
        getCardInfo: vi.fn().mockResolvedValue(null),
        getFileCount: vi.fn().mockResolvedValue(null),
        getSettings: vi.fn().mockResolvedValue(null),
        setTime: vi.fn().mockResolvedValue(null),
        tryConnect: vi.fn().mockResolvedValue(true)
      })
      const svc = new DevicePipelineService(jensen, makeDownloadService())

      await svc.connect()

      expect(jensen.reset).toHaveBeenCalledTimes(1)
      expect(jensen.tryConnect).toHaveBeenCalledTimes(1)
      // getDeviceInfo called twice: initial attempt + the single retry.
      expect((jensen.getDeviceInfo as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2)
      expect(jensen.disconnect).toHaveBeenCalled()
      expect(svc.getState().phase).toBe('error')
      expect(svc.getState().error).toMatch(/unplug and reconnect/i)
    })

    it('total init failure → reset + retry SUCCEEDS → continues to idle', async () => {
      let infoCalls = 0
      const jensen = makeJensen({
        getDeviceInfo: vi.fn().mockImplementation(async () => {
          infoCalls++
          // Fail the whole first init, succeed on retry.
          return infoCalls === 1
            ? null
            : { serialNumber: 'SN9', versionCode: '6.2.5', versionNumber: 327733 }
        }),
        getCardInfo: vi.fn().mockImplementation(async () => (infoCalls === 1 ? null : { used: 1, capacity: 10, free: 9 })),
        getFileCount: vi.fn().mockImplementation(async () => (infoCalls === 1 ? null : { count: 1 })),
        getSettings: vi.fn().mockImplementation(async () => (infoCalls === 1 ? null : { autoRecord: false })),
        setTime: vi.fn().mockImplementation(async () => (infoCalls === 1 ? null : { result: 'success' })),
        tryConnect: vi.fn().mockResolvedValue(true)
      })
      const svc = new DevicePipelineService(jensen, makeDownloadService())

      await svc.connect()

      expect(jensen.reset).toHaveBeenCalledTimes(1)
      expect(jensen.disconnect).not.toHaveBeenCalled()
      expect(svc.getState().phase).toBe('idle')
      expect(svc.getState().device?.serialNumber).toBe('SN9')
    })

    it('partial init success (some commands fail) continues — does NOT error', async () => {
      const jensen = makeJensen({
        getCardInfo: vi.fn().mockResolvedValue(null), // storage unavailable
        getSettings: vi.fn().mockResolvedValue(null) // settings unavailable
      })
      const svc = new DevicePipelineService(jensen, makeDownloadService())

      await svc.connect()

      expect(jensen.reset).not.toHaveBeenCalled()
      expect(svc.getState().phase).toBe('idle')
      expect(svc.getState().device?.storage).toBeNull()
      expect(svc.getState().device?.settings).toBeNull()
      expect(svc.getState().device?.recordingCount).toBe(2)
    })
  })

  describe('scoped downloads (only the requested set)', () => {
    it('downloads ONLY the files reconcile selected — not the whole list', async () => {
      const jensen = makeJensen({
        listFiles: vi.fn().mockResolvedValue([
          makeFileInfo('keep1.hda'),
          makeFileInfo('skip.hda'),
          makeFileInfo('keep2.hda')
        ])
      })
      // Mark the middle file as already-synced → it must NOT be downloaded.
      const dl = makeDownloadService({
        getFilesToSync: vi.fn((deviceFiles) =>
          deviceFiles.map((f) =>
            f.filename === 'skip.hda' ? { ...f, skipReason: 'already synced' } : { ...f }
          )
        )
      })
      const svc = new DevicePipelineService(jensen, dl)

      await svc.connect()

      const downloaded = (jensen.downloadFile as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])
      expect(downloaded).toEqual(['keep1.hda', 'keep2.hda'])
      expect(downloaded).not.toContain('skip.hda')
      expect(jensen.downloadFile).toHaveBeenCalledTimes(2)
    })

    it('downloadAll scopes to its argument and runs sequentially', async () => {
      const order: string[] = []
      const jensen = makeJensen({
        downloadFile: vi.fn().mockImplementation(async (filename: string, size: number, onChunk: (d: Uint8Array) => void) => {
          order.push(`start:${filename}`)
          onChunk(new Uint8Array(size))
          order.push(`end:${filename}`)
          return true
        })
      })
      const svc = new DevicePipelineService(jensen, makeDownloadService())
      // Prime an abort controller via connect would also scan; call downloadAll directly.
      await svc.downloadAll([
        { filename: 'one.hda', size: 10 },
        { filename: 'two.hda', size: 20 }
      ])

      // Sequential: each file fully finishes before the next starts.
      expect(order).toEqual(['start:one.hda', 'end:one.hda', 'start:two.hda', 'end:two.hda'])
    })

    it('hands transferred bytes to DownloadService.processDownload per file', async () => {
      const jensen = makeJensen()
      const dl = makeDownloadService()
      const svc = new DevicePipelineService(jensen, dl)

      await svc.connect()

      expect(dl.processDownload).toHaveBeenCalledTimes(2)
      // Buffer length should match the device file size (1000 from makeFileInfo).
      const firstCall = (dl.processDownload as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(Buffer.isBuffer(firstCall[1])).toBe(true)
      expect((firstCall[1] as Buffer).length).toBe(1000)
    })

    it('stops downloading when the device disconnects mid-batch', async () => {
      const jensen = makeJensen()
      const isConnected = vi.fn()
        .mockReturnValueOnce(true) // first file proceeds
        .mockReturnValue(false) // device "gone" before second
      jensen.isConnected = isConnected
      const svc = new DevicePipelineService(jensen, makeDownloadService())

      await svc.downloadAll([
        { filename: 'one.hda', size: 10 },
        { filename: 'two.hda', size: 20 }
      ])

      expect(jensen.downloadFile).toHaveBeenCalledTimes(1)
    })
  })

  describe('transcription funnel (Slice-2 single gate — not duplicated here)', () => {
    it('invokes queueTranscriptionIfEnabled after a successful download', async () => {
      const jensen = makeJensen({
        listFiles: vi.fn().mockResolvedValue([makeFileInfo('rec.hda')])
      })
      const funnel = vi.fn().mockReturnValue(true)
      const getRecordingByFilename = vi.fn().mockReturnValue({ id: 'rec-id-1' })
      const svc = new DevicePipelineService(jensen, makeDownloadService(), {
        queueTranscriptionIfEnabled: funnel,
        getRecordingByFilename
      })

      await svc.connect()

      expect(funnel).toHaveBeenCalledWith('rec-id-1')
      // The pipeline does NOT itself check the autoTranscribe preference.
      expect(funnel).toHaveBeenCalledTimes(1)
    })

    it('does not throw if the recording row cannot be resolved', async () => {
      const jensen = makeJensen({
        listFiles: vi.fn().mockResolvedValue([makeFileInfo('rec.hda')])
      })
      const funnel = vi.fn()
      const svc = new DevicePipelineService(jensen, makeDownloadService(), {
        queueTranscriptionIfEnabled: funnel,
        getRecordingByFilename: vi.fn().mockReturnValue(null)
      })

      await expect(svc.connect()).resolves.toBe(true)
      expect(funnel).not.toHaveBeenCalled()
    })

    it('does not invoke the funnel when processDownload fails', async () => {
      const jensen = makeJensen({
        listFiles: vi.fn().mockResolvedValue([makeFileInfo('rec.hda')])
      })
      const funnel = vi.fn()
      const dl = makeDownloadService({
        processDownload: vi.fn().mockResolvedValue({ success: false, error: 'size mismatch' })
      })
      const svc = new DevicePipelineService(jensen, dl, {
        queueTranscriptionIfEnabled: funnel,
        getRecordingByFilename: vi.fn().mockReturnValue({ id: 'rec-id-1' })
      })

      await svc.connect()
      expect(funnel).not.toHaveBeenCalled()
    })
  })

  describe('auto-connect — policy checked AT EVENT TIME', () => {
    function makeUsb(): { usb: PipelineUsbEvents; fireConnect: () => void; fireDisconnect: () => void } {
      let connectListener: ((e: { device: unknown }) => void) | null = null
      let disconnectListener: ((e: { device: unknown }) => void) | null = null
      const usb: PipelineUsbEvents = {
        addEventListener: vi.fn((type, listener) => {
          if (type === 'connect') connectListener = listener
          else disconnectListener = listener
        }),
        removeEventListener: vi.fn(),
        getDevices: vi.fn().mockResolvedValue([])
      }
      return {
        usb,
        fireConnect: () => connectListener?.({ device: { fake: true } }),
        fireDisconnect: () => disconnectListener?.({ device: { fake: true } })
      }
    }

    it('registers the listener even when auto-connect is OFF at startup', async () => {
      const { usb } = makeUsb()
      const jensen = makeJensen()
      const svc = new DevicePipelineService(jensen, makeDownloadService(), {
        getConfig: () => ({ device: { autoConnect: false } }),
        usbEvents: usb
      })

      await svc.initAutoConnect()

      expect(usb.addEventListener).toHaveBeenCalledWith('connect', expect.any(Function))
      expect(usb.addEventListener).toHaveBeenCalledWith('disconnect', expect.any(Function))
      // No startup auto-connect because preference is off.
      expect(jensen.connect).not.toHaveBeenCalled()
    })

    it('plug event connects when config.autoConnect is true at event time', async () => {
      const { usb, fireConnect } = makeUsb()
      const jensen = makeJensen()
      const autoConnect = true
      const svc = new DevicePipelineService(jensen, makeDownloadService(), {
        getConfig: () => ({ device: { autoConnect } }),
        usbEvents: usb
      })

      await svc.initAutoConnect()
      fireConnect()
      await Promise.resolve()
      await Promise.resolve()

      expect(jensen.connect).toHaveBeenCalled()
      void autoConnect
    })

    it('plug event is IGNORED when config.autoConnect is false at event time', async () => {
      const { usb, fireConnect } = makeUsb()
      const jensen = makeJensen()
      const svc = new DevicePipelineService(jensen, makeDownloadService(), {
        getConfig: () => ({ device: { autoConnect: false } }),
        usbEvents: usb
      })

      await svc.initAutoConnect()
      fireConnect()
      await Promise.resolve()

      expect(jensen.connect).not.toHaveBeenCalled()
    })

    it('honours a LIVE toggle — same listener, different decision each fire', async () => {
      const { usb, fireConnect } = makeUsb()
      const jensen = makeJensen()
      const cfg = { device: { autoConnect: false } }
      const svc = new DevicePipelineService(jensen, makeDownloadService(), {
        getConfig: () => cfg,
        usbEvents: usb
      })

      await svc.initAutoConnect()

      // First fire: off → ignored.
      fireConnect()
      await Promise.resolve()
      expect(jensen.connect).not.toHaveBeenCalled()

      // Toggle ON, fire again: connects (re-read at event time).
      cfg.device.autoConnect = true
      fireConnect()
      await Promise.resolve()
      await Promise.resolve()
      expect(jensen.connect).toHaveBeenCalled()
    })

    it('auto-connects at startup to an already-attached device when enabled', async () => {
      let connectListener: ((e: { device: unknown }) => void) | null = null
      const usb: PipelineUsbEvents = {
        addEventListener: vi.fn((type, listener) => {
          if (type === 'connect') connectListener = listener
        }),
        removeEventListener: vi.fn(),
        getDevices: vi.fn().mockResolvedValue([{ fake: true }])
      }
      const jensen = makeJensen()
      const svc = new DevicePipelineService(jensen, makeDownloadService(), {
        getConfig: () => ({ device: { autoConnect: true } }),
        usbEvents: usb
      })

      await svc.initAutoConnect()
      await Promise.resolve()

      expect(usb.getDevices).toHaveBeenCalled()
      expect(jensen.connect).toHaveBeenCalled()
      void connectListener
    })

    it('disconnect event resets state to disconnected', async () => {
      const { usb, fireDisconnect } = makeUsb()
      const jensen = makeJensen()
      const dl = makeDownloadService()
      const svc = new DevicePipelineService(jensen, dl, {
        getConfig: () => ({ device: { autoConnect: true } }),
        usbEvents: usb
      })

      await svc.initAutoConnect()
      fireDisconnect()
      await Promise.resolve()

      expect(dl.cancelActiveDownloads).toHaveBeenCalled()
      expect(svc.getState().phase).toBe('disconnected')
      expect(svc.getState().device).toBeNull()
    })

    it('removeAutoConnect unbinds the listeners', async () => {
      const { usb } = makeUsb()
      const svc = new DevicePipelineService(makeJensen(), makeDownloadService(), {
        getConfig: () => ({ device: { autoConnect: true } }),
        usbEvents: usb
      })
      await svc.initAutoConnect()
      svc.removeAutoConnect()
      expect(usb.removeEventListener).toHaveBeenCalledWith('connect', expect.any(Function))
      expect(usb.removeEventListener).toHaveBeenCalledWith('disconnect', expect.any(Function))
    })
  })

  describe('user actions — transitions', () => {
    it('disconnect aborts downloads, cancels active, and resets to disconnected', async () => {
      const jensen = makeJensen()
      const dl = makeDownloadService()
      const svc = new DevicePipelineService(jensen, dl)
      await svc.connect()
      expect(svc.getState().phase).toBe('idle')

      await svc.disconnect()

      expect(dl.cancelActiveDownloads).toHaveBeenCalledWith('Device disconnected')
      expect(jensen.disconnect).toHaveBeenCalled()
      expect(svc.getState().phase).toBe('disconnected')
      expect(svc.getState().device).toBeNull()
    })

    it('cancelDownloads cancels active and returns to idle (no disconnect)', async () => {
      const jensen = makeJensen()
      const dl = makeDownloadService()
      const svc = new DevicePipelineService(jensen, dl)
      await svc.connect()

      await svc.cancelDownloads()

      // HIGH-3: a deliberate user cancel is tagged origin 'user' so reconnect will NOT auto-retry it.
      expect(dl.cancelActiveDownloads).toHaveBeenCalledWith('Cancelled by user', 'user')
      expect(jensen.disconnect).not.toHaveBeenCalled()
      expect(svc.getState().phase).toBe('idle')
      expect(svc.getState().downloadProgress).toBeNull()
    })

    it('manualSync forces a fresh scan even when count is unchanged', async () => {
      const jensen = makeJensen()
      const svc = new DevicePipelineService(jensen, makeDownloadService())
      await svc.connect()
      expect(jensen.listFiles).toHaveBeenCalledTimes(1)

      ;(jensen.listFiles as ReturnType<typeof vi.fn>).mockClear()
      ;(jensen.getFileCount as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 2 })

      await svc.manualSync()

      // Cache invalidated → scans again despite identical count.
      expect(jensen.listFiles).toHaveBeenCalledTimes(1)
      expect(svc.getState().phase).toBe('idle')
    })

    it('deleteFile delegates to jensen.deleteFile', async () => {
      const jensen = makeJensen()
      const svc = new DevicePipelineService(jensen, makeDownloadService())
      const res = await svc.deleteFile('gone.hda')
      expect(jensen.deleteFile).toHaveBeenCalledWith('gone.hda')
      expect(res).toEqual({ result: 'success' })
    })

    it('formatDevice formats then re-runs the pipeline', async () => {
      const jensen = makeJensen()
      const svc = new DevicePipelineService(jensen, makeDownloadService())
      await svc.connect()
      ;(jensen.listFiles as ReturnType<typeof vi.fn>).mockClear()

      const res = await svc.formatDevice()

      expect(jensen.formatCard).toHaveBeenCalled()
      expect(res).toEqual({ result: 'success' })
      // Re-scan happened (cache invalidated).
      expect(jensen.listFiles).toHaveBeenCalledTimes(1)
    })

    it('setAutoRecord delegates and reflects the new value in state', async () => {
      const jensen = makeJensen()
      const svc = new DevicePipelineService(jensen, makeDownloadService())
      await svc.connect()

      const res = await svc.setAutoRecord(false)

      expect(jensen.setAutoRecord).toHaveBeenCalledWith(false)
      expect(res).toEqual({ result: 'success' })
      expect(svc.getState().device?.settings).toEqual({ autoRecord: false })
    })
  })

  describe('robustness', () => {
    it('a throwing device command does not crash the phase machine', async () => {
      const jensen = makeJensen({
        getCardInfo: vi.fn().mockRejectedValue(new Error('USB hiccup'))
      })
      const svc = new DevicePipelineService(jensen, makeDownloadService())

      await expect(svc.connect()).resolves.toBe(true)
      expect(svc.getState().phase).toBe('idle')
      expect(svc.getState().device?.storage).toBeNull()
    })

    it('getState/getFiles return safe defaults before any connect', () => {
      const svc = new DevicePipelineService(makeJensen(), makeDownloadService())
      expect(svc.getState().phase).toBe('disconnected')
      expect(svc.getFiles()).toEqual([])
    })
  })
})
