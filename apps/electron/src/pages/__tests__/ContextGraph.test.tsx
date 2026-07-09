import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
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

// The force-graph canvases are heavy + touch real <canvas>. Replace them with
// lightweight stand-ins that render a clickable button per node (and expose a
// double-click for the lens canvas).
vi.mock('@/components/context-graph/StratifiedLensCanvas', () => ({
  default: ({ data, onNodeClick, onNodeDoubleClick }: any) => (
    <div data-testid="lens-canvas-mock">
      {data.nodes.map((n: any) => (
        <button
          key={n.id}
          onClick={() => onNodeClick?.(n)}
          onDoubleClick={() => onNodeDoubleClick?.(n)}
        >
          node-{n.label}
        </button>
      ))}
    </div>
  ),
}))

vi.mock('@/components/context-graph/ContextGraphCanvas', () => ({
  default: ({ data, onNodeClick }: any) => (
    <div data-testid="atlas-canvas-mock">
      {data.nodes.map((n: any) => (
        <button key={n.id} onClick={() => onNodeClick?.(n)}>
          atlas-{n.label}
        </button>
      ))}
    </div>
  ),
}))

const DATE = Date.parse('2026-06-01')
const marioNode = { id: 'person:contact_c-mario', type: 'person', label: 'Mario', degree: 3, contactId: 'c-mario' }
const meetingNode = { id: 'meeting:mtg-1', type: 'meeting', label: 'Kickoff', degree: 2, meetingId: 'mtg-1' }
const aliceNode = { id: 'person:alice', type: 'person', label: 'Alice', degree: 1 }

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
const lens = {
  center: marioNode.id,
  referenceMs: DATE,
  nodes: [
    { ...marioNode, stratum: 'people', dateMs: DATE },
    { ...meetingNode, stratum: 'evidence', dateMs: DATE },
  ],
  edges: [{ id: 'e1', source: marioNode.id, target: meetingNode.id, type: 'ATTENDED', weight: 1 }],
  strata: [
    { stratum: 'strategic', total: 0, shown: 0 },
    { stratum: 'operational', total: 0, shown: 0 },
    { stratum: 'people', total: 1, shown: 1 },
    { stratum: 'evidence', total: 1, shown: 1 },
  ],
}
const marioProvenance = {
  node: { id: marioNode.id, type: 'person', label: 'Mario', contactId: 'c-mario', dateMs: DATE },
  meetings: [{ id: meetingNode.id, type: 'meeting', label: 'Kickoff', meetingId: 'mtg-1', dateMs: DATE }],
  people: [],
  projects: [],
  actions: [],
  pathIds: [marioNode.id, meetingNode.id],
  narrative: 'Mario · Jun 1, 2026 · 1 meeting',
  dateMs: DATE,
}

function mockAPI(overrides: Record<string, any> = {}) {
  return {
    contextGraph: {
      getGraph: vi.fn().mockResolvedValue({ success: true, data: overview }),
      getNeighborhood: vi.fn().mockResolvedValue({ success: true, data: neighborhood }),
      search: vi.fn().mockResolvedValue({ success: true, data: [aliceNode] }),
      rekey: vi.fn().mockResolvedValue({ success: true, data: { rekeyed: 1, merged: 0, skipped: 0 } }),
      prune: vi.fn().mockResolvedValue({ success: true, data: { removedNodes: 0, removedEdges: 0 } }),
      getLens: vi.fn().mockResolvedValue({ success: true, data: lens }),
      defaultCenter: vi
        .fn()
        .mockResolvedValue({ success: true, data: { id: marioNode.id, type: 'person', label: 'Mario', contactId: 'c-mario' } }),
      provenance: vi.fn().mockResolvedValue({ success: true, data: marioProvenance }),
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
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }) as any
  }
})

