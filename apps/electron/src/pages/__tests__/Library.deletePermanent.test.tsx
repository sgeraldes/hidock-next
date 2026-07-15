/**
 * spec-006/F17 T6 — executeDeletePermanent's device-checkbox flow (D3/AR3-6),
 * the AR3-3(c) skipGraphCleanup escape hatch, and the AR3-2 partial-file-
 * cleanup toast. Kept in its own file (mirrors Library.deviceDelete.test.tsx's
 * simpler full-mock harness — a single 'both' recording, deviceConnected
 * controllable per test) rather than folding into Library.trash.test.tsx,
 * which owns the Trash-context device-checkbox gating test (F-INFO-6) using
 * its own importOriginal harness.
 */

import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { Library } from '../Library'

afterEach(() => {
  cleanup()
})

vi.mock('@/hooks/useUnifiedRecordings', () => ({
  useUnifiedRecordings: vi.fn()
}))

const deleteRecordingMock = vi.hoisted(() => vi.fn())
vi.mock('@/services/hidock-device', () => ({
  getHiDockDeviceService: () => ({ deleteRecording: deleteRecordingMock })
}))

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }))
vi.mock('@/components/ui/toaster', () => ({
  toast: toastMock
}))

vi.mock('@/store/useUIStore', () => {
  const state = {
    currentlyPlayingId: null,
    setCurrentlyPlayingId: vi.fn(),
    playbackCurrentTime: 0,
    recordingsCompactView: true,
    setRecordingsCompactView: vi.fn(),
    waveformLoadedForId: null,
    waveformLoadingId: null,
    setWaveformLoadedForId: vi.fn(),
    setWaveformLoadingId: vi.fn()
  }
  const useUIStore = vi.fn((selector?: (s: typeof state) => unknown) =>
    typeof selector === 'function' ? selector(state) : state
  ) as unknown as { (selector?: (s: typeof state) => unknown): unknown; getState: () => typeof state; setState: ReturnType<typeof vi.fn> }
  useUIStore.getState = () => state
  useUIStore.setState = vi.fn()
  return { useUIStore }
})

vi.mock('@/store/useAppStore', () => ({
  useAppStore: vi.fn((selector) => {
    const state = { isConnected: true, deviceInfo: null, downloadQueue: new Map(), isDownloading: () => false }
    return typeof selector === 'function' ? selector(state) : state
  }),
  useDownloadQueue: vi.fn().mockReturnValue(new Map()),
  useDeviceSyncProgress: vi.fn().mockReturnValue(null),
  useDeviceSyncEta: vi.fn().mockReturnValue(null),
  useDeviceConnected: vi.fn().mockReturnValue(true),
  useDeviceSyncing: vi.fn().mockReturnValue(false),
  useConnectionStatus: vi.fn().mockReturnValue({ step: 'connected', message: 'Connected' }),
  useDeviceState: vi.fn().mockReturnValue({ connected: true }),
  useIsDownloading: vi.fn().mockReturnValue(false),
  useDownloadProgress: vi.fn().mockReturnValue(null)
}))

vi.mock('@/components/OperationController', () => ({
  useAudioControls: vi.fn(() => ({ play: vi.fn(), pause: vi.fn(), stop: vi.fn(), seek: vi.fn(), loadWaveformOnly: vi.fn(), isPlaying: false, currentTime: 0, duration: 0 }))
}))

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, size: 48, start: index * 48, key: String(index) })),
    getTotalSize: () => count * 48,
    scrollToIndex: vi.fn(),
    measureElement: vi.fn(),
    measure: vi.fn()
  })
}))

