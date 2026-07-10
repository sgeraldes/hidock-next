/**
 * Tests for WaveformPlayer — the self-contained compact/full player.
 *  - 'pill'     docked default (voice-message pill)
 *  - 'scrubber' narrow fallback (bare seek bar)
 *  - 'full'     smaller classic waveform with a clear playhead + overlay seams
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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

  it('renders the scrubber mode with a seek slider', () => {
    render(<WaveformPlayer mode="scrubber" recordingId="rec-1" filePath="/a.wav" />)
    expect(screen.getByTestId('waveform-player-scrubber')).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: /seek/i })).toBeInTheDocument()
  })

  it('renders the full mode with the waveform placeholder', () => {
    render(<WaveformPlayer mode="full" recordingId="rec-1" filePath="/a.wav" />)
    expect(screen.getByTestId('waveform-player-full')).toBeInTheDocument()
    expect(screen.getByText(/press play to load the waveform/i)).toBeInTheDocument()
  })

  it('renders numbered event markers in full mode when provided', () => {
    useUIStore.setState({ currentlyPlayingId: 'rec-1', playbackDuration: 100 })
    render(
      <WaveformPlayer
        mode="full"
        recordingId="rec-1"
        filePath="/a.wav"
        events={[{ id: 'e1', timeSec: 50, index: 1, label: 'Decision' }]}
      />
    )
    expect(screen.getByRole('button', { name: /jump to marker 1/i })).toBeInTheDocument()
  })
})
