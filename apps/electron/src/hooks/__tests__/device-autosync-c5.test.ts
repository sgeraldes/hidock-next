// CHARACTERIZATION (C5 Phase 0) — pins current behavior, not desired behavior; see device-pipeline-spec §1, §2
//
// Pins the auto-sync latch + ready-gating gaps that the sibling suites do not cover:
//   - useDeviceSubscriptions-latch.test.ts only exercises the pure `shouldLatchAutoSync`
//     helper (and asserts on source text for the release-on-failure invariant).
//   - useDownloadOrchestrator-*.test.ts cover the pure ordering/retry/scope helpers.
// None of them render `useDeviceSubscriptions` itself, so the HOOK-LEVEL behavior of the
// TWO independent auto-sync initiators — the device 'ready' status handler (2000ms debounce,
// "spec-007") and `checkInitialAutoSync` (waits for config+readiness independently) — both
// guarded by the SAME `autoSyncTriggeredRef` latch, is untested. This is exactly the
// dual-initiator surface BUG-R1/R3/R5 describe and that the DevicePipeline cutover (Phase 4)
// deletes. Pin it here before that refactor removes it.

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

// --- Mock the device service singleton (mirrors useDeviceConnection.test.ts / useDevicePipeline.test.ts patterns) ---
type StatusCb = (status: any) => void | Promise<void>
type StateCb = (state: any) => void

function makeDeviceServiceHarness() {
  let statusCb: StatusCb | null = null
  const stateCbs: StateCb[] = []
  const unsubStatus = vi.fn()
  const unsubState = vi.fn()
  const unsubActivity = vi.fn()

  const deviceState = { connected: true, recordingCount: 1, model: 'hidock-h1e' }
  let cachedRecordings: any[] = [
    { filename: 'a.mp3', size: 100, duration: 10, dateCreated: new Date('2026-07-01T00:00:00Z') }
  ]

  const service = {
    getState: vi.fn(() => deviceState),
    getConnectionStatus: vi.fn(() => ({ step: 'idle', message: '' })),
    onStateChange: vi.fn((cb: StateCb) => {
      stateCbs.push(cb)
      return unsubState
    }),
    onStatusChange: vi.fn((cb: StatusCb) => {
      statusCb = cb
      return unsubStatus
    }),
    onActivity: vi.fn(() => unsubActivity),
    isConnected: vi.fn(() => true),
    log: vi.fn(),
    getCachedRecordings: vi.fn(() => cachedRecordings),
    listRecordings: vi.fn(async () => cachedRecordings)
  }

  return {
    service,
    unsubStatus,
    unsubState,
    setCachedRecordings: (recs: any[]) => { cachedRecordings = recs },
    // Fires the 'ready' status handler registered by useDeviceSubscriptions and waits for
    // its synchronous portion (guard checks + debounce scheduling) to complete.
    emitReadyStatus: async () => {
      await statusCb?.({ step: 'ready', message: 'ready' })
    },
    emitDeviceStateChange: (state: any) => {
      stateCbs.forEach((cb) => cb(state))
    }
  }
}

function makeElectronAPI() {
  return {
    downloadService: {
      cancelActive: vi.fn().mockResolvedValue(0),
      getState: vi.fn().mockResolvedValue({ queue: [] }),
      getFilesToSync: vi.fn().mockImplementation(async (files: any[]) =>
        files.map((f) => ({ filename: f.filename, size: f.size, dateCreated: f.dateCreated, skipReason: undefined }))
      ),
      startSession: vi.fn().mockResolvedValue(undefined)
    }
  } as any
}

vi.mock('@/store/useAppStore', () => ({
  useAppStore: vi.fn()
}))

vi.mock('@/services/qa-monitor', () => ({ shouldLogQa: vi.fn(() => false) }))

const checkAutoSyncAllowedMock = vi.fn()
const waitForConfigMock = vi.fn()
const waitForDeviceReadyMock = vi.fn()
vi.mock('@/utils/autoSyncGuard', () => ({
  checkAutoSyncAllowed: (...args: any[]) => checkAutoSyncAllowedMock(...args),
  waitForConfig: (...args: any[]) => waitForConfigMock(...args),
  waitForDeviceReady: (...args: any[]) => waitForDeviceReadyMock(...args)
}))

const requestScopedDownloadsMock = vi.fn()
const drainDownloadQueueMock = vi.fn()
vi.mock('@/hooks/useDownloadOrchestrator', () => ({
  requestScopedDownloads: (...args: any[]) => requestScopedDownloadsMock(...args),
  drainDownloadQueue: (...args: any[]) => drainDownloadQueueMock(...args)
}))

let deviceHarness: ReturnType<typeof makeDeviceServiceHarness>
vi.mock('@/services/hidock-device', () => ({
  getHiDockDeviceService: () => deviceHarness.service
}))