vi.mock('@/store/useLibraryStore', () => ({
  useLibraryStore: vi.fn((selector) => {
    const state = {
      viewMode: 'compact',
      sortBy: 'date', sortOrder: 'desc', sourceTypeFilter: 'all', durationPreset: 'all',
      assistantDock: 'collapsed', selectedIds: new Set(), recordingErrors: new Map(), scrollOffset: 0,
      setViewMode: vi.fn(), toggleViewMode: vi.fn(), setSortBy: vi.fn(), setSortOrder: vi.fn(), toggleSortOrder: vi.fn(),
      setSourceTypeFilter: vi.fn(), setDurationPreset: vi.fn(), setAssistantDock: vi.fn(), clearFilters: vi.fn(),
      setScrollOffset: vi.fn(), setRecordingError: vi.fn(), clearRecordingError: vi.fn(),
      toggleSelection: vi.fn(), selectAll: vi.fn(), clearSelection: vi.fn(),
      panelSizes: [25, 45, 30], setPanelSizes: vi.fn(),
      selectedSourceId: null, setSelectedSourceId: vi.fn(),
      expandedRowIds: new Set(), expandedTranscripts: new Set(), toggleRowExpansion: vi.fn(),
      expandRow: vi.fn(), collapseRow: vi.fn(), collapseAllRows: vi.fn(),
      toggleTranscriptExpansion: vi.fn(), collapseAllTranscripts: vi.fn(),
      waveformPinned: false, setWaveformPinned: vi.fn()
    }
    return typeof selector === 'function' ? selector(state) : state
  }),
  useLibrarySorting: vi.fn(() => ({ sortBy: 'date', sortOrder: 'desc' }))
}))

vi.mock('@/hooks/useOperations', () => ({
  useOperations: vi.fn(() => ({
    queueTranscription: vi.fn().mockResolvedValue(true),
    queueBulkTranscriptions: vi.fn().mockResolvedValue(0),
    queueDownload: vi.fn().mockResolvedValue(true),
    queueBulkDownloads: vi.fn().mockResolvedValue(0),
    cancelTranscription: vi.fn(), cancelAllTranscriptions: vi.fn(), cancelAllDownloads: vi.fn()
  }))
}))

vi.mock('@/features/library/hooks', () => ({
  useSourceSelection: vi.fn(() => ({
    selectedIds: new Set(), selectedCount: 0, toggleSelection: vi.fn(), selectAll: vi.fn(),
    clearSelection: vi.fn(), handleSelectionClick: vi.fn()
  })),
  useKeyboardNavigation: vi.fn(() => ({ handleKeyDown: vi.fn(), focusedIndex: -1, containerRef: { current: null } })),
  useTransitionFilters: vi.fn(() => ({
    filterMode: 'semantic', semanticFilter: 'all', exclusiveFilter: 'all',
    categoryFilter: null, qualityFilter: null, statusFilter: null, searchQuery: '',
    setFilterMode: vi.fn(), setSemanticFilter: vi.fn(), setExclusiveFilter: vi.fn(),
    setCategoryFilter: vi.fn(), setQualityFilter: vi.fn(), setStatusFilter: vi.fn(),
    setSearchQuery: vi.fn(), isPending: false
  })),
  useValueSuggestionToasts: vi.fn()
}))

const mockRefresh = vi.fn()
// CX-T6-4 (fix round 2): the cache-only rebuild used after a confirmed
// device delete — must be called INSTEAD of any device-fetching refresh.
const mockRefreshLocal = vi.fn()
const syncedRecording = {
  id: 'synced-1',
  filename: 'synced.wav',
  deviceFilename: 'synced.hda',
  title: 'Synced Recording',
  duration: 60,
  size: 2048,
  dateRecorded: new Date('2026-01-01T00:00:00Z'),
  location: 'both' as const,
  localPath: '/data/synced.wav',
  syncStatus: 'synced' as const,
  transcriptionStatus: 'complete' as const
}

const baseImpact = {
  transcripts: 2,
  actionItems: 1,
  embeddings: 3,
  captures: 1,
  artifacts: 0,
  meetingLinks: 0,
  hasAudioFile: true,
  onDevice: true,
  deviceFilename: 'synced.hda',
  graphEstimate: 4
}

const baseRemoved = {
  transcripts: 2,
  embeddings: 3,
  captures: 1,
  actionItems: 1,
  artifacts: 0,
  speakerBindings: 0,
  candidates: 0,
  meetingLinksRemoved: 0,
  markersRemoved: 1,
  edgesRemoved: 4,
  edgeSourceRowsRemoved: 1,
  meetingNodesRemoved: 1,
  orphanNodesRemoved: 0
}

import { useUnifiedRecordings } from '@/hooks/useUnifiedRecordings'

function renderLibrary() {
  return render(<MemoryRouter><Library /></MemoryRouter>)
}

