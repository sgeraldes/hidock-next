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

// ── Mock database-queries (use path relative to the handler file) ──────────
const mockGetTranscriptBySession = vi.fn((_sessionId?: unknown) => [
  {
    id: 1,
    session_id: 'sess-1',
    speaker: 'Alice',
    text: 'Hello world',
    start_time: 0,
    end_time: 5,
    confidence: 0.95,
    source: 'mic',
  },
])
const mockGetRecentTranscriptSegments = vi.fn((_sessionId?: unknown, _limit?: unknown) => [
  {
    id: 2,
    session_id: 'sess-1',
    speaker: 'Bob',
    text: 'Recent segment',
    start_time: 10,
    end_time: 15,
    confidence: 0.9,
    source: 'mic',
  },
])

vi.mock('../../services/database-queries', () => ({
  getTranscriptBySession: (sessionId: unknown) => mockGetTranscriptBySession(sessionId),
  getRecentTranscriptSegments: (sessionId: unknown, limit: unknown) => mockGetRecentTranscriptSegments(sessionId, limit),
}))

vi.mock('../../services/database', () => ({
  getDatabase: vi.fn(() => ({
    run: vi.fn(),
    exec: vi.fn(() => []),
  })),
  saveDatabase: vi.fn(),
  mapRows: vi.fn(() => []),
}))

import { registerTranscriptHandlers } from '../transcript-handlers'
import { CHANNELS } from '../channels'

describe('Transcript Handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const handlers = (ipcMain as unknown as { _handlers: Map<string, Function> })._handlers
    handlers.clear()
    registerTranscriptHandlers()
  })

  it('registers getSegments handler', () => {
    expect(ipcMain.handle).toHaveBeenCalledWith(
      CHANNELS.transcript.getSegments,
      expect.any(Function),
    )
  })

  it('registers getRecent handler', () => {
    expect(ipcMain.handle).toHaveBeenCalledWith(
      CHANNELS.transcript.getRecent,
      expect.any(Function),
    )
  })

  it('getSegments returns transcript segments from DB', async () => {
    const handlers = (ipcMain as unknown as { _handlers: Map<string, Function> })._handlers
    const handler = handlers.get(CHANNELS.transcript.getSegments)

    const result = await handler?.({}, { sessionId: 'sess-1' })

    expect(mockGetTranscriptBySession).toHaveBeenCalledWith('sess-1')
    expect(result).toHaveLength(1)
    expect(result[0].text).toBe('Hello world')
  })

  it('getRecent returns recent segments with default limit', async () => {
    const handlers = (ipcMain as unknown as { _handlers: Map<string, Function> })._handlers
    const handler = handlers.get(CHANNELS.transcript.getRecent)

    const result = await handler?.({}, { sessionId: 'sess-1' })

    expect(mockGetRecentTranscriptSegments).toHaveBeenCalledWith('sess-1', 50)
    expect(result).toHaveLength(1)
  })

  it('getRecent respects custom maxCount', async () => {
    const handlers = (ipcMain as unknown as { _handlers: Map<string, Function> })._handlers
    const handler = handlers.get(CHANNELS.transcript.getRecent)

    await handler?.({}, { sessionId: 'sess-1', maxCount: 20 })

    expect(mockGetRecentTranscriptSegments).toHaveBeenCalledWith('sess-1', 20)
  })
})
