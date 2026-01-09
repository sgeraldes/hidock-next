import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SourceRowExpanded } from '@/features/library/components/SourceRowExpanded'
import { UnifiedRecording } from '@/types/unified-recording'

describe('SourceRowExpanded', () => {
  const mockRecording: UnifiedRecording = {
    id: 'test-123',
    filename: 'test-recording.wav',
    dateRecorded: new Date('2024-01-15T10:30:00'),
    duration: 3600,
    size: 1024 * 1024,
    quality: 'high',
    category: 'meeting',
    location: 'both',
    transcriptionStatus: 'complete',
    localPath: '/path/to/recording.wav',
    devicePath: '/device/path'
  }

  const defaultProps = {
    recording: mockRecording,
    isPlaying: false,
    isDownloading: false,
    isDeleting: false,
    deviceConnected: false,
    onPlay: vi.fn(),
    onStop: vi.fn(),
    onDownload: vi.fn(),
    onDelete: vi.fn(),
    onTranscribe: vi.fn(),
    onAskAssistant: vi.fn(),
    onGenerateOutput: vi.fn(),
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
    expect(screen.getByText(/high/i)).toBeInTheDocument()
    expect(screen.getByText(/meeting/i)).toBeInTheDocument()
  })

  it('renders play button', () => {
    render(<SourceRowExpanded {...defaultProps} />)

    const playButton = screen.getByRole('button', { name: /play/i })
    expect(playButton).toBeInTheDocument()
    expect(playButton).not.toBeDisabled()
  })

  it('renders stop button when playing', () => {
    render(<SourceRowExpanded {...defaultProps} isPlaying={true} />)

    const stopButton = screen.getByRole('button', { name: /stop/i })
    expect(stopButton).toBeInTheDocument()
  })

  it('renders delete button', () => {
    render(<SourceRowExpanded {...defaultProps} />)

    const deleteButton = screen.getByRole('button', { name: /delete/i })
    expect(deleteButton).toBeInTheDocument()
  })

  it('renders ask assistant button', () => {
    render(<SourceRowExpanded {...defaultProps} />)

    const assistantButton = screen.getByRole('button', { name: /ask assistant/i })
    expect(assistantButton).toBeInTheDocument()
  })

  it('renders generate output button', () => {
    render(<SourceRowExpanded {...defaultProps} />)

    const generateButton = screen.getByRole('button', { name: /generate output/i })
    expect(generateButton).toBeInTheDocument()
  })

  it('renders download button for device-only recordings', () => {
    const deviceOnlyRecording: UnifiedRecording = {
      ...mockRecording,
      location: 'device-only',
      localPath: undefined
    }

    render(
      <SourceRowExpanded
        {...defaultProps}
        recording={deviceOnlyRecording}
        deviceConnected={true}
      />
    )

    const downloadButton = screen.getByRole('button', { name: /download/i })
    expect(downloadButton).toBeInTheDocument()
  })

  it('renders transcribe button for local recordings without transcript', () => {
    const recordingWithoutTranscript: UnifiedRecording = {
      ...mockRecording,
      transcriptionStatus: 'none'
    }

    render(
      <SourceRowExpanded
        {...defaultProps}
        recording={recordingWithoutTranscript}
      />
    )

    const transcribeButton = screen.getByRole('button', { name: /transcribe/i })
    expect(transcribeButton).toBeInTheDocument()
  })

  it('does not render transcribe button for transcribed recordings', () => {
    render(<SourceRowExpanded {...defaultProps} />)

    const transcribeButton = screen.queryByRole('button', { name: /transcribe/i })
    expect(transcribeButton).not.toBeInTheDocument()
  })

  it('renders meeting card when meeting is provided', () => {
    const meeting = {
      id: 'meeting-123',
      subject: 'Team Standup',
      start_time: '2024-01-15T09:00:00',
      end_time: '2024-01-15T09:30:00',
      attendees: [],
      location: 'Conference Room A'
    }

    render(<SourceRowExpanded {...defaultProps} meeting={meeting} />)

    expect(screen.getByText(/Team Standup/i)).toBeInTheDocument()
  })

  it('renders transcript summary when transcript is provided', () => {
    const transcript = {
      id: 'transcript-123',
      recording_id: 'test-123',
      summary: 'This is a test summary of the recording.',
      text: 'Full transcript text',
      created_at: '2024-01-15T10:35:00'
    }

    render(<SourceRowExpanded {...defaultProps} transcript={transcript} />)

    expect(screen.getByText(/This is a test summary/i)).toBeInTheDocument()
  })

  it('disables play button when recording has no local path', () => {
    const deviceOnlyRecording: UnifiedRecording = {
      ...mockRecording,
      location: 'device-only',
      localPath: undefined
    }

    render(<SourceRowExpanded {...defaultProps} recording={deviceOnlyRecording} />)

    const playButton = screen.getByRole('button', { name: /play/i })
    expect(playButton).toBeDisabled()
  })
})
