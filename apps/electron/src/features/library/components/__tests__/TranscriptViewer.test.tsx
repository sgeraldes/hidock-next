/**
 * Tests for TranscriptViewer transcript parsing/rendering.
 *
 * Focus: speaker-label handling for transcripts WITHOUT timestamps, especially
 * markdown-bold labels (**Name:**) produced by the transcription pipeline, which
 * previously rendered with literal asterisks.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { TranscriptViewer } from '../TranscriptViewer'

vi.mock('@/components/ui/toaster', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() }
}))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => mockNavigate }
})

const noop = () => {}

describe('TranscriptViewer speaker parsing', () => {
  it('renders markdown-bold **Name:** labels as speaker names without asterisks', () => {
    const transcript = [
      '**Vanessa:** Hola a todos, ¿cómo están?',
      '',
      '**Jorge:** Bien, gracias. Empecemos.',
    ].join('\n')

    render(<TranscriptViewer transcript={transcript} onSeek={noop} />)

    // Speaker names appear as their own elements (no surrounding ** markers)
    expect(screen.getByText('Vanessa')).toBeInTheDocument()
    expect(screen.getByText('Jorge')).toBeInTheDocument()

    // The literal markdown markers must not survive into the rendered output
    expect(screen.queryByText(/\*\*/)).not.toBeInTheDocument()

    // Spoken text is preserved
    expect(screen.getByText(/Hola a todos/)).toBeInTheDocument()
    expect(screen.getByText(/Empecemos/)).toBeInTheDocument()
  })

  it('handles **Name**: (colon outside the bold) too', () => {
    render(<TranscriptViewer transcript={'**Kevin**: Listo, gracias.'} onSeek={noop} />)
    expect(screen.getByText('Kevin')).toBeInTheDocument()
    expect(screen.getByText(/Listo, gracias\./)).toBeInTheDocument()
    expect(screen.queryByText(/\*\*/)).not.toBeInTheDocument()
  })

  it('still renders plain "Name:" speaker labels', () => {
    render(<TranscriptViewer transcript={'Sebastián: Perfecto, quedamos así.'} onSeek={noop} />)
    expect(screen.getByText('Sebastián')).toBeInTheDocument()
    expect(screen.getByText(/quedamos así/)).toBeInTheDocument()
  })

  it('renders a transcript with no speaker labels as plain text', () => {
    render(<TranscriptViewer transcript={'Just some narration without any speaker labels.'} onSeek={noop} />)
    expect(screen.getByText(/Just some narration/)).toBeInTheDocument()
  })

  it('breaks a long unstructured blob into multiple paragraphs (not one wall)', () => {
    // A single line with no newlines and many sentences (an old-style transcript).
    const blob = Array.from({ length: 20 }, (_, i) => `This is sentence number ${i} in the call.`).join(' ')
    const { container } = render(<TranscriptViewer transcript={blob} onSeek={noop} />)
    // The plain-text fallback should emit more than one <p> for a long blob.
    const paragraphs = container.querySelectorAll('p.whitespace-pre-wrap')
    expect(paragraphs.length).toBeGreaterThan(1)
  })
})

describe('TranscriptViewer stored segments', () => {
  it('renders structured turns from the segments prop with speaker labels', () => {
    const segments = [
      { speaker: 'Speaker 1', start: 3, end: 7, text: 'Hola, buenos días.' },
      { speaker: 'Speaker 2', start: 7, end: 12, text: 'Buenos días a todos.' }
    ]
    render(<TranscriptViewer transcript={'ignored plain text'} segments={segments} onSeek={noop} />)
    expect(screen.getByText('Speaker 1')).toBeInTheDocument()
    expect(screen.getByText('Speaker 2')).toBeInTheDocument()
    expect(screen.getByText(/Hola, buenos días/)).toBeInTheDocument()
    expect(screen.getByText(/Buenos días a todos/)).toBeInTheDocument()
    // The plain transcript text must not be used when segments are present.
    expect(screen.queryByText('ignored plain text')).not.toBeInTheDocument()
  })

  it('splits a legacy single segment with inline [MM:SS] Speaker N: markers into separate turns', () => {
    // Pre-fix data: a whole chunk stored as ONE segment with inline markers.
    const segments = [
      {
        speaker: 'Speaker 1',
        start: 0,
        end: 600,
        text: '[00:03] Speaker 1: Hola, buenos días. [00:09] Speaker 2: Buenos días a todos. [05:32] Speaker 3: Perdón la demora.'
      }
    ]
    render(<TranscriptViewer transcript={'ignored'} segments={segments} onSeek={noop} />)

    // Each embedded speaker becomes its own labelled turn.
    expect(screen.getByText('Speaker 1')).toBeInTheDocument()
    expect(screen.getByText('Speaker 2')).toBeInTheDocument()
    expect(screen.getByText('Speaker 3')).toBeInTheDocument()
    expect(screen.getByText('Hola, buenos días.')).toBeInTheDocument()
    expect(screen.getByText('Buenos días a todos.')).toBeInTheDocument()
    expect(screen.getByText('Perdón la demora.')).toBeInTheDocument()
    // The raw marker text must not survive glued together in one box.
    expect(screen.queryByText(/\[00:09\] Speaker 2:/)).not.toBeInTheDocument()
  })
})

