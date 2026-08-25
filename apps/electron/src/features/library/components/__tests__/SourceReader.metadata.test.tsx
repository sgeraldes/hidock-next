/**
 * Tests for SourceReader metadata editing features
 *
 * Covers the acceptance criteria from spec-consolidated-metadata-editing.md:
 * - Inline title editing
 * - Editable category dropdown
 * - Meeting link management (Change / Remove / Link)
 * - Transcription overwrite warning
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SourceReader } from '../SourceReader'
import type { UnifiedRecording } from '@/types/unified-recording'
import type { Meeting } from '@/types'

// ---------------------------------------------------------------------------
// Mock electronAPI
// ---------------------------------------------------------------------------
const mockKnowledgeUpdate = vi.fn().mockResolvedValue({ success: true })
const mockSelectMeeting = vi.fn().mockResolvedValue({ success: true })
// Projects assignment (v29)
const mockGetForKnowledge = vi.fn().mockResolvedValue({ success: true, data: [] })
const mockGetAllProjects = vi.fn().mockResolvedValue({ success: true, data: { projects: [{ id: 'pr1', name: 'Alpha' }], total: 1 } })
const mockSetProjects = vi.fn().mockResolvedValue({ success: true })

// PeoplePanel (Participants/Invited) calls useNavigate; these tests render
// without a Router, so stub navigation to keep them Router-independent.
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => vi.fn() }
})

// Silence @radix-ui portal issues in jsdom
vi.mock('@radix-ui/react-portal', () => ({
  Portal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

// Mock toast to track calls
vi.mock('@/components/ui/toaster', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  }),
}))

// Mock RecordingLinkDialog — renders a simple stub
vi.mock('@/components/RecordingLinkDialog', () => ({
  RecordingLinkDialog: ({
    open,
    onClose,
    onResolved,
  }: {
    open: boolean
    onClose: () => void
    onResolved: () => void
  }) => {
    if (!open) return null
    return (
      <div data-testid="link-dialog">
        <button onClick={() => { onResolved(); onClose() }}>Confirm Link</button>
        <button onClick={onClose}>Cancel Link</button>
      </div>
    )
  },
}))

// Mock ConfirmDialog — renders a simple stub
vi.mock('@/components/ConfirmDialog', () => ({
  ConfirmDialog: ({
    open,
    onConfirm,
    onOpenChange,
    title,
    actionLabel,
    cancelLabel,
  }: {
    open: boolean
    onConfirm: () => void
    onOpenChange: (open: boolean) => void
    title: string
    actionLabel?: string
    cancelLabel?: string
  }) => {
    if (!open) return null
    return (
      <div data-testid="confirm-dialog">
        <h2>{title}</h2>
        <button onClick={onConfirm}>{actionLabel || 'Continue'}</button>
        <button onClick={() => onOpenChange(false)}>{cancelLabel || 'Cancel'}</button>
      </div>
    )
  },
}))

// Mock the WaveformPlayer to avoid audio API issues (and so its internal speed
// Select doesn't collide with the mocked category Select below).
vi.mock('../WaveformPlayer', () => ({
  WaveformPlayer: () => <div data-testid="waveform-player" />,
}))

// Mock TranscriptViewer to keep tests focused
vi.mock('../TranscriptViewer', () => ({
  TranscriptViewer: () => <div data-testid="transcript-viewer" />,
}))

// Mock Radix Select — jsdom cannot open portals, so render a native <select>
vi.mock('@/components/ui/select', () => ({
  Select: ({ onValueChange, value, children }: any) => (
    <select
      data-testid="category-select"
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ children, value }: any) => <option value={value}>{children}</option>,
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeRecording(overrides: Partial<UnifiedRecording> = {}): UnifiedRecording {
  return {
    id: 'rec-1',
    filename: 'meeting-2024.wav',
    size: 1024 * 1024,
    duration: 3600,
    dateRecorded: new Date('2024-01-15T10:00:00Z'),
    transcriptionStatus: 'none',
    location: 'local-only',
    localPath: '/home/user/recordings/meeting-2024.wav',
    syncStatus: 'synced',
    ...overrides,
  } as UnifiedRecording
}

function makeMeeting(): Meeting {
  return {
    id: 'meet-1',
    subject: 'Team Standup',
    start_time: '2024-01-15T09:00:00Z',
    end_time: '2024-01-15T09:30:00Z',
  } as Meeting
}

beforeEach(() => {
  vi.clearAllMocks()

  // Set up window.electronAPI
  Object.defineProperty(window, 'electronAPI', {
    value: {
      knowledge: {
        update: mockKnowledgeUpdate,
        setProjects: mockSetProjects,
      },
      projects: {
        getForKnowledge: mockGetForKnowledge,
        getAll: mockGetAllProjects,
        openFolder: vi.fn().mockResolvedValue({ success: true }),
      },
      recordings: {
        selectMeeting: mockSelectMeeting,
        getCandidates: vi.fn().mockResolvedValue({ success: true, data: [] }),
        getMeetingsNearDate: vi.fn().mockResolvedValue({ success: true, data: [] }),
      },
      contacts: {
        getForMeeting: vi.fn().mockResolvedValue({ success: true, data: [] }),
        getForMeetingOwner: vi.fn().mockResolvedValue({ success: true, data: [] }),
      },
      transcripts: {
        getByRecordingIdOwner: vi.fn().mockResolvedValue(null),
        getProcessingRuns: vi.fn().mockResolvedValue({ success: true, data: [] }),
        getSpeakerMap: vi.fn().mockResolvedValue({ success: true, data: [] }),
      },
      turnSpeakers: {
        getOverrides: vi.fn().mockResolvedValue({ success: true, data: [] }),
        getSplits: vi.fn().mockResolvedValue({ success: true, data: [] }),
        getMergeHints: vi.fn().mockResolvedValue({ success: true, data: [] }),
      },
    },
    writable: true,
    configurable: true,
  })
})

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
describe('SourceReader — metadata editing', () => {

  // 1. Title shows as static text by default
  it('shows title as static text when not editing', () => {
    const rec = makeRecording({ userTitle: 'My Recording Title', knowledgeCaptureId: 'kc-1' })
    render(<SourceReader recording={rec} />)

    expect(screen.getByText('My Recording Title')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /recording title/i })).not.toBeInTheDocument()
  })

  // 2. Pencil icon visible on hover when knowledgeCaptureId present
  it('renders pencil edit button when knowledgeCaptureId is present', () => {
    const rec = makeRecording({ knowledgeCaptureId: 'kc-1', title: 'My Title' })
    render(<SourceReader recording={rec} />)

    expect(screen.getByRole('button', { name: /edit title/i })).toBeInTheDocument()
  })

  // 3. No pencil icon when knowledgeCaptureId absent
  it('does not render pencil edit button when knowledgeCaptureId is absent', () => {
    const rec = makeRecording({ knowledgeCaptureId: undefined, title: 'My Title' })
    render(<SourceReader recording={rec} />)

    expect(screen.queryByRole('button', { name: /edit title/i })).not.toBeInTheDocument()
  })

  it('keeps filename and content title distinct while the meeting subject owns the heading', () => {
    const rec = makeRecording({ knowledgeCaptureId: 'kc-1', userTitle: 'My content title' })
    render(<SourceReader recording={rec} meeting={makeMeeting()} transcript={{
      id: 'tx-fields', recording_id: rec.id, full_text: 'hello', title_suggestion: 'AI short title'
    } as any} />)

    const fields = screen.getByTestId('source-identity-fields')
    expect(fields).toHaveTextContent('meeting-2024.wav')
    expect(fields).toHaveTextContent('My content title')
    expect(screen.getByRole('heading', { name: 'Team Standup' })).toBeInTheDocument()
  })

  it('renders stage-specific provider/tool provenance chips', async () => {
    vi.mocked(window.electronAPI.transcripts.getProcessingRuns).mockResolvedValueOnce({
      success: true,
      data: [
        { id: 'run-tx', stage: 'transcription', provider: 'gemini', tool: 'gemini', model: 'gemini-3.5-flash', execution: 'cloud', status: 'completed' },
        { id: 'run-dia', stage: 'diarization', provider: 'local-asr', tool: 'pyannote', model: null, execution: 'local', status: 'degraded', quality_status: 'degraded' },
        { id: 'run-sum', stage: 'summary', provider: 'gemini', tool: 'gemini-analysis', model: 'gemini-3.5-flash', execution: 'cloud', status: 'completed' },
      ]
    } as any)
    const rec = makeRecording({ transcriptionStatus: 'complete' })
    render(<SourceReader recording={rec} transcript={{ id: 'tx-runs', recording_id: rec.id, full_text: 'hello' } as any} />)

    const provenance = await screen.findByTestId('processing-provenance')
    expect(provenance).toHaveTextContent('Transcription · Gemini')
    expect(provenance).toHaveTextContent('Diarization · pyannote')
    expect(provenance).toHaveTextContent('Summary · Gemini')
  })

  it('shows blocked speaker identity as blocked instead of claiming successful resolution', async () => {
    vi.mocked(window.electronAPI.transcripts.getProcessingRuns).mockResolvedValueOnce({
      success: true,
      data: [{
        id: 'run-identity', stage: 'speaker-identity', provider: 'hidock-next',
        tool: 'self-id+trusted-roster', model: null, execution: 'local',
        status: 'degraded', quality_status: 'blocked'
      }]
    } as any)
    const rec = makeRecording({ transcriptionStatus: 'complete' })
    render(<SourceReader recording={rec} transcript={{ id: 'tx-blocked', recording_id: rec.id, full_text: 'hello' } as any} />)

    const provenance = await screen.findByTestId('processing-provenance')
    expect(provenance).toHaveTextContent('Speaker identity · blocked')
    expect(provenance).not.toHaveTextContent('Speaker identity · self-id+trusted-roster')
  })

  // 4. Clicking pencil enters edit mode
  it('clicking pencil button enters title edit mode', () => {
    const rec = makeRecording({ knowledgeCaptureId: 'kc-1', userTitle: 'Current Title' })
    render(<SourceReader recording={rec} />)

    fireEvent.click(screen.getByRole('button', { name: /edit title/i }))

    expect(screen.getByRole('textbox', { name: /recording title/i })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /recording title/i })).toHaveValue('Current Title')
  })

  // 5. Enter saves title (calls knowledge.update)
  it('pressing Enter saves title via knowledge.update IPC', async () => {
    const rec = makeRecording({ knowledgeCaptureId: 'kc-1', userTitle: 'Old Title' })
    render(<SourceReader recording={rec} />)

    fireEvent.click(screen.getByRole('button', { name: /edit title/i }))
    const input = screen.getByRole('textbox', { name: /recording title/i })
    fireEvent.change(input, { target: { value: 'New Title' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => {
      expect(mockKnowledgeUpdate).toHaveBeenCalledWith('kc-1', { userTitle: 'New Title' })
    })
  })

  // 6. Escape cancels (no IPC call)
  it('pressing Escape cancels title editing without calling IPC', () => {
    const rec = makeRecording({ knowledgeCaptureId: 'kc-1', userTitle: 'Old Title' })
    render(<SourceReader recording={rec} />)

    fireEvent.click(screen.getByRole('button', { name: /edit title/i }))
    const input = screen.getByRole('textbox', { name: /recording title/i })
    fireEvent.change(input, { target: { value: 'Changed Title' } })
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(mockKnowledgeUpdate).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox', { name: /recording title/i })).not.toBeInTheDocument()
  })

  // 7. Empty title rejected
  it('empty title triggers error toast and does not call IPC', async () => {
    const { toast } = await import('@/components/ui/toaster')
    const rec = makeRecording({ knowledgeCaptureId: 'kc-1', userTitle: 'Old Title' })
    render(<SourceReader recording={rec} />)

    fireEvent.click(screen.getByRole('button', { name: /edit title/i }))
    const input = screen.getByRole('textbox', { name: /recording title/i })
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => {
      expect((toast as any).error).toHaveBeenCalledWith('Title cannot be empty')
    })
    expect(mockKnowledgeUpdate).not.toHaveBeenCalled()
  })

  // 8. Category dropdown renders when knowledgeCaptureId present
  it('renders category Select when knowledgeCaptureId is present', () => {
    const rec = makeRecording({ knowledgeCaptureId: 'kc-1', category: 'meeting' })
    render(<SourceReader recording={rec} />)

    // The SelectTrigger button has the current value text
    expect(screen.getByTestId('category-select')).toHaveValue('meeting')
  })

  // 9. Category change calls knowledge.update
  it('changing category via Select calls knowledge.update', async () => {
    const rec = makeRecording({ knowledgeCaptureId: 'kc-1', category: 'meeting' })
    render(<SourceReader recording={rec} />)

    fireEvent.change(screen.getByTestId('category-select'), { target: { value: 'interview' } })

    await waitFor(() => {
      expect(mockKnowledgeUpdate).toHaveBeenCalledWith('kc-1', { category: 'interview' })
    })
  })

  // 9b. Same category makes no IPC call
  it('selecting the same category makes no IPC call', async () => {
    const rec = makeRecording({ knowledgeCaptureId: 'kc-1', category: 'meeting' })
    render(<SourceReader recording={rec} />)

    fireEvent.change(screen.getByTestId('category-select'), { target: { value: 'meeting' } })

    // Allow microtasks to flush
    await new Promise((r) => setTimeout(r, 0))
    expect(mockKnowledgeUpdate).not.toHaveBeenCalled()
  })

  // 10. onMetadataEdited fires on successful title save
  it('onMetadataEdited callback fires after successful title save', async () => {
    const onMetadataEdited = vi.fn()
    const rec = makeRecording({ knowledgeCaptureId: 'kc-1', userTitle: 'Old Title' })
    render(<SourceReader recording={rec} onMetadataEdited={onMetadataEdited} />)

    fireEvent.click(screen.getByRole('button', { name: /edit title/i }))
    const input = screen.getByRole('textbox', { name: /recording title/i })
    fireEvent.change(input, { target: { value: 'New Title' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => {
      expect(onMetadataEdited).toHaveBeenCalledOnce()
    })
  })

  // 11. Edit state resets when recording.id changes
  it('editing state resets when recording changes', () => {
    const rec1 = makeRecording({ id: 'rec-1', knowledgeCaptureId: 'kc-1', userTitle: 'Title 1' })
    const rec2 = makeRecording({ id: 'rec-2', knowledgeCaptureId: 'kc-2', userTitle: 'Title 2' })

    const { rerender } = render(<SourceReader recording={rec1} />)

    // Enter edit mode
    fireEvent.click(screen.getByRole('button', { name: /edit title/i }))
    expect(screen.getByRole('textbox', { name: /recording title/i })).toBeInTheDocument()

    // Change recording — edit mode should be reset
    rerender(<SourceReader recording={rec2} />)

    expect(screen.queryByRole('textbox', { name: /recording title/i })).not.toBeInTheDocument()
    expect(screen.getByText('Title 2')).toBeInTheDocument()
  })

  // 12. Meeting card shows Change/Remove when meeting linked
  it('shows Change and Remove buttons on meeting card when meeting is linked', () => {
    const rec = makeRecording({ knowledgeCaptureId: 'kc-1' })
    const meeting = makeMeeting()
    render(<SourceReader recording={rec} meeting={meeting} />)

    expect(screen.getByTitle(/change linked meeting/i)).toBeInTheDocument()
    expect(screen.getByTitle(/remove meeting link/i)).toBeInTheDocument()
  })

  it('renders linked meeting controls before Speakers in the dock', async () => {
    vi.mocked(window.electronAPI.contacts.getForMeetingOwner).mockResolvedValueOnce({
      success: true,
      data: [{ id: 'contact-1', name: 'Alex Participant', email: 'alex@example.com' }],
    } as any)
    const rec = makeRecording({ knowledgeCaptureId: 'kc-1' })

    render(<SourceReader recording={rec} meeting={makeMeeting()} transcript={{
      id: 'tx-1', recording_id: rec.id, full_text: 'hola',
      speakers: JSON.stringify([{ speaker: 'Speaker 1', start: 0, end: 1, text: 'hola' }])
    } as any} />)

    const meetingCard = screen.getByTestId('linked-meeting-card')
    const participants = await screen.findByTestId('participants-section')
    expect(meetingCard.compareDocumentPosition(participants) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  // 13. "Link Meeting" is a visible header action when no meeting is linked
  it('shows a visible Link Meeting action when no meeting is linked', () => {
    const rec = makeRecording({ knowledgeCaptureId: 'kc-1' })
    render(<SourceReader recording={rec} />)

    expect(screen.getByRole('button', { name: /link this recording to a meeting/i })).toBeInTheDocument()
  })

  // 14. Remove calls selectMeeting(id, null)
  it('clicking Remove meeting button calls recordings.selectMeeting with null', async () => {
    const rec = makeRecording({ id: 'rec-42', knowledgeCaptureId: 'kc-1' })
    const meeting = makeMeeting()
    render(<SourceReader recording={rec} meeting={meeting} />)

    fireEvent.click(screen.getByRole('button', { name: /^remove meeting link$/i }))
    expect(screen.getByText(/remove this meeting link/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^remove link$/i }))

    await waitFor(() => {
      expect(mockSelectMeeting).toHaveBeenCalledWith('rec-42', null)
    })
  })

  it('reports an unlink failure without marking metadata edited', async () => {
    const { toast } = await import('@/components/ui/toaster')
    const onMetadataEdited = vi.fn()
    mockSelectMeeting.mockResolvedValueOnce({ success: false, error: 'Database unavailable' })
    const rec = makeRecording({ id: 'rec-42', knowledgeCaptureId: 'kc-1' })

    render(<SourceReader recording={rec} meeting={makeMeeting()} onMetadataEdited={onMetadataEdited} />)
    fireEvent.click(screen.getByRole('button', { name: /^remove meeting link$/i }))
    fireEvent.click(screen.getByRole('button', { name: /^remove link$/i }))

    await waitFor(() => {
      expect((toast as any).error).toHaveBeenCalledWith(
        'Failed to remove meeting link',
        'Database unavailable'
      )
    })
    expect(onMetadataEdited).not.toHaveBeenCalled()
  })

  // 15. Transcribe without edits → no dialog, onTranscribe called directly
  it('clicking Transcribe without prior edits calls onTranscribe directly', () => {
    const onTranscribe = vi.fn()
    const rec = makeRecording({ knowledgeCaptureId: 'kc-1', transcriptionStatus: 'none' })
    render(<SourceReader recording={rec} onTranscribe={onTranscribe} />)

    fireEvent.click(screen.getByRole('button', { name: /transcribe/i }))

    expect(onTranscribe).toHaveBeenCalledOnce()
    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument()
  })

  // 16. Transcribe after title edit → warning dialog shown
  it('clicking Transcribe after editing title shows confirm dialog', async () => {
    const onTranscribe = vi.fn()
    const rec = makeRecording({ knowledgeCaptureId: 'kc-1', userTitle: 'Old', transcriptionStatus: 'none' })
    render(<SourceReader recording={rec} onTranscribe={onTranscribe} />)

    // Edit title to trigger metadataEdited flag
    fireEvent.click(screen.getByRole('button', { name: /edit title/i }))
    const input = screen.getByRole('textbox', { name: /recording title/i })
    fireEvent.change(input, { target: { value: 'New Title' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    // Wait for IPC call and state update
    await waitFor(() => expect(mockKnowledgeUpdate).toHaveBeenCalled())

    // Now click Transcribe
    fireEvent.click(screen.getByRole('button', { name: /transcribe/i }))

    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
    expect(onTranscribe).not.toHaveBeenCalled()
  })

  // 17. Confirm dialog → onTranscribe called, state reset
  it('confirming transcription warning calls onTranscribe and dismisses dialog', async () => {
    const onTranscribe = vi.fn()
    const rec = makeRecording({ knowledgeCaptureId: 'kc-1', userTitle: 'Old', transcriptionStatus: 'none' })
    render(<SourceReader recording={rec} onTranscribe={onTranscribe} />)

    // Edit title
    fireEvent.click(screen.getByRole('button', { name: /edit title/i }))
    const input = screen.getByRole('textbox', { name: /recording title/i })
    fireEvent.change(input, { target: { value: 'New Title' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(mockKnowledgeUpdate).toHaveBeenCalled())

    // Click Transcribe to show dialog
    fireEvent.click(screen.getByRole('button', { name: /transcribe/i }))
    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()

    // Confirm
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }))

    expect(onTranscribe).toHaveBeenCalledOnce()
    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument()
  })

  // 18. Cancel dialog → onTranscribe NOT called
  it('cancelling transcription warning does not call onTranscribe', async () => {
    const onTranscribe = vi.fn()
    const rec = makeRecording({ knowledgeCaptureId: 'kc-1', userTitle: 'Old', transcriptionStatus: 'none' })
    render(<SourceReader recording={rec} onTranscribe={onTranscribe} />)

    // Edit title
    fireEvent.click(screen.getByRole('button', { name: /edit title/i }))
    const input = screen.getByRole('textbox', { name: /recording title/i })
    fireEvent.change(input, { target: { value: 'New Title' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(mockKnowledgeUpdate).toHaveBeenCalled())

    // Click Transcribe to show dialog
    fireEvent.click(screen.getByRole('button', { name: /transcribe/i }))
    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()

    // Cancel
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }))

    expect(onTranscribe).not.toHaveBeenCalled()
    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument()
  })

})

// ---------------------------------------------------------------------------
// Projects assignment picker (v29)
// ---------------------------------------------------------------------------
describe('SourceReader — projects assignment', () => {
  it('loads assigned projects for a captured recording', async () => {
    mockGetForKnowledge.mockResolvedValueOnce({ success: true, data: [{ id: 'pr1', name: 'Alpha' }] })
    const rec = makeRecording({ knowledgeCaptureId: 'kc-1' })
    render(<SourceReader recording={rec} />)

    expect(await screen.findByText('Alpha')).toBeInTheDocument()
    expect(mockGetForKnowledge).toHaveBeenCalledWith('kc-1')
  })

  it('does not render the projects row without a knowledgeCaptureId', () => {
    const rec = makeRecording({ knowledgeCaptureId: undefined })
    render(<SourceReader recording={rec} />)

    expect(screen.queryByRole('button', { name: /assign project/i })).not.toBeInTheDocument()
  })

  it('assigning a project via the picker calls knowledge.setProjects', async () => {
    const rec = makeRecording({ knowledgeCaptureId: 'kc-1' })
    render(<SourceReader recording={rec} />)

    // Open the picker popover
    fireEvent.click(screen.getByRole('button', { name: /assign project/i }))

    // Click the Alpha option (loaded via projects.getAll)
    const option = await screen.findByRole('button', { name: /alpha/i })
    fireEvent.click(option)

    await waitFor(() => {
      expect(mockSetProjects).toHaveBeenCalledWith({ knowledgeCaptureId: 'kc-1', projectIds: ['pr1'] })
    })
  })
})

// ---------------------------------------------------------------------------
// Hook-order stability (regression)
//
// The `transcriptSegments` useMemo once sat AFTER the "no recording selected"
// early return. With no recording the placeholder rendered without that hook;
// selecting a recording then added it, so React threw "Rendered more hooks than
// during the previous render." The memo now runs unconditionally above the
// early return, so hook count is stable across the null → selected transition.
// ---------------------------------------------------------------------------
describe('SourceReader — hook order stability (regression)', () => {
  function makeTranscript() {
    return {
      id: 't-1',
      recording_id: 'rec-1',
      full_text: 'hola qué tal',
      summary: 'resumen',
      action_items: JSON.stringify(['hacer algo']),
      speakers: JSON.stringify([{ speaker: 'Speaker 1', start: 0, end: 1, text: 'hola qué tal' }]),
    } as any
  }

  it('does not throw a hooks-order error when switching from no recording to a selected one', () => {
    const { rerender } = render(<SourceReader recording={null} />)
    expect(screen.getByText(/no source selected/i)).toBeInTheDocument()

    // Selecting a recording that carries a transcript with `speakers` exercises
    // the transcriptSegments memo — this is the exact transition that crashed.
    expect(() =>
      rerender(
        <SourceReader recording={makeRecording({ title: 'Con transcript' })} transcript={makeTranscript()} />
      )
    ).not.toThrow()

    expect(screen.getByTestId('transcript-viewer')).toBeInTheDocument()
  })

  it('does not throw when switching back from a selected recording to none', () => {
    const { rerender } = render(
      <SourceReader recording={makeRecording({ title: 'Con transcript' })} transcript={makeTranscript()} />
    )
    expect(screen.getByTestId('transcript-viewer')).toBeInTheDocument()

    expect(() => rerender(<SourceReader recording={null} />)).not.toThrow()
    expect(screen.getByText(/no source selected/i)).toBeInTheDocument()
  })
})
