
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
  getMeetingsForProject: vi.fn(),
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

  it('should register handlers', () => {
    registerProjectsHandlers()
    expect(ipcMain.handle).toHaveBeenCalledWith('projects:getAll', expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith('projects:getById', expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith('projects:create', expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith('projects:update', expect.any(Function))
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
})
