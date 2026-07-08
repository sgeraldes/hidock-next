import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { IdentitySuggestionsSection } from '../IdentitySuggestionsSection'
import { TodayIdentitySuggestions } from '../TodayIdentitySuggestions'
import { ToastProvider } from '@/components/ui/toaster'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

const suggestion = {
  id: 's1',
  kind: 'person' as const,
  candidate_name: 'Sebas',
  target_id: 'c1',
  confidence: 0.72,
  evidence: JSON.stringify({ method: 'fuzzy', meetingId: 'm1', coOccurring: ['Edu'] }),
  status: 'pending' as const,
  created_at: '2026-07-08T10:00:00Z'
}

const mergeSuggestion = {
  id: 'm1',
  kind: 'person' as const,
  candidate_name: 'Yeraví',
  target_id: 'c1',
  confidence: 0.86,
  evidence: JSON.stringify({ keeperId: 'c1', loserId: 'l1', keeperName: 'Yaraví', sharedMeetings: 2 }),
  status: 'pending' as const,
  created_at: '2026-07-08T10:00:00Z'
}

const mockGetSuggestions = vi.fn()
const mockAccept = vi.fn()
const mockReject = vi.fn()
const mockContactGetById = vi.fn()
const mockContactUnmerge = vi.fn()
const mockProjectUnmerge = vi.fn()
const mockGetMentionSnippets = vi.fn()
const mockGetMergeImpact = vi.fn()

global.window.electronAPI = {
  identity: {
    getSuggestions: mockGetSuggestions,
    acceptSuggestion: mockAccept,
    rejectSuggestion: mockReject,
    getMentionSnippets: mockGetMentionSnippets,
    getMergeImpact: mockGetMergeImpact
  },
  contacts: {
    getById: mockContactGetById,
    unmerge: mockContactUnmerge
  },
  projects: {
    getById: vi.fn().mockResolvedValue({ success: true, data: { project: { name: 'Proj' } } }),
    unmerge: mockProjectUnmerge
  }
} as any

const renderSection = () =>
  render(
    <ToastProvider>
      <MemoryRouter>
        <IdentitySuggestionsSection />
      </MemoryRouter>
    </ToastProvider>
  )

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSuggestions.mockResolvedValue({ success: true, data: [suggestion] })
  mockAccept.mockResolvedValue({ success: true, data: { id: 's1', status: 'accepted', mergeJournalId: null } })
  mockReject.mockResolvedValue({ success: true })
  mockContactGetById.mockResolvedValue({
    success: true,
    data: { contact: { name: 'Sebastián', role: 'Engineer', email: 'seba@dfx5.com', meeting_count: 4 } }
  })
  mockContactUnmerge.mockResolvedValue({ success: true })
  mockGetMentionSnippets.mockResolvedValue({ success: true, data: { snippets: [], recordingIds: [] } })
  mockGetMergeImpact.mockResolvedValue({ success: true, data: { keeper: 1, loser: 1 } })
})

