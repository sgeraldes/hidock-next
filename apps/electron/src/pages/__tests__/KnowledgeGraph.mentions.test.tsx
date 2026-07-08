import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { KnowledgeGraph } from '../KnowledgeGraph'
import { resetContactResolverCache } from '@/components/entity'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => mockNavigate }
})

vi.mock('@/components/ui/toaster', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() }
}))

beforeEach(() => {
  vi.clearAllMocks()
  resetContactResolverCache()
  global.window.electronAPI = {
    graph: {
      stats: vi.fn().mockResolvedValue({ success: true, data: { nodes: 1, edges: 0, nodesByType: {} } }),
      topAttendees: vi
        .fn()
        .mockResolvedValue({ success: true, data: [{ person: 'Mario', personId: 'person:mario', meetings: 3 }] }),
      topSkill: vi.fn().mockResolvedValue({ success: true, data: [] }),
      personProfile: vi.fn().mockResolvedValue({ success: true, data: null }),
      ingestAll: vi.fn()
    },
    contacts: {
      getAll: vi.fn().mockResolvedValue({
        success: true,
        data: { contacts: [{ id: 'c-mario', name: 'Mario', email: null, type: 'team' }], total: 1 }
      }),
      getById: vi.fn().mockResolvedValue({ success: false })
    }
  } as any
})

describe('KnowledgeGraph entity mentions', () => {
  it('renders a top-attendee as a person mention that navigates to the resolved contact', async () => {
    render(
      <MemoryRouter>
        <KnowledgeGraph />
      </MemoryRouter>
    )

    // Query top attendees for a topic (Enter triggers the search).
    const input = await screen.findByPlaceholderText(/Amazon Connect/i)
    fireEvent.change(input, { target: { value: 'Amazon Connect' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    // The name resolves (by contact name) to a navigable person mention.
    const mention = await screen.findByRole('button', { name: /open person mario/i })
    fireEvent.click(mention)
    expect(mockNavigate).toHaveBeenCalledWith('/person/c-mario')
  })
})
