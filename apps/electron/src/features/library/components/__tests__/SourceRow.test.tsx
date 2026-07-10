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
  recording: baseRecording
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

describe('SourceRow never renders blank (title + dated second line always present)', () => {
  it('shows a human title AND a date carrying the year AND the duration', () => {
    render(<SourceRow {...defaultProps} />)
    // Title is visible (regression guard for the "blank rows" bug).
    expect(screen.getByText('Quarterly planning')).toBeInTheDocument()
    // Second line shows the YEAR (a year-old capture must not read like this week's)
    // + the real duration, not blank / "Unknown".
    const line = screen.getByText((c) => /2026/.test(c) && /Jul 8/.test(c) && /44m/.test(c))
    expect(line).toBeInTheDocument()
    expect(line.textContent).not.toContain('Unknown')
  })

  it('falls back to the filename as the title when nothing better exists', () => {
    const rec = { ...baseRecording, title: undefined, meetingSubject: undefined }
    render(<SourceRow {...defaultProps} recording={rec} />)
    // Title <p> is never empty — the filename is the guaranteed fallback.
    expect(screen.getByText('2026Jul08-190246-Rec49.hda')).toBeInTheDocument()
  })
})

describe('SourceRow has no per-row Play/Stop button', () => {
  it('renders no Play control (playback lives in the mid-panel player)', () => {
    render(<SourceRow {...defaultProps} onSelectionChange={vi.fn()} />)
    expect(screen.queryByLabelText(/Play capture|Download to play|File missing/i)).not.toBeInTheDocument()
  })

  it('renders no Stop control', () => {
    render(<SourceRow {...defaultProps} onSelectionChange={vi.fn()} />)
    expect(screen.queryByLabelText(/Stop playback/i)).not.toBeInTheDocument()
  })

  it('still exposes the overflow "More actions" menu', () => {
    render(<SourceRow {...defaultProps} onSelectionChange={vi.fn()} />)
    expect(screen.getByLabelText(/More actions/i)).toBeInTheDocument()
  })
})

describe('SourceRow selection checkbox visibility', () => {
  const getCheckbox = () => screen.getByLabelText(/^Select /i)

  it('renders no checkbox at all when selection is not wired', () => {
    render(<SourceRow {...defaultProps} />)
    expect(screen.queryByLabelText(/^Select /i)).not.toBeInTheDocument()
  })

  it('is hidden by default (revealed only on hover/focus)', () => {
    render(<SourceRow {...defaultProps} onSelectionChange={vi.fn()} />)
    const cb = getCheckbox()
    // opacity-0 keeps it out of sight until the row is hovered/focused.
    expect(cb.className).toContain('opacity-0')
    expect(cb.className).toContain('group-hover:opacity-100')
  })

  it('is visible when this row is selected', () => {
    render(<SourceRow {...defaultProps} onSelectionChange={vi.fn()} isSelected />)
    const cb = getCheckbox()
    expect(cb.className).toContain('opacity-100')
    expect(cb.className).not.toContain('opacity-0')
  })

  it('is visible for every row while selection mode is active (anySelected)', () => {
    render(<SourceRow {...defaultProps} onSelectionChange={vi.fn()} isSelected={false} anySelected />)
    const cb = getCheckbox()
    expect(cb.className).toContain('opacity-100')
    expect(cb.className).not.toContain('opacity-0')
  })
})
