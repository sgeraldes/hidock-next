import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { MeetingDetail } from '../MeetingDetail'

// Mock the UI store
vi.mock('@/store/useUIStore', () => ({
  useUIStore: vi.fn((selector) => {
    const state = {
      currentlyPlayingId: null,
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
    stop: vi.fn(),
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

beforeEach(() => {
  vi.clearAllMocks()
  ;(window as any).electronAPI = {
    meetings: {
      getDetails: mockGetDetails,
      update: mockUpdate,
    },
    recordings: {
      selectMeeting: mockSelectMeeting,
      getCandidates: mockGetCandidates,
    },
    actionables: {
      getByMeeting: mockGetByMeeting,
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
})
