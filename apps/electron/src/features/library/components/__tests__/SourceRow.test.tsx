import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SourceRow } from '../SourceRow'
import type { UnifiedRecording } from '@/types/unified-recording'
import type { Meeting } from '@/types'

const baseRecording: UnifiedRecording = {
  id: 'r1',
  filename: '2026Jul08-190246-Rec49.hda',
  title: 'Quarterly planning',
  dateRecorded: new Date('2026-07-08T19:02:46'),
  duration: 2680, // 44m 40s
  size: 1000,
  location: 'local-only',
  syncStatus: 'synced',
  localPath: '/tmp/rec.wav',
  transcriptionStatus: 'complete'
}

const defaultProps = {
  recording: baseRecording,
  isPlaying: false,
  onPlay: vi.fn(),
  onStop: vi.fn()
}

describe('SourceRow second line', () => {
  it('shows human date + start time + duration, not the machine filename', () => {
    render(<SourceRow {...defaultProps} />)

    // Locate the second line by its distinctive parts: date, a 12h time, duration.
    const line = screen.getByText((content) => /Jul 8/.test(content) && /PM|AM/.test(content) && /44m/.test(content))
    expect(line).toBeInTheDocument()
    expect(line.textContent).not.toContain('.hda')
  })

  it('keeps the raw filename discoverable as the second-line tooltip', () => {
    render(<SourceRow {...defaultProps} />)
    const line = screen.getByText((content) => /44m/.test(content))
    expect(line).toHaveAttribute('title', '2026Jul08-190246-Rec49.hda')
  })

  it('does not attach a filename tooltip when the filename IS the title', () => {
    const rec = { ...baseRecording, title: undefined }
    render(<SourceRow {...defaultProps} recording={rec} />)
    const line = screen.getByText((content) => /44m/.test(content))
    expect(line).not.toHaveAttribute('title')
  })
})

describe('SourceRow meeting provenance chip', () => {
  const meeting: Meeting = {
    id: 'm1',
    subject: 'Quarterly planning',
    start_time: '2026-07-08T18:30:00',
    end_time: '2026-07-08T19:30:00',
    location: null,
    organizer_name: null,
    organizer_email: null,
    attendees: null,
    description: null,
    is_recurring: 0,
    recurrence_rule: null,
    meeting_url: null,
    created_at: '',
    updated_at: ''
  }

  it('renders a calendar chip labelling the linked meeting', () => {
    render(<SourceRow {...defaultProps} meeting={meeting} />)
    expect(screen.getByLabelText(/Linked to calendar meeting: Quarterly planning/i)).toBeInTheDocument()
  })

  it('renders no calendar chip when there is no linked meeting', () => {
    render(<SourceRow {...defaultProps} />)
    expect(screen.queryByLabelText(/Linked to calendar meeting/i)).not.toBeInTheDocument()
  })
})
