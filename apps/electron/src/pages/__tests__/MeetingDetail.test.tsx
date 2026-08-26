import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { MeetingDetail } from '../MeetingDetail'

// Mock the UI store
vi.mock('@/store/useUIStore', () => ({
  useUIStore: vi.fn((selector) => {
    const state = {
      currentlyPlayingId: null,
      playbackCurrentTime: 0,
      setCurrentlyPlayingId: vi.fn(),
    }
    return typeof selector === 'function' ? selector(state) : state
  }),
}))

// Mock audio controls
vi.mock('@/components/OperationController', () => ({
  useAudioControls: vi.fn(() => ({
    play: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(),
    seek: vi.fn(),
    setPlaybackRate: vi.fn(),
    isPlaying: false,
    currentTime: 0,
    duration: 0,
  })),
}))

// Mock toast
vi.mock('@/components/ui/toaster', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}))

// Mock electronAPI
const mockGetDetails = vi.fn()
const mockGetByMeeting = vi.fn()
const mockUpdate = vi.fn()
const mockSelectMeeting = vi.fn()
const mockGetCandidates = vi.fn()
const mockGetForMeeting = vi.fn()
const mockAddAttendee = vi.fn()
const mockRemoveAttendee = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  mockGetForMeeting.mockResolvedValue({ success: true, data: [] })
  mockAddAttendee.mockResolvedValue({ success: true, data: { id: 'ct-new', name: 'Carol' } })
  mockRemoveAttendee.mockResolvedValue({ success: true })
  ;(window as any).electronAPI = {
    meetings: {
      getDetails: mockGetDetails,
      update: mockUpdate,
      addAttendee: mockAddAttendee,
      removeAttendee: mockRemoveAttendee,
    },
    recordings: {
      selectMeeting: mockSelectMeeting,
      getCandidates: mockGetCandidates,
    },
    actionables: {
      getByMeeting: mockGetByMeeting,
    },
    contacts: {
      // R28-RES-1 (round-29): MeetingDetail is an OWNER surface → it now calls the
      // existence-scoped owner accessor. Point it at the same mock as the gated
      // default so the existing fixtures drive it unchanged.
      getForMeeting: mockGetForMeeting,
      getForMeetingOwner: mockGetForMeeting,
      // Used by the embedded TranscriptViewer's speaker picker.
      getAll: vi.fn().mockResolvedValue({ success: true, data: { contacts: [], total: 0 } }),
    },
    // The embedded TranscriptViewer loads/assigns speaker maps for recordings
    // that have a transcript.
    transcripts: {
      getSpeakerMap: vi.fn().mockResolvedValue({ success: true, data: [] }),
      assignSpeaker: vi.fn().mockResolvedValue({ success: true, data: { id: 'c1', name: 'Alice' } }),
      unassignSpeaker: vi.fn().mockResolvedValue({ success: true }),
    },
  }
})

function renderMeetingDetail(meetingId: string) {
  return render(
    <MemoryRouter initialEntries={[`/meeting/${meetingId}`]}>
      <Routes>
        <Route path="/meeting/:id" element={<MeetingDetail />} />
        <Route path="/calendar" element={<div>Calendar Page</div>} />
      </Routes>
    </MemoryRouter>
  )
}

const validMeetingDetails = {
  meeting: {
    id: 'm1',
    subject: 'Test Meeting',
    start_time: '2026-03-02T10:00:00.000Z',
    end_time: '2026-03-02T11:00:00.000Z',
    location: 'Room A',
    organizer_name: 'John Doe',
    organizer_email: 'john@example.com',
    attendees: JSON.stringify([
      { name: 'Alice', email: 'alice@example.com' },
      { name: 'Bob', email: 'bob@example.com' },
    ]),
    description: 'Discussion about project',
    is_recurring: 0,
    recurrence_rule: null,
    meeting_url: null,
    created_at: '2026-03-01T00:00:00.000Z',
    updated_at: '2026-03-01T00:00:00.000Z',
  },
  recordings: [],
  actionables: [],
}

