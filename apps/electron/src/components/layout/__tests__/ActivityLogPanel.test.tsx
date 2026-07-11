import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ActivityLogPanel } from '../ActivityLogPanel'
import { useActivityLog } from '@/store/useAppStore'
import { useUIStore } from '@/store/ui/useUIStore'
import type { ActivityLogEntry } from '@/services/hidock-device'

vi.mock('@/store/useAppStore', () => ({
  useAppStore: vi.fn(),
  useActivityLog: vi.fn()
}))

vi.mock('@/store/ui/useUIStore', () => ({
  useUIStore: vi.fn()
}))

const mockSetExpanded = vi.fn()

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
  // The panel only reads setActivityLogExpanded from the UI store now.
  vi.mocked(useUIStore).mockImplementation((selector: any) => {
    const state = { setActivityLogExpanded: mockSetExpanded, activityLogExpanded: false }
    return typeof selector === 'function' ? selector(state) : state
  })
}

describe('ActivityLogPanel (pure trigger for the shared overlay)', () => {
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

    const badge = screen.getByRole('button', { name: 'Open activity log' })
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveTextContent('2')

    // The panel itself never renders the overlay/list — that lives in the titlebar.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText('First')).not.toBeInTheDocument()
  })

  it('opens the shared overlay (sets activityLogExpanded) when the badge is clicked', () => {
    setupLog([entry({ message: 'Device connected', type: 'success' })])
    render(<ActivityLogPanel sidebarOpen={true} />)

    fireEvent.click(screen.getByRole('button', { name: 'Open activity log' }))
    expect(mockSetExpanded).toHaveBeenCalledWith(true)
  })

  it('collapses to a tiny icon+count badge that also opens the shared overlay', () => {
    setupLog([entry(), entry(), entry()])
    render(<ActivityLogPanel sidebarOpen={false} />)

    const badge = screen.getByRole('button', { name: /Activity log: 3 entries/ })
    expect(badge).toBeInTheDocument()
    fireEvent.click(badge)
    expect(mockSetExpanded).toHaveBeenCalledWith(true)
  })
})
