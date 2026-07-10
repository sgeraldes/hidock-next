/**
 * Tests for the SourceReader "People" panel:
 *  - Participants (who actually spoke / was detected) — canonical contacts from
 *    contacts.getForMeeting PLUS distinct transcript speaker labels; canonical
 *    contacts deep-link to /person/:id.
 *  - Invited (calendar-invited attendees) — parsed from meeting.attendees; a
 *    DISTINCT list from Participants, with an honest empty state when the
 *    calendar event carried no invite list.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SourceReader } from '../SourceReader'
import type { UnifiedRecording } from '@/types/unified-recording'
import type { Meeting, Transcript, Contact } from '@/types'

// ---------------------------------------------------------------------------
// Mocks — keep the surrounding surface out of the way, focus on the People panel
// ---------------------------------------------------------------------------
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => mockNavigate }
})

vi.mock('@radix-ui/react-portal', () => ({
  Portal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
vi.mock('@/components/ui/toaster', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}))
vi.mock('@/components/RecordingLinkDialog', () => ({ RecordingLinkDialog: () => null }))
vi.mock('@/components/ConfirmDialog', () => ({ ConfirmDialog: () => null }))
vi.mock('@/components/AudioPlayer', () => ({ AudioPlayer: () => <div data-testid="audio-player" /> }))
vi.mock('../TranscriptViewer', () => ({ TranscriptViewer: () => <div data-testid="transcript-viewer" /> }))
vi.mock('@/components/ui/select', () => ({
  Select: ({ children }: any) => <div>{children}</div>,
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ children }: any) => <div>{children}</div>,
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const mockGetForMeeting = vi.fn()

function makeRecording(overrides: Partial<UnifiedRecording> = {}): UnifiedRecording {
  return {
    id: 'rec-1',
    filename: 'meeting.wav',
    size: 1024 * 1024,
    duration: 125,
    dateRecorded: new Date('2024-01-15T10:00:00Z'),
    transcriptionStatus: 'complete',
    location: 'local-only',
    localPath: '/recordings/meeting.wav',
    syncStatus: 'synced',
    ...overrides,
  } as UnifiedRecording
}

function makeMeeting(attendees?: unknown): Meeting {
  return {
    id: 'meet-1',
    subject: 'Team Standup',
    start_time: '2024-01-15T09:00:00Z',
    end_time: '2024-01-15T09:30:00Z',
    attendees: attendees === undefined ? null : JSON.stringify(attendees),
  } as Meeting
}

function makeContact(over: Partial<Contact> = {}): Contact {
  return {
    id: 'c-1',
    name: 'Alice Smith',
    email: 'alice@example.com',
    notes: null,
    first_seen_at: '',
    last_seen_at: '',
    meeting_count: 1,
    created_at: '',
    ...over,
  }
}

function makeTranscript(speakers?: unknown): Transcript {
  return {
    id: 't-1',
    recording_id: 'rec-1',
    full_text: 'hello there',
    summary: null,
    action_items: null,
    speakers: speakers === undefined ? null : JSON.stringify(speakers),
  } as unknown as Transcript
}

function renderReader(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetForMeeting.mockResolvedValue({ success: true, data: [] })
  Object.defineProperty(window, 'electronAPI', {
    value: {
      contacts: { getForMeeting: mockGetForMeeting },
      recordings: { reprocessWith: vi.fn().mockResolvedValue({ success: true }) },
      projects: {
        getForKnowledge: vi.fn().mockResolvedValue({ success: true, data: [] }),
        getAll: vi.fn().mockResolvedValue({ success: true, data: { projects: [], total: 0 } }),
      },
    },
    writable: true,
    configurable: true,
  })
})

// ---------------------------------------------------------------------------
// Participants
// ---------------------------------------------------------------------------
describe('SourceReader — Participants list', () => {
  it('renders canonical meeting contacts as clickable chips → /person/:id', async () => {
    mockGetForMeeting.mockResolvedValue({
      success: true,
      data: [makeContact({ id: 'c-1', name: 'Alice Smith' }), makeContact({ id: 'c-2', name: 'Bob Jones', email: 'bob@x.com' })],
    })
    renderReader(<SourceReader recording={makeRecording()} meeting={makeMeeting()} />)

    // Loaded from contacts.getForMeeting for the linked meeting.
    await waitFor(() => expect(mockGetForMeeting).toHaveBeenCalledWith('meet-1'))
    expect(await screen.findByText(/Participants \(2\)/)).toBeInTheDocument()
    expect(screen.getByText('From transcripts')).toBeInTheDocument()

    const alice = await screen.findByRole('button', { name: 'Alice Smith' })
    fireEvent.click(alice)
    expect(mockNavigate).toHaveBeenCalledWith('/person/c-1')
  })

  it('adds transcript speaker labels that have no matching contact', async () => {
    mockGetForMeeting.mockResolvedValue({ success: true, data: [makeContact({ id: 'c-1', name: 'Alice Smith' })] })
    const transcript = makeTranscript([
      { speaker: 'Alice Smith', start: 0, end: 1, text: 'hi' }, // already a contact → not doubled
      { speaker: 'Speaker 2', start: 1, end: 2, text: 'yo' },   // no contact → extra chip
    ])
    renderReader(<SourceReader recording={makeRecording()} meeting={makeMeeting()} transcript={transcript} />)

    // 1 contact + 1 unmatched speaker = 2 participants (Alice not double-counted).
    expect(await screen.findByText(/Participants \(2\)/)).toBeInTheDocument()
    expect(screen.getByText('Speaker 2')).toBeInTheDocument()
  })

  it('shows participants from transcript speakers even with no linked meeting', async () => {
    const transcript = makeTranscript([{ speaker: 'Speaker 1', start: 0, end: 1, text: 'hi' }])
    renderReader(<SourceReader recording={makeRecording()} transcript={transcript} />)

    expect(await screen.findByText(/Participants \(1\)/)).toBeInTheDocument()
    expect(screen.getByText('Speaker 1')).toBeInTheDocument()
    // No meeting → no contacts fetch.
    expect(mockGetForMeeting).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Invited
// ---------------------------------------------------------------------------
describe('SourceReader — Invited list', () => {
  it('renders calendar attendees, distinct from participants', async () => {
    mockGetForMeeting.mockResolvedValue({ success: true, data: [makeContact({ id: 'c-1', name: 'Alice Smith', email: 'alice@example.com' })] })
    const meeting = makeMeeting([
      { name: 'Alice Smith', email: 'alice@example.com' },
      { name: 'Carol Never-Spoke', email: 'carol@example.com' },
    ])
    renderReader(<SourceReader recording={makeRecording()} meeting={meeting} />)

    expect(await screen.findByText(/Invited \(2\)/)).toBeInTheDocument()
    expect(screen.getByText('From calendar')).toBeInTheDocument()
    // Carol was invited but is not a participant — the two lists are distinct.
    expect(screen.getByText('Carol Never-Spoke')).toBeInTheDocument()
  })

  it('makes an invited attendee clickable when it resolves to a contact', async () => {
    mockGetForMeeting.mockResolvedValue({ success: true, data: [makeContact({ id: 'c-9', name: 'Alice Smith', email: 'alice@example.com' })] })
    const meeting = makeMeeting([{ name: 'Alice Smith', email: 'alice@example.com' }])
    renderReader(<SourceReader recording={makeRecording()} meeting={meeting} />)

    // Both Participants and Invited render Alice; click the Invited one (last).
    const aliceChips = await screen.findAllByRole('button', { name: 'Alice Smith' })
    expect(aliceChips.length).toBeGreaterThanOrEqual(2)
    fireEvent.click(aliceChips[aliceChips.length - 1])
    expect(mockNavigate).toHaveBeenCalledWith('/person/c-9')
  })

  it('shows an honest empty state when the meeting has no invite list', async () => {
    renderReader(<SourceReader recording={makeRecording()} meeting={makeMeeting(/* no attendees */)} />)

    expect(await screen.findByText(/Invited \(0\)/)).toBeInTheDocument()
    expect(screen.getByText(/no invite list captured for this meeting/i)).toBeInTheDocument()
  })

  it('does not render the Invited block when there is no linked meeting', async () => {
    const transcript = makeTranscript([{ speaker: 'Speaker 1', start: 0, end: 1, text: 'hi' }])
    renderReader(<SourceReader recording={makeRecording()} transcript={transcript} />)

    expect(await screen.findByText(/Participants \(1\)/)).toBeInTheDocument()
    expect(screen.queryByText(/^Invited/)).not.toBeInTheDocument()
  })
})