describe('ContextGraph page — lens first', () => {
  it('renders the title and node/edge stats and loads a lens by default', async () => {
    render(
      <MemoryRouter>
        <ContextGraph />
      </MemoryRouter>
    )
    expect(await screen.findByRole('heading', { name: /context graph/i })).toBeInTheDocument()
    await waitFor(() => {
      const nodesStat = screen.getByText('nodes').closest('span') as HTMLElement
      expect(within(nodesStat).getByText('2')).toBeInTheDocument()
    })
    // Opens in the LENS, centered on the default owner (Mario), scoped to 30d.
    await waitFor(() =>
      expect(window.electronAPI.contextGraph.defaultCenter).toHaveBeenCalled()
    )
    await waitFor(() =>
      expect(window.electronAPI.contextGraph.getLens).toHaveBeenCalledWith(marioNode.id, 2, 30, undefined)
    )
  })

  it('clicking a node opens a provenance panel with narrative + click-through', async () => {
    render(
      <MemoryRouter>
        <ContextGraph />
      </MemoryRouter>
    )
    const marioBtn = await screen.findByText('node-Mario')
    fireEvent.click(marioBtn)

    // Provenance derived for the clicked node.
    await waitFor(() => expect(window.electronAPI.contextGraph.provenance).toHaveBeenCalledWith(marioNode.id))
    // Narrative + click-through appear.
    expect(await screen.findByText(/why this is here/i)).toBeInTheDocument()
    const openBtn = await screen.findByRole('button', { name: /open person page/i })
    fireEvent.click(openBtn)
    expect(mockNavigate).toHaveBeenCalledWith('/person/c-mario')
  })

  it('double-clicking a node recenters the lens on it', async () => {
    render(
      <MemoryRouter>
        <ContextGraph />
      </MemoryRouter>
    )
    const meetingBtn = await screen.findByText('node-Kickoff')
    fireEvent.doubleClick(meetingBtn)
    // Lens reloads centered on the double-clicked node.
    await waitFor(() =>
      expect(window.electronAPI.contextGraph.getLens).toHaveBeenCalledWith(meetingNode.id, 2, 30, undefined)
    )
  })

  it('changing the time window reloads the lens', async () => {
    render(
      <MemoryRouter>
        <ContextGraph />
      </MemoryRouter>
    )
    await screen.findByText('node-Mario')
    const sevenDay = await screen.findByRole('button', { name: '7d' })
    fireEvent.click(sevenDay)
    await waitFor(() =>
      expect(window.electronAPI.contextGraph.getLens).toHaveBeenCalledWith(marioNode.id, 2, 7, undefined)
    )
  })

  it('the Person lens searches and recenters on the picked entity', async () => {
    render(
      <MemoryRouter>
        <ContextGraph />
      </MemoryRouter>
    )
    await screen.findByText('node-Mario')
    fireEvent.click(screen.getByRole('button', { name: /^person$/i }))
    const input = await screen.findByLabelText(/search a person/i)
    fireEvent.change(input, { target: { value: 'Ali' } })
    await waitFor(() => expect(window.electronAPI.contextGraph.search).toHaveBeenCalled())
    const suggestion = await screen.findByText('Alice')
    fireEvent.click(suggestion)
    await waitFor(() =>
      expect(window.electronAPI.contextGraph.getLens).toHaveBeenCalledWith(aliceNode.id, 2, 30, undefined)
    )
  })

  it('the Atlas tab shows the whole graph and focuses a node on click', async () => {
    render(
      <MemoryRouter>
        <ContextGraph />
      </MemoryRouter>
    )
    await screen.findByText('node-Mario')
    fireEvent.click(screen.getByRole('button', { name: /atlas/i }))
    const atlasNode = await screen.findByText('atlas-Mario')
    fireEvent.click(atlasNode)
    await waitFor(() =>
      expect(window.electronAPI.contextGraph.getNeighborhood).toHaveBeenCalledWith(marioNode.id, 1)
    )
  })

  it('shows the empty state and an ingest CTA when the graph has no nodes', async () => {
    global.window.electronAPI = mockAPI({
      contextGraph: {
        getGraph: vi.fn().mockResolvedValue({ success: true, data: { center: null, nodes: [], edges: [] } }),
        defaultCenter: vi.fn().mockResolvedValue({ success: true, data: null }),
        getLens: vi.fn().mockResolvedValue({ success: true, data: { center: null, nodes: [], edges: [], referenceMs: null, strata: [] } }),
      },
    }) as any

    render(
      <MemoryRouter>
        <ContextGraph />
      </MemoryRouter>
    )
    expect(await screen.findByText(/no context yet/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /ingest transcripts/i })).toBeInTheDocument()
  })
})
