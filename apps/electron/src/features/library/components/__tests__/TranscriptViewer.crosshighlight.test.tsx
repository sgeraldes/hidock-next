/**
 * B1 — marker → transcript cross-highlight (the RECEIVING end).
 *
 * When a numbered meeting-timeline marker (or its event-list row) is clicked, the
 * reader passes a `highlightRequest` ({ atMs, nonce }) to the transcript. The
 * viewer must resolve the turn covering that offset, scroll it into view centered
 * (instant for reduced-motion users), and briefly pulse it. A bumped nonce
 * re-fires the pulse; a fabricated offset with no timestamps is a no-op.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
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

// ---------------------------------------------------------------------------
// Pulse timing — a rapid REPEAT click on the SAME turn must restart the pulse
// window (adversarial finding 2: a bare same-index setState would not re-run
// the timer effect, letting the FIRST timer clear the pulse early).
// ---------------------------------------------------------------------------
describe('TranscriptViewer cross-highlight pulse timing', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('restarts the 1.6s pulse when the SAME turn is re-requested (bumped nonce)', () => {
    const { rerender } = render(
      <TranscriptViewer transcript="x" segments={timed} onSeek={noop} highlightRequest={{ atMs: 12000, nonce: 1 }} />
    )
    expect(screen.getByTestId('transcript-turn-highlighted')).toBeInTheDocument()

    // 1s into the first pulse, the user clicks the SAME marker again.
    act(() => { vi.advanceTimersByTime(1000) })
    rerender(
      <TranscriptViewer transcript="x" segments={timed} onSeek={noop} highlightRequest={{ atMs: 12000, nonce: 2 }} />
    )

    // 1.5s after the SECOND request (2.5s after the first): had the first timer
    // survived, the pulse would already be gone — it must still be visible.
    act(() => { vi.advanceTimersByTime(1500) })
    expect(screen.getByTestId('transcript-turn-highlighted')).toBeInTheDocument()

    // …and it clears once the SECOND request's full window elapses.
    act(() => { vi.advanceTimersByTime(200) })
    expect(screen.queryByTestId('transcript-turn-highlighted')).not.toBeInTheDocument()
  })

  it('clears the pulse after its window on a single request', () => {
    render(
      <TranscriptViewer transcript="x" segments={timed} onSeek={noop} highlightRequest={{ atMs: 1000, nonce: 1 }} />
    )
    expect(screen.getByTestId('transcript-turn-highlighted')).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(1700) })
    expect(screen.queryByTestId('transcript-turn-highlighted')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Turn finder coverage — half-open [start, end) with ends derived from the next
// turn's start when absent (adversarial finding 4: a start-only finder
// highlighted unrelated text for markers in gaps or past the final turn).
// ---------------------------------------------------------------------------
describe('TranscriptViewer cross-highlight turn coverage', () => {
  const request = (atMs: number) => ({ atMs, nonce: Math.random() })

  const highlightedTextFor = (segments: Array<{ speaker?: string; start: number; end?: number; text: string }>, atMs: number) => {
    render(
      <TranscriptViewer transcript="x" segments={segments} onSeek={noop} highlightRequest={request(atMs)} />
    )
    return screen.queryByTestId('transcript-turn-highlighted')?.textContent ?? null
  }

  it('boundary: an offset exactly at a shared end/start boundary belongs to the NEXT turn (half-open)', () => {
    // 10s is seg0's end AND seg1's start → seg1 wins.
    expect(highlightedTextFor(timed, 10000)).toContain('The decision was made')
  })

  it('gap: an offset between two known spans highlights NOTHING', () => {
    const gapped = [
      { speaker: 'A', start: 0, end: 10, text: 'First span.' },
      { speaker: 'B', start: 20, end: 30, text: 'Second span.' }
    ]
    expect(highlightedTextFor(gapped, 15000)).toBeNull()
  })

  it('before the first turn: no match (never snaps to the first turn)', () => {
    const late = [
      { speaker: 'A', start: 5, end: 10, text: 'Starts late.' },
      { speaker: 'B', start: 10, end: 20, text: 'Second.' }
    ]
    expect(highlightedTextFor(late, 1000)).toBeNull()
  })

  it('past the final turn KNOWN end: no match (never highlights the last turn)', () => {
    expect(highlightedTextFor(timed, 25000)).toBeNull()
  })

  it('derives a missing end from the NEXT turn start (turns abut)', () => {
    const openMiddle = [
      { speaker: 'A', start: 0, text: 'Open-ended first turn.' }, // end derived = 20s
      { speaker: 'B', start: 20, end: 30, text: 'Second turn.' }
    ]
    expect(highlightedTextFor(openMiddle, 15000)).toContain('Open-ended first turn')
  })

  it('final turn with NO end evidence is unbounded (matches offsets past its start)', () => {
    const openLast = [
      { speaker: 'A', start: 0, end: 10, text: 'First.' },
      { speaker: 'B', start: 10, text: 'Unbounded last turn.' }
    ]
    expect(highlightedTextFor(openLast, 45000)).toContain('Unbounded last turn')
  })

  it('overlap: the LATEST-STARTING covering turn wins (markers anchor to turn starts)', () => {
    const overlapping = [
      { speaker: 'A', start: 0, end: 20, text: 'Long early turn.' },
      { speaker: 'B', start: 10, end: 30, text: 'Interjection turn.' }
    ]
    expect(highlightedTextFor(overlapping, 15000)).toContain('Interjection turn')
  })

  it('unit scale: seconds-based stored segments match a millisecond request', () => {
    // Stored segments are SECONDS; the request is MILLISECONDS. 12000ms must hit
    // the [10s, 20s) turn — not be treated as 12000s.
    expect(highlightedTextFor(timed, 12000)).toContain('The decision was made')
  })
})
