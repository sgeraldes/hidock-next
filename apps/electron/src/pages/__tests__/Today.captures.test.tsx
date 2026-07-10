import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Today } from '../Today'
import { useAppStore } from '@/store'
import { resetMeetingParticipantsCache } from '@/lib/meeting-participants'
import type { UnifiedRecording } from '@/types/unified-recording'

const navigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => navigate }
})

vi.mock('@/components/identity/TodayIdentitySuggestions', () => ({
  TodayIdentitySuggestions: () => null
}))

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

function setup(data: Record<string, unknown> = {}) {
  global.window.electronAPI = {
    briefing: { get: vi.fn().mockResolvedValue({ success: true, data: briefing(data) }) },
    contacts: { getForMeeting: vi.fn().mockResolvedValue({ success: true, data: [] }) },
    onDomainEvent: () => () => undefined
  } as any
}

function rec(overrides: Partial<UnifiedRecording> & { id: string; filename: string; dateRecorded: Date }): UnifiedRecording {
  return {
    size: 0,
    duration: 0,
    transcriptionStatus: 'none',
    location: 'local-only',
    localPath: '/x',
    syncStatus: 'synced',
    ...overrides
  } as UnifiedRecording
}

function today(hours: number): Date {
  const d = new Date()
  d.setHours(hours, 0, 0, 0)
  return d
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
  useAppStore.setState({ unifiedRecordings: [] })
})

afterEach(() => {
  useAppStore.setState({ unifiedRecordings: [], deviceRecording: false })
})

describe("Today — Also captured today (agenda addition)", () => {
  it('adds today\'s non-recording captures WITHOUT disturbing the agenda', async () => {
    setup()
    useAppStore.setState({
      unifiedRecordings: [
        rec({ id: 'img', filename: 'Screenshot.png', title: 'Screenshot.png', dateRecorded: today(14) }),
        rec({ id: 'pdf', filename: 'plan.pdf', title: 'Quarter plan', dateRecorded: today(9) })
      ]
    })

    renderToday()

    // Agenda is intact: the "Your day" ribbon still renders.
    expect(await screen.findByText('Your day')).toBeInTheDocument()

    // The addition appears with the captured items.
    expect(screen.getByTestId('today-captures')).toBeInTheDocument()
    expect(screen.getByText('Also captured today')).toBeInTheDocument()
    expect(screen.getByText('Screenshot.png')).toBeInTheDocument()
    expect(screen.getByText('Quarter plan')).toBeInTheDocument()
  })

  it('shows nothing extra when only audio was recorded today (no duplication, no empty scaffolding)', async () => {
    setup()
    useAppStore.setState({
      unifiedRecordings: [rec({ id: 'aud', filename: '2025-07-10_1400.wav', dateRecorded: today(14) })]
    })

    renderToday()

    expect(await screen.findByText('Your day')).toBeInTheDocument()
    expect(screen.queryByTestId('today-captures')).not.toBeInTheDocument()
  })

  it('excludes captures from other days (current-day only)', async () => {
    setup()
    const twoDaysAgo = new Date()
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2)
    twoDaysAgo.setHours(10, 0, 0, 0)
    useAppStore.setState({
      unifiedRecordings: [rec({ id: 'old', filename: 'old.png', title: 'Old shot', dateRecorded: twoDaysAgo })]
    })

    renderToday()

    await waitFor(() => expect(window.electronAPI.briefing.get).toHaveBeenCalled())
    expect(screen.queryByTestId('today-captures')).not.toBeInTheDocument()
    expect(screen.queryByText('Old shot')).not.toBeInTheDocument()
  })
})
