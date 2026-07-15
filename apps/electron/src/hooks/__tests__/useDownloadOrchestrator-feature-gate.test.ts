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
} from '../useDownloadOrchestrator'
import { useFeatureStore } from '@/store/useFeatureStore'

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
    harness.deviceService.downloadRecording.mockRejectedValue(
      new Error(
        "Error invoking remote method 'jensen:downloadFile': FeatureDisabledError: " +
          'Feature "Device Sync" is disabled (channel jensen:downloadFile).'
      )
    )

    renderHook(() => useDownloadOrchestrator())
    await drainAndSettle()

    expect(harness.deviceService.downloadRecording).toHaveBeenCalledTimes(1) // A only — loop stopped
    expect(downloadService.markFailed).not.toHaveBeenCalled()
    expect(mainQueue.find((i) => i.filename === 'B.hda')?.status).toBe('pending')
  })
})

describe('scheduled initiation paths abort while disabled (round-4)', () => {
  it('auto-start on state update does NOT begin a session', async () => {
    renderHook(() => useDownloadOrchestrator())
    setDeviceSyncDesired(false)

    expect(stateUpdateCb).toBeTruthy()
    stateUpdateCb!({ queue: mainQueue.map((i) => ({ ...i })) })
    await new Promise((r) => setTimeout(r, 0))

    expect(downloadService.getState).not.toHaveBeenCalled() // session never started
    expect(harness.deviceService.downloadRecording).not.toHaveBeenCalled()
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
