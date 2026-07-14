/**
 * spec-005/F17 T5 — Trash vertical (view-mode swap), the DeletePermanentDialog
 * wiring, and the AR3-5 state-boundary transitions. Kept in its own file
 * (mirrors the SourceReader test split by concern) since Library.test.tsx
 * already covers the default-pipeline behaviors this deliberately doesn't
 * touch.
 *
 * Mocking harness mirrors Library.test.tsx's, with two additions:
 *  - a mutable `harness` object so selectedSourceId/currentlyPlayingId can be
 *    changed BETWEEN renders and read fresh by the mocked selectors (the same
 *    live-binding trick Library.test.tsx's scrollHarness uses).
 *  - STABLE audioControls/store-setter spies (the shared suite's factories
 *    return a fresh vi.fn() per call, which is fine for call-presence checks
 *    but unusable for "was THIS spy called" assertions across re-renders).
 */

import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { Library } from '../Library'

afterEach(() => {
  cleanup()
})

const harness = vi.hoisted(() => ({
  selectedSourceId: null as string | null,
  currentlyPlayingId: null as string | null,
  /** Bulk-selection ids surfaced through the mocked useSourceSelection (fix round). */
  selectedIds: new Set<string>(),
}))

const setSelectedSourceId = vi.hoisted(() => vi.fn())
const audioControlsMock = vi.hoisted(() => ({
  play: vi.fn(),
  pause: vi.fn(),
  stop: vi.fn(),
  seek: vi.fn(),
  loadWaveformOnly: vi.fn(),
  isPlaying: false,
  currentTime: 0,
  duration: 0
}))

// Stable selection spies (fix round, CX-T5-1/CX-T5-2): assertable across renders,
// read live by the mocked useSourceSelection below.
const selectionSpies = vi.hoisted(() => ({
  toggleSelection: vi.fn(),
  selectAll: vi.fn(),
  clearSelection: vi.fn(),
  handleSelectionClick: vi.fn()
}))

// Only the HOOK is mocked — trashRowToUnified (features/library/utils/trashRow.ts)
// imports getBestDate/UNKNOWN_DATE/mapTranscriptionStatus/DatabaseRecording from
// this SAME module, so a wholesale mock (no importOriginal) breaks the mapper the
// instant getTrash() resolves non-empty (Library.test.tsx never notices this: its
// getTrash mock always resolves [], so .map() never calls the mapper at all).
vi.mock('@/hooks/useUnifiedRecordings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useUnifiedRecordings')>()
  return {
    ...actual,
    useUnifiedRecordings: vi.fn()
  }
})

vi.mock('@/store/useUIStore', () => {
  const state = {
    get currentlyPlayingId() { return harness.currentlyPlayingId },
    setCurrentlyPlayingId: vi.fn(),
    playbackCurrentTime: 0,
    recordingsCompactView: true,
    setRecordingsCompactView: vi.fn(),
    waveformLoadedForId: null,
    waveformLoadingId: null,
    setWaveformLoadedForId: vi.fn(),
    setWaveformLoadingId: vi.fn(),
    chatPlacement: 'floating',
    setChatOpen: vi.fn(),
    setChatEmbeddedCollapsed: vi.fn()
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
    const state = {
      isConnected: false,
      deviceInfo: null,
      downloadQueue: new Map(),
      isDownloading: () => false
    }
    return typeof selector === 'function' ? selector(state) : state
  }),
  useDownloadQueue: vi.fn().mockReturnValue(new Map()),
  useDeviceSyncProgress: vi.fn().mockReturnValue(null),
  useDeviceSyncEta: vi.fn().mockReturnValue(null),
  useDeviceConnected: vi.fn().mockReturnValue(false),
  useDeviceSyncing: vi.fn().mockReturnValue(false),
  useConnectionStatus: vi.fn().mockReturnValue({ step: 'idle', message: 'Not connected' }),
  useDeviceState: vi.fn().mockReturnValue({ connected: false }),
  useIsDownloading: vi.fn().mockReturnValue(false),
  useDownloadProgress: vi.fn().mockReturnValue(null)
}))

vi.mock('@/components/OperationController', () => ({
  useAudioControls: vi.fn(() => audioControlsMock)
}))

