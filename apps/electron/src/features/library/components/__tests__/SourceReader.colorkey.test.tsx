/**
 * B2 — reader-people color-key dedup.
 *
 * A linked-meeting contact who ALSO spoke is shown as a single Participants chip
 * (the `mc:` contact chip, not a duplicate speaker chip). Its waveform bars must
 * paint under the SAME color key as that chip, so the chip swatch and the bars
 * are ONE color — never a mismatched fallback. This test drives the real
 * useReaderPeople + deriveSpeakerRanges and captures the ranges handed to the
 * (mocked) WaveformPlayer, then compares the bar color to the chip swatch.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SourceReader } from '../SourceReader'
import { useUIStore } from '@/store/useUIStore'
import { useLibraryStore } from '@/store/useLibraryStore'
import type { UnifiedRecording } from '@/types/unified-recording'
import type { Meeting, Transcript } from '@/types'

// Capture the speakerRanges handed to the player each render.
const rangeRenders: Array<Array<{ startSec: number; endSec: number; speakerKey: string; name: string; color: string }>> = []
vi.mock('../WaveformPlayer', () => ({
  WaveformPlayer: (props: any) => {
    if (props.speakerRanges) rangeRenders.push(props.speakerRanges)
    return <div data-testid="waveform-player" />
  },
}))
vi.mock('../TranscriptViewer', () => ({ TranscriptViewer: () => <div data-testid="transcript-viewer" /> }))

vi.mock('@radix-ui/react-portal', () => ({
  Portal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
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

function makeRecording(): UnifiedRecording {
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
  } as UnifiedRecording
}

function makeMeeting(): Meeting {
  return {
    id: 'meet-1',
    subject: 'Team Standup',
    start_time: '2024-01-15T09:00:00Z',
    end_time: '2024-01-15T09:30:00Z',
    attendees: null,
  } as Meeting
}

function makeTranscript(): Transcript {
  return {
    id: 't-1',
    recording_id: 'rec-1',
    full_text: 'hello',
    summary: null,
    action_items: null,
    speakers: JSON.stringify([{ speaker: 'Speaker 1', start: 0, end: 60, text: 'Hola equipo.' }]),
  } as unknown as Transcript
}

/** Normalize a hex color to the `rgb(r, g, b)` form jsdom reports on style. */
function hexToRgb(hex: string): string {
  const [r, g, b] = hex.replace('#', '').match(/.{2}/g)!.map((h) => parseInt(h, 16))
  return `rgb(${r}, ${g}, ${b})`
}

beforeEach(() => {
  vi.clearAllMocks()
  rangeRenders.length = 0
  useUIStore.setState({ waveformLoadedForId: null, waveformLoadingId: null, playbackDuration: 0 })
  useLibraryStore.setState({ waveformPinned: false })
  ;(window as any).__audioControls = { loadWaveformOnly: vi.fn() }
  Object.defineProperty(window, 'electronAPI', {
    value: {
      recordings: {
        reprocessWith: vi.fn().mockResolvedValue({ success: true }),
        getTimelineAnalysis: vi.fn().mockResolvedValue({ sentimentSegments: [], eventMarkers: [] }),
        analyzeTimeline: vi.fn().mockResolvedValue({ sentimentSegments: [], eventMarkers: [] }),
      },
      contacts: {
        // Alice is a linked-meeting contact…
        getForMeeting: vi.fn().mockResolvedValue({ success: true, data: [{ id: 'c-1', name: 'Alice', email: 'alice@x.com' }] }),
        getAll: vi.fn().mockResolvedValue({ success: true, data: { contacts: [] } }),
      },
      transcripts: {
        // …and "Speaker 1" is bound to Alice, so she ALSO spoke.
        getSpeakerMap: vi.fn().mockResolvedValue({ success: true, data: [{ speaker_label: 'Speaker 1', contact_id: 'c-1', name: 'Alice' }] }),
      },
      turnSpeakers: {
        getOverrides: vi.fn().mockResolvedValue({ success: true, data: [] }),
        getSplits: vi.fn().mockResolvedValue({ success: true, data: [] }),
        getMergeHints: vi.fn().mockResolvedValue({ success: true, data: [] }),
      },
      projects: {
        getForKnowledge: vi.fn().mockResolvedValue({ success: true, data: [] }),
        getAll: vi.fn().mockResolvedValue({ success: true, data: { projects: [], total: 0 } }),
      },
    },
    writable: true,
    configurable: true,
  })
})

describe('SourceReader — speaker/contact color-key parity', () => {
  it('paints a speaking meeting-contact under the contact chip key, and the chip swatch matches the bar color', async () => {
    render(
      <MemoryRouter>
        <SourceReader recording={makeRecording()} meeting={makeMeeting()} transcript={makeTranscript()} />
      </MemoryRouter>
    )

    // Once the speaker map resolves, Alice is a single participant chip (the
    // speaker "Speaker 1" folds into her meeting-contact chip, not a duplicate).
    const aliceChip = await screen.findByRole('button', { name: 'Alice' })
    expect(screen.queryByText('Speaker 1')).not.toBeInTheDocument()

    // The bars for that speaker are keyed to the contact chip (mc:c-1), not a
    // fallback label key — this is what makes the swatch and bars share one color.
    await waitFor(() => {
      const latest = rangeRenders[rangeRenders.length - 1]
      expect(latest?.some((r) => r.speakerKey === 'mc:c-1')).toBe(true)
    })
    const barColor = rangeRenders[rangeRenders.length - 1].find((r) => r.speakerKey === 'mc:c-1')!.color

    // The chip renders a swatch, and its color equals the bar color.
    const swatch = aliceChip.querySelector('span[style]') as HTMLElement | null
    expect(swatch).not.toBeNull()
    expect(swatch!.style.backgroundColor).toBe(hexToRgb(barColor))
  })
})