function baseElectronAPI(overrides: Partial<Record<string, any>> = {}) {
  return {
    transcripts: { getByRecordingIds: vi.fn().mockResolvedValue({}) },
    meetings: { getByIds: vi.fn().mockResolvedValue({}) },
    storage: { openFolder: vi.fn() },
    recordings: {
      addExternal: vi.fn(),
      delete: vi.fn(),
      updateStatus: vi.fn(),
      markPersonal: vi.fn().mockResolvedValue({ success: true }),
      deletionImpact: vi.fn().mockResolvedValue({ success: true, data: baseImpact }),
      deleteCascade: vi.fn().mockResolvedValue({
        success: true,
        mode: 'hard',
        removed: baseRemoved,
        allFilesRemoved: true,
        pendingFileKinds: []
      }),
      restore: vi.fn().mockResolvedValue({ success: true }),
      getTrash: vi.fn().mockResolvedValue([]),
      markNotOnDevice: vi.fn().mockResolvedValue({ success: true }),
      retryPendingCleanups: vi.fn().mockResolvedValue({ success: true, attempted: 0, cleared: 0, stillPending: {} }),
      ...overrides
    },
    downloadService: { queueDownloads: vi.fn() },
    onTranscriptionCompleted: vi.fn(() => vi.fn()),
    onTranscriptionFailed: vi.fn(() => vi.fn()),
    onTranscriptionCancelled: vi.fn(() => vi.fn())
  }
}

function mockRecordingState(deviceConnected: boolean) {
  vi.mocked(useUnifiedRecordings).mockReturnValue({
    recordings: [syncedRecording] as any,
    loading: false,
    error: null,
    refresh: mockRefresh,
    refreshLocal: mockRefreshLocal,
    deviceConnected,
    stats: { total: 1, deviceOnly: 0, localOnly: 0, both: 1, synced: 1, unsynced: 0, onSource: 1, locallyAvailable: 1 }
  })
}

async function openPermanentDeleteDialog() {
  await screen.findByText('Synced Recording')
  fireEvent.keyDown(screen.getByLabelText(/^more actions$/i), { key: 'Enter' })
  fireEvent.click(await screen.findByRole('menuitem', { name: /delete permanently/i }))
  await screen.findByRole('heading', { name: /delete permanently/i })
}

beforeEach(() => {
  vi.clearAllMocks()
  global.window.electronAPI = baseElectronAPI() as any
  mockRecordingState(true)
})

