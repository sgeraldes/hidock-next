/**
 * Tests for SourceReader reader-panel behavior (Wave 4 reader fixes):
 *  - Waveform PRELOADS on selection (no "Press Play to load the waveform")
 *  - DURATION shows the real value (stored, or the live waveform-decoded one)
 *  - Header date shows the YEAR (formatSmartDate)
 *  - "Transcribe ▾" split/dropdown replaces the raw "VibeVoice" button and
 *    triggers transcription with the chosen method (Gemini / Local)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SourceReader } from '../SourceReader'
import { useUIStore } from '@/store/useUIStore'
import type { UnifiedRecording } from '@/types/unified-recording'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock('@radix-ui/react-portal', () => ({
  Portal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@/components/ui/toaster', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  }),
}))

vi.mock('@/components/RecordingLinkDialog', () => ({
  RecordingLinkDialog: () => null,
}))

// Keep the ConfirmDialog real-ish: render children only when open.
vi.mock('@/components/ConfirmDialog', () => ({
  ConfirmDialog: ({ open, onConfirm }: { open: boolean; onConfirm: () => void }) =>
    open ? (
      <div data-testid="confirm-dialog">
        <button onClick={onConfirm}>Confirm Transcribe</button>
      </div>
    ) : null,
}))

// The player is exercised elsewhere; stub it so these tests focus on the
// reader's own preload/duration/transcribe behavior.
vi.mock('../WaveformPlayer', () => ({
  WaveformPlayer: () => <div data-testid="waveform-player" />,
}))

vi.mock('../TranscriptViewer', () => ({
  TranscriptViewer: () => <div data-testid="transcript-viewer" />,
}))

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
const mockReprocessWith = vi.fn().mockResolvedValue({ success: true, queueItemId: 'q1' })
const mockReDiarize = vi.fn().mockResolvedValue({ success: true, queueItemId: 'd1' })
const mockLoadWaveformOnly = vi.fn()

function makeRecording(overrides: Partial<UnifiedRecording> = {}): UnifiedRecording {
  return {
    id: 'rec-1',
    filename: 'meeting.wav',
    size: 1024 * 1024,
    duration: 125, // 2m 5s
    dateRecorded: new Date('2024-01-15T10:00:00Z'),
    transcriptionStatus: 'none',
    location: 'local-only',
    localPath: '/recordings/meeting.wav',
    syncStatus: 'synced',
    ...overrides,
  } as UnifiedRecording
}

beforeEach(() => {
  vi.clearAllMocks()
  // Reset transient waveform/duration state between tests.
  useUIStore.setState({ waveformLoadedForId: null, waveformLoadingId: null, playbackDuration: 0 })
  ;(window as any).__audioControls = { loadWaveformOnly: mockLoadWaveformOnly }
  Object.defineProperty(window, 'electronAPI', {
    value: {
      recordings: { reprocessWith: mockReprocessWith, reDiarize: mockReDiarize },
      projects: {
        getForKnowledge: vi.fn().mockResolvedValue({ success: true, data: [] }),
        getAll: vi.fn().mockResolvedValue({ success: true, data: { projects: [], total: 0 } }),
      },
    },
    writable: true,
    configurable: true,
  })
})

// ---------------------------------------------------------------------------
// 1. Waveform preload on selection
// ---------------------------------------------------------------------------
describe('SourceReader — waveform preload', () => {
  it('preloads the waveform for a local recording on open', () => {
    render(<SourceReader recording={makeRecording()} />)
    expect(mockLoadWaveformOnly).toHaveBeenCalledWith('rec-1', '/recordings/meeting.wav')
  })

  it('does NOT re-request the waveform when it is already loaded for this recording', () => {
    useUIStore.setState({ waveformLoadedForId: 'rec-1' })
    render(<SourceReader recording={makeRecording()} />)
    expect(mockLoadWaveformOnly).not.toHaveBeenCalled()
  })

  it('does not preload for a device-only recording (no local file)', () => {
    const deviceOnly = makeRecording({ location: 'device-only', localPath: undefined } as any)
    render(<SourceReader recording={deviceOnly} />)
    expect(mockLoadWaveformOnly).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// 2. Duration shown (real value, not "Unknown")
// ---------------------------------------------------------------------------
describe('SourceReader — duration', () => {
  it('shows the stored duration in the header', () => {
    render(<SourceReader recording={makeRecording({ duration: 125 })} />)
    expect(screen.getByText('2m 5s')).toBeInTheDocument()
    expect(screen.queryByText('Unknown')).not.toBeInTheDocument()
  })

  it('falls back to the live waveform-decoded duration when none is stored', () => {
    // Imported/watched file: no stored duration, but the waveform decode
    // backfilled the live value for this recording.
    useUIStore.setState({ waveformLoadedForId: 'rec-1', playbackDuration: 125 })
    render(<SourceReader recording={makeRecording({ duration: undefined } as any)} />)
    expect(screen.getByText('2m 5s')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// 3. Header date shows the year
// ---------------------------------------------------------------------------
describe('SourceReader — header date', () => {
  it('renders the date WITH the year', () => {
    render(<SourceReader recording={makeRecording({ dateRecorded: new Date('2024-01-15T10:00:00Z') })} />)
    // formatSmartDate → "Jan 15, 2024 · …"
    expect(screen.getByText(/Jan 15, 2024/)).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// 5. Transcribe ▾ split/dropdown
// ---------------------------------------------------------------------------
describe('SourceReader — Transcribe split/dropdown', () => {
  it('renders a primary Transcribe button and a method picker (no raw "VibeVoice")', () => {
    render(<SourceReader recording={makeRecording()} onTranscribe={vi.fn()} />)
    expect(screen.getByRole('button', { name: /^transcribe$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /choose transcription method/i })).toBeInTheDocument()
    expect(screen.queryByText(/vibevoice/i)).not.toBeInTheDocument()
  })

  it('primary click transcribes with the default method (onTranscribe)', () => {
    const onTranscribe = vi.fn()
    render(<SourceReader recording={makeRecording()} onTranscribe={onTranscribe} />)
    fireEvent.click(screen.getByRole('button', { name: /^transcribe$/i }))
    expect(onTranscribe).toHaveBeenCalledOnce()
  })

  it('picking "Gemini" from the menu transcribes via reprocessWith(gemini)', async () => {
    render(<SourceReader recording={makeRecording()} onTranscribe={vi.fn()} />)
    // Radix opens its menu on keydown, not click.
    fireEvent.keyDown(screen.getByRole('button', { name: /choose transcription method/i }), { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: /gemini/i }))
    await waitFor(() => expect(mockReprocessWith).toHaveBeenCalledWith('rec-1', 'gemini'))
  })

  it('picking "Local" from the menu transcribes via reprocessWith(local-asr)', async () => {
    render(<SourceReader recording={makeRecording()} onTranscribe={vi.fn()} />)
    fireEvent.keyDown(screen.getByRole('button', { name: /choose transcription method/i }), { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: /local/i }))
    await waitFor(() => expect(mockReprocessWith).toHaveBeenCalledWith('rec-1', 'local-asr'))
  })

  it('a completed recording offers "Re-transcribe" with the same method menu', async () => {
    render(<SourceReader recording={makeRecording({ transcriptionStatus: 'complete' })} onTranscribe={vi.fn()} />)
    const trigger = screen.getByRole('button', { name: /re-transcribe/i })
    expect(trigger).toBeInTheDocument()
    fireEvent.keyDown(trigger, { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: /gemini/i }))
    await waitFor(() => expect(mockReprocessWith).toHaveBeenCalledWith('rec-1', 'gemini'))
  })
})

// ---------------------------------------------------------------------------
// 6. Re-diarize this recording (item 6)
// ---------------------------------------------------------------------------
describe('SourceReader — Re-diarize', () => {
  it('exposes "Re-diarize this recording" in the Re-transcribe menu for a completed recording and calls the IPC', async () => {
    render(<SourceReader recording={makeRecording({ transcriptionStatus: 'complete' })} onTranscribe={vi.fn()} />)
    fireEvent.keyDown(screen.getByRole('button', { name: /re-transcribe/i }), { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: /re-diarize this recording/i }))
    await waitFor(() => expect(mockReDiarize).toHaveBeenCalledWith('rec-1'))
  })

  it('does NOT offer Re-diarize for a not-yet-transcribed recording', () => {
    render(<SourceReader recording={makeRecording({ transcriptionStatus: 'none' })} onTranscribe={vi.fn()} />)
    // The fresh "Transcribe ▾" menu has no re-diarize item until a transcript exists.
    fireEvent.keyDown(screen.getByRole('button', { name: /choose transcription method/i }), { key: 'Enter' })
    expect(screen.queryByRole('menuitem', { name: /re-diarize/i })).not.toBeInTheDocument()
  })

  it('degrades gracefully (error toast) when the reDiarize IPC is absent', async () => {
    const { toast } = await import('@/components/ui/toaster')
    // Remove reDiarize from the API surface for this test.
    ;(window.electronAPI.recordings as any).reDiarize = undefined
    render(<SourceReader recording={makeRecording({ transcriptionStatus: 'complete' })} onTranscribe={vi.fn()} />)
    fireEvent.keyDown(screen.getByRole('button', { name: /re-transcribe/i }), { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: /re-diarize this recording/i }))
    await waitFor(() => expect((toast as any).error).toHaveBeenCalledWith('Re-diarize unavailable', expect.any(String)))
  })
})
