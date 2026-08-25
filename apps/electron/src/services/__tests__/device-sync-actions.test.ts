/**
 * device-sync-actions — recording-aware re-sync (2026-07-22).
 *
 * Covers the owner-spec model:
 * - a seen recording session marks the list dirty ONCE, and the stop reconcile
 *   rescans even when the device file COUNT is unchanged (delete-one-while-
 *   recording-one leaves the count net-same but the list different);
 * - recording start syncs backlog files mid-record only when the count moved
 *   (no scan spam on every session);
 * - the in-progress recording is never queued for download;
 * - manual trigger reconciles + downloads even with auto-download off, and
 *   skips the USB rescan when the cache is provably current;
 * - periodic probes are debounced and adopt a baseline instead of
 *   double-scanning after the connect path;
 * - a stop that lands while another scan is in flight re-arms instead of
 *   being lost.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const deviceService = {
  isConnected: vi.fn(() => true),
  getRecordingCount: vi.fn<() => Promise<number>>(),
  getCachedRecordings: vi.fn(() => [] as Array<Record<string, unknown>>),
  invalidateRecordingsCache: vi.fn(),
  listRecordings: vi.fn(),
  log: vi.fn(),
  getState: vi.fn(() => ({ recordingCount: 0 })),
}

vi.mock('@/services/hidock-device', () => ({ getHiDockDeviceService: () => deviceService }))

const appState: { activeRecordingFilename: string | null } = { activeRecordingFilename: null }
const setDeviceSyncState = vi.fn()
vi.mock('@/store/useAppStore', () => ({
  useAppStore: Object.assign(vi.fn(), {
    getState: () => ({ activeRecordingFilename: appState.activeRecordingFilename, setDeviceSyncState }),
  }),
}))

const autoSync = { allowed: true }
vi.mock('@/utils/autoSyncGuard', () => ({ checkAutoSyncAllowed: () => autoSync }))

const requestScopedDownloads = vi.fn()
const drainDownloadQueue = vi.fn()
vi.mock('@/hooks/useDownloadOrchestrator', () => ({
  requestScopedDownloads: (...args: unknown[]) => requestScopedDownloads(...args),
  drainDownloadQueue: () => drainDownloadQueue(),
}))

import {
  scanAndReconcile,
  handleRecordingStart,
  handleRecordingStop,
  periodicCountCheck,
  isListDirty,
  __resetDeviceSyncState,
} from '../device-sync-actions'

const getFilesToSync = vi.fn()
const startSession = vi.fn().mockResolvedValue(undefined)

function rec(filename: string) {
  return { filename, size: 1000, duration: 60, dateCreated: new Date('2026-07-22T10:00:00Z') }
}

beforeEach(() => {
  vi.useFakeTimers()
  __resetDeviceSyncState()
  vi.clearAllMocks()
  autoSync.allowed = true
  appState.activeRecordingFilename = null
  deviceService.isConnected.mockReturnValue(true)
  ;(window as unknown as { electronAPI: unknown }).electronAPI = {
    downloadService: { getFilesToSync, startSession },
  }
  vi.spyOn(window, 'dispatchEvent')
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** Establish the post-connect baseline without running a scan. */
async function establishBaseline(count: number) {
  deviceService.getRecordingCount.mockResolvedValue(count)
  deviceService.getCachedRecordings.mockReturnValue(Array.from({ length: count }, (_, i) => rec(`f${i}.hda`)))
  await scanAndReconcile('periodic')
}

describe('scanAndReconcile — baseline + debounce', () => {
  it('adopts the probed count as baseline without scanning (connect path owns initial sync)', async () => {
    deviceService.getRecordingCount.mockResolvedValue(5)
    deviceService.getCachedRecordings.mockReturnValue(Array.from({ length: 5 }, (_, i) => rec(`f${i}.hda`)))
    const outcome = await scanAndReconcile('periodic')
    expect(outcome).toBeNull()
    expect(deviceService.listRecordings).not.toHaveBeenCalled()
  })

  it('debounces periodic probes (one scan window per 90s)', async () => {
    await establishBaseline(5)
    await vi.advanceTimersByTimeAsync(91_000) // exit the baseline's debounce window
    const first = await scanAndReconcile('periodic')
    expect(first?.skippedScan).toBe(true) // count unchanged, cache current
    deviceService.getRecordingCount.mockClear()
    const second = await scanAndReconcile('periodic')
    expect(second).toBeNull() // debounced before even probing
    expect(deviceService.getRecordingCount).not.toHaveBeenCalled()
  })

  it('returns null when the device is disconnected', async () => {
    deviceService.isConnected.mockReturnValue(false)
    expect(await scanAndReconcile('manual')).toBeNull()
    expect(deviceService.listRecordings).not.toHaveBeenCalled()
  })
})

