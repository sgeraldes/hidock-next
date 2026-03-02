
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import { People } from '../People'
import { MemoryRouter } from 'react-router-dom'

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

// Mock Electron API
global.window.electronAPI = {
  contacts: {
    getAll: mockGetAll,
    delete: vi.fn().mockResolvedValue({ success: true })
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

    // Should show "Showing 1-3 of 3 people"
    expect(screen.getByText(/Showing 1/)).toBeInTheDocument()
    expect(screen.getByText(/of 3 people/)).toBeInTheDocument()
  })

  // C-006: Pagination - page size used is 30
  it('should pass pagination offset to API', async () => {
    render(
      <MemoryRouter>
        <People />
      </MemoryRouter>
    )

    await screen.findByText('Mario')

    // First call should use offset 0 with limit 30
    expect(mockGetAll).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 30,
        offset: 0
      })
    )
  })

  // C-006: Pagination controls render when needed
  it('should show pagination controls when total exceeds page size', async () => {
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
        total: 60 // Two pages of 30
      }
    })

    render(
      <MemoryRouter>
        <People />
      </MemoryRouter>
    )

    await screen.findByText('Test Person')

    // Pagination controls should be visible
    expect(screen.getByLabelText('Previous page')).toBeInTheDocument()
    expect(screen.getByLabelText('Next page')).toBeInTheDocument()
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument()
  })

  // C-006: No pagination controls when not needed
  it('should not show pagination controls when total fits one page', async () => {
    render(
      <MemoryRouter>
        <People />
      </MemoryRouter>
    )

    await screen.findByText('Mario')

    // No pagination buttons since total (3) fits in one page (30)
    expect(screen.queryByLabelText('Previous page')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Next page')).not.toBeInTheDocument()
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
})
