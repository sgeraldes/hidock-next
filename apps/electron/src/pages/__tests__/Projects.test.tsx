
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Projects } from '../Projects'
import { MemoryRouter } from 'react-router-dom'

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
})
