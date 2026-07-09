import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Today } from '../Today'
import { resetMeetingParticipantsCache } from '@/lib/meeting-participants'

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => vi.fn() }
})

// Identity suggestions do their own IPC; stub them out for this focused test.
vi.mock('@/components/identity/TodayIdentitySuggestions', () => ({
  TodayIdentitySuggestions: () => null
}))

// Built relative to real time so zone classification is deterministic without
// fake timers: m1 is in progress (focus zone → rich card, participant line
// visible); m2 is >2h out (later zone → compact row, subject still visible).
const now = Date.now()
const iso = (offsetMin: number) => new Date(now + offsetMin * 60000).toISOString()
const briefing = {
  todayMeetings: [
    { id: 'm1', subject: 'Sprint Planning', start_time: iso(-10), end_time: iso(50) },
    { id: 'm2', subject: 'Empty Standup', start_time: iso(180), end_time: iso(195) }
  ],
  recentKnowledge: [],
  pendingActionables: [],
  calendar: { configured: true, syncEnabled: true, lastSyncAt: null },
  stats: { transcribedCount: 0, indexedChunks: 0, pendingActionables: 0 }
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

describe('Today — meeting participant line', () => {
  it('renders first names for meetings with known participants and hides the line when empty', async () => {
    const getForMeeting = vi.fn().mockImplementation((meetingId: string) => {
      if (meetingId === 'm1') {
        return Promise.resolve({
          success: true,
          data: [
            { id: 'c1', name: 'Mario Rossi', email: null },
            { id: 'c2', name: 'Luigi Verdi', email: null }
          ]
        })
      }
      return Promise.resolve({ success: true, data: [] })
    })
    global.window.electronAPI = {
      briefing: { get: vi.fn().mockResolvedValue({ success: true, data: briefing }) },
      contacts: { getForMeeting }
    } as any

    renderToday()

    // Participant first names appear under the meeting with known contacts.
    expect(await screen.findByText('Mario, Luigi')).toBeInTheDocument()
    await waitFor(() => expect(getForMeeting).toHaveBeenCalledWith('m2'))
    // The empty meeting still renders its subject but no participant line.
    expect(screen.getByText('Empty Standup')).toBeInTheDocument()
  })
})
