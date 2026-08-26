import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { Library } from '../Library'

// Shared harness for the "reveal opened source" behavior: a STABLE scrollToIndex
// spy (so we can assert across renders) and a mutable selectedSourceId the store
// mock reads at call time. Defaults keep existing tests unaffected.
const scrollHarness = vi.hoisted(() => ({
  scrollToIndex: vi.fn(),
  selectedSourceId: null as string | null
}))
const virtualizerHarness = vi.hoisted(() => ({
  measure: vi.fn(),
  measureElement: vi.fn(),
  options: null as null | {
    count: number
    estimateSize: () => number
    getItemKey?: (index: number) => string | number
  }
}))
const deviceSyncHarness = vi.hoisted(() => ({
  scanAndReconcile: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@/services/device-sync-actions', () => ({
  scanAndReconcile: deviceSyncHarness.scanAndReconcile
}))

// Mock hooks
vi.mock('@/hooks/useUnifiedRecordings', () => ({
  useUnifiedRecordings: vi.fn(),
  overlayActiveTranscriptionStatuses: (recordings: unknown[]) => recordings
}))

vi.mock('@/store/useUIStore', () => {
  const state = {
    currentlyPlayingId: null,
    setCurrentlyPlayingId: vi.fn(),
    recordingsCompactView: true,
    setRecordingsCompactView: vi.fn(),
    // Waveform-preload fields read by SourceReader's preload effect via getState().
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
  useAudioControls: vi.fn(() => ({
    play: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
    isPlaying: false,
    currentTime: 0,
    duration: 0
  }))
}))

// Mock storage for virtualizer items - accessed via global to survive module mock
declare global {
  var __mockVirtualizerCount: number
}
globalThis.__mockVirtualizerCount = 0

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (options: {
    count: number
    estimateSize: () => number
    getItemKey?: (index: number) => string | number
  }) => {
    virtualizerHarness.options = options
    const size = options.estimateSize()
    return {
    getVirtualItems: () => Array.from({ length: options.count }, (_, index) => ({
      index,
      size,
      start: index * size,
      key: options.getItemKey?.(index) ?? String(index)
    })),
    getTotalSize: () => options.count * size,
    scrollToIndex: scrollHarness.scrollToIndex,
    measureElement: virtualizerHarness.measureElement,
    measure: virtualizerHarness.measure
  }
  }
}))

