/**
 * spec-006/F17 T6 fix round 2 (CX-T6-4) — refreshLocal(): the cache-only
 * rebuild used after a confirmed device delete. The post-delete path must
 * NEVER trigger a device fetch (the previous refresh(true) forced a full
 * ~90s device list scan, awaited before the completion toast), yet the ghost
 * row must still disappear — the markNotOnDevice IPC already removed its
 * device_file_cache entry and the device service invalidated its in-memory
 * list, so rebuilding from local sources alone is sufficient.
 *
 * Own file (not useUnifiedRecordings.test.ts): that harness pins the device
 * service to a fixed disconnected/empty factory; these tests need a mutable
 * per-test device-service state (connected, cached recordings, a spied
 * listRecordings).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useUnifiedRecordings } from '../useUnifiedRecordings'
import { useAppStore } from '@/store/useAppStore'

// Mutable device-service harness — reset per test.
const deviceHarness = vi.hoisted(() => ({
  isConnected: false,
  cachedRecordings: [] as Array<{ id: string; filename: string; size: number; duration: number; dateCreated: Date }>,
  listRecordings: vi.fn()
}))

vi.mock('@/services/hidock-device', () => ({
  getHiDockDeviceService: vi.fn(() => ({
    isConnected: () => deviceHarness.isConnected,
    onConnectionChange: vi.fn(() => () => {}),
    onStatusChange: vi.fn(() => () => {}),
    getCachedRecordings: () => deviceHarness.cachedRecordings,
    listRecordings: deviceHarness.listRecordings
  }))
}))

vi.mock('@/store/useAppStore', () => ({
  useAppStore: vi.fn()
}))

vi.mock('@/components/ui/toaster', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() }
}))

function createMockElectronAPI(cachedDeviceFiles: Array<Record<string, unknown>>) {
  return {
    recordings: { getAll: vi.fn().mockResolvedValue([]) },
    syncedFiles: { getAll: vi.fn().mockResolvedValue([]) },
    deviceCache: {
      getAll: vi.fn().mockResolvedValue(cachedDeviceFiles),
      saveAll: vi.fn().mockResolvedValue(undefined)
    },
    // ROUND-15 RESIDUAL — hook now calls getAllOwner; alias to the same fn.
    knowledge: (() => { const c = vi.fn().mockResolvedValue([]); return { getAll: c, getAllOwner: c } })(),
    onRecordingAdded: vi.fn(() => vi.fn())
  } as any
}

const CACHED_GHOST = { filename: 'ghost.hda', size: 100, duration: 5, dateCreated: '2026-01-02T00:00:00.000Z' }
const CACHED_KEPT = { filename: 'kept.hda', size: 200, duration: 9, dateCreated: '2026-01-01T00:00:00.000Z' }

describe('useUnifiedRecordings.refreshLocal (CX-T6-4)', () => {
  let storeState: any
  let latestRecordings: any[]

  beforeEach(() => {
    vi.clearAllMocks()
    deviceHarness.isConnected = true
    deviceHarness.cachedRecordings = [] // post-device-delete: in-memory list invalidated
    deviceHarness.listRecordings = vi.fn().mockResolvedValue([])

    latestRecordings = []
    storeState = {
      unifiedRecordings: [],
      unifiedRecordingsLoading: false,
      unifiedRecordingsLoadingCount: 0,
      unifiedRecordingsError: null,
      // Loaded=true keeps the mount effect from kicking off a full
      // loadRecordings pass — these tests exercise refreshLocal in isolation.
      unifiedRecordingsLoaded: true,
      setUnifiedRecordings: vi.fn((recs: any[]) => {
        latestRecordings = recs
      }),
      incrementUnifiedRecordingsLoading: vi.fn(),
      decrementUnifiedRecordingsLoading: vi.fn(),
      setUnifiedRecordingsError: vi.fn(),
      markUnifiedRecordingsLoaded: vi.fn()
    }
    // @ts-ignore - useAppStore is vi-mocked; mockImplementation exists at runtime
    ;(useAppStore as any).mockImplementation((selector: any) => selector(storeState))
  })

  it('is returned by the hook (the real hook always provides it — optional typing is mock-compat only)', () => {
    global.window.electronAPI = createMockElectronAPI([])
    const { result } = renderHook(() => useUnifiedRecordings())
    expect(typeof result.current.refreshLocal).toBe('function')
  })

  it('rebuilds from local sources WITHOUT any device fetch, and the ghost row is gone once its cache entry is removed', async () => {
    // The device cache no longer contains the deleted file (the
    // markNotOnDevice IPC removed it); another device file remains cached.
    global.window.electronAPI = createMockElectronAPI([CACHED_KEPT])
    const { result } = renderHook(() => useUnifiedRecordings())

    let rebuilt: boolean | undefined
    await act(async () => {
      rebuilt = await result.current.refreshLocal!()
    })

    // CX-T6-6: a successful rebuild reports TRUE.
    expect(rebuilt).toBe(true)
    // NO device fetch of any kind — the whole point of CX-T6-4.
    expect(deviceHarness.listRecordings).not.toHaveBeenCalled()
    // No cache save-back either (that belongs to the full load's Phase 2).
    expect(window.electronAPI.deviceCache.saveAll).not.toHaveBeenCalled()

    // The rebuilt view: the still-cached device file is present (synthesized
    // from device_file_cache), the deleted one is nowhere.
    await waitFor(() => expect(latestRecordings.length).toBe(1))
    expect(latestRecordings.map((r) => r.filename)).toEqual(['kept.hda'])
    expect(latestRecordings.some((r) => r.filename === 'ghost.hda')).toBe(false)
  })

  it('before reconciliation the stale cache entry DOES synthesize the ghost — proving the disappearance above comes from the cache removal', async () => {
    global.window.electronAPI = createMockElectronAPI([CACHED_GHOST, CACHED_KEPT])
    const { result } = renderHook(() => useUnifiedRecordings())

    await act(async () => {
      await result.current.refreshLocal!()
    })

    expect(deviceHarness.listRecordings).not.toHaveBeenCalled()
    await waitFor(() => expect(latestRecordings.length).toBe(2))
    expect(latestRecordings.some((r) => r.filename === 'ghost.hda')).toBe(true)
  })

  it('is not swallowed by the 2s load debounce — back-to-back calls both rebuild', async () => {
    global.window.electronAPI = createMockElectronAPI([CACHED_KEPT])
    const { result } = renderHook(() => useUnifiedRecordings())

    await act(async () => {
      await result.current.refreshLocal!()
      await result.current.refreshLocal!()
    })

    // Both calls re-read the local sources (2 calls each), unlike
    // loadRecordings(false) which would silently return inside 2s.
    expect(window.electronAPI.deviceCache.getAll).toHaveBeenCalledTimes(2)
    expect(storeState.setUnifiedRecordings).toHaveBeenCalledTimes(2)
    expect(deviceHarness.listRecordings).not.toHaveBeenCalled()
  })

  // CX-T6-6 (fix round 3) — explicit failure contract: a rejecting local
  // read resolves FALSE (never throws) and the list keeps its previous
  // state, so the caller can surface the honest stale-view warning instead
  // of a plain success toast over a possibly-unchanged list.
  it('resolves FALSE on a failing local read and leaves the list untouched', async () => {
    global.window.electronAPI = createMockElectronAPI([])
    window.electronAPI.recordings.getAll = vi.fn().mockRejectedValue(new Error('db locked'))
    const { result } = renderHook(() => useUnifiedRecordings())

    let rebuilt: boolean | undefined
    await expect(
      act(async () => {
        rebuilt = await result.current.refreshLocal!()
      })
    ).resolves.toBeUndefined() // still never throws

    expect(rebuilt).toBe(false)
    // Previous list state untouched — no partial/empty overwrite.
    expect(storeState.setUnifiedRecordings).not.toHaveBeenCalled()
  })

  it('resolves FALSE when a different local source (deviceCache) rejects', async () => {
    global.window.electronAPI = createMockElectronAPI([])
    window.electronAPI.deviceCache.getAll = vi.fn().mockRejectedValue(new Error('cache read failed'))
    const { result } = renderHook(() => useUnifiedRecordings())

    let rebuilt: boolean | undefined
    await act(async () => {
      rebuilt = await result.current.refreshLocal!()
    })

    expect(rebuilt).toBe(false)
    expect(storeState.setUnifiedRecordings).not.toHaveBeenCalled()
  })
})
