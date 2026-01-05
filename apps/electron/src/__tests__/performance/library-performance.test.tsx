import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { Library } from '@/pages/Library'
import { generateMockRecordings } from './mockData'

// Mock localStorage for Zustand persist
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  length: 0,
  key: vi.fn()
}
Object.defineProperty(window, 'localStorage', { value: localStorageMock })

// Mock hooks
vi.mock('@/hooks/useUnifiedRecordings', () => ({
  useUnifiedRecordings: vi.fn()
}))

vi.mock('@/store/useUIStore', () => ({
  useUIStore: vi.fn((selector) => {
    const state = {
      currentlyPlayingId: null,
      setCurrentlyPlayingId: vi.fn(),
      recordingsCompactView: false, // Card view for performance testing
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

vi.mock('@/store/useLibraryStore', () => ({
  useLibraryStore: vi.fn((selector) => {
    const state = {
      viewMode: 'card',
      sortBy: 'date',
      sortOrder: 'desc',
      locationFilter: 'all',
      categoryFilter: null,
      qualityFilter: null,
      statusFilter: null,
      searchQuery: '',
      selectedIds: new Set(),
      recordingErrors: new Map(),
      scrollOffset: 0,
      setViewMode: vi.fn(),
      toggleViewMode: vi.fn(),
      setSortBy: vi.fn(),
      setSortOrder: vi.fn(),
      toggleSortOrder: vi.fn(),
      setLocationFilter: vi.fn(),
      setCategoryFilter: vi.fn(),
      setQualityFilter: vi.fn(),
      setStatusFilter: vi.fn(),
      setSearchQuery: vi.fn(),
      toggleSelection: vi.fn(),
      selectAll: vi.fn(),
      clearSelection: vi.fn(),
      setScrollOffset: vi.fn(),
      setRecordingError: vi.fn(),
      clearRecordingError: vi.fn()
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

vi.mock('@/features/library/hooks', () => ({
  useSourceSelection: vi.fn(() => ({
    selectedIds: new Set(),
    selectedCount: 0,
    toggleSelection: vi.fn(),
    selectAll: vi.fn(),
    clearSelection: vi.fn(),
    isSelected: vi.fn(() => false),
    handleSelectionClick: vi.fn()
  })),
  useKeyboardNavigation: vi.fn(() => ({
    handleKeyDown: vi.fn()
  })),
  useTransitionFilters: vi.fn(() => ({
    locationFilter: 'all',
    categoryFilter: null,
    qualityFilter: null,
    statusFilter: null,
    searchQuery: '',
    setLocationFilter: vi.fn(),
    setCategoryFilter: vi.fn(),
    setQualityFilter: vi.fn(),
    setStatusFilter: vi.fn(),
    setSearchQuery: vi.fn(),
    isPending: false
  }))
}))

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () => Array.from({ length: Math.min(count, 50) }, (_, index) => ({
      index,
      size: 200,
      start: index * 200,
      key: String(index),
      measureElement: vi.fn()
    })),
    getTotalSize: () => count * 200,
    scrollToIndex: vi.fn(),
    measureElement: vi.fn()
  })
}))

// Mock electronAPI
global.window.electronAPI = {
  transcripts: { getByRecordingIds: vi.fn().mockResolvedValue({}) },
  meetings: { getByIds: vi.fn().mockResolvedValue({}) },
  storage: { openFolder: vi.fn() },
  recordings: {
    addExternal: vi.fn(),
    delete: vi.fn(),
    updateStatus: vi.fn()
  },
  downloadService: {
    queueDownloads: vi.fn()
  }
} as any

import { useUnifiedRecordings } from '@/hooks/useUnifiedRecordings'

describe('Library Performance', () => {
  const testCases = [100, 1000, 5000]

  beforeEach(() => {
    vi.clearAllMocks()
  })

  const renderLibrary = () => {
    return render(
      <MemoryRouter>
        <Library />
      </MemoryRouter>
    )
  }

  testCases.forEach(count => {
    it(`renders ${count} items within performance budget`, async () => {
      const recordings = generateMockRecordings(count)

      // Mock the hook to return our test data
      vi.mocked(useUnifiedRecordings).mockReturnValue({
        recordings,
        loading: false,
        error: null,
        refresh: vi.fn(),
        deviceConnected: false,
        stats: {
          total: recordings.length,
          deviceOnly: Math.floor(recordings.length / 3),
          localOnly: Math.floor(recordings.length / 3),
          both: Math.floor(recordings.length / 3),
          synced: recordings.length - Math.floor(recordings.length / 3),
          unsynced: Math.floor(recordings.length / 3)
        }
      })

      const start = performance.now()
      renderLibrary()

      await waitFor(() => {
        expect(screen.getByTestId('library-list')).toBeInTheDocument()
      })

      const end = performance.now()
      const renderTime = end - start

      console.log(`Render time for ${count} items: ${renderTime.toFixed(2)}ms`)

      // Phase 6 target: <100ms for 1000 items
      // Using generous baselines for initial measurement
      if (count <= 100) {
        expect(renderTime).toBeLessThan(200) // Generous baseline (includes setup overhead)
      } else if (count <= 1000) {
        expect(renderTime).toBeLessThan(200) // Generous baseline
      } else if (count <= 5000) {
        expect(renderTime).toBeLessThan(500) // Generous baseline for large sets
      }
    })
  })

  // NOTE: Scroll FPS tests have limitations in jsdom
  // jsdom doesn't trigger real browser rendering, so FPS measurements are synthetic
  // For accurate scroll performance testing, use Playwright with real browser
  it('measures scroll interaction timing (jsdom - limited)', async () => {
    const recordings = generateMockRecordings(5000)

    vi.mocked(useUnifiedRecordings).mockReturnValue({
      recordings,
      loading: false,
      error: null,
      refresh: vi.fn(),
      deviceConnected: false,
      stats: {
        total: recordings.length,
        deviceOnly: Math.floor(recordings.length / 3),
        localOnly: Math.floor(recordings.length / 3),
        both: Math.floor(recordings.length / 3),
        synced: recordings.length - Math.floor(recordings.length / 3),
        unsynced: Math.floor(recordings.length / 3)
      }
    })

    renderLibrary()

    const list = screen.getByTestId('library-list')

    // Measure frame rate during scroll simulation
    // NOTE: This is NOT real FPS - jsdom doesn't render pixels
    // Use Playwright for real browser scroll testing
    const frames: number[] = []
    let lastTime = performance.now()

    const measureFrame = () => {
      const now = performance.now()
      const fps = 1000 / (now - lastTime)
      frames.push(fps)
      lastTime = now
    }

    // Simulate scroll events
    for (let i = 0; i < 100; i++) {
      list.scrollTop += 50
      fireEvent.scroll(list)
      await new Promise(r => requestAnimationFrame(r))
      measureFrame()
    }

    const avgFps = frames.reduce((a, b) => a + b, 0) / frames.length
    console.log(`Average simulated scroll FPS: ${avgFps.toFixed(2)} (jsdom - not real rendering)`)

    // This test provides timing data but not real FPS
    // For production, implement Playwright scroll tests
  })

  it('applies filters within performance budget', async () => {
    const recordings = generateMockRecordings(1000)

    vi.mocked(useUnifiedRecordings).mockReturnValue({
      recordings,
      loading: false,
      error: null,
      refresh: vi.fn(),
      deviceConnected: false,
      stats: {
        total: recordings.length,
        deviceOnly: Math.floor(recordings.length / 3),
        localOnly: Math.floor(recordings.length / 3),
        both: Math.floor(recordings.length / 3),
        synced: recordings.length - Math.floor(recordings.length / 3),
        unsynced: Math.floor(recordings.length / 3)
      }
    })

    renderLibrary()

    const start = performance.now()

    // Trigger filter change
    const filterButton = screen.getByTestId('location-filter')
    const deviceButton = filterButton.querySelector('button:nth-child(2)')
    expect(deviceButton).toBeTruthy()

    fireEvent.click(deviceButton!)

    await waitFor(() => {
      // After filter change, the library list should still be present
      expect(screen.getByTestId('library-list')).toBeInTheDocument()
    })

    const end = performance.now()
    const filterTime = end - start

    console.log(`Filter application time: ${filterTime.toFixed(2)}ms`)

    // Should feel instant (<50ms target, using generous baseline)
    expect(filterTime).toBeLessThan(100)
  })

  it('switches view modes within performance budget', async () => {
    const recordings = generateMockRecordings(1000)

    vi.mocked(useUnifiedRecordings).mockReturnValue({
      recordings,
      loading: false,
      error: null,
      refresh: vi.fn(),
      deviceConnected: false,
      stats: {
        total: recordings.length,
        deviceOnly: Math.floor(recordings.length / 3),
        localOnly: Math.floor(recordings.length / 3),
        both: Math.floor(recordings.length / 3),
        synced: recordings.length - Math.floor(recordings.length / 3),
        unsynced: Math.floor(recordings.length / 3)
      }
    })

    renderLibrary()

    const start = performance.now()

    const gridViewToggle = screen.getByTestId('grid-view-toggle')
    const listViewButton = gridViewToggle.querySelector('button:nth-child(2)')
    expect(listViewButton).toBeTruthy()

    fireEvent.click(listViewButton!)

    await waitFor(() => {
      // After view mode switch, the library list should still be present
      expect(screen.getByTestId('library-list')).toBeInTheDocument()
    })

    const end = performance.now()
    const switchTime = end - start

    console.log(`View switch time: ${switchTime.toFixed(2)}ms`)

    // Should be fast
    expect(switchTime).toBeLessThan(100)
  })
})
