// @vitest-environment node

/**
 * ADV15-3 (round-16) — actionables:getAll / getByMeeting route through the shared
 * CAPTURE-aware boundary. An actionable whose capture is derived from an excluded
 * recording, whose capture is soft-deleted, or whose STANDALONE capture is
 * value-excluded (garbage/low-value) must be dropped — the round-7 "null source
 * recording ⇒ unconditionally keep" bug is closed. REAL handlers, REAL temp DB.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'

const dbPath = join(tmpdir(), `hidock-adv15-actionables-ipc-${process.pid}.sqlite`)
vi.mock('../../services/file-storage', () => ({ getDatabasePath: () => dbPath }))

const handlers = new Map<string, (...args: any[]) => any>()
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: (...args: any[]) => any) => { handlers.set(channel, fn) } }
}))

import { initializeDatabase, closeDatabase, run } from '../../services/database'
import { registerActionablesHandlers } from '../actionables-handlers'

function invoke(channel: string, ...args: any[]): Promise<any> {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`handler not registered: ${channel}`)
  return Promise.resolve(fn({} as any, ...args))
}

function seedMeeting(id: string): void {
  run('INSERT INTO meetings (id, subject, start_time, end_time) VALUES (?, ?, ?, ?)', [id, `M ${id}`, '2026-06-01T10:00:00Z', '2026-06-01T11:00:00Z'])
}
function seedRecording(id: string, meetingId: string | null, opts: { personal?: boolean; deleted?: boolean } = {}): void {
  run('INSERT INTO recordings (id, filename, date_recorded, personal, deleted_at, meeting_id) VALUES (?, ?, ?, ?, ?, ?)', [
    id, `${id}.hda`, '2026-06-01', opts.personal ? 1 : 0, opts.deleted ? '2026-07-01T00:00:00.000Z' : null, meetingId
  ])
}
let capSeq = 0
function seedCapture(opts: { source?: string | null; quality?: string | null; deletedAt?: string | null; meetingId?: string | null } = {}): string {
  const id = `cap-${++capSeq}`
  run('INSERT INTO knowledge_captures (id, title, captured_at, source_recording_id, quality_rating, deleted_at, meeting_id) VALUES (?, ?, ?, ?, ?, ?, ?)', [
    id, `Cap ${id}`, '2026-06-01', opts.source ?? null, opts.quality ?? null, opts.deletedAt ?? null, opts.meetingId ?? null
  ])
  return id
}
function seedActionable(id: string, skid: string): void {
  run('INSERT INTO actionables (id, type, title, source_knowledge_id, status) VALUES (?, ?, ?, ?, ?)', [id, 'email', id, skid, 'pending'])
}

beforeEach(async () => {
  handlers.clear()
  capSeq = 0
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
  await initializeDatabase()
  registerActionablesHandlers()
})

afterEach(() => {
  closeDatabase()
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
})

describe('ADV15-3 — actionables:getAll capture-aware gating', () => {
  it('keeps eligible + eligible-standalone, drops excluded/soft-deleted/garbage', async () => {
    seedRecording('rec-ok', null)
    seedActionable('a-ok', seedCapture({ source: 'rec-ok' }))

    seedRecording('rec-del', null, { deleted: true })
    seedActionable('a-del', seedCapture({ source: 'rec-del' }))

    seedRecording('rec-personal', null, { personal: true })
    seedActionable('a-personal', seedCapture({ source: 'rec-personal' }))

    seedRecording('rec-garbage', null)
    seedActionable('a-garbage', seedCapture({ source: 'rec-garbage', quality: 'garbage' }))

    seedActionable('a-softdel', seedCapture({ source: 'rec-ok', deletedAt: '2026-07-10T00:00:00.000Z' }))
    seedActionable('a-standbad', seedCapture({ source: null, quality: 'low-value' }))
    seedActionable('a-standok', seedCapture({ source: null, quality: 'valuable' }))

    const res = await invoke('actionables:getAll')
    expect(res.map((a: any) => a.id).sort()).toEqual(['a-ok', 'a-standok'])
  })

  it('surfaces an eligible actionable behind many excluded ones (no truncation)', async () => {
    for (let i = 0; i < 30; i++) {
      seedRecording(`rec-bad-${i}`, null, { deleted: true })
      seedActionable(`a-bad-${i}`, seedCapture({ source: `rec-bad-${i}` }))
    }
    seedRecording('rec-good', null)
    seedActionable('a-good', seedCapture({ source: 'rec-good' }))

    const res = await invoke('actionables:getAll')
    expect(res.map((a: any) => a.id)).toEqual(['a-good'])
  })

  it('fails closed (empty) when the eligibility lookup throws', async () => {
    seedRecording('rec-ok', null)
    seedActionable('a-ok', seedCapture({ source: 'rec-ok' }))
    run('PRAGMA foreign_keys = OFF')
    run('DROP TABLE recordings')
    expect(await invoke('actionables:getAll')).toEqual([])
  })
})

describe('ADV38 sweep (round-40) — actionables mutation gating', () => {
  it('updateStatus REFUSES a stale actionable whose source recording is excluded (no write)', async () => {
    seedRecording('rec-del', null, { deleted: true })
    seedActionable('a-del', seedCapture({ source: 'rec-del' }))
    const res = await invoke('actionables:updateStatus', 'a-del', 'in_progress')
    expect(res.success).toBe(false)
    // Generic not-found — does not disclose the excluded actionable's existence.
    expect(res.error).toContain('not found')
    // Status unchanged (still pending).
    const { queryOne } = await import('../../services/database')
    const row = queryOne<{ status: string }>('SELECT status FROM actionables WHERE id = ?', ['a-del'])
    expect(row?.status).toBe('pending')
  })

  it('updateStatus WORKS for an eligible actionable', async () => {
    seedRecording('rec-ok', null)
    seedActionable('a-ok', seedCapture({ source: 'rec-ok' }))
    const res = await invoke('actionables:updateStatus', 'a-ok', 'in_progress')
    expect(res.success).toBe(true)
    const { queryOne } = await import('../../services/database')
    const row = queryOne<{ status: string }>('SELECT status FROM actionables WHERE id = ?', ['a-ok'])
    expect(row?.status).toBe('in_progress')
  })

  it('generateOutput REFUSES a stale actionable whose STANDALONE capture is value-excluded (no derived metadata returned, no write)', async () => {
    seedActionable('a-bad', seedCapture({ source: null, quality: 'low-value' }))
    const res = await invoke('actionables:generateOutput', 'a-bad')
    expect(res.success).toBe(false)
    expect(res.error).toContain('not found')
    expect(res.data).toBeUndefined()
    const { queryOne } = await import('../../services/database')
    const row = queryOne<{ status: string }>('SELECT status FROM actionables WHERE id = ?', ['a-bad'])
    expect(row?.status).toBe('pending') // NOT flipped to in_progress
  })

  it('generateOutput WORKS for an eligible actionable (returns sourceKnowledgeId, flips status)', async () => {
    seedRecording('rec-ok', null)
    const cap = seedCapture({ source: 'rec-ok' })
    seedActionable('a-ok', cap)
    const res = await invoke('actionables:generateOutput', 'a-ok')
    expect(res.success).toBe(true)
    expect(res.data.sourceKnowledgeId).toBe(cap)
    const { queryOne } = await import('../../services/database')
    const row = queryOne<{ status: string }>('SELECT status FROM actionables WHERE id = ?', ['a-ok'])
    expect(row?.status).toBe('in_progress')
  })
})

describe('ADV15-3 — actionables:getByMeeting capture-aware gating', () => {
  it('drops excluded/soft-deleted/garbage actionables for the meeting', async () => {
    seedMeeting('m-1')
    seedRecording('rec-ok', 'm-1')
    seedActionable('a-ok', seedCapture({ source: 'rec-ok', meetingId: 'm-1' }))

    seedRecording('rec-del', 'm-1', { deleted: true })
    seedActionable('a-del', seedCapture({ source: 'rec-del', meetingId: 'm-1' }))

    // Standalone garbage capture attached to the meeting directly.
    seedActionable('a-garbage', seedCapture({ source: null, quality: 'garbage', meetingId: 'm-1' }))
    // Soft-deleted capture attached to the meeting directly.
    seedActionable('a-softdel', seedCapture({ source: 'rec-ok', deletedAt: '2026-07-10T00:00:00.000Z', meetingId: 'm-1' }))

    const res = await invoke('actionables:getByMeeting', 'm-1')
    expect(res.map((a: any) => a.id)).toEqual(['a-ok'])
  })
})
