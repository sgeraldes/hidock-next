
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Recordings } from '../Recordings'
import { MemoryRouter } from 'react-router-dom'
import { useUnifiedRecordings } from '@/hooks/useUnifiedRecordings'

// Mock useUnifiedRecordings
vi.mock('@/hooks/useUnifiedRecordings', () => ({
  useUnifiedRecordings: vi.fn()
}))

// Mock other dependencies
vi.mock('@/components/OperationController', () => ({
  useAudioControls: () => ({ play: vi.fn(), stop: vi.fn() })
}))
vi.mock('@/store/useUIStore', () => ({
  useUIStore: (selector: any) => selector({
    currentlyPlayingId: null,
    recordingsCompactView: false,
    setRecordingsCompactView: vi.fn()
  })
}))
vi.mock('@/store/useAppStore', () => ({
  useAppStore: vi.fn((selector) => {
    const state = {
      downloadQueue: new Map(),
      isDownloading: () => false
    }
    return selector ? selector(state) : state
  })
}))
// Mock virtualizer
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: () => ({
    getVirtualItems: () => [
      { index: 0, size: 50, start: 0, key: '0' }
    ],
    getTotalSize: () => 50,
    measureElement: vi.fn()
  })
}))

// Mock electronAPI
global.window.electronAPI = {
  transcripts: { getByRecordingIds: vi.fn().mockResolvedValue({}) },
  meetings: { getByIds: vi.fn().mockResolvedValue({}) },
  storage: { openFolder: vi.fn() }
} as any

describe('Recordings Page', () => {
  it('should display knowledge capture quality rating', () => {
    // @ts-ignore
    useUnifiedRecordings.mockReturnValue({
      recordings: [{
        id: 'rec-1',
        filename: 'test.wav',
        dateRecorded: new Date(),
        location: 'local-only',
        localPath: '/path/test.wav',
        syncStatus: 'synced',
        transcriptionStatus: 'complete',
        // Knowledge fields
        knowledgeCaptureId: 'kc-1',
        quality: 'valuable',
        title: 'Important Meeting'
      }],
      loading: false,
      error: null,
      refresh: vi.fn(),
      deviceConnected: false,
      stats: { total: 1, deviceOnly: 0, localOnly: 1, both: 0, synced: 1, unsynced: 0 }
    })

    render(
      <MemoryRouter>
        <Recordings />
      </MemoryRouter>
    )

    // Expect title to be displayed
    expect(screen.getByText('Important Meeting')).toBeInTheDocument()
    // Expect quality to be displayed
    expect(screen.getByText('valuable')).toBeInTheDocument() 
  })
})
