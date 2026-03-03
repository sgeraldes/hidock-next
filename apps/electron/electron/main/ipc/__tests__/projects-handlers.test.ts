
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerProjectsHandlers } from '../projects-handlers'
import { ipcMain } from 'electron'

// Mock electron ipcMain
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn()
  }
}))

// Mock database
vi.mock('../../services/database', () => ({
  queryAll: vi.fn(),
  queryOne: vi.fn(),
  run: vi.fn(),
  getProjects: vi.fn(),
  getProjectById: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
  getMeetingsForProject: vi.fn(),
  getProjectsForMeeting: vi.fn(),
  tagMeetingToProject: vi.fn(),
  untagMeetingFromProject: vi.fn(),
  getMeetingById: vi.fn(),
  getTranscriptByRecordingId: vi.fn(),
  getRecordingsForMeeting: vi.fn(),
  getTopicsForProjectMeetings: vi.fn(),
  getKnowledgeIdsForProject: vi.fn(),
  getPersonIdsForProject: vi.fn(),
  getDatabase: vi.fn(() => ({
    prepare: vi.fn(() => ({
      bind: vi.fn(),
      step: vi.fn(),
      getAsObject: vi.fn(),
      free: vi.fn()
    }))
  }))
}))

describe('Projects IPC Handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should register all handlers', () => {
    registerProjectsHandlers()
    expect(ipcMain.handle).toHaveBeenCalledWith('projects:getAll', expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith('projects:getById', expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith('projects:create', expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith('projects:update', expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith('projects:delete', expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith('projects:tagMeeting', expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith('projects:untagMeeting', expect.any(Function))
  })

  it('should include status field in mapped project', async () => {
    const { getProjects } = await import('../../services/database')
    const mockRow = {
      id: 'pr1',
      name: 'Project 1',
      description: 'Desc',
      status: 'active',
      created_at: '2025-01-01'
    }

    vi.mocked(getProjects).mockReturnValue({
      projects: [mockRow as any],
      total: 1
    })

    registerProjectsHandlers()
    const handler = vi.mocked(ipcMain.handle).mock.calls.find(call => call[0] === 'projects:getAll')?.[1]
    const result = await handler?.({} as any, {}) as any

    expect(result.data.projects[0].status).toBe('active')
  })

  it('should pass status filter to getProjects (B-PRJ-003)', async () => {
    const { getProjects } = await import('../../services/database')
    vi.mocked(getProjects).mockReturnValue({ projects: [], total: 0 })

    registerProjectsHandlers()
    const handler = vi.mocked(ipcMain.handle).mock.calls.find(call => call[0] === 'projects:getAll')?.[1]
    await handler?.({} as any, { status: 'archived' })

    expect(getProjects).toHaveBeenCalledWith(
      undefined,
      50,
      0,
      'archived'
    )
  })

  it('should populate knowledgeIds and personIds for getById (B-PRJ-002)', async () => {
    const { getProjectById, getMeetingsForProject, getTopicsForProjectMeetings, getKnowledgeIdsForProject, getPersonIdsForProject } = await import('../../services/database')

    vi.mocked(getProjectById).mockReturnValue({
      id: '550e8400-e29b-41d4-a716-446655440000',
      name: 'Test',
      description: null,
      status: 'active',
      created_at: '2025-01-01'
    } as any)
    vi.mocked(getMeetingsForProject).mockReturnValue([])
    vi.mocked(getTopicsForProjectMeetings).mockReturnValue([])
    vi.mocked(getKnowledgeIdsForProject).mockReturnValue(['k1', 'k2'])
    vi.mocked(getPersonIdsForProject).mockReturnValue(['p1'])

    registerProjectsHandlers()
    const handler = vi.mocked(ipcMain.handle).mock.calls.find(call => call[0] === 'projects:getById')?.[1]
    const result = await handler?.({} as any, '550e8400-e29b-41d4-a716-446655440000') as any

    expect(result.success).toBe(true)
    expect(result.data.project.knowledgeIds).toEqual(['k1', 'k2'])
    expect(result.data.project.personIds).toEqual(['p1'])
  })
})
