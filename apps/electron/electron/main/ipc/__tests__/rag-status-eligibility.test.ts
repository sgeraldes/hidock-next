/**
 * ADV44-1 (round-46) — rag:status COUNT + READY honesty.
 *
 * documentCount / meetingCount / ready must reflect the ELIGIBILITY-FILTERED
 * corpus, not the raw in-memory one. Soft-delete / value-exclude / personal
 * RETAIN their vector rows (retrieval filters them dynamically), so reading the
 * raw counts inflated the totals and could report `ready: true` when there are
 * ZERO eligible documents. This asserts the handler reads the *eligible* counts
 * and bases `ready` on them.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerRAGHandlers } from '../rag-handlers'
import { ipcMain } from 'electron'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  app: { getPath: vi.fn(() => 'test-path') }
}))

const vectorMock = {
  // Raw counts are deliberately HIGHER than the eligible ones, so a handler that
  // reads the raw values would visibly fail these assertions.
  getDocumentCount: vi.fn(() => 99),
  getMeetingCount: vi.fn(() => 42),
  getEligibleDocumentCount: vi.fn(() => 0),
  getEligibleMeetingCount: vi.fn(() => 0),
  search: vi.fn(),
  getAllDocuments: vi.fn(() => [])
}
vi.mock('../../services/vector-store', () => ({
  getVectorStore: vi.fn(() => vectorMock)
}))

const getStatusMock = vi.fn()
vi.mock('../../services/chat-llm', () => ({
  getChatLLMService: vi.fn(() => ({ getStatus: getStatusMock }))
}))

vi.mock('../../services/embeddings', () => ({
  getEmbeddingsService: vi.fn(() => ({
    activeProviderId: vi.fn(async () => 'gemini-api'),
  })),
}))

vi.mock('../../services/rag', () => ({
  getRAGService: vi.fn(() => ({ chat: vi.fn(), getStats: vi.fn(), globalSearch: vi.fn() }))
}))

vi.mock('../../services/database', () => ({
  getMeetingsForContact: vi.fn(() => []),
  getMeetingsForProject: vi.fn(() => [])
}))

const handlers: Record<string, (...args: any[]) => any> = {}

beforeEach(() => {
  vi.clearAllMocks()
  for (const k of Object.keys(handlers)) delete handlers[k]
  vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: (...args: any[]) => any) => {
    handlers[channel] = handler
    return undefined as never
  })
  registerRAGHandlers()
})

describe('rag:status eligibility-filtered counts', () => {
  it('reports the ELIGIBLE doc/meeting counts (not the raw corpus size)', async () => {
    getStatusMock.mockResolvedValue({ backend: 'gemini', ollamaAvailable: false })
    vectorMock.getEligibleDocumentCount.mockReturnValue(3)
    vectorMock.getEligibleMeetingCount.mockReturnValue(2)

    const res = await handlers['rag:status']()

    expect(res.success).toBe(true)
    expect(res.data.documentCount).toBe(3)
    expect(res.data.meetingCount).toBe(2)
    expect(res.data.ready).toBe(true)
    // provider partitions: the badge numbers come from the ACTIVE partition
    expect(res.data.embedProvider).toBe('gemini-api')
    expect(res.data.embedDocumentCount).toBe(3)
    // The raw counters must NOT have been used for the status numbers.
    expect(vectorMock.getDocumentCount).not.toHaveBeenCalled()
    expect(vectorMock.getMeetingCount).not.toHaveBeenCalled()
  })

  it('ready=false when a backend exists but ZERO documents are eligible', async () => {
    getStatusMock.mockResolvedValue({ backend: 'gemini', ollamaAvailable: false })
    // All docs excluded ⇒ eligible count 0 ⇒ NOT ready, even though raw is 99.
    vectorMock.getEligibleDocumentCount.mockReturnValue(0)
    vectorMock.getEligibleMeetingCount.mockReturnValue(0)

    const res = await handlers['rag:status']()

    expect(res.success).toBe(true)
    expect(res.data.documentCount).toBe(0)
    expect(res.data.ready).toBe(false)
  })

  it('ready=false when the eligibility lookup fails closed to 0 (backend present)', async () => {
    getStatusMock.mockResolvedValue({ backend: 'ollama', ollamaAvailable: true })
    // getEligibleDocumentCount already fails closed to 0 internally; the handler
    // must treat 0 as not-ready.
    vectorMock.getEligibleDocumentCount.mockReturnValue(0)
    vectorMock.getEligibleMeetingCount.mockReturnValue(0)

    const res = await handlers['rag:status']()

    expect(res.success).toBe(true)
    expect(res.data.ready).toBe(false)
  })
})
