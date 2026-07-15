// @vitest-environment node

/**
 * ADV18 (round-19) — end-to-end, real-temp-DB coverage of the persisted
 * RAG-answer replay gate on assistant:getMessages AND the legacy
 * db:get-chat-history sibling (both read the same chat_messages table).
 *
 * Seeds a recording linked to a meeting, persists an assistant message whose
 * AUTHORITATIVE provenance union (supplied by the mocked RAG service, exactly as
 * the real service would compute it main-side) names that recording, then
 * transitions the recording through each exclusion state and asserts the WHOLE
 * answer is redacted (round-19 redact-on-ANY) and the chips dropped.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'

const dbPath = join(tmpdir(), `hidock-adv18-assistant-${process.pid}.sqlite`)

vi.mock('../../services/file-storage', () => ({
  getDatabasePath: () => dbPath
}))

// The RAG service is used by deleteConversation (clearSession) AND, in round-20,
// by assistant:addMessage to resolve the MAIN-ISSUED envelope kind + provenance for
// an assistant answer. `ragDecision` is what the real resolveAssistantProvenance
// would return; tests flip it to exercise kind:'rag' (grounded), kind:'non-rag'
// (genuine emit), and the forge-ignored fail-closed case. The renderer never
// supplies the decision — main derives it from pipeline state.
const ragMock = vi.hoisted(() => ({
  decision: { kind: 'rag', prov: { recordingIds: ['recR'], captureIds: [], unverifiable: false } } as
    | { kind: 'rag'; prov: { recordingIds: string[]; captureIds: string[]; unverifiable: boolean } }
    | { kind: 'non-rag' }
}))
vi.mock('../../services/rag', () => ({
  getRAGService: () => ({
    clearSession: vi.fn(),
    resolveAssistantProvenance: () => ragMock.decision
  })
}))

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  app: { getPath: vi.fn(() => tmpdir()) }
}))

import { ipcMain } from 'electron'
import { initializeDatabase, closeDatabase, run } from '../../services/database'
import { registerAssistantHandlers } from '../assistant-handlers'
import { registerDatabaseHandlers } from '../database-handlers'

const handlers: Record<string, Function> = {}

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

async function addAssistantMessageCitingMeeting(): Promise<void> {
  const sources = JSON.stringify([{ content: 'a verbatim transcript excerpt', meetingId: 'mtg1', subject: 'Weekly Sync' }])
  await handlers['assistant:addMessage']({}, 'conv1', 'assistant', 'The team agreed to migrate on Friday.', sources)
}

beforeEach(async () => {
  vi.clearAllMocks()
  ragMock.decision = { kind: 'rag', prov: { recordingIds: ['recR'], captureIds: [], unverifiable: false } }
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

describe('assistant:addMessage — ADV19-1 main-issued envelope kinds', () => {
  it('a genuine kind:non-rag assistant message is PRESERVED on read', async () => {
    ragMock.decision = { kind: 'non-rag' }
    await handlers['assistant:addMessage']({}, 'conv1', 'assistant', 'No relevant meetings found.')
    // Even after excluding every recording, a non-rag message grounds on nothing.
    run('UPDATE recordings SET deleted_at = ? WHERE id = ?', ['2026-07-15T00:00:00.000Z', 'recR'])
    const msgs = await handlers['assistant:getMessages']({}, 'conv1')
    const assistant = msgs.find((m: { role: string }) => m.role === 'assistant')
    expect(assistant.content).toBe('No relevant meetings found.')
    expect(JSON.parse(assistant.sources)).toEqual([])
  })

  it('FORGE — grounded content persisted without its generationId ⇒ main stamps rag/unverifiable ⇒ redacted', async () => {
    // The real resolveAssistantProvenance returns a fail-closed unverifiable rag
    // decision when a grounded generation is outstanding but no id is supplied —
    // simulate that decision and assert the persisted answer is redacted on read
    // (the renderer's forged "trusted" intent is ignored; the main envelope wins).
    ragMock.decision = { kind: 'rag', prov: { recordingIds: [], captureIds: [], unverifiable: true } }
    const sources = JSON.stringify([{ content: 'smuggled excerpt', meetingId: 'mtg1' }])
    await handlers['assistant:addMessage']({}, 'conv1', 'assistant', 'Grounded content the renderer tried to keep.', sources)
    const msgs = await handlers['assistant:getMessages']({}, 'conv1')
    const assistant = msgs.find((m: { role: string }) => m.role === 'assistant')
    expect(assistant.content).not.toContain('Grounded content')
    expect(JSON.parse(assistant.sources)).toEqual([])
  })

  it('a null-sources assistant message with a kind:rag decision persists an envelope (redactable), not raw null', async () => {
    // kind:rag with a verifiable, eligible union ⇒ preserved while eligible…
    await handlers['assistant:addMessage']({}, 'conv1', 'assistant', 'Grounded answer.')
    let msgs = await handlers['assistant:getMessages']({}, 'conv1')
    let assistant = msgs.find((m: { role: string }) => m.role === 'assistant')
    expect(assistant.content).toBe('Grounded answer.')
    // …and redacted once its recording is excluded (proves an envelope was stamped
    // even though the renderer passed no sources).
    run('UPDATE recordings SET personal = 1 WHERE id = ?', ['recR'])
    msgs = await handlers['assistant:getMessages']({}, 'conv1')
    assistant = msgs.find((m: { role: string }) => m.role === 'assistant')
    expect(assistant.content).not.toBe('Grounded answer.')
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
