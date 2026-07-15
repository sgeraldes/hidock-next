/**
 * Tests for the titlebar 🔔 NotificationsButton popover — lists live operations
 * (transcriptions + downloads), shows an empty state, and routes "View all" to
 * the shared Operations overlay (the same source the sidebar badge uses).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { NotificationsButton } from '../NotificationsButton'
import { useDownloadQueue } from '@/store/useAppStore'
import { useTranscriptionStats, useTranscriptionStore } from '@/store/features/useTranscriptionStore'
import { useUIStore } from '@/store/ui/useUIStore'

// Radix Popover positioning uses ResizeObserver, which jsdom lacks.
class RO {
  observe() {
    /* no-op */
  }
  unobserve() {
    /* no-op */
  }
  disconnect() {
    /* no-op */
  }
}
;(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver =
  (globalThis as unknown as { ResizeObserver?: typeof RO }).ResizeObserver ?? RO

vi.mock('@/store/useAppStore', () => ({ useDownloadQueue: vi.fn() }))
vi.mock('@/store/features/useTranscriptionStore', () => ({
  useTranscriptionStats: vi.fn(),
  useTranscriptionStore: vi.fn()
}))
vi.mock('@/store/ui/useUIStore', () => ({ useUIStore: vi.fn() }))

const mockCancelDownload = vi.fn()
const mockCancelAllDownloads = vi.fn()
vi.mock('@/hooks/useOperations', () => ({
  useOperations: () => ({ cancelDownload: mockCancelDownload, cancelAllDownloads: mockCancelAllDownloads })
}))

const mockOpenOverlay = vi.fn()

function setup({
  downloads = new Map(),
  queue = new Map(),
  stats = { total: 0, completed: 0, failed: 0, processing: 0, pending: 0, aggregateProgress: 0 }
}: {
  downloads?: Map<string, { filename: string; progress: number; size: number; status?: string }>
  queue?: Map<string, any>
  stats?: { total: number; completed: number; failed: number; processing: number; pending: number; aggregateProgress: number }
} = {}) {
  vi.mocked(useDownloadQueue).mockReturnValue(downloads as any)
  vi.mocked(useTranscriptionStats).mockReturnValue(stats as any)
  vi.mocked(useTranscriptionStore).mockImplementation((selector: any) => selector({ queue }))
  vi.mocked(useUIStore).mockImplementation((selector: any) => selector({ openOperationsOverlay: mockOpenOverlay }))
}

function txItem(over: Record<string, any> = {}) {
  return {
    id: 't1',
    recordingId: 'r1',
    filename: '2026-07-10-standup.wav',
    status: 'processing',
    progress: 40,
    retryCount: 0,
    attempts: 1,
    priority: 0,
    ...over
  }
}

describe('NotificationsButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows an empty state when there is no activity', () => {
    setup()
    render(<NotificationsButton />)

    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }))
    expect(screen.getByText('No recent activity')).toBeInTheDocument()
  })

  it('lists in-flight transcriptions and active downloads', () => {
    setup({
      queue: new Map([['t1', txItem()]]),
      downloads: new Map([['d1', { filename: '2026-07-10-notes.wav', progress: 42, size: 1000 }]]),
      stats: { total: 1, completed: 0, failed: 0, processing: 1, pending: 0, aggregateProgress: 40 }
    })
    render(<NotificationsButton />)

    // Badge reflects the active count (1 transcription + 1 download).
    const trigger = screen.getByRole('button', { name: /Notifications: 2 operations in progress/i })
    fireEvent.click(trigger)

    expect(screen.getByText('2026-07-10-standup')).toBeInTheDocument()
    expect(screen.getByText('Transcribing…')).toBeInTheDocument()
    expect(screen.getByText('2026-07-10-notes')).toBeInTheDocument()
    expect(screen.getByText(/Downloading… 42%/)).toBeInTheDocument()
  })

  it('routes "View all" to the shared Operations overlay', () => {
    setup({
      queue: new Map([['t1', txItem({ status: 'failed', error: 'nope' })]]),
      stats: { total: 1, completed: 0, failed: 1, processing: 0, pending: 0, aggregateProgress: 0 }
    })
    render(<NotificationsButton />)

    fireEvent.click(screen.getByRole('button', { name: /Notifications/i }))
    fireEvent.click(screen.getByRole('button', { name: /view all in operations/i }))
    expect(mockOpenOverlay).toHaveBeenCalledTimes(1)
  })

  it('offers a per-download Cancel that calls cancelDownload(filename)', () => {
    setup({
      downloads: new Map([['d1', { filename: '2026-07-10-notes.wav', progress: 42, size: 1000, status: 'downloading' }]])
    })
    render(<NotificationsButton />)

    fireEvent.click(screen.getByRole('button', { name: /Notifications/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel download 2026-07-10-notes' }))
    expect(mockCancelDownload).toHaveBeenCalledWith('2026-07-10-notes.wav')
  })

  it('shows a "Cancelling…" row with the cancel control disabled while awaiting settlement', () => {
    setup({
      downloads: new Map([['d1', { filename: 'x.wav', progress: 80, size: 1000, status: 'cancelling' }]])
    })
    render(<NotificationsButton />)

    fireEvent.click(screen.getByRole('button', { name: /Notifications/i }))
    expect(screen.getByText('Cancelling…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel download x' })).toBeDisabled()
  })

  it('offers a Cancel-all downloads control wired to cancelAllDownloads', () => {
    setup({
      downloads: new Map([
        ['d1', { filename: 'a.wav', progress: 10, size: 1000, status: 'downloading' }],
        ['d2', { filename: 'b.wav', progress: 0, size: 1000, status: 'pending' }]
      ])
    })
    render(<NotificationsButton />)

    fireEvent.click(screen.getByRole('button', { name: /Notifications/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel all downloads' }))
    expect(mockCancelAllDownloads).toHaveBeenCalledTimes(1)
  })
})