describe('recording session — dirty flag (owner spec)', () => {
  it('stop reconcile RESCANS even when the count is unchanged (delete-one-record-one)', async () => {
    // Device holds A,B,C (count 3). While recording D, the user deletes A on the
    // device. After stopping, count is STILL 3 (A,B,C,D minus A) — the count-based
    // cache would hide D forever. The dirty mark must force the rescan.
    await establishBaseline(3)

    deviceService.getRecordingCount.mockResolvedValue(3) // count net-same after the session
    deviceService.listRecordings.mockResolvedValue([rec('b.hda'), rec('c.hda'), rec('d-new.hda')])
    getFilesToSync.mockResolvedValue([])
    await handleRecordingStart()
    expect(isListDirty()).toBe(true)
    expect(deviceService.listRecordings).not.toHaveBeenCalled() // no scan spam at start

    handleRecordingStop(0)
    await vi.advanceTimersByTimeAsync(1)

    expect(deviceService.invalidateRecordingsCache).toHaveBeenCalled() // count-based cache forced off
    expect(deviceService.listRecordings).toHaveBeenCalledTimes(1)
  })

  it('queues the new file for download after the stop reconcile (auto-download on)', async () => {
    await establishBaseline(3)
    const afterList = [rec('a.hda'), rec('b.hda'), rec('d-new.hda')]
    deviceService.listRecordings.mockResolvedValue(afterList)
    getFilesToSync.mockResolvedValue([
      { filename: 'a.hda', skipReason: 'exists' },
      { filename: 'b.hda', skipReason: 'exists' },
      { filename: 'd-new.hda', size: 1000, dateCreated: new Date() },
    ])

    await handleRecordingStart()
    handleRecordingStop(0)
    await vi.advanceTimersByTimeAsync(1)

    expect(startSession).toHaveBeenCalledTimes(1)
    expect(startSession.mock.calls[0][0].map((f: { filename: string }) => f.filename)).toEqual(['d-new.hda'])
    expect(requestScopedDownloads).toHaveBeenCalledWith(['d-new.hda'])
    expect(drainDownloadQueue).toHaveBeenCalledTimes(1)
    expect(isListDirty()).toBe(false)
    expect(window.dispatchEvent).toHaveBeenCalled() // unified view refresh
  })

  it('marks dirty ONCE per session — a repeated start broadcast does not rescan when count is stable', async () => {
    await establishBaseline(3)
    await handleRecordingStart()
    await handleRecordingStart() // defensive: same session re-notified
    expect(deviceService.listRecordings).not.toHaveBeenCalled()
    expect(isListDirty()).toBe(true)
  })

  it('stop without a seen start is a no-op', async () => {
    await establishBaseline(3)
    handleRecordingStop(0)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(deviceService.listRecordings).not.toHaveBeenCalled()
  })

  it('re-arms when another scan is in flight at stop time (reconcile is never lost)', async () => {
    await establishBaseline(3)
    deviceService.getRecordingCount.mockResolvedValue(4) // count moved: one new file
    const scanned = [rec('a.hda'), rec('b.hda'), rec('c.hda'), rec('d-new.hda')]
    deviceService.listRecordings.mockResolvedValue(scanned)
    deviceService.getCachedRecordings.mockReturnValue(scanned)
    getFilesToSync.mockResolvedValue(scanned.map((r) => ({ ...r, skipReason: 'exists' })))

    // Occupy the scanner with a long-running manual scan.
    let releaseScan!: (v: unknown) => void
    deviceService.listRecordings.mockImplementationOnce(
      () => new Promise((resolve) => { releaseScan = resolve })
    )
    const manual = scanAndReconcile('manual')
    await vi.advanceTimersByTimeAsync(0)

    await handleRecordingStart()
    handleRecordingStop(0)
    await vi.advanceTimersByTimeAsync(1) // first stop timer fires while in-flight → re-arms

    releaseScan(scanned)
    await manual
    await vi.advanceTimersByTimeAsync(15_000) // re-armed timer fires

    // The in-flight manual scan already reconciled — the re-armed stop finds a
    // current cache and does NOT pay for a second USB scan.
    expect(deviceService.listRecordings).toHaveBeenCalledTimes(1)
    expect(isListDirty()).toBe(false)
  })
  it('keeps the dirty mark when a reconcile runs MID-session (the stop must still reconcile)', async () => {
    await establishBaseline(3)
    appState.activeRecordingFilename = 'live-now.hda'
    deviceService.getRecordingCount.mockResolvedValue(3)
    const cached = [rec('a.hda'), rec('b.hda'), rec('c.hda')]
    deviceService.getCachedRecordings.mockReturnValue(cached)
    getFilesToSync.mockResolvedValue([])

    await handleRecordingStart() // marks dirty for the live session
    const manual = await scanAndReconcile('manual') // user hits Refresh mid-record

    expect(deviceService.listRecordings).not.toHaveBeenCalled() // active session: nothing new finalized — cached reconcile
    expect(manual?.skippedScan).toBe(true)
    expect(isListDirty()).toBe(true) // NOT cleared — the in-progress file isn't reconciled yet

    // The session ends → the stop reconcile still fires and scans.
    appState.activeRecordingFilename = null
    deviceService.getRecordingCount.mockResolvedValue(4)
    const afterList = [...cached, rec('live-now.hda')]
    deviceService.listRecordings.mockResolvedValue(afterList)
    handleRecordingStop(0)
    await vi.advanceTimersByTimeAsync(1)

    expect(deviceService.listRecordings).toHaveBeenCalledTimes(1) // the ONE stop rescan
    expect(isListDirty()).toBe(false) // session reconciled, nothing recording
  })
})

