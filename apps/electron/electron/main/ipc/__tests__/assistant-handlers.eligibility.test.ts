// @vitest-environment node

/**
 * ADV17-2 (round-18) — end-to-end, real-temp-DB coverage of the persisted
 * RAG-answer replay gate on assistant:getMessages AND the legacy
 * db:get-chat-history sibling (both read the same chat_messages table).
 *
 * Seeds a recording linked to a meeting, persists an assistant message citing
 * that meeting, then transitions the recording through each exclusion state and
 * asserts the persisted snippet is dropped (and the answer redacted when it was
 * grounded solely on the now-excluded source).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'

const dbPath = join(tmpdir(), `hidock-adv17-assistant-${process.pid}.sqlite`)

vi.mock('../../services/file-storage', () => ({
  getDatabasePath: () => dbPath
}))

// The RAG service is only used by deleteConversation; stub it so importing the
// handler module doesn't pull the whole embeddings/vector stack.
vi.mock('../../services/rag', () => ({
  getRAGService: () => ({ clearSession: vi.fn() })
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

describe('assistant:getMessages — ADV17-2 provenance replay gate', () => {
  it('returns the snippet while the cited recording is eligible', async () => {
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

  it('drops the snippet and redacts the answer after the recording is soft-deleted', async () => {
    await addAssistantMessageCitingMeeting()
    run('UPDATE recordings SET deleted_at = ? WHERE id = ?', ['2026-07-15T00:00:00.000Z', 'recR'])
    const msgs = await handlers['assistant:getMessages']({}, 'conv1')
    const assistant = msgs.find((m: { role: string }) => m.role === 'assistant')
    expect(JSON.parse(assistant.sources)).toEqual([])
    expect(assistant.content).not.toContain('migrate on Friday')
  })

  it('drops the snippet after the recording is marked personal', async () => {
    await addAssistantMessageCitingMeeting()
    run('UPDATE recordings SET personal = 1 WHERE id = ?', ['recR'])
    const msgs = await handlers['assistant:getMessages']({}, 'conv1')
    const assistant = msgs.find((m: { role: string }) => m.role === 'assistant')
    expect(JSON.parse(assistant.sources)).toEqual([])
  })

  it('drops the snippet after the recording is value-excluded (garbage capture)', async () => {
    await addAssistantMessageCitingMeeting()
    run("UPDATE knowledge_captures SET quality_rating = 'garbage' WHERE id = ?", ['capR'])
    const msgs = await handlers['assistant:getMessages']({}, 'conv1')
    const assistant = msgs.find((m: { role: string }) => m.role === 'assistant')
    expect(JSON.parse(assistant.sources)).toEqual([])
  })

  it('redacts snippets of a LEGACY (un-enveloped) message but keeps its text', async () => {
    // Simulate a pre-round-18 persisted assistant message: bare sources array.
    run(
      'INSERT INTO chat_messages (id, conversation_id, role, content, sources, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ['legacy1', 'conv1', 'assistant', 'Legacy answer body.', JSON.stringify([{ content: 'old excerpt', meetingId: 'mtg1' }]), '2026-01-02T10:00:00.000Z']
    )
    const msgs = await handlers['assistant:getMessages']({}, 'conv1')
    const legacy = msgs.find((m: { id: string }) => m.id === 'legacy1')
    expect(JSON.parse(legacy.sources)).toEqual([])
    expect(legacy.content).toBe('Legacy answer body.') // message text preserved
  })
})

describe('db:get-chat-history — ADV17-2 sibling gate', () => {
  it('revalidates the same persisted sources when read via the legacy history IPC', async () => {
    await addAssistantMessageCitingMeeting()

    // Eligible → snippet present.
    let history = await handlers['db:get-chat-history']({}, 50)
    let assistant = history.find((m: { role: string }) => m.role === 'assistant')
    expect(JSON.parse(assistant.sources)).toHaveLength(1)

    // Excluded → snippet dropped + answer redacted, exactly like getMessages.
    run('UPDATE recordings SET deleted_at = ? WHERE id = ?', ['2026-07-15T00:00:00.000Z', 'recR'])
    history = await handlers['db:get-chat-history']({}, 50)
    assistant = history.find((m: { role: string }) => m.role === 'assistant')
    expect(JSON.parse(assistant.sources)).toEqual([])
    expect(assistant.content).not.toContain('migrate on Friday')
  })
})
