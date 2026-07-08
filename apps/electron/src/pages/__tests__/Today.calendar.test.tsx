import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Today } from '../Today'
import { useAppStore } from '@/store'
import { resetMeetingParticipantsCache } from '@/lib/meeting-participants'
import { localDateString } from '@/lib/meeting-timing'

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => vi.fn() }
})

vi.mock('@/components/identity/TodayIdentitySuggestions', () => ({
  TodayIdentitySuggestions: () => null
}))

// Captured 'domain-event' listener the component registers, so tests can push a
// 'calendar:synced' event as the main process would.
let domainEventHandler: ((event: { type?: string }) => void) | null = null

function renderToday() {
  return render(
    <MemoryRouter>
      <Today />
    </MemoryRouter>
  )
}

const timedMeeting = (subject: string) => {
  const now = Date.now()
  const iso = (offsetMin: number) => new Date(now + offsetMin * 60000).toISOString()
  return { id: 'timed', subject, start_time: iso(-10), end_time: iso(30), description: '' }
}

/** An all-day meeting anchored to LOCAL midnight of the given local date. */
const allDayMeeting = (id: string, subject: string, day: Date) => ({
  id,
  subject,
  start_time: new Date(day.getFullYear(), day.getMonth(), day.getDate()).toISOString(),
  end_time: new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).toISOString(),
  is_all_day: 1,
  all_day_date: localDateString(day)
})

function briefing(todayMeetings: any[]) {
  return {
    todayMeetings,
    recentKnowledge: [],
    pendingActionables: [],
    calendar: { configured: true, syncEnabled: true, lastSyncAt: null },
    stats: { transcribedCount: 0, indexedChunks: 0, pendingActionables: 0 }
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  resetMeetingParticipantsCache()
  domainEventHandler = null
})

afterEach(() => {
  useAppStore.setState({ deviceRecording: false })
})

describe('Today — refetch after calendar sync', () => {
  it('reloads the briefing when a calendar:synced event arrives', async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({ success: true, data: briefing([timedMeeting('Pre-sync meeting')]) })
      .mockResolvedValueOnce({ success: true, data: briefing([timedMeeting('Post-sync meeting')]) })

    global.window.electronAPI = {
      briefing: { get },
      contacts: { getForMeeting: vi.fn().mockResolvedValue({ success: true, data: [] }) },
      onDomainEvent: (cb: (event: { type?: string }) => void) => {
        domainEventHandler = cb
        return () => {
          domainEventHandler = null
        }
      }
    } as any

    renderToday()
    expect(await screen.findByText('Pre-sync meeting')).toBeInTheDocument()
    expect(get).toHaveBeenCalledTimes(1)

    // Main process finishes a sync → renderer refetches (debounced ~300ms).
    domainEventHandler?.({ type: 'calendar:synced' })

    expect(await screen.findByText('Post-sync meeting')).toBeInTheDocument()
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2))
  })

  it('ignores unrelated domain events', async () => {
    const get = vi
      .fn()
      .mockResolvedValue({ success: true, data: briefing([timedMeeting('Only meeting')]) })

    global.window.electronAPI = {
      briefing: { get },
      contacts: { getForMeeting: vi.fn().mockResolvedValue({ success: true, data: [] }) },
      onDomainEvent: (cb: (event: { type?: string }) => void) => {
        domainEventHandler = cb
        return () => undefined
      }
    } as any

    renderToday()
    await screen.findByText('Only meeting')

    domainEventHandler?.({ type: 'quality:assessed' })
    await new Promise((r) => setTimeout(r, 350))
    expect(get).toHaveBeenCalledTimes(1)
  })
})

describe('Today — all-day / holiday events', () => {
  function setup(meetings: any[]) {
    global.window.electronAPI = {
      briefing: { get: vi.fn().mockResolvedValue({ success: true, data: briefing(meetings) }) },
      contacts: { getForMeeting: vi.fn().mockResolvedValue({ success: true, data: [] }) },
      onDomainEvent: () => () => undefined
    } as any
  }

  it("shows today's holiday but NOT tomorrow's, and places the banner below the schedule", async () => {
    const today = new Date()
    const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)
    setup([
      timedMeeting('Sprint Planning'),
      allDayMeeting('today-holiday', 'Today Holiday', today),
      allDayMeeting('tomorrow-holiday', 'Tomorrow Holiday', tomorrow)
    ])

    renderToday()

    const timedRow = await screen.findByText('Sprint Planning')
    const todayHoliday = await screen.findByText('Today Holiday')
    expect(screen.getByText('All day')).toBeInTheDocument()

    // Tomorrow's holiday must never leak into today.
    expect(screen.queryByText('Tomorrow Holiday')).not.toBeInTheDocument()

    // The all-day banner sits AFTER the timed schedule in document order.
    const order = timedRow.compareDocumentPosition(todayHoliday)
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('renders no all-day banner when only tomorrow has a holiday', async () => {
    const today = new Date()
    const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)
    setup([timedMeeting('Sprint Planning'), allDayMeeting('tomorrow-holiday', 'Tomorrow Holiday', tomorrow)])

    renderToday()
    await screen.findByText('Sprint Planning')
    expect(screen.queryByText('All day')).not.toBeInTheDocument()
    expect(screen.queryByText('Tomorrow Holiday')).not.toBeInTheDocument()
  })
})
