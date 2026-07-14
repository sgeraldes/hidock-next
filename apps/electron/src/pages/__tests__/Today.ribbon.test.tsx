/**
 * Today — time-ribbon zone rendering, hero selection, and earlier-group collapse.
 *
 * Meetings are built relative to real time so their zone is deterministic
 * without fake timers: two long-past meetings collapse into a capsule, one
 * in-progress meeting becomes the hero, an upcoming meeting is a focus card, and
 * a far-off meeting is a compact "later" row.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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

const now = Date.now()
const iso = (offsetMin: number) => new Date(now + offsetMin * 60000).toISOString()

function briefing() {
  return {
    todayMeetings: [
      { id: 'e1', subject: 'Old Kickoff', start_time: iso(-300), end_time: iso(-270) },
      { id: 'e2', subject: 'Old Review', start_time: iso(-265), end_time: iso(-240) },
      { id: 'r1', subject: 'Recent Retro', start_time: iso(-70), end_time: iso(-30) },
      { id: 'live', subject: 'Live Sprint', start_time: iso(-5), end_time: iso(40) },
      { id: 'soon', subject: 'Soon Sync', start_time: iso(45), end_time: iso(75) },
      { id: 'far', subject: 'Later Planning', start_time: iso(200), end_time: iso(230) }
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
  useAppStore.setState({ deviceRecording: false, activeRecordingFilename: null })
  global.window.electronAPI = {
    briefing: { get: vi.fn().mockResolvedValue({ success: true, data: briefing() }) },
    contacts: { getForMeeting: vi.fn().mockResolvedValue({ success: true, data: [] }) },
    recordings: { getForMeeting: vi.fn().mockResolvedValue([]) }
  } as any
})

describe('Today ribbon — zones', () => {
  it('places each meeting in the right zone', async () => {
    renderToday()
    await screen.findByText('Live Sprint')

    // In-progress → focus card; far-off → compact later row.
    expect(screen.getByText('Live Sprint').closest('[data-testid="focus-card"]')).toBeTruthy()
    expect(screen.getByText('Soon Sync').closest('[data-testid="focus-card"]')).toBeTruthy()
    expect(screen.getByText('Later Planning').closest('[data-testid="later-row"]')).toBeTruthy()
    expect(screen.getByText('Recent Retro').closest('[data-testid="recent-row"]')).toBeTruthy()
  })

  it('selects exactly one hero — the in-progress meeting', async () => {
    renderToday()
    await screen.findByText('Live Sprint')

    const heroes = screen.getAllByTestId('focus-card').filter((el) => el.getAttribute('data-hero') === 'true')
    expect(heroes).toHaveLength(1)
    expect(heroes[0]).toHaveTextContent('Live Sprint')

    // The upcoming focus card is NOT the hero.
    const soon = screen.getByText('Soon Sync').closest('[data-testid="focus-card"]')
    expect(soon?.getAttribute('data-hero')).toBe('false')
  })
})

describe('Today ribbon — earlier group collapse', () => {
  it('collapses long-past meetings into a capsule and expands them on click', async () => {
    renderToday()
    await screen.findByText('Live Sprint')

    // Collapsed: the two old meetings are not shown, but a capsule summarises them.
    expect(screen.queryByText('Old Kickoff')).not.toBeInTheDocument()
    expect(screen.queryByText('Old Review')).not.toBeInTheDocument()
    const capsule = screen.getByTestId('group-capsule')
    expect(capsule).toHaveTextContent('2 meetings')

    // Expand → the block's meetings appear.
    fireEvent.click(capsule)
    expect(screen.getByText('Old Kickoff')).toBeInTheDocument()
    expect(screen.getByText('Old Review')).toBeInTheDocument()
  })
})

describe('Today ribbon — time ranges (regression: end times restored)', () => {
  // End-of-meeting wall-clock time, formatted exactly like the component's formatTime.
  const endTime = (offsetMin: number) =>
    new Date(now + offsetMin * 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  it('shows a full start–end range in every zone variant', async () => {
    renderToday()
    await screen.findByText('Live Sprint')

    // Focus card (in progress) — end time present.
    const focus = screen.getByText('Live Sprint').closest('[data-testid="focus-card"]')
    expect(focus).toHaveTextContent(endTime(40))

    // Recent row (ended within the hour).
    const recent = screen.getByText('Recent Retro').closest('[data-testid="recent-row"]')
    expect(recent).toHaveTextContent(endTime(-30))

    // Later row (compact, far ahead).
    const later = screen.getByText('Later Planning').closest('[data-testid="later-row"]')
    expect(later).toHaveTextContent(endTime(230))

    // Capsule-expanded rows.
    fireEvent.click(screen.getByTestId('group-capsule'))
    const capsuleRow = screen.getByText('Old Kickoff').closest('[data-testid="capsule-row"]')
    expect(capsuleRow).toHaveTextContent(endTime(-270))
  })
})

describe('Today ribbon — hover cards (regression: capsule rows wrapped)', () => {
  it('wraps a capsule-expanded row in a meeting hover card', async () => {
    // Give the earlier meeting hover-worthy content so withHover mounts the card.
    const data = briefing()
    ;(data.todayMeetings[0] as { location?: string }).location = 'Room 401' // Old Kickoff
    ;(global.window.electronAPI as any).briefing.get = vi.fn().mockResolvedValue({ success: true, data })
    ;(global.window.electronAPI as any).meetings = {
      getById: vi.fn().mockResolvedValue({ ...data.todayMeetings[0] })
    }

    renderToday()
    await screen.findByText('Live Sprint')
    fireEvent.click(screen.getByTestId('group-capsule'))

    const capsuleRow = screen.getByText('Old Kickoff').closest('[data-testid="capsule-row"]') as HTMLElement
    fireEvent.mouseEnter(capsuleRow)

    // Hover card content (portal) reveals the meeting location → proves the wrapper.
    expect(await screen.findByText('Room 401')).toBeInTheDocument()
  })
})

describe('Today ribbon — legend discoverability (regression: click, not hover-only)', () => {
  it('opens the category legend on click', async () => {
    renderToday()
    await screen.findByText('Live Sprint')

    expect(screen.queryByText('Meeting types')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /meeting category legend/i }))
    expect(await screen.findByText('Meeting types')).toBeInTheDocument()
  })
})
