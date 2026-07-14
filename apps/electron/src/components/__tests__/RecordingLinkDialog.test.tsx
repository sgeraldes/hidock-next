import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { RecordingLinkDialog } from '../RecordingLinkDialog'

// Render Radix portals inline so the dialog content is queryable in jsdom.
vi.mock('@radix-ui/react-portal', () => ({
  Portal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@/components/ui/toaster', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}))

const RECORDING = {
  id: 'rec-46',
  filename: '2026Jul08-140719-Rec46.hda',
  date_recorded: '2026-07-08T14:07:19-05:00',
  duration_seconds: 30 * 60,
}

// getCandidates now returns re-scored, sorted candidates plus recordingContext.
// Retro Belcorp (content match) leads and is the flagged best match.
const SCORED_RESULT = {
  success: true,
  data: [
    { id: 'c-retro', recordingId: 'rec-46', meetingId: 'retro', subject: 'Retro Belcorp', startTime: '2026-07-08T15:00:00-05:00', endTime: '2026-07-08T15:30:00-05:00', confidenceScore: 0.46, matchReason: 'Meeting starts 23 min after recording ends · Title mentions "retro"', isAiSelected: true, isUserConfirmed: false },
    { id: 'c-almuerzo', recordingId: 'rec-46', meetingId: 'almuerzo', subject: 'Almuerzo', startTime: '2026-07-08T13:00:00-05:00', endTime: '2026-07-08T14:00:00-05:00', confidenceScore: 0.19, matchReason: 'Meeting ended 7 min before recording starts', isAiSelected: false, isUserConfirmed: false },
  ],
  recordingContext: {
    title: 'Cierre de Proyecto y Acciones de Retrospectiva',
    summary: 'El equipo cerró el proyecto y definió acciones de retrospectiva.',
    speakerCount: 2,
    hasTranscript: true,
  },
}

function primeApi(candidatesResult: any = SCORED_RESULT) {
  Object.defineProperty(window, 'electronAPI', {
    value: {
      recordings: {
        getCandidates: vi.fn().mockResolvedValue(candidatesResult),
        getMeetingsNearDate: vi.fn().mockResolvedValue({ success: true, data: [] }),
        getForMeeting: vi.fn().mockResolvedValue([]),
        selectMeeting: vi.fn().mockResolvedValue({ success: true }),
      },
      meetings: { update: vi.fn().mockResolvedValue({ success: true }) },
    },
    writable: true,
    configurable: true,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  primeApi()
})

describe('RecordingLinkDialog — decidable match', () => {
  it('leads the header with the transcript title and demotes the filename', async () => {
    render(<RecordingLinkDialog recording={RECORDING} open onClose={vi.fn()} onResolved={vi.fn()} />)

    // Transcript-derived title is the headline.
    expect(await screen.findByText('Cierre de Proyecto y Acciones de Retrospectiva')).toBeInTheDocument()
    // Summary is shown.
    expect(screen.getByText(/definió acciones de retrospectiva/i)).toBeInTheDocument()
    // Filename + speaker count are relegated to the quiet metadata line.
    const meta = screen.getByText(/2026Jul08-140719-Rec46\.hda/)
    expect(meta.textContent).toContain('2 speakers')
  })

  it('flags the leading candidate as the best match and shows discriminating scores', async () => {
    render(<RecordingLinkDialog recording={RECORDING} open onClose={vi.fn()} onResolved={vi.fn()} />)

    expect(await screen.findByText('Retro Belcorp')).toBeInTheDocument()
    // Only the leader carries the "Best match" affordance.
    expect(screen.getByText('Best match')).toBeInTheDocument()
    // Honest, differing percentages.
    expect(screen.getByText('46%')).toBeInTheDocument()
    expect(screen.getByText('19%')).toBeInTheDocument()
    // The scoring reason is surfaced, not just a number.
    expect(screen.getByText(/Title mentions "retro"/)).toBeInTheDocument()
    // The standalone escape hatch remains.
    expect(screen.getByText(/No meeting — standalone recording/)).toBeInTheDocument()
  })

  it('falls back to the filename headline when there is no transcript', async () => {
    primeApi({ success: true, data: [], recordingContext: { title: null, summary: null, speakerCount: null, hasTranscript: false } })
    render(<RecordingLinkDialog recording={RECORDING} open onClose={vi.fn()} onResolved={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText(/2026Jul08-140719-Rec46\.hda/)).toBeInTheDocument()
    })
    expect(screen.queryByText('Best match')).not.toBeInTheDocument()
  })
})
