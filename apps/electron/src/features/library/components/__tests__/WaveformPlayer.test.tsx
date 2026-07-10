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

  it('shows a "Loading waveform…" state (never "Press play…") while peaks decode', () => {
    render(<WaveformPlayer mode="full" recordingId="rec-1" filePath="/a.wav" />)
    expect(screen.getByTestId('waveform-player-full')).toBeInTheDocument()
    expect(screen.getByTestId('waveform-loading')).toBeInTheDocument()
    expect(screen.getByText(/loading waveform/i)).toBeInTheDocument()
    expect(screen.queryByText(/press play to load/i)).not.toBeInTheDocument()
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

  it('renders a cross-linked event list that seeks on click', () => {
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
    const row = within(list).getByText('Kickoff')
    fireEvent.click(row)
    expect(seek).toHaveBeenCalledWith(25)
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
})