declare global {
  var __mockVirtualizerCount: number
}
globalThis.__mockVirtualizerCount = 0

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({
      index,
      size: 48,
      start: index * 48,
      key: String(index)
    })),
    getTotalSize: () => count * 48,
    scrollToIndex: vi.fn(),
    measureElement: vi.fn(),
    measure: vi.fn()
  })
}))

vi.mock('@/store/useLibraryStore', () => ({
  useLibraryStore: vi.fn((selector) => {
    const state = {
      viewMode: 'card', // deliberately card — AC#10 must force the list anyway in Trash
      sortBy: 'date',
      sortOrder: 'desc',
      sourceTypeFilter: 'all',
      durationPreset: 'all',
      assistantDock: 'collapsed',
      selectedIds: new Set(),
      recordingErrors: new Map(),
      scrollOffset: 0,
      setViewMode: vi.fn(),
      toggleViewMode: vi.fn(),
      setSortBy: vi.fn(),
      setSortOrder: vi.fn(),
      toggleSortOrder: vi.fn(),
      setSourceTypeFilter: vi.fn(),
      setDurationPreset: vi.fn(),
      setAssistantDock: vi.fn(),
      clearFilters: vi.fn(),
      setScrollOffset: vi.fn(),
      setRecordingError: vi.fn(),
      clearRecordingError: vi.fn(),
      toggleSelection: vi.fn(),
      selectAll: vi.fn(),
      clearSelection: vi.fn(),
      panelSizes: [25, 45, 30],
      setPanelSizes: vi.fn(),
      get selectedSourceId() { return harness.selectedSourceId },
      setSelectedSourceId,
      expandedRowIds: new Set(),
      expandedTranscripts: new Set(),
      toggleRowExpansion: vi.fn(),
      expandRow: vi.fn(),
      collapseRow: vi.fn(),
      collapseAllRows: vi.fn(),
      toggleTranscriptExpansion: vi.fn(),
      collapseAllTranscripts: vi.fn(),
      waveformPinned: false,
      setWaveformPinned: vi.fn()
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
    cancelTranscription: vi.fn(),
    cancelAllTranscriptions: vi.fn(),
    cancelAllDownloads: vi.fn()
  }))
}))

// Partial mock (fix round): useKeyboardNavigation is the REAL hook so the
// CX-T5-1 tests exercise the actual Space/Ctrl+A code path (the shortcut gate
// lives in Library.tsx's guarded callbacks, not in the hook). useSourceSelection
// stays mocked but reads harness.selectedIds live, so tests can stage a
// selection and assert against the stable selectionSpies.
vi.mock('@/features/library/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/library/hooks')>()
  return {
    ...actual,
    useSourceSelection: vi.fn(() => ({
      selectedIds: harness.selectedIds,
      selectedCount: harness.selectedIds.size,
      toggleSelection: selectionSpies.toggleSelection,
      selectAll: selectionSpies.selectAll,
      clearSelection: selectionSpies.clearSelection,
      handleSelectionClick: selectionSpies.handleSelectionClick
    })),
    useTransitionFilters: vi.fn(() => ({
      filterMode: 'semantic',
      semanticFilter: 'all',
      exclusiveFilter: 'all',
      categoryFilter: null,
      qualityFilter: null,
      statusFilter: null,
      searchQuery: '',
      setFilterMode: vi.fn(),
      setSemanticFilter: vi.fn(),
      setExclusiveFilter: vi.fn(),
      setCategoryFilter: vi.fn(),
      setQualityFilter: vi.fn(),
      setStatusFilter: vi.fn(),
      setSearchQuery: vi.fn(),
      isPending: false
    })),
    useValueSuggestionToasts: vi.fn()
  }
})

const mockRefresh = vi.fn()

// Trashed-recording DB rows returned by recordings:getTrash, in getTrashedRecordings'
// contractual deleted_at DESC order (newest tombstone first).
const trashRow1 = {
  id: 'trash-1',
  filename: 'trashed-newer.wav',
  file_path: '/data/trashed-newer.wav',
  file_size: 1000,
  duration_seconds: 60,
  date_recorded: '2026-01-02T00:00:00.000Z',
  status: 'complete',
  deleted_at: '2026-01-05T00:00:00.000Z'
}
const trashRow2 = {
  id: 'trash-2',
  filename: 'trashed-older.wav',
  file_path: '/data/trashed-older.wav',
  file_size: 2000,
  duration_seconds: 90,
  date_recorded: '2026-01-01T00:00:00.000Z',
  status: 'complete',
  deleted_at: '2026-01-04T00:00:00.000Z'
}

