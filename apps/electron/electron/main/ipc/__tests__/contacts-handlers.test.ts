
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
  getContactByName: vi.fn(),
  createContact: vi.fn(),
  updateContact: vi.fn(),
  deleteContact: vi.fn(),
  getMeetingsForContact: vi.fn(),
  getContactsForMeeting: vi.fn(),
  mergeContacts: vi.fn(),
  unmergeContacts: vi.fn(),
  // Real class so the handler's `err instanceof MergeOrderConflictError` guard works.
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

describe('Contacts IPC Handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should register all handlers including create and delete', () => {
    registerContactsHandlers()
    expect(ipcMain.handle).toHaveBeenCalledWith('contacts:getAll', expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith('contacts:getById', expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith('contacts:create', expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith('contacts:update', expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith('contacts:delete', expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith('contacts:getForMeeting', expect.any(Function))
  })

  it('should create a new contact (contacts:create)', async () => {
    const { getContactByName, createContact } = await import('../../services/database')
    vi.mocked(getContactByName).mockReturnValue(undefined)
    vi.mocked(createContact).mockReturnValue({
      id: 'new-id',
      name: 'Jane Doe',
      email: 'jane@example.com',
      type: 'team',
      role: 'Engineer',
      company: null,
      notes: null,
      tags: null,
      first_seen_at: '2025-01-01',
      last_seen_at: '2025-01-01',
      meeting_count: 0,
      created_at: '2025-01-01'
    } as any)

    registerContactsHandlers()
    const handler = vi.mocked(ipcMain.handle).mock.calls.find((call) => call[0] === 'contacts:create')?.[1]
    const result = (await handler?.({} as any, {
      name: '  Jane Doe  ',
      email: 'jane@example.com',
      role: 'Engineer',
      type: 'team'
    })) as any

    expect(result.success).toBe(true)
    expect(result.data.id).toBe('new-id')
    // Name is trimmed before the duplicate check + insert.
    expect(getContactByName).toHaveBeenCalledWith('Jane Doe')
    expect(createContact).toHaveBeenCalledWith(expect.objectContaining({ name: 'Jane Doe', type: 'team' }))
  })

  it('should reject creating a contact with no name (VALIDATION_ERROR)', async () => {
    registerContactsHandlers()
    const handler = vi.mocked(ipcMain.handle).mock.calls.find((call) => call[0] === 'contacts:create')?.[1]
    const result = (await handler?.({} as any, { name: '   ' })) as any

    expect(result.success).toBe(false)
    expect(result.error.code).toBe('VALIDATION_ERROR')
  })

  it('should guard against duplicate names and surface the existing id (DUPLICATE_ENTRY)', async () => {
    const { getContactByName, createContact } = await import('../../services/database')
    vi.mocked(getContactByName).mockReturnValue({ id: 'existing-id', name: 'Jane Doe' } as any)

    registerContactsHandlers()
    const handler = vi.mocked(ipcMain.handle).mock.calls.find((call) => call[0] === 'contacts:create')?.[1]
    const result = (await handler?.({} as any, { name: 'jane doe' })) as any

    expect(result.success).toBe(false)
    expect(result.error.code).toBe('DUPLICATE_ENTRY')
    expect(result.error.details.existingId).toBe('existing-id')
    expect(createContact).not.toHaveBeenCalled()
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
    await handler?.({} as any, {
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

  const KEEPER = '550e8400-e29b-41d4-a716-446655440000'
  const LOSER = '660e8400-e29b-41d4-a716-446655440001'

  it('should merge two contacts (contacts:merge)', async () => {
    const { getContactById, mergeContacts } = await import('../../services/database')
    vi.mocked(getContactById).mockReturnValue({ id: KEEPER, name: 'K', tags: null } as any)
    vi.mocked(mergeContacts).mockReturnValue({ id: KEEPER, name: 'K', tags: null } as any)

    registerContactsHandlers()
    expect(ipcMain.handle).toHaveBeenCalledWith('contacts:merge', expect.any(Function))

    const handler = vi.mocked(ipcMain.handle).mock.calls.find(call => call[0] === 'contacts:merge')?.[1]
    const result = await handler?.({} as any, { keeperId: KEEPER, loserId: LOSER }) as any

    expect(result.success).toBe(true)
    expect(result.data.id).toBe(KEEPER)
    expect(mergeContacts).toHaveBeenCalledWith(KEEPER, LOSER)
  })

  it('should reject merging a contact into itself', async () => {
    registerContactsHandlers()
    const handler = vi.mocked(ipcMain.handle).mock.calls.find(call => call[0] === 'contacts:merge')?.[1]
    const result = await handler?.({} as any, { keeperId: KEEPER, loserId: KEEPER }) as any

    expect(result.success).toBe(false)
    expect(result.error.code).toBe('VALIDATION_ERROR')
  })

  it('should return NOT_FOUND when a merge target is missing', async () => {
    const { getContactById } = await import('../../services/database')
    vi.mocked(getContactById).mockReturnValue(undefined)

    registerContactsHandlers()
    const handler = vi.mocked(ipcMain.handle).mock.calls.find(call => call[0] === 'contacts:merge')?.[1]
    const result = await handler?.({} as any, { keeperId: KEEPER, loserId: LOSER }) as any

    expect(result.success).toBe(false)
    expect(result.error.code).toBe('NOT_FOUND')
  })

  it('unmerge maps an ordering rejection to MERGE_ORDER_CONFLICT with the blocking journal in details', async () => {
    const { unmergeContacts, MergeOrderConflictError } = await import('../../services/database')
    vi.mocked(unmergeContacts).mockImplementation(() => {
      throw new (MergeOrderConflictError as any)(
        'j-newer',
        'Dora Delta',
        'Merges must be undone newest-first: undo the newer merge of "Dora Delta" (j-newer) before this one'
      )
    })

    registerContactsHandlers()
    const handler = vi.mocked(ipcMain.handle).mock.calls.find(call => call[0] === 'contacts:unmerge')?.[1]
    const result = await handler?.({} as any, 'j-older') as any

    expect(result.success).toBe(false)
    // Distinct code (NOT the generic DATABASE_ERROR) + structured details so
    // the undo UI can point at the exact blocking merge.
    expect(result.error.code).toBe('MERGE_ORDER_CONFLICT')
    expect(result.error.message).toMatch(/undo the newer merge of "Dora Delta"/)
    expect(result.error.details).toMatchObject({ blockingJournalId: 'j-newer', blockingLoserName: 'Dora Delta' })
  })
})
