
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

const { indexTranscript } = vi.hoisted(() => ({ indexTranscript: vi.fn(async (..._args: unknown[]) => 3) }))
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

  it('ADV12 — rag:index-transcript handler is NOT registered (renderer-controlled raw-transcript indexing removed)', () => {
    registerRAGHandlers()
    // The renderer-controlled raw-transcript indexing surface was removed
    // entirely in round 13: it let the renderer supply arbitrary transcript
    // content plus an arbitrary/optional recordingId, so excluded or foreign
    // content could ride an eligible id (or no id at all) into vector search /
    // RAG / LLM prompts. It had zero renderer callers — a dead, exploitable
    // surface. Assert no handler is registered for it, and that the vector
    // store's indexTranscript is never wired to an IPC boundary here.
    const calls = (ipcMain.handle as unknown as { mock: { calls: Array<[string, (...a: unknown[]) => unknown]> } }).mock.calls
    const registered = calls.find((c) => c[0] === 'rag:index-transcript')
    expect(registered).toBeUndefined()
    expect(indexTranscript).not.toHaveBeenCalled()
  })
})