const liveRecordings = Array.from({ length: 3 }, (_, i) => ({
  id: `live-${i}`,
  filename: `live-${i}.wav`,
  title: `Live Recording ${i}`,
  quality: 'valuable' as const,
  duration: 120,
  size: 1024,
  dateRecorded: new Date(Date.now() - i * 60_000),
  location: 'local-only' as const,
  localPath: `/data/live-${i}.wav`,
  syncStatus: 'synced' as const,
  transcriptionStatus: 'complete' as const
}))

let getTrashMock: ReturnType<typeof vi.fn>

function setElectronAPI() {
  getTrashMock = vi.fn().mockResolvedValue([trashRow1, trashRow2])
  global.window.electronAPI = {
    transcripts: {
      getByRecordingIds: vi.fn().mockResolvedValue({}),
      // SourceReader's H6 fallback fetch — exercised when a live recording is
      // selected (transcriptionStatus 'complete') without a transcript prop.
      getByRecordingId: vi.fn().mockResolvedValue(undefined)
    },
    meetings: { getByIds: vi.fn().mockResolvedValue({}) },
    storage: { openFolder: vi.fn() },
    recordings: {
      addExternal: vi.fn(),
      delete: vi.fn(),
      updateStatus: vi.fn(),
      markPersonal: vi.fn().mockResolvedValue({ success: true, personal: true }),
      deletionImpact: vi.fn().mockResolvedValue({
        success: true,
        data: { transcripts: 1, actionItems: 0, embeddings: 0, captures: 0, artifacts: 0, hasAudioFile: true }
      }),
      deleteCascade: vi.fn().mockResolvedValue({ success: true, mode: 'soft' }),
      restore: vi.fn().mockResolvedValue({ success: true }),
      getTrash: getTrashMock
    },
    downloadService: { queueDownloads: vi.fn() },
    onTranscriptionCompleted: vi.fn(() => vi.fn()),
    onTranscriptionFailed: vi.fn(() => vi.fn()),
    onTranscriptionCancelled: vi.fn(() => vi.fn())
  } as any
}

import { useUnifiedRecordings } from '@/hooks/useUnifiedRecordings'

function renderLibrary() {
  return render(
    <MemoryRouter>
      <Library />
    </MemoryRouter>
  )
}

/** Opens a SourceRow's "More actions" menu given its accessible index (0-based, DOM order). */
function openRowMenu(index: number) {
  const triggers = screen.getAllByLabelText(/^more actions$/i)
  fireEvent.keyDown(triggers[index], { key: 'Enter' })
}

function trashToggleButton() {
  return screen.getByRole('button', { name: /^trash \(\d+\)$/i })
}

beforeEach(() => {
  vi.clearAllMocks()
  harness.selectedSourceId = null
  harness.currentlyPlayingId = null
  harness.selectedIds = new Set()
  setElectronAPI()
  vi.mocked(useUnifiedRecordings).mockReturnValue({
    recordings: liveRecordings as any,
    loading: false,
    error: null,
    refresh: mockRefresh,
    deviceConnected: false,
    stats: { total: 3, deviceOnly: 0, localOnly: 3, both: 0, synced: 3, unsynced: 0, onSource: 0, locallyAvailable: 3 }
  })
})

