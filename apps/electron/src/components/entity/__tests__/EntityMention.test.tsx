import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { EntityMention } from '../EntityMention'
import { PersonHoverCard, ProjectHoverCard, MeetingHoverCard } from '../EntityHoverCards'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => mockNavigate }
})

function renderMention(props: React.ComponentProps<typeof EntityMention>) {
  return render(
    <MemoryRouter>
      <EntityMention {...props} />
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  global.window.electronAPI = {
    contacts: { getById: vi.fn().mockResolvedValue({ success: false }) },
    projects: { getById: vi.fn().mockResolvedValue({ success: false }) },
    meetings: { getById: vi.fn().mockResolvedValue(null) }
  } as any
})

describe('EntityMention navigation', () => {
  it('navigates to /person/:id when a person mention is clicked', () => {
    renderMention({ type: 'person', id: 'p1', name: 'Mario' })
    fireEvent.click(screen.getByRole('button', { name: /open person mario/i }))
    expect(mockNavigate).toHaveBeenCalledWith('/person/p1')
  })

  it('navigates to /projects with selectedId when a project mention is clicked', () => {
    renderMention({ type: 'project', id: 'pr1', name: 'Alpha' })
    fireEvent.click(screen.getByRole('button', { name: /open project alpha/i }))
    expect(mockNavigate).toHaveBeenCalledWith('/projects', { state: { selectedId: 'pr1' } })
  })

  it('navigates to /meeting/:id when a meeting mention is clicked', () => {
    renderMention({ type: 'meeting', id: 'm1', name: 'Sprint Planning' })
    fireEvent.click(screen.getByRole('button', { name: /open meeting sprint planning/i }))
    expect(mockNavigate).toHaveBeenCalledWith('/meeting/m1')
  })

  it('navigates to /calendar with the date when a date mention is clicked', () => {
    renderMention({ type: 'date', date: '2026-02-20T10:00:00Z', name: 'Feb 20' })
    fireEvent.click(screen.getByRole('button', { name: /open calendar on feb 20/i }))
    expect(mockNavigate).toHaveBeenCalledWith('/calendar', { state: { date: '2026-02-20T10:00:00Z' } })
  })

  it('renders unresolved mentions as inert (no button, no navigation)', () => {
    renderMention({ type: 'person', name: 'Ghost' })
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('Ghost')).toBeInTheDocument()
  })

  it('renders an unresolved date mention as inert when no date is provided', () => {
    renderMention({ type: 'date', name: 'Someday' })
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('Someday')).toBeInTheDocument()
  })
})

describe('Entity hover cards (lazy fetch)', () => {
  it('PersonHoverCard fetches the contact by id and shows details', async () => {
    const getById = vi.fn().mockResolvedValue({
      success: true,
      data: { contact: { id: 'p1', name: 'Mario', email: 'mario@x.com', type: 'team', meeting_count: 4 } }
    })
    global.window.electronAPI = { contacts: { getById } } as any

    render(<PersonHoverCard id="p1" name="Mario" />)

    await waitFor(() => expect(getById).toHaveBeenCalledWith('p1'))
    expect(await screen.findByText('mario@x.com')).toBeInTheDocument()
    expect(screen.getByText(/4 meetings/i)).toBeInTheDocument()
  })

  it('ProjectHoverCard fetches the project by id and shows status', async () => {
    const getById = vi.fn().mockResolvedValue({
      success: true,
      data: { project: { id: 'pr1', name: 'Alpha', status: 'active', description: 'A project' } }
    })
    global.window.electronAPI = { projects: { getById } } as any

    render(<ProjectHoverCard id="pr1" name="Alpha" />)

    await waitFor(() => expect(getById).toHaveBeenCalledWith('pr1'))
    expect(await screen.findByText('A project')).toBeInTheDocument()
    expect(screen.getByText('active')).toBeInTheDocument()
  })

  it('MeetingHoverCard fetches the meeting by id and shows the organizer', async () => {
    const getById = vi.fn().mockResolvedValue({
      subject: 'Sprint Planning',
      start_time: '2026-02-20T10:00:00Z',
      organizer_name: 'Luigi'
    })
    global.window.electronAPI = { meetings: { getById } } as any

    render(<MeetingHoverCard id="m1" name="Sprint Planning" />)

    await waitFor(() => expect(getById).toHaveBeenCalledWith('m1'))
    expect(await screen.findByText('Luigi')).toBeInTheDocument()
  })
})
