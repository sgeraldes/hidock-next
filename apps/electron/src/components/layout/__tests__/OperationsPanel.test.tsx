import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { OperationsPanel } from '../OperationsPanel'

// Mock stores
import { useAppStore, useDownloadQueue, useUnifiedRecordings } from '@/store/useAppStore'
import { useTranscriptionStore, useTranscriptionStats, useTranscriptionPaused } from '@/store/features/useTranscriptionStore'
import { useUIStore } from '@/store/ui/useUIStore'

// Spy on navigation without needing a Router.
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => mockNavigate
}))

vi.mock('@/store/useAppStore', () => ({
  useAppStore: vi.fn(),
  useDownloadQueue: vi.fn().mockReturnValue(new Map()),
  useDeviceSyncProgress: vi.fn().mockReturnValue(null),
  useDeviceSyncEta: vi.fn().mockReturnValue(null),
  useUnifiedRecordings: vi.fn().mockReturnValue([])
}))

vi.mock('@/store/features/useTranscriptionStore', async (orig) => ({
  ...(await orig<typeof import('@/store/features/useTranscriptionStore')>()),
  useTranscriptionStore: vi.fn(),
  useTranscriptionStats: vi.fn(),
  useTranscriptionPaused: vi.fn()
}))

const mockPrioritize = vi.fn()
const mockDeprioritize = vi.fn()
const mockRetry = vi.fn()
const mockPauseQueue = vi.fn()
const mockResumeQueue = vi.fn()
const mockApplyQueueState = vi.fn()

vi.mock('@/hooks/useOperations', () => ({
  useOperations: () => ({
    cancelAllDownloads: vi.fn(),
    cancelAllTranscriptions: vi.fn(),
    cancelTranscription: vi.fn()
  })
}))

function makeTranscriptionState(queue: Map<string, unknown>) {
  return {
    queue,
    prioritize: mockPrioritize,
    deprioritize: mockDeprioritize,
    retry: mockRetry,
    pauseQueue: mockPauseQueue,
    resumeQueue: mockResumeQueue,
    applyQueueState: mockApplyQueueState
  }
}

function setupDefaultMocks() {
  vi.mocked(useAppStore).mockImplementation((selector: any) => {
    const state = { downloadQueue: new Map(), deviceSyncProgress: null, deviceSyncEta: null }
    return typeof selector === 'function' ? selector(state) : state
  })

  vi.mocked(useTranscriptionStats).mockReturnValue({
    total: 0, completed: 0, failed: 0, processing: 0, pending: 0, aggregateProgress: 0
  })

  vi.mocked(useTranscriptionStore).mockImplementation((selector: any) => {
    const state = makeTranscriptionState(new Map())
    return typeof selector === 'function' ? selector(state) : state
  })

  vi.mocked(useTranscriptionPaused).mockReturnValue(false)
}

