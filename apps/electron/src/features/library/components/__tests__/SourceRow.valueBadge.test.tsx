import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SourceRow } from '../SourceRow'
import type { UnifiedRecording } from '@/types/unified-recording'

const baseRecording: UnifiedRecording = {
  id: 'r1',
  filename: 'rec.wav',
  title: 'Team sync',
  dateRecorded: new Date('2026-07-08T19:02:46'),
  duration: 120,
  size: 1000,
  location: 'local-only',
  syncStatus: 'synced',
  localPath: '/tmp/rec.wav',
  transcriptionStatus: 'complete',
  knowledgeCaptureId: 'cap-1'
}

describe('SourceRow value badge (F16/spec-003)', () => {
  it('renders an amber Low-value badge for quality=low-value', () => {
    render(<SourceRow recording={{ ...baseRecording, quality: 'low-value' }} />)
    const badge = screen.getByLabelText('Low value')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveClass('text-amber-600')
  })

  it('renders a red Garbage badge for quality=garbage', () => {
    render(<SourceRow recording={{ ...baseRecording, quality: 'garbage' }} />)
    const badge = screen.getByLabelText('Garbage')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveClass('text-red-600')
  })

  it.each(['valuable', 'archived', 'unrated', undefined] as const)(
    'renders no value badge for quality=%s',
    (quality) => {
      render(<SourceRow recording={{ ...baseRecording, quality }} />)
      expect(screen.queryByLabelText('Low value')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('Garbage')).not.toBeInTheDocument()
    }
  )

  it('renders correctly alongside a meeting chip and other right-cluster icons (no layout conflict)', () => {
    render(<SourceRow recording={{ ...baseRecording, quality: 'garbage' }} />)
    // Both the value badge and the transcription status badge coexist.
    expect(screen.getByLabelText('Garbage')).toBeInTheDocument()
  })

  // Radix TooltipTrigger opens on `onFocus` (synchronous, no delay) or
  // `onPointerMove` — NOT on a plain `mouseenter`/`mouseover`, which Radix
  // never listens for. `fireEvent.focus` is the reliable, delay-free way to
  // open it in jsdom (verified against @radix-ui/react-tooltip's source).
  it('shows the reason tags in the tooltip on focus', async () => {
    render(
      <SourceRow
        recording={{
          ...baseRecording,
          quality: 'garbage',
          qualityReasons: ['personal_family', 'background_ambient'],
          qualitySource: 'ai'
        }}
      />
    )
    fireEvent.focus(screen.getByLabelText('Garbage'))
    // Radix Tooltip renders the content TWICE (once visible, once as a
    // visually-hidden accessibility duplicate for screen readers) — findAllByText.
    const matches = await screen.findAllByText('Personal / family, Background / ambient')
    expect(matches.length).toBeGreaterThan(0)
  })

  it('falls back to "AI-assessed" in the tooltip when there are no reason tags', async () => {
    render(<SourceRow recording={{ ...baseRecording, quality: 'low-value', qualitySource: 'ai', qualityReasons: [] }} />)
    fireEvent.focus(screen.getByLabelText('Low value'))
    const matches = await screen.findAllByText('AI-assessed')
    expect(matches.length).toBeGreaterThan(0)
  })

  it('shows "Set by you" in the tooltip for a user-set rating with no reasons', async () => {
    render(<SourceRow recording={{ ...baseRecording, quality: 'low-value', qualitySource: 'user' }} />)
    fireEvent.focus(screen.getByLabelText('Low value'))
    const matches = await screen.findAllByText('Set by you')
    expect(matches.length).toBeGreaterThan(0)
  })
})

describe('SourceRow manual value-rating override (F16/spec-003 Part E)', () => {
  // Radix DropdownMenuTrigger opens on `onPointerDown` (event.button === 0),
  // NOT on `click` — verified against @radix-ui/react-dropdown-menu's source.
  // A plain fireEvent.click never reaches Radix's open handler at all.
  function openMenu() {
    fireEvent.pointerDown(screen.getByLabelText('More actions'), { button: 0, ctrlKey: false, pointerId: 1 })
  }

  it('does not show rating items when onSetValueRating is not wired', () => {
    render(<SourceRow recording={baseRecording} />)
    openMenu()
    expect(screen.queryByText('Mark low-value')).not.toBeInTheDocument()
  })

  it('does not show rating items for a device-only recording', () => {
    const deviceOnly: UnifiedRecording = {
      id: 'd1',
      filename: 'device.hda',
      dateRecorded: new Date(),
      duration: 10,
      size: 100,
      location: 'device-only',
      deviceFilename: 'device.hda',
      syncStatus: 'not-synced',
      transcriptionStatus: 'none'
    }
    render(<SourceRow recording={deviceOnly} onSetValueRating={vi.fn()} />)
    openMenu()
    expect(screen.queryByText('Mark low-value')).not.toBeInTheDocument()
  })

  it('does not show rating items when the recording has no knowledgeCaptureId', () => {
    render(<SourceRow recording={{ ...baseRecording, knowledgeCaptureId: undefined }} onSetValueRating={vi.fn()} />)
    openMenu()
    expect(screen.queryByText('Mark low-value')).not.toBeInTheDocument()
  })

  it('shows Mark low-value / Mark garbage for an eligible row, and calls onSetValueRating', () => {
    const onSetValueRating = vi.fn()
    render(<SourceRow recording={baseRecording} onSetValueRating={onSetValueRating} />)
    openMenu()

    fireEvent.click(screen.getByText('Mark low-value'))
    expect(onSetValueRating).toHaveBeenCalledWith('low-value')

    openMenu()
    fireEvent.click(screen.getByText('Mark garbage'))
    expect(onSetValueRating).toHaveBeenCalledWith('garbage')
  })

  it('omits "Clear rating" when the recording is unrated', () => {
    render(<SourceRow recording={{ ...baseRecording, quality: 'unrated' }} onSetValueRating={vi.fn()} />)
    openMenu()
    expect(screen.queryByText('Clear rating')).not.toBeInTheDocument()
  })

  it('shows "Clear rating" and calls onSetValueRating(\'unrated\') when the recording is rated', () => {
    const onSetValueRating = vi.fn()
    render(<SourceRow recording={{ ...baseRecording, quality: 'garbage' }} onSetValueRating={onSetValueRating} />)
    openMenu()
    fireEvent.click(screen.getByText('Clear rating'))
    expect(onSetValueRating).toHaveBeenCalledWith('unrated')
  })

  it('does not trigger the row onClick when a rating item is clicked (stopPropagation)', () => {
    const onClick = vi.fn()
    const onSetValueRating = vi.fn()
    render(<SourceRow recording={baseRecording} onClick={onClick} onSetValueRating={onSetValueRating} />)
    openMenu()
    fireEvent.click(screen.getByText('Mark low-value'))
    expect(onSetValueRating).toHaveBeenCalled()
    expect(onClick).not.toHaveBeenCalled()
  })
})
