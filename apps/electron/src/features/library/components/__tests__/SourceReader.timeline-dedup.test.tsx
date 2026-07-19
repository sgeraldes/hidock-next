/**
 * SourceReader — H6 (transcript + speaker colors on selection) and H3 (action
 * items de-duplicated: one home = the timeline event-list, never the transcript
 * body).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SourceReader } from '../SourceReader'
import { useUIStore } from '@/store/useUIStore'
import { useLibraryStore } from '@/store/useLibraryStore'
import type { UnifiedRecording } from '@/types/unified-recording'
import type { Transcript } from '@/types'

// Capture the props the player + transcript viewer receive.
const playerRenders: Array<{ mode: string; events?: any[]; speakerRanges?: any[] }> = []
const viewerRenders: Array<{ showActionItems?: boolean; actionItems?: string[] }> = []

vi.mock('../WaveformPlayer', () => ({
  WaveformPlayer: (props: any) => {
    playerRenders.push({ mode: props.mode, events: props.events, speakerRanges: props.speakerRanges })
    return <div data-testid={`waveform-player-${props.mode}`} />
  },
}))
vi.mock('../TranscriptViewer', () => ({
  TranscriptViewer: (props: any) => {
    viewerRenders.push({ showActionItems: props.showActionItems, actionItems: props.actionItems })
    return (
      <div data-testid="transcript-viewer">
        {props.showActionItems && props.actionItems?.length ? (
          <ul data-testid="viewer-action-items">
            {props.actionItems.map((a: string, i: number) => <li key={i}>{a}</li>)}
          </ul>
        ) : null}
      </div>
    )
  },
}))
vi.mock('@radix-ui/react-portal', () => ({ Portal: ({ children }: any) => <>{children}</> }))
vi.mock('@/components/ui/toaster', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}))
vi.mock('@/components/RecordingLinkDialog', () => ({ RecordingLinkDialog: () => null }))
vi.mock('@/components/ConfirmDialog', () => ({ ConfirmDialog: () => null }))
vi.mock('@/components/ui/select', () => ({
  Select: ({ children }: any) => <div>{children}</div>,
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ children }: any) => <div>{children}</div>,
}))

function makeRecording(overrides: Partial<UnifiedRecording> = {}): UnifiedRecording {
  return {
    id: 'rec-1',
    filename: 'meeting.wav',
    size: 1024 * 1024,
    duration: 120,
    dateRecorded: new Date('2024-01-15T10:00:00Z'),
    transcriptionStatus: 'complete',
    location: 'local-only',
    localPath: '/recordings/meeting.wav',
    syncStatus: 'synced',
    ...overrides,
  } as UnifiedRecording
}

const SPEAKERS = JSON.stringify([
  { speaker: 'Speaker 1', start: 0, end: 60, text: 'hello' },
  { speaker: 'Speaker 2', start: 60, end: 120, text: 'hi back' },
])

function makeTranscript(overrides: Partial<Transcript> = {}): Transcript {
  return {
    id: 't1',
    recording_id: 'rec-1',
    full_text: '[00:00] Speaker 1: hello\n[01:00] Speaker 2: hi back',
    language: 'en',
    summary: 'A short chat',
    action_items: JSON.stringify(['Send the deck', 'Decision: ship QA first']),
    topics: null,
    key_points: null,
    sentiment: null,
    speakers: SPEAKERS,
    word_count: 4,
    transcription_provider: 'gemini',
    transcription_model: 'x',
    title_suggestion: null,
    question_suggestions: null,
    created_at: '2024-01-15T10:00:00Z',
    ...overrides,
  } as Transcript
}

const getByRecordingId = vi.fn()

function installElectronAPI() {
  Object.defineProperty(window, 'electronAPI', {
    value: {
      recordings: { reprocessWith: vi.fn().mockResolvedValue({ success: true }) },
      // ADV13: SourceReader detail viewer now uses the owner-management accessor.
      transcripts: { getByRecordingIdOwner: getByRecordingId },
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
  viewerRenders.length = 0
  useUIStore.setState({ waveformLoadedForId: null, waveformLoadingId: null, playbackDuration: 0 })
  useLibraryStore.setState({ waveformPinned: false })
  ;(window as any).__audioControls = { loadWaveformOnly: vi.fn() }
  installElectronAPI()
})

describe('SourceReader — H6: transcript + speaker colors render on selection', () => {
  it('fetches the transcript directly when the parent supplies none, then renders it + per-speaker colors', async () => {
    getByRecordingId.mockResolvedValue(makeTranscript())

    // No `transcript` prop — as when selection arrives via the sidebar nav.
    render(<MemoryRouter><SourceReader recording={makeRecording()} /></MemoryRouter>)

    // Fallback fetch fires for the transcribed, local recording.
    await waitFor(() => expect(getByRecordingId).toHaveBeenCalledWith('rec-1'))

    // Transcript renders (not the "Transcript not available" placeholder).
    await waitFor(() => expect(screen.getByTestId('transcript-viewer')).toBeInTheDocument())
    expect(screen.queryByText(/transcript not available/i)).not.toBeInTheDocument()

    // Per-speaker bar colors are derived and passed to the player (2 speakers).
    await waitFor(() => {
      const full = playerRenders.filter((p) => p.mode === 'full').at(-1)
      expect(full?.speakerRanges && full.speakerRanges.length).toBeGreaterThan(0)
    })
  })
})

describe('SourceReader — H3: action items have ONE home (the timeline event-list)', () => {
  it('passes action items to the timeline events and NOT to the transcript body', async () => {
    render(<MemoryRouter><SourceReader recording={makeRecording()} transcript={makeTranscript()} /></MemoryRouter>)

    // Transcript viewer is told NOT to render action items.
    await waitFor(() => expect(viewerRenders.length).toBeGreaterThan(0))
    expect(viewerRenders.every((v) => v.showActionItems === false)).toBe(true)
    expect(screen.queryByTestId('viewer-action-items')).not.toBeInTheDocument()

    // The timeline event-list (player.events) IS the home — synthesized from the
    // action items when no analysis markers exist.
    const full = playerRenders.filter((p) => p.mode === 'full').at(-1)
    expect(full?.events?.length).toBe(2)
    expect(full?.events?.map((e) => e.label)).toEqual(['Send the deck', 'Decision: ship QA first'])
    // Decision hint is classified.
    expect(full?.events?.find((e) => e.label.startsWith('Decision'))?.kind).toBe('decision')
  })
})