describe('Trash toggle (spec-005/F17 §D1/§D4)', () => {
  it('loads the Trash count eagerly on mount, without entering Trash', async () => {
    renderLibrary()
    await waitFor(() => expect(getTrashMock).toHaveBeenCalled())
    expect(trashToggleButton()).toHaveTextContent('Trash (2)')
    // Still showing the live list — Trash mode was never entered.
    expect(screen.getByText('Live Recording 0')).toBeInTheDocument()
    expect(screen.queryByText('trashed-newer.wav')).not.toBeInTheDocument()
  })

  it('is a real button with aria-pressed reflecting showTrash', async () => {
    renderLibrary()
    await waitFor(() => expect(getTrashMock).toHaveBeenCalled())
    const button = trashToggleButton()
    expect(button).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('Trash mode swaps the displayed list (AC#3, AC#10)', () => {
  it('shows exactly the 2 tombstoned rows, each with Restore + Delete permanently only', async () => {
    renderLibrary()
    await waitFor(() => expect(trashToggleButton()).toHaveTextContent('Trash (2)'))
    fireEvent.click(trashToggleButton())

    // The 3 live rows are gone; the 2 trashed rows are shown instead.
    expect(screen.queryByText('Live Recording 0')).not.toBeInTheDocument()
    await screen.findByText(/trashed-newer\.wav/i)
    expect(screen.getByText(/trashed-older\.wav/i)).toBeInTheDocument()

    openRowMenu(0)
    expect(await screen.findByRole('menuitem', { name: /^restore/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /delete permanently/i })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /move to trash/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /delete from device/i })).not.toBeInTheDocument()
  })

  it('forces the SourceRow list even though viewMode is "card" (AC#10) — card-only markers absent', async () => {
    renderLibrary()
    await waitFor(() => expect(trashToggleButton()).toHaveTextContent('Trash (2)'))
    fireEvent.click(trashToggleButton())
    await screen.findByText(/trashed-newer\.wav/i)
    // SourceCard renders a distinctive testid; Trash must never render it.
    expect(screen.queryByTestId('source-card')).not.toBeInTheDocument()
  })

  it('hides the card/compact view toggle while in Trash', async () => {
    renderLibrary()
    await waitFor(() => expect(trashToggleButton()).toHaveTextContent('Trash (2)'))
    expect(screen.getByTestId('grid-view-toggle')).toBeInTheDocument()
    fireEvent.click(trashToggleButton())
    await screen.findByText(/trashed-newer\.wav/i)
    expect(screen.queryByTestId('grid-view-toggle')).not.toBeInTheDocument()
  })

  it('toggling back out restores the live list', async () => {
    renderLibrary()
    await waitFor(() => expect(trashToggleButton()).toHaveTextContent('Trash (2)'))
    fireEvent.click(trashToggleButton())
    await screen.findByText(/trashed-newer\.wav/i)
    fireEvent.click(trashToggleButton())
    await screen.findByText('Live Recording 0')
    expect(screen.queryByText(/trashed-newer\.wav/i)).not.toBeInTheDocument()
  })
})

describe('Search + filters hidden in Trash mode (AR3-5)', () => {
  it('hides the list-scoped search input and shows the Trash banner instead', async () => {
    renderLibrary()
    await waitFor(() => expect(trashToggleButton()).toHaveTextContent('Trash (2)'))
    expect(screen.getByPlaceholderText(/filter .* captures in this list/i)).toBeInTheDocument()

    fireEvent.click(trashToggleButton())
    await screen.findByText(/trashed-newer\.wav/i)
    expect(screen.queryByPlaceholderText(/filter .* captures in this list/i)).not.toBeInTheDocument()
    expect(screen.getByText(/hidden and excluded from ai/i)).toBeInTheDocument()
  })
})

describe('Restore round-trip (AC#4)', () => {
  it('calls recordings.restore(id), then the row leaves Trash and the live list refreshes', async () => {
    renderLibrary()
    await waitFor(() => expect(trashToggleButton()).toHaveTextContent('Trash (2)'))
    fireEvent.click(trashToggleButton())
    await screen.findByText(/trashed-newer\.wav/i)

    // After restoring, only trash-2 remains in the (mocked) Trash.
    getTrashMock.mockResolvedValueOnce([trashRow2])

    openRowMenu(0)
    fireEvent.click(await screen.findByRole('menuitem', { name: /^restore/i }))

    await waitFor(() => {
      expect(window.electronAPI.recordings.restore).toHaveBeenCalledWith('trash-1')
    })
    await waitFor(() => expect(mockRefresh).toHaveBeenCalledWith(false))
    await waitFor(() => expect(getTrashMock).toHaveBeenCalledTimes(2)) // mount + post-restore reload
    await waitFor(() => expect(screen.queryByText(/trashed-newer\.wav/i)).not.toBeInTheDocument())
    expect(screen.getByText(/trashed-older\.wav/i)).toBeInTheDocument()
  })
})

describe('H17 in Trash mode — no horizontal scroll, full-width separators (AC#6)', () => {
  it('the scroller never overflows horizontally and its rows use full-width separators', async () => {
    renderLibrary()
    await waitFor(() => expect(trashToggleButton()).toHaveTextContent('Trash (2)'))
    fireEvent.click(trashToggleButton())
    await screen.findByText(/trashed-newer\.wav/i)

    const scroller = screen.getByTestId('library-list')
    expect(scroller.className).toContain('overflow-x-hidden')
    // jsdom never lays out real geometry, so both are 0 — but that IS the H17
    // invariant this asserts (real-browser layout is out of scope for vitest+jsdom).
    expect(scroller.scrollWidth - scroller.clientWidth).toBe(0)

    // Structural guarantee that PRODUCES the invariant: each row wrapper spans
    // 100% width, and every row after the first carries the border-t separator.
    const rowEls = scroller.querySelectorAll('[data-index]')
    expect(rowEls.length).toBeGreaterThan(0)
    rowEls.forEach((el) => {
      expect((el as HTMLElement).style.width).toBe('100%')
    })
    expect(rowEls[1]?.className).toContain('border-t')
  })
})

describe('Permanent delete from Trash (AC#9)', () => {
  it('opens DeletePermanentDialog populated by deletionImpact, confirms the hard purge, and leaves the Trash list', async () => {
    renderLibrary()
    await waitFor(() => expect(trashToggleButton()).toHaveTextContent('Trash (2)'))
    fireEvent.click(trashToggleButton())
    await screen.findByText(/trashed-newer\.wav/i)

    getTrashMock.mockResolvedValueOnce([trashRow2])

    openRowMenu(0)
    fireEvent.click(await screen.findByRole('menuitem', { name: /delete permanently/i }))

    await waitFor(() => {
      expect(window.electronAPI.recordings.deletionImpact).toHaveBeenCalledWith('trash-1')
    })
    expect(await screen.findByRole('heading', { name: /delete permanently/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^delete permanently$/i }))

    await waitFor(() => {
      expect(window.electronAPI.recordings.deleteCascade).toHaveBeenCalledWith('trash-1', true)
    })
    await waitFor(() => expect(getTrashMock).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByText(/trashed-newer\.wav/i)).not.toBeInTheDocument())
  })
})

describe('AR3-5 — Trash state boundaries', () => {
  it('entering Trash stops playback when the playing row is trashed', async () => {
    harness.currentlyPlayingId = 'trash-1'
    renderLibrary()
    await waitFor(() => expect(trashToggleButton()).toHaveTextContent('Trash (2)'))
    expect(audioControlsMock.stop).not.toHaveBeenCalled()

    fireEvent.click(trashToggleButton())
    await screen.findByText(/trashed-newer\.wav/i)
    await waitFor(() => expect(audioControlsMock.stop).toHaveBeenCalled())
  })

  it('does NOT stop playback when the playing row is NOT trashed', async () => {
    harness.currentlyPlayingId = 'live-0'
    renderLibrary()
    await waitFor(() => expect(trashToggleButton()).toHaveTextContent('Trash (2)'))
    fireEvent.click(trashToggleButton())
    await screen.findByText(/trashed-newer\.wav/i)
    expect(audioControlsMock.stop).not.toHaveBeenCalled()
  })

  it('entering Trash clears the reader selection when the selected row is not in the trashed corpus', async () => {
    harness.selectedSourceId = 'live-0' // a live id — never part of the trashed corpus
    renderLibrary()
    await waitFor(() => expect(trashToggleButton()).toHaveTextContent('Trash (2)'))
    expect(setSelectedSourceId).not.toHaveBeenCalledWith(null)

    fireEvent.click(trashToggleButton())
    await screen.findByText(/trashed-newer\.wav/i)
    await waitFor(() => expect(setSelectedSourceId).toHaveBeenCalledWith(null))
  })

  it('entering Trash does NOT clear the selection when the selected row IS in the trashed corpus', async () => {
    harness.selectedSourceId = 'trash-1'
    renderLibrary()
    await waitFor(() => expect(trashToggleButton()).toHaveTextContent('Trash (2)'))
    fireEvent.click(trashToggleButton())
    await screen.findByText(/trashed-newer\.wav/i)
    expect(setSelectedSourceId).not.toHaveBeenCalledWith(null)
  })

  it('restoring the selected row clears its own selection once trashedRecordings updates', async () => {
    harness.selectedSourceId = 'trash-1'
    renderLibrary()
    await waitFor(() => expect(trashToggleButton()).toHaveTextContent('Trash (2)'))
    fireEvent.click(trashToggleButton())
    await screen.findByText(/trashed-newer\.wav/i)
    expect(setSelectedSourceId).not.toHaveBeenCalledWith(null) // still in the corpus so far

    getTrashMock.mockResolvedValueOnce([trashRow2]) // trash-1 leaves Trash after restore
    openRowMenu(0)
    fireEvent.click(await screen.findByRole('menuitem', { name: /^restore/i }))

    await waitFor(() => expect(setSelectedSourceId).toHaveBeenCalledWith(null))
  })

  it('soft-deleting the currently playing/selected LIVE row (via the reader\'s own menu) stops playback and clears its selection immediately', async () => {
    // selectedSourceId='live-0' means SourceReader is showing that recording —
    // the reader's OWN "More actions" menu is the realistic surface here (the
    // user has it open in the center panel while it plays). viewMode is 'card'
    // in this harness, so the LIST surface for this same assertion is covered
    // separately by the label-matrix tests in SourceRow.test.tsx / SourceReader.deletion.test.tsx;
    // this test is specifically about the STATE CONSEQUENCE (AR3-5), which is
    // identical regardless of which surface triggers handleDeleteLocal.
    harness.currentlyPlayingId = 'live-0'
    harness.selectedSourceId = 'live-0'
    renderLibrary()
    await waitFor(() => expect(trashToggleButton()).toHaveTextContent('Trash (2)'))

    fireEvent.keyDown(screen.getByLabelText(/^more actions$/i), { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: /move to trash/i }))
    // Soft-delete confirm dialog (§D2 copy) — click its action button.
    fireEvent.click(await screen.findByRole('button', { name: /^move to trash$/i }))

    await waitFor(() => expect(window.electronAPI.recordings.deleteCascade).toHaveBeenCalledWith('live-0', false))
    await waitFor(() => expect(audioControlsMock.stop).toHaveBeenCalled())
    await waitFor(() => expect(setSelectedSourceId).toHaveBeenCalledWith(null))
    // The Trash count also refreshes so it doesn't go stale (§D1 step 7).
    await waitFor(() => expect(getTrashMock).toHaveBeenCalledTimes(2))
  })
})

