// CHARACTERIZATION (C5 Phase 0) — pins current behavior, not desired behavior; see device-pipeline-spec §1, §4
/**
 * Pins two things Phase 0 needs frozen before any cutover of DevicePipelineService
 * (docs/specs/2026-07-11-device-pipeline-spec.md §1 last two rows, §2
 * additive-coordinator row, §4 Phase 0):
 *
 *  (A) The EXPORTED SURFACE — the public action/query method names the class,
 *      instance accessor, and IPC bridge currently expose. A later slice cutting
 *      over to this coordinator must preserve (or deliberately, visibly change)
 *      this surface.
 *  (B) STAYS INERT — merely constructing DevicePipelineService, or calling
 *      registerDevicePipelineHandlers(), never auto-starts auto-connect: it does
 *      NOT call initAutoConnect() and does NOT bind a USB 'connect' listener on
 *      its own. Only an explicit initAutoConnect() call binds the listener. This
 *      is the "not yet activated/consumed" state spec §4 Phase 5 will change.
 *
 * Sibling suites already cover phase-machine BEHAVIOR and handler delegation in
 * depth — this file does NOT duplicate that:
 *  - device-pipeline.test.ts: phase sequence, shouldScan cache, init
 *    failure/retry, scoped downloads, transcription funnel, auto-connect
 *    policy-at-event-time, user-action transitions.
 *  - device-pipeline-handlers.test.ts: 8-channel registration, delegation, event
 *    bridge, empty-filename rejection, throw→null/false.
 *
 * MOCK-ONLY — no real USB hardware, no real Electron (CLAUDE.md device-safety
 * rules). The real-singleton dependency graph (jensen/download-service/config/
 * transcription/database + 'electron') is mocked with minimal stand-ins so
 * device-pipeline-instance.ts and device-pipeline-handlers.ts can be exercised
 * for real (not stubbed out entirely) while never touching native USB.
 */

// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted fakes for the real-singleton dependency graph (jensen/download-service
// /config/transcription/database). vi.hoisted so the vi.mock factories below —
// which vitest hoists above these imports — can close over them.
// ---------------------------------------------------------------------------

const { fakeJensen, fakeDownloadService } = vi.hoisted(() => {
  return {
    fakeJensen: {
      connect: vi.fn().mockResolvedValue(true),
      tryConnect: vi.fn().mockResolvedValue(true),
      disconnect: vi.fn().mockResolvedValue(undefined),
      reset: vi.fn().mockResolvedValue(true),
      isConnected: vi.fn().mockReturnValue(false),
      getModel: vi.fn().mockReturnValue('hidock-h1e'),
      getDeviceInfo: vi.fn().mockResolvedValue(null),
      getCardInfo: vi.fn().mockResolvedValue(null),
      getFileCount: vi.fn().mockResolvedValue(null),
      getSettings: vi.fn().mockResolvedValue(null),
      setTime: vi.fn().mockResolvedValue(null),
      setAutoRecord: vi.fn().mockResolvedValue(null),
      listFiles: vi.fn().mockResolvedValue([]),
      downloadFile: vi.fn().mockResolvedValue(true),
      deleteFile: vi.fn().mockResolvedValue(null),
      formatCard: vi.fn().mockResolvedValue(null),
      serialNumber: null as string | null,
      versionCode: null as string | null
    },
    fakeDownloadService: {
      getFilesToSync: vi.fn().mockReturnValue([]),
      processDownload: vi.fn().mockResolvedValue({ success: true }),
      cancelActiveDownloads: vi.fn().mockReturnValue(0)
    }
  }
})

vi.mock('../jensen', () => ({ getJensenDevice: () => fakeJensen }))
vi.mock('../download-service', () => ({ getDownloadService: () => fakeDownloadService }))
// autoConnect: true — deliberately ON, so the KNOWN-ODD test below proves the
// real singleton stays inert for a structural reason (no usbEvents wired), not
// merely because the policy happens to be off.
vi.mock('../config', () => ({ getConfig: () => ({ device: { autoConnect: true } }) }))
vi.mock('../transcription', () => ({ queueTranscriptionIfEnabled: vi.fn() }))
vi.mock('../database', () => ({ getRecordingByFilename: vi.fn(() => null) }))
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn(() => []) }
}))

