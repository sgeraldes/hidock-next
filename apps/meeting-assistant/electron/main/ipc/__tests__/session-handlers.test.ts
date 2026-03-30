import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipcMain } from 'electron'

// ── Mock Electron ──────────────────────────────────────────────────────────
vi.mock('electron', () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  return {
    ipcMain: {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler)
      }),
      on: vi.fn(),
      _handlers: handlers,
    },
    BrowserWindow: { getAllWindows: vi.fn(() => []) },
  }
})

// ── Mock database-queries ─────────────────────────────────────────────────
const MOCK_SESSIONS = [
  {
    id: 's1',
    title: 'Session 1',
    started_at: 1000,
    ended_at: 2000,
    status: 'completed',
    meeting_id: null,
    audio_path: null,
    transcript_path: null,
  },
  {
    id: 's2',
    title: 'Session 2',
    started_at: 3000,
    ended_at: null,
    status: 'recording',
    meeting_id: null,
    audio_path: null,
    transcript_path: null,
  },
]

const mockGetAllSessions = vi.fn(() => MOCK_SESSIONS)
const mockGetSession = vi.fn((id: string) => ({
  id,
  title: 'Test',
  started_at: 1000,
  ended_at: 2000,
  status: 'completed',
  meeting_id: null,
  audio_path: null,
  transcript_path: null,
}))
const mockDeleteSession = vi.fn()
const mockCreateSession = vi.fn(() => ({
  id: 'new-id',
  title: null,
  started_at: Date.now(),
  ended_at: null,
  status: 'recording',
  meeting_id: null,
  audio_path: null,
  transcript_path: null,
}))
const mockUpdateSession = vi.fn()

const mockGetNotesCount = vi.fn(() => 0)

vi.mock('../../services/database-queries', () => ({
  getAllSessions: () => mockGetAllSessions(),
  getSession: (id: unknown) => mockGetSession(id as string),
  deleteSession: (id: unknown) => mockDeleteSession(id),
  createSession: () => mockCreateSession(),
  updateSession: (id: unknown, updates: unknown) => mockUpdateSession(id, updates),
  getNotesCount: () => mockGetNotesCount(),
}))

// ── Mock database ─────────────────────────────────────────────────────────
const mockDbExec = vi.fn(() => [{ values: [[0]] }])
const mockDbRun = vi.fn()

vi.mock('../../services/database', () => ({
  getDatabase: vi.fn(() => ({
    run: mockDbRun,
    exec: mockDbExec,
  })),
  saveDatabase: vi.fn(),
  mapRows: vi.fn(() => []),
}))

// ── Mock session-manager ──────────────────────────────────────────────────
const mockGetCurrentSession = vi.fn(() => null)
const mockStartSession = vi.fn(() => ({
  id: 'sm-id',
  title: 'SM Session',
  startedAt: Date.now(),
  endedAt: null,
  status: 'recording',
  meetingId: null,
  audioPath: null,
  transcriptPath: null,
}))
const mockEndSession = vi.fn()
const mockLinkMeeting = vi.fn()

vi.mock('../../services/session-manager', () => ({
  getSessionManager: vi.fn(() => ({
    startSession: () => mockStartSession(),
    endSession: () => mockEndSession(),
    getCurrentSession: () => mockGetCurrentSession(),
    linkMeeting: (sessionId: unknown, meetingId: unknown) => mockLinkMeeting(sessionId, meetingId),
  })),
}))

import { registerSessionHandlers } from '../session-handlers'
import { CHANNELS } from '../channels'

