// @vitest-environment node

/**
 * assistant:setContext (2026-07-24) — REPLACE a conversation's pinned context
 * with a single capture. The "Ask about this source" flow used to ACCUMULATE
 * pins, so questions about a new recording carried the full pinned context of
 * every previously asked one. Asking from a source now means "about THIS
 * source"; deliberate multi-pin stays with assistant:addContext.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'

const dbPath = join(tmpdir(), `hidock-setcontext-${process.pid}.sqlite`)
vi.mock('../../services/file-storage', () => ({ getDatabasePath: () => dbPath }))

const handlers = new Map<string, (...args: any[]) => any>()
vi.mock('electron', () => ({
  app: { getPath: () => 'test-path' },
  ipcMain: { handle: (channel: string, fn: (...args: any[]) => any) => { handlers.set(channel, fn) } }
}))

import { initializeDatabase, closeDatabase, run, queryAll } from '../../services/database'
import { registerAssistantHandlers } from '../assistant-handlers'

function invoke(channel: string, ...args: any[]): Promise<any> {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`handler not registered: ${channel}`)
  return Promise.resolve(fn({} as any, ...args))
}

function pins(convId: string): string[] {
  return queryAll<{ knowledge_capture_id: string }>(
    'SELECT knowledge_capture_id FROM conversation_context WHERE conversation_id = ?',
    [convId]
  ).map((r) => r.knowledge_capture_id)
}

function seed(): void {
  run(`INSERT INTO conversations (id, title, created_at, updated_at) VALUES ('conv-1', 'Chat', '2026-01-01', '2026-01-01')`)
  for (const id of ['cap-a', 'cap-b', 'cap-c']) {
    run(
      `INSERT INTO knowledge_captures (id, title, captured_at, quality_rating) VALUES (?, ?, '2026-06-01', 'unrated')`,
      [id, `Capture ${id}`]
    )
  }
}

beforeEach(async () => {
  handlers.clear()
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
  await initializeDatabase()
  registerAssistantHandlers()
  seed()
})
afterEach(() => {
  closeDatabase()
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
})

describe('assistant:setContext', () => {
  it('REPLACES all existing pins with the single new capture', async () => {
    await invoke('assistant:addContext', 'conv-1', 'cap-a')
    await invoke('assistant:addContext', 'conv-1', 'cap-b')
    expect(pins('conv-1').sort()).toEqual(['cap-a', 'cap-b'])

    const res = await invoke('assistant:setContext', 'conv-1', 'cap-c')
    expect(res.success).toBe(true)
    expect(pins('conv-1')).toEqual(['cap-c'])
  })

  it('is idempotent (setting the same capture twice keeps exactly one pin)', async () => {
    await invoke('assistant:setContext', 'conv-1', 'cap-a')
    await invoke('assistant:setContext', 'conv-1', 'cap-a')
    expect(pins('conv-1')).toEqual(['cap-a'])
  })

  it('refuses an excluded capture WITHOUT clearing the existing pins', async () => {
    await invoke('assistant:setContext', 'conv-1', 'cap-a')
    run(`UPDATE knowledge_captures SET deleted_at = '2026-07-01T00:00:00Z' WHERE id = 'cap-b'`)
    const res = await invoke('assistant:setContext', 'conv-1', 'cap-b')
    expect(res.success).toBe(false)
    expect(pins('conv-1')).toEqual(['cap-a']) // untouched
  })

  it('returns an error for a missing conversation', async () => {
    const res = await invoke('assistant:setContext', 'no-such-conv', 'cap-a')
    expect(res.success).toBe(false)
  })
})
