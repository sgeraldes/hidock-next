/**
 * Tests for the reader's SINGLE morphing waveform element (SourceReader).
 *
 * The model (never two players at once):
 *  - EXPANDED big rich timeline is the DEFAULT (reader at scrollTop 0).
 *  - Scrolling the body morphs it to a full-width docked bar (pill).
 *  - A narrow reader pane drops the docked bar to the bare scrubber.
 *  - The pin ("keep expanded") overrides the scroll-collapse.
 *  - An already-transcribed recording with empty timeline data triggers a
 *    one-time analyzeTimeline() backfill and shows "Analyzing timeline…".
 *  - When the backfill returns data, markers/sentiment are passed to the player.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { SourceReader } from '../SourceReader'
import { useUIStore } from '@/store/useUIStore'
import { useLibraryStore } from '@/store/useLibraryStore'
import type { UnifiedRecording } from '@/types/unified-recording'

// ---------------------------------------------------------------------------
// Mocks — reflect the player's `mode` so we can assert which single presentation
// is on screen, and capture the props it receives (for backfill assertions).
// ---------------------------------------------------------------------------
const playerRenders: Array<{ mode: string; events?: unknown; sentiment?: unknown; speakerRanges?: unknown }> = []

vi.mock('../WaveformPlayer', () => ({
  WaveformPlayer: (props: any) => {
    playerRenders.push({
      mode: props.mode,
      events: props.events,
      sentiment: props.sentiment,
      speakerRanges: props.speakerRanges,
    })
    return <div data-testid={`waveform-player-${props.mode}`} data-mode={props.mode} />
  },
}))

vi.mock('@radix-ui/react-portal', () => ({
  Portal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
vi.mock('@/components/ui/toaster', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}))
vi.mock('@/components/RecordingLinkDialog', () => ({ RecordingLinkDialog: () => null }))
vi.mock('@/components/ConfirmDialog', () => ({ ConfirmDialog: () => null }))
vi.mock('../TranscriptViewer', () => ({ TranscriptViewer: () => <div data-testid="transcript-viewer" /> }))
vi.mock('@/components/ui/select', () => ({
  Select: ({ children }: any) => <div>{children}</div>,
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ children }: any) => <div>{children}</div>,
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeRecording(overrides: Partial<UnifiedRecording> = {}): UnifiedRecording {
  return {
    id: 'rec-1',
    filename: 'meeting.wav',
    size: 1024 * 1024,
    duration: 125,
    dateRecorded: new Date('2024-01-15T10:00:00Z'),
    transcriptionStatus: 'none',
    location: 'local-only',
    localPath: '/recordings/meeting.wav',
    syncStatus: 'synced',
    ...overrides,
  } as UnifiedRecording
}

/** Force the reader-player-region to measure a given width on mount. */
function mockRegionWidth(width: number) {
  const orig = Element.prototype.getBoundingClientRect
  Element.prototype.getBoundingClientRect = function () {
    return { width, height: 40, top: 0, left: 0, right: width, bottom: 40, x: 0, y: 0, toJSON: () => {} } as DOMRect
  }
  return () => { Element.prototype.getBoundingClientRect = orig }
}

const emptyTimeline = { sentimentSegments: [], eventMarkers: [] }

