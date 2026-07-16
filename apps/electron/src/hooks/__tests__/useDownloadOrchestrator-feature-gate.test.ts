/**
 * Round-4 [HIGH]: download orchestrator × device-sync feature gate.
 *
 * After a live disable of device-sync (pending-disable: desired-off, boot-active)
 * the orchestrator must stop BEFORE each new dequeue, leaving every remaining
 * item PENDING — never converting untouched work into persisted failures via
 * mark-failed — and every scheduled initiation path (auto-start on state update,
 * reconnect retry, drain) must abort. A FeatureDisabledError-shaped rejection is
 * a gate transition (stop the loop), never a download failure.
 *
 * Drives the REAL hook (renderHook) with a mocked device service + electronAPI.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

// ---- controllable mock state -----------------------------------------------

type MainItem = {
  id: string
  filename: string
  fileSize: number
  status: 'pending' | 'downloading' | 'completed' | 'failed' | 'cancelled'
  recordingDate?: string
}

const harness = vi.hoisted(() => {
  const appState: Record<string, unknown> = {}
  return {
    appState,
    useAppStoreMock: Object.assign((selector: (s: unknown) => unknown) => selector(appState), {
      getState: () => appState,
    }),
    deviceService: {
      isConnected: vi.fn(() => true),
      log: vi.fn(),
      downloadRecording: vi.fn(
        async (_filename: string, _size?: unknown, _onChunk?: unknown, _signal?: unknown) => true
      ),
      cancelAllDownloads: vi.fn(),
      onStatusChange: vi.fn(),
    },
    toast: vi.fn(),
  }
})

vi.mock('@/services/hidock-device', () => ({
  getHiDockDeviceService: () => harness.deviceService,
}))
vi.mock('@/store/useAppStore', () => ({ useAppStore: harness.useAppStoreMock }))
vi.mock('@/components/ui/toaster', () => ({ toast: harness.toast }))
vi.mock('@/features/library/utils/errorHandling', () => ({
  parseError: (e: unknown) => ({ type: 'unknown', message: e instanceof Error ? e.message : String(e) }),
  getErrorMessage: () => 'error',
}))
vi.mock('@/services/qa-monitor', () => ({ shouldLogQa: () => false }))

import {
  useDownloadOrchestrator,
  drainDownloadQueue,
  isDeviceSyncInitiationBlocked,
  isFeatureDisabledRejection,
  markDownloadCancelled,
  cancelDownloads,
  cancelDownloadsComplete,
  clearAllDownloadBookkeeping,
} from '../useDownloadOrchestrator'
import { useFeatureStore } from '@/store/useFeatureStore'

/** A FeatureDisabledError-shaped rejection, exactly as Electron surfaces it. */
const FEATURE_DISABLED_ERROR = () =>
  new Error(
    "Error invoking remote method 'jensen:downloadFile': FeatureDisabledError: " +
      'Feature "Device Sync" is disabled (channel jensen:downloadFile).'
  )

// ---- electronAPI harness ----------------------------------------------------

let mainQueue: MainItem[]
let stateUpdateCb: ((state: { queue: MainItem[] }) => void) | null
let statusCb: ((status: { step: string }) => void) | null

const downloadService = {
  getState: vi.fn(async () => ({ queue: mainQueue.map((i) => ({ ...i })) })),
  markFailed: vi.fn(async () => {}),
  processDownload: vi.fn(async (filename: string) => {
    const item = mainQueue.find((i) => i.filename === filename)
    if (item) item.status = 'completed'
    return { success: true }
  }),
  updateProgress: vi.fn(),
  retryFailed: vi.fn(),
  cancelAll: vi.fn(),
  notifyCompletion: vi.fn(),
  onStateUpdate: vi.fn((cb: (state: { queue: MainItem[] }) => void) => {
    stateUpdateCb = cb
    return () => {}
  }),
}

function setDeviceSyncDesired(enabled: boolean): void {
  if (enabled) {
    useFeatureStore.getState().setFromConfig(undefined) // full — everything on
    useFeatureStore.getState().setPendingRestart([])
  } else {
    useFeatureStore
      .getState()
      .setFromConfig({ preset: 'full', flags: { 'device-sync': false } })
    useFeatureStore.getState().setPendingRestart(['device-sync'])
  }
}

