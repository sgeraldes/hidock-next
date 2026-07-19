
/**
 * ADV22-1 (round-23) — the RAG chat IPC is CONTENT-FREE.
 *
 * The generated answer TEXT and its source excerpts must NEVER cross the renderer
 * boundary via rag:chat / rag:chat-legacy. Those handlers return ONLY a generationId
 * plus a non-content status; the sanitized answer is released through EXACTLY ONE
 * path — assistant:addMessage(generationId) — which revalidates provenance at persist.
 *
 * This asserts the IPC RETURN SHAPE of both chat handlers (success + provider-error +
 * validation-error). The service `RAGService.chat` still returns { answer, sources,
 * generationId } internally (for main's PendingGeneration); only the IPC boundary is
 * content-free.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerRAGHandlers } from '../rag-handlers'
import { ipcMain } from 'electron'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  app: { getPath: vi.fn(() => 'test-path') }
}))

// The FULL internal RAGResponse the service produces (answer + source excerpts). If any
// of this text/objects leaks through the IPC return, the content-free invariant is broken.
const RAW_ANSWER = 'The team agreed to migrate the database on Friday.'
const RAW_SOURCES = [
  { content: 'VERBATIM_TRANSCRIPT_EXCERPT about the migration', meetingId: 'mtg1', subject: 'Weekly Sync', score: 0.9 }
]

const chatMock = vi.fn()
vi.mock('../../services/rag', () => ({
  getRAGService: vi.fn(() => ({ chat: chatMock }))
}))

vi.mock('../../services/vector-store', () => ({
  getVectorStore: vi.fn(() => ({
    getDocumentCount: vi.fn(() => 0),
    getMeetingCount: vi.fn(() => 0),
    getEligibleDocumentCount: vi.fn(() => 0),
    getEligibleMeetingCount: vi.fn(() => 0),
    search: vi.fn(),
    getAllDocuments: vi.fn(() => [])
  }))
}))

vi.mock('../../services/chat-llm', () => ({
  getChatLLMService: vi.fn(() => ({ getStatus: vi.fn().mockResolvedValue({ backend: 'none' }) }))
}))

vi.mock('../../services/database', () => ({
  getMeetingsForContact: vi.fn(() => []),
  getMeetingsForProject: vi.fn(() => [])
}))

const handlers: Record<string, (...args: any[]) => any> = {}

function noRawContent(serialized: string): void {
  expect(serialized).not.toContain(RAW_ANSWER)
  expect(serialized).not.toContain('VERBATIM_TRANSCRIPT_EXCERPT')
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const k of Object.keys(handlers)) delete handlers[k]
  vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: (...args: any[]) => any) => {
    handlers[channel] = handler
    return undefined as never
  })
  registerRAGHandlers()
})

describe('rag:chat — content-free IPC return (ADV22-1)', () => {
  it('SUCCESS ⇒ returns ONLY generationId + status:ok (no answer, no sources)', async () => {
    chatMock.mockResolvedValueOnce({ answer: RAW_ANSWER, sources: RAW_SOURCES, generationId: 'gen-1' })
    const res = await handlers['rag:chat']({}, { sessionId: 'conv1', message: 'q' })

    expect(res.success).toBe(true)
    expect(res.data).toEqual({ generationId: 'gen-1', status: 'ok' })
    expect(res.data).not.toHaveProperty('answer')
    expect(res.data).not.toHaveProperty('sources')
    noRawContent(JSON.stringify(res))
  })

  it('PROVIDER FAILURE ⇒ generationId + status:error + non-content error string (still no answer/sources)', async () => {
    chatMock.mockResolvedValueOnce({
      answer: '',
      sources: [],
      error: 'Failed to generate a response with Ollama.',
      generationId: 'gen-err'
    })
    const res = await handlers['rag:chat']({}, { sessionId: 'conv1', message: 'q' })

    expect(res.success).toBe(true)
    expect(res.data.generationId).toBe('gen-err')
    expect(res.data.status).toBe('error')
    expect(res.data.error).toBe('Failed to generate a response with Ollama.')
    expect(res.data).not.toHaveProperty('answer')
    expect(res.data).not.toHaveProperty('sources')
  })

  it('VALIDATION ERROR (bad request) ⇒ Result error, chat never invoked', async () => {
    const res = await handlers['rag:chat']({}, { message: 'q' }) // no sessionId
    expect(res.success).toBe(false)
    expect(chatMock).not.toHaveBeenCalled()
  })
})

describe('rag:chat-legacy — content-free IPC return (ADV22-1)', () => {
  it('SUCCESS ⇒ returns ONLY { generationId } (no answer, no sources)', async () => {
    chatMock.mockResolvedValueOnce({ answer: RAW_ANSWER, sources: RAW_SOURCES, generationId: 'gen-2' })
    const res = await handlers['rag:chat-legacy']({}, { sessionId: 'conv1', message: 'q' })

    expect(res).toEqual({ generationId: 'gen-2', error: undefined })
    expect(res).not.toHaveProperty('answer')
    expect(res).not.toHaveProperty('sources')
    noRawContent(JSON.stringify(res))
  })

  it('PROVIDER FAILURE ⇒ generationId + non-content error (still no answer/sources)', async () => {
    chatMock.mockResolvedValueOnce({
      answer: '',
      sources: [],
      error: 'Failed to generate a response with Ollama.',
      generationId: 'gen-err2'
    })
    const res = await handlers['rag:chat-legacy']({}, { sessionId: 'conv1', message: 'q' })

    expect(res.generationId).toBe('gen-err2')
    expect(res.error).toBe('Failed to generate a response with Ollama.')
    expect(res).not.toHaveProperty('answer')
    expect(res).not.toHaveProperty('sources')
  })
})
