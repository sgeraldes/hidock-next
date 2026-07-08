
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Projects } from '../Projects'
import { MemoryRouter } from 'react-router-dom'
import { toast } from '@/components/ui/toaster'

// Mock toast to avoid store side effects and to assert on discovery results.
vi.mock('@/components/ui/toaster', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() }
}))

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

// Mock Electron API
global.window.electronAPI = {
  projects: {
    getAll: mockGetAll,
    getById: mockGetById,
    create: mockCreate,
    delete: vi.fn().mockResolvedValue({ success: true }),
    update: vi.fn().mockResolvedValue({ success: true, data: {} })
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
    ;(global.window.electronAPI as any).identity.getSuggestions.mockResolvedValueOnce({
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

    // The project-kind suggestion is rendered (candidate name is wrapped in typographic quotes)...
    expect(await screen.findByText(/ProjectCandidate/)).toBeInTheDocument()
    // ...while the person-kind suggestion is filtered out.
    expect(screen.queryByText(/PersonCandidate/)).not.toBeInTheDocument()
  })
})