const ITEM_A: MainItem = {
  id: 'a',
  filename: 'A.hda',
  fileSize: 100,
  status: 'pending',
  recordingDate: '2026-07-14T10:00:00Z',
}
const ITEM_B: MainItem = {
  id: 'b',
  filename: 'B.hda',
  fileSize: 100,
  status: 'pending',
  recordingDate: '2026-07-13T10:00:00Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  // Reset module-level cancellation state so a marker set in one test never
  // leaks into the next (mount resets _cancelInProgress; this clears the sets).
  clearAllDownloadBookkeeping()
  cancelDownloadsComplete()
  mainQueue = [{ ...ITEM_A }, { ...ITEM_B }]
  stateUpdateCb = null
  statusCb = null
  setDeviceSyncDesired(true)

  Object.assign(harness.appState, {
    connectionStatus: { step: 'ready' },
    deviceSyncing: true,
    downloadQueue: new Map(),
    setDeviceSyncState: vi.fn(),
    clearDeviceSyncState: vi.fn(),
    addToDownloadQueue: vi.fn(),
    updateDownloadProgress: vi.fn(),
    removeFromDownloadQueue: vi.fn(),
    clearDownloadQueue: vi.fn(),
    cancelDeviceSync: vi.fn(),
    // PR#77: onStateUpdate mirrors the main-process queue into the enriched store
    // via syncDownloadQueue BEFORE the (gated) auto-start check. The mirror is a
    // pure store mutation with no device I/O; the mock records that it ran.
    syncDownloadQueue: vi.fn(),
  })

  harness.deviceService.isConnected.mockReturnValue(true)
  harness.deviceService.downloadRecording.mockImplementation(async () => true)
  harness.deviceService.onStatusChange.mockImplementation((cb: (s: { step: string }) => void) => {
    statusCb = cb
    return () => {}
  })

  ;(window as unknown as { electronAPI: unknown }).electronAPI = {
    downloadService,
    config: {
      get: vi.fn(async () => ({ success: true, data: { device: { autoDownload: true } } })),
    },
  }
})

const clearSync = () => harness.appState.clearDeviceSyncState as ReturnType<typeof vi.fn>

async function drainAndSettle(): Promise<void> {
  drainDownloadQueue()
  await waitFor(() => expect(clearSync()).toHaveBeenCalled())
}

// ---- tests -------------------------------------------------------------------

describe('pure predicates', () => {
  it('isDeviceSyncInitiationBlocked reflects the desired feature state', () => {
    setDeviceSyncDesired(true)
    expect(isDeviceSyncInitiationBlocked()).toBe(false)
    setDeviceSyncDesired(false)
    expect(isDeviceSyncInitiationBlocked()).toBe(true)
  })

  it('isFeatureDisabledRejection matches gate rejections and nothing else', () => {
    expect(
      isFeatureDisabledRejection(
        new Error(
          "Error invoking remote method 'jensen:downloadFile': FeatureDisabledError: " +
            'Feature "Device Sync" is disabled (channel jensen:downloadFile).'
        )
      )
    ).toBe(true)
    const named = new Error('Feature "Device Sync" is disabled (channel jensen:downloadFile).')
    named.name = 'FeatureDisabledError'
    expect(isFeatureDisabledRejection(named)).toBe(true)
    expect(isFeatureDisabledRejection(new Error('USB transfer failed'))).toBe(false)
    expect(isFeatureDisabledRejection('flaky string error')).toBe(false)
  })
})

