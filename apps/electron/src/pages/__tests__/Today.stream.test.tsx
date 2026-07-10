import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { UnifiedRecording } from '@/types/unified-recording'
import { Today } from '../Today'

// Fixed "today" so day grouping/labels are deterministic.
const NOW = new Date('2026-07-09T15:00:00')
vi.mock('@/hooks/useToday', () => ({ useToday: () => NOW }))

// Control the recording feed the real useStream consumes.
const recordingsRef: { current: UnifiedRecording[] } = { current: [] }
vi.mock('@/hooks/useUnifiedRecordings', () => ({
  useUnifiedRecordings: () => ({
    recordings: recordingsRef.current,
    loading: false,
    error: null,
    refresh: vi.fn(),
    deviceConnected: false,
    stats: {}
  })
}))

// No meeting-linked recordings in these fixtures → participant fetch no-ops,
// but stub it to be safe.
vi.mock('@/lib/meeting-participants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/meeting-participants')>()
  return { ...actual, fetchMeetingParticipants: vi.fn().mockResolvedValue([]) }
})

function localRec(overrides: Partial<UnifiedRecording> = {}): UnifiedRecording {
  return {
    id: 'r1',
    filename: 'meeting.wav',
    size: 1000,
    duration: 600,
    dateRecorded: new Date('2026-07-09T09:00:00'),
    transcriptionStatus: 'complete',
    location: 'local-only',
    localPath: '/x/meeting.wav',
    syncStatus: 'synced',
    ...(overrides as object)
  } as UnifiedRecording
}

function deviceRec(overrides: Partial<UnifiedRecording> = {}): UnifiedRecording {
  return {
    id: 'd1',
    filename: 'REC001.wav',
    size: 2000,
    duration: 300,
    dateRecorded: new Date('2026-07-09T11:00:00'),
    transcriptionStatus: 'none',
    location: 'device-only',
    deviceFilename: 'REC001.wav',
    syncStatus: 'not-synced',
    ...(overrides as object)
  } as UnifiedRecording
}

function renderToday() {
  return render(
    <MemoryRouter>
      <Today />
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  recordingsRef.current = []
})

describe('Today (Stream) — page', () => {
  it('renders day-grouped moments with a header count', async () => {
    recordingsRef.current = [
      localRec({ id: 'a', dateRecorded: new Date('2026-07-09T09:00:00') }),
      localRec({ id: 'b', filename: 'design.pdf', dateRecorded: new Date('2026-07-09T10:00:00') }),
      localRec({ id: 'c', dateRecorded: new Date('2026-07-08T18:00:00') })
    ]
    renderToday()

    const days = await screen.findAllByTestId('stream-day')
    expect(days).toHaveLength(2)
    // First day is Today with 2 moments captured.
    expect(within(days[0]).getByText('Today')).toBeInTheDocument()
    expect(within(days[0]).getByText('2 moments captured')).toBeInTheDocument()
    expect(within(days[1]).getByText('Yesterday')).toBeInTheDocument()
  })

  it('surfaces an image moment from an image capture (Library Images pipeline)', async () => {
    recordingsRef.current = [localRec({ id: 'shot', filename: 'clipboard.png', transcriptionStatus: 'complete' })]
    renderToday()
    const card = await screen.findByTestId('moment-card')
    expect(card).toHaveAttribute('data-source', 'image')
    expect(within(card).getByText('IMG')).toBeInTheDocument()
  })

  it('shows a still-on-device count and a Sync & transcribe action', async () => {
    recordingsRef.current = [deviceRec()]
    renderToday()
    await screen.findByTestId('stream-day')
    expect(screen.getByText(/1 still on device/)).toBeInTheDocument()
    expect(screen.getByTestId('sync-transcribe')).toBeInTheDocument()
  })

  it('renders an empty-stream state when nothing is captured', async () => {
    recordingsRef.current = []
    renderToday()
    expect(await screen.findByText('Your stream is empty')).toBeInTheDocument()
    expect(screen.queryByTestId('stream-day')).not.toBeInTheDocument()
  })
})
