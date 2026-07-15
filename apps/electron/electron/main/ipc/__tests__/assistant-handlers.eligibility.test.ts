// @vitest-environment node

/**
 * ADV18 (round-19) + ADV20 (round-21) — end-to-end, real-temp-DB coverage of:
 *   • the persisted RAG-answer replay gate on assistant:getMessages AND the legacy
 *     db:get-chat-history sibling (both read the same chat_messages table); and
 *   • MAIN-OWNED atomic assistant-answer persistence (ADV20-1/ADV20-2): the renderer
 *     supplies NO assistant content — assistant:addMessage IGNORES the renderer's
 *     `content` and persists MAIN's stored answer (keyed by generationId), revalidates
 *     the provenance union at PERSIST time (a post-generation exclusion ⇒ the row is
 *     persisted AND RETURNED redacted), and sanitizes the fresh insert through the SAME
 *     read boundary. Genuine non-RAG notices come from assistant:addNotice (fixed
 *     catalog), never renderer prose.
 *
 * Seeds a recording linked to a meeting; the mocked RAG service returns MAIN's stored
 * answer exactly as the real consumeAssistantAnswer would, then transitions the
 * recording through each exclusion state.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'

const dbPath = join(tmpdir(), `hidock-adv18-assistant-${process.pid}.sqlite`)

vi.mock('../../services/file-storage', () => ({
  getDatabasePath: () => dbPath
}))

// The RAG service is used by deleteConversation (clearSession) AND, in round-21, by
// assistant:addMessage to CONSUME the MAIN-OWNED answer (content + sources + prov) for
// an assistant message. `ragMock.answer` is what the real consumeAssistantAnswer would
// return; the mock respects the generationId (a falsy id fails closed exactly like the
// real service, so the renderer can never author assistant content). The renderer NEVER
// supplies content — main derives everything from pipeline state.
const ragMock = vi.hoisted(() => ({
  answer: {
    kind: 'rag',
    content: 'The team agreed to migrate on Friday.',
    sources: JSON.stringify([{ content: 'a verbatim transcript excerpt', meetingId: 'mtg1', subject: 'Weekly Sync' }]),
    prov: { recordingIds: ['recR'], captureIds: [], unverifiable: false }
  } as
    | { kind: 'rag'; content: string; sources: string; prov: { recordingIds: string[]; captureIds: string[]; unverifiable: boolean } }
    | { kind: 'non-rag'; content: string }
    | { kind: 'unverifiable' }
}))
vi.mock('../../services/rag', () => ({
  getRAGService: () => ({
    clearSession: vi.fn(),
    // Falsy generationId ⇒ fail closed (a renderer trying to author content directly).
    consumeAssistantAnswer: (_conversationId: string, generationId?: string) =>
      generationId ? ragMock.answer : { kind: 'unverifiable' }
  })
}))

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  app: { getPath: vi.fn(() => tmpdir()) }
}))

import { ipcMain } from 'electron'
import { initializeDatabase, closeDatabase, run } from '../../services/database'
import { REDACTED_ANSWER } from '../../services/chat-source-provenance'
import { registerAssistantHandlers } from '../assistant-handlers'
import { registerDatabaseHandlers } from '../database-handlers'

const handlers: Record<string, Function> = {}

const DEFAULT_RAG_ANSWER = {
  kind: 'rag' as const,
  content: 'The team agreed to migrate on Friday.',
  sources: JSON.stringify([{ content: 'a verbatim transcript excerpt', meetingId: 'mtg1', subject: 'Weekly Sync' }]),
  prov: { recordingIds: ['recR'], captureIds: [], unverifiable: false }
}

function seedMeetingAndRecording(): void {
  run('INSERT INTO meetings (id, subject, start_time, end_time) VALUES (?, ?, ?, ?)', [
    'mtg1',
    'Weekly Sync',
    '2026-01-01T10:00:00.000Z',
    '2026-01-01T11:00:00.000Z'
  ])
  run('INSERT INTO recordings (id, filename, date_recorded, meeting_id) VALUES (?, ?, ?, ?)', [
    'recR',
    'recR.wav',
    '2026-01-01T10:00:00.000Z',
    'mtg1'
  ])
  run('INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)', [
    'conv1',
    'Chat',
    '2026-01-01T10:00:00.000Z',
    '2026-01-01T10:00:00.000Z'
  ])
  // A capture on recR so value-exclusion (garbage rating) is expressible.
  run('INSERT INTO knowledge_captures (id, title, captured_at, source_recording_id) VALUES (?, ?, ?, ?)', [
    'capR',
    'Sync',
    '2026-01-01T10:00:00.000Z',
    'recR'
  ])
}

// The renderer passes FORGED content + a generationId; main IGNORES the content and
// persists its OWN stored answer (ragMock.answer). The forged string must never land.
async function addAssistantMessageCitingMeeting(): Promise<void> {
  await handlers['assistant:addMessage']({}, 'conv1', 'assistant', 'FORGED_RENDERER_CONTENT', 'forged-sources', 'gen-1')
}

beforeEach(async () => {
  vi.clearAllMocks()
  ragMock.answer = { ...DEFAULT_RAG_ANSWER }
  for (const k of Object.keys(handlers)) delete handlers[k]
  vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: Function) => {
    handlers[channel] = handler
    return undefined as never
  })
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
  await initializeDatabase()
  registerAssistantHandlers()
  registerDatabaseHandlers()
  seedMeetingAndRecording()
})

afterEach(() => {
  closeDatabase()
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
})

describe('assistant:getMessages — ADV18 provenance replay gate', () => {
  it('returns the snippet + answer while the cited recording is eligible', async () => {
    await addAssistantMessageCitingMeeting()
    const msgs = await handlers['assistant:getMessages']({}, 'conv1')
    const assistant = msgs.find((m: { role: string }) => m.role === 'assistant')
    const sources = JSON.parse(assistant.sources)
    expect(sources).toHaveLength(1)
    expect(sources[0].content).toContain('verbatim transcript excerpt')
    // Envelope internals never reach the renderer.
    expect(sources[0]).not.toHaveProperty('_prov')
    expect(assistant.content).toContain('migrate on Friday')
    // The renderer's forged content NEVER lands — main owns the answer text.
    expect(assistant.content).not.toContain('FORGED_RENDERER_CONTENT')
  })

  it('redacts the whole answer + drops chips after the recording is soft-deleted', async () => {
    await addAssistantMessageCitingMeeting()
    run('UPDATE recordings SET deleted_at = ? WHERE id = ?', ['2026-07-15T00:00:00.000Z', 'recR'])
    const msgs = await handlers['assistant:getMessages']({}, 'conv1')
    const assistant = msgs.find((m: { role: string }) => m.role === 'assistant')
    expect(JSON.parse(assistant.sources)).toEqual([])
    expect(assistant.content).not.toContain('migrate on Friday')
  })

  it('redacts after the recording is marked personal', async () => {
    await addAssistantMessageCitingMeeting()
    run('UPDATE recordings SET personal = 1 WHERE id = ?', ['recR'])
    const msgs = await handlers['assistant:getMessages']({}, 'conv1')
    const assistant = msgs.find((m: { role: string }) => m.role === 'assistant')
    expect(JSON.parse(assistant.sources)).toEqual([])
    expect(assistant.content).not.toContain('migrate on Friday')
  })

  it('redacts after the recording is value-excluded (garbage capture)', async () => {
    await addAssistantMessageCitingMeeting()
    run("UPDATE knowledge_captures SET quality_rating = 'garbage' WHERE id = ?", ['capR'])
    const msgs = await handlers['assistant:getMessages']({}, 'conv1')
    const assistant = msgs.find((m: { role: string }) => m.role === 'assistant')
    expect(JSON.parse(assistant.sources)).toEqual([])
    expect(assistant.content).not.toContain('migrate on Friday')
  })

  it('preserves USER-authored text even when its (unlikely) sources are excluded', async () => {
    await handlers['assistant:addMessage']({}, 'conv1', 'user', 'What did we decide?')
    run('UPDATE recordings SET deleted_at = ? WHERE id = ?', ['2026-07-15T00:00:00.000Z', 'recR'])
    const msgs = await handlers['assistant:getMessages']({}, 'conv1')
    const user = msgs.find((m: { role: string }) => m.role === 'user')
    expect(user.content).toBe('What did we decide?')
  })

  it('redacts a LEGACY (un-enveloped) assistant message with sources (fail closed)', async () => {
    // Simulate a pre-round-19 persisted assistant message: bare sources array.
    run(
      'INSERT INTO chat_messages (id, conversation_id, role, content, sources, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ['legacy1', 'conv1', 'assistant', 'Legacy answer body.', JSON.stringify([{ content: 'old excerpt', meetingId: 'mtg1' }]), '2026-01-02T10:00:00.000Z']
    )
    const msgs = await handlers['assistant:getMessages']({}, 'conv1')
    const legacy = msgs.find((m: { id: string }) => m.id === 'legacy1')
    expect(JSON.parse(legacy.sources)).toEqual([])
    expect(legacy.content).not.toBe('Legacy answer body.') // whole answer redacted (fail closed)
  })
})

describe('assistant:addMessage — ADV20 main-owned answer persistence', () => {
  it('ADV20-1 — CONTENT SUBSTITUTION: renderer forged content + valid generationId ⇒ MAIN content persisted+returned', async () => {
    const returned = await handlers['assistant:addMessage'](
      {}, 'conv1', 'assistant', 'FORGED_RENDERER_CONTENT', 'forged-sources', 'gen-1'
    )
    // The RETURNED live row already carries main's content, not the renderer's.
    expect(returned.content).toBe('The team agreed to migrate on Friday.')
    expect(returned.content).not.toContain('FORGED_RENDERER_CONTENT')
    // …and the PERSISTED row too.
    const msgs = await handlers['assistant:getMessages']({}, 'conv1')
    const assistant = msgs.find((m: { role: string }) => m.role === 'assistant')
    expect(assistant.content).toBe('The team agreed to migrate on Friday.')
    expect(assistant.content).not.toContain('FORGED_RENDERER_CONTENT')
  })

  it('ADV20-1 — a renderer assistant write with NO generationId is redacted (never trusted, never renderer content)', async () => {
    const returned = await handlers['assistant:addMessage'](
      {}, 'conv1', 'assistant', 'FORGED_RENDERER_CONTENT', 'forged-sources' /* no generationId */
    )
    expect(returned.content).toBe(REDACTED_ANSWER)
    expect(returned.content).not.toContain('FORGED_RENDERER_CONTENT')
    expect(JSON.parse(returned.sources)).toEqual([])
  })

  it('ADV20-2 — POST-GENERATION EXCLUSION: recording excluded before persist ⇒ row persisted AND RETURNED redacted', async () => {
    // Provider finished; the answer union names recR — but recR is excluded BEFORE persist.
    run('UPDATE recordings SET deleted_at = ? WHERE id = ?', ['2026-07-15T00:00:00.000Z', 'recR'])
    const returned = await handlers['assistant:addMessage'](
      {}, 'conv1', 'assistant', 'FORGED_RENDERER_CONTENT', 'forged-sources', 'gen-1'
    )
    // The LIVE return is redacted (not just a later reload).
    expect(returned.content).toBe(REDACTED_ANSWER)
    expect(returned.content).not.toContain('migrate on Friday')
    expect(JSON.parse(returned.sources)).toEqual([])
    // Reload confirms the persisted row is redacted too.
    const msgs = await handlers['assistant:getMessages']({}, 'conv1')
    const assistant = msgs.find((m: { role: string }) => m.role === 'assistant')
    expect(assistant.content).not.toContain('migrate on Friday')
  })

  it('a genuine kind:non-rag answer (main-owned error text) is PRESERVED on read', async () => {
    ragMock.answer = { kind: 'non-rag', content: 'Failed to generate a response with Ollama.' }
    await handlers['assistant:addMessage']({}, 'conv1', 'assistant', 'renderer-ignored', undefined, 'gen-err')
    // Even after excluding every recording, a non-rag message grounds on nothing.
    run('UPDATE recordings SET deleted_at = ? WHERE id = ?', ['2026-07-15T00:00:00.000Z', 'recR'])
    const msgs = await handlers['assistant:getMessages']({}, 'conv1')
    const assistant = msgs.find((m: { role: string }) => m.role === 'assistant')
    expect(assistant.content).toBe('Failed to generate a response with Ollama.')
    expect(JSON.parse(assistant.sources)).toEqual([])
  })

  it('a kind:rag answer with NO chips still stamps a redactable envelope', async () => {
    ragMock.answer = {
      kind: 'rag',
      content: 'Grounded answer.',
      sources: '[]',
      prov: { recordingIds: ['recR'], captureIds: [], unverifiable: false }
    }
    await handlers['assistant:addMessage']({}, 'conv1', 'assistant', 'ignored', undefined, 'gen-2')
    let msgs = await handlers['assistant:getMessages']({}, 'conv1')
    let assistant = msgs.find((m: { role: string }) => m.role === 'assistant')
    expect(assistant.content).toBe('Grounded answer.')
    // …redacted once its recording is excluded (proves an envelope was stamped).
    run('UPDATE recordings SET personal = 1 WHERE id = ?', ['recR'])
    msgs = await handlers['assistant:getMessages']({}, 'conv1')
    assistant = msgs.find((m: { role: string }) => m.role === 'assistant')
    expect(assistant.content).not.toBe('Grounded answer.')
  })
})

