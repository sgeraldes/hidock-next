
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { Projects } from '../Projects'
import { MemoryRouter } from 'react-router-dom'
import { toast } from '@/components/ui/toaster'

// Mock toast to avoid store side effects and to assert on discovery results.
vi.mock('@/components/ui/toaster', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() }
}))

// Spy on navigation so we can assert the knowledge/actionable click-through.
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

const mockGetAll = vi.fn().mockResolvedValue({
  success: true,
  data: {
    projects: [
      { id: 'pr1', name: 'Project Alpha', status: 'active', createdAt: new Date().toISOString(), description: 'First project' },
      { id: 'pr2', name: 'Project Beta', status: 'archived', createdAt: new Date().toISOString(), description: null }
    ],
    total: 2
  }
})

const mockGetById = vi.fn().mockResolvedValue({
  success: true,
  data: {
    project: {
      id: 'pr1',
      name: 'Project Alpha',
      status: 'active',
      createdAt: new Date().toISOString(),
      description: 'First project',
      knowledgeIds: ['k1', 'k2'],
      personIds: ['p1']
    },
    meetings: [],
    topics: []
  }
})

const mockCreate = vi.fn().mockResolvedValue({
  success: true,
  data: { id: 'pr3', name: 'New Project', status: 'active', createdAt: new Date().toISOString() }
})

const mockKnowledgeGetByIds = vi.fn().mockResolvedValue([
  { id: 'k1', title: 'Kickoff notes', summary: 'Project kickoff', capturedAt: new Date().toISOString() },
  { id: 'k2', title: 'Design review', summary: 'UI review', capturedAt: new Date().toISOString() }
])

// Mock Electron API
global.window.electronAPI = {
  projects: {
    getAll: mockGetAll,
    getById: mockGetById,
    create: mockCreate,
    delete: vi.fn().mockResolvedValue({ success: true }),
    dismissDiscovered: vi.fn().mockResolvedValue({ success: true }),
    update: vi.fn().mockResolvedValue({ success: true, data: {} }),
    getNotes: vi.fn().mockResolvedValue({ success: true, data: [] }),
    getActionables: vi.fn().mockResolvedValue({ success: true, data: [] })
  },
  knowledge: {
    getByIds: mockKnowledgeGetByIds
  },
  contacts: {
    getById: vi.fn().mockResolvedValue({
      success: true,
      data: { contact: { id: 'p1', name: 'Alice Smith', type: 'team' }, meetings: [] }
    })
  },
  // Identity suggestions section loads on mount; default to an empty queue.
  identity: {
    getSuggestions: vi.fn().mockResolvedValue({ success: true, data: [] }),
    acceptSuggestion: vi.fn().mockResolvedValue({ success: true }),
    rejectSuggestion: vi.fn().mockResolvedValue({ success: true }),
    discoverProjects: vi.fn().mockResolvedValue({
      success: true,
      data: { candidatePairs: 8, suggestionsCreated: 2, autoMergeable: 0 }
    })
  }
} as any

beforeEach(() => {
  vi.clearAllMocks()
  // Reset to default mock values
  mockGetAll.mockResolvedValue({
    success: true,
    data: {
      projects: [
        { id: 'pr1', name: 'Project Alpha', status: 'active', createdAt: new Date().toISOString(), description: 'First project' },
        { id: 'pr2', name: 'Project Beta', status: 'archived', createdAt: new Date().toISOString(), description: null }
      ],
      total: 2
    }
  })
  mockGetById.mockResolvedValue({
    success: true,
    data: {
      project: {
        id: 'pr1',
        name: 'Project Alpha',
        status: 'active',
        createdAt: new Date().toISOString(),
        description: 'First project',
        knowledgeIds: ['k1', 'k2'],
        personIds: ['p1']
      },
      meetings: [],
      topics: []
    }
  })
  // clearAllMocks resets call history but not implementations, so reset the shared
  // getSuggestions mock to an empty queue each test (individual tests override it).
  ;(global.window.electronAPI as any).identity.getSuggestions.mockResolvedValue({ success: true, data: [] })
})