describe('MeetingDetail', () => {
  describe('C-MTG-005: durationMins NaN guard', () => {
    it('should show 0 minutes for invalid date strings', async () => {
      const details = {
        ...validMeetingDetails,
        meeting: {
          ...validMeetingDetails.meeting,
          start_time: 'invalid-date',
          end_time: 'also-invalid',
        },
      }
      mockGetDetails.mockResolvedValue(details)
      mockGetByMeeting.mockResolvedValue([])

      renderMeetingDetail('m1')

      await waitFor(() => {
        expect(screen.getByText(/0 minutes/)).toBeInTheDocument()
      })
    })

    it('should calculate correct duration for valid dates', async () => {
      mockGetDetails.mockResolvedValue(validMeetingDetails)
      mockGetByMeeting.mockResolvedValue([])

      renderMeetingDetail('m1')

      await waitFor(() => {
        expect(screen.getByText(/60 minutes/)).toBeInTheDocument()
      })
    })
  })

  describe('Empty recordings state', () => {
    it('should show empty state when no recordings are linked', async () => {
      mockGetDetails.mockResolvedValue(validMeetingDetails)
      mockGetByMeeting.mockResolvedValue([])

      renderMeetingDetail('m1')

      await waitFor(() => {
        expect(screen.getByText('No recordings linked')).toBeInTheDocument()
        expect(screen.getByText(/Recordings are automatically linked/)).toBeInTheDocument()
        expect(screen.getByText('Go to Calendar')).toBeInTheDocument()
      })
    })

    it('should show recordings count badge', async () => {
      const detailsWithRecordings = {
        ...validMeetingDetails,
        recordings: [
          {
            id: 'r1',
            filename: 'recording.wav',
            original_filename: null,
            file_path: '/path/to/file.wav',
            file_size: 1024,
            duration_seconds: 3600,
            date_recorded: '2026-03-02T10:00:00Z',
            meeting_id: 'm1',
            correlation_confidence: null,
            correlation_method: null,
            status: 'transcribed' as const,
            created_at: '2026-03-02T10:00:00Z',
            migration_status: null,
            migrated_to_capture_id: null,
            migrated_at: null,
            transcript: null,
          },
        ],
      }
      mockGetDetails.mockResolvedValue(detailsWithRecordings)
      mockGetByMeeting.mockResolvedValue([])

      renderMeetingDetail('m1')

      await waitFor(() => {
        expect(screen.getByText('Recordings (1)')).toBeInTheDocument()
      })
    })
  })

  describe('Loading and error states', () => {
    it('should show loading state initially', () => {
      mockGetDetails.mockReturnValue(new Promise(() => {})) // never resolves
      mockGetByMeeting.mockResolvedValue([])

      renderMeetingDetail('m1')

      expect(screen.getByText('Loading meeting details...')).toBeInTheDocument()
    })

    it('should show error state on failure', async () => {
      mockGetDetails.mockRejectedValue(new Error('Network error'))

      renderMeetingDetail('m1')

      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument()
        expect(screen.getByText('Retry')).toBeInTheDocument()
      })
    })

    it('should show not found when details are null', async () => {
      mockGetDetails.mockResolvedValue(null)

      renderMeetingDetail('m1')

      await waitFor(() => {
        expect(screen.getByText('Meeting not found')).toBeInTheDocument()
      })
    })
  })

  describe('Attendees display', () => {
    it('should show attendees when present', async () => {
      mockGetDetails.mockResolvedValue(validMeetingDetails)
      mockGetByMeeting.mockResolvedValue([])

      renderMeetingDetail('m1')

      await waitFor(() => {
        expect(screen.getByText('Alice')).toBeInTheDocument()
        expect(screen.getByText('Bob')).toBeInTheDocument()
        expect(screen.getByText('Attendees (2)')).toBeInTheDocument()
      })
    })

    it('should link a resolved attendee chip and remove it in edit mode', async () => {
      mockGetDetails.mockResolvedValue(validMeetingDetails)
      mockGetByMeeting.mockResolvedValue([])
      // Alice resolves to a canonical contact (matched by email)
      mockGetForMeeting.mockResolvedValue({
        success: true,
        data: [{ id: 'ct1', name: 'Alice', email: 'alice@example.com', notes: null, first_seen_at: '', last_seen_at: '', meeting_count: 1, created_at: '' }],
      })

      renderMeetingDetail('m1')
      await screen.findByText('Alice')

      // Enter edit mode → resolved chip exposes a remove (X) control
      fireEvent.click(screen.getByRole('button', { name: /Edit/i }))
      fireEvent.click(await screen.findByLabelText('Remove Alice'))

      await waitFor(() =>
        expect(mockRemoveAttendee).toHaveBeenCalledWith({ meetingId: 'm1', contactId: 'ct1' })
      )
    })

    it('should add a new attendee from the inline form', async () => {
      mockGetDetails.mockResolvedValue(validMeetingDetails)
      mockGetByMeeting.mockResolvedValue([])

      renderMeetingDetail('m1')
      await screen.findByText('Alice')

      fireEvent.click(screen.getByRole('button', { name: /Edit/i }))

      fireEvent.change(await screen.findByLabelText('New attendee name'), { target: { value: 'Carol' } })
      fireEvent.change(screen.getByLabelText('New attendee email'), { target: { value: 'carol@example.com' } })
      fireEvent.click(screen.getByRole('button', { name: 'Add' }))

      await waitFor(() =>
        expect(mockAddAttendee).toHaveBeenCalledWith({
          meetingId: 'm1',
          name: 'Carol',
          email: 'carol@example.com',
        })
      )
    })

    it('should truncate attendees list when over limit and show expand button', async () => {
      // Create 10 attendees (over the ATTENDEES_COLLAPSED_LIMIT of 8)
      const manyAttendees = Array.from({ length: 10 }, (_, i) => ({
        name: `Person ${i + 1}`,
        email: `person${i + 1}@example.com`,
      }))
      const details = {
        ...validMeetingDetails,
        meeting: {
          ...validMeetingDetails.meeting,
          attendees: JSON.stringify(manyAttendees),
        },
      }
      mockGetDetails.mockResolvedValue(details)
      mockGetByMeeting.mockResolvedValue([])

      renderMeetingDetail('m1')

      await waitFor(() => {
        expect(screen.getByText('Attendees (10)')).toBeInTheDocument()
        // First 8 should be visible
        expect(screen.getByText('Person 1')).toBeInTheDocument()
        expect(screen.getByText('Person 8')).toBeInTheDocument()
        // Person 9 and 10 should NOT be visible (collapsed)
        expect(screen.queryByText('Person 9')).not.toBeInTheDocument()
        // Show all button should be present
        expect(screen.getByText('Show all 10 attendees')).toBeInTheDocument()
      })
    })
  })

  describe('Join meeting visibility (past vs upcoming)', () => {
    const withJoinUrl = (start: string, end: string) => ({
      ...validMeetingDetails,
      meeting: {
        ...validMeetingDetails.meeting,
        start_time: start,
        end_time: end,
        meeting_url: 'https://teams.microsoft.com/l/meetup-join/xyz',
      },
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('hides the Join button for a meeting that ended well in the past', async () => {
      vi.useFakeTimers()
      // "Now" is a month after the meeting ended.
      vi.setSystemTime(new Date('2026-07-04T12:00:00.000Z'))

      mockGetDetails.mockResolvedValue(
        withJoinUrl('2026-06-04T10:00:00.000Z', '2026-06-04T11:00:00.000Z')
      )
      mockGetByMeeting.mockResolvedValue([])

      renderMeetingDetail('m1')

      await vi.waitFor(() => {
        expect(screen.getByText('Test Meeting')).toBeInTheDocument()
      })
      expect(screen.queryByRole('link', { name: /Join meeting/i })).not.toBeInTheDocument()
    })

    it('shows the Join button for a current/upcoming meeting', async () => {
      vi.useFakeTimers()
      // "Now" is before the meeting ends (meeting is in progress / upcoming).
      vi.setSystemTime(new Date('2026-06-04T10:30:00.000Z'))

      mockGetDetails.mockResolvedValue(
        withJoinUrl('2026-06-04T10:00:00.000Z', '2026-06-04T11:00:00.000Z')
      )
      mockGetByMeeting.mockResolvedValue([])

      renderMeetingDetail('m1')

      await vi.waitFor(() => {
        expect(screen.getByRole('link', { name: /Join meeting/i })).toBeInTheDocument()
      })
    })

    it('still shows Join within the grace window just after a meeting ends', async () => {
      vi.useFakeTimers()
      // 5 minutes after end — inside the 15-minute grace window.
      vi.setSystemTime(new Date('2026-06-04T11:05:00.000Z'))

      mockGetDetails.mockResolvedValue(
        withJoinUrl('2026-06-04T10:00:00.000Z', '2026-06-04T11:00:00.000Z')
      )
      mockGetByMeeting.mockResolvedValue([])

      renderMeetingDetail('m1')

      await vi.waitFor(() => {
        expect(screen.getByRole('link', { name: /Join meeting/i })).toBeInTheDocument()
      })
    })
  })

  describe('Recording status badge (defect: unexplained "none" badge)', () => {
    const recordingWithStatus = (status: string) => ({
      id: 'r1',
      filename: 'recording.wav',
      original_filename: null,
      file_path: '/path/to/file.wav',
      file_size: 1024,
      duration_seconds: 3600,
      date_recorded: '2026-03-02T10:00:00Z',
      meeting_id: 'm1',
      correlation_confidence: null,
      correlation_method: null,
      status,
      created_at: '2026-03-02T10:00:00Z',
      migration_status: null,
      migrated_to_capture_id: null,
      migrated_at: null,
      transcript: null,
    })

    it('renders a plain-language label with an explanatory title instead of raw "none"', async () => {
      mockGetDetails.mockResolvedValue({
        ...validMeetingDetails,
        recordings: [recordingWithStatus('none')],
      })
      mockGetByMeeting.mockResolvedValue([])

      renderMeetingDetail('m1')

      const badge = await screen.findByText('Not transcribed')
      expect(badge).toBeInTheDocument()
      expect(badge).toHaveAttribute('title', 'Transcription status: Not transcribed')
      // The raw, meaningless "none" must not leak into the UI.
      expect(screen.queryByText('none')).not.toBeInTheDocument()
    })
  })

  describe('Embedded transcript uses the interactive TranscriptViewer', () => {
    const recordingWithTranscript = {
      id: 'r1',
      filename: 'recording.wav',
      original_filename: null,
      file_path: '/path/to/file.wav',
      file_size: 1024,
      duration_seconds: 3600,
      date_recorded: '2026-03-02T10:00:00Z',
      meeting_id: 'm1',
      correlation_confidence: null,
      correlation_method: null,
      status: 'transcribed',
      created_at: '2026-03-02T10:00:00Z',
      migration_status: null,
      migrated_to_capture_id: null,
      migrated_at: null,
      transcript: {
        id: 't1',
        recording_id: 'r1',
        full_text: 'ignored plain text',
        language: 'en',
        summary: 'A quick sync.',
        action_items: null,
        topics: null,
        key_points: null,
        sentiment: null,
        speakers: JSON.stringify([
          { speaker: 'Speaker 1', start: 3, end: 7, text: 'Hola, buenos días.' },
          { speaker: 'Speaker 2', start: 7, end: 12, text: 'Buenos días a todos.' },
        ]),
        word_count: 6,
        transcription_provider: 'gemini',
        transcription_model: 'gemini-2.0',
        title_suggestion: null,
        question_suggestions: null,
        created_at: '2026-03-02T10:00:00Z',
      },
    }

    it('renders clickable/assignable speaker labels and per-turn timestamps', async () => {
      mockGetDetails.mockResolvedValue({
        ...validMeetingDetails,
        recordings: [recordingWithTranscript],
      })
      mockGetByMeeting.mockResolvedValue([])

      renderMeetingDetail('m1')

      // Wait for the recording row (and its embedded transcript) to render.
      await screen.findByText('Recordings (1)')

      // Speaker labels are interactive assign buttons (same affordance as the
      // Library reader), not plain text.
      const assignBtn = await screen.findByRole('button', { name: /Assign speaker Speaker 1/i })
      expect(assignBtn).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Assign speaker Speaker 2/i })).toBeInTheDocument()

      // Per-turn timestamps render (0:03 for the first turn at 3s).
      expect(screen.getByText('0:03')).toBeInTheDocument()

      // The structured turns are used, not the plain full_text blob.
      expect(screen.queryByText('ignored plain text')).not.toBeInTheDocument()
    })
  })
})
