import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Today } from '../Today'
import { useAppStore } from '@/store'
import { resetMeetingParticipantsCache } from '@/lib/meeting-participants'

const navigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => navigate }
})

vi.mock('@/components/identity/TodayIdentitySuggestions', () => ({
  TodayIdentitySuggestions: () => null
}))

function followUp(overrides: Record<string, unknown> = {}) {
  return {
    recordingId: 'rec-1',
    title: 'Integración WebRTC Gateway',
    filename: 'REC1.wav',
    dateRecorded: '2026-07-09T19:02:00Z',
    summary: 'We discussed the gateway handoff.',
    actionItems: ['Ship the gateway', 'Review the PR'],
    wordCount: 4200,
    meetingId: 'm-1',
    meetingSubject: 'Daily Reto Connect - Gateway',
    meetingStart: '2026-07-09T19:02:00Z',
    meetingEnd: '2026-07-09T19:30:00Z',
    ...overrides
  }
}

function briefing(overrides: Record<string, unknown> = {}) {
  return {
    todayMeetings: [],
    recentKnowledge: [],
    todayFollowUps: [],
    todayRecordingsPending: 0,
    pendingActionables: [],
    calendar: { configured: true, syncEnabled: true, lastSyncAt: null },
    stats: { transcribedCount: 0, indexedChunks: 0, pendingActionables: 0 },
    ...overrides
  }
}

function setup(data: Record<string, unknown>) {
  global.window.electronAPI = {
    briefing: { get: vi.fn().mockResolvedValue({ success: true, data: briefing(data) }) },
    contacts: { getForMeeting: vi.fn().mockResolvedValue({ success: true, data: [] }) },
    onDomainEvent: () => () => undefined
  } as any
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
  resetMeetingParticipantsCache()
})

afterEach(() => {
  useAppStore.setState({ deviceRecording: false })
})

describe("Today — Today's follow-ups digest", () => {
  it('lists today\'s meetings newest-first with calendar subject, time chip and action count', async () => {
    setup({
      todayFollowUps: [
        followUp({ recordingId: 'rec-late', meetingSubject: 'Daily Reto Connect - Gateway', meetingStart: '2026-07-09T19:02:00Z' }),
        followUp({
          recordingId: 'rec-early',
          title: 'Standup notes',
          meetingSubject: 'Morning Standup',
          meetingStart: '2026-07-09T09:00:00Z',
          actionItems: []
        })
      ]
    })

    renderToday()

    expect(await screen.findByText("Today's follow-ups")).toBeInTheDocument()
    // Both calendar subjects surface — the which-meeting clarity requirement.
    expect(screen.getByText('Daily Reto Connect - Gateway')).toBeInTheDocument()
    expect(screen.getByText('Morning Standup')).toBeInTheDocument()

    const rows = screen.getAllByTestId('followup-row')
    expect(rows).toHaveLength(2)
    // Backend delivers DESC; the first rendered row is the most recent meeting.
    expect(within(rows[0]).getByText('Daily Reto Connect - Gateway')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Morning Standup')).toBeInTheDocument()

    // Count header reflects the day's coverage.
    expect(screen.getByText('2 meetings')).toBeInTheDocument()
  })

  it('defaults the most-recent row expanded (summary + CTAs) and collapses older rows', async () => {
    setup({
      todayFollowUps: [
        followUp({ recordingId: 'rec-late', summary: 'Newest summary text' }),
        followUp({ recordingId: 'rec-early', meetingSubject: 'Morning Standup', summary: 'Older summary text' })
      ]
    })

    renderToday()
    await screen.findByText("Today's follow-ups")

    // Newest row is expanded by default: its summary and the four CTAs are visible.
    expect(screen.getByText('Newest summary text')).toBeInTheDocument()
    expect(screen.getByText('Claude Code handoff')).toBeInTheDocument()
    expect(screen.getByText('Meeting minutes')).toBeInTheDocument()
    expect(screen.getByText('Ask the assistant')).toBeInTheDocument()
    expect(screen.getByText('Open in Library')).toBeInTheDocument()

    // Older row is collapsed: its summary is hidden until expanded.
    expect(screen.queryByText('Older summary text')).not.toBeInTheDocument()

    const rows = screen.getAllByTestId('followup-row')
    fireEvent.click(rows[1])
    expect(await screen.findByText('Older summary text')).toBeInTheDocument()
  })

  it('shows the honest unlinked state when a follow-up has no linked meeting', async () => {
    setup({
      todayFollowUps: [
        followUp({
          recordingId: 'rec-orphan',
          title: 'Unlabeled recording',
          meetingId: undefined,
          meetingSubject: undefined,
          meetingStart: undefined,
          meetingEnd: undefined
        })
      ]
    })

    renderToday()
    await screen.findByText("Today's follow-ups")
    expect(screen.getByText('Not linked to a meeting')).toBeInTheDocument()
    expect(screen.getByText('Unlabeled recording')).toBeInTheDocument()
  })

  it('shows the still-processing count alongside listed follow-ups', async () => {
    setup({
      todayFollowUps: [followUp({ recordingId: 'rec-1' })],
      todayRecordingsPending: 3
    })

    renderToday()
    await screen.findByText("Today's follow-ups")
    expect(screen.getByTestId('followup-pending')).toHaveTextContent(
      "3 of today's recordings still processing"
    )
  })

  it('shows only the processing count when nothing is analyzed yet today', async () => {
    setup({ todayFollowUps: [], todayRecordingsPending: 2 })

    renderToday()
    await screen.findByText("Today's follow-ups")
    expect(screen.getByTestId('followup-pending')).toHaveTextContent(
      "2 of today's recordings still processing"
    )
    expect(screen.queryAllByTestId('followup-row')).toHaveLength(0)
  })

  it('falls back to the latest analyzed meeting (with subject + time) when there are no recordings today', async () => {
    setup({
      todayFollowUps: [],
      todayRecordingsPending: 0,
      recentKnowledge: [
        followUp({
          recordingId: 'rec-yesterday',
          title: 'Yesterday analysis title',
          meetingSubject: 'Retro with Gateway team',
          dateRecorded: '2026-07-08T18:00:00Z'
        })
      ]
    })

    renderToday()
    // Heading disambiguates WHEN the item is from.
    const heading = await screen.findByText('Latest analyzed meeting')
    // Scope to the fallback card — the title also appears in the "Recent knowledge" card.
    const card = heading.closest('[class*="rounded"]') as HTMLElement
    expect(within(card).getByText('Retro with Gateway team')).toBeInTheDocument()
    expect(within(card).getByText('Yesterday analysis title')).toBeInTheDocument()
    expect(within(card).getByText('Claude Code handoff')).toBeInTheDocument()
    // It must NOT masquerade as today's follow-up digest.
    expect(screen.queryByText("Today's follow-ups")).not.toBeInTheDocument()
  })

  it('renders no follow-up card when there is nothing today and no prior knowledge', async () => {
    setup({ todayFollowUps: [], todayRecordingsPending: 0, recentKnowledge: [] })

    renderToday()
    await waitFor(() => expect(window.electronAPI.briefing.get).toHaveBeenCalled())
    expect(screen.queryByText("Today's follow-ups")).not.toBeInTheDocument()
    expect(screen.queryByText('Latest analyzed meeting')).not.toBeInTheDocument()
  })
})
