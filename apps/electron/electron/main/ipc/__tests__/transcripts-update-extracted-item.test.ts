// @vitest-environment node

/**
 * transcripts:updateExtractedItem (2026-07-22) — index-addressed edit of the
 * transcript's extracted action_items / key_points JSON arrays, backing the
 * reader event-list edit for transcript-derived markers (`txa_<i>` / `txk_<i>`).
 *
 * Covers: element replacement, bounds/validation, eligibility gating (an
 * excluded recording's extracted text is neither read nor mutated).
 * REAL temp DB, real database.ts, real handler end to end.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'

const dbPath = join(tmpdir(), `hidock-txitem-${process.pid}.sqlite`)
vi.mock('../../services/file-storage', () => ({ getDatabasePath: () => dbPath }))

const handlers = new Map<string, (...args: any[]) => any>()
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: (...args: any[]) => any) => { handlers.set(channel, fn) } }
}))

import { initializeDatabase, closeDatabase, run, queryOne } from '../../services/database'
import { registerTranscriptsHandlers } from '../transcripts-handlers'

function invoke(channel: string, ...args: any[]): Promise<any> {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`handler not registered: ${channel}`)
  return Promise.resolve(fn({} as any, ...args))
}

function seed(recordingId: string, opts: { personal?: boolean } = {}): void {
  run(
    `INSERT INTO recordings (id, filename, date_recorded, personal) VALUES (?, ?, '2026-01-02T10:00:00Z', ?)`,
    [recordingId, `${recordingId}.hda`, opts.personal ? 1 : 0]
  )
  run(
    `INSERT INTO transcripts (id, recording_id, full_text, action_items, key_points)
     VALUES (?, ?, 'text', ?, ?)`,
    [
      `trans_${recordingId}`,
      recordingId,
      JSON.stringify(['first action', 'second action']),
      JSON.stringify(['first key point'])
    ]
  )
}

beforeEach(async () => {
  handlers.clear()
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
  await initializeDatabase()
  registerTranscriptsHandlers()
})
afterEach(() => {
  closeDatabase()
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
})

describe('transcripts:updateExtractedItem', () => {
  it('replaces the indexed action item and persists', async () => {
    seed('rec-1')
    const res = await invoke('transcripts:updateExtractedItem', {
      recordingId: 'rec-1', kind: 'action', index: 1, content: 'corrected second action'
    })
    expect(res.success).toBe(true)
    expect(res.data).toEqual({ kind: 'action', index: 1, content: 'corrected second action' })
    const row = queryOne<{ v: string }>('SELECT action_items AS v FROM transcripts WHERE recording_id = ?', ['rec-1'])
    expect(JSON.parse(row!.v)).toEqual(['first action', 'corrected second action'])
  })

  it('replaces a key_points (decision) element', async () => {
    seed('rec-1')
    const res = await invoke('transcripts:updateExtractedItem', {
      recordingId: 'rec-1', kind: 'decision', index: 0, content: 'corrected key point'
    })
    expect(res.success).toBe(true)
    const row = queryOne<{ v: string }>('SELECT key_points AS v FROM transcripts WHERE recording_id = ?', ['rec-1'])
    expect(JSON.parse(row!.v)).toEqual(['corrected key point'])
  })

  it('returns NOT_FOUND for an out-of-range index and changes nothing', async () => {
    seed('rec-1')
    const res = await invoke('transcripts:updateExtractedItem', {
      recordingId: 'rec-1', kind: 'action', index: 7, content: 'nope'
    })
    expect(res.success).toBe(false)
    expect(res.error.code).toBe('NOT_FOUND')
    const row = queryOne<{ v: string }>('SELECT action_items AS v FROM transcripts WHERE recording_id = ?', ['rec-1'])
    expect(JSON.parse(row!.v)).toEqual(['first action', 'second action'])
  })

  it('refuses an ineligible (personal) recording without reading or mutating', async () => {
    seed('rec-x', { personal: true })
    const res = await invoke('transcripts:updateExtractedItem', {
      recordingId: 'rec-x', kind: 'action', index: 0, content: 'hacked'
    })
    expect(res.success).toBe(false)
    expect(res.error.code).toBe('RECORDING_INELIGIBLE')
    expect(JSON.stringify(res)).not.toContain('first action')
    const row = queryOne<{ v: string }>('SELECT action_items AS v FROM transcripts WHERE recording_id = ?', ['rec-x'])
    expect(JSON.parse(row!.v)[0]).toBe('first action')
  })

  it('rejects empty content at validation', async () => {
    seed('rec-1')
    const res = await invoke('transcripts:updateExtractedItem', {
      recordingId: 'rec-1', kind: 'action', index: 0, content: '   '
    })
    expect(res.success).toBe(false)
    expect(res.error.code).toBe('VALIDATION_ERROR')
  })
})
