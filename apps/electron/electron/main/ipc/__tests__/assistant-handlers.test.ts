
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerAssistantHandlers } from '../assistant-handlers'
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

describe('Assistant IPC Handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should register handlers', () => {
    registerAssistantHandlers()
    expect(ipcMain.handle).toHaveBeenCalledWith('assistant:getConversations', expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith('assistant:createConversation', expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith('assistant:deleteConversation', expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith('assistant:getMessages', expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith('assistant:addMessage', expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith('assistant:addContext', expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith('assistant:removeContext', expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith('assistant:getContext', expect.any(Function))
  })
})