describe('OperationsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupDefaultMocks()
    // Reset dock chrome to defaults (real UI store).
    useUIStore.setState({ operationsDockCollapsed: false, operationsOverlayOpen: false })
  })

  it('renders null when no operations are active', () => {
    const { container } = render(<OperationsPanel sidebarOpen={true} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders download section when downloads are active', () => {
    const downloadQueue = new Map([['dl-1', { filename: 'REC0001.WAV', progress: 50 }]])
    vi.mocked(useDownloadQueue).mockReturnValue(downloadQueue as any)
    vi.mocked(useAppStore).mockImplementation((selector: any) => {
      const state = { downloadQueue, deviceSyncProgress: null, deviceSyncEta: null }
      return typeof selector === 'function' ? selector(state) : state
    })

    render(<OperationsPanel sidebarOpen={true} />)
    expect(screen.getByText(/Downloads/)).toBeInTheDocument()
  })

  it('renders transcription section when transcriptions are pending', () => {
    vi.mocked(useTranscriptionStats).mockReturnValue({
      total: 2, completed: 0, failed: 0, processing: 1, pending: 1, aggregateProgress: 25
    })

    render(<OperationsPanel sidebarOpen={true} />)
    expect(screen.getByText(/Transcriptions/)).toBeInTheDocument()
  })

  it('hides cancel button when sidebar is collapsed', () => {
    const downloadQueue = new Map([['dl-1', { filename: 'REC0001.WAV', progress: 50 }]])
    vi.mocked(useDownloadQueue).mockReturnValue(downloadQueue as any)
    vi.mocked(useAppStore).mockImplementation((selector: any) => {
      const state = { downloadQueue, deviceSyncProgress: null, deviceSyncEta: null }
      return typeof selector === 'function' ? selector(state) : state
    })

    render(<OperationsPanel sidebarOpen={false} />)
    expect(screen.queryByText(/Cancel all downloads/)).not.toBeInTheDocument()
  })

  describe('dock collapse/expand', () => {
    function setupTranscriptions() {
      vi.mocked(useTranscriptionStats).mockReturnValue({
        total: 1, completed: 0, failed: 0, processing: 0, pending: 1, aggregateProgress: 0
      })
      const queue = new Map<string, unknown>([
        ['t1', { id: 't1', recordingId: 'rec-1', filename: 'REC_1.wav', status: 'pending', progress: 0, retryCount: 0, attempts: 0, priority: 0 }]
      ])
      vi.mocked(useTranscriptionStore).mockImplementation((selector: any) => {
        const state = makeTranscriptionState(queue)
        return typeof selector === 'function' ? selector(state) : state
      })
    }

    it('collapses the dock to a compact chip and persists the choice', () => {
      setupTranscriptions()
      const { rerender } = render(<OperationsPanel sidebarOpen={true} />)

      // Full dock shows the collapse control.
      const collapseBtn = screen.getByLabelText('Collapse operations dock')
      fireEvent.click(collapseBtn)

      // Persisted to the UI store (and localStorage via persist middleware).
      expect(useUIStore.getState().operationsDockCollapsed).toBe(true)

      rerender(<OperationsPanel sidebarOpen={true} />)
      // Now shows the compact chip with an expand control.
      expect(screen.getByLabelText('Expand operations dock')).toBeInTheDocument()
    })

    it('opens the detail overlay from the dock header', () => {
      setupTranscriptions()
      render(<OperationsPanel sidebarOpen={true} />)

      fireEvent.click(screen.getByLabelText('Open operations detail'))
      expect(useUIStore.getState().operationsOverlayOpen).toBe(true)
      expect(screen.getByRole('dialog', { name: /operations detail/i })).toBeInTheDocument()
    })
  })

  describe('per-item affordances', () => {
    function setupOnePending(recording: Record<string, unknown>) {
      vi.mocked(useTranscriptionStats).mockReturnValue({
        total: 1, completed: 0, failed: 0, processing: 0, pending: 1, aggregateProgress: 0
      })
      const queue = new Map<string, unknown>([
        ['t1', { id: 't1', recordingId: 'rec-1', filename: 'REC_1.wav', status: 'pending', progress: 0, retryCount: 0, attempts: 0, priority: 0 }]
      ])
      vi.mocked(useTranscriptionStore).mockImplementation((selector: any) => {
        const state = makeTranscriptionState(queue)
        return typeof selector === 'function' ? selector(state) : state
      })
      vi.mocked(useUnifiedRecordings).mockReturnValue([recording] as any)
    }

    it('go-to navigates to the linked meeting when the recording has a meetingId', () => {
      setupOnePending({ id: 'rec-1', location: 'local-only', meetingId: 'm-99' })
      render(<OperationsPanel sidebarOpen={true} />)

      fireEvent.click(screen.getByLabelText('Go to source'))
      expect(mockNavigate).toHaveBeenCalledWith('/meeting/m-99')
    })

    it('go-to falls back to the library when there is no linked meeting', () => {
      setupOnePending({ id: 'rec-1', location: 'device-only' })
      render(<OperationsPanel sidebarOpen={true} />)

      fireEvent.click(screen.getByLabelText('Go to source'))
      expect(mockNavigate).toHaveBeenCalledWith('/library', { state: { selectedId: 'rec-1' } })
    })

    it('prioritize invokes the store action for the item', () => {
      setupOnePending({ id: 'rec-1', location: 'device-only' })
      render(<OperationsPanel sidebarOpen={true} />)

      fireEvent.click(screen.getByLabelText('Prioritize'))
      expect(mockPrioritize).toHaveBeenCalledWith('t1')
    })
  })

  describe('queue pause/resume control', () => {
    function setupActiveQueue() {
      vi.mocked(useTranscriptionStats).mockReturnValue({
        total: 2, completed: 0, failed: 0, processing: 1, pending: 1, aggregateProgress: 25
      })
      const queue = new Map<string, unknown>([
        ['t1', { id: 't1', recordingId: 'rec-1', filename: 'REC_1.wav', status: 'processing', progress: 30, retryCount: 0, attempts: 1, priority: 0 }]
      ])
      vi.mocked(useTranscriptionStore).mockImplementation((selector: any) => {
        const state = makeTranscriptionState(queue)
        return typeof selector === 'function' ? selector(state) : state
      })
    }

    it('shows an enabled Pause control (no "coming soon" placeholder) and calls pauseQueue', () => {
      setupActiveQueue()
      render(<OperationsPanel sidebarOpen={true} />)

      const pauseBtn = screen.getByLabelText('Pause transcription queue')
      expect(pauseBtn).not.toBeDisabled()
      fireEvent.click(pauseBtn)
      expect(mockPauseQueue).toHaveBeenCalled()
    })

    it('flips to a Resume control and shows a Paused badge when paused', () => {
      setupActiveQueue()
      vi.mocked(useTranscriptionPaused).mockReturnValue(true)
      render(<OperationsPanel sidebarOpen={true} />)

      const resumeBtn = screen.getByLabelText('Resume transcription queue')
      expect(resumeBtn).not.toBeDisabled()
      expect(screen.getByText(/Paused/)).toBeInTheDocument()

      fireEvent.click(resumeBtn)
      expect(mockResumeQueue).toHaveBeenCalled()
      expect(mockPauseQueue).not.toHaveBeenCalled()
    })

    it('never renders the old disabled "coming soon" pause placeholder', () => {
      setupActiveQueue()
      render(<OperationsPanel sidebarOpen={true} />)

      expect(screen.queryByText(/coming soon/i)).not.toBeInTheDocument()
      expect(screen.queryByLabelText(/Pause \(unavailable\)/)).not.toBeInTheDocument()
    })
  })
})
