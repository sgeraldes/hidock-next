
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerKnowledgeHandlers } from '../knowledge-handlers'
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
  runInTransaction: vi.fn((fn) => fn())
}))

describe('Knowledge IPC Handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should register handlers', () => {
    registerKnowledgeHandlers()
    expect(ipcMain.handle).toHaveBeenCalledWith('knowledge:getAll', expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith('knowledge:getById', expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith('knowledge:update', expect.any(Function))
  })
})
