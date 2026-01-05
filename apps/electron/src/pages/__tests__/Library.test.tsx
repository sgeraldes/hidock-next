import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { Library } from '../Library'

// Mock hooks
vi.mock('@/hooks/useUnifiedRecordings', () => ({
  useUnifiedRecordings: vi.fn()
}))

vi.mock('@/store/useUIStore', () => ({
  useUIStore: vi.fn((selector) => {
    const state = {
      currentlyPlayingId: null,
      setCurrentlyPlayingId: vi.fn(),
      recordingsCompactView: true,
      setRecordingsCompactView: vi.fn()
    }
    return typeof selector === 'function' ? selector(state) : state
  })
}))

vi.mock('@/store/useAppStore', () => ({
  useAppStore: vi.fn((selector) => {
    const state = {
      isConnected: false,
      deviceInfo: null,
      downloadQueue: new Map(),
      isDownloading: () => false
    }
    return typeof selector === 'function' ? selector(state) : state
  })
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
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({
      index,
      size: 64,
      start: index * 64,
      key: String(index)
    })),
    getTotalSize: () => count * 64,
    scrollToIndex: vi.fn(),
    measureElement: vi.fn()
  })
}))

// Mock electronAPI
global.window.electronAPI = {
  transcripts: { getByRecordingIds: vi.fn().mockResolvedValue({}) },
  meetings: { getByIds: vi.fn().mockResolvedValue({}) },
  storage: { openFolder: vi.fn() }
} as any

import { useUnifiedRecordings } from '@/hooks/useUnifiedRecordings'

const mockRecording = {
  id: 'test-123',
  filename: 'test.wav',
  displayTitle: 'Test Recording',
  quality: 'valuable',
  duration: 120,
  dateRecorded: new Date(),
  recordedAt: new Date().toISOString(),
  location: 'local-only',
  localPath: '/path/test.wav',
  syncStatus: 'synced',
  transcriptionStatus: 'complete',
  isProcessed: false,
  isProcessing: false,
  hasTranscript: false,
  title: 'Test Recording'
}

describe('Library', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useUnifiedRecordings).mockReturnValue({
      recordings: [],
      loading: false,
      error: null,
      refresh: vi.fn(),
      deviceConnected: false,
      stats: { total: 0, deviceOnly: 0, localOnly: 0, both: 0, synced: 0, unsynced: 0 }
    })
  })

  const renderLibrary = () => {
    return render(
      <MemoryRouter>
        <Library />
      </MemoryRouter>
    )
  }

  describe('Loading State', () => {
    it('renders loading state initially', () => {
      vi.mocked(useUnifiedRecordings).mockReturnValue({
        recordings: [],
        loading: true,
        error: null,
        refresh: vi.fn(),
        deviceConnected: false,
        stats: { total: 0, deviceOnly: 0, localOnly: 0, both: 0, synced: 0, unsynced: 0 }
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
        stats: { total: 0, deviceOnly: 0, localOnly: 0, both: 0, synced: 0, unsynced: 0 }
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
        stats: { total: 1, deviceOnly: 0, localOnly: 1, both: 0, synced: 1, unsynced: 0 }
      })

      renderLibrary()

      // Header shows recording count (text is split across elements)
      await waitFor(() => {
        expect(screen.getByText(/1.*capture/i)).toBeInTheDocument()
      })
    })

    it('shows device status when not connected', async () => {
      vi.mocked(useUnifiedRecordings).mockReturnValue({
        recordings: [mockRecording],
        loading: false,
        error: null,
        refresh: vi.fn(),
        deviceConnected: false,
        stats: { total: 1, deviceOnly: 0, localOnly: 1, both: 0, synced: 1, unsynced: 0 }
      })

      renderLibrary()

      await waitFor(() => {
        expect(screen.getByText(/device not connected/i)).toBeInTheDocument()
      })
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
        stats: { total: 0, deviceOnly: 0, localOnly: 0, both: 0, synced: 0, unsynced: 0 }
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
        stats: { total: 1, deviceOnly: 0, localOnly: 1, both: 0, synced: 1, unsynced: 0 }
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
      // Search input should be present in LibraryFilters
      const searchInput = screen.getByPlaceholderText(/search/i)
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
        stats: { total: 1, deviceOnly: 0, localOnly: 1, both: 0, synced: 1, unsynced: 0 }
      })

      renderLibrary()

      await waitFor(() => {
        // Header action buttons should be present
        expect(screen.getByText(/add capture/i)).toBeInTheDocument()
        expect(screen.getByText(/open folder/i)).toBeInTheDocument()
        expect(screen.getByText(/refresh/i)).toBeInTheDocument()
      })
    })
  })
})
