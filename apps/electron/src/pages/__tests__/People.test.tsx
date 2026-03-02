
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

  it('should display interaction counts', async () => {
    render(
      <MemoryRouter>
        <People />
      </MemoryRouter>
    )

    await screen.findByText('Mario')

    expect(screen.getByText('5 interactions')).toBeInTheDocument()
    expect(screen.getByText('12 interactions')).toBeInTheDocument()
    expect(screen.getByText('1 interactions')).toBeInTheDocument()
  })
})
