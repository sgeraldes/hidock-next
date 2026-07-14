/**
 * spec-005/F17 T5 §D3/AC#2/AC#8 — the NEW synced-row "Delete from device" menu
 * item routes through the EXISTING getHiDockDeviceService().deleteRecording
 * path, never deleteCascade, and the (also new) success toast.
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

import { useUnifiedRecordings } from '@/hooks/useUnifiedRecordings'

function renderLibrary() {
  return render(<MemoryRouter><Library /></MemoryRouter>)
}

beforeEach(() => {
  vi.clearAllMocks()
  global.window.electronAPI = {
    transcripts: { getByRecordingIds: vi.fn().mockResolvedValue({}) },
    meetings: { getByIds: vi.fn().mockResolvedValue({}) },
    storage: { openFolder: vi.fn() },
    recordings: {
      addExternal: vi.fn(),
      delete: vi.fn(),
      updateStatus: vi.fn(),
      markPersonal: vi.fn().mockResolvedValue({ success: true }),
      deletionImpact: vi.fn().mockResolvedValue({ success: true, data: { transcripts: 0, actionItems: 0, embeddings: 0, artifacts: 0, hasAudioFile: true } }),
      deleteCascade: vi.fn().mockResolvedValue({ success: true, mode: 'soft' }),
      restore: vi.fn().mockResolvedValue({ success: true }),
      getTrash: vi.fn().mockResolvedValue([])
    },
    downloadService: { queueDownloads: vi.fn() },
    onTranscriptionCompleted: vi.fn(() => vi.fn()),
    onTranscriptionFailed: vi.fn(() => vi.fn()),
    onTranscriptionCancelled: vi.fn(() => vi.fn())
  } as any
  vi.mocked(useUnifiedRecordings).mockReturnValue({
    recordings: [syncedRecording] as any,
    loading: false,
    error: null,
    refresh: mockRefresh,
    deviceConnected: true,
    stats: { total: 1, deviceOnly: 0, localOnly: 0, both: 1, synced: 1, unsynced: 0, onSource: 1, locallyAvailable: 1 }
  })
})

describe('Synced-row "Delete from device" (spec-005/F17 T5 §D3/AC#2)', () => {
  it('invokes getHiDockDeviceService().deleteRecording, never deleteCascade, and toasts success (AC#8)', async () => {
    deleteRecordingMock.mockResolvedValue(true)
    renderLibrary()
    await screen.findByText('Synced Recording')

    fireEvent.keyDown(screen.getByLabelText(/^more actions$/i), { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: /delete from device/i }))
    fireEvent.click(await screen.findByRole('button', { name: /^delete from device$/i }))

    await waitFor(() => expect(deleteRecordingMock).toHaveBeenCalledWith('synced.hda'))
    expect(window.electronAPI.recordings.deleteCascade).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith('Removed from device', expect.stringContaining('synced.wav'))
    })
  })

  it('device-delete confirm dialog copy matches §D2 exactly', async () => {
    renderLibrary()
    await screen.findByText('Synced Recording')
    fireEvent.keyDown(screen.getByLabelText(/^more actions$/i), { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: /delete from device/i }))

    expect(await screen.findByText(/delete "synced\.wav" from the hidock device\?/i)).toBeInTheDocument()
    expect(screen.getByText(/your local copy \(if any\) is kept/i)).toBeInTheDocument()
  })
})