describe('live-disable mid-queue (round-4 [HIGH])', () => {
  it('in-flight finishes, remaining items stay PENDING, zero mark-failed, loop stops; resume works after re-enable+restart', async () => {
    // Live-disable lands while item A (newest → dequeued first) is in flight.
    harness.deviceService.downloadRecording.mockImplementation(async (filename: string) => {
      if (filename === 'A.hda') setDeviceSyncDesired(false)
      return true
    })

    renderHook(() => useDownloadOrchestrator())
    await drainAndSettle()

    // In-flight item A finished…
    expect(harness.deviceService.downloadRecording).toHaveBeenCalledTimes(1)
    expect(harness.deviceService.downloadRecording).toHaveBeenCalledWith(
      'A.hda',
      expect.anything(),
      expect.anything(),
      expect.anything()
    )
    expect(mainQueue.find((i) => i.filename === 'A.hda')?.status).toBe('completed')
    // …item B was NEVER dequeued and stays pending, untouched.
    expect(mainQueue.find((i) => i.filename === 'B.hda')?.status).toBe('pending')
    // ZERO mark-failed calls — pending work is never converted into failures.
    expect(downloadService.markFailed).not.toHaveBeenCalled()
    // The loop stopped and reported honestly.
    expect(harness.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Device Sync turned off' })
    )

    // Re-enable + restart simulation (desired on again, pending cleared) →
    // the next drain resumes cleanly with item B.
    setDeviceSyncDesired(true)
    clearSync().mockClear()
    await drainAndSettle()
    expect(harness.deviceService.downloadRecording).toHaveBeenCalledTimes(2)
    expect(harness.deviceService.downloadRecording).toHaveBeenLastCalledWith(
      'B.hda',
      expect.anything(),
      expect.anything(),
      expect.anything()
    )
    expect(mainQueue.find((i) => i.filename === 'B.hda')?.status).toBe('completed')
    expect(downloadService.markFailed).not.toHaveBeenCalled()
  })

  it('a FeatureDisabledError-shaped rejection is a gate transition: loop stops, no mark-failed', async () => {
    // The store still says enabled (race: disable landed in main between the
    // loop check and the USB call) — the rejection itself must stop the loop.
    harness.deviceService.downloadRecording.mockRejectedValue(FEATURE_DISABLED_ERROR())

    renderHook(() => useDownloadOrchestrator())
    await drainAndSettle()

    expect(harness.deviceService.downloadRecording).toHaveBeenCalledTimes(1) // A only — loop stopped
    expect(downloadService.markFailed).not.toHaveBeenCalled()
    expect(mainQueue.find((i) => i.filename === 'B.hda')?.status).toBe('pending')
  })
})

describe('catch-block guard ordering — cancellation PRECEDES the gate (round-5 [MEDIUM])', () => {
  // Single-item queue so each assertion keys on ONE processDownload catch.
  beforeEach(() => {
    mainQueue = [{ ...ITEM_A }]
  })

  const loggedCancelled = () =>
    harness.deviceService.log.mock.calls.some((c: unknown[]) => c[1] === 'Download cancelled')
  const loggedGated = () =>
    harness.deviceService.log.mock.calls.some((c: unknown[]) => c[1] === 'Download paused')

  it('(a) Cancel-All (signal.aborted) CONCURRENT with a FeatureDisabledError → CANCELLED, never gated, no markFailed', async () => {
    // device-sync stays desired-ENABLED (the disable is a race in main). The mock
    // models the race precisely: mid-transfer the user hits Cancel-All (aborts the
    // shared renderer signal) AND the next USB touch throws FeatureDisabledError.
    // Both catch guards are true; cancellation must win.
    harness.deviceService.downloadRecording.mockImplementation(async () => {
      cancelDownloads() // aborts downloadAbortControllerRef.current.signal
      throw FEATURE_DISABLED_ERROR()
    })

    renderHook(() => useDownloadOrchestrator())
    await drainAndSettle()

    expect(loggedCancelled(), 'must log "Download cancelled"').toBe(true)
    expect(loggedGated(), 'must NOT take the gated branch').toBe(false)
    expect(downloadService.markFailed, 'must NOT mark failed').not.toHaveBeenCalled()
  })

  it('(b) per-file cancel (_cancelledDownloads) CONCURRENT with a FeatureDisabledError → CANCELLED, never gated, no markFailed', async () => {
    harness.deviceService.downloadRecording.mockRejectedValue(FEATURE_DISABLED_ERROR())

    renderHook(() => useDownloadOrchestrator())
    // Mark AFTER mount: the orchestrator clears _cancelledDownloads on mount
    // (stale-flag reset), so the per-file cancel must land after that. It aborts
    // only the MAIN-process transfer; the renderer signal stays unaborted, so the
    // marker (not signal.aborted) is what proves the cancel.
    markDownloadCancelled('A.hda')
    await drainAndSettle()

    expect(loggedCancelled()).toBe(true)
    expect(loggedGated()).toBe(false)
    expect(downloadService.markFailed).not.toHaveBeenCalled()
  })

  it('pure gate transition (FeatureDisabledError, NO cancel) → GATED (pending), never cancelled, no markFailed', async () => {
    harness.deviceService.downloadRecording.mockRejectedValue(FEATURE_DISABLED_ERROR())

    renderHook(() => useDownloadOrchestrator())
    await drainAndSettle()

    expect(loggedGated(), 'must take the gated branch').toBe(true)
    expect(loggedCancelled(), 'must NOT report cancelled').toBe(false)
    expect(downloadService.markFailed).not.toHaveBeenCalled()
    // Item stays pending (untouched) for resume after restart + re-enable.
    expect(mainQueue.find((i) => i.filename === 'A.hda')?.status).toBe('pending')
  })

  it('a REAL USB failure (no cancel, no gate) still falls through to markFailed', async () => {
    harness.deviceService.downloadRecording.mockRejectedValue(new Error('USB transfer failed'))

    renderHook(() => useDownloadOrchestrator())
    await drainAndSettle()

    expect(downloadService.markFailed).toHaveBeenCalledWith(
      'A.hda',
      expect.stringContaining('USB transfer failed')
    )
    expect(loggedCancelled()).toBe(false)
    expect(loggedGated()).toBe(false)
  })
})