import {
  DevicePipelineService,
  type PipelineJensen,
  type PipelineDownloadService,
  type PipelineUsbEvents
} from '../device-pipeline'
import {
  getDevicePipelineService,
  __resetDevicePipelineServiceForTests
} from '../device-pipeline-instance'
import {
  registerDevicePipelineHandlers,
  __resetDevicePipelineBridgeForTests
} from '../../ipc/device-pipeline-handlers'

// ---------------------------------------------------------------------------
// Local mock builders (kept independent of the sibling test file on purpose —
// this file characterizes the surface/inert contract, not phase behavior, and
// should not couple to how the phase-behavior suite constructs its mocks).
// ---------------------------------------------------------------------------

function makeJensen(overrides: Partial<PipelineJensen> = {}): PipelineJensen {
  return {
    connect: vi.fn().mockResolvedValue(true),
    tryConnect: vi.fn().mockResolvedValue(true),
    disconnect: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn().mockResolvedValue(true),
    isConnected: vi.fn().mockReturnValue(false),
    getModel: vi.fn().mockReturnValue('hidock-h1e'),
    getDeviceInfo: vi.fn().mockResolvedValue(null),
    getCardInfo: vi.fn().mockResolvedValue(null),
    getFileCount: vi.fn().mockResolvedValue(null),
    getSettings: vi.fn().mockResolvedValue(null),
    setTime: vi.fn().mockResolvedValue(null),
    setAutoRecord: vi.fn().mockResolvedValue(null),
    listFiles: vi.fn().mockResolvedValue([]),
    downloadFile: vi.fn().mockResolvedValue(true),
    deleteFile: vi.fn().mockResolvedValue(null),
    formatCard: vi.fn().mockResolvedValue(null),
    serialNumber: null,
    versionCode: null,
    ...overrides
  }
}

function makeDownloadService(
  overrides: Partial<PipelineDownloadService> = {}
): PipelineDownloadService {
  return {
    getFilesToSync: vi.fn().mockReturnValue([]),
    processDownload: vi.fn().mockResolvedValue({ success: true }),
    cancelActiveDownloads: vi.fn().mockReturnValue(0),
    ...overrides
  }
}

