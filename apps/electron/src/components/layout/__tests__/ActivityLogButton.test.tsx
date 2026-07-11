/**
 * Tests for the titlebar Activity Log button — it is the SINGLE host of the
 * activity-log overlay, driven by the shared `activityLogExpanded` UI-store flag
 * (the same flag the sidebar ActivityLogPanel now toggles), so opening from
 * either place is consistent.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { ActivityLogButton } from '../ActivityLogButton'
import { useAppStore, useActivityLog } from '@/store/useAppStore'
import type { ActivityLogEntry } from '@/services/hidock-device'

// Real useUIStore is used (so the open-state wiring is exercised end-to-end); we
// only mock the activity-log data source.
vi.mock('@/store/useAppStore', () => ({
  useAppStore: vi.fn(),
  useActivityLog: vi.fn()
}))

const mockClear = vi.fn()

function entry(partial: Partial<ActivityLogEntry> = {}): ActivityLogEntry {
  return {
    timestamp: new Date('2026-07-10T12:34:56Z'),
    type: 'info',
    message: 'Something happened',
    ...partial
  }
}

function setupLog(entries: ActivityLogEntry[]) {
  vi.mocked(useActivityLog).mockReturnValue(entries)
  vi.mocked(useAppStore).mockImplementation((selector: any) => {
    const state = { clearActivityLog: mockClear }
    return typeof selector === 'function' ? selector(state) : state
  })
}

describe('ActivityLogButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the count badge and starts with the overlay closed', () => {
    setupLog([entry(), entry()])
    render(<ActivityLogButton />)

    expect(screen.getByRole('button', { name: /activity log: 2 entries/i })).toHaveTextContent('2')
    // Overlay closed on mount (the flag is persisted but reset on mount).
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opens the overlay with the log entries when clicked', () => {
    setupLog([entry({ message: 'Device connected', type: 'success' })])
    render(<ActivityLogButton />)

    fireEvent.click(screen.getByRole('button', { name: /activity log/i }))
    expect(screen.getByRole('dialog', { name: 'Activity log' })).toBeInTheDocument()
    expect(screen.getByText('Device connected')).toBeInTheDocument()
  })

  it('clears the log from the overlay', () => {
    setupLog([entry({ message: 'Boom', type: 'error' })])
    render(<ActivityLogButton />)

    fireEvent.click(screen.getByRole('button', { name: /activity log/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear activity log' }))
    expect(mockClear).toHaveBeenCalled()
  })

  it('a NEW log entry updates the count but does NOT force the overlay open', () => {
    // Regression: during e.g. a calendar sync, an added "Syncing calendar…" entry
    // must only bump the badge — it must never auto-open the overlay. Only an
    // explicit click opens it.
    setupLog([entry({ message: 'First' })])
    const { rerender } = render(<ActivityLogButton />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    // A new entry arrives (log grows) → re-render with more entries.
    act(() => {
      setupLog([entry({ message: 'First' }), entry({ message: 'Syncing calendar…' })])
    })
    rerender(<ActivityLogButton />)

    // Count reflects the new entry, but the overlay stays closed.
    expect(screen.getByRole('button', { name: /activity log: 2 entries/i })).toHaveTextContent('2')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('still opens (with an empty state) when there are no entries', () => {
    setupLog([])
    render(<ActivityLogButton />)

    // No numeric badge, but the trigger is present and opens the overlay.
    fireEvent.click(screen.getByRole('button', { name: 'Activity log' }))
    expect(screen.getByRole('dialog', { name: 'Activity log' })).toBeInTheDocument()
    expect(screen.getByText('No activity.')).toBeInTheDocument()
  })
})
