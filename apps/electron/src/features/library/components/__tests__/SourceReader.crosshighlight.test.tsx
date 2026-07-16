/**
 * B1 — marker → transcript cross-highlight (the WIRING).
 *
 * A numbered timeline marker (or its event-list row) inside the WaveformPlayer
 * fires `onEventClick`; SourceReader must translate that into a `highlightRequest`
 * ({ atMs, nonce }) delivered to the TranscriptViewer, and re-fire (bumped nonce)
 * on a repeat click. Both children are mocked so we can drive the event and
 * capture the request that reaches the transcript.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SourceReader } from '../SourceReader'
import { useUIStore } from '@/store/useUIStore'
import { useLibraryStore } from '@/store/useLibraryStore'
import type { UnifiedRecording } from '@/types/unified-recording'
import type { Transcript } from '@/types'

// WaveformPlayer mock: exposes a button that fires the wired onEventClick with a
// marker at t=30s, so we can assert the request that reaches the transcript.
vi.mock('../WaveformPlayer', () => ({
  WaveformPlayer: (props: any) => (
    <div data-testid="waveform-player">
      <button
        data-testid="fire-event"
        onClick={() => props.onEventClick?.({ id: 'e1', timeSec: 30, index: 1, kind: 'action', label: 'Ship it' })}
      />
    </div>
  ),
}))

// TranscriptViewer mock: records every highlightRequest it receives.
const highlightRequests: Array<{ atMs: number; nonce: number } | null | undefined> = []
vi.mock('../TranscriptViewer', () => ({
  TranscriptViewer: (props: any) => {
    highlightRequests.push(props.highlightRequest)
    return <div data-testid="transcript-viewer" />
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
    duration: 125,
    dateRecorded: new Date('2024-01-15T10:00:00Z'),
    transcriptionStatus: 'complete',
    location: 'local-only',
    localPath: '/recordings/meeting.wav',
    syncStatus: 'synced',
    ...overrides,
  } as UnifiedRecording
}

function makeTranscript(): Transcript {
  return {
    id: 't-1',
    recording_id: 'rec-1',
    full_text: '[00:30] Speaker 1: Ship it.',
    summary: null,
    action_items: null,
    speakers: JSON.stringify([{ speaker: 'Speaker 1', start: 30, end: 40, text: 'Ship it.' }]),
  } as unknown as Transcript
}

beforeEach(() => {
  vi.clearAllMocks()
  highlightRequests.length = 0
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
      transcripts: {
        getSpeakerMap: vi.fn().mockResolvedValue({ success: true, data: [] }),
      },
      turnSpeakers: {
        getOverrides: vi.fn().mockResolvedValue({ success: true, data: [] }),
        getSplits: vi.fn().mockResolvedValue({ success: true, data: [] }),
        getMergeHints: vi.fn().mockResolvedValue({ success: true, data: [] }),
      },
      contacts: { getForMeeting: vi.fn().mockResolvedValue({ success: true, data: [] }), getForMeetingOwner: vi.fn().mockResolvedValue({ success: true, data: [] }), getAll: vi.fn().mockResolvedValue({ success: true, data: { contacts: [] } }) },
      projects: {
        getForKnowledge: vi.fn().mockResolvedValue({ success: true, data: [] }),
        getAll: vi.fn().mockResolvedValue({ success: true, data: { projects: [], total: 0 } }),
      },
    },
    writable: true,
    configurable: true,
  })
})

describe('SourceReader — marker → transcript cross-highlight wiring', () => {
  it('translates an onEventClick from the timeline into a highlightRequest at the marker time', async () => {
    render(<MemoryRouter><SourceReader recording={makeRecording()} transcript={makeTranscript()} /></MemoryRouter>)

    // Initially the transcript gets no highlight request.
    expect(highlightRequests.every((r) => r == null)).toBe(true)

    fireEvent.click(screen.getByTestId('fire-event'))

    await waitFor(() => {
      const last = highlightRequests[highlightRequests.length - 1]
      expect(last).toEqual({ atMs: 30000, nonce: 1 })
    })
  })

  it('re-fires with a bumped nonce when the same marker is clicked again', async () => {
    render(<MemoryRouter><SourceReader recording={makeRecording()} transcript={makeTranscript()} /></MemoryRouter>)

    fireEvent.click(screen.getByTestId('fire-event'))
    await waitFor(() =>
      expect(highlightRequests[highlightRequests.length - 1]).toEqual({ atMs: 30000, nonce: 1 })
    )

    fireEvent.click(screen.getByTestId('fire-event'))
    await waitFor(() =>
      expect(highlightRequests[highlightRequests.length - 1]).toEqual({ atMs: 30000, nonce: 2 })
    )
  })
})