describe('Session Handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const handlers = (ipcMain as unknown as { _handlers: Map<string, Function> })._handlers
    handlers.clear()
    registerSessionHandlers()
  })

  // ── Registration ────────────────────────────────────────────────────────

  it('registers all session handlers', () => {
    expect(ipcMain.handle).toHaveBeenCalledWith(CHANNELS.session.list, expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith(CHANNELS.session.create, expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith(CHANNELS.session.get, expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith(CHANNELS.session.end, expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith(CHANNELS.session.delete, expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith(CHANNELS.session.linkMeeting, expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith(CHANNELS.session.stats, expect.any(Function))
  })

  // ── session:list ────────────────────────────────────────────────────────

  it('session:list returns ALL sessions from DB (not just current)', async () => {
    const handlers = (ipcMain as unknown as { _handlers: Map<string, Function> })._handlers
    const handler = handlers.get(CHANNELS.session.list)

    const result = await handler?.({}, undefined)

    expect(mockGetAllSessions).toHaveBeenCalled()
    expect(result).toHaveLength(2)
    expect(result[0].id).toBe('s1')
    expect(result[1].id).toBe('s2')
  })

  it('session:list does NOT rely on session manager current session', async () => {
    // Even if session manager returns a current session, list should use DB
    mockGetCurrentSession.mockReturnValueOnce({
      id: 'current-only',
      title: 'Current',
      startedAt: Date.now(),
    } as unknown as null)
    const handlers = (ipcMain as unknown as { _handlers: Map<string, Function> })._handlers
    const handler = handlers.get(CHANNELS.session.list)

    const result = await handler?.({}, undefined)

    // Should still return DB sessions, not just the in-memory current
    expect(result).toHaveLength(2)
    expect(result[0].id).toBe('s1')
  })

  // ── session:get ─────────────────────────────────────────────────────────

  it('session:get queries DB by ID', async () => {
    const handlers = (ipcMain as unknown as { _handlers: Map<string, Function> })._handlers
    const handler = handlers.get(CHANNELS.session.get)

    const result = await handler?.({}, { sessionId: 'test-id' })

    expect(mockGetSession).toHaveBeenCalledWith('test-id')
    expect(result).toBeDefined()
    expect(result.id).toBe('test-id')
  })

  it('session:get returns null when session not found', async () => {
    mockGetSession.mockReturnValueOnce(null as unknown as ReturnType<typeof mockGetSession>)
    const handlers = (ipcMain as unknown as { _handlers: Map<string, Function> })._handlers
    const handler = handlers.get(CHANNELS.session.get)

    const result = await handler?.({}, { sessionId: 'nonexistent' })

    expect(result).toBeNull()
  })

  // ── session:delete ──────────────────────────────────────────────────────

  it('session:delete removes session from DB and saves', async () => {
    const { saveDatabase } = await import('../../services/database')
    const handlers = (ipcMain as unknown as { _handlers: Map<string, Function> })._handlers
    const handler = handlers.get(CHANNELS.session.delete)

    await handler?.({}, { sessionId: 's1' })

    expect(mockDeleteSession).toHaveBeenCalledWith('s1')
    expect(saveDatabase).toHaveBeenCalled()
  })

  // ── session:stats ───────────────────────────────────────────────────────

  it('session:stats returns correct counts', async () => {
    const handlers = (ipcMain as unknown as { _handlers: Map<string, Function> })._handlers
    const handler = handlers.get(CHANNELS.session.stats)

    expect(handler).toBeDefined()
    const result = await handler?.({}, undefined)

    expect(result).toHaveProperty('totalSessions')
    expect(result).toHaveProperty('totalRecordingMinutes')
    expect(result).toHaveProperty('notesCount')
    expect(result.totalSessions).toBe(2)
  })

  it('session:stats calculates totalRecordingMinutes from ended sessions', async () => {
    // s1 has ended_at 2000, started_at 1000 => 1000ms = ~0 minutes (rounded)
    // s2 has no ended_at => skipped
    const handlers = (ipcMain as unknown as { _handlers: Map<string, Function> })._handlers
    const handler = handlers.get(CHANNELS.session.stats)

    const result = await handler?.({}, undefined)

    // 1000ms total = 0 rounded minutes
    expect(result.totalRecordingMinutes).toBe(0)
  })
})