describe('scheduled initiation paths abort while disabled (round-4)', () => {
  it('auto-start on state update does NOT begin a session (PR#77 onStateUpdate → syncDownloadQueue → gated auto-start)', async () => {
    renderHook(() => useDownloadOrchestrator())
    setDeviceSyncDesired(false)

    expect(stateUpdateCb).toBeTruthy()
    // Drive PR#77's real state-update mechanism: a state-update with pending items.
    stateUpdateCb!({ queue: mainQueue.map((i) => ({ ...i })) })
    await new Promise((r) => setTimeout(r, 0))

    // PR#77's queue mirror STILL runs (it is a pure store mutation, no device I/O)…
    const syncMirror = harness.appState.syncDownloadQueue as ReturnType<typeof vi.fn>
    expect(syncMirror).toHaveBeenCalledTimes(1)
    // …but the gated auto-start path did NOT begin a session while disabled.
    expect(downloadService.getState).not.toHaveBeenCalled() // session never started
    expect(harness.deviceService.downloadRecording).not.toHaveBeenCalled()
  })

  it('auto-start on state update DOES begin a session when device-sync is enabled (proves the mechanism is exercised)', async () => {
    renderHook(() => useDownloadOrchestrator())
    setDeviceSyncDesired(true) // enabled

    expect(stateUpdateCb).toBeTruthy()
    stateUpdateCb!({ queue: mainQueue.map((i) => ({ ...i })) })
    await waitFor(() => expect(downloadService.getState).toHaveBeenCalled())
    // The same state-update that no-ops while disabled DOES start a session here —
    // confirming the disabled test above exercises the real (gated) path, not a
    // dead one.
    expect(harness.appState.syncDownloadQueue).toHaveBeenCalled()
  })

  it('reconnect retry does NOT re-initiate while disabled', async () => {
    renderHook(() => useDownloadOrchestrator())
    setDeviceSyncDesired(false)
    mainQueue.push({ id: 'c', filename: 'C.hda', fileSize: 1, status: 'failed' })

    expect(statusCb).toBeTruthy()
    statusCb!({ step: 'ready' })
    await new Promise((r) => setTimeout(r, 0))

    expect(downloadService.retryFailed).not.toHaveBeenCalled()
    expect(downloadService.getState).not.toHaveBeenCalled()
  })

  it('drainDownloadQueue is a no-op while disabled', async () => {
    renderHook(() => useDownloadOrchestrator())
    setDeviceSyncDesired(false)

    drainDownloadQueue()
    await new Promise((r) => setTimeout(r, 0))

    expect(downloadService.getState).not.toHaveBeenCalled()
    expect(harness.deviceService.downloadRecording).not.toHaveBeenCalled()
  })
})