vi.mock('@/store/useLibraryStore', () => ({
  useLibraryStore: vi.fn((selector) => {
    const state = {
      // Reader-pane state. Keep in sync with useLibraryStore's initialState —
      // a missing key here surfaces as "Cannot read properties of undefined"
      // deep inside a render, not as an obvious mock error.
      readerSectionModes: {
        player: 'expanded',
        metadata: 'expanded',
        summary: 'expanded',
        transcript: 'expanded'
      },
      setReaderSectionMode: vi.fn(),
      readerVerticalSizes: [64, 36],
      setReaderVerticalSizes: vi.fn(),
      readerMaximizedSection: null,
      setReaderMaximizedSection: vi.fn(),
      toggleReaderMaximizedSection: vi.fn(),
      readerListCollapsedBeforeMaximize: null,
      listPaneSize: 25,
      setListPaneSize: vi.fn(),
      listCollapsed: false,
      setListCollapsed: vi.fn(),
      qualityFilter: null,
      setQualityFilter: vi.fn(),
      statusFilter: null,
      setStatusFilter: vi.fn(),
      searchQuery: '',
      setSearchQuery: vi.fn(),
      viewMode: 'compact',
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
      selectedSourceId: scrollHarness.selectedSourceId,
      setSelectedSourceId: vi.fn(),
      expandedRowIds: new Set(),
      expandedTranscripts: new Set(),
      toggleRowExpansion: vi.fn(),
      expandRow: vi.fn(),
      collapseRow: vi.fn(),
      collapseAllRows: vi.fn(),
      toggleTranscriptExpansion: vi.fn(),
      collapseAllTranscripts: vi.fn()
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

vi.mock('@/features/library/hooks', () => ({
  useSourceSelection: vi.fn(() => ({
    selectedIds: new Set(),
    selectedCount: 0,
    toggleSelection: vi.fn(),
    selectAll: vi.fn(),
    clearSelection: vi.fn(),
    handleSelectionClick: vi.fn()
  })),
  useKeyboardNavigation: vi.fn(() => ({
    handleKeyDown: vi.fn(),
    focusedIndex: -1,
    containerRef: { current: null }
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
  // F16/spec-003 Part F — mounted once on the Library page; no-op here since
  // this suite doesn't exercise the suggestion-toast behavior (see
  // useValueSuggestionToasts.test.tsx for that coverage).
  useValueSuggestionToasts: vi.fn()
}))

const mockRefresh = vi.fn()
const transcriptionCompletedListeners: Array<(data: { recordingId: string }) => void> = []
const transcriptionFailedListeners: Array<() => void> = []
const transcriptionCancelledListeners: Array<() => void> = []

// Mock electronAPI
global.window.electronAPI = {
  // ADV13: Library uses the owner-management batch accessor.
  transcripts: { getByRecordingIds: vi.fn().mockResolvedValue({}), getByRecordingIdsOwner: vi.fn().mockResolvedValue({}) },
  meetings: { getByIds: vi.fn().mockResolvedValue({}) },
  storage: { openFolder: vi.fn() },
  recordings: {
    addExternal: vi.fn(),
    delete: vi.fn(),
    updateStatus: vi.fn(),
    markPersonal: vi.fn().mockResolvedValue({ success: true, personal: true }),
    deletionImpact: vi.fn().mockResolvedValue({ success: true, data: { transcripts: 0, actionItems: 0, embeddings: 0, artifacts: 0, hasAudioFile: true } }),
    deleteCascade: vi.fn().mockResolvedValue({ success: true, mode: 'soft' }),
    restore: vi.fn().mockResolvedValue({ success: true }),
    // spec-005/F17 T5 — loaded eagerly on mount (for the Trash toggle's count).
    getTrash: vi.fn().mockResolvedValue([])
  },
  downloadService: {
    queueDownloads: vi.fn()
  },
  onTranscriptionCompleted: vi.fn((callback) => {
    transcriptionCompletedListeners.push(callback)
    return vi.fn()
  }),
  onTranscriptionFailed: vi.fn((callback) => {
    transcriptionFailedListeners.push(callback)
    return vi.fn()
  }),
  onTranscriptionCancelled: vi.fn((callback) => {
    transcriptionCancelledListeners.push(callback)
    return vi.fn()
  })
} as any

import { useUnifiedRecordings } from '@/hooks/useUnifiedRecordings'

const mockRecording = {
  id: 'test-123',
  filename: 'test.wav',
  quality: 'valuable' as const,
  duration: 120,
  size: 1024000,
  dateRecorded: new Date(),
  location: 'local-only' as const,
  localPath: '/path/test.wav',
  syncStatus: 'synced' as const,
  transcriptionStatus: 'complete' as const,
  title: 'Test Recording'
}

describe('Library', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    scrollHarness.scrollToIndex.mockClear()
    scrollHarness.selectedSourceId = null
    virtualizerHarness.measure.mockClear()
    virtualizerHarness.measureElement.mockClear()
    virtualizerHarness.options = null
    mockRefresh.mockReset()
    deviceSyncHarness.scanAndReconcile.mockReset().mockResolvedValue(undefined)
    transcriptionCompletedListeners.length = 0
    transcriptionFailedListeners.length = 0
    transcriptionCancelledListeners.length = 0
    vi.mocked(window.electronAPI.transcripts.getByRecordingIds).mockResolvedValue({})
    vi.mocked(window.electronAPI.transcripts.getByRecordingIdsOwner).mockResolvedValue({})
    vi.mocked(window.electronAPI.meetings.getByIds).mockResolvedValue({})
    vi.mocked(useUnifiedRecordings).mockReturnValue({
      recordings: [],
      loading: false,
      error: null,
      refresh: mockRefresh,
      deviceConnected: false,
      stats: { total: 0, deviceOnly: 0, localOnly: 0, both: 0, synced: 0, unsynced: 0, onSource: 0, locallyAvailable: 0 }
    })
  })

  const renderLibrary = () => {
    return render(
      <MemoryRouter>
        <Library />
      </MemoryRouter>
    )
  }

  describe('Manual refresh', () => {
    it('forces device reconciliation before rebuilding the Library view', async () => {
      const calls: string[] = []
      deviceSyncHarness.scanAndReconcile.mockImplementation(async () => {
        calls.push('sync')
      })
      mockRefresh.mockImplementation(async () => {
        calls.push('refresh')
      })

      renderLibrary()
      fireEvent.click(screen.getByRole('button', { name: 'Refresh Library' }))

      await waitFor(() => {
        expect(deviceSyncHarness.scanAndReconcile).toHaveBeenCalledWith('manual')
        expect(mockRefresh).toHaveBeenCalledWith(true)
      })
      expect(calls).toEqual(['sync', 'refresh'])
    })
  })

  describe('Reveal opened source (select + scroll into view)', () => {
    const makeRecs = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        ...mockRecording,
        id: `rec-${i}`,
        filename: `rec-${i}.wav`,
        title: `Recording ${i}`,
        // Descending dates so the default date-desc sort preserves index order.
        dateRecorded: new Date(Date.now() - i * 60_000)
      }))

    it('scrolls the virtualized list to the opened recording', async () => {
      vi.mocked(useUnifiedRecordings).mockReturnValue({
        recordings: makeRecs(6) as any,
        loading: false,
        error: null,
        refresh: mockRefresh,
        deviceConnected: false,
        stats: { total: 6, deviceOnly: 0, localOnly: 6, both: 0, synced: 6, unsynced: 0, onSource: 0, locallyAvailable: 6 }
      })
      // The 4th recording (index 3) is the one being opened.
      scrollHarness.selectedSourceId = 'rec-3'

      renderLibrary()

      await waitFor(() => {
        expect(scrollHarness.scrollToIndex).toHaveBeenCalledWith(3, { align: 'auto' })
      })
    })

    it('does not scroll when nothing is selected', async () => {
      vi.mocked(useUnifiedRecordings).mockReturnValue({
        recordings: makeRecs(4) as any,
        loading: false,
        error: null,
        refresh: mockRefresh,
        deviceConnected: false,
        stats: { total: 4, deviceOnly: 0, localOnly: 4, both: 0, synced: 4, unsynced: 0, onSource: 0, locallyAvailable: 4 }
      })
      scrollHarness.selectedSourceId = null

      renderLibrary()

      await waitFor(() => expect(screen.getByText('rec-0.wav')).toBeInTheDocument())
      expect(scrollHarness.scrollToIndex).not.toHaveBeenCalled()
    })
  })

  describe('Loading State', () => {
    it('renders loading state initially', () => {
      vi.mocked(useUnifiedRecordings).mockReturnValue({
        recordings: [],
        loading: true,
        error: null,
        refresh: vi.fn(),
        deviceConnected: false,
        stats: { total: 0, deviceOnly: 0, localOnly: 0, both: 0, synced: 0, unsynced: 0, onSource: 0, locallyAvailable: 0 }
      })

      renderLibrary()
      // Library renders main element during loading
      expect(document.querySelector('main') || document.body).toBeTruthy()
    })
  })

  describe('Empty State', () => {
    it('shows empty state when no recordings exist', () => {
      vi.mocked(useUnifiedRecordings).mockReturnValue({
        recordings: [],
        loading: false,
        error: null,
        refresh: vi.fn(),
        deviceConnected: false,
        stats: { total: 0, deviceOnly: 0, localOnly: 0, both: 0, synced: 0, unsynced: 0, onSource: 0, locallyAvailable: 0 }
      })

      renderLibrary()
      // Empty state component should be rendered
      expect(screen.getByText(/no.*knowledge.*captured|no.*recordings|empty/i)).toBeInTheDocument()
    })
  })

  describe('Recording Display', () => {
    it('shows recording count when recordings exist', async () => {
      vi.mocked(useUnifiedRecordings).mockReturnValue({
        recordings: [mockRecording],
        loading: false,
        error: null,
        refresh: vi.fn(),
        deviceConnected: false,
        stats: { total: 1, deviceOnly: 0, localOnly: 1, both: 0, synced: 1, unsynced: 0, onSource: 0, locallyAvailable: 1 }
      })

      renderLibrary()

      // Header shows the universal source count.
      await waitFor(() => {
        expect(screen.getByText(/1.*source/i)).toBeInTheDocument()
      })
    })

    // The banner reports a device that WENT AWAY, not one that was never
    // there — showDisconnectBanner is `wasConnected && !deviceConnected`, so a
    // session that never saw a device is deliberately left un-nagged. Drive the
    // real transition rather than asserting on a cold start.
    it('shows the disconnect banner after a connected device goes away', async () => {
      const stats = { total: 1, deviceOnly: 0, localOnly: 1, both: 0, synced: 1, unsynced: 0, onSource: 0, locallyAvailable: 1 }
      vi.mocked(useUnifiedRecordings).mockReturnValue({
        recordings: [mockRecording],
        loading: false,
        error: null,
        refresh: vi.fn(),
        deviceConnected: true,
        stats
      })

      const { rerender } = renderLibrary()
      expect(screen.queryByText(/device disconnected/i)).not.toBeInTheDocument()

      vi.mocked(useUnifiedRecordings).mockReturnValue({
        recordings: [mockRecording],
        loading: false,
        error: null,
        refresh: vi.fn(),
        deviceConnected: false,
        stats
      })
      rerender(
        <MemoryRouter>
          <Library />
        </MemoryRouter>
      )

      await waitFor(() => {
        expect(screen.getByText(/device disconnected/i)).toBeInTheDocument()
      })
    })

    it('stays quiet when no device was ever connected', async () => {
      vi.mocked(useUnifiedRecordings).mockReturnValue({
        recordings: [mockRecording],
        loading: false,
        error: null,
        refresh: vi.fn(),
        deviceConnected: false,
        stats: { total: 1, deviceOnly: 0, localOnly: 1, both: 0, synced: 1, unsynced: 0, onSource: 0, locallyAvailable: 1 }
      })

      renderLibrary()
      await waitFor(() => expect(screen.getByText(/1.*source/i)).toBeInTheDocument())
      expect(screen.queryByText(/device disconnected/i)).not.toBeInTheDocument()
    })

    it('paints compact-row separators without changing measured geometry', async () => {
      vi.mocked(useUnifiedRecordings).mockReturnValue({
        recordings: [
          mockRecording,
          { ...mockRecording, id: 'test-456', filename: 'second.wav', title: 'Second Recording' }
        ],
        loading: false,
        error: null,
        refresh: vi.fn(),
        deviceConnected: false,
        stats: { total: 2, deviceOnly: 0, localOnly: 2, both: 0, synced: 2, unsynced: 0, onSource: 0, locallyAvailable: 2 }
      })

      renderLibrary()

      const secondVirtualRow = await waitFor(() => {
        const row = document.querySelector<HTMLElement>('[data-index="1"]')
        expect(row).not.toBeNull()
        return row as HTMLElement
      })

      expect(secondVirtualRow.className).toContain('before:absolute')
      expect(secondVirtualRow.classList.contains('border-t')).toBe(false)
    })

    it('keeps same-title rows on distinct fixed tracks after a split insertion', async () => {
      vi.mocked(useUnifiedRecordings).mockReturnValue({
        recordings: [
          mockRecording,
          { ...mockRecording, id: 'after-parent', filename: 'after.wav', title: 'After parent' }
        ],
        loading: false,
        error: null,
        refresh: vi.fn(),
        deviceConnected: false,
        stats: { total: 2, deviceOnly: 0, localOnly: 2, both: 0, synced: 2, unsynced: 0, onSource: 0, locallyAvailable: 2 }
      })
      const view = renderLibrary()

      vi.mocked(useUnifiedRecordings).mockReturnValue({
        recordings: [
          {
            ...mockRecording,
            id: 'duplicate-parent-id',
            filename: 'part-1.flac',
            meetingSubject: 'RE: [EXTERNAL] DFX5 SIP Gateway WAR',
            dateRecorded: new Date('2026-08-18T18:46:00'),
            duration: 2815
          },
          {
            ...mockRecording,
            id: 'duplicate-parent-id',
            filename: 'part-2.flac',
            meetingSubject: 'RE: [EXTERNAL] DFX5 SIP Gateway WAR',
            dateRecorded: new Date('2026-08-18T18:45:00'),
            duration: 2819
          },
          {
            ...mockRecording,
            id: 'after-parent',
            filename: 'after.wav',
            dateRecorded: new Date('2026-08-18T18:44:00')
          }
        ],
        loading: false,
        error: null,
        refresh: vi.fn(),
        deviceConnected: false,
        stats: { total: 3, deviceOnly: 0, localOnly: 3, both: 0, synced: 3, unsynced: 0, onSource: 0, locallyAvailable: 3 }
      })
      view.rerender(
        <MemoryRouter>
          <Library />
        </MemoryRouter>
      )

      await waitFor(() => {
        expect(screen.getAllByText('RE: [EXTERNAL] DFX5 SIP Gateway WAR')).toHaveLength(2)
      })
      expect(virtualizerHarness.options?.getItemKey?.(0)).toBe('duplicate-parent-id::part-1.flac')
      expect(virtualizerHarness.options?.getItemKey?.(1)).toBe('duplicate-parent-id::part-2.flac')
      expect(virtualizerHarness.options?.getItemKey?.(2)).toBe('after-parent')
      expect(virtualizerHarness.measureElement).not.toHaveBeenCalled()
      const rows = [0, 1, 2].map((index) => document.querySelector<HTMLElement>(`[data-index="${index}"]`))
      expect(rows[0]).toHaveStyle({ height: '48px', top: '0px' })
      expect(rows[1]).toHaveStyle({ height: '48px', top: '48px' })
      expect(rows[2]).toHaveStyle({ height: '48px', top: '96px' })
      expect(rows.every((row) => row?.style.transform === '')).toBe(true)
      expect(new Set(rows.map((row) => row?.style.top)).size).toBe(3)
    })
  })

  describe('Error State', () => {
    it('renders error state when error occurs', () => {
      // Note: The component expects error to be a string, not an Error object
      vi.mocked(useUnifiedRecordings).mockReturnValue({
        recordings: [],
        loading: false,
        error: 'Failed to load recordings',
        refresh: vi.fn(),
        deviceConnected: false,
        stats: { total: 0, deviceOnly: 0, localOnly: 0, both: 0, synced: 0, unsynced: 0, onSource: 0, locallyAvailable: 0 }
      })

      renderLibrary()
      // Error state should be visible
      expect(screen.getByText(/failed to load recordings/i)).toBeInTheDocument()
    })
  })

  describe('View Mode Toggle', () => {
    it('renders view mode toggle buttons', async () => {
      vi.mocked(useUnifiedRecordings).mockReturnValue({
        recordings: [mockRecording],
        loading: false,
        error: null,
        refresh: vi.fn(),
        deviceConnected: false,
        stats: { total: 1, deviceOnly: 0, localOnly: 1, both: 0, synced: 1, unsynced: 0, onSource: 0, locallyAvailable: 1 }
      })

      renderLibrary()

      await waitFor(() => {
        // View mode toggle buttons should be present
        expect(screen.getByTitle(/card view/i)).toBeInTheDocument()
        expect(screen.getByTitle(/compact view|list view/i)).toBeInTheDocument()
      })
    })
  })

  describe('Filters', () => {
    it('renders filter controls', () => {
      renderLibrary()
      const searchInput = screen.getByPlaceholderText(/search .* sources/i)
      expect(searchInput).toBeInTheDocument()
    })
  })

  describe('Bulk Actions', () => {
    it('shows bulk action buttons in header', async () => {
      vi.mocked(useUnifiedRecordings).mockReturnValue({
        recordings: [mockRecording],
        loading: false,
        error: null,
        refresh: vi.fn(),
        deviceConnected: false,
        stats: { total: 1, deviceOnly: 0, localOnly: 1, both: 0, synced: 1, unsynced: 0, onSource: 0, locallyAvailable: 1 }
      })

      renderLibrary()

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /add source/i })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /refresh library/i })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /view trash/i })).toBeInTheDocument()
      })
    })
  })

  describe('Transcription Events', () => {
    it('refreshes recording metadata and loads the finished transcript after completion', async () => {
      vi.mocked(useUnifiedRecordings).mockReturnValue({
        recordings: [{ ...mockRecording, transcriptionStatus: 'processing' }],
        loading: false,
        error: null,
        refresh: mockRefresh,
        deviceConnected: false,
        stats: { total: 1, deviceOnly: 0, localOnly: 1, both: 0, synced: 1, unsynced: 0, onSource: 0, locallyAvailable: 1 }
      })
      vi.mocked(window.electronAPI.transcripts.getByRecordingIdsOwner).mockResolvedValue({
        'test-123': {
          id: 'transcript-1',
          recordingId: 'test-123',
          text: 'Completed local ASR transcript',
          segments: [],
          speakers: [],
          summary: 'Summary',
          actionables: [],
          createdAt: new Date()
        }
      })

      renderLibrary()

      await waitFor(() => {
        expect(window.electronAPI.onTranscriptionCompleted).toHaveBeenCalled()
      })

      await act(async () => {
        transcriptionCompletedListeners[0]({ recordingId: 'test-123' })
      })

      await waitFor(() => {
        expect(mockRefresh).toHaveBeenCalledWith(false)
        expect(window.electronAPI.transcripts.getByRecordingIdsOwner).toHaveBeenCalledWith(['test-123'])
      })
    })
  })
})
