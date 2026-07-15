
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerProjectsHandlers } from '../projects-handlers'
import { ipcMain } from 'electron'

// Mock electron ipcMain + shell
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn()
  },
  shell: {
    openPath: vi.fn(async () => '')
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
  mergeProjects: vi.fn(),
  getProjectsForKnowledge: vi.fn(),
  getProjectNotes: vi.fn(),
  addProjectNote: vi.fn(),
  updateProjectNote: vi.fn(),
  deleteProjectNote: vi.fn(),
  getActionablesForProject: vi.fn(),
  addProjectDiscoveryRejection: vi.fn(),
  dismissDiscoveredProject: vi.fn(),
  unmergeProjects: vi.fn(),
  // Real classes so the handlers' `err instanceof` guards work.
  DismissDiscoveredError: class DismissDiscoveredError extends Error {
    constructor(public readonly code: 'NOT_FOUND' | 'NOT_DISCOVERED', message: string) {
      super(message)
      this.name = 'DismissDiscoveredError'
    }
  },
  MergeOrderConflictError: class MergeOrderConflictError extends Error {
    constructor(
      public readonly blockingJournalId: string,
      public readonly blockingLoserName: string | null,
      message: string
    ) {
      super(message)
      this.name = 'MergeOrderConflictError'
    }
  },
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

  const PROJECT_ID = '550e8400-e29b-41d4-a716-446655440000'
  const NOTE_ID = '660e8400-e29b-41d4-a716-446655440111'

  function getHandler(channel: string) {
    return vi.mocked(ipcMain.handle).mock.calls.find(call => call[0] === channel)?.[1]
  }

  it('registers the v29 hub handlers', () => {
    registerProjectsHandlers()
    for (const channel of [
      'projects:getNotes',
      'projects:addNote',
      'projects:updateNote',
      'projects:deleteNote',
      'projects:getActionables',
      'projects:openFolder'
    ]) {
      expect(ipcMain.handle).toHaveBeenCalledWith(channel, expect.any(Function))
    }
  })

  it('rename + folderPath flow through projects:update', async () => {
    const { getProjectById, updateProject } = await import('../../services/database')
    vi.mocked(getProjectById).mockReturnValue({
      id: PROJECT_ID, name: 'Renamed', description: null, status: 'active',
      folder_path: 'C:/repo', url: null, created_at: '2026-01-01'
    } as any)

    registerProjectsHandlers()
    const handler = getHandler('projects:update')
    const result = await handler?.({} as any, { id: PROJECT_ID, name: 'Renamed', folderPath: 'C:/repo' }) as any

    expect(result.success).toBe(true)
    expect(result.data.name).toBe('Renamed')
    expect(result.data.folderPath).toBe('C:/repo')
    expect(updateProject).toHaveBeenCalledWith(PROJECT_ID, expect.objectContaining({ name: 'Renamed', folderPath: 'C:/repo' }))
  })

  it('addNote creates a project note', async () => {
    const { getProjectById, addProjectNote } = await import('../../services/database')
    vi.mocked(getProjectById).mockReturnValue({ id: PROJECT_ID, name: 'P', description: null, status: 'active', folder_path: null, url: null, created_at: 'x' } as any)
    const note = { id: NOTE_ID, project_id: PROJECT_ID, kind: 'issue', content: 'Bug', status: 'open', created_at: 'x', resolved_at: null }
    vi.mocked(addProjectNote).mockReturnValue(note as any)

    registerProjectsHandlers()
    const handler = getHandler('projects:addNote')
    const result = await handler?.({} as any, { projectId: PROJECT_ID, kind: 'issue', content: 'Bug' }) as any

    expect(result.success).toBe(true)
    expect(result.data).toEqual(note)
    expect(addProjectNote).toHaveBeenCalledWith(PROJECT_ID, 'issue', 'Bug')
  })

  it('updateNote toggles status', async () => {
    const { updateProjectNote } = await import('../../services/database')
    const resolved = { id: NOTE_ID, project_id: PROJECT_ID, kind: 'issue', content: 'Bug', status: 'resolved', created_at: 'x', resolved_at: 'y' }
    vi.mocked(updateProjectNote).mockReturnValue(resolved as any)

    registerProjectsHandlers()
    const handler = getHandler('projects:updateNote')
    const result = await handler?.({} as any, { id: NOTE_ID, status: 'resolved' }) as any

    expect(result.success).toBe(true)
    expect(result.data.status).toBe('resolved')
    expect(updateProjectNote).toHaveBeenCalledWith(NOTE_ID, expect.objectContaining({ status: 'resolved' }))
  })

  it('getNotes returns the project notes', async () => {
    const { getProjectNotes } = await import('../../services/database')
    vi.mocked(getProjectNotes).mockReturnValue([
      { id: NOTE_ID, project_id: PROJECT_ID, kind: 'risk', content: 'R', status: 'open', created_at: 'x', resolved_at: null }
    ] as any)

    registerProjectsHandlers()
    const handler = getHandler('projects:getNotes')
    const result = await handler?.({} as any, { projectId: PROJECT_ID, kind: 'risk' }) as any

    expect(result.success).toBe(true)
    expect(result.data).toHaveLength(1)
    expect(getProjectNotes).toHaveBeenCalledWith(PROJECT_ID, 'risk')
  })

  it('getActionables maps DB rows to the renderer shape', async () => {
    const { getActionablesForProject } = await import('../../services/database')
    vi.mocked(getActionablesForProject).mockReturnValue([
      { id: 'a1', type: 'email', title: 'Follow up', description: null, source_knowledge_id: 'k1', status: 'pending', confidence: 0.9, created_at: '2026-07-08' }
    ] as any)

    registerProjectsHandlers()
    const handler = getHandler('projects:getActionables')
    const result = await handler?.({} as any, PROJECT_ID) as any

    expect(result.success).toBe(true)
    expect(result.data[0]).toMatchObject({ id: 'a1', title: 'Follow up', status: 'pending', sourceKnowledgeId: 'k1' })
    expect(getActionablesForProject).toHaveBeenCalledWith(PROJECT_ID)
  })

  it('openFolder rejects a project with no folder path', async () => {
    const { getProjectById } = await import('../../services/database')
    vi.mocked(getProjectById).mockReturnValue({ id: PROJECT_ID, name: 'P', description: null, status: 'active', folder_path: null, url: null, created_at: 'x' } as any)

    registerProjectsHandlers()
    const handler = getHandler('projects:openFolder')
    const result = await handler?.({} as any, PROJECT_ID) as any

    expect(result.success).toBe(false)
    expect(result.error.code).toBe('VALIDATION_ERROR')
  })

  // v41: dismissing a discovered project records the tombstone BEFORE deleting,
  // with the source meeting id, so re-analysis cannot silently re-create it.
  it('dismissDiscovered delegates to the provenance-enforcing DB function and returns success', async () => {
    // Provenance check + tombstone + delete are now one atomic DB-layer call
    // (unit-tested in project-discovery-rejection.test.ts). The handler just
    // delegates and maps typed failures.
    const { dismissDiscoveredProject } = await import('../../services/database')
    vi.mocked(dismissDiscoveredProject).mockReturnValue(undefined)

    registerProjectsHandlers()
    const handler = getHandler('projects:dismissDiscovered')
    const result = await handler?.({} as any, PROJECT_ID) as any

    expect(result.success).toBe(true)
    expect(dismissDiscoveredProject).toHaveBeenCalledWith(PROJECT_ID)
  })

  it('dismissDiscovered REJECTS a non-discovered (manual/legacy) project server-side with a VALIDATION_ERROR', async () => {
    // The core provenance guard at the IPC boundary: a NOT_DISCOVERED failure
    // from the DB layer must surface as a validation error, never a delete.
    const { dismissDiscoveredProject, DismissDiscoveredError } = await import('../../services/database')
    vi.mocked(dismissDiscoveredProject).mockImplementation(() => {
      throw new DismissDiscoveredError('NOT_DISCOVERED', 'Only auto-discovered projects can be dismissed.')
    })

    registerProjectsHandlers()
    const handler = getHandler('projects:dismissDiscovered')
    const result = await handler?.({} as any, PROJECT_ID) as any

    expect(result.success).toBe(false)
    expect(result.error.code).toBe('VALIDATION_ERROR')
  })

  it('dismissDiscovered maps a NOT_FOUND failure to a NOT_FOUND result', async () => {
    const { dismissDiscoveredProject, DismissDiscoveredError } = await import('../../services/database')
    vi.mocked(dismissDiscoveredProject).mockImplementation(() => {
      throw new DismissDiscoveredError('NOT_FOUND', `Project with ID ${PROJECT_ID} not found`)
    })

    registerProjectsHandlers()
    const handler = getHandler('projects:dismissDiscovered')
    const result = await handler?.({} as any, PROJECT_ID) as any

    expect(result.success).toBe(false)
    expect(result.error.code).toBe('NOT_FOUND')
  })

  it('unmerge maps an ordering rejection to MERGE_ORDER_CONFLICT with the blocking journal in details', async () => {
    const { unmergeProjects, MergeOrderConflictError } = await import('../../services/database')
    vi.mocked(unmergeProjects).mockImplementation(() => {
      throw new (MergeOrderConflictError as any)(
        'j-newer',
        'Delta Hub',
        'Merges must be undone newest-first: undo the newer merge of "Delta Hub" (j-newer) before this one'
      )
    })

    registerProjectsHandlers()
    const handler = getHandler('projects:unmerge')
    const result = await handler?.({} as any, PROJECT_ID) as any

    expect(result.success).toBe(false)
    // Distinct code (NOT the generic DATABASE_ERROR) + structured details so
    // the undo UI can point at the exact blocking merge.
    expect(result.error.code).toBe('MERGE_ORDER_CONFLICT')
    expect(result.error.message).toMatch(/undo the newer merge of "Delta Hub"/)
    expect(result.error.details).toMatchObject({ blockingJournalId: 'j-newer', blockingLoserName: 'Delta Hub' })
  })
})
