import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactElement } from 'react'
import { MeetingHoverCard } from '../EntityHoverCards'
import { resetMeetingParticipantsCache } from '@/lib/meeting-participants'
import { resetMeetingRecordingIntelCache } from '@/lib/meeting-recording-intelligence'

// The card navigates (recent-meeting links / open affordance) so it needs a router.
function renderCard(ui: ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

beforeEach(() => {
  vi.clearAllMocks()
  resetMeetingParticipantsCache()
  resetMeetingRecordingIntelCache()
})

describe('MeetingHoverCard — known participants', () => {
  it('renders participant chips fetched from contacts.getForMeeting', async () => {
    const getById = vi.fn().mockResolvedValue({ subject: 'Sprint Planning' })
    const getForMeeting = vi.fn().mockResolvedValue({
      success: true,
      data: [
        { id: 'c1', name: 'Mario Rossi', email: 'mario@x.com' },
        { id: 'c2', name: 'Luigi Verdi', email: null }
      ]
    })
    global.window.electronAPI = {
      meetings: { getById },
      contacts: { getForMeeting },
      recordings: { getForMeeting: vi.fn().mockResolvedValue([]) },
      transcripts: { getByRecordingIds: vi.fn().mockResolvedValue({}) }
    } as any

    renderCard(<MeetingHoverCard id="m1" name="Sprint Planning" />)

    await waitFor(() => expect(getForMeeting).toHaveBeenCalledWith('m1'))
    expect(await screen.findByText('Mario Rossi')).toBeInTheDocument()
    expect(screen.getByText('Luigi Verdi')).toBeInTheDocument()
  })

  it('shows a "+N more" overflow beyond the first five participants', async () => {
    const getForMeeting = vi.fn().mockResolvedValue({
      success: true,
      data: Array.from({ length: 7 }, (_, i) => ({ id: `c${i}`, name: `Person ${i}`, email: null }))
    })
    global.window.electronAPI = {
      meetings: { getById: vi.fn().mockResolvedValue({ subject: 'Big Meeting' }) },
      contacts: { getForMeeting },
      recordings: { getForMeeting: vi.fn().mockResolvedValue([]) },
      transcripts: { getByRecordingIds: vi.fn().mockResolvedValue({}) }
    } as any

    renderCard(<MeetingHoverCard id="m2" name="Big Meeting" />)

    expect(await screen.findByText('+2 more')).toBeInTheDocument()
    expect(screen.getByText('Person 0')).toBeInTheDocument()
    // Sixth and seventh names collapse into the overflow counter.
    expect(screen.queryByText('Person 5')).toBeNull()
  })

  it('never renders a "No known participants" filler line when none are known', async () => {
    const getForMeeting = vi.fn().mockResolvedValue({ success: true, data: [] })
    global.window.electronAPI = {
      meetings: { getById: vi.fn().mockResolvedValue({ subject: 'Solo' }) },
      contacts: { getForMeeting },
      recordings: { getForMeeting: vi.fn().mockResolvedValue([]) },
      transcripts: { getByRecordingIds: vi.fn().mockResolvedValue({}) }
    } as any

    renderCard(<MeetingHoverCard id="m3" name="Solo" />)

    // Wait for the card body (the affordance renders only after the meeting
    // loads), then assert the title shows but no participant filler.
    expect(await screen.findByText('Open meeting')).toBeInTheDocument()
    expect(screen.getByText('Solo')).toBeInTheDocument()
    expect(screen.queryByText('No known participants')).toBeNull()
  })

  it('degrades gracefully when the contacts API is unavailable', async () => {
    global.window.electronAPI = {
      meetings: { getById: vi.fn().mockResolvedValue({ subject: 'Legacy' }) },
      recordings: { getForMeeting: vi.fn().mockResolvedValue([]) },
      transcripts: { getByRecordingIds: vi.fn().mockResolvedValue({}) }
    } as any

    renderCard(<MeetingHoverCard id="m4" name="Legacy" />)

    // No throw; the card body renders and no filler participant line appears.
    expect(await screen.findByText('Open meeting')).toBeInTheDocument()
    expect(screen.getByText('Legacy')).toBeInTheDocument()
    expect(screen.queryByText('No known participants')).toBeNull()
  })
})

describe('MeetingHoverCard — incremental disclosure (visibleFields)', () => {
  it('skips the title and time when the trigger already shows them', async () => {
    global.window.electronAPI = {
      meetings: {
        getById: vi.fn().mockResolvedValue({
          subject: 'Planning',
          start_time: '2026-01-01T10:00:00Z',
          description: 'Discuss roadmap\nReview budget',
          location: 'Room 4'
        })
      },
      contacts: { getForMeeting: vi.fn().mockResolvedValue({ success: true, data: [] }) },
      recordings: { getForMeeting: vi.fn().mockResolvedValue([]) },
      transcripts: { getByRecordingIds: vi.fn().mockResolvedValue({}) }
    } as any

    renderCard(<MeetingHoverCard id="m5" name="Planning" visibleFields={['title', 'time']} />)

    // Net-new agenda + location surface...
    expect(await screen.findByText('Discuss roadmap')).toBeInTheDocument()
    expect(screen.getByText('Review budget')).toBeInTheDocument()
    expect(screen.getByText('Room 4')).toBeInTheDocument()
    // ...but the repeated title is skipped.
    expect(screen.queryByText('Planning')).toBeNull()
  })

  it('shows "No additional details" when nothing net-new remains', async () => {
    global.window.electronAPI = {
      meetings: {
        getById: vi.fn().mockResolvedValue({ subject: 'Bare', start_time: '2026-01-01T10:00:00Z' })
      },
      contacts: { getForMeeting: vi.fn().mockResolvedValue({ success: true, data: [] }) },
      recordings: { getForMeeting: vi.fn().mockResolvedValue([]) },
      transcripts: { getByRecordingIds: vi.fn().mockResolvedValue({}) }
    } as any

    renderCard(<MeetingHoverCard id="m6" name="Bare" visibleFields={['title', 'time']} />)

    expect(await screen.findByText('No additional details')).toBeInTheDocument()
  })
})

describe('MeetingHoverCard — recording intelligence', () => {
  it('renders a transcribed line with the word count', async () => {
    global.window.electronAPI = {
      meetings: { getById: vi.fn().mockResolvedValue({ subject: 'Recorded Sync' }) },
      contacts: { getForMeeting: vi.fn().mockResolvedValue({ success: true, data: [] }) },
      recordings: { getForMeeting: vi.fn().mockResolvedValue([{ id: 'r1', status: 'transcribed' }]) },
      transcripts: { getByRecordingIds: vi.fn().mockResolvedValue({ r1: { word_count: 1234 } }) }
    } as any

    renderCard(<MeetingHoverCard id="m7" name="Recorded Sync" visibleFields={['title', 'time']} />)

    expect(await screen.findByText('Recorded · transcribed (1,234 words)')).toBeInTheDocument()
  })

  it('renders "Recorded" when a recording exists but is not transcribed', async () => {
    global.window.electronAPI = {
      meetings: { getById: vi.fn().mockResolvedValue({ subject: 'Raw Sync' }) },
      contacts: { getForMeeting: vi.fn().mockResolvedValue({ success: true, data: [] }) },
      recordings: { getForMeeting: vi.fn().mockResolvedValue([{ id: 'r1', status: 'pending' }]) },
      transcripts: { getByRecordingIds: vi.fn().mockResolvedValue({}) }
    } as any

    renderCard(<MeetingHoverCard id="m8" name="Raw Sync" visibleFields={['title', 'time']} />)

    expect(await screen.findByText('Recorded')).toBeInTheDocument()
  })
})
