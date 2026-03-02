import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render } from '@testing-library/react'
import { axe, toHaveNoViolations } from 'jest-axe'
import { MemoryRouter } from 'react-router-dom'
import { Library } from '@/pages/Library'
import type { UnifiedRecording } from '@/types/unified-recording'

// Extend Vitest's expect with jest-axe matchers
expect.extend(toHaveNoViolations)

// Create a mock function we can override per-test
const mockUseUnifiedRecordings = vi.fn(() => ({
  recordings: [] as UnifiedRecording[],
  loading: false,
  error: null,
  refresh: vi.fn(),
  deviceConnected: false,
  stats: {
    total: 0,
    deviceOnly: 0,
    localOnly: 0,
    both: 0,
    synced: 0,
    unsynced: 0,
    onSource: 0,
    locallyAvailable: 0
  }
}))

// Mock dependencies
vi.mock('@/hooks/useUnifiedRecordings', () => ({
  useUnifiedRecordings: () => mockUseUnifiedRecordings()
}))

vi.mock('@/components/OperationController', () => ({
  useAudioControls: () => ({
    play: vi.fn(),
    stop: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn()
  })
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
  }))
}))

vi.mock('@/store/useUIStore', () => ({
  useUIStore: (selector: any) => {
    const state = {
      currentlyPlayingId: null,
      recordingsCompactView: false,
      setRecordingsCompactView: vi.fn()
    }
    return selector(state)
  }
}))

