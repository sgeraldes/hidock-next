import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { IdentitySuggestionsSection } from '../IdentitySuggestionsSection'
import { TodayIdentitySuggestions } from '../TodayIdentitySuggestions'

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

const mockGetSuggestions = vi.fn()
const mockAccept = vi.fn()
const mockReject = vi.fn()
const mockContactGetById = vi.fn()

global.window.electronAPI = {
  identity: {
    getSuggestions: mockGetSuggestions,
    acceptSuggestion: mockAccept,
    rejectSuggestion: mockReject
  },
  contacts: {
    getById: mockContactGetById
  },
  projects: {
    getById: vi.fn().mockResolvedValue({ success: true, data: { project: { name: 'Proj' } } })
  }
} as any

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSuggestions.mockResolvedValue({ success: true, data: [suggestion] })
  mockAccept.mockResolvedValue({ success: true })
  mockReject.mockResolvedValue({ success: true })
  mockContactGetById.mockResolvedValue({ success: true, data: { contact: { name: 'Sebastián' } } })
})

describe('IdentitySuggestionsSection', () => {
  it('renders a suggestion card asking if candidate is the same as the resolved target', async () => {
    render(<IdentitySuggestionsSection />)
    // Section header shows the count
    expect(await screen.findByText(/Identity suggestions \(1\)/)).toBeInTheDocument()
    // Target name resolves lazily
    await screen.findByText('Sebastián')
    // Candidate name shows (distinct from the "Sebastián" target)
    expect(screen.getByText(/Sebas(?!tián)/)).toBeInTheDocument()
    // Confidence tier badge
    expect(screen.getByText('72%')).toBeInTheDocument()
  })

  it('renders nothing when there are no pending suggestions', async () => {
    mockGetSuggestions.mockResolvedValue({ success: true, data: [] })
    const { container } = render(<IdentitySuggestionsSection />)
    await waitFor(() => expect(mockGetSuggestions).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('accepting a suggestion calls acceptSuggestion and removes the card optimistically', async () => {
    render(<IdentitySuggestionsSection />)
    const acceptBtn = await screen.findByRole('button', { name: /Yes, merge/ })
    fireEvent.click(acceptBtn)
    await waitFor(() => expect(mockAccept).toHaveBeenCalledWith('s1'))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Yes, merge/ })).not.toBeInTheDocument()
    )
  })

  it('rejecting a suggestion calls rejectSuggestion and removes the card optimistically', async () => {
    render(<IdentitySuggestionsSection />)
    const rejectBtn = await screen.findByRole('button', { name: /^No$/ })
    fireEvent.click(rejectBtn)
    await waitFor(() => expect(mockReject).toHaveBeenCalledWith('s1'))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /^No$/ })).not.toBeInTheDocument()
    )
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
