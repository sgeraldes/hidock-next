import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { OperationsPanel } from '../OperationsPanel'

// Mock stores
import { useAppStore } from '@/store/useAppStore'
import { useTranscriptionStore, useTranscriptionStats } from '@/store/features/useTranscriptionStore'

vi.mock('@/store/useAppStore', () => ({
  useAppStore: vi.fn()
}))

vi.mock('@/store/features/useTranscriptionStore', () => ({
  useTranscriptionStore: vi.fn(),
  useTranscriptionStats: vi.fn()
}))

vi.mock('@/hooks/useOperations', () => ({
  useOperations: () => ({
    cancelAllDownloads: vi.fn(),
    cancelAllTranscriptions: vi.fn(),
    cancelTranscription: vi.fn()
  })
}))

function setupDefaultMocks() {
  vi.mocked(useAppStore).mockImplementation((selector: any) => {
    const state = {
      downloadQueue: new Map(),
      deviceSyncProgress: null,
      deviceSyncEta: null
    }
    return typeof selector === 'function' ? selector(state) : state
  })

  vi.mocked(useTranscriptionStats).mockReturnValue({
    total: 0,
    completed: 0,
    failed: 0,
    processing: 0,
    pending: 0
  })

  vi.mocked(useTranscriptionStore).mockImplementation((selector: any) => {
    const state = { queue: new Map() }
    return typeof selector === 'function' ? selector(state) : state
  })
}

describe('OperationsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupDefaultMocks()
  })

  it('renders null when no operations are active', () => {
    const { container } = render(<OperationsPanel sidebarOpen={true} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders download section when downloads are active', () => {
    const downloadQueue = new Map([
      ['dl-1', { filename: 'REC0001.WAV', progress: 50 }]
    ])
    vi.mocked(useAppStore).mockImplementation((selector: any) => {
      const state = {
        downloadQueue,
        deviceSyncProgress: null,
        deviceSyncEta: null
      }
      return typeof selector === 'function' ? selector(state) : state
    })

    render(<OperationsPanel sidebarOpen={true} />)

    expect(screen.getByText(/Downloads/)).toBeInTheDocument()
  })

  it('renders transcription section when transcriptions are pending', () => {
    vi.mocked(useTranscriptionStats).mockReturnValue({
      total: 2,
      completed: 0,
      failed: 0,
      processing: 1,
      pending: 1
    })

    render(<OperationsPanel sidebarOpen={true} />)

    expect(screen.getByText(/Transcriptions/)).toBeInTheDocument()
  })

  it('hides cancel button when sidebar is collapsed', () => {
    const downloadQueue = new Map([
      ['dl-1', { filename: 'REC0001.WAV', progress: 50 }]
    ])
    vi.mocked(useAppStore).mockImplementation((selector: any) => {
      const state = {
        downloadQueue,
        deviceSyncProgress: null,
        deviceSyncEta: null
      }
      return typeof selector === 'function' ? selector(state) : state
    })

    render(<OperationsPanel sidebarOpen={false} />)

    // When collapsed, cancel buttons are hidden
    expect(screen.queryByText(/Cancel all downloads/)).not.toBeInTheDocument()
  })
})
