
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerMeetingsHandlers } from '../meetings-handlers'
import { ipcMain } from 'electron'

// Mock electron ipcMain
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn()
  }
}))

// Mock database
vi.mock('../../services/database', () => ({
  getMeetingById: vi.fn(),
  updateMeeting: vi.fn(),
  addMeetingAttendee: vi.fn(),
  removeMeetingAttendee: vi.fn()
}))

describe('Meetings IPC Handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should register meetings:update handler', () => {
    registerMeetingsHandlers()
    expect(ipcMain.handle).toHaveBeenCalledWith('meetings:update', expect.any(Function))
  })

  it('should update meeting subject (B-MTG-001)', async () => {
    const { getMeetingById, updateMeeting } = await import('../../services/database')
    const mockMeeting = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      subject: 'Old Subject',
      start_time: '2025-01-01T10:00:00Z',
      end_time: '2025-01-01T11:00:00Z',
      location: null,
      description: null,
      updated_at: '2025-01-01T00:00:00Z'
    }

    vi.mocked(getMeetingById).mockReturnValue(mockMeeting as any)

    registerMeetingsHandlers()
    const handler = vi.mocked(ipcMain.handle).mock.calls.find(call => call[0] === 'meetings:update')?.[1]
    const result = await handler?.({} as any, {
      id: '550e8400-e29b-41d4-a716-446655440000',
      subject: 'New Subject'
    }) as any

    expect(result.success).toBe(true)
    expect(updateMeeting).toHaveBeenCalledWith(
      '550e8400-e29b-41d4-a716-446655440000',
      expect.objectContaining({ subject: 'New Subject' })
    )
  })

  it('should return NOT_FOUND for non-existent meeting', async () => {
    const { getMeetingById } = await import('../../services/database')
    vi.mocked(getMeetingById).mockReturnValue(undefined)

    registerMeetingsHandlers()
    const handler = vi.mocked(ipcMain.handle).mock.calls.find(call => call[0] === 'meetings:update')?.[1]
    const result = await handler?.({} as any, {
      id: '550e8400-e29b-41d4-a716-446655440000',
      subject: 'Test'
    }) as any

    expect(result.success).toBe(false)
    expect(result.error.code).toBe('NOT_FOUND')
  })

  it('should reject empty update request', async () => {
    registerMeetingsHandlers()
    const handler = vi.mocked(ipcMain.handle).mock.calls.find(call => call[0] === 'meetings:update')?.[1]
    const result = await handler?.({} as any, {
      id: '550e8400-e29b-41d4-a716-446655440000'
    }) as any

    expect(result.success).toBe(false)
    expect(result.error.code).toBe('VALIDATION_ERROR')
  })

  it('should accept organizer fields in meetings:update', async () => {
    const { getMeetingById, updateMeeting } = await import('../../services/database')
    vi.mocked(getMeetingById).mockReturnValue({ id: '550e8400-e29b-41d4-a716-446655440000' } as any)

    registerMeetingsHandlers()
    const handler = vi.mocked(ipcMain.handle).mock.calls.find(call => call[0] === 'meetings:update')?.[1]
    const result = await handler?.({} as any, {
      id: '550e8400-e29b-41d4-a716-446655440000',
      organizer_name: 'Alice',
      organizer_email: 'alice@x.com'
    }) as any

    expect(result.success).toBe(true)
    expect(updateMeeting).toHaveBeenCalledWith(
      '550e8400-e29b-41d4-a716-446655440000',
      expect.objectContaining({ organizer_name: 'Alice', organizer_email: 'alice@x.com' })
    )
  })

  it('should register and delegate meetings:addAttendee', async () => {
    const { getMeetingById, addMeetingAttendee } = await import('../../services/database')
    vi.mocked(getMeetingById).mockReturnValue({ id: '550e8400-e29b-41d4-a716-446655440000' } as any)
    vi.mocked(addMeetingAttendee).mockReturnValue({ id: 'c1', name: 'Bob' } as any)

    registerMeetingsHandlers()
    expect(ipcMain.handle).toHaveBeenCalledWith('meetings:addAttendee', expect.any(Function))

    const handler = vi.mocked(ipcMain.handle).mock.calls.find(call => call[0] === 'meetings:addAttendee')?.[1]
    const result = await handler?.({} as any, {
      meetingId: '550e8400-e29b-41d4-a716-446655440000',
      name: 'Bob',
      email: 'bob@x.com'
    }) as any

    expect(result.success).toBe(true)
    expect(addMeetingAttendee).toHaveBeenCalledWith(
      '550e8400-e29b-41d4-a716-446655440000',
      { name: 'Bob', email: 'bob@x.com' }
    )
  })

  it('should reject addAttendee with neither name nor email', async () => {
    registerMeetingsHandlers()
    const handler = vi.mocked(ipcMain.handle).mock.calls.find(call => call[0] === 'meetings:addAttendee')?.[1]
    const result = await handler?.({} as any, {
      meetingId: '550e8400-e29b-41d4-a716-446655440000'
    }) as any

    expect(result.success).toBe(false)
    expect(result.error.code).toBe('VALIDATION_ERROR')
  })

  it('should register and delegate meetings:removeAttendee', async () => {
    const { getMeetingById, removeMeetingAttendee } = await import('../../services/database')
    vi.mocked(getMeetingById).mockReturnValue({ id: '550e8400-e29b-41d4-a716-446655440000' } as any)

    registerMeetingsHandlers()
    expect(ipcMain.handle).toHaveBeenCalledWith('meetings:removeAttendee', expect.any(Function))

    const handler = vi.mocked(ipcMain.handle).mock.calls.find(call => call[0] === 'meetings:removeAttendee')?.[1]
    const result = await handler?.({} as any, {
      meetingId: '550e8400-e29b-41d4-a716-446655440000',
      contactId: '660e8400-e29b-41d4-a716-446655440001'
    }) as any

    expect(result.success).toBe(true)
    expect(removeMeetingAttendee).toHaveBeenCalledWith(
      '550e8400-e29b-41d4-a716-446655440000',
      '660e8400-e29b-41d4-a716-446655440001'
    )
  })
})
