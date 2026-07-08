import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MeetingHoverCard } from '../EntityHoverCards'
import { resetMeetingParticipantsCache } from '@/lib/meeting-participants'

beforeEach(() => {
  vi.clearAllMocks()
  resetMeetingParticipantsCache()
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
      contacts: { getForMeeting }
    } as any

    render(<MeetingHoverCard id="m1" name="Sprint Planning" />)

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
      contacts: { getForMeeting }
    } as any

    render(<MeetingHoverCard id="m2" name="Big Meeting" />)

    expect(await screen.findByText('+2 more')).toBeInTheDocument()
    expect(screen.getByText('Person 0')).toBeInTheDocument()
    // Sixth and seventh names collapse into the overflow counter.
    expect(screen.queryByText('Person 5')).toBeNull()
  })

  it('shows "No known participants" when getForMeeting returns none', async () => {
    const getForMeeting = vi.fn().mockResolvedValue({ success: true, data: [] })
    global.window.electronAPI = {
      meetings: { getById: vi.fn().mockResolvedValue({ subject: 'Solo' }) },
      contacts: { getForMeeting }
    } as any

    render(<MeetingHoverCard id="m3" name="Solo" />)

    expect(await screen.findByText('No known participants')).toBeInTheDocument()
  })

  it('degrades gracefully when the contacts API is unavailable', async () => {
    global.window.electronAPI = {
      meetings: { getById: vi.fn().mockResolvedValue({ subject: 'Legacy' }) }
    } as any

    render(<MeetingHoverCard id="m4" name="Legacy" />)

    // No throw; the empty state renders once the (failed) fetch settles.
    expect(await screen.findByText('No known participants')).toBeInTheDocument()
  })
})
