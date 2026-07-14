import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Today } from '../Today'
import { useAppStore } from '@/store'
import { resetMeetingParticipantsCache } from '@/lib/meeting-participants'

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => vi.fn() }
})

vi.mock('@/components/identity/TodayIdentitySuggestions', () => ({
  TodayIdentitySuggestions: () => null
}))

// A meeting that is genuinely in progress right now (so it is the focus row), built
// relative to real time so no fake timers are needed.
function briefingWithInProgressMeeting() {
  const now = Date.now()
  const iso = (offsetMin: number) => new Date(now + offsetMin * 60000).toISOString()
  return {
    todayMeetings: [
      { id: 'm1', subject: 'Sprint Planning', start_time: iso(-10), end_time: iso(30), description: '' }
    ],
    recentKnowledge: [],
    pendingActionables: [],
    calendar: { configured: true, syncEnabled: true, lastSyncAt: null },
    stats: { transcribedCount: 0, indexedChunks: 0, pendingActionables: 0 }
  }
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
  global.window.electronAPI = {
    briefing: { get: vi.fn().mockResolvedValue({ success: true, data: briefingWithInProgressMeeting() }) },
    contacts: { getForMeeting: vi.fn().mockResolvedValue({ success: true, data: [] }) }
  } as any
})

afterEach(() => {
  useAppStore.setState({ deviceRecording: false })
})

describe('Today — live recording indicator', () => {
  it('shows the "Recording" label on the in-progress meeting when the device is recording', async () => {
    useAppStore.setState({ deviceRecording: true })
    renderToday()

    // The in-progress focus row surfaces a live "Recording" indicator.
    expect(await screen.findByText('Recording')).toBeInTheDocument()
    expect(screen.getByLabelText('Recording in progress')).toBeInTheDocument()
  })

  it('hides the "Recording" label when the device is not recording', async () => {
    useAppStore.setState({ deviceRecording: false })
    renderToday()

    // The row still renders (its subject), but no recording indicator appears.
    expect(await screen.findByText('Sprint Planning')).toBeInTheDocument()
    expect(screen.queryByText('Recording')).not.toBeInTheDocument()
  })
})

describe('Today — ran-over meeting', () => {
  function briefingWithRanOverMeeting() {
    const now = Date.now()
    const iso = (offsetMin: number) => new Date(now + offsetMin * 60000).toISOString()
    return {
      // Ended 6 minutes ago (scheduled 40→-6). A recording that began mid-meeting
      // is still running, so this is "running over".
      todayMeetings: [
        { id: 'm1', subject: 'Retro Belcorp', start_time: iso(-40), end_time: iso(-6), description: '' }
      ],
      recentKnowledge: [],
      pendingActionables: [],
      calendar: { configured: true, syncEnabled: true, lastSyncAt: null },
      stats: { transcribedCount: 0, indexedChunks: 0, pendingActionables: 0 }
    }
  }

  it('shows "ended X min ago" for a just-ended meeting when not recording', async () => {
    global.window.electronAPI = {
      briefing: { get: vi.fn().mockResolvedValue({ success: true, data: briefingWithRanOverMeeting() }) },
      recordings: { getForMeeting: vi.fn().mockResolvedValue([]) }
    } as any
    useAppStore.setState({ deviceRecording: false, activeRecordingFilename: null })
    renderToday()

    expect(await screen.findByText('Retro Belcorp')).toBeInTheDocument()
    expect(screen.getByText(/ended \d+ min ago/)).toBeInTheDocument()
    expect(screen.queryByText(/Running over/)).not.toBeInTheDocument()
  })

  it('shows "Running over · recording continues" when a recording started during the meeting', async () => {
    global.window.electronAPI = {
      briefing: { get: vi.fn().mockResolvedValue({ success: true, data: briefingWithRanOverMeeting() }) },
      recordings: { getForMeeting: vi.fn().mockResolvedValue([]), getPreassignment: vi.fn().mockResolvedValue({ success: true, data: null }) }
    } as any
    // A recording that started 20 min ago — inside the -40→-6 window.
    const startedAt = new Date(Date.now() - 20 * 60000)
    const pad = (n: number) => String(n).padStart(2, '0')
    const fname = `${startedAt.getFullYear()}${pad(startedAt.getMonth() + 1)}${pad(startedAt.getDate())}${pad(startedAt.getHours())}${pad(startedAt.getMinutes())}${pad(startedAt.getSeconds())}REC001.hda`
    useAppStore.setState({ deviceRecording: true, activeRecordingFilename: fname })
    renderToday()

    // The row badge carries the unique "running over" phrase (the subject also
    // appears in the live card as an attribution candidate, so assert on this).
    expect(await screen.findByText('Running over · recording continues')).toBeInTheDocument()
  })
})
