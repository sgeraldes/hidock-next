import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
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

const projectSuggestion = {
  id: 'p1',
  kind: 'project' as const,
  candidate_name: 'HeyGen Localization',
  target_id: 'proj-1',
  confidence: 0.61,
  evidence: JSON.stringify({ method: 'fuzzy', keeperName: 'HeyGen', coOccurring: [], rarity: 'rare' }),
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
const mockGetPersonContext = vi.fn()
const mockGetMergeJournal = vi.fn()
const mockSupersedeOrphaned = vi.fn()
const mockContactsGetAll = vi.fn()
const mockContactsMerge = vi.fn()
const mockContactsUpdate = vi.fn()

global.window.electronAPI = {
  identity: {
    getSuggestions: mockGetSuggestions,
    acceptSuggestion: mockAccept,
    rejectSuggestion: mockReject,
    supersedeOrphaned: mockSupersedeOrphaned,
    getMentionSnippets: mockGetMentionSnippets,
    getMergeImpact: mockGetMergeImpact,
    getPersonContext: mockGetPersonContext,
    getMergeJournal: mockGetMergeJournal
  },
  contacts: {
    getById: mockContactGetById,
    getAll: mockContactsGetAll,
    merge: mockContactsMerge,
    update: mockContactsUpdate,
    unmerge: mockContactUnmerge
  },
  projects: {
    getById: vi.fn().mockResolvedValue({ success: true, data: { project: { name: 'Proj' } } }),
    unmerge: mockProjectUnmerge
  }
} as any

const renderSection = (kind?: 'person' | 'project') =>
  render(
    <ToastProvider>
      <MemoryRouter>
        <IdentitySuggestionsSection kind={kind} />
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
  mockGetPersonContext.mockResolvedValue({ success: true, data: { people: [], topics: [] } })
  mockGetMergeJournal.mockResolvedValue({ success: true, data: [{ id: 'j-new' }] })
  mockSupersedeOrphaned.mockResolvedValue({ success: true, data: { superseded: 0 } })
  mockContactsGetAll.mockResolvedValue({
    success: true,
    data: { contacts: [{ id: 'c-real', name: 'Sebastian Geraldes', role: 'Engineer', meeting_count: 5 }], total: 1 }
  })
  mockContactsMerge.mockResolvedValue({ success: true, data: { id: 'c-real', name: 'Sebastian Geraldes' } })
  mockContactsUpdate.mockResolvedValue({ success: true, data: { id: 'c1', name: 'Nouman' } })
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

  it('resolves a zero-match transcript lookup to the extracted-from-analysis note (never stuck loading)', async () => {
    renderSection()
    expect((await screen.findAllByText(/extracted from meeting analysis/i)).length).toBeGreaterThan(0)
    // Both the keeper panel and the candidate row settle (keeper resolves a tick later).
    await waitFor(() => expect(screen.queryByText(/checking transcripts/i)).not.toBeInTheDocument())
    expect(screen.queryByText(/no transcript mentions/i)).not.toBeInTheDocument()
  })

  it('shows a distinct error when the transcript lookup fails, not "no mentions"', async () => {
    mockGetMentionSnippets.mockRejectedValue(new Error('boom'))
    renderSection()
    expect((await screen.findAllByText(/Couldn't check transcripts/i)).length).toBeGreaterThan(0)
    expect(screen.queryByText(/extracted from meeting analysis/i)).not.toBeInTheDocument()
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

  it('renders both sides’ graph-neighborhood context with shared entries', async () => {
    mockContactGetById.mockResolvedValue({ success: true, data: { contact: { name: 'Yaraví' } } })
    mockGetSuggestions.mockResolvedValue({ success: true, data: [mergeSuggestion] })
    // Keeper (c1) and candidate (l1) both co-attend with Bob → Bob is shared context.
    mockGetPersonContext.mockImplementation((key: string) =>
      key === 'c1' || key === 'l1'
        ? Promise.resolve({ success: true, data: { people: ['Bob'], topics: ['Atlas'] } })
        : Promise.resolve({ success: true, data: { people: [], topics: [] } })
    )

    renderSection()
    // Bob appears on both sides (shared) — at least two chips.
    await waitFor(() => expect(screen.getAllByText('Bob').length).toBeGreaterThanOrEqual(2))
    expect(screen.getAllByText('Atlas').length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByText(/Different circles/i)).not.toBeInTheDocument()
  })

  it('warns "different circles" when the two sides share no context', async () => {
    mockContactGetById.mockResolvedValue({ success: true, data: { contact: { name: 'Yaraví' } } })
    mockGetSuggestions.mockResolvedValue({ success: true, data: [mergeSuggestion] })
    mockGetPersonContext.mockImplementation((key: string) =>
      key === 'c1'
        ? Promise.resolve({ success: true, data: { people: ['Alice'], topics: [] } })
        : Promise.resolve({ success: true, data: { people: ['Zoe'], topics: [] } })
    )

    renderSection()
    expect(await screen.findByText(/Different circles/i)).toBeInTheDocument()
  })

  it('frames a common name with a "verify carefully" caution', async () => {
    const commonSuggestion = {
      ...suggestion,
      id: 'sc',
      evidence: JSON.stringify({ method: 'fuzzy', rarity: 'common' })
    }
    mockGetSuggestions.mockResolvedValue({ success: true, data: [commonSuggestion] })
    renderSection()
    expect(await screen.findByText(/Common name/i)).toBeInTheDocument()
  })

  it('third door routes the merge to the chosen keeper, not the suggested one', async () => {
    mockContactGetById.mockResolvedValue({ success: true, data: { contact: { name: 'Yaraví' } } })
    mockGetSuggestions
      .mockResolvedValueOnce({ success: true, data: [mergeSuggestion] })
      .mockResolvedValue({ success: true, data: [] })

    renderSection()
    // Open the overflow menu (keyboard opens Radix reliably in jsdom).
    const moreBtn = await screen.findByRole('button', { name: /More options for 'Yeraví'/i })
    fireEvent.keyDown(moreBtn, { key: 'Enter' })

    fireEvent.click(await screen.findByText(/Merge into someone else/i))

    // Pick a DIFFERENT person (c-real) than the suggested keeper (c1).
    const row = await screen.findByRole('button', { name: /Sebastian Geraldes/i })
    fireEvent.click(row)

    // The reviewed duplicate (loserId 'l1') folds into the chosen keeper 'c-real'.
    await waitFor(() =>
      expect(mockContactsMerge).toHaveBeenCalledWith({ keeperId: 'c-real', loserId: 'l1' })
    )
  })

  it('consolidates a shared-target group into ONE keeper panel above the candidate rows', async () => {
    const second = { ...suggestion, id: 's2', candidate_name: 'Sebi', confidence: 0.66 }
    mockGetSuggestions.mockResolvedValue({ success: true, data: [suggestion, second] })
    renderSection()
    // Two candidates, but the keeper ("Keeps" panel) is rendered exactly once.
    expect(await screen.findByText(/2 names may be/)).toBeInTheDocument()
    await waitFor(() => expect(screen.getAllByText('Keeps', { exact: true })).toHaveLength(1))
    // Each candidate still has its own decision.
    expect(screen.getAllByRole('button', { name: /Merge .* into/i })).toHaveLength(2)
  })

  it('direction swap inverts the merge ids (keeps the candidate instead)', async () => {
    mockContactGetById.mockResolvedValue({ success: true, data: { contact: { name: 'Yaraví' } } })
    mockGetSuggestions.mockResolvedValue({ success: true, data: [mergeSuggestion] })
    renderSection()

    // Flip the direction: "Keep 'Yeraví' instead".
    const swap = await screen.findByRole('button', { name: /Keep 'Yeraví' instead/i })
    fireEvent.click(swap)

    // Confirming now merges the target (c1) INTO the candidate (l1), not the reverse.
    fireEvent.click(await screen.findByRole('button', { name: /Keep 'Yeraví' and merge Yaraví in/i }))
    await waitFor(() => expect(mockContactsMerge).toHaveBeenCalledWith({ keeperId: 'l1', loserId: 'c1' }))
  })

  it('group-canonical action merges every candidate, applies a typed name, and offers ONE undo', async () => {
    mockContactGetById.mockResolvedValue({ success: true, data: { contact: { name: 'Nauman' } } })
    const disc1 = {
      id: 'd1',
      kind: 'person' as const,
      candidate_name: 'Nauman',
      target_id: 'c1',
      confidence: 0.75,
      evidence: JSON.stringify({ keeperId: 'c1', loserId: 'la', keeperName: 'Nauman' }),
      status: 'pending' as const,
      created_at: '2026-07-08T10:00:00Z'
    }
    const disc2 = { ...disc1, id: 'd2', candidate_name: 'Numan', evidence: JSON.stringify({ keeperId: 'c1', loserId: 'lb' }) }
    mockGetSuggestions
      .mockResolvedValueOnce({ success: true, data: [disc1, disc2] })
      .mockResolvedValue({ success: true, data: [] })

    renderSection()

    // Open the canonical chooser and type the correct spelling.
    fireEvent.click(await screen.findByRole('button', { name: /All the same person/i }))
    fireEvent.click(await screen.findByText(/correct name is different/i))
    fireEvent.change(await screen.findByLabelText(/Correct canonical name/i), { target: { value: 'Nouman' } })
    fireEvent.click(screen.getByRole('button', { name: /Merge all into the chosen name/i }))

    // Every candidate is accepted (folded into the keeper) and the keeper is renamed.
    await waitFor(() => expect(mockAccept).toHaveBeenCalledWith('d1'))
    await waitFor(() => expect(mockAccept).toHaveBeenCalledWith('d2'))
    await waitFor(() => expect(mockContactsUpdate).toHaveBeenCalledWith({ id: 'c1', name: 'Nouman' }))

    // One undo covering the batch — here it restores the prior canonical name.
    const undo = await screen.findByRole('button', { name: /Undo/i })
    fireEvent.click(undo)
    await waitFor(() => expect(mockContactsUpdate).toHaveBeenCalledWith({ id: 'c1', name: 'Nauman' }))
  })

  it('resolves the candidate mention state even when profiles change mid-lookup (regression)', async () => {
    // Force the race: transcript lookups stay pending until we release them, while the
    // keeper profile resolves immediately and re-runs the mention effect. The first
    // (superseded) batch must still commit — otherwise the candidate stays stuck.
    const releases: Array<(v: unknown) => void> = []
    mockGetMentionSnippets.mockImplementation(() => new Promise((res) => releases.push(res)))
    renderSection()

    // Wait until BOTH the candidate lookup and the (post-profile) keeper lookup are queued.
    await waitFor(() => expect(releases.length).toBeGreaterThanOrEqual(2))
    await act(async () => {
      releases.forEach((r) => r({ success: true, data: { snippets: [], recordingIds: [] } }))
    })

    // The candidate/duplicate panel resolves — never stuck on "checking transcripts…".
    expect((await screen.findAllByText(/extracted from meeting analysis/i)).length).toBeGreaterThan(0)
    expect(screen.queryByText(/checking transcripts/i)).not.toBeInTheDocument()
  })
})

// F1: on the Projects page every KEEPS/ALIAS card showed an amber "Couldn't check
// transcripts" warning. Root cause: the hook fanned out one transcript-evidence lookup
// per pending suggestion (of EVERY kind) in a single Promise.all against the main
// process's serial sql.js queue; low-confidence project suggestions, sorted to the tail,
// always blew their per-call timeout and were cached as errors. The fix scopes the fetch
// to the rendered kind and bounds its concurrency so a lookup's timer reflects real
// service time, not queue backlog.
describe('IdentitySuggestionsSection — project transcript evidence (F1)', () => {
  it('shows the neutral no-verbatim note for a project with no transcript matches, never the error', async () => {
    mockGetSuggestions.mockResolvedValue({ success: true, data: [projectSuggestion] })
    mockGetMentionSnippets.mockResolvedValue({ success: true, data: { snippets: [], recordingIds: [] } })

    renderSection('project')

    expect((await screen.findAllByText(/extracted from meeting analysis/i)).length).toBeGreaterThan(0)
    await waitFor(() => expect(screen.queryByText(/checking transcripts/i)).not.toBeInTheDocument())
    expect(screen.queryByText(/Couldn't check transcripts/i)).not.toBeInTheDocument()
  })

  it('shows real transcript evidence for a project that IS mentioned in recordings', async () => {
    mockGetSuggestions.mockResolvedValue({ success: true, data: [projectSuggestion] })
    mockGetMentionSnippets.mockImplementation((name: string) =>
      /HeyGen/i.test(name)
        ? Promise.resolve({ success: true, data: { snippets: [], recordingIds: ['rec1', 'rec2'] } })
        : Promise.resolve({ success: true, data: { snippets: [], recordingIds: [] } })
    )

    renderSection('project')

    expect(await screen.findByText(/appears in 2 recordings/)).toBeInTheDocument()
    expect(screen.queryByText(/Couldn't check transcripts/i)).not.toBeInTheDocument()
  })

  it('scopes the transcript fan-out to the rendered kind — never fetches off-screen person names', async () => {
    // A person suggestion (high confidence, would sort first) alongside a project one.
    // On the Projects page only the project card is rendered, so its evidence must NOT be
    // queued behind the person lookups (the starvation that produced the blanket error).
    mockGetSuggestions.mockResolvedValue({ success: true, data: [suggestion, projectSuggestion] })
    mockContactGetById.mockResolvedValue({ success: true, data: { contact: { name: 'Sebastián' } } })
    mockGetMentionSnippets.mockResolvedValue({ success: true, data: { snippets: [], recordingIds: [] } })

    renderSection('project')

    expect((await screen.findAllByText(/extracted from meeting analysis/i)).length).toBeGreaterThan(0)
    // Give any (incorrectly) scheduled person lookups a chance to fire.
    await waitFor(() => expect(mockGetMentionSnippets).toHaveBeenCalled())
    const namesFetched = mockGetMentionSnippets.mock.calls.map((c) => String(c[0]))
    expect(namesFetched).not.toContain('Sebas')
    expect(namesFetched).not.toContain('Sebastián')
    expect(namesFetched.some((n) => /HeyGen/i.test(n))).toBe(true)
  })

  it('bounds the transcript fan-out concurrency so tail lookups never starve past their timeout', async () => {
    // 10 project suggestions → at most 6 (MENTION_FETCH_CONCURRENCY) lookups may be
    // in flight at once. The keeper name matches the resolved profile name so no extra
    // lookup is introduced when the profile streams in.
    const many = Array.from({ length: 10 }, (_, i) => ({
      ...projectSuggestion,
      id: `pm${i}`,
      target_id: `proj-${i}`,
      candidate_name: `Proj Alias ${i}`,
      evidence: JSON.stringify({ method: 'fuzzy', keeperName: 'Proj', coOccurring: [], rarity: 'rare' })
    }))
    mockGetSuggestions.mockResolvedValue({ success: true, data: many })
    ;(global.window.electronAPI as any).projects.getById = vi
      .fn()
      .mockResolvedValue({ success: true, data: { project: { name: 'Proj' } } })

    const releases: Array<(v: unknown) => void> = []
    mockGetMentionSnippets.mockImplementation(() => new Promise((res) => releases.push(res)))

    renderSection('project')

    // The batch caps in-flight lookups at 6; the 7th only dispatches once one settles.
    await waitFor(() => expect(releases.length).toBe(6))
    await new Promise((r) => setTimeout(r, 30))
    expect(releases.length).toBe(6)

    // Drain the queue: releasing settled lookups lets the next batch dispatch.
    for (let guard = 0; guard < 50 && releases.length > 0; guard++) {
      await act(async () => {
        const batch = releases.splice(0, releases.length)
        batch.forEach((r) => r({ success: true, data: { snippets: [], recordingIds: [] } }))
      })
    }
    await waitFor(() => expect(screen.queryByText(/checking transcripts/i)).not.toBeInTheDocument())
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
