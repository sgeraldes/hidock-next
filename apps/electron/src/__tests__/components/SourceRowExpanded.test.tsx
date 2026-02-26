import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SourceRowExpanded } from '@/features/library/components/SourceRowExpanded'
import type { UnifiedRecording } from '@/types/unified-recording'
import type { Meeting, Transcript } from '@/types'

describe('SourceRowExpanded', () => {
  const mockRecording: UnifiedRecording = {
    id: 'test-123',
    filename: 'test-recording.wav',
    dateRecorded: new Date('2024-01-15T10:30:00'),
    duration: 3600,
    size: 1024 * 1024,
    quality: 'valuable',
    category: 'meeting',
    location: 'both',
    syncStatus: 'synced',
    transcriptionStatus: 'complete',
    localPath: '/path/to/recording.wav',
    deviceFilename: 'REC001.hda'
  }

  const defaultProps = {
    recording: mockRecording,
    onNavigateToMeeting: vi.fn()
  }

  it('renders metadata grid with recording details', () => {
    render(<SourceRowExpanded {...defaultProps} />)

    // Check for metadata labels
    expect(screen.getByText(/Date Recorded/i)).toBeInTheDocument()
    expect(screen.getByText(/Duration/i)).toBeInTheDocument()
    expect(screen.getByText(/Size/i)).toBeInTheDocument()
    expect(screen.getByText(/Quality/i)).toBeInTheDocument()

    // Check for values
    expect(screen.getByText(/valuable/i)).toBeInTheDocument()
    expect(screen.getByText(/meeting/i)).toBeInTheDocument()
  })

  it('renders meeting card when meeting is provided', () => {
    const meeting: Meeting = {
      id: 'meeting-123',
      subject: 'Team Standup',
      start_time: '2024-01-15T09:00:00',
      end_time: '2024-01-15T09:30:00',
      attendees: null,
      location: 'Conference Room A',
      organizer_name: 'John Doe',
      organizer_email: 'john@example.com',
      description: null,
      is_recurring: 0,
      recurrence_rule: null,
      meeting_url: null,
      created_at: '2024-01-15T08:00:00',
      updated_at: '2024-01-15T08:00:00'
    }

    render(<SourceRowExpanded {...defaultProps} meeting={meeting} />)

    expect(screen.getByText(/Team Standup/i)).toBeInTheDocument()
  })

  it('renders transcript summary when transcript is provided', () => {
    const transcript: Transcript = {
      id: 'transcript-123',
      recording_id: 'test-123',
      full_text: 'Full transcript text',
      language: 'en',
      summary: 'This is a test summary of the recording.',
      action_items: null,
      topics: null,
      key_points: null,
      sentiment: null,
      speakers: null,
      word_count: 100,
      transcription_provider: 'openai',
      transcription_model: 'whisper-1',
      title_suggestion: null,
      question_suggestions: null,
      created_at: '2024-01-15T10:35:00'
    }

    render(<SourceRowExpanded {...defaultProps} transcript={transcript} />)

    expect(screen.getByText(/This is a test summary/i)).toBeInTheDocument()
  })

  it('shows device-only notice for device recordings', () => {
    const deviceOnlyRecording: UnifiedRecording = {
      id: 'test-456',
      filename: 'device-recording.wav',
      dateRecorded: new Date('2024-01-15T10:30:00'),
      duration: 3600,
      size: 1024 * 1024,
      category: 'meeting',
      location: 'device-only',
      deviceFilename: 'REC002.hda',
      syncStatus: 'not-synced',
      transcriptionStatus: 'none'
    }

    render(<SourceRowExpanded {...defaultProps} recording={deviceOnlyRecording} />)

    expect(screen.getByText(/Download this capture/i)).toBeInTheDocument()
  })

  it('renders location and transcription status', () => {
    render(<SourceRowExpanded {...defaultProps} />)

    expect(screen.getByText(/Location/i)).toBeInTheDocument()
    expect(screen.getByText(/Transcription/i)).toBeInTheDocument()
  })
})
