/**
 * B1 — marker → transcript cross-highlight (the RECEIVING end).
 *
 * When a numbered meeting-timeline marker (or its event-list row) is clicked, the
 * reader passes a `highlightRequest` ({ atMs, nonce }) to the transcript. The
 * viewer must resolve the turn covering that offset, scroll it into view centered
 * (instant for reduced-motion users), and briefly pulse it. A bumped nonce
 * re-fires the pulse; a fabricated offset with no timestamps is a no-op.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TranscriptViewer } from '../TranscriptViewer'

vi.mock('@/components/ui/toaster', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() }
}))

// Drive prefers-reduced-motion per test through a module-level flag.
let reducedMotion = false
vi.mock('@/hooks/useMediaQuery', () => ({
  useMediaQuery: () => reducedMotion
}))

const noop = () => {}

const timed = [
  { speaker: 'Speaker 1', start: 0, end: 10, text: 'Opening remarks near the start.' },
  { speaker: 'Speaker 2', start: 10, end: 20, text: 'The decision was made right here.' }
]

beforeEach(() => {
  vi.clearAllMocks()
  reducedMotion = false
  ;(window.HTMLElement.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mockClear()
})

describe('TranscriptViewer cross-highlight', () => {
  it('highlights + centers the turn covering the requested time', () => {
    const scrollSpy = window.HTMLElement.prototype.scrollIntoView as ReturnType<typeof vi.fn>
    const { rerender } = render(
      <TranscriptViewer transcript="x" segments={timed} onSeek={noop} highlightRequest={null} />
    )
    // No request yet → nothing highlighted.
    expect(screen.queryByTestId('transcript-turn-highlighted')).not.toBeInTheDocument()

    rerender(
      <TranscriptViewer transcript="x" segments={timed} onSeek={noop} highlightRequest={{ atMs: 12000, nonce: 1 }} />
    )
    const hl = screen.getByTestId('transcript-turn-highlighted')
    expect(hl).toHaveTextContent('The decision was made right here.')
    // Smooth, centered scroll (motion-safe default).
    expect(scrollSpy).toHaveBeenCalledWith(expect.objectContaining({ block: 'center', behavior: 'smooth' }))
  })

  it('moves the highlight to a new turn when a fresh request (nonce bump) arrives', () => {
    const { rerender } = render(
      <TranscriptViewer transcript="x" segments={timed} onSeek={noop} highlightRequest={{ atMs: 12000, nonce: 1 }} />
    )
    expect(screen.getByTestId('transcript-turn-highlighted')).toHaveTextContent('decision was made')

    rerender(
      <TranscriptViewer transcript="x" segments={timed} onSeek={noop} highlightRequest={{ atMs: 1000, nonce: 2 }} />
    )
    expect(screen.getByTestId('transcript-turn-highlighted')).toHaveTextContent('Opening remarks')
  })

  it('scrolls INSTANTLY (no smooth animation) for reduced-motion users', () => {
    reducedMotion = true
    const scrollSpy = window.HTMLElement.prototype.scrollIntoView as ReturnType<typeof vi.fn>
    render(
      <TranscriptViewer transcript="x" segments={timed} onSeek={noop} highlightRequest={{ atMs: 5000, nonce: 1 }} />
    )
    expect(scrollSpy).toHaveBeenCalledWith(expect.objectContaining({ block: 'center', behavior: 'auto' }))
  })

  it('is a no-op for an unmatchable request on a transcript without timestamps', () => {
    const scrollSpy = window.HTMLElement.prototype.scrollIntoView as ReturnType<typeof vi.fn>
    // Plain speaker-turn transcript (no timestamps) → fabricated offset can't map.
    render(
      <TranscriptViewer
        transcript={'**Alice:** hi there\n**Bob:** hello back'}
        onSeek={noop}
        highlightRequest={{ atMs: 8000, nonce: 1 }}
      />
    )
    expect(screen.queryByTestId('transcript-turn-highlighted')).not.toBeInTheDocument()
    expect(scrollSpy).not.toHaveBeenCalled()
  })
})
