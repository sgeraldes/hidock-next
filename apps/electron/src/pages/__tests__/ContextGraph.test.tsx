import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ContextGraph } from '../ContextGraph'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => mockNavigate }
})

vi.mock('@/components/ui/toaster', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'light', resolvedTheme: 'light', setTheme: vi.fn(), toggleTheme: vi.fn() }),
}))

// The force-graph canvas is heavy + touches real <canvas>. Replace it with a
// lightweight stand-in that renders a clickable button per node.
vi.mock('@/components/context-graph/ContextGraphCanvas', () => ({
  default: ({ data, onNodeClick }: any) => (
    <div data-testid="canvas-mock">
      {data.nodes.map((n: any) => (
        <button key={n.id} onClick={() => onNodeClick?.(n)}>
          node-{n.label}
        </button>
      ))}
    </div>
  ),
}))

const marioNode = { id: 'person:contact_c-mario', type: 'person', label: 'Mario', degree: 3, contactId: 'c-mario' }
const meetingNode = { id: 'meeting:mtg-1', type: 'meeting', label: 'Kickoff', degree: 2, meetingId: 'mtg-1' }

const overview = {
  center: null,
  nodes: [marioNode, meetingNode],
  edges: [{ id: 'e1', source: marioNode.id, target: meetingNode.id, type: 'ATTENDED', weight: 1 }],
}
const neighborhood = {
  center: marioNode.id,
  nodes: [marioNode, meetingNode],
  edges: [{ id: 'e1', source: marioNode.id, target: meetingNode.id, type: 'ATTENDED', weight: 1 }],
}

function mockAPI(overrides: Record<string, any> = {}) {
  return {
    contextGraph: {
      getGraph: vi.fn().mockResolvedValue({ success: true, data: overview }),
      getNeighborhood: vi.fn().mockResolvedValue({ success: true, data: neighborhood }),
      search: vi.fn().mockResolvedValue({ success: true, data: [marioNode] }),
      rekey: vi.fn().mockResolvedValue({ success: true, data: { rekeyed: 1, merged: 0, skipped: 0 } }),
      ...overrides.contextGraph,
    },
    graph: {
      stats: vi.fn().mockResolvedValue({ success: true, data: { nodes: 2, edges: 1, nodesByType: {} } }),
      ingestAll: vi.fn().mockResolvedValue({ success: true, data: { ingested: 0, skipped: 0, errors: [] } }),
      ...overrides.graph,
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  global.window.electronAPI = mockAPI() as any
  if (typeof window.matchMedia !== 'function') {
    // jsdom lacks matchMedia — the reduced-motion hook needs it.
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }) as any
  }
})

describe('ContextGraph page', () => {
  it('renders the Context Graph title and node/edge stats', async () => {
    render(
      <MemoryRouter>
        <ContextGraph />
      </MemoryRouter>
    )
    expect(await screen.findByRole('heading', { name: /context graph/i })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('2')).toBeInTheDocument()) // node count
  })

  it('clicking a node focuses its neighborhood and opens a detail panel with click-through', async () => {
    render(
      <MemoryRouter>
        <ContextGraph />
      </MemoryRouter>
    )

    const marioBtn = await screen.findByText('node-Mario')
    fireEvent.click(marioBtn)

    // Neighborhood fetched for the clicked node.
    await waitFor(() =>
      expect(window.electronAPI.contextGraph.getNeighborhood).toHaveBeenCalledWith(marioNode.id, 1)
    )

    // Detail panel offers a click-through to the person page.
    const openBtn = await screen.findByRole('button', { name: /open person page/i })
    fireEvent.click(openBtn)
    expect(mockNavigate).toHaveBeenCalledWith('/person/c-mario')
  })

  it('shows the empty state and an ingest CTA when the graph has no nodes', async () => {
    global.window.electronAPI = mockAPI({
      contextGraph: { getGraph: vi.fn().mockResolvedValue({ success: true, data: { center: null, nodes: [], edges: [] } }) },
    }) as any

    render(
      <MemoryRouter>
        <ContextGraph />
      </MemoryRouter>
    )
    expect(await screen.findByText(/no context yet/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /ingest transcripts/i })).toBeInTheDocument()
  })

  it('search suggestions focus the picked entity', async () => {
    render(
      <MemoryRouter>
        <ContextGraph />
      </MemoryRouter>
    )
    const input = await screen.findByLabelText(/search the context graph/i)
    fireEvent.change(input, { target: { value: 'Mar' } })
    await waitFor(() => expect(window.electronAPI.contextGraph.search).toHaveBeenCalled())
    const suggestion = await screen.findByText('Mario')
    fireEvent.click(suggestion)
    await waitFor(() =>
      expect(window.electronAPI.contextGraph.getNeighborhood).toHaveBeenCalledWith(marioNode.id, 1)
    )
  })
})
