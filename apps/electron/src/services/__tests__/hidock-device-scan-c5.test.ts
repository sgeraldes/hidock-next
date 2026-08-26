// CHARACTERIZATION (C5 Phase 0) — pins current behavior, not desired behavior; see device-pipeline-spec §1, §2
/**
 * Pins listRecordings() scan-lifecycle gap behaviors that the sibling suites
 * (hidock-device.test.ts, hidock-device-autoconnect.test.ts) do not cover:
 *   - count-based cache (forceRefresh bypasses only the time debounce, never the
 *     count-unchanged cache hit)
 *   - cache invalidation when the device's recordingCount changes
 *   - failure backoff ladder (<3 failures → 10s window, >=3 → 60s window,
 *     >=5 → stop auto-retry entirely until forceRefresh)
 *   - 'counting-files' status entry emitted before the terminal status transition
 *   - re-entrancy dedup (a concurrent call reuses the in-flight scan; a
 *     forceRefresh call waits for the in-flight scan, then evaluates a fresh one)
 *
 * KNOWN-ODD: per docs/specs/2026-07-11-device-pipeline-spec.md §3 (migration
 * mapping row "HiDockDeviceService.listRecordings debounce/cache/backoff/locks/
 * init wait"), this entire debounce/cache/backoff/lock mechanism is slated for
 * replacement by the DevicePipeline coordinator's cache validity, sync
 * coalescing, and explicit state transitions. Pinning it here is not an
 * endorsement of the design — only a snapshot of current behavior.
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import type { FileInfo } from '../jensen'

vi.mock('../qa-monitor', () => ({
  shouldLogQa: vi.fn(() => false)
}))

vi.mock('../../utils/path-validation', () => ({
  validateDevicePath: vi.fn((path: string) => path)
}))

vi.mock('../../utils/timeout', () => ({
  withTimeout: vi.fn((promise: Promise<any>) => promise),
  isAbortError: vi.fn(() => false)
}))

// Silence the service's own verbose console output for the entire file lifetime
// (matches the pattern in the sibling hidock-device.test.ts).
const SILENCED_CONSOLE_METHODS = ['log', 'info', 'warn', 'debug', 'error'] as const
const silencedConsoleSpies: Array<ReturnType<typeof vi.spyOn>> = []
beforeAll(() => {
  for (const method of SILENCED_CONSOLE_METHODS) {
    silencedConsoleSpies.push(vi.spyOn(console, method).mockImplementation(() => {}))
  }
})
afterAll(() => {
  silencedConsoleSpies.forEach((spy) => spy.mockRestore())
})

function makeFile(name: string, overrides: Partial<FileInfo> = {}): FileInfo {
  return {
    name,
    length: 100,
    duration: 10,
    time: new Date(),
    version: 1,
    signature: `sig-${name}`,
    ...overrides
  } as FileInfo
}

describe('HiDockDeviceService - listRecordings scan lifecycle gaps (C5 Phase 0)', () => {
  let HiDockDeviceService: any
  let mockJensen: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()

    mockJensen = {
      isConnected: vi.fn(() => true),
      getDeviceInfo: vi.fn(),
      getCardInfo: vi.fn(),
      getSettings: vi.fn(),
      setTime: vi.fn(),
      getFileCount: vi.fn(),
      listFiles: vi.fn(async () => []),
      getLockHolder: vi.fn(() => null),
      onconnect: null,
      ondisconnect: null
    }

    vi.doMock('../jensen', () => ({
      getJensenDevice: vi.fn(() => mockJensen),
      DeviceModel: {
        UNKNOWN: 'unknown',
        H1: 'H1',
        H1E: 'H1E',
        P1: 'P1'
      }
    }))

    const module = await import('../hidock-device')
    HiDockDeviceService = (module as any).HiDockDeviceService
  })

  // Mirrors makeConnectedService() from the sibling "listRecordings terminal
  // status (HIGH-2)" suite: a device that is connected, initialized, and
  // reporting `recordingCount` files, with an empty cache and no prior failures.
  function makeConnectedService(recordingCount: number) {
    const service = new HiDockDeviceService()
    const s = service as any
    s.state.connected = true
    s.state.recordingCount = recordingCount
    s.initializationComplete = true
    s.cachedRecordings = null
    s.cachedRecordingCount = -1
    s.listRecordingsFailureCount = 0
    s.listRecordingsLastFailure = 0
    return { service, s }
  }

  describe('count-based cache', () => {
    it('forceRefresh does NOT bypass a count-unchanged cache hit — it only bypasses the time debounce', async () => {
      const { service, s } = makeConnectedService(2)
      const cached = [
        { id: 'sig-a', filename: 'a.hda', size: 100, duration: 10, dateCreated: new Date(), version: 1, signature: 'sig-a' },
        { id: 'sig-b', filename: 'b.hda', size: 100, duration: 10, dateCreated: new Date(), version: 1, signature: 'sig-b' }
      ]
      s.cachedRecordings = cached
      s.cachedRecordingCount = 2 // matches state.recordingCount below

      const nonForced = await service.listRecordings()
      const forced = await service.listRecordings(undefined, true)

      expect(nonForced).toBe(cached)
      expect(forced).toBe(cached)
      expect(mockJensen.listFiles).not.toHaveBeenCalled()
    })

    it('re-scans when the device recordingCount differs from the cached count', async () => {
      const { service, s } = makeConnectedService(3) // device now reports 3 files
      s.cachedRecordings = [
        { id: 'sig-a', filename: 'a.hda', size: 100, duration: 10, dateCreated: new Date(), version: 1, signature: 'sig-a' }
      ]
      s.cachedRecordingCount = 1 // stale — device count moved from 1 to 3

      mockJensen.listFiles.mockResolvedValueOnce([makeFile('a.hda'), makeFile('b.hda'), makeFile('c.hda')])

      const result = await service.listRecordings()

      expect(mockJensen.listFiles).toHaveBeenCalledTimes(1)
      expect(result).toHaveLength(3)
    })
  })

  describe('failure backoff ladder', () => {
    it('blocks retry within the 10s window after fewer than 3 failures', async () => {
      const { service, s } = makeConnectedService(2)
      s.listRecordingsFailureCount = 1
      s.listRecordingsLastFailure = Date.now() // failed just now

      const result = await service.listRecordings()

      expect(mockJensen.listFiles).not.toHaveBeenCalled()
      expect(result).toEqual([]) // no cache to fall back to
    })

    it('allows a retry once the 10s window elapses for fewer than 3 failures', async () => {
      const { service, s } = makeConnectedService(2)
      s.listRecordingsFailureCount = 1
      s.listRecordingsLastFailure = Date.now() - 10_001

      mockJensen.listFiles.mockResolvedValueOnce([makeFile('a.hda'), makeFile('b.hda')])

      const result = await service.listRecordings()

      expect(mockJensen.listFiles).toHaveBeenCalledTimes(1)
      expect(result).toHaveLength(2)
    })

    it('extends the window to 60s once failureCount reaches 3 (still blocked at 15s elapsed)', async () => {
      const { service, s } = makeConnectedService(2)
      s.listRecordingsFailureCount = 3
      // 15s would clear the <3-failures 10s tier but must NOT clear the >=3 60s tier
      s.listRecordingsLastFailure = Date.now() - 15_000

      const result = await service.listRecordings()

      expect(mockJensen.listFiles).not.toHaveBeenCalled()
      expect(result).toEqual([])
    })

    it('stops auto-retry entirely once failureCount reaches 5, regardless of elapsed time', async () => {
      const { service, s } = makeConnectedService(2)
      s.listRecordingsFailureCount = 5
      s.listRecordingsLastFailure = Date.now() - 10 * 60 * 1000 // 10 minutes ago — long past any timed tier

      const result = await service.listRecordings()

      expect(mockJensen.listFiles).not.toHaveBeenCalled()
      expect(result).toEqual([])
    })

    it('forceRefresh bypasses the 5+ failure stop and re-scans immediately', async () => {
      const { service, s } = makeConnectedService(2)
      s.listRecordingsFailureCount = 5
      s.listRecordingsLastFailure = Date.now()

      mockJensen.listFiles.mockResolvedValueOnce([makeFile('a.hda'), makeFile('b.hda')])

      const result = await service.listRecordings(undefined, true)

      expect(mockJensen.listFiles).toHaveBeenCalledTimes(1)
      expect(result).toHaveLength(2)
    })
  })

  describe('counting-files status entry', () => {
    it('emits step "counting-files" before the terminal "ready" transition on a successful scan', async () => {
      const { service } = makeConnectedService(2)
      mockJensen.listFiles.mockResolvedValueOnce([makeFile('a.hda'), makeFile('b.hda')])

      const steps: string[] = []
      service.onStatusChange((status: { step: string }) => steps.push(status.step))

      await service.listRecordings()

      const countingIndex = steps.indexOf('counting-files')
      const readyIndex = steps.lastIndexOf('ready')
      expect(countingIndex).toBeGreaterThanOrEqual(0)
      expect(readyIndex).toBeGreaterThan(countingIndex)
    })
  })

  describe('re-entrancy', () => {
    it('a second concurrent (non-forceRefresh) call dedups onto the in-flight scan — single jensen.listFiles call', async () => {
      const { service } = makeConnectedService(2)
      let resolveScan!: (files: FileInfo[]) => void
      const pending = new Promise<FileInfo[]>((resolve) => {
        resolveScan = resolve
      })
      mockJensen.listFiles.mockImplementationOnce(() => pending)

      const call1 = service.listRecordings()
      const call2 = service.listRecordings() // concurrent, not forceRefresh

      resolveScan([makeFile('a.hda'), makeFile('b.hda')])

      const [result1, result2] = await Promise.all([call1, call2])

      expect(mockJensen.listFiles).toHaveBeenCalledTimes(1)
      expect(result1).toEqual(result2)
      expect(result1).toHaveLength(2)
    })

    it('forceRefresh while an op is in-flight WAITS for it, then evaluates and starts a fresh scan (FL-01/FL-08)', async () => {
      const { service, s } = makeConnectedService(2)
      let resolveFirst!: (files: FileInfo[]) => void
      const firstScan = new Promise<FileInfo[]>((resolve) => {
        resolveFirst = resolve
      })
      mockJensen.listFiles
        .mockImplementationOnce(() => firstScan)
        .mockResolvedValueOnce([makeFile('a.hda'), makeFile('b.hda'), makeFile('c.hda')])

      const call1 = service.listRecordings()
      // Simulate a new recording arriving on the device while the first scan is
      // in flight. Without this, the forceRefresh call would wait, then find the
      // count-based cache valid (per the "count-based cache" pin above) and
      // return cached data without a second jensen.listFiles call.
      s.state.recordingCount = 3
      const call2 = service.listRecordings(undefined, true)

      resolveFirst([makeFile('a.hda'), makeFile('b.hda')])

      const result1 = await call1
      const result2 = await call2

      expect(mockJensen.listFiles).toHaveBeenCalledTimes(2)
      expect(result1).toHaveLength(2)
      expect(result2).toHaveLength(3)
    })
  })
})