describe('TranscriptViewer speaker assignment (recordingId)', () => {
  const mockGetSpeakerMap = vi.fn()
  const mockGetAll = vi.fn()
  const mockGetById = vi.fn()
  const mockAssignSpeaker = vi.fn()
  const mockUnassignSpeaker = vi.fn()

  const segments = [{ speaker: 'Speaker 1', start: 0, end: 5, text: 'Hello there, everyone.' }]

  function renderViewer(props: Partial<React.ComponentProps<typeof TranscriptViewer>> = {}) {
    return render(
      <MemoryRouter>
        <TranscriptViewer transcript="x" segments={segments} recordingId="rec1" onSeek={noop} {...props} />
      </MemoryRouter>
    )
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSpeakerMap.mockResolvedValue({ success: true, data: [] })
    mockGetAll.mockResolvedValue({
      success: true,
      data: {
        contacts: [
          {
            id: 'c1',
            name: 'Alice',
            email: 'alice@example.com',
            type: 'team',
            role: 'Engineer',
            company: 'Acme',
            interactionCount: 12,
            tags: []
          },
          { id: 'c2', name: 'Bob', email: null, type: 'unknown', tags: [] }
        ],
        total: 2
      }
    })
    mockGetById.mockResolvedValue({
      success: true,
      data: {
        contact: {
          id: 'c1',
          name: 'Alice',
          email: 'alice@example.com',
          type: 'team',
          role: 'Engineer',
          company: 'Acme',
          interactionCount: 12,
          lastSeenAt: '2026-05-01T10:00:00Z',
          tags: []
        }
      }
    })
    mockAssignSpeaker.mockResolvedValue({ success: true, data: { id: 'c1', name: 'Alice' } })
    mockUnassignSpeaker.mockResolvedValue({ success: true })
    ;(window as any).electronAPI = {
      transcripts: {
        getSpeakerMap: mockGetSpeakerMap,
        assignSpeaker: mockAssignSpeaker,
        unassignSpeaker: mockUnassignSpeaker
      },
      contacts: { getAll: mockGetAll, getById: mockGetById }
    }
  })

  it('renders the speaker label as an assign button and loads the speaker map', async () => {
    renderViewer()
    await waitFor(() => expect(mockGetSpeakerMap).toHaveBeenCalledWith({ recordingId: 'rec1' }))
    expect(screen.getByRole('button', { name: /Assign speaker Speaker 1/i })).toBeInTheDocument()
  })

  it('assigns an existing contact when picked from the popover', async () => {
    renderViewer()
    await waitFor(() => expect(mockGetSpeakerMap).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: /Assign speaker Speaker 1/i }))

    // Popover opening lazily loads the contacts list.
    await waitFor(() => expect(mockGetAll).toHaveBeenCalled())

    fireEvent.click(await screen.findByText('Alice'))

    await waitFor(() =>
      expect(mockAssignSpeaker).toHaveBeenCalledWith({
        recordingId: 'rec1',
        speakerLabel: 'Speaker 1',
        contactId: 'c1'
      })
    )
  })

  it('renders rich picker rows with role · company and meeting count', async () => {
    renderViewer()
    await waitFor(() => expect(mockGetSpeakerMap).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: /Assign speaker Speaker 1/i }))
    await waitFor(() => expect(mockGetAll).toHaveBeenCalled())

    // Secondary line combines role and company; interactionCount renders as meetings.
    expect(await screen.findByText('Engineer · Acme')).toBeInTheDocument()
    expect(screen.getByText('12 meetings')).toBeInTheDocument()
  })

  it('creates a new person from a typed name', async () => {
    renderViewer()
    await waitFor(() => expect(mockGetSpeakerMap).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: /Assign speaker Speaker 1/i }))
    const input = await screen.findByLabelText('Search or create person')
    fireEvent.change(input, { target: { value: 'Charlie' } })
    fireEvent.click(screen.getByText(/Create/))

    await waitFor(() =>
      expect(mockAssignSpeaker).toHaveBeenCalledWith({
        recordingId: 'rec1',
        speakerLabel: 'Speaker 1',
        newName: 'Charlie'
      })
    )
  })

  it('shows an unidentified hint when hovering an unassigned label', async () => {
    renderViewer()
    await waitFor(() => expect(mockGetSpeakerMap).toHaveBeenCalled())

    fireEvent.mouseEnter(screen.getByRole('button', { name: /Assign speaker Speaker 1/i }))
    expect(await screen.findByText('Unidentified speaker')).toBeInTheDocument()
  })

  it('shows the assigned person metadata when hovering an assigned label', async () => {
    mockGetSpeakerMap.mockResolvedValue({
      success: true,
      data: [{ speaker_label: 'Speaker 1', contact_id: 'c1', name: 'Alice' }]
    })
    renderViewer()

    const nameButton = await screen.findByRole('button', { name: /Speaker: Alice/i })
    fireEvent.mouseEnter(nameButton)

    // PersonHoverCard lazily fetches the contact and shows its metadata.
    await waitFor(() => expect(mockGetById).toHaveBeenCalledWith('c1'))
    expect(await screen.findByText('alice@example.com')).toBeInTheDocument()
    expect(screen.getByText(/Engineer · Acme/)).toBeInTheDocument()
  })

  it('resets an assigned speaker to unidentified', async () => {
    mockGetSpeakerMap.mockResolvedValue({
      success: true,
      data: [{ speaker_label: 'Speaker 1', contact_id: 'c1', name: 'Alice' }]
    })
    renderViewer()

    // Once resolved, the label button shows the person's name.
    const nameButton = await screen.findByRole('button', { name: /Speaker: Alice/i })
    fireEvent.click(nameButton)

    // The assigned popover shows actions rather than the picker by default.
    fireEvent.click(await screen.findByText(/Reset to unidentified/i))

    await waitFor(() =>
      expect(mockUnassignSpeaker).toHaveBeenCalledWith({ recordingId: 'rec1', speakerLabel: 'Speaker 1' })
    )
  })

  it('navigates to the person page from the assigned popover', async () => {
    mockGetSpeakerMap.mockResolvedValue({
      success: true,
      data: [{ speaker_label: 'Speaker 1', contact_id: 'c1', name: 'Alice' }]
    })
    renderViewer()

    fireEvent.click(await screen.findByRole('button', { name: /Speaker: Alice/i }))
    fireEvent.click(await screen.findByText('View person'))

    expect(mockNavigate).toHaveBeenCalledWith('/person/c1')
  })

  it('reveals the picker via "Change identity" for an assigned speaker', async () => {
    mockGetSpeakerMap.mockResolvedValue({
      success: true,
      data: [{ speaker_label: 'Speaker 1', contact_id: 'c1', name: 'Alice' }]
    })
    renderViewer()

    fireEvent.click(await screen.findByRole('button', { name: /Speaker: Alice/i }))
    // Picker is hidden until "Change identity" is chosen.
    expect(screen.queryByLabelText('Search or create person')).not.toBeInTheDocument()

    fireEvent.click(await screen.findByText(/Change identity/i))
    expect(await screen.findByLabelText('Search or create person')).toBeInTheDocument()
  })

  it('opens the same popover on right-click (no native context menu)', async () => {
    renderViewer()
    await waitFor(() => expect(mockGetSpeakerMap).toHaveBeenCalled())

    fireEvent.contextMenu(screen.getByRole('button', { name: /Assign speaker Speaker 1/i }))
    // Right-click routes through the open path, so contacts load lazily too.
    await waitFor(() => expect(mockGetAll).toHaveBeenCalled())
    expect(await screen.findByLabelText('Search or create person')).toBeInTheDocument()
  })

  it('renders labels as plain text (no button) when recordingId is absent', () => {
    render(
      <MemoryRouter>
        <TranscriptViewer transcript="x" segments={segments} onSeek={noop} />
      </MemoryRouter>
    )
    expect(screen.getByText('Speaker 1')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Assign speaker/i })).not.toBeInTheDocument()
  })
})
