
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react'
import { People } from '../People'
import { MemoryRouter } from 'react-router-dom'
import { toast } from '@/components/ui/toaster'

// Mock toast to avoid store side effects and to assert on discovery results.
vi.mock('@/components/ui/toaster', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() }
}))

const mockGetAll = vi.fn().mockResolvedValue({
  success: true,
  data: {
    contacts: [
      {
        id: 'p1',
        name: 'Mario',
        type: 'team',
        interactionCount: 5,
        lastSeenAt: '2026-02-20T10:00:00Z',
        firstSeenAt: '2026-01-01T00:00:00Z',
        tags: ['dev'],
        email: 'mario@example.com',
        role: 'Engineer',
        company: 'Nintendo'
      },
      {
        id: 'p2',
        name: 'Alice',
        type: 'customer',
        interactionCount: 12,
        lastSeenAt: '2026-03-01T10:00:00Z',
        firstSeenAt: '2026-01-15T00:00:00Z',
        tags: [],
        email: 'alice@example.com',
        role: 'PM',
        company: 'Acme'
      },
      {
        id: 'p3',
        name: 'Zara',
        type: 'external',
        interactionCount: 1,
        lastSeenAt: '2026-01-10T10:00:00Z',
        firstSeenAt: '2026-01-10T00:00:00Z',
        tags: [],
        email: null,
        role: null,
        company: null
      }
    ],
    total: 3
  }
})

const mockMerge = vi.fn().mockResolvedValue({ success: true, data: { id: 'p2', name: 'Alice' } })

// Mock Electron API
global.window.electronAPI = {
  contacts: {
    getAll: mockGetAll,
    create: vi.fn().mockResolvedValue({ success: true, data: { id: 'new-1', name: 'New Person' } }),
    delete: vi.fn().mockResolvedValue({ success: true }),
    merge: mockMerge,
    getById: vi.fn().mockResolvedValue({ success: true, data: { contact: { name: 'Target' }, meetings: [] } })
  },
  projects: {
    getById: vi.fn().mockResolvedValue({ success: true, data: { project: { name: 'Target' } } })
  },
  // Identity suggestions section loads on mount; default to an empty queue.
  identity: {
    getSuggestions: vi.fn().mockResolvedValue({ success: true, data: [] }),
    acceptSuggestion: vi.fn().mockResolvedValue({ success: true }),
    rejectSuggestion: vi.fn().mockResolvedValue({ success: true }),
    discoverContacts: vi.fn().mockResolvedValue({
      success: true,
      data: { candidatePairs: 12, suggestionsCreated: 3, autoMergeable: 1 }
    }),
    // v30: low link counts by default → no high-stakes type-to-confirm gate.
    getMergeImpact: vi.fn().mockResolvedValue({ success: true, data: { keeper: 1, loser: 1 } }),
    getMergeJournal: vi.fn().mockResolvedValue({ success: true, data: [] })
  }
} as any

beforeEach(() => {
  vi.clearAllMocks()
})

