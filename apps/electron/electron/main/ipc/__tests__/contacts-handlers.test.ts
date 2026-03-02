
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
  updateContact: vi.fn(),
  deleteContact: vi.fn(),
  getMeetingsForContact: vi.fn(),
  getContactsForMeeting: vi.fn(),
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

  it('should register all handlers including delete', () => {
    registerContactsHandlers()
    expect(ipcMain.handle).toHaveBeenCalledWith('contacts:getAll', expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith('contacts:getById', expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith('contacts:update', expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith('contacts:delete', expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith('contacts:getForMeeting', expect.any(Function))
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

  it('should update contact name and email (B-PPL-003)', async () => {
    const { getContactById, updateContact } = await import('../../services/database')
    const mockContact = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      name: 'Old Name',
      email: 'old@example.com',
      type: 'team',
      role: null,
      company: null,
      notes: null,
      tags: null,
      first_seen_at: '2025-01-01',
      last_seen_at: '2025-01-02',
      meeting_count: 1,
      created_at: '2025-01-01'
    }

    vi.mocked(getContactById).mockReturnValue(mockContact as any)

    registerContactsHandlers()
    const handler = vi.mocked(ipcMain.handle).mock.calls.find(call => call[0] === 'contacts:update')?.[1]
    const result = await handler?.({} as any, {
      id: '550e8400-e29b-41d4-a716-446655440000',
      name: 'New Name',
      email: 'new@example.com'
    }) as any

    expect(updateContact).toHaveBeenCalledWith(
      '550e8400-e29b-41d4-a716-446655440000',
      expect.objectContaining({ name: 'New Name', email: 'new@example.com' })
    )
  })

  it('should delete a contact (B-PPL-004)', async () => {
    const { getContactById, deleteContact } = await import('../../services/database')
    const mockContact = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      name: 'Test',
      email: null,
      type: 'unknown',
      role: null,
      company: null,
      notes: null,
      tags: null,
      first_seen_at: '2025-01-01',
      last_seen_at: '2025-01-02',
      meeting_count: 0,
      created_at: '2025-01-01'
    }

    vi.mocked(getContactById).mockReturnValue(mockContact as any)

    registerContactsHandlers()
    const handler = vi.mocked(ipcMain.handle).mock.calls.find(call => call[0] === 'contacts:delete')?.[1]
    const result = await handler?.({} as any, '550e8400-e29b-41d4-a716-446655440000') as any

    expect(result.success).toBe(true)
    expect(deleteContact).toHaveBeenCalledWith('550e8400-e29b-41d4-a716-446655440000')
  })

  it('should return NOT_FOUND when deleting non-existent contact', async () => {
    const { getContactById } = await import('../../services/database')
    vi.mocked(getContactById).mockReturnValue(undefined)

    registerContactsHandlers()
    const handler = vi.mocked(ipcMain.handle).mock.calls.find(call => call[0] === 'contacts:delete')?.[1]
    const result = await handler?.({} as any, '550e8400-e29b-41d4-a716-446655440000') as any

    expect(result.success).toBe(false)
    expect(result.error.code).toBe('NOT_FOUND')
  })
})