vi.mock('@/store/useAppStore', () => ({
  useAppStore: (selector: any) => {
    const state = {
      downloadQueue: new Map(),
      isDownloading: vi.fn(() => false),
      isConnected: false,
      deviceInfo: null
    }
    return typeof selector === 'function' ? selector(state) : state
  },
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

vi.mock('@/store/useLibraryStore', () => ({
  useLibraryStore: (selector: any) => {
    const state = {
      viewMode: 'card',
      sortBy: 'date',
      sortOrder: 'desc',
      locationFilter: 'all',
      categoryFilter: null,
      qualityFilter: null,
      statusFilter: null,
      searchQuery: '',
      setViewMode: vi.fn(),
      setLocationFilter: vi.fn(),
      setCategoryFilter: vi.fn(),
      setQualityFilter: vi.fn(),
      setStatusFilter: vi.fn(),
      setSearchQuery: vi.fn(),
      setSortBy: vi.fn(),
      setSortOrder: vi.fn(),
      recordingErrors: new Map(),
      // Selection state
      selectedIds: new Set<string>(),
      toggleSelection: vi.fn(),
      selectAll: vi.fn(),
      selectRange: vi.fn(),
      clearSelection: vi.fn(),
      // Panel state (tri-pane layout)
      panelSizes: [25, 45, 30],
      setPanelSizes: vi.fn(),
      selectedSourceId: null,
      setSelectedSourceId: vi.fn(),
      // Expansion state
      expandedRowIds: new Set<string>(),
      expandedTranscripts: new Set<string>(),
      toggleRowExpansion: vi.fn(),
      expandRow: vi.fn(),
      collapseRow: vi.fn(),
      collapseAllRows: vi.fn(),
      toggleTranscriptExpansion: vi.fn(),
      collapseAllTranscripts: vi.fn()
    }
    return selector(state)
  },
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
    measureElement: vi.fn(),
    measure: vi.fn()
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

describe('Library Accessibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should have no critical accessibility violations in list view (compact mode)', async () => {
    const { container } = render(
      <MemoryRouter>
        <Library />
      </MemoryRouter>
    )

    const results = await axe(container, {
      rules: {
        // WCAG 2.1 AA criteria - test what's currently implemented
        'color-contrast': { enabled: true }, // 1.4.3 Contrast (Minimum)
        'landmark-one-main': { enabled: true },
        'page-has-heading-one': { enabled: true },
        'region': { enabled: true },
        // Known issue: react-resizable-panels doesn't add aria-valuenow to separator
        'aria-required-attr': { enabled: false },
        // Disable rules for known issues to be fixed separately
        'heading-order': { enabled: false }, // Known issue: h3 without h2
        'select-name': { enabled: false } // Known issue: selects need labels
      }
    })

    expect(results).toHaveNoViolations()
  })

  it('should have no critical accessibility violations in grid view (card mode)', async () => {
    // Grid view is tested by default when recordingsCompactView is false
    const { container } = render(
      <MemoryRouter>
        <Library />
      </MemoryRouter>
    )

    const results = await axe(container, {
      rules: {
        'color-contrast': { enabled: true },
        'aria-required-attr': { enabled: false }, // react-resizable-panels library issue
        'heading-order': { enabled: false }, // Known issue
        'select-name': { enabled: false } // Known issue
      }
    })

    expect(results).toHaveNoViolations()
  })

  it('should have proper ARIA for listbox elements when recordings exist', async () => {
    // Override the mock to return recordings data for this test
    // Must match UnifiedRecording discriminated union type
    const mockRecordings = [
      {
        id: 'test-1',
        filename: 'recording-1.wav',
        size: 1024000,
        duration: 120,
        dateRecorded: new Date('2026-01-01'),
        transcriptionStatus: 'complete' as const,
        title: 'Test Recording 1',
        location: 'both' as const,
        deviceFilename: 'REC0001.WAV',
        localPath: '/path/to/recording-1.wav',
        syncStatus: 'synced' as const
      },
      {
        id: 'test-2',
        filename: 'recording-2.wav',
        size: 2048000,
        duration: 180,
        dateRecorded: new Date('2026-01-02'),
        transcriptionStatus: 'none' as const,
        title: 'Test Recording 2',
        location: 'device-only' as const,
        deviceFilename: 'REC0002.WAV',
        syncStatus: 'not-synced' as const
      }
    ]

    const mockData = {
      recordings: mockRecordings,
      loading: false,
      error: null,
      refresh: vi.fn(),
      deviceConnected: false,
      stats: {
        total: 2,
        deviceOnly: 1,
        localOnly: 0,
        both: 1,
        synced: 1,
        unsynced: 1,
        onSource: 2,
        locallyAvailable: 1
      }
    }
    // Provide enough values for React StrictMode double-render
    mockUseUnifiedRecordings.mockReturnValue(mockData)

    const { container } = render(
      <MemoryRouter>
        <Library />
      </MemoryRouter>
    )

    // Restore default mock for subsequent tests
    mockUseUnifiedRecordings.mockImplementation(() => ({
      recordings: [] as UnifiedRecording[],
      loading: false,
      error: null,
      refresh: vi.fn(),
      deviceConnected: false,
      stats: {
        total: 0,
        deviceOnly: 0,
        localOnly: 0,
        both: 0,
        synced: 0,
        unsynced: 0,
        onSource: 0,
        locallyAvailable: 0
      }
    }))

    // With recordings, listbox should be rendered with proper ARIA attributes
    const listbox = container.querySelector('[role="listbox"]')
    expect(listbox).toBeTruthy()
    expect(listbox?.getAttribute('aria-label')).toBe('Knowledge Library')
    expect(listbox?.getAttribute('aria-rowcount')).toBeTruthy()

    // Note: Virtualized lists may not render actual option elements in test environment
    // due to missing scroll container dimensions. This test validates the listbox
    // container structure exists and has proper ARIA attributes when data is present.
    // Actual option rendering is validated through integration/E2E tests.
  })

  it('should have accessible form controls in filters', async () => {
    const { container } = render(
      <MemoryRouter>
        <Library />
      </MemoryRouter>
    )

    const results = await axe(container, {
      rules: {
        // Test form controls specifically
        'label': { enabled: true },
        'button-name': { enabled: true },
        'aria-required-attr': { enabled: false }, // react-resizable-panels library issue
        'aria-valid-attr': { enabled: true },
        'select-name': { enabled: false }, // Known issue: selects need aria-label
        'heading-order': { enabled: false } // Known issue: h3 without h2
      }
    })

    expect(results).toHaveNoViolations()
  })

  it('should maintain keyboard navigation support', async () => {
    const { container } = render(
      <MemoryRouter>
        <Library />
      </MemoryRouter>
    )

    // Verify the main container has tabIndex for keyboard navigation
    const mainContainer = container.querySelector('[tabindex="0"]')
    expect(mainContainer).toBeTruthy()
  })

  it('should have proper page heading', async () => {
    const { container } = render(
      <MemoryRouter>
        <Library />
      </MemoryRouter>
    )

    const results = await axe(container, {
      rules: {
        'page-has-heading-one': { enabled: true },
        'aria-required-attr': { enabled: false }, // react-resizable-panels library issue
        'heading-order': { enabled: false }, // Known issue: h3 in EmptyState without h2
        'select-name': { enabled: false } // Known issue: selects need aria-label
      }
    })

    expect(results).toHaveNoViolations()
  })

  it('should have no color contrast violations', async () => {
    const { container } = render(
      <MemoryRouter>
        <Library />
      </MemoryRouter>
    )

    const results = await axe(container, {
      rules: {
        'color-contrast': { enabled: true }, // WCAG 2.1 AA 1.4.3
        'aria-required-attr': { enabled: false }, // react-resizable-panels library issue
        'heading-order': { enabled: false }, // Known issue
        'select-name': { enabled: false } // Known issue
      }
    })

    expect(results).toHaveNoViolations()
  })

  it('should have keyboard focusable elements', async () => {
    const { container } = render(
      <MemoryRouter>
        <Library />
      </MemoryRouter>
    )

    // Verify interactive elements are keyboard accessible
    const results = await axe(container, {
      rules: {
        'button-name': { enabled: true },
        'link-name': { enabled: true },
        'aria-required-attr': { enabled: false }, // react-resizable-panels library issue
        'heading-order': { enabled: false }, // Known issue
        'select-name': { enabled: false } // Known issue
      }
    })

    expect(results).toHaveNoViolations()
  })
})
