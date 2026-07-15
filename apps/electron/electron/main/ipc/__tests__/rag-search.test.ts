
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerRAGHandlers } from '../rag-handlers'
import { ipcMain } from 'electron'

// Mock dependencies
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  app: { getPath: vi.fn(() => 'test-path') }
}))

// NOTE: mock paths must resolve to the SAME absolute module rag-handlers.ts
// imports (electron/main/services/*). rag-handlers.ts lives in ipc/, so from
// THIS file (ipc/__tests__/) that is '../../services/*' — '../services/*' would
// resolve to the non-existent ipc/services/* and be a dead no-op mock.
vi.mock('../../services/rag', () => ({
  getRAGService: vi.fn(() => ({
    globalSearch: vi.fn().mockResolvedValue({ success: true, data: { knowledge: [], people: [], projects: [] } })
  }))
}))

const { indexTranscript } = vi.hoisted(() => ({ indexTranscript: vi.fn(async () => 3) }))
vi.mock('../../services/vector-store', () => ({
  getVectorStore: vi.fn(() => ({
    getDocumentCount: vi.fn(),
    getMeetingCount: vi.fn(),
    indexTranscript
  }))
}))

vi.mock('../../services/chat-llm', () => ({
  getChatLLMService: vi.fn(() => ({ getStatus: vi.fn().mockResolvedValue({ backend: 'none' }) }))
}))

describe('RAG Global Search Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should register rag:globalSearch handler', () => {
    registerRAGHandlers()
    expect(ipcMain.handle).toHaveBeenCalledWith('rag:globalSearch', expect.any(Function))
  })

  it('ADV11 — rag:index-transcript STRIPS renderer-supplied captureId (and any non-whitelisted key)', async () => {
    registerRAGHandlers()
    // Find the registered rag:index-transcript handler.
    const call = (ipcMain.handle as unknown as { mock: { calls: Array<[string, (...a: unknown[]) => unknown]> } }).mock.calls.find(
      (c) => c[0] === 'rag:index-transcript'
    )
    expect(call).toBeTruthy()
    const handler = call![1]

    // A malicious renderer tries to forge internal provenance.
    await handler({}, {
      transcript: 'hello world',
      metadata: {
        meetingId: 'm-1',
        recordingId: 'rec-excluded',
        timestamp: '2026-06-01',
        subject: 'S',
        captureId: 'forged-xyz',
        evil: 'nope'
      }
    })

    expect(indexTranscript).toHaveBeenCalledTimes(1)
    const passed = indexTranscript.mock.calls[0][1] as Record<string, unknown>
    // Only the whitelisted keys reach the vector store — captureId and any other
    // renderer key are dropped, so provenance cannot be forged at the boundary.
    expect(passed).toEqual({
      meetingId: 'm-1',
      recordingId: 'rec-excluded',
      timestamp: '2026-06-01',
      subject: 'S'
    })
    expect(passed).not.toHaveProperty('captureId')
    expect(passed).not.toHaveProperty('evil')
  })
})
