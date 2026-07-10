import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ActivityLogPanel } from '../ActivityLogPanel'
import { useAppStore, useActivityLog } from '@/store/useAppStore'
import type { ActivityLogEntry } from '@/services/hidock-device'

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

describe('ActivityLogPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing when the log is empty (no sidebar clutter)', () => {
    setupLog([])
    const { container } = render(<ActivityLogPanel sidebarOpen={true} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows a compact "Activity Log (N)" badge in the expanded sidebar, not an inline list', () => {
    setupLog([entry({ message: 'First' }), entry({ message: 'Second' })])
    render(<ActivityLogPanel sidebarOpen={true} />)

    // Badge present with the count…
    const badge = screen.getByRole('button', { name: 'Open activity log' })
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveTextContent('2')

    // …but the full log list is NOT inline (overlay is closed by default).
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText('First')).not.toBeInTheDocument()
  })

  it('opens the full log in an overlay surface when the badge is clicked', () => {
    setupLog([entry({ message: 'Device connected', type: 'success' })])
    render(<ActivityLogPanel sidebarOpen={true} />)

    fireEvent.click(screen.getByRole('button', { name: 'Open activity log' }))

    const dialog = screen.getByRole('dialog', { name: 'Activity log' })
    expect(dialog).toBeInTheDocument()
    expect(screen.getByText('Device connected')).toBeInTheDocument()
  })

  it('clears the log from the overlay', () => {
    setupLog([entry({ message: 'Boom', type: 'error' })])
    render(<ActivityLogPanel sidebarOpen={true} />)

    fireEvent.click(screen.getByRole('button', { name: 'Open activity log' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear activity log' }))
    expect(mockClear).toHaveBeenCalled()
  })

  it('collapses to a tiny icon+count badge in the collapsed sidebar', () => {
    setupLog([entry(), entry(), entry()])
    render(<ActivityLogPanel sidebarOpen={false} />)

    const badge = screen.getByRole('button', { name: /Activity log: 3 entries/ })
    expect(badge).toBeInTheDocument()
  })
})