describe('executeDeletePermanent — device checkbox (D3/AR3-6)', () => {
  it('unchecked: local purge succeeds, device service is never called', async () => {
    renderLibrary()
    await openPermanentDeleteDialog()

    fireEvent.click(screen.getByRole('button', { name: /^delete permanently$/i }))

    await waitFor(() => expect(window.electronAPI.recordings.deleteCascade).toHaveBeenCalledWith('synced-1', true))
    expect(deleteRecordingMock).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith('Deleted permanently', expect.stringContaining('graph link'))
    })
  })

  it('checked + connected + on-device: local purge THEN exactly one device delete, then immediate reconciliation', async () => {
    deleteRecordingMock.mockResolvedValue(true)
    renderLibrary()
    await openPermanentDeleteDialog()

    fireEvent.click(screen.getByRole('checkbox', { name: /also delete from device/i }))
    fireEvent.click(screen.getByRole('button', { name: /^delete permanently$/i }))

    await waitFor(() => expect(window.electronAPI.recordings.deleteCascade).toHaveBeenCalledWith('synced-1', true))
    await waitFor(() => expect(deleteRecordingMock).toHaveBeenCalledWith('synced.hda'))
    expect(deleteRecordingMock).toHaveBeenCalledTimes(1)
    // CX-T6-1: reconciliation passes the DEVICE FILENAME too — the hard
    // cascade already deleted the recordings row, so the id alone no longer
    // resolves in the main process; the filename is what reconciles the
    // offline device cache (the only remaining source of a ghost device row).
    await waitFor(() =>
      expect(window.electronAPI.recordings.markNotOnDevice).toHaveBeenCalledWith('synced-1', 'synced.hda')
    )
    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith('Deleted permanently', expect.stringContaining('and the device copy'))
    })
    // Ordering: the device call only happens once the local purge (deleteCascade) resolved.
    const deleteCascadeOrder = (window.electronAPI.recordings.deleteCascade as any).mock.invocationCallOrder[0]
    const deviceDeleteOrder = deleteRecordingMock.mock.invocationCallOrder[0]
    expect(deleteCascadeOrder).toBeLessThan(deviceDeleteOrder)
  })

  // CX-T6-1 + CX-T6-4 (fix round 2) — the unified view must rebuild WITHOUT
  // waiting for the next scan AND without triggering one: the post-delete
  // path calls the cache-only refreshLocal() (which the hook implements with
  // NO device fetch — asserted in useUnifiedRecordings.refreshLocal.test.ts)
  // strictly after the device delete, and NEVER the device-fetching
  // refresh(true), whose full list scan (~90s on a loaded device) is exactly
  // what made successful deletions look stuck.
  it('a confirmed device delete rebuilds via refreshLocal (cache-only) after reconciling — never a forced device refresh', async () => {
    deleteRecordingMock.mockResolvedValue(true)
    renderLibrary()
    await openPermanentDeleteDialog()

    fireEvent.click(screen.getByRole('checkbox', { name: /also delete from device/i }))
    fireEvent.click(screen.getByRole('button', { name: /^delete permanently$/i }))

    await waitFor(() => expect(deleteRecordingMock).toHaveBeenCalledWith('synced.hda'))
    await waitFor(() => expect(mockRefreshLocal).toHaveBeenCalled())
    // NO device fetch is triggered by the post-delete path: the only
    // refresh() call is the post-cascade refresh(false); refresh is never
    // forced.
    expect(mockRefresh).not.toHaveBeenCalledWith(true)
    // Ordering: the local rebuild runs strictly AFTER the device delete confirmed.
    const deviceDeleteOrder = deleteRecordingMock.mock.invocationCallOrder[0]
    const localRebuildOrder = mockRefreshLocal.mock.invocationCallOrder[0]
    expect(deviceDeleteOrder).toBeLessThan(localRebuildOrder)
  })

  it('no local rebuild and no forced refresh when the device branch was not requested (unchecked)', async () => {
    renderLibrary()
    await openPermanentDeleteDialog()

    fireEvent.click(screen.getByRole('button', { name: /^delete permanently$/i }))

    await waitFor(() => expect(toastMock.success).toHaveBeenCalled())
    expect(mockRefresh).not.toHaveBeenCalledWith(true)
    expect(mockRefreshLocal).not.toHaveBeenCalled()
  })

  it('no local rebuild on a partial device outcome (nothing was reconciled)', async () => {
    deleteRecordingMock.mockResolvedValue(false)
    renderLibrary()
    await openPermanentDeleteDialog()

    fireEvent.click(screen.getByRole('checkbox', { name: /also delete from device/i }))
    fireEvent.click(screen.getByRole('button', { name: /^delete permanently$/i }))

    await waitFor(() => expect(toastMock.warning).toHaveBeenCalled())
    expect(mockRefreshLocal).not.toHaveBeenCalled()
    expect(mockRefresh).not.toHaveBeenCalledWith(true)
  })

  it('device delete returns false: local purge kept, honest partial toast, no retry', async () => {
    deleteRecordingMock.mockResolvedValue(false)
    renderLibrary()
    await openPermanentDeleteDialog()

    fireEvent.click(screen.getByRole('checkbox', { name: /also delete from device/i }))
    fireEvent.click(screen.getByRole('button', { name: /^delete permanently$/i }))

    await waitFor(() => expect(deleteRecordingMock).toHaveBeenCalledTimes(1))
    await waitFor(() => {
      expect(toastMock.warning).toHaveBeenCalledWith(
        'Removed locally — device copy remains',
        expect.stringContaining('synced.wav')
      )
    })
    expect(toastMock.success).not.toHaveBeenCalled()
    expect(window.electronAPI.recordings.markNotOnDevice).not.toHaveBeenCalled()
  })

  it('device delete throws: local purge kept, honest partial toast', async () => {
    deleteRecordingMock.mockRejectedValue(new Error('USB error'))
    renderLibrary()
    await openPermanentDeleteDialog()

    fireEvent.click(screen.getByRole('checkbox', { name: /also delete from device/i }))
    fireEvent.click(screen.getByRole('button', { name: /^delete permanently$/i }))

    await waitFor(() => {
      expect(toastMock.warning).toHaveBeenCalledWith(
        'Removed locally — device copy remains',
        expect.stringContaining('synced.wav')
      )
    })
    expect(toastMock.success).not.toHaveBeenCalled()
  })

  // AR3-6(a) — TOCTOU: the checkbox was checked while the device was
  // connected, but the LIVE deviceConnected signal flips false before the
  // user actually confirms. The dialog's checked state is untouched (it's
  // local state, only the disabled/hint UI reacts) — execute time must
  // re-validate and refuse to claim success.
  it('TOCTOU: device disconnects between check and confirm — partial toast, device service never called', async () => {
    const { rerender } = renderLibrary()
    await openPermanentDeleteDialog()
    fireEvent.click(screen.getByRole('checkbox', { name: /also delete from device/i }))

    // Simulate a disconnect right before the user clicks confirm.
    mockRecordingState(false)
    rerender(<MemoryRouter><Library /></MemoryRouter>)

    fireEvent.click(screen.getByRole('button', { name: /^delete permanently$/i }))

    await waitFor(() => expect(window.electronAPI.recordings.deleteCascade).toHaveBeenCalledWith('synced-1', true))
    expect(deleteRecordingMock).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(toastMock.warning).toHaveBeenCalledWith(
        'Removed locally — device copy remains',
        expect.stringContaining('synced.wav')
      )
    })
    expect(toastMock.success).not.toHaveBeenCalled()
  })
})