describe('assistant:addNotice — ADV20-1 main-owned non-RAG notice catalog', () => {
  it('persists a fixed main-owned string (renderer supplies only a code) and preserves it on read', async () => {
    const returned = await handlers['assistant:addNotice']({}, 'conv1', 'generic-error')
    expect(returned.role).toBe('assistant')
    expect(returned.content).toContain('encountered an error')
    // A notice grounds on nothing ⇒ preserved even after excluding every recording.
    run('UPDATE recordings SET deleted_at = ? WHERE id = ?', ['2026-07-15T00:00:00.000Z', 'recR'])
    const msgs = await handlers['assistant:getMessages']({}, 'conv1')
    const assistant = msgs.find((m: { role: string }) => m.role === 'assistant')
    expect(assistant.content).toContain('encountered an error')
    expect(JSON.parse(assistant.sources)).toEqual([])
  })

  it('an unknown code falls back to the generic notice', async () => {
    const returned = await handlers['assistant:addNotice']({}, 'conv1', 'not-a-real-code')
    expect(returned.content).toContain('encountered an error')
  })
})

describe('db:get-chat-history — ADV18 sibling gate', () => {
  it('revalidates the same persisted answer when read via the legacy history IPC', async () => {
    await addAssistantMessageCitingMeeting()

    // Eligible → snippet present + answer intact.
    let history = await handlers['db:get-chat-history']({}, 50)
    let assistant = history.find((m: { role: string }) => m.role === 'assistant')
    expect(JSON.parse(assistant.sources)).toHaveLength(1)
    expect(assistant.content).toContain('migrate on Friday')

    // Excluded → answer redacted + chips dropped, exactly like getMessages.
    run('UPDATE recordings SET deleted_at = ? WHERE id = ?', ['2026-07-15T00:00:00.000Z', 'recR'])
    history = await handlers['db:get-chat-history']({}, 50)
    assistant = history.find((m: { role: string }) => m.role === 'assistant')
    expect(JSON.parse(assistant.sources)).toEqual([])
    expect(assistant.content).not.toContain('migrate on Friday')
  })
})