describe('Confirm-dialog copy matches §D2 exactly', () => {
  it('soft delete: title/action "Move to Trash", description names the file + restore path', async () => {
    // viewMode is 'card' in this harness (default live-list rendering), so the
    // soft-delete affordance here is SourceCard's own delete button — the
    // dropdown-menu label matrix (with its D2 scope text) is covered in
    // SourceRow.test.tsx / SourceReader.deletion.test.tsx; this test only
    // verifies the CONFIRM DIALOG copy Library.tsx itself owns.
    renderLibrary()
    await waitFor(() => expect(trashToggleButton()).toHaveTextContent('Trash (2)'))
    fireEvent.click(screen.getAllByTitle('Move to Trash')[0])

    expect(await screen.findByText(/move "live-0\.wav" to trash\?/i)).toBeInTheDocument()
    expect(screen.getByText(/restore it from trash, or delete it permanently later/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^move to trash$/i })).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Fix round (Opus APPROVED-with-LOWs + /codex:review 3×P2, 2026-07-14)
// ---------------------------------------------------------------------------

describe('CX-T5-3 — null-file_path recording stays restorable in Trash', () => {
  it('a trash row with a null file_path still shows Restore + Delete permanently', async () => {
    // The stranded-in-Trash vector the explicit sourceKind stamp closes: a real
    // recording whose nullable file_path is null, soft-deleted (e.g. via bulk
    // delete, which has no hasLocalPath guard), then mapped into Trash.
    getTrashMock.mockResolvedValue([{
      ...trashRow1,
      id: 'trash-nullpath',
      filename: 'null-path.wav',
      file_path: null
    }])
    renderLibrary()
    await waitFor(() => expect(trashToggleButton()).toHaveTextContent('Trash (1)'))
    fireEvent.click(trashToggleButton())
    await screen.findByText(/null-path\.wav/i)

    openRowMenu(0)
    expect(await screen.findByRole('menuitem', { name: /^restore/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /delete permanently/i })).toBeInTheDocument()
  })
})

describe('CX-T5-1 — Trash mode disables bulk selection', () => {
  it('Space (and Ctrl+A) in Trash select nothing; the same keys select in the live list', async () => {
    renderLibrary()
    await waitFor(() => expect(trashToggleButton()).toHaveTextContent('Trash (2)'))
    const list = screen.getByTestId('library-list')

    // Control (live list): ArrowDown focuses row 0, Space toggles its selection.
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    fireEvent.keyDown(list, { key: ' ' })
    expect(selectionSpies.toggleSelection).toHaveBeenCalledWith('live-0')
    selectionSpies.toggleSelection.mockClear()
    selectionSpies.selectAll.mockClear()

    // Trash mode: the same shortcuts are inert (guarded in Library.tsx).
    fireEvent.click(trashToggleButton())
    await screen.findByText(/trashed-newer\.wav/i)
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    fireEvent.keyDown(list, { key: ' ' })
    fireEvent.keyDown(list, { key: 'a', ctrlKey: true })
    expect(selectionSpies.toggleSelection).not.toHaveBeenCalled()
    expect(selectionSpies.selectAll).not.toHaveBeenCalled()
    expect(screen.queryByRole('toolbar', { name: /bulk actions/i })).not.toBeInTheDocument()
  })

  it('the BulkActionsBar never renders in Trash, even with a staged selection', async () => {
    // Defensive render gate: even if a selection somehow existed while in
    // Trash, the bar (whose handlers all operate on the LIVE list) must not show.
    harness.selectedIds = new Set(['live-0'])
    renderLibrary()
    await waitFor(() => expect(trashToggleButton()).toHaveTextContent('Trash (2)'))
    expect(screen.getByRole('toolbar', { name: /bulk actions/i })).toBeInTheDocument()

    fireEvent.click(trashToggleButton())
    await screen.findByText(/trashed-newer\.wav/i)
    expect(screen.queryByRole('toolbar', { name: /bulk actions/i })).not.toBeInTheDocument()
    // Entering Trash also clears whatever selection existed (handleToggleTrash).
    expect(selectionSpies.clearSelection).toHaveBeenCalled()
  })
})

describe('CX-T5-2 + OP-F-LOW-4 — bulk soft-delete refreshes Trash and clears playback/reader (AR3-5)', () => {
  it('bulk-deleting the playing/selected row re-runs loadTrash, stops playback, and clears the reader', async () => {
    harness.selectedIds = new Set(['live-0'])
    harness.currentlyPlayingId = 'live-0'
    harness.selectedSourceId = 'live-0'
    renderLibrary()
    await waitFor(() => expect(trashToggleButton()).toHaveTextContent('Trash (2)'))

    // Bulk bar → Delete → shared confirm dialog → confirm.
    const toolbar = screen.getByRole('toolbar', { name: /bulk actions/i })
    fireEvent.click(within(toolbar).getByTitle('Delete selected'))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(/delete selected items/i)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: /^delete$/i }))

    await waitFor(() => expect(window.electronAPI.recordings.deleteCascade).toHaveBeenCalledWith('live-0', false))
    // CX-T5-2: the Trash badge/list reloads (mount + post-bulk-delete).
    await waitFor(() => expect(getTrashMock).toHaveBeenCalledTimes(2))
    // OP-F-LOW-4: AR3-5 parity with the single-row path.
    await waitFor(() => expect(audioControlsMock.stop).toHaveBeenCalled())
    await waitFor(() => expect(setSelectedSourceId).toHaveBeenCalledWith(null))
  })

  it('bulk-deleting a NON-playing row leaves playback alone (and still refreshes Trash)', async () => {
    harness.selectedIds = new Set(['live-1'])
    harness.currentlyPlayingId = 'live-0'
    renderLibrary()
    await waitFor(() => expect(trashToggleButton()).toHaveTextContent('Trash (2)'))

    const toolbar = screen.getByRole('toolbar', { name: /bulk actions/i })
    fireEvent.click(within(toolbar).getByTitle('Delete selected'))
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /^delete$/i }))

    await waitFor(() => expect(window.electronAPI.recordings.deleteCascade).toHaveBeenCalledWith('live-1', false))
    await waitFor(() => expect(getTrashMock).toHaveBeenCalledTimes(2))
    expect(audioControlsMock.stop).not.toHaveBeenCalled()
  })
})
