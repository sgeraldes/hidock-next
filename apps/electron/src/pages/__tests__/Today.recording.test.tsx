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
