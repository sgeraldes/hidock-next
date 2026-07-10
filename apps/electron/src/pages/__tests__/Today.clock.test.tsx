/**
 * Today — live clock regression.
 *
 * The relative "in X min" / "Now" badges and the focus/next-up highlight are
 * driven by a ticking `now`. A frozen clock (interval not advancing `now`, or the
 * classification memoized so it never recomputes) leaves a meeting stuck showing
 * "in X min" long after it has started. This test advances fake timers past a
 * meeting's start and asserts the badge flips to "Now".
 */

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

const BASE = new Date('2026-07-08T15:00:00.000Z').getTime()

function briefingStartingSoon() {
  const iso = (offsetMin: number) => new Date(BASE + offsetMin * 60000).toISOString()
  return {
    // Starts 2 min after "now", runs an hour.
    todayMeetings: [{ id: 'm1', subject: 'Sprint Planning', start_time: iso(2), end_time: iso(62), description: '' }],
    recentKnowledge: [],
    pendingActionables: [],
    calendar: { configured: true, syncEnabled: true, lastSyncAt: null },
    stats: { transcribedCount: 0, indexedChunks: 0, pendingActionables: 0 }
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(BASE)
  resetMeetingParticipantsCache()
  useAppStore.setState({ deviceRecording: false, activeRecordingFilename: null })
  global.window.electronAPI = {
    briefing: { get: vi.fn().mockResolvedValue({ success: true, data: briefingStartingSoon() }) },
    recordings: { getForMeeting: vi.fn().mockResolvedValue([]) }
  } as any
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Today — live clock', () => {
  it('flips a meeting badge from "in X min" to "Now" once its start time passes', async () => {
    render(
      <MemoryRouter>
        <Today />
      </MemoryRouter>
    )

    // Wait for the async briefing load (vi.waitFor drives the fake clock).
    await vi.waitFor(() => expect(screen.getByText('Sprint Planning')).toBeInTheDocument())

    // Before the start: upcoming badge. (Match the meeting BADGE specifically —
    // the ribbon's now-line also carries a standalone "Now" label.)
    expect(screen.getByText('in 2 min')).toBeInTheDocument()
    expect(screen.queryByText(/^Now ·/)).not.toBeInTheDocument()

    // Advance past the start (and several 15s ticks).
    await vi.advanceTimersByTimeAsync(3 * 60_000)

    // The clock advanced → the meeting is now in progress.
    expect(screen.queryByText('in 2 min')).not.toBeInTheDocument()
    expect(screen.getByText(/^Now ·/)).toBeInTheDocument()
  })

  it('refreshes the clock on visibilitychange (recovers from a throttled background interval)', async () => {
    render(
      <MemoryRouter>
        <Today />
      </MemoryRouter>
    )
    await vi.waitFor(() => expect(screen.getByText('Sprint Planning')).toBeInTheDocument())
    expect(screen.getByText('in 2 min')).toBeInTheDocument()

    // Jump the wall clock forward WITHOUT running the interval — simulating a
    // background window whose setInterval was throttled/paused by Chromium.
    vi.setSystemTime(BASE + 3 * 60_000)

    // The interval hasn't fired, so the badge is still stale here…
    expect(screen.getByText('in 2 min')).toBeInTheDocument()

    // …until the window becomes visible again, which must force a refresh.
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.waitFor(() => {
      expect(screen.getByText(/^Now ·/)).toBeInTheDocument()
      expect(screen.queryByText('in 2 min')).not.toBeInTheDocument()
    })
  })
})