describe('Projects Page', () => {
  it('should render list of projects', async () => {
    render(
      <MemoryRouter>
        <Projects />
      </MemoryRouter>
    )

    const item = await screen.findByText('Project Alpha')
    expect(item).toBeInTheDocument()
  })

  it('should render status filter tabs', async () => {
    render(
      <MemoryRouter>
        <Projects />
      </MemoryRouter>
    )

    await screen.findByText('Project Alpha')

    // Text content is lowercase; uppercase is applied via CSS
    expect(screen.getByText('all')).toBeInTheDocument()
    expect(screen.getByText('active')).toBeInTheDocument()
    expect(screen.getByText('archived')).toBeInTheDocument()
  })

  it('should show empty state with guidance when no projects', async () => {
    const emptyResult = {
      success: true,
      data: { projects: [], total: 0 }
    }
    mockGetAll.mockResolvedValue(emptyResult)

    render(
      <MemoryRouter>
        <Projects />
      </MemoryRouter>
    )

    // Default filter is 'active', so empty state shows "No active projects"
    const emptyMsg = await screen.findByText('No active projects')
    expect(emptyMsg).toBeInTheDocument()
  })

  it('should show select project message when no project selected', async () => {
    render(
      <MemoryRouter>
        <Projects />
      </MemoryRouter>
    )

    await screen.findByText('Project Alpha')

    expect(screen.getByText('Select a Project')).toBeInTheDocument()
    expect(screen.getByText(/Choose a project from the sidebar/)).toBeInTheDocument()
  })

  it('should open create project dialog', async () => {
    render(
      <MemoryRouter>
        <Projects />
      </MemoryRouter>
    )

    await screen.findByText('Project Alpha')

    // Click the "New" button in the sidebar header
    fireEvent.click(screen.getByText('New'))

    // Dialog should show the project name input
    expect(screen.getByPlaceholderText('Enter project name...')).toBeInTheDocument()
    // The dialog description should be visible
    expect(screen.getByText('Enter a name for your new project.')).toBeInTheDocument()
  })

  it('should render search input', async () => {
    render(
      <MemoryRouter>
        <Projects />
      </MemoryRouter>
    )

    await screen.findByText('Project Alpha')

    expect(screen.getByPlaceholderText('Search projects...')).toBeInTheDocument()
  })

  // C-006: Detail loading state
  it('should show loading state when selecting a project', async () => {
    // Make getById slow so we can observe the loading state
    let resolveGetById: (value: any) => void
    const slowGetById = new Promise((resolve) => { resolveGetById = resolve })
    ;(global.window.electronAPI as any).projects.getById = vi.fn().mockReturnValue(slowGetById)

    render(
      <MemoryRouter>
        <Projects />
      </MemoryRouter>
    )

    await screen.findByText('Project Alpha')

    // Click on the project to select it
    fireEvent.click(screen.getByText('Project Alpha'))

    // Should show loading spinner
    expect(await screen.findByText('Loading project details...')).toBeInTheDocument()

    // Resolve the getById call
    resolveGetById!({
      success: true,
      data: {
        project: {
          id: 'pr1',
          name: 'Project Alpha',
          status: 'active',
          createdAt: new Date().toISOString(),
          description: 'First project',
          knowledgeIds: [],
          personIds: []
        },
        meetings: [],
        topics: []
      }
    })
  })

  // C-006: Inline description editing
  it('should show edit button for project description', async () => {
    // Reset getById mock
    ;(global.window.electronAPI as any).projects.getById = mockGetById

    render(
      <MemoryRouter>
        <Projects />
      </MemoryRouter>
    )

    await screen.findByText('Project Alpha')

    // Click on the project to select it
    fireEvent.click(screen.getByText('Project Alpha'))

    // Wait for the description to load
    await screen.findByText('First project')

    // Description section should have an Edit button
    const editButton = screen.getByText('Edit')
    expect(editButton).toBeInTheDocument()
  })

  // C-006: Parallel member resolution instead of N+1
  it('should resolve project members in parallel', async () => {
    const mockContactGetById = vi.fn().mockResolvedValue({
      success: true,
      data: { contact: { id: 'p1', name: 'Alice Smith', type: 'team' }, meetings: [] }
    })
    ;(global.window.electronAPI as any).contacts.getById = mockContactGetById
    ;(global.window.electronAPI as any).projects.getById = mockGetById

    render(
      <MemoryRouter>
        <Projects />
      </MemoryRouter>
    )

    await screen.findByText('Project Alpha')

    // Click to select the project
    fireEvent.click(screen.getByText('Project Alpha'))

    // Wait for member name to appear (Alice Smith)
    await screen.findByText('Alice Smith')

    // contacts.getById should have been called for member resolution
    expect(mockContactGetById).toHaveBeenCalledWith('p1')
  })

  // Discovery sweep — button calls the IPC and toasts the result
  it('discover: clicking Discover calls identity.discoverProjects and toasts the result', async () => {
    render(
      <MemoryRouter>
        <Projects />
      </MemoryRouter>
    )
    await screen.findByText('Project Alpha')

    fireEvent.click(screen.getByRole('button', { name: /Discover/ }))

    await waitFor(() =>
      expect((global.window.electronAPI as any).identity.discoverProjects).toHaveBeenCalled()
    )
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        'Discovery complete',
        expect.stringContaining('8 candidate pairs analyzed, 2 new suggestions, 0 high-confidence')
      )
    )
  })

  // The Projects suggestions section is filtered to kind='project' only
  it('renders only project-kind identity suggestions in the filtered section', async () => {
    // getSuggestions has two consumers now (the section's queue + the page's banner
    // count), so return the data for every call rather than just the first.
    ;(global.window.electronAPI as any).identity.getSuggestions.mockResolvedValue({
      success: true,
      data: [
        {
          id: 'sg-person',
          kind: 'person',
          candidate_name: 'PersonCandidate',
          target_id: 'c9',
          confidence: 0.7,
          evidence: null,
          status: 'pending',
          created_at: '2026-07-08T10:00:00Z'
        },
        {
          id: 'sg-project',
          kind: 'project',
          candidate_name: 'ProjectCandidate',
          target_id: 'pr9',
          confidence: 0.75,
          evidence: null,
          status: 'pending',
          created_at: '2026-07-08T10:00:00Z'
        }
      ]
    })

    render(
      <MemoryRouter>
        <Projects />
      </MemoryRouter>
    )

    // The project-kind suggestion is rendered (its name appears on the profile chip
    // and in the "becomes an alias" survivor line)...
    expect((await screen.findAllByText(/ProjectCandidate/)).length).toBeGreaterThan(0)
    // ...while the person-kind suggestion is filtered out.
    expect(screen.queryByText(/PersonCandidate/)).not.toBeInTheDocument()
  })

  // Knowledge click-through — the count card renders the actual items as
  // clickable rows that deep-link into the Library with the item selected.
  it('renders linked knowledge items as clickable rows that navigate into Library', async () => {
    ;(global.window.electronAPI as any).projects.getById = mockGetById

    render(
      <MemoryRouter>
        <Projects />
      </MemoryRouter>
    )

    await screen.findByText('Project Alpha')
    fireEvent.click(screen.getByText('Project Alpha'))

    // Knowledge items resolved via knowledge.getByIds are rendered by title.
    const row = await screen.findByText('Kickoff notes')
    expect(mockKnowledgeGetByIds).toHaveBeenCalledWith(['k1', 'k2'])

    // Clicking a row navigates to /library with that item pre-selected.
    fireEvent.click(row)
    expect(mockNavigate).toHaveBeenCalledWith('/library', { state: { selectedId: 'k1' } })
  })

  // Regression (hub eviction): with a project open AND project suggestions present, the
  // hub must stay reachable — suggestions collapse into a compact banner, not the full
  // (viewport-height) cards that previously pushed the hub's flex-1 to zero height.
  it('keeps the project hub reachable when suggestions exist, expanding on Review', async () => {
    // Keeper (pr9) resolves to a distinct name so "Project Alpha" is unambiguous in the
    // sidebar; the selected project (pr1) still loads its full detail shape.
    ;(global.window.electronAPI as any).projects.getById = vi.fn().mockImplementation((id: string) =>
      id === 'pr9'
        ? Promise.resolve({ success: true, data: { project: { id: 'pr9', name: 'KeeperProject' }, meetings: [], topics: [] } })
        : mockGetById(id)
    )
    ;(global.window.electronAPI as any).identity.getSuggestions.mockResolvedValue({
      success: true,
      data: [
        {
          id: 'sg-project',
          kind: 'project',
          candidate_name: 'ProjectCandidate',
          target_id: 'pr9',
          confidence: 0.75,
          evidence: null,
          status: 'pending',
          created_at: '2026-07-08T10:00:00Z'
        }
      ]
    })

    render(
      <MemoryRouter>
        <Projects />
      </MemoryRouter>
    )

    await screen.findByText('Project Alpha')
    fireEvent.click(screen.getByText('Project Alpha'))

    // The hub the user clicked is rendered (header heading + Knowledge card content)...
    expect(await screen.findByRole('heading', { name: 'Project Alpha' })).toBeInTheDocument()
    expect(await screen.findByText('Kickoff notes')).toBeInTheDocument()

    // ...and suggestions appear as a compact banner, NOT the full section (the candidate
    // card is not mounted yet).
    const reviewBtn = await screen.findByRole('button', { name: /Review 1 project name suggestion/i })
    expect(reviewBtn).toBeInTheDocument()
    expect(screen.queryByText(/ProjectCandidate/)).not.toBeInTheDocument()

    // Clicking Review expands the full section (candidate now visible) with a Back control.
    fireEvent.click(reviewBtn)
    expect((await screen.findAllByText(/ProjectCandidate/)).length).toBeGreaterThan(0)
    const backBtn = screen.getByRole('button', { name: /Back to Project Alpha/i })
    expect(backBtn).toBeInTheDocument()

    // Collapsing back returns to the hub and hides the full section.
    fireEvent.click(backBtn)
    expect(await screen.findByRole('button', { name: /Review 1 project name suggestion/i })).toBeInTheDocument()
    expect(screen.queryByText(/ProjectCandidate/)).not.toBeInTheDocument()
  })

  // F9(a): a project carries a link back to the meeting(s) it was discovered from.
  it('shows a "Discovered from" provenance chip linking to the source meeting', async () => {
    ;(global.window.electronAPI as any).projects.getById = vi.fn().mockResolvedValue({
      success: true,
      data: {
        project: {
          id: 'pr1',
          name: 'Project Alpha',
          status: 'active',
          createdAt: new Date().toISOString(),
          description: 'First project',
          origin: 'discovered',
          knowledgeIds: ['k1', 'k2'],
          personIds: ['p1']
        },
        meetings: [{ id: 'm1', subject: 'Weekly Sync' }],
        topics: []
      }
    })

    render(
      <MemoryRouter>
        <Projects />
      </MemoryRouter>
    )

    await screen.findByText('Project Alpha')
    fireEvent.click(screen.getByText('Project Alpha'))

    expect(await screen.findByText('Discovered from')).toBeInTheDocument()
    const chip = await screen.findByText('Weekly Sync')
    fireEvent.click(chip)
    expect(mockNavigate).toHaveBeenCalledWith('/meeting/m1')
  })

  // F9(b): a zero-items / zero-people discovery is an honest review state, not a
  // bare "0 Items / 0 Involved" dead end — with source, merge, and dismiss actions.
  it('renders an honest review state for an empty discovered project', async () => {
    ;(global.window.electronAPI as any).projects.getById = vi.fn().mockResolvedValue({
      success: true,
      data: {
        project: {
          id: 'pr1',
          name: 'Project Alpha',
          status: 'active',
          createdAt: new Date().toISOString(),
          description: null,
          origin: 'discovered',
          knowledgeIds: [],
          personIds: []
        },
        meetings: [{ id: 'm1', subject: 'Weekly Sync' }],
        topics: []
      }
    })

    render(
      <MemoryRouter>
        <Projects />
      </MemoryRouter>
    )

    await screen.findByText('Project Alpha')
    fireEvent.click(screen.getByText('Project Alpha'))

    // Honest state + source link back to the meeting it was inferred from.
    expect(await screen.findByText('Discovered automatically')).toBeInTheDocument()
    expect(screen.getByText('Weekly Sync')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Merge into another project/i })).toBeInTheDocument()

    // Dismiss opens its own confirm (durable-rejection copy, not plain delete)…
    fireEvent.click(screen.getByRole('button', { name: /^Dismiss$/i }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent(/Dismiss Discovered Project/i)
    expect(dialog).toHaveTextContent(/won't re-create it/i)

    // …and confirming routes through dismissDiscovered (tombstone + delete),
    // NOT the plain delete path — that's what makes the dismissal durable.
    fireEvent.click(within(dialog).getByRole('button', { name: /^Dismiss$/i }))
    await waitFor(() =>
      expect((global.window.electronAPI as any).projects.dismissDiscovered).toHaveBeenCalledWith('pr1')
    )
    expect((global.window.electronAPI as any).projects.delete).not.toHaveBeenCalled()
  })

  // MEDIUM-4 / v42: a hand-created project is NOT "discovered" even when it has
  // meetings tagged — the review card is gated on the durable origin column
  // ('manual'), not on linked meetings. Manual projects get a neutral state.
  it('renders a neutral empty state (not "Discovered automatically") for a manual project with tagged meetings', async () => {
    ;(global.window.electronAPI as any).projects.getById = vi.fn().mockResolvedValue({
      success: true,
      data: {
        project: {
          id: 'pr1',
          name: 'Project Alpha',
          status: 'active',
          createdAt: new Date().toISOString(),
          description: null,
          origin: 'manual',
          knowledgeIds: [],
          personIds: []
        },
        meetings: [{ id: 'm1', subject: 'Weekly Sync' }], // tagged, but origin='manual'
        topics: []
      }
    })

    render(
      <MemoryRouter>
        <Projects />
      </MemoryRouter>
    )

    await screen.findByText('Project Alpha')
    fireEvent.click(screen.getByText('Project Alpha'))

    expect(await screen.findByText('No items yet')).toBeInTheDocument()
    expect(screen.getByText(/Add knowledge or link meetings/i)).toBeInTheDocument()
    expect(screen.queryByText('Discovered automatically')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Dismiss$/i })).not.toBeInTheDocument()
  })

  it('offers a "View all in Library" affordance on the knowledge card', async () => {
    ;(global.window.electronAPI as any).projects.getById = mockGetById

    render(
      <MemoryRouter>
        <Projects />
      </MemoryRouter>
    )

    await screen.findByText('Project Alpha')
    fireEvent.click(screen.getByText('Project Alpha'))

    const viewAll = await screen.findByText('View all in Library')
    fireEvent.click(viewAll)
    expect(mockNavigate).toHaveBeenCalledWith('/library')
  })
})
