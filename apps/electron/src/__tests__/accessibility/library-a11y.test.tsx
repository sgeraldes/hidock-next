import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render } from '@testing-library/react'
import { axe, toHaveNoViolations } from 'jest-axe'
import { MemoryRouter } from 'react-router-dom'
import { Library } from '@/pages/Library'

// Extend Vitest's expect with jest-axe matchers
expect.extend(toHaveNoViolations)

// Mock dependencies
vi.mock('@/hooks/useUnifiedRecordings', () => ({
  useUnifiedRecordings: () => ({
    recordings: [],
    loading: false,
    error: null,
    refresh: vi.fn(),
    deviceConnected: false,
    stats: {
      total: 0,
      deviceOnly: 0,
      localOnly: 0,
      synced: 0,
      transcribed: 0,
      untranscribed: 0
    }
  })
}))

vi.mock('@/components/OperationController', () => ({
  useAudioControls: () => ({
    play: vi.fn(),
    stop: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn()
  })
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
  useAppStore: () => ({
    downloadQueue: new Map(),
    isDownloading: vi.fn(() => false)
  })
}))

vi.mock('@/store/useLibraryStore', () => ({
  useLibraryStore: (selector: any) => {
    const state = {
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
      recordingErrors: new Map()
    }
    return selector(state)
  }
}))

describe('Library Accessibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should have no accessibility violations in list view (compact mode)', async () => {
    const { container } = render(
      <MemoryRouter>
        <Library />
      </MemoryRouter>
    )

    const results = await axe(container, {
      rules: {
        // WCAG 2.1 AA criteria
        'color-contrast': { enabled: true }, // 1.4.3 Contrast (Minimum)
        'focus-visible': { enabled: true }, // 2.4.7 Focus Visible
        'heading-order': { enabled: true }, // 1.3.1 Info and Relationships
        'landmark-one-main': { enabled: true },
        'page-has-heading-one': { enabled: true },
        'region': { enabled: true }
      }
    })

    expect(results).toHaveNoViolations()
  })

  it('should have no accessibility violations in grid view (card mode)', async () => {
    // Set grid view by mocking the store to return false for compactView
    vi.mocked(vi.importMock('@/store/useUIStore')).mockImplementation((selector: any) => {
      const state = {
        currentlyPlayingId: null,
        recordingsCompactView: false, // Grid view
        setRecordingsCompactView: vi.fn()
      }
      return selector(state)
    })

    const { container } = render(
      <MemoryRouter>
        <Library />
      </MemoryRouter>
    )

    const results = await axe(container, {
      rules: {
        'color-contrast': { enabled: true },
        'focus-visible': { enabled: true },
        'heading-order': { enabled: true }
      }
    })

    expect(results).toHaveNoViolations()
  })

  it('should have proper ARIA attributes on library container', async () => {
    const { container } = render(
      <MemoryRouter>
        <Library />
      </MemoryRouter>
    )

    // Check for listbox role
    const listbox = container.querySelector('[role="listbox"]')
    expect(listbox).toBeTruthy()
    expect(listbox?.getAttribute('aria-label')).toBe('Knowledge Library')
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
        'aria-required-attr': { enabled: true },
        'aria-valid-attr': { enabled: true }
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

  it('should have proper heading hierarchy', async () => {
    const { container } = render(
      <MemoryRouter>
        <Library />
      </MemoryRouter>
    )

    const results = await axe(container, {
      rules: {
        'heading-order': { enabled: true },
        'page-has-heading-one': { enabled: true }
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
        'color-contrast': { enabled: true } // WCAG 2.1 AA 1.4.3
      }
    })

    expect(results).toHaveNoViolations()
  })

  it('should have visible focus indicators', async () => {
    const { container } = render(
      <MemoryRouter>
        <Library />
      </MemoryRouter>
    )

    const results = await axe(container, {
      rules: {
        'focus-visible': { enabled: true } // WCAG 2.1 AA 2.4.7
      }
    })

    expect(results).toHaveNoViolations()
  })
})
