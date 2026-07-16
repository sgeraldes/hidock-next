// @vitest-environment node

/**
 * ADV39-MED (round-41) — assistant:getContext readback must be FAIL-CLOSED.
 *
 * Round-40 made assistant:addContext REFUSE to pin an already-excluded capture, but
 * a capture pinned while eligible can LATER become personal / soft-deleted /
 * value-excluded / hard-purged. The readback previously returned the raw pinned
 * capture ids with NO revalidation, so an excluded pin kept appearing in the
 * displayed context list AND inflated the displayed context count (display-honesty
 * leak; RAG already revalidates before the LLM — no model leak).
 *
 * FIX: filter the returned pinned capture ids through the shared fail-closed
 * eligibility source (filterEligibleCaptureIds). Filter-on-read (non-destructive):
 * the conversation_context row is preserved, so restoring the recording brings the
 * pin back. On any lookup error the eligible set is empty ⇒ every recording-backed
 * pin drops (fail-closed).
 *
 * REAL temp DB, real database.ts (better-sqlite3), real handler end to end.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'
import { randomUUID } from 'crypto'

const dbPath = join(tmpdir(), `hidock-r41-getcontext-${process.pid}.sqlite`)
vi.mock('../../services/file-storage', () => ({ getDatabasePath: () => dbPath }))

const handlers = new Map<string, (...args: any[]) => any>()
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: (...args: any[]) => any) => { handlers.set(channel, fn) } },
  app: { getPath: vi.fn(() => tmpdir()) },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: vi.fn(), decryptString: vi.fn() }
}))

import { initializeDatabase, closeDatabase, run } from '../../services/database'
import { registerAssistantHandlers } from '../assistant-handlers'

function invoke(channel: string, ...args: any[]): Promise<any> {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`handler not registered: ${channel}`)
  return Promise.resolve(fn({} as any, ...args))
}

// --- seed helpers -----------------------------------------------------------

function seedConversation(id: string): void {
  run(
    `INSERT INTO conversations (id, title, created_at, updated_at)
     VALUES (?, 'Conv', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
    [id]
  )
}
function seedRecording(id: string, opts: { personal?: boolean; deleted?: boolean } = {}): void {
  run(
    `INSERT INTO recordings (id, filename, date_recorded, personal, deleted_at) VALUES (?, ?, '2026-01-02T10:00:00Z', ?, ?)`,
    [id, `${id}.hda`, opts.personal ? 1 : 0, opts.deleted ? '2026-07-01T00:00:00Z' : null]
  )
}
function seedCapture(
  id: string,
  opts: { recId?: string | null; quality?: string; deleted?: boolean } = {}
): void {
  run(
    `INSERT INTO knowledge_captures (id, title, captured_at, source_recording_id, quality_rating, deleted_at)
     VALUES (?, 'Cap', '2026-06-01', ?, ?, ?)`,
    [id, opts.recId ?? null, opts.quality ?? 'unrated', opts.deleted ? '2026-07-01T00:00:00Z' : null]
  )
}
function pin(convId: string, captureId: string): void {
  run(
    'INSERT OR IGNORE INTO conversation_context (id, conversation_id, knowledge_capture_id) VALUES (?, ?, ?)',
    [randomUUID(), convId, captureId]
  )
}

beforeEach(async () => {
  handlers.clear()
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
  await initializeDatabase()
  registerAssistantHandlers()
})
afterEach(() => {
  closeDatabase()
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
})

describe('assistant:getContext — readback fail-closed', () => {
  it('eligible pinned capture ⇒ returned; count reflects only eligible', async () => {
    const conv = randomUUID(), rec = randomUUID(), cap = randomUUID()
    seedConversation(conv)
    seedRecording(rec)
    seedCapture(cap, { recId: rec, quality: 'valuable' })
    pin(conv, cap)

    const ids = await invoke('assistant:getContext', conv)
    expect(ids).toEqual([cap])
  })

  it('pin eligible → mark source recording PERSONAL ⇒ dropped from readback + count', async () => {
    const conv = randomUUID(), rec = randomUUID(), cap = randomUUID()
    seedConversation(conv)
    seedRecording(rec)
    seedCapture(cap, { recId: rec, quality: 'valuable' })
    pin(conv, cap)
    expect(await invoke('assistant:getContext', conv)).toEqual([cap])

    // Exclude AFTER pinning.
    run('UPDATE recordings SET personal = 1 WHERE id = ?', [rec])
    const ids = await invoke('assistant:getContext', conv)
    expect(ids).toEqual([])
  })

  it('pin eligible → SOFT-DELETE source recording ⇒ dropped', async () => {
    const conv = randomUUID(), rec = randomUUID(), cap = randomUUID()
    seedConversation(conv)
    seedRecording(rec)
    seedCapture(cap, { recId: rec, quality: 'valuable' })
    pin(conv, cap)
    expect(await invoke('assistant:getContext', conv)).toEqual([cap])

    run('UPDATE recordings SET deleted_at = ? WHERE id = ?', ['2026-07-02T00:00:00Z', rec])
    expect(await invoke('assistant:getContext', conv)).toEqual([])
  })

  it('pin eligible → VALUE-EXCLUDE the standalone capture ⇒ dropped', async () => {
    const conv = randomUUID(), cap = randomUUID()
    seedConversation(conv)
    seedCapture(cap, { recId: null, quality: 'valuable' })
    pin(conv, cap)
    expect(await invoke('assistant:getContext', conv)).toEqual([cap])

    run("UPDATE knowledge_captures SET quality_rating = 'low-value' WHERE id = ?", [cap])
    expect(await invoke('assistant:getContext', conv)).toEqual([])
  })

  it('restore (filter-on-read) ⇒ pin returns again once eligible', async () => {
    const conv = randomUUID(), rec = randomUUID(), cap = randomUUID()
    seedConversation(conv)
    seedRecording(rec, { deleted: true })
    seedCapture(cap, { recId: rec, quality: 'valuable' })
    pin(conv, cap)
    // Excluded while deleted.
    expect(await invoke('assistant:getContext', conv)).toEqual([])

    // The conversation_context row is preserved (non-destructive) → restoring the
    // recording brings the pin back.
    run('UPDATE recordings SET deleted_at = NULL WHERE id = ?', [rec])
    expect(await invoke('assistant:getContext', conv)).toEqual([cap])
  })

  it('mixed pins ⇒ only the eligible ids survive; count drops', async () => {
    const conv = randomUUID()
    seedConversation(conv)
    const recOk = randomUUID(), capOk = randomUUID()
    seedRecording(recOk)
    seedCapture(capOk, { recId: recOk, quality: 'valuable' })
    const recBad = randomUUID(), capBad = randomUUID()
    seedRecording(recBad, { personal: true })
    seedCapture(capBad, { recId: recBad, quality: 'valuable' })
    pin(conv, capOk)
    pin(conv, capBad)

    const ids = await invoke('assistant:getContext', conv)
    expect(ids).toEqual([capOk])
  })

  it('eligibility lookup FAILURE ⇒ fail-closed: every recording-backed pin drops', async () => {
    const conv = randomUUID(), rec = randomUUID(), cap = randomUUID()
    seedConversation(conv)
    seedRecording(rec)
    seedCapture(cap, { recId: rec, quality: 'valuable' })
    pin(conv, cap)
    expect(await invoke('assistant:getContext', conv)).toEqual([cap])

    // Break the capture-eligibility lookup so filterEligibleCaptureIds fails closed.
    run('DROP TABLE knowledge_captures')
    const ids = await invoke('assistant:getContext', conv)
    expect(ids).toEqual([])
  })

  it('empty context ⇒ empty array (no eligibility query needed)', async () => {
    const conv = randomUUID()
    seedConversation(conv)
    expect(await invoke('assistant:getContext', conv)).toEqual([])
  })
})
