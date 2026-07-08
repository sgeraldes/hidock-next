import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { LiveRecordingCard, parseRecordingStart, type LiveMeeting } from '../LiveRecordingCard'
import { useAppStore } from '@/store'

const FILENAME = '2025Jul08-100000-Rec1.hda'

function meeting(id: string, subject: string): LiveMeeting {
  return { id, subject, start_time: '2025-07-08T10:00:00Z', end_time: '2025-07-08T11:00:00Z' }
}

const preassign = vi.fn()
const getPreassignment = vi.fn().mockResolvedValue({ success: true, data: null })

beforeEach(() => {
  vi.clearAllMocks()
  getPreassignment.mockResolvedValue({ success: true, data: null })
  global.window.electronAPI = {
    recordings: { preassign, getPreassignment }
  } as any
  useAppStore.setState({ deviceRecording: false, activeRecordingFilename: null })
})

afterEach(() => {
  useAppStore.setState({ deviceRecording: false, activeRecordingFilename: null })
})

function renderCard(inProgress: LiveMeeting[], all: LiveMeeting[] = inProgress) {
  return render(<LiveRecordingCard inProgressMeetings={inProgress} allMeetings={all} />)
}

describe('parseRecordingStart', () => {
  it('parses the month-name filename form', () => {
    const d = parseRecordingStart('2025Jul08-100000-Rec1.hda')
    expect(d).not.toBeNull()
    expect(d?.getFullYear()).toBe(2025)
    expect(d?.getMonth()).toBe(6) // July
    expect(d?.getDate()).toBe(8)
  })

  it('parses the numeric filename form', () => {
    const d = parseRecordingStart('20250708100000REC001.wav')
    expect(d).not.toBeNull()
    expect(d?.getMonth()).toBe(6)
  })

  it('returns null for an unrecognised filename', () => {
    expect(parseRecordingStart('random.hda')).toBeNull()
  })
})

describe('LiveRecordingCard', () => {
  it('renders nothing when the device is not recording', () => {
    useAppStore.setState({ deviceRecording: false, activeRecordingFilename: null })
    const { container } = renderCard([meeting('m1', 'Standup')])
    expect(container.firstChild).toBeNull()
  })

  it('auto-attributes to the single in-progress meeting', async () => {
    useAppStore.setState({ deviceRecording: true, activeRecordingFilename: FILENAME })
    renderCard([meeting('m1', 'Sprint Planning')])

    expect(await screen.findByText('Recording now')).toBeInTheDocument()
    expect(screen.getByText('Sprint Planning')).toBeInTheDocument()
    expect(screen.getByText(/Will be attributed to/)).toBeInTheDocument()
    expect(screen.getByText('Not a calendar meeting')).toBeInTheDocument()
  })

  it('shows the standalone message when no meeting is in progress', async () => {
    useAppStore.setState({ deviceRecording: true, activeRecordingFilename: FILENAME })
    renderCard([], [])

    expect(await screen.findByText(/No calendar meeting right now/)).toBeInTheDocument()
  })

  it('asks which meeting when two are in progress and persists the pick', async () => {
    useAppStore.setState({ deviceRecording: true, activeRecordingFilename: FILENAME })
    renderCard([meeting('m1', 'Design Review'), meeting('m2', 'Outage Call')])

    expect(await screen.findByText('Which meeting is this?')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Outage Call'))

    await waitFor(() => expect(preassign).toHaveBeenCalledWith(FILENAME, 'm2'))
  })

  it('marks the recording standalone via "Not a calendar meeting"', async () => {
    useAppStore.setState({ deviceRecording: true, activeRecordingFilename: FILENAME })
    renderCard([meeting('m1', 'Sprint Planning')])

    fireEvent.click(await screen.findByText('Not a calendar meeting'))

    await waitFor(() => expect(preassign).toHaveBeenCalledWith(FILENAME, null))
  })

  it('reflects a previously-saved explicit attribution', async () => {
    getPreassignment.mockResolvedValue({ success: true, data: { filename: FILENAME, meeting_id: 'm2' } })
    useAppStore.setState({ deviceRecording: true, activeRecordingFilename: FILENAME })
    renderCard([meeting('m1', 'Design Review')], [meeting('m1', 'Design Review'), meeting('m2', 'Client Call')])

    // The saved choice (m2) wins even though m1 is the one in progress.
    expect(await screen.findByText('Client Call')).toBeInTheDocument()
    expect(screen.getByText(/Will be attributed to/)).toBeInTheDocument()
  })
})