describe('executeDeletePermanent — AR3-3(c) skipGraphCleanup escape hatch', () => {
  it('a graphUnavailable failure shows the failure toast with an escape-hatch action; the action re-invokes with skipGraphCleanup:true', async () => {
    const deleteCascadeMock = vi
      .fn()
      .mockResolvedValueOnce({ success: false, error: 'Graph cleanup unavailable: disk I/O error', graphUnavailable: true })
      .mockResolvedValueOnce({ success: true, mode: 'hard', removed: baseRemoved, graphCleanupSkipped: true, allFilesRemoved: true, pendingFileKinds: [] })
    global.window.electronAPI = baseElectronAPI({ deleteCascade: deleteCascadeMock }) as any

    renderLibrary()
    await openPermanentDeleteDialog()
    fireEvent.click(screen.getByRole('button', { name: /^delete permanently$/i }))

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith(
        'Delete failed — nothing was removed',
        expect.stringContaining('graph cleanup failed'),
        expect.objectContaining({
          action: expect.objectContaining({ label: 'Delete anyway (skip graph cleanup)' })
        })
      )
    })
    expect(deleteCascadeMock).toHaveBeenCalledTimes(1)
    expect(deleteCascadeMock).toHaveBeenNthCalledWith(1, 'synced-1', true)

    // Fire the escape-hatch action (an explicit second user action).
    const [, , opts] = toastMock.error.mock.calls[0]
    opts.action.onClick()

    await waitFor(() => expect(deleteCascadeMock).toHaveBeenCalledTimes(2))
    expect(deleteCascadeMock).toHaveBeenNthCalledWith(2, 'synced-1', true, { skipGraphCleanup: true })
    await waitFor(() => expect(toastMock.success).toHaveBeenCalled())
  })

  it('a non-graph failure shows the generic failure toast with NO escape-hatch action', async () => {
    const deleteCascadeMock = vi.fn().mockResolvedValue({ success: false, error: 'disk full' })
    global.window.electronAPI = baseElectronAPI({ deleteCascade: deleteCascadeMock }) as any

    renderLibrary()
    await openPermanentDeleteDialog()
    fireEvent.click(screen.getByRole('button', { name: /^delete permanently$/i }))

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith(
        'Delete failed — nothing was removed',
        expect.stringContaining('Nothing was deleted')
      )
    })
    // No escape-hatch action offered for a non-graph failure.
    expect(toastMock.error.mock.calls[0]).toHaveLength(2)
  })
})

