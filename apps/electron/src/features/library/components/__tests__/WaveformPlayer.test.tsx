/**
 * Tests for WaveformPlayer — the self-contained compact/full player.
 *  - 'pill'     docked default (voice-message pill)
 *  - 'scrubber' narrow fallback (bare seek bar)
 *  - 'full'     smaller classic waveform with a clear playhead + overlay seams
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { WaveformPlayer } from '../WaveformPlayer'
import { useUIStore } from '@/store/useUIStore'

vi.mock('@radix-ui/react-portal', () => ({
  Portal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

// Radix Select opens a portal jsdom can't drive — render a native control.
vi.mock('@/components/ui/select', () => ({
  Select: ({ value, children }: any) => <div data-testid="speed" data-value={value}>{children}</div>,
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ children }: any) => <div>{children}</div>,
}))

const play = vi.fn()
const pause = vi.fn()
const resume = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  useUIStore.setState({
    isPlaying: false,
    currentlyPlayingId: null,
    playbackCurrentTime: 0,
    playbackDuration: 0,
    playbackWaveformData: null,
    playbackSentimentData: null,
    waveformLoadingId: null,
    waveformLoadingError: null,
    waveformErrorForId: null,
    waveformLoadedForId: null,
  })
  ;(window as any).__audioControls = { play, pause, resume, stop: vi.fn(), seek: vi.fn(), setPlaybackRate: vi.fn() }
})

describe('WaveformPlayer', () => {
  it('renders the pill by default with a Play control', () => {
    render(<WaveformPlayer recordingId="rec-1" filePath="/a.wav" />)
    expect(screen.getByTestId('waveform-player-pill')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /play/i })).toBeInTheDocument()
  })

  it('loads+plays a not-yet-loaded recording when Play is pressed', () => {
    render(<WaveformPlayer recordingId="rec-1" filePath="/a.wav" />)
    fireEvent.click(screen.getByRole('button', { name: /play/i }))
    expect(play).toHaveBeenCalledWith('rec-1', '/a.wav')
  })

  it('pauses when the loaded recording is playing', () => {
    useUIStore.setState({ currentlyPlayingId: 'rec-1', isPlaying: true })
    render(<WaveformPlayer recordingId="rec-1" filePath="/a.wav" />)
    fireEvent.click(screen.getByRole('button', { name: /pause/i }))
    expect(pause).toHaveBeenCalled()
  })

  it('renders a FULL-WIDTH docked pill when `fluid` is set (spans the pane, not a left chip)', () => {
    render(<WaveformPlayer mode="pill" fluid recordingId="rec-1" filePath="/a.wav" />)
    const pill = screen.getByTestId('waveform-player-pill')
    expect(pill.className).toContain('w-full')
    expect(pill.className).not.toContain('inline-flex')
  })

  it('renders the scrubber mode with a seek slider', () => {
    render(<WaveformPlayer mode="scrubber" recordingId="rec-1" filePath="/a.wav" />)
    expect(screen.getByTestId('waveform-player-scrubber')).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: /seek/i })).toBeInTheDocument()
  })

  describe('scrubber keyboard seeking', () => {
    // liveDuration/liveTime are only "live" when this recording is the loaded one.
    const loadScrubber = () => {
      const seek = vi.fn()
      ;(window as any).__audioControls.seek = seek
      useUIStore.setState({
        currentlyPlayingId: 'rec-1',
        playbackDuration: 100,
        playbackCurrentTime: 50,
      })
      render(<WaveformPlayer mode="scrubber" recordingId="rec-1" filePath="/a.wav" />)
      return { seek, slider: screen.getByRole('slider', { name: /seek/i }) }
    }

    it('ArrowRight seeks forward ~5s (and does not start playback)', () => {
      const { seek, slider } = loadScrubber()
      fireEvent.keyDown(slider, { key: 'ArrowRight' })
      expect(seek).toHaveBeenCalledWith(55)
      expect(play).not.toHaveBeenCalled()
    })

    it('ArrowLeft seeks back ~5s', () => {
      const { seek, slider } = loadScrubber()
      fireEvent.keyDown(slider, { key: 'ArrowLeft' })
      expect(seek).toHaveBeenCalledWith(45)
    })

    it('Home seeks to the start and End seeks to the duration', () => {
      const { seek, slider } = loadScrubber()
      fireEvent.keyDown(slider, { key: 'Home' })
      expect(seek).toHaveBeenCalledWith(0)
      fireEvent.keyDown(slider, { key: 'End' })
      expect(seek).toHaveBeenCalledWith(100)
    })

    it('clamps to aria-valuemin/max (never seeks past the ends)', () => {
      const seek = vi.fn()
      ;(window as any).__audioControls.seek = seek
      useUIStore.setState({
        currentlyPlayingId: 'rec-1',
        playbackDuration: 100,
        playbackCurrentTime: 2, // < step
      })
      render(<WaveformPlayer mode="scrubber" recordingId="rec-1" filePath="/a.wav" />)
      const slider = screen.getByRole('slider', { name: /seek/i })
      fireEvent.keyDown(slider, { key: 'ArrowLeft' })
      expect(seek).toHaveBeenCalledWith(0) // 2 - 5 clamped to 0
    })
  })

  it('H5: shows a clean "Preparing waveform…" placeholder — never the old half-drawn "Loading waveform" overlay', () => {
    render(<WaveformPlayer mode="full" recordingId="rec-1" filePath="/a.wav" />)
    expect(screen.getByTestId('waveform-player-full')).toBeInTheDocument()
    // New clean placeholder…
    expect(screen.getByTestId('waveform-preparing')).toBeInTheDocument()
    expect(screen.getByText(/preparing waveform/i)).toBeInTheDocument()
    // …and NONE of the old half-drawn-wave-with-overlay affordances.
    expect(screen.queryByTestId('waveform-loading')).not.toBeInTheDocument()
    expect(screen.queryByText(/loading waveform/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/press play to load/i)).not.toBeInTheDocument()
  })

  it('H2: full mode renders the mockup composition — gradient stage, sentiment panel, time axis', () => {
    useUIStore.setState({ currentlyPlayingId: 'rec-1', playbackDuration: 100 })
    render(<WaveformPlayer mode="full" recordingId="rec-1" filePath="/a.wav" durationSec={100} />)
    expect(screen.getByTestId('timeline-stage')).toBeInTheDocument()
    expect(screen.getByTestId('sentiment-panel')).toBeInTheDocument()
    expect(screen.getByTestId('wave-band')).toBeInTheDocument()
    // Faint +positive / −negative axis labels from the mockup.
    expect(screen.getByText(/positive/i)).toBeInTheDocument()
    expect(screen.getByText(/negative/i)).toBeInTheDocument()
  })

  it('renders the selected split point independently from the playback head', () => {
    render(
      <WaveformPlayer
        mode="full"
        recordingId="rec-1"
        filePath="/a.wav"
        durationSec={100}
        splitPointSec={25}
      />
    )
    expect(screen.getByTestId('waveform-split-marker')).toHaveStyle({ left: '25%' })
  })

  it('accepts timeline seeks before playback when only stored duration is available', () => {
    const seek = vi.fn()
    const onSeek = vi.fn()
    ;(window as any).__audioControls.seek = seek
    render(
      <WaveformPlayer
        mode="full"
        recordingId="rec-1"
        filePath="/a.wav"
        durationSec={100}
        events={[{ id: 'cut', timeSec: 25, index: 1, label: 'Boundary', kind: 'note' }]}
        onSeek={onSeek}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /jump to marker 1/i }))
    expect(seek).toHaveBeenCalledWith(25)
    expect(onSeek).toHaveBeenCalledWith(25)
  })

  it('H2: numbered markers sit ON the sentiment curve inside the sentiment panel', () => {
    useUIStore.setState({ currentlyPlayingId: 'rec-1', playbackDuration: 100 })
    render(
      <WaveformPlayer
        mode="full"
        recordingId="rec-1"
        filePath="/a.wav"
        durationSec={100}
        events={[{ id: 'e1', timeSec: 50, index: 1, label: 'Ship it', kind: 'action' }]}
        sentiment={[
          { startSec: 0, endSec: 50, score: 0.8 },
          { startSec: 50, endSec: 100, score: -0.6 },
        ]}
      />
    )
    const panel = screen.getByTestId('sentiment-panel')
    // The marker is a child of the sentiment panel (on the curve), not the wave band.
    expect(within(panel).getByTestId('timeline-marker')).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: /jump to marker 1/i })).toBeInTheDocument()
  })

  it('silently kicks loadWaveformOnly when it has a file but no decoded peaks (no Play)', () => {
    const loadWaveformOnly = vi.fn()
    ;(window as any).__audioControls.loadWaveformOnly = loadWaveformOnly
    render(<WaveformPlayer mode="full" recordingId="rec-1" filePath="/a.wav" />)
    expect(loadWaveformOnly).toHaveBeenCalledWith('rec-1', '/a.wav')
    // It must NOT start playback to do this.
    expect(play).not.toHaveBeenCalled()
  })

  it('does NOT re-request peaks once they are loaded for this recording', () => {
    const loadWaveformOnly = vi.fn()
    ;(window as any).__audioControls.loadWaveformOnly = loadWaveformOnly
    useUIStore.setState({
      waveformLoadedForId: 'rec-1',
      playbackWaveformData: new Float32Array([0.2, 0.5, 0.3]),
    })
    render(<WaveformPlayer mode="full" recordingId="rec-1" filePath="/a.wav" />)
    expect(loadWaveformOnly).not.toHaveBeenCalled()
  })

  it('renders numbered event markers in full mode when provided', () => {
    useUIStore.setState({ currentlyPlayingId: 'rec-1', playbackDuration: 100 })
    render(
      <WaveformPlayer
        mode="full"
        recordingId="rec-1"
        filePath="/a.wav"
        events={[{ id: 'e1', timeSec: 50, index: 1, label: 'Decision', kind: 'decision' }]}
      />
    )
    expect(screen.getByRole('button', { name: /jump to marker 1/i })).toBeInTheDocument()
  })

  it('seeks and highlights when an event marker is clicked', () => {
    const seek = vi.fn()
    ;(window as any).__audioControls.seek = seek
    const onEventClick = vi.fn()
    useUIStore.setState({ currentlyPlayingId: 'rec-1', playbackDuration: 100 })
    render(
      <WaveformPlayer
        mode="full"
        recordingId="rec-1"
        filePath="/a.wav"
        events={[{ id: 'e1', timeSec: 50, index: 1, label: 'Ship it', kind: 'action' }]}
        onEventClick={onEventClick}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /jump to marker 1/i }))
    expect(seek).toHaveBeenCalledWith(50)
    expect(onEventClick).toHaveBeenCalledWith(expect.objectContaining({ id: 'e1' }))
    // Marker + list row both reflect the active state.
    expect(screen.getByRole('button', { name: /jump to marker 1/i })).toHaveAttribute('aria-pressed', 'true')
  })

  it('renders a cross-linked event list that seeks from the TIMESTAMP chip', () => {
    const seek = vi.fn()
    ;(window as any).__audioControls.seek = seek
    useUIStore.setState({ currentlyPlayingId: 'rec-1', playbackDuration: 100 })
    render(
      <WaveformPlayer
        mode="full"
        recordingId="rec-1"
        filePath="/a.wav"
        events={[{ id: 'e1', timeSec: 25, index: 1, label: 'Kickoff', kind: 'action' }]}
      />
    )
    const list = screen.getByTestId('timeline-events')
    // The timestamp chip is the seek affordance (the text click expands details).
    fireEvent.click(within(list).getByTitle('Seek to 0:25'))
    expect(seek).toHaveBeenCalledWith(25)
  })

  it('shows the FULL event text wrapped (no truncation) when details are provided', () => {
    useUIStore.setState({ currentlyPlayingId: 'rec-1', playbackDuration: 100 })
    const longText = 'Exportar todas las tareas de Cantata a un archivo de Excel para luego filtrar y clasificar por responsable antes del viernes'
    render(
      <WaveformPlayer
        mode="full"
        recordingId="rec-1"
        filePath="/a.wav"
        events={[{ id: 'e1', timeSec: 25, index: 1, label: 'Exportar todas las tareas de Cantata a un archivo de Ex…', kind: 'action', refId: 'row-1' }]}
        eventDetails={{ 'row-1': { kind: 'action', fullText: longText, editable: true, status: 'pending', assignee: 'Camilo' } }}
      />
    )
    const text = screen.getByText(longText)
    expect(text).toBeInTheDocument()
    expect(text.className).not.toContain('truncate')
    expect(text.className).toContain('whitespace-normal')
  })

  it('clicking the row text EXPANDS the detail panel (does not seek)', () => {
    const seek = vi.fn()
    ;(window as any).__audioControls.seek = seek
    useUIStore.setState({ currentlyPlayingId: 'rec-1', playbackDuration: 100 })
    render(
      <WaveformPlayer
        mode="full"
        recordingId="rec-1"
        filePath="/a.wav"
        events={[{ id: 'e1', timeSec: 25, index: 1, label: 'Kickoff', kind: 'action', refId: 'row-1' }]}
        eventDetails={{ 'row-1': { kind: 'action', fullText: 'Kickoff', editable: true, status: 'pending', assignee: 'Ana', priority: 'high' } }}
      />
    )
    fireEvent.click(screen.getByText('Kickoff'))
    expect(seek).not.toHaveBeenCalled()
    const detail = screen.getByTestId('event-detail-e1')
    expect(within(detail).getByText(/Ana/)).toBeInTheDocument()
    expect(within(detail).getByText(/pending/i)).toBeInTheDocument()
    // Collapse again.
    fireEvent.click(screen.getByText('Kickoff'))
    expect(screen.queryByTestId('event-detail-e1')).not.toBeInTheDocument()
  })

  it('edit mode saves the new content via onEventUpdate', async () => {
    const onEventUpdate = vi.fn().mockResolvedValue(true)
    useUIStore.setState({ currentlyPlayingId: 'rec-1', playbackDuration: 100 })
    render(
      <WaveformPlayer
        mode="full"
        recordingId="rec-1"
        filePath="/a.wav"
        events={[{ id: 'e1', timeSec: 25, index: 1, label: 'Old text', kind: 'action', refId: 'row-1' }]}
        eventDetails={{ 'row-1': { kind: 'action', fullText: 'Old text', editable: true, status: 'pending' } }}
        onEventUpdate={onEventUpdate}
      />
    )
    fireEvent.click(screen.getByText('Old text'))
    fireEvent.click(screen.getByRole('button', { name: /^edit$/i }))
    const draft = screen.getByLabelText(/edit item 1 text/i)
    fireEvent.change(draft, { target: { value: 'Corrected action text' } })
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await vi.waitFor(() => expect(onEventUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'e1' }),
      { content: 'Corrected action text' }
    ))
  })

  it('mark complete toggles the action status via onEventUpdate', async () => {
    const onEventUpdate = vi.fn().mockResolvedValue(true)
    useUIStore.setState({ currentlyPlayingId: 'rec-1', playbackDuration: 100 })
    render(
      <WaveformPlayer
        mode="full"
        recordingId="rec-1"
        filePath="/a.wav"
        events={[{ id: 'e1', timeSec: 25, index: 1, label: 'Do it', kind: 'action', refId: 'row-1' }]}
        eventDetails={{ 'row-1': { kind: 'action', fullText: 'Do it', editable: true, status: 'pending' } }}
        onEventUpdate={onEventUpdate}
      />
    )
    fireEvent.click(screen.getByText('Do it'))
    fireEvent.click(screen.getByRole('button', { name: /mark complete/i }))
    await vi.waitFor(() => expect(onEventUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'e1' }),
      { status: 'completed' }
    ))
  })

  it('read-only events (editable:false) show full text but no edit affordance', () => {
    useUIStore.setState({ currentlyPlayingId: 'rec-1', playbackDuration: 100 })
    render(
      <WaveformPlayer
        mode="full"
        recordingId="rec-1"
        filePath="/a.wav"
        events={[{ id: 'txa_0', timeSec: 25, index: 1, label: 'Short…', kind: 'action', refId: 'txa_0' }]}
        eventDetails={{ txa_0: { kind: 'action', fullText: 'Complete read-only text', editable: false } }}
      />
    )
    fireEvent.click(screen.getByText('Complete read-only text'))
    expect(screen.getByText(/read-only item/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument()
  })

  it('does NOT render an in-player speaker-name legend (names live in Participants chips)', () => {
    useUIStore.setState({ currentlyPlayingId: 'rec-1', playbackDuration: 100 })
    render(
      <WaveformPlayer
        mode="full"
        recordingId="rec-1"
        filePath="/a.wav"
        speakerRanges={[{ startSec: 0, endSec: 50, speakerKey: 'A', name: 'Alice', color: '#2563EB' }]}
      />
    )
    // The waveform's per-speaker bar colors still come from `speakerRanges`, but
    // the NAMES (and their swatches) must NOT appear inside the player region.
    expect(screen.queryByTestId('speaker-legend')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /alice/i })).not.toBeInTheDocument()
  })

  it('renders markers + sentiment against the REAL duration WITHOUT playback (silent open)', () => {
    // Nothing is loaded/playing (currentlyPlayingId null → live duration 0), but a
    // real durationSec is provided: the rich timeline must still render.
    useUIStore.setState({ currentlyPlayingId: null, playbackDuration: 0 })
    render(
      <WaveformPlayer
        mode="full"
        recordingId="rec-1"
        filePath="/a.wav"
        durationSec={100}
        events={[{ id: 'e1', timeSec: 50, index: 1, label: 'Decision', kind: 'decision' }]}
        sentiment={[
          { startSec: 0, endSec: 50, score: 0.8 },
          { startSec: 50, endSec: 100, score: -0.6 },
        ]}
      />
    )
    // Marker + list row (axis-positioned) render even though live duration is 0.
    expect(screen.getByRole('button', { name: /jump to marker 1/i })).toBeInTheDocument()
    expect(screen.getByTestId('timeline-events')).toBeInTheDocument()
    expect(screen.getByTestId('sentiment-curve')).toBeInTheDocument()
  })

  it('renders the sentiment curve when sentiment is present and hides it when absent', () => {
    useUIStore.setState({ currentlyPlayingId: 'rec-1', playbackDuration: 100 })
    const { rerender } = render(
      <WaveformPlayer
        mode="full"
        recordingId="rec-1"
        filePath="/a.wav"
        sentiment={[
          { startSec: 0, endSec: 50, score: 0.8 },
          { startSec: 50, endSec: 100, score: -0.6 },
        ]}
      />
    )
    expect(screen.getByTestId('sentiment-curve')).toBeInTheDocument()

    rerender(<WaveformPlayer mode="full" recordingId="rec-1" filePath="/a.wav" />)
    expect(screen.queryByTestId('sentiment-curve')).not.toBeInTheDocument()
  })

  it('anchors the sentiment curve at BOTH edges (never inset from the sides)', () => {
    // 2026-07-24 — the curve used to span only first→last segment MIDPOINT,
    // leaving it visibly detached from the left/right edges of the timeline.
    useUIStore.setState({ currentlyPlayingId: 'rec-1', playbackDuration: 100 })
    render(
      <WaveformPlayer
        mode="full"
        recordingId="rec-1"
        filePath="/a.wav"
        sentiment={[{ startSec: 20, endSec: 80, score: 0.5 }]}
      />
    )

    expect(screen.getByTestId('sentiment-curve')).toHaveAttribute('points', '0,25 100,25')
  })

  it('anchors multi-segment curves at the edges too (nearest score continues)', () => {
    useUIStore.setState({ currentlyPlayingId: 'rec-1', playbackDuration: 100 })
    render(
      <WaveformPlayer
        mode="full"
        recordingId="rec-1"
        filePath="/a.wav"
        sentiment={[
          { startSec: 20, endSec: 40, score: 0.5 },   // y = 0.25
          { startSec: 40, endSec: 60, score: -0.5 },  // y = 0.75
        ]}
      />
    )

    // Edge anchors (0 and 100) wrap the two segment midpoints (30 and 50).
    expect(screen.getByTestId('sentiment-curve')).toHaveAttribute('points', '0,25 30,25 50,75 100,75')
  })
})
