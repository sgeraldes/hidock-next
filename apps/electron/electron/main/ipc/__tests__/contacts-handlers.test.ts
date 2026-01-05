
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerContactsHandlers } from '../contacts-handlers'
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
  runInTransaction: vi.fn((fn) => fn()),
  getContacts: vi.fn(),
  getContactById: vi.fn(),
  getMeetingsForContact: vi.fn(),
  getDatabase: vi.fn(() => ({
    prepare: vi.fn(() => ({
      bind: vi.fn(),
      step: vi.fn(),
      getAsObject: vi.fn(),
      free: vi.fn()
    }))
  }))
}))

describe('Contacts IPC Handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should register handlers', () => {
    registerContactsHandlers()
    expect(ipcMain.handle).toHaveBeenCalledWith('contacts:getAll', expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith('contacts:getById', expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith('contacts:update', expect.any(Function))
  })

  it('should map database row to Person interface including new fields', async () => {
    const { getContacts } = await import('../../services/database')
    const mockRow = {
      id: 'p1',
      name: 'Mario',
      email: 'mario@example.com',
      type: 'team',
      role: 'Dev',
      company: 'HiDock',
      notes: 'Notes',
      tags: '["tag1"]',
      firstSeenAt: '2025-01-01',
      lastSeenAt: '2025-01-02',
      meetingCount: 5,
      createdAt: '2025-01-01'
    }
    
    vi.mocked(getContacts).mockReturnValue({
      contacts: [mockRow as any],
      total: 1
    })
    
    registerContactsHandlers()
    const handler = vi.mocked(ipcMain.handle).mock.calls.find(call => call[0] === 'contacts:getAll')?.[1]
    const result = await handler?.({} as any, {}) as any
    
    const person = result.data.contacts[0]
    expect(person.type).toBe('team')
    expect(person.role).toBe('Dev')
    expect(person.company).toBe('HiDock')
    expect(person.tags).toEqual(['tag1'])
  })
})