describe('executeDeletePermanent — AR3-2 partial file-cleanup toast', () => {
  it('allFilesRemoved:false shows an honest partial toast (never plain success)', async () => {
    global.window.electronAPI = baseElectronAPI({
      deleteCascade: vi.fn().mockResolvedValue({
        success: true,
        mode: 'hard',
        removed: baseRemoved,
        allFilesRemoved: false,
        pendingFileKinds: ['audio']
      })
    }) as any

    renderLibrary()
    await openPermanentDeleteDialog()
    fireEvent.click(screen.getByRole('button', { name: /^delete permanently$/i }))

    await waitFor(() => {
      expect(toastMock.warning).toHaveBeenCalledWith(
        'Removed data — cleanup still finishing',
        expect.stringContaining('audio file')
      )
    })
    expect(toastMock.success).not.toHaveBeenCalled()
  })

  // CX-T6-3 (fix round) — BOTH partial outcomes at once must surface in ONE
  // combined toast: the device-only body claims full local removal, which is
  // untrue while the pending-cleanup ledger is non-empty.
  it('device-partial + files-pending shows the combined toast enumerating BOTH, never claiming full local removal', async () => {
    global.window.electronAPI = baseElectronAPI({
      deleteCascade: vi.fn().mockResolvedValue({
        success: true,
        mode: 'hard',
        removed: baseRemoved,
        allFilesRemoved: false,
        pendingFileKinds: ['audio']
      })
    }) as any
    deleteRecordingMock.mockResolvedValue(false) // device delete fails too

    renderLibrary()
    await openPermanentDeleteDialog()
    fireEvent.click(screen.getByRole('checkbox', { name: /also delete from device/i }))
    fireEvent.click(screen.getByRole('button', { name: /^delete permanently$/i }))

    await waitFor(() => {
      expect(toastMock.warning).toHaveBeenCalledWith(
        'Partially removed — device copy remains',
        expect.stringMatching(/audio file[\s\S]*device copy is still there/i)
      )
    })
    // Exactly ONE warning — not two stacked partial toasts.
    expect(toastMock.warning).toHaveBeenCalledTimes(1)
    // The overclaiming device-only body ("...and its data from this
    // computer") must NOT have been used.
    const [, body] = toastMock.warning.mock.calls[0]
    expect(body).not.toMatch(/and its data from this computer/i)
    expect(toastMock.success).not.toHaveBeenCalled()
  })
})

// CX-T6-5 (fix round 2) — a real reconciliation failure (the markNotOnDevice
// IPC now propagates cache-delete errors instead of swallowing them) must be
// handled honestly: everything WAS deleted, but the view may keep showing
// the device copy until the next scan — warning variant with the stale note,
// never the plain success toast.
describe('executeDeletePermanent — reconciliation failure honesty (CX-T6-5)', () => {
  it('markNotOnDevice {success:false} → warning toast with the stale-view note, never plain success', async () => {
    deleteRecordingMock.mockResolvedValue(true)
    global.window.electronAPI = baseElectronAPI({
      markNotOnDevice: vi.fn().mockResolvedValue({ success: false, error: 'disk I/O error' })
    }) as any

    renderLibrary()
    await openPermanentDeleteDialog()
    fireEvent.click(screen.getByRole('checkbox', { name: /also delete from device/i }))
    fireEvent.click(screen.getByRole('button', { name: /^delete permanently$/i }))

    await waitFor(() => {
      expect(toastMock.warning).toHaveBeenCalledWith(
        'Deleted permanently',
        expect.stringMatching(/and the device copy.*may still show the device copy until the next device scan/i)
      )
    })
    expect(toastMock.success).not.toHaveBeenCalled()
  })

  it('a thrown markNotOnDevice IPC is handled the same way', async () => {
    deleteRecordingMock.mockResolvedValue(true)
    global.window.electronAPI = baseElectronAPI({
      markNotOnDevice: vi.fn().mockRejectedValue(new Error('ipc dead'))
    }) as any

    renderLibrary()
    await openPermanentDeleteDialog()
    fireEvent.click(screen.getByRole('checkbox', { name: /also delete from device/i }))
    fireEvent.click(screen.getByRole('button', { name: /^delete permanently$/i }))

    await waitFor(() => {
      expect(toastMock.warning).toHaveBeenCalledWith(
        'Deleted permanently',
        expect.stringContaining('may still show the device copy')
      )
    })
    expect(toastMock.success).not.toHaveBeenCalled()
  })

  it('a successful reconciliation keeps the plain success toast (no stale note)', async () => {
    deleteRecordingMock.mockResolvedValue(true)
    renderLibrary()
    await openPermanentDeleteDialog()
    fireEvent.click(screen.getByRole('checkbox', { name: /also delete from device/i }))
    fireEvent.click(screen.getByRole('button', { name: /^delete permanently$/i }))

    await waitFor(() => expect(toastMock.success).toHaveBeenCalled())
    const [, successBody] = toastMock.success.mock.calls[0]
    expect(successBody).not.toMatch(/may still show the device copy/i)
    expect(toastMock.warning).not.toHaveBeenCalled()
  })
})