describe('People Page', () => {
  it('should render list of people', async () => {
    render(
      <MemoryRouter>
        <People />
      </MemoryRouter>
    )

    const item = await screen.findByText('Mario')
    expect(item).toBeInTheDocument()
    expect(screen.getByText('team')).toBeInTheDocument()
  })

  it('should render sort dropdown with options', async () => {
    render(
      <MemoryRouter>
        <People />
      </MemoryRouter>
    )

    await screen.findByText('Mario')

    const sortSelect = screen.getByLabelText('Sort contacts')
    expect(sortSelect).toBeInTheDocument()

    // Should have three sort options
    const options = within(sortSelect as HTMLElement).getAllByRole('option')
    expect(options).toHaveLength(3)
    expect(options[0]).toHaveTextContent('Name')
    expect(options[1]).toHaveTextContent('Last Seen')
    expect(options[2]).toHaveTextContent('Interactions')
  })

  it('should render type filter buttons', async () => {
    render(
      <MemoryRouter>
        <People />
      </MemoryRouter>
    )

    await screen.findByText('Mario')

    expect(screen.getByText('All')).toBeInTheDocument()
    expect(screen.getByText('Team')).toBeInTheDocument()
    expect(screen.getByText('Customer')).toBeInTheDocument()
    expect(screen.getByText('External')).toBeInTheDocument()
    expect(screen.getByText('Candidate')).toBeInTheDocument()
  })

  it('should render contact initials avatar', async () => {
    render(
      <MemoryRouter>
        <People />
      </MemoryRouter>
    )

    await screen.findByText('Mario')

    // Each card should show the first letter as avatar initial
    expect(screen.getByText('M')).toBeInTheDocument() // Mario
    expect(screen.getByText('A')).toBeInTheDocument() // Alice
    expect(screen.getByText('Z')).toBeInTheDocument() // Zara
  })

  it('should render empty state when no people found', async () => {
    mockGetAll.mockResolvedValueOnce({
      success: true,
      data: { contacts: [], total: 0 }
    })

    render(
      <MemoryRouter>
        <People />
      </MemoryRouter>
    )

    const emptyMessage = await screen.findByText('No People Found')
    expect(emptyMessage).toBeInTheDocument()
    expect(screen.getByText(/No contacts yet/)).toBeInTheDocument()
  })

  it('should show type-colored badges for contacts', async () => {
    render(
      <MemoryRouter>
        <People />
      </MemoryRouter>
    )

    await screen.findByText('Mario')

    // Type badges should be rendered
    expect(screen.getByText('team')).toBeInTheDocument()
    expect(screen.getByText('customer')).toBeInTheDocument()
    expect(screen.getByText('external')).toBeInTheDocument()
  })

  // C-006: Interaction count grammar fix - singular vs plural
  it('should display correct interaction count grammar', async () => {
    render(
      <MemoryRouter>
        <People />
      </MemoryRouter>
    )

    await screen.findByText('Mario')

    // "5 interactions" (plural)
    expect(screen.getByText('5 interactions')).toBeInTheDocument()
    // "12 interactions" (plural)
    expect(screen.getByText('12 interactions')).toBeInTheDocument()
    // "1 interaction" (singular - was "1 interactions" before fix)
    expect(screen.getByText('1 interaction')).toBeInTheDocument()
  })

  // C-006: Result count indicator
  it('should display result count indicator', async () => {
    render(
      <MemoryRouter>
        <People />
      </MemoryRouter>
    )

    await screen.findByText('Mario')

    // Should show "Showing 3 of 3 people"
    expect(screen.getByText(/Showing 3/)).toBeInTheDocument()
    expect(screen.getByText(/of 3 people/)).toBeInTheDocument()
  })

  // C-006: Pagination - page size used is 40
  it('should pass pagination offset to API', async () => {
    render(
      <MemoryRouter>
        <People />
      </MemoryRouter>
    )

    await screen.findByText('Mario')

    // First call should use offset 0 with limit 40
    expect(mockGetAll).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 40,
        offset: 0
      })
    )
  })

  // C-006: "Load more" renders when there are additional pages, and fetches the next chunk
  it('should show a Load more control when total exceeds page size, and append the next page on click', async () => {
    mockGetAll.mockResolvedValueOnce({
      success: true,
      data: {
        contacts: [
          {
            id: 'p1',
            name: 'Test Person',
            type: 'team',
            interactionCount: 1,
            lastSeenAt: '2026-01-01T00:00:00Z',
            firstSeenAt: '2026-01-01T00:00:00Z',
            tags: [],
            email: null,
            role: null,
            company: null
          }
        ],
        total: 60 // More than one page of 40
      }
    })
    mockGetAll.mockResolvedValueOnce({
      success: true,
      data: {
        contacts: [
          {
            id: 'p2',
            name: 'Second Page Person',
            type: 'team',
            interactionCount: 1,
            lastSeenAt: '2026-01-01T00:00:00Z',
            firstSeenAt: '2026-01-01T00:00:00Z',
            tags: [],
            email: null,
            role: null,
            company: null
          }
        ],
        total: 60
      }
    })

    render(
      <MemoryRouter>
        <People />
      </MemoryRouter>
    )

    await screen.findByText('Test Person')

    const loadMoreButton = screen.getByRole('button', { name: /load more/i })
    expect(loadMoreButton).toBeInTheDocument()

    fireEvent.click(loadMoreButton)

    await screen.findByText('Second Page Person')

    // Second call should append starting at offset 1 (the count already loaded)
    expect(mockGetAll).toHaveBeenLastCalledWith(
      expect.objectContaining({
        limit: 40,
        offset: 1
      })
    )
  })

  it('should hide stale pagination immediately when the active query changes', async () => {
    mockGetAll.mockResolvedValueOnce({
      success: true,
      data: {
        contacts: [
          {
            id: 'p1',
            name: 'Test Person',
            type: 'team',
            interactionCount: 1,
            lastSeenAt: '2026-01-01T00:00:00Z',
            firstSeenAt: '2026-01-01T00:00:00Z',
            tags: [],
            email: null,
            role: null,
            company: null
          }
        ],
        total: 60
      }
    })

    render(
      <MemoryRouter>
        <People />
      </MemoryRouter>
    )

    await screen.findByText('Test Person')
    expect(screen.getByRole('button', { name: /load more/i })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Sort contacts'), { target: { value: 'interactions' } })

    expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument()
  })

  // C-006: No "Load more" control when not needed
  it('should not show a Load more control when total fits one page', async () => {
    render(
      <MemoryRouter>
        <People />
      </MemoryRouter>
    )

    await screen.findByText('Mario')

    // No "Load more" control since total (3) fits in one page (40)
    expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument()
  })

  // C-006: Safe date formatting for invalid dates
  it('should handle invalid lastSeenAt dates gracefully', async () => {
    mockGetAll.mockResolvedValueOnce({
      success: true,
      data: {
        contacts: [
          {
            id: 'p-bad-date',
            name: 'Bad Date Person',
            type: 'unknown',
            interactionCount: 0,
            lastSeenAt: 'not-a-date',
            firstSeenAt: '2026-01-01T00:00:00Z',
            tags: [],
            email: null,
            role: null,
            company: null
          }
        ],
        total: 1
      }
    })

    render(
      <MemoryRouter>
        <People />
      </MemoryRouter>
    )

    await screen.findByText('Bad Date Person')

    // Should show "Unknown" instead of "Invalid Date"
    expect(screen.getByText('Unknown')).toBeInTheDocument()
    expect(screen.queryByText('Invalid Date')).not.toBeInTheDocument()
  })

  // R4b: Quick merge — select two, keeper defaults to the higher-interaction contact
  it('merge flow: selecting two people confirms merge with the right keeper and loser', async () => {
    render(
      <MemoryRouter>
        <People />
      </MemoryRouter>
    )
    await screen.findByText('Mario')

    // Enter merge mode
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }))

    // Pick Mario (5 interactions) then Alice (12 interactions)
    fireEvent.click(screen.getByText('Mario'))
    fireEvent.click(screen.getByText('Alice'))

    // Keeper defaults to Alice (more interactions); confirm merges Mario into Alice
    const confirm = await screen.findByRole('button', { name: /Confirm merge/ })
    fireEvent.click(confirm)

    await waitFor(() =>
      expect(mockMerge).toHaveBeenCalledWith({ keeperId: 'p2', loserId: 'p1' })
    )
  })

  // R4b: swap direction flips keeper/loser
  it('merge flow: swap direction flips which contact is kept', async () => {
    render(
      <MemoryRouter>
        <People />
      </MemoryRouter>
    )
    await screen.findByText('Mario')

    fireEvent.click(screen.getByRole('button', { name: 'Merge' }))
    fireEvent.click(screen.getByText('Mario'))
    fireEvent.click(screen.getByText('Alice'))

    // Default keeper Alice → swap makes Mario the keeper
    const swap = await screen.findByRole('button', { name: 'Swap merge direction' })
    fireEvent.click(swap)

    fireEvent.click(screen.getByRole('button', { name: /Confirm merge/ }))

    await waitFor(() =>
      expect(mockMerge).toHaveBeenCalledWith({ keeperId: 'p1', loserId: 'p2' })
    )
  })

  // R4b: selecting a third person is capped at two
  it('merge flow: selection is capped at two people', async () => {
    render(
      <MemoryRouter>
        <People />
      </MemoryRouter>
    )
    await screen.findByText('Mario')

    fireEvent.click(screen.getByRole('button', { name: 'Merge' }))
    fireEvent.click(screen.getByText('Mario'))
    fireEvent.click(screen.getByText('Alice'))
    // Third click should be ignored — Zara is not added
    fireEvent.click(screen.getByText('Zara'))

    // The floating bar still references only the first two selections
    const confirm = await screen.findByRole('button', { name: /Confirm merge/ })
    fireEvent.click(confirm)

    await waitFor(() =>
      expect(mockMerge).toHaveBeenCalledWith({ keeperId: 'p2', loserId: 'p1' })
    )
  })

  // R4b: merge mode toggles off card navigation
  it('does not navigate to a person when clicking a card in merge mode', async () => {
    render(
      <MemoryRouter>
        <People />
      </MemoryRouter>
    )
    await screen.findByText('Mario')

    fireEvent.click(screen.getByRole('button', { name: 'Merge' }))
    fireEvent.click(screen.getByText('Mario'))

    // Instruction banner is shown and the card is selected (not navigated away)
    expect(screen.getByText(/Merge mode:/)).toBeInTheDocument()
    expect(screen.getByText('Mario')).toBeInTheDocument()
  })

  // Add Person — the header button now opens a real dialog (was a stub toast)
  it('opens the Add Person dialog from the header button', async () => {
    render(
      <MemoryRouter>
        <People />
      </MemoryRouter>
    )
    await screen.findByText('Mario')

    fireEvent.click(screen.getByRole('button', { name: /Add Person/ }))

    // Dialog opens: its description and required name field appear.
    expect(await screen.findByText(/Create a contact by hand/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Name/)).toBeInTheDocument()
  })

  // Discovery sweep — button calls the IPC, shows a result toast, and refetches suggestions
  it('discover: clicking Discover calls identity.discoverContacts and toasts the result', async () => {
    render(
      <MemoryRouter>
        <People />
      </MemoryRouter>
    )
    await screen.findByText('Mario')

    const discoverBtn = screen.getByRole('button', { name: /Discover/ })
    fireEvent.click(discoverBtn)

    await waitFor(() =>
      expect((global.window.electronAPI as any).identity.discoverContacts).toHaveBeenCalled()
    )
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        'Discovery complete',
        expect.stringContaining('12 candidate pairs analyzed, 3 new suggestions, 1 high-confidence')
      )
    )
  })

  it('discover: refetches the identity suggestions queue after a run', async () => {
    render(
      <MemoryRouter>
        <People />
      </MemoryRouter>
    )
    await screen.findByText('Mario')

    const getSuggestions = (global.window.electronAPI as any).identity.getSuggestions
    // Called once on mount by the suggestions section.
    await waitFor(() => expect(getSuggestions).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: /Discover/ }))

    // reload() from the section handle triggers a second fetch.
    await waitFor(() => expect(getSuggestions.mock.calls.length).toBeGreaterThanOrEqual(2))
  })

  it('discover: surfaces an error toast and re-enables the button on failure', async () => {
    ;(global.window.electronAPI as any).identity.discoverContacts.mockResolvedValueOnce({
      success: false,
      error: 'boom'
    })
    render(
      <MemoryRouter>
        <People />
      </MemoryRouter>
    )
    await screen.findByText('Mario')

    fireEvent.click(screen.getByRole('button', { name: /Discover/ }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Discovery failed', 'boom'))
    // Button returns to its idle label (not stuck on "Discovering…")
    await waitFor(() => expect(screen.getByRole('button', { name: /^Discover$/ })).toBeEnabled())
  })
})