import { useAppStore } from '@/store/useAppStore'
import { useDeviceSubscriptions } from '../useDeviceSubscriptions'

describe('useDeviceSubscriptions — dual auto-sync initiator latch (C5 Phase 0 characterization)', () => {
  let storeState: Record<string, any>

  beforeEach(() => {
    vi.clearAllMocks()
    deviceHarness = makeDeviceServiceHarness()
    ;(window as any).electronAPI = makeElectronAPI()

    storeState = {
      setDeviceState: vi.fn(),
      setConnectionStatus: vi.fn(),
      addActivityLogEntry: vi.fn(),
      setDeviceSyncState: vi.fn(),
      setDeviceRecording: vi.fn(),
      setActiveRecordingFilename: vi.fn()
    }
    // @ts-expect-error mocked module
    useAppStore.mockImplementation((selector: any) => selector(storeState))

    // Default: allowed so the 'ready'-status debounce path has work to do.
    checkAutoSyncAllowedMock.mockReturnValue({ allowed: true, reason: 'ok' })
    // Default: checkInitialAutoSync does NOT race the ready-status path unless a test
    // opts in — keeps LATCH DEDUP / DEBOUNCE pins isolated to the ready-status initiator.
    waitForConfigMock.mockResolvedValue(false)
    waitForDeviceReadyMock.mockResolvedValue(false)
  })

  afterEach(() => {
    vi.useRealTimers()
    delete (window as any).electronAPI
  })

  it('1. LATCH DEDUP (BUG-R3/R5): a second "ready" while latched does not trigger a second sync', async () => {
    vi.useFakeTimers()
    renderHook(() => useDeviceSubscriptions())

    // First 'ready' — schedules the 2s debounce.
    await act(async () => {
      await deviceHarness.emitReadyStatus()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })

    expect(window.electronAPI!.downloadService!.startSession).toHaveBeenCalledTimes(1)

    // Second 'ready' for the SAME connection — latch is already set by the first attempt,
    // so this must be a no-op: no new debounce timer, no second sync.
    await act(async () => {
      await deviceHarness.emitReadyStatus()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })

    expect(window.electronAPI!.downloadService!.startSession).toHaveBeenCalledTimes(1)
  })

  it('2. 2-SECOND DEBOUNCE (spec-007): rapid repeated "ready" events collapse to one attempt', async () => {
    vi.useFakeTimers()
    renderHook(() => useDeviceSubscriptions())

    // t=0: first ready fires, schedules timer for t=2000.
    await act(async () => {
      await deviceHarness.emitReadyStatus()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(window.electronAPI!.downloadService!.startSession).not.toHaveBeenCalled()

    // t=1000: a second ready arrives within the debounce window — clears + reschedules
    // for t=1000+2000=3000 (i.e. 2000ms from THIS event, not the first).
    await act(async () => {
      await deviceHarness.emitReadyStatus()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1999)
    })
    // t=2999: still short of the reset 2000ms window — must not have fired yet.
    expect(window.electronAPI!.downloadService!.startSession).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    // t=3000: exactly 2000ms after the SECOND ready — collapsed into a single attempt.
    expect(window.electronAPI!.downloadService!.startSession).toHaveBeenCalledTimes(1)
  })

  it('3. DUAL INITIATOR (BUG-R3, KNOWN-ODD — Phase 4 deletes both): checkInitialAutoSync and ' +
     'the ready-status handler share one latch, so only one of the two ever completes a sync ' +
     'for a given connection', async () => {
    // Let checkInitialAutoSync's own guards pass so it races the ready-status handler.
    waitForConfigMock.mockResolvedValue(true)
    waitForDeviceReadyMock.mockResolvedValue(true)

    renderHook(() => useDeviceSubscriptions())

    // checkInitialAutoSync runs on mount (no debounce) — let it claim the latch and
    // complete its sync attempt first.
    await waitFor(() => {
      expect(window.electronAPI!.downloadService!.startSession).toHaveBeenCalledTimes(1)
    })

    // Now the device also emits 'ready' via the status-change path for the SAME
    // connection. KNOWN-ODD: because both initiators guard on the identical
    // `autoSyncTriggeredRef`, this fires the guard's synchronous early return
    // (`if (autoSyncTriggeredRef.current) return`) BEFORE even scheduling the 2s debounce
    // timer — so no second attempt is possible, with or without fake timers.
    await act(async () => {
      await deviceHarness.emitReadyStatus()
    })

    // Sync was attempted exactly once total, even though both initiators were "live" for
    // this connection — pins the shared-latch invariant the spec calls out for removal.
    expect(window.electronAPI!.downloadService!.startSession).toHaveBeenCalledTimes(1)
    expect(deviceHarness.service.onStatusChange).toHaveBeenCalledTimes(1)
  })
})