describe('recording start — mid-record backlog sync (HiNotes parity)', () => {
  it('syncs backlog at recording START when the count moved, excluding the in-progress file', async () => {
    await establishBaseline(3)
    appState.activeRecordingFilename = 'live-now.hda'
    deviceService.getRecordingCount.mockResolvedValue(5) // two files appeared while disconnected
    const list = [rec('a.hda'), rec('b.hda'), rec('c.hda'), rec('backlog.hda'), rec('live-now.hda')]
    deviceService.listRecordings.mockResolvedValue(list)
    getFilesToSync.mockResolvedValue([
      { filename: 'backlog.hda', size: 1000, dateCreated: new Date() },
      { filename: 'live-now.hda', size: 100, dateCreated: new Date() },
    ])

    await handleRecordingStart()
    await vi.advanceTimersByTimeAsync(0)

    expect(deviceService.listRecordings).toHaveBeenCalledTimes(1)
    const queued = startSession.mock.calls[0]?.[0].map((f: { filename: string }) => f.filename) ?? []
    expect(queued).toEqual(['backlog.hda']) // the live recording is NEVER queued
  })
})

describe('manual trigger — force sync check', () => {
  it('reconciles + downloads with auto-download OFF, without rescanning a current cache', async () => {
    await establishBaseline(3)
    autoSync.allowed = false
    const cached = [rec('a.hda'), rec('b.hda'), rec('c.hda')]
    deviceService.getCachedRecordings.mockReturnValue(cached)
    deviceService.getRecordingCount.mockResolvedValue(3) // cache provably current
    getFilesToSync.mockResolvedValue([{ filename: 'c.hda', size: 1000, dateCreated: new Date() }])

    const outcome = await scanAndReconcile('manual')

    expect(deviceService.listRecordings).not.toHaveBeenCalled() // no 90s USB rescan needed
    expect(startSession).toHaveBeenCalledTimes(1) // manual bypasses the auto-download toggle
    expect(outcome?.downloaded).toBe(1)
  })

  it('scans when the cache is stale, even with auto-download off (view refresh only, no download)', async () => {
    await establishBaseline(3)
    autoSync.allowed = false
    deviceService.getRecordingCount.mockResolvedValue(4)
    const list = [rec('a.hda'), rec('b.hda'), rec('c.hda'), rec('d.hda')]
    deviceService.listRecordings.mockResolvedValue(list)
    getFilesToSync.mockResolvedValue([{ filename: 'd.hda', size: 1000, dateCreated: new Date() }])

    const outcome = await scanAndReconcile('recording-stopped')

    expect(deviceService.listRecordings).toHaveBeenCalledTimes(1)
    expect(startSession).not.toHaveBeenCalled()
    expect(outcome?.newFiles).toBe(1)
    expect(outcome?.downloaded).toBe(0)
    expect(window.dispatchEvent).toHaveBeenCalled() // row appears as device-only
  })
})

describe('periodic safety net', () => {
  it('picks up files that appeared without a seen recording session', async () => {
    await establishBaseline(3)
    deviceService.getRecordingCount.mockResolvedValue(4) // recorded while disconnected
    const list = [rec('a.hda'), rec('b.hda'), rec('c.hda'), rec('offline.hda')]
    deviceService.listRecordings.mockResolvedValue(list)
    getFilesToSync.mockResolvedValue([{ filename: 'offline.hda', size: 1000, dateCreated: new Date() }])

    await vi.advanceTimersByTimeAsync(91_000) // exit the debounce window
    periodicCountCheck()
    await vi.advanceTimersByTimeAsync(0)

    expect(deviceService.listRecordings).toHaveBeenCalledTimes(1)
    expect(startSession).toHaveBeenCalledTimes(1)
  })
})