describe('IdentitySuggestionsSection', () => {
  it('renders both entities, the survivor line, and human evidence', async () => {
    renderSection()
    expect(await screen.findByText(/Identity suggestions \(1\)/)).toBeInTheDocument()
    // Keeper name resolves lazily (appears in the profile chip + survivor line).
    expect((await screen.findAllByText('Sebastián')).length).toBeGreaterThan(0)
    // Candidate name shows on its own chip.
    expect(screen.getAllByText(/^Sebas$/).length).toBeGreaterThan(0)
    // Survivor is explicit.
    expect(screen.getByText(/becomes an alias/)).toBeInTheDocument()
    // Confidence badge.
    expect(screen.getByText('72%')).toBeInTheDocument()
    // Evidence renders a concrete, human reason rather than "matched by fuzzy" jargon.
    expect(screen.getByText(/is part of/)).toBeInTheDocument()
  })

  it('clusters suggestions that share a target into one group card', async () => {
    const second = { ...suggestion, id: 's2', candidate_name: 'Sebi', confidence: 0.66 }
    mockGetSuggestions.mockResolvedValue({ success: true, data: [suggestion, second] })
    renderSection()
    expect(await screen.findByText(/2 names may be/)).toBeInTheDocument()
    // Two decisions → two accept buttons.
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /Merge .* into/i }).length).toBe(2)
    )
  })

  it('renders nothing when there are no pending suggestions', async () => {
    mockGetSuggestions.mockResolvedValue({ success: true, data: [] })
    renderSection()
    await waitFor(() => expect(mockGetSuggestions).toHaveBeenCalled())
    expect(screen.queryByRole('region', { name: 'Identity suggestions' })).not.toBeInTheDocument()
  })

  it('accepting a suggestion calls acceptSuggestion and removes the card optimistically', async () => {
    mockGetSuggestions
      .mockResolvedValueOnce({ success: true, data: [suggestion] })
      .mockResolvedValue({ success: true, data: [] })
    renderSection()
    const acceptBtn = await screen.findByRole('button', { name: /Merge .* into/i })
    fireEvent.click(acceptBtn)
    await waitFor(() => expect(mockAccept).toHaveBeenCalledWith('s1'))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Merge .* into/i })).not.toBeInTheDocument()
    )
  })

  it('rejecting a suggestion calls rejectSuggestion and removes the card optimistically', async () => {
    renderSection()
    const rejectBtn = await screen.findByRole('button', { name: /Keep .* separate/i })
    fireEvent.click(rejectBtn)
    await waitFor(() => expect(mockReject).toHaveBeenCalledWith('s1'))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Keep .* separate/i })).not.toBeInTheDocument()
    )
  })

  it('shows the co-presence disproof and clickable primary-source excerpts', async () => {
    // Keeper resolves to "Yaraví"; candidate is "Yeraví". Both occur in rec1.
    mockContactGetById.mockResolvedValue({ success: true, data: { contact: { name: 'Yaraví' } } })
    mockGetSuggestions.mockResolvedValue({ success: true, data: [mergeSuggestion] })
    mockGetMentionSnippets.mockImplementation((name: string) => {
      if (/Yeraví/i.test(name)) {
        return Promise.resolve({
          success: true,
          data: {
            snippets: [{ recordingId: 'rec1', title: 'Kickoff', date: '2026-07-08T10:00:00Z', snippet: '…Yeraví joined…' }],
            recordingIds: ['rec1']
          }
        })
      }
      if (/Yaraví/i.test(name)) {
        return Promise.resolve({ success: true, data: { snippets: [], recordingIds: ['rec1'] } })
      }
      return Promise.resolve({ success: true, data: { snippets: [], recordingIds: [] } })
    })

    renderSection()
    // Decisive negative evidence banner.
    expect(await screen.findByText(/same conversation/i)).toBeInTheDocument()
    // Primary-source excerpt is shown and navigates to the recording on click.
    const excerpt = await screen.findByRole('button', { name: /Open transcript: Kickoff/i })
    fireEvent.click(excerpt)
    expect(mockNavigate).toHaveBeenCalledWith('/library', { state: { selectedId: 'rec1' } })
  })

  it('gives the duplicate side symmetric weight (mention count) and previews the blast radius', async () => {
    mockContactGetById.mockResolvedValue({ success: true, data: { contact: { name: 'Yaraví' } } })
    mockGetSuggestions.mockResolvedValue({ success: true, data: [mergeSuggestion] })
    mockGetMentionSnippets.mockImplementation((name: string) => {
      if (/Yeraví/i.test(name)) {
        return Promise.resolve({
          success: true,
          data: {
            snippets: [{ recordingId: 'rec1', title: 'Kickoff', date: '2026-07-08T10:00:00Z', snippet: '…Yeraví…' }],
            recordingIds: ['rec1', 'rec2']
          }
        })
      }
      return Promise.resolve({ success: true, data: { snippets: [], recordingIds: [] } })
    })
    mockGetMergeImpact.mockResolvedValue({ success: true, data: { keeper: 3, loser: 2 } })

    renderSection()
    // Duplicate (loser) side carries its own mention count — not a bare chip.
    expect(await screen.findByText(/appears in 2 recordings/)).toBeInTheDocument()
    // Blast-radius preview.
    expect(await screen.findByText(/Merging moves/)).toBeInTheDocument()
    expect(screen.getByText(/5 total afterward/)).toBeInTheDocument()
  })

  it('requires typing the name to confirm a high-impact merge', async () => {
    mockContactGetById.mockResolvedValue({ success: true, data: { contact: { name: 'Yaraví' } } })
    mockGetSuggestions.mockResolvedValue({ success: true, data: [mergeSuggestion] })
    mockGetMergeImpact.mockResolvedValue({ success: true, data: { keeper: 12, loser: 5 } })

    renderSection()
    // Preview warns the gate is coming.
    expect(await screen.findByText(/High-impact/)).toBeInTheDocument()

    // First click opens the gate rather than merging.
    fireEvent.click(await screen.findByRole('button', { name: /^Merge .* into/i }))
    expect(mockAccept).not.toHaveBeenCalled()
    const input = await screen.findByRole('textbox', { name: /Type Yeraví to confirm/i })

    // Wrong text keeps confirm disabled; correct text enables it.
    fireEvent.change(input, { target: { value: 'nope' } })
    expect(screen.getByRole('button', { name: /Confirm merge/i })).toBeDisabled()
    fireEvent.change(input, { target: { value: 'Yeraví' } })
    const confirm = screen.getByRole('button', { name: /Confirm merge/i })
    expect(confirm).not.toBeDisabled()
    fireEvent.click(confirm)
    await waitFor(() => expect(mockAccept).toHaveBeenCalledWith('m1'))
  })

  it('offers an Undo action after a merge that unmerges via the journal id', async () => {
    mockGetSuggestions
      .mockResolvedValueOnce({ success: true, data: [mergeSuggestion] })
      .mockResolvedValue({ success: true, data: [] })
    mockAccept.mockResolvedValue({ success: true, data: { id: 'm1', status: 'accepted', mergeJournalId: 'j1' } })

    renderSection()
    const acceptBtn = await screen.findByRole('button', { name: /Merge .* into/i })
    fireEvent.click(acceptBtn)
    await waitFor(() => expect(mockAccept).toHaveBeenCalledWith('m1'))

    const undoBtn = await screen.findByRole('button', { name: /Undo/i })
    fireEvent.click(undoBtn)
    await waitFor(() => expect(mockContactUnmerge).toHaveBeenCalledWith('j1'))
  })
})

describe('TodayIdentitySuggestions', () => {
  it('shows the queue count and navigates to People on "Review all"', async () => {
    render(
      <MemoryRouter>
        <TodayIdentitySuggestions />
      </MemoryRouter>
    )
    expect(await screen.findByText('Identity suggestions')).toBeInTheDocument()
    expect(screen.getByText('(1)')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Review all/ }))
    expect(mockNavigate).toHaveBeenCalledWith('/people')
  })

  it('renders nothing when the queue is empty', async () => {
    mockGetSuggestions.mockResolvedValue({ success: true, data: [] })
    const { container } = render(
      <MemoryRouter>
        <TodayIdentitySuggestions />
      </MemoryRouter>
    )
    await waitFor(() => expect(mockGetSuggestions).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})