function installElectronAPI(timelineImpl?: {
  getTimelineAnalysis?: ReturnType<typeof vi.fn>
  analyzeTimeline?: ReturnType<typeof vi.fn>
}) {
  Object.defineProperty(window, 'electronAPI', {
    value: {
      recordings: {
        reprocessWith: vi.fn().mockResolvedValue({ success: true }),
        reDiarize: vi.fn().mockResolvedValue({ success: true }),
        getTimelineAnalysis: timelineImpl?.getTimelineAnalysis,
        analyzeTimeline: timelineImpl?.analyzeTimeline,
      },
      projects: {
        getForKnowledge: vi.fn().mockResolvedValue({ success: true, data: [] }),
        getAll: vi.fn().mockResolvedValue({ success: true, data: { projects: [], total: 0 } }),
      },
    },
    writable: true,
    configurable: true,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  playerRenders.length = 0
  useUIStore.setState({ waveformLoadedForId: null, waveformLoadingId: null, playbackDuration: 0 })
  useLibraryStore.setState({ waveformPinned: false })
  ;(window as any).__audioControls = { loadWaveformOnly: vi.fn() }
  installElectronAPI()
})

// ---------------------------------------------------------------------------
// 1. Exactly one player, expanded by default
// ---------------------------------------------------------------------------
describe('SourceReader — single morphing waveform', () => {
  it('renders EXACTLY ONE waveform element, expanded (full) by default at scrollTop 0', () => {
    render(<SourceReader recording={makeRecording()} />)
    const players = screen.getAllByTestId(/^waveform-player-/)
    expect(players).toHaveLength(1)
    expect(screen.getByTestId('waveform-player-full')).toBeInTheDocument()
  })

  it('morphs to the full-width docked pill after the body is scrolled (still ONE element)', () => {
    const restore = mockRegionWidth(800) // wide pane → pill, not scrubber
    render(<SourceReader recording={makeRecording()} />)
    const body = screen.getByTestId('reader-scroll-body')
    Object.defineProperty(body, 'scrollTop', { value: 120, configurable: true })
    fireEvent.scroll(body)
    const players = screen.getAllByTestId(/^waveform-player-/)
    expect(players).toHaveLength(1)
    expect(screen.getByTestId('waveform-player-pill')).toBeInTheDocument()
    expect(screen.queryByTestId('waveform-player-full')).not.toBeInTheDocument()
    restore()
  })

  it('drops the docked bar to the scrubber when the reader pane is narrow', () => {
    const restore = mockRegionWidth(320) // below breakpoint → scrubber
    render(<SourceReader recording={makeRecording()} />)
    const body = screen.getByTestId('reader-scroll-body')
    Object.defineProperty(body, 'scrollTop', { value: 120, configurable: true })
    fireEvent.scroll(body)
    expect(screen.getAllByTestId(/^waveform-player-/)).toHaveLength(1)
    expect(screen.getByTestId('waveform-player-scrubber')).toBeInTheDocument()
    restore()
  })

  it('re-expands to the big timeline when scrolled back to the top', () => {
    const restore = mockRegionWidth(800)
    render(<SourceReader recording={makeRecording()} />)
    const body = screen.getByTestId('reader-scroll-body')
    Object.defineProperty(body, 'scrollTop', { value: 120, configurable: true })
    fireEvent.scroll(body)
    expect(screen.getByTestId('waveform-player-pill')).toBeInTheDocument()
    Object.defineProperty(body, 'scrollTop', { value: 0, configurable: true })
    fireEvent.scroll(body)
    expect(screen.getByTestId('waveform-player-full')).toBeInTheDocument()
    expect(screen.getAllByTestId(/^waveform-player-/)).toHaveLength(1)
    restore()
  })
})

// ---------------------------------------------------------------------------
// 2. Pin overrides the scroll-collapse
// ---------------------------------------------------------------------------
describe('SourceReader — keep-expanded pin', () => {
  it('keeps the big timeline while scrolling when pinned, and persists the pin', () => {
    const restore = mockRegionWidth(800)
    render(<SourceReader recording={makeRecording()} />)
    fireEvent.click(screen.getByRole('button', { name: /keep timeline expanded/i }))
    expect(useLibraryStore.getState().waveformPinned).toBe(true)
    // Now scroll — it must STAY big (full), not collapse.
    const body = screen.getByTestId('reader-scroll-body')
    Object.defineProperty(body, 'scrollTop', { value: 200, configurable: true })
    fireEvent.scroll(body)
    expect(screen.getByTestId('waveform-player-full')).toBeInTheDocument()
    expect(screen.getAllByTestId(/^waveform-player-/)).toHaveLength(1)
    restore()
  })
})

// ---------------------------------------------------------------------------
// 3. Timeline backfill + analyzing indicator + data rendering
// ---------------------------------------------------------------------------
describe('SourceReader — timeline backfill', () => {
  it('calls analyzeTimeline ONCE when getTimelineAnalysis returns empty, then renders markers/sentiment', async () => {
    const populated = {
      sentimentSegments: [{ startSec: 0, endSec: 60, score: 0.5 }],
      eventMarkers: [{ id: 'e1', kind: 'action' as const, atSec: 30, label: 'Ship it', refId: 'a1' }],
    }
    const getTimelineAnalysis = vi.fn()
      .mockResolvedValueOnce(emptyTimeline) // first read: empty
      .mockResolvedValueOnce(populated) // re-read after backfill
    const analyzeTimeline = vi.fn().mockResolvedValue(populated)
    installElectronAPI({ getTimelineAnalysis, analyzeTimeline })

    render(<SourceReader recording={makeRecording({ transcriptionStatus: 'complete' })} />)

    await waitFor(() => expect(analyzeTimeline).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(analyzeTimeline).toHaveBeenCalledWith('rec-1'))

    // The populated data reaches the player as mapped events + sentiment.
    await waitFor(() => {
      const withEvents = playerRenders.find((r) => Array.isArray(r.events) && (r.events as unknown[]).length === 1)
      expect(withEvents).toBeTruthy()
      expect((withEvents!.sentiment as unknown[]).length).toBe(1)
    })
  })

  it('shows the "Analyzing timeline…" indicator while the backfill is in flight', async () => {
    let resolveAnalyze: (v: unknown) => void = () => {}
    const analyzeTimeline = vi.fn(() => new Promise((res) => { resolveAnalyze = res }))
    const getTimelineAnalysis = vi.fn().mockResolvedValue(emptyTimeline)
    installElectronAPI({ getTimelineAnalysis, analyzeTimeline })

    render(<SourceReader recording={makeRecording({ transcriptionStatus: 'complete' })} />)

    // Indicator appears while analyzeTimeline is pending (big mode is default).
    expect(await screen.findByTestId('timeline-analyzing')).toBeInTheDocument()

    await act(async () => { resolveAnalyze(emptyTimeline) })
    await waitFor(() => expect(screen.queryByTestId('timeline-analyzing')).not.toBeInTheDocument())
  })

  it('backfills a still-empty recording at most ONCE per reader session (no re-analysis on reopen)', async () => {
    // Both recordings legitimately yield nothing (e.g. Gemini off, no items).
    const getTimelineAnalysis = vi.fn().mockResolvedValue(emptyTimeline)
    const analyzeTimeline = vi.fn().mockResolvedValue(emptyTimeline)
    installElectronAPI({ getTimelineAnalysis, analyzeTimeline })

    const recA = makeRecording({ id: 'rec-A', transcriptionStatus: 'complete' })
    const recB = makeRecording({ id: 'rec-B', transcriptionStatus: 'complete' })

    // Open A → one backfill attempt for A.
    const { rerender } = render(<SourceReader recording={recA} />)
    await waitFor(() => expect(analyzeTimeline).toHaveBeenCalledWith('rec-A'))
    expect(analyzeTimeline).toHaveBeenCalledTimes(1)

    // Switch to B (reader stays mounted) → one backfill for B.
    rerender(<SourceReader recording={recB} />)
    await waitFor(() => expect(analyzeTimeline).toHaveBeenCalledWith('rec-B'))
    expect(analyzeTimeline).toHaveBeenCalledTimes(2)

    // Reopen A: it stayed empty, but must NOT be re-analyzed — still 2 total.
    rerender(<SourceReader recording={recA} />)
    await waitFor(() => expect(getTimelineAnalysis).toHaveBeenCalledWith('rec-A'))
    await Promise.resolve()
    expect(analyzeTimeline).toHaveBeenCalledTimes(2)
  })

  // Adversarial finding 3a: the guard is keyed to the TRANSCRIPT REVISION, so a
  // recording retranscribed in-session (new transcript id/created_at) gets a
  // fresh backfill instead of staying marker-less all session.
  it('re-analyzes a reopened recording whose transcript was RETRANSCRIBED in-session', async () => {
    const getTimelineAnalysis = vi.fn().mockResolvedValue(emptyTimeline)
    const analyzeTimeline = vi.fn().mockResolvedValue(emptyTimeline)
    installElectronAPI({ getTimelineAnalysis, analyzeTimeline })

    const recA = makeRecording({ id: 'rec-A', transcriptionStatus: 'complete' })
    const recB = makeRecording({ id: 'rec-B', transcriptionStatus: 'complete' })
    const transcriptV1 = { id: 't-A1', recording_id: 'rec-A', full_text: 'v1', created_at: '2026-07-10T10:00:00Z' } as any
    const transcriptV2 = { id: 't-A2', recording_id: 'rec-A', full_text: 'v2', created_at: '2026-07-11T09:00:00Z' } as any

    // Open A (revision 1) → one backfill.
    const { rerender } = render(<SourceReader recording={recA} transcript={transcriptV1} />)
    await waitFor(() => expect(analyzeTimeline).toHaveBeenCalledWith('rec-A'))
    expect(analyzeTimeline).toHaveBeenCalledTimes(1)

    // Away to B and back to a RETRANSCRIBED A (new transcript row).
    rerender(<SourceReader recording={recB} />)
    await waitFor(() => expect(analyzeTimeline).toHaveBeenCalledWith('rec-B'))
    rerender(<SourceReader recording={recA} transcript={transcriptV2} />)

    // The new revision invalidates the guard → A is analyzed again (3 total).
    await waitFor(() => expect(analyzeTimeline).toHaveBeenCalledTimes(3))
    expect(analyzeTimeline).toHaveBeenLastCalledWith('rec-A')
  })

  // Adversarial finding 3b: a FAILED backfill is not a successful-empty result —
  // it releases the guard so the next open of the same revision retries.
  it('retries the backfill on a later open after a FAILED analysis (success-empty stays guarded)', async () => {
    const getTimelineAnalysis = vi.fn().mockResolvedValue(emptyTimeline)
    const analyzeTimeline = vi.fn().mockRejectedValueOnce(new Error('gemini down')).mockResolvedValue(emptyTimeline)
    installElectronAPI({ getTimelineAnalysis, analyzeTimeline })

    const recA = makeRecording({ id: 'rec-A', transcriptionStatus: 'complete' })
    const recB = makeRecording({ id: 'rec-B', transcriptionStatus: 'complete' })

    // Open A → attempt FAILS → guard released.
    const { rerender } = render(<SourceReader recording={recA} />)
    await waitFor(() => expect(analyzeTimeline).toHaveBeenCalledWith('rec-A'))
    expect(analyzeTimeline).toHaveBeenCalledTimes(1)

    // Away and back → the failed revision is retried (this time success-empty)…
    rerender(<SourceReader recording={recB} />)
    await waitFor(() => expect(analyzeTimeline).toHaveBeenCalledWith('rec-B'))
    rerender(<SourceReader recording={recA} />)
    await waitFor(() => expect(analyzeTimeline).toHaveBeenCalledTimes(3))

    // …and a THIRD open stays guarded (success-empty is remembered).
    rerender(<SourceReader recording={recB} />)
    await waitFor(() => expect(getTimelineAnalysis).toHaveBeenCalledWith('rec-B'))
    rerender(<SourceReader recording={recA} />)
    await waitFor(() => expect(getTimelineAnalysis).toHaveBeenCalledWith('rec-A'))
    await Promise.resolve()
    expect(analyzeTimeline).toHaveBeenCalledTimes(3)
  })

  it('does NOT call analyzeTimeline when getTimelineAnalysis already has data', async () => {
    const populated = {
      sentimentSegments: [{ startSec: 0, endSec: 60, score: 0.5 }],
      eventMarkers: [],
    }
    const getTimelineAnalysis = vi.fn().mockResolvedValue(populated)
    const analyzeTimeline = vi.fn()
    installElectronAPI({ getTimelineAnalysis, analyzeTimeline })

    render(<SourceReader recording={makeRecording({ transcriptionStatus: 'complete' })} />)
    await waitFor(() => expect(getTimelineAnalysis).toHaveBeenCalled())
    // Give any microtasks a chance, then assert no backfill happened.
    await Promise.resolve()
    expect(analyzeTimeline).not.toHaveBeenCalled()
  })
})
