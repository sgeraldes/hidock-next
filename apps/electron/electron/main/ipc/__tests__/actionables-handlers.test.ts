
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerActionablesHandlers } from '../actionables-handlers'
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

describe('Actionables IPC Handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should register handlers', () => {
    registerActionablesHandlers()
    expect(ipcMain.handle).toHaveBeenCalledWith('actionables:getAll', expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith('actionables:updateStatus', expect.any(Function))
  })
})