/** The Phase-0 hook point: PipelineUsbEvents.addEventListener('connect', …). */
function makeUsb(): { usb: PipelineUsbEvents; addSpy: ReturnType<typeof vi.fn> } {
  const addSpy = vi.fn()
  const usb: PipelineUsbEvents = {
    addEventListener: addSpy,
    removeEventListener: vi.fn(),
    getDevices: vi.fn().mockResolvedValue([])
  }
  return { usb, addSpy }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DevicePipelineService — Phase 0 inert-pipeline characterization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __resetDevicePipelineServiceForTests()
    __resetDevicePipelineBridgeForTests()
  })

  // ---------------------------------------------------------------------------
  // (A) EXPORTED SURFACE CONTRACT
  // ---------------------------------------------------------------------------

  describe('exported surface contract', () => {
    it('DevicePipelineService exposes the current public action/query methods as functions', () => {
      const svc = new DevicePipelineService(makeJensen(), makeDownloadService())

      const expectedMethods = [
        'getState',
        'getFiles',
        'connect',
        'disconnect',
        'manualSync',
        'cancelDownloads',
        'deleteFile',
        'formatDevice',
        'setAutoRecord',
        // Auto-connect binding methods (spec §"Auto-Connect Flow").
        'initAutoConnect',
        'removeAutoConnect'
      ] as const

      for (const method of expectedMethods) {
        expect(typeof (svc as unknown as Record<string, unknown>)[method], `expected ${method} to be a function`).toBe(
          'function'
        )
      }
    })

    it('getDevicePipelineService() and registerDevicePipelineHandlers() are exported as functions (module surface)', () => {
      expect(typeof getDevicePipelineService).toBe('function')
      expect(typeof __resetDevicePipelineServiceForTests).toBe('function')
      expect(typeof registerDevicePipelineHandlers).toBe('function')
      expect(typeof __resetDevicePipelineBridgeForTests).toBe('function')
    })
  })

  // ---------------------------------------------------------------------------
  // (A) DEFAULT SNAPSHOT — fresh service, no connect() called
  // ---------------------------------------------------------------------------

  describe('default snapshot — fresh service, no connect() called', () => {
    it('getState() returns the full inert/disconnected default shape', () => {
      const svc = new DevicePipelineService(makeJensen(), makeDownloadService())

      expect(svc.getState()).toEqual({
        phase: 'disconnected',
        device: null,
        scanProgress: null,
        downloadProgress: null,
        error: null
      })
    })

    it('getFiles() returns [] before any scan has populated the cache', () => {
      const svc = new DevicePipelineService(makeJensen(), makeDownloadService())
      expect(svc.getFiles()).toEqual([])
    })
  })

  // ---------------------------------------------------------------------------
  // (B) STAYS INERT — the core Phase-0 pin
  // ---------------------------------------------------------------------------

  describe('stays inert — construction and IPC registration never auto-bind auto-connect', () => {
    it('constructing DevicePipelineService with usbEvents does NOT call addEventListener', () => {
      const { usb, addSpy } = makeUsb()
      new DevicePipelineService(makeJensen(), makeDownloadService(), { usbEvents: usb })

      expect(addSpy).not.toHaveBeenCalled()
    })

    it('registerDevicePipelineHandlers() does NOT call initAutoConnect / bind the usb connect listener on its own', () => {
      const { usb, addSpy } = makeUsb()
      const svc = new DevicePipelineService(makeJensen(), makeDownloadService(), { usbEvents: usb })

      registerDevicePipelineHandlers(svc)

      expect(addSpy).not.toHaveBeenCalled()
    })

    it('CONTROL: an explicit initAutoConnect() call DOES bind the connect listener — proves the spy hook point is correct', async () => {
      const { usb, addSpy } = makeUsb()
      const svc = new DevicePipelineService(makeJensen(), makeDownloadService(), { usbEvents: usb })

      await svc.initAutoConnect()

      expect(addSpy).toHaveBeenCalledWith('connect', expect.any(Function))
    })

    // KNOWN-ODD: the real-singleton wiring (device-pipeline-instance.ts) never
    // passes a `usbEvents` option to the constructor at all today, so even an
    // explicit initAutoConnect() call on the real singleton cannot bind a
    // listener or auto-connect to an already-attached device — the whole method
    // is a structural no-op on the production wiring, independent of the
    // autoConnect config flag (mocked ON above). This is exactly the "not yet
    // activated/consumed" state spec §4 Phase 5 changes when real WebUSB events
    // are wired in on cutover.
    it('KNOWN-ODD: initAutoConnect() on the real singleton is a structural no-op — no usbEvents is wired (spec §4 Phase 5)', async () => {
      const svc = getDevicePipelineService()

      await svc.initAutoConnect()

      expect(fakeJensen.connect).not.toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  // SINGLETON
  // ---------------------------------------------------------------------------

  describe('getDevicePipelineService() singleton', () => {
    it('returns the SAME instance across repeated calls', () => {
      const a = getDevicePipelineService()
      const b = getDevicePipelineService()
      expect(b).toBe(a)
    })

    it('__resetDevicePipelineServiceForTests() clears the singleton — the next call constructs a new instance', () => {
      const a = getDevicePipelineService()
      __resetDevicePipelineServiceForTests()
      const b = getDevicePipelineService()
      expect(b).not.toBe(a)
    })
  })
})
