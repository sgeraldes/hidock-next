// @vitest-environment node

/**
 * ROUND-15 RESIDUAL (ADV14 follow-up) — knowledge-capture DISPLAY-tier gating.
 *
 * knowledge:getAll / getById / getByIds are the ASSISTANT / DISPLAY-safe
 * accessors: a capture DERIVED from an excluded recording (personal /
 * soft-deleted / value-excluded / hard-purged) must NOT surface its AI-derived
 * summary+title, and a value-excluded STANDALONE (manual/artifact) capture must
 * not either. knowledge:getAllOwner is the narrow owner-management accessor
 * (existence-scoped) that lets the owner Library see+manage captures of their
 * OWN excluded recordings; its STANDALONE handling matches the gated tier so the
 * shared store slice's assistant DISPLAY consumer (Today) cannot leak.
 *
 * Runs the REAL handlers against a REAL temp DB (only `electron` and
 * `file-storage` are mocked) so the eligibility boundary is exercised end-to-end.
 * Never opens F:\HiDock-Next-Data — temp DB only.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'

const dbPath = join(tmpdir(), `hidock-adv14-knowledge-ipc-${process.pid}.sqlite`)
vi.mock('../../services/file-storage', () => ({ getDatabasePath: () => dbPath }))

const handlers = new Map<string, (...args: any[]) => any>()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: any[]) => any) => {
      handlers.set(channel, fn)
    }
  }
}))

import { initializeDatabase, closeDatabase, run } from '../../services/database'
import { registerKnowledgeHandlers } from '../knowledge-handlers'

function invoke(channel: string, ...args: any[]): Promise<any> {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`handler not registered: ${channel}`)
  return Promise.resolve(fn({} as any, ...args))
}

function seedRecording(id: string, opts: { personal?: boolean; deleted?: boolean } = {}): void {
  run('INSERT INTO recordings (id, filename, date_recorded, personal, deleted_at) VALUES (?, ?, ?, ?, ?)', [
    id,
    `${id}.hda`,
    '2026-06-01',
    opts.personal ? 1 : 0,
    opts.deleted ? '2026-07-01T00:00:00.000Z' : null
  ])
}

let capSeq = 0
function seedCapture(opts: {
  id?: string
  source?: string | null
  quality?: string | null
  capturedAt?: string
  title?: string
}): string {
  const id = opts.id ?? `cap-${++capSeq}`
  run(
    'INSERT INTO knowledge_captures (id, title, summary, captured_at, source_recording_id, quality_rating) VALUES (?, ?, ?, ?, ?, ?)',
    [id, opts.title ?? `Title ${id}`, `Summary ${id}`, opts.capturedAt ?? '2026-06-01T00:00:00.000Z', opts.source ?? null, opts.quality ?? null]
  )
  return id
}

beforeEach(async () => {
  handlers.clear()
  capSeq = 0
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
  await initializeDatabase()
  registerKnowledgeHandlers()
})

afterEach(() => {
  closeDatabase()
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
})

describe('ADV14 GATE — knowledge:getById (gated)', () => {
  it('returns a capture derived from an eligible recording', async () => {
    seedRecording('rec-ok')
    const id = seedCapture({ source: 'rec-ok' })
    expect((await invoke('knowledge:getById', id))?.id).toBe(id)
  })

  it('retains a manual capture with no source recording', async () => {
    const id = seedCapture({ source: null })
    expect((await invoke('knowledge:getById', id))?.id).toBe(id)
  })

  it.each([
    ['soft-deleted', () => seedRecording('rec-x', { deleted: true })],
    ['personal', () => seedRecording('rec-x', { personal: true })]
  ])('returns null for a capture from a %s recording', async (_label, setup) => {
    setup()
    const id = seedCapture({ source: 'rec-x' })
    expect(await invoke('knowledge:getById', id)).toBeNull()
  })

  it('returns null for a capture whose garbage rating value-excludes its recording', async () => {
    seedRecording('rec-garbage')
    const id = seedCapture({ source: 'rec-garbage', quality: 'garbage' })
    expect(await invoke('knowledge:getById', id)).toBeNull()
  })

  it('returns null for a capture whose source recording no longer exists (hard-purge orphan)', async () => {
    // knowledge_captures.source_recording_id is FK-constrained, so a dangling
    // source only arises from a hard purge that removed the recording row while
    // the capture survived. The positive allowlist must treat it as ineligible.
    seedRecording('rec-gone')
    const id = seedCapture({ source: 'rec-gone' })
    run('PRAGMA foreign_keys = OFF')
    run('DELETE FROM recordings WHERE id = ?', ['rec-gone'])
    run('PRAGMA foreign_keys = ON')
    expect(await invoke('knowledge:getById', id)).toBeNull()
  })

  it('returns null for a value-excluded STANDALONE capture', async () => {
    const id = seedCapture({ source: null, quality: 'low-value' })
    expect(await invoke('knowledge:getById', id)).toBeNull()
  })

  it('fails closed (null) when the eligibility lookup throws', async () => {
    seedRecording('rec-ok')
    const id = seedCapture({ source: 'rec-ok' })
    run('PRAGMA foreign_keys = OFF')
    run('DROP TABLE recordings')
    expect(await invoke('knowledge:getById', id)).toBeNull()
  })
})

describe('ADV14 GATE — knowledge:getByIds (gated batch)', () => {
  it('omits ineligible captures, retains eligible + manual', async () => {
    seedRecording('rec-ok')
    const ok = seedCapture({ source: 'rec-ok' })
    const manual = seedCapture({ source: null })
    seedRecording('rec-del', { deleted: true })
    const del = seedCapture({ source: 'rec-del' })
    seedRecording('rec-personal', { personal: true })
    const personal = seedCapture({ source: 'rec-personal' })
    seedRecording('rec-garbage')
    const garbage = seedCapture({ source: 'rec-garbage', quality: 'garbage' })
    const standaloneBad = seedCapture({ source: null, quality: 'garbage' })

    const res = await invoke('knowledge:getByIds', [ok, manual, del, personal, garbage, standaloneBad, 'ghost'])
    expect(res.map((c: any) => c.id).sort()).toEqual([manual, ok].sort())
  })

  it('fails closed (empty array) when the eligibility lookup throws', async () => {
    seedRecording('rec-ok')
    const id = seedCapture({ source: 'rec-ok' })
    run('PRAGMA foreign_keys = OFF')
    run('DROP TABLE recordings')
    expect(await invoke('knowledge:getByIds', [id])).toEqual([])
  })
})

describe('ADV14 GATE — knowledge:getAll (gated, fill-until-limit)', () => {
  it('excludes captures from excluded source recordings, keeps eligible + manual', async () => {
    seedRecording('rec-ok')
    const ok = seedCapture({ source: 'rec-ok' })
    const manual = seedCapture({ source: null })
    seedRecording('rec-del', { deleted: true })
    seedCapture({ source: 'rec-del' })
    seedRecording('rec-garbage')
    seedCapture({ source: 'rec-garbage', quality: 'garbage' })
    seedCapture({ source: null, quality: 'low-value' }) // standalone excluded

    const res = await invoke('knowledge:getAll', { limit: 100 })
    expect(res.map((c: any) => c.id).sort()).toEqual([manual, ok].sort())
  })

  it('does NOT truncate the page when excluded captures precede an eligible one (multi-batch fill)', async () => {
    // 60 value-excluded captures NEWER than the single eligible capture. The first
    // fetch batch (size 50) is all-excluded; fill-until-limit must page past it to
    // surface the eligible capture rather than returning a short/empty page.
    for (let i = 0; i < 60; i++) {
      seedRecording(`rec-bad-${i}`)
      seedCapture({ source: `rec-bad-${i}`, quality: 'garbage', capturedAt: `2026-06-02T00:00:${String(i).padStart(2, '0')}.000Z` })
    }
    seedRecording('rec-good')
    const good = seedCapture({ source: 'rec-good', capturedAt: '2026-06-01T00:00:00.000Z' })

    const res = await invoke('knowledge:getAll', { limit: 5 })
    expect(res.map((c: any) => c.id)).toEqual([good])
  })

  it('fails closed (empty array) when the eligibility lookup throws', async () => {
    seedRecording('rec-ok')
    seedCapture({ source: 'rec-ok' })
    run('PRAGMA foreign_keys = OFF')
    run('DROP TABLE recordings')
    expect(await invoke('knowledge:getAll', { limit: 100 })).toEqual([])
  })
})

describe('ADV14 OWNER — knowledge:getAllOwner (existence-scoped)', () => {
  it('returns captures for EXISTING but excluded source recordings (owner may view)', async () => {
    seedRecording('rec-del', { deleted: true })
    const del = seedCapture({ source: 'rec-del' })
    seedRecording('rec-personal', { personal: true })
    const personal = seedCapture({ source: 'rec-personal' })
    seedRecording('rec-garbage')
    const garbage = seedCapture({ source: 'rec-garbage', quality: 'garbage' })
    const manual = seedCapture({ source: null })

    const res = await invoke('knowledge:getAllOwner', { limit: 100 })
    expect(res.map((c: any) => c.id).sort()).toEqual([del, personal, garbage, manual].sort())
  })

  it('omits a capture whose source recording is hard-purged / nonexistent', async () => {
    seedRecording('rec-purged')
    const orphan = seedCapture({ source: 'rec-purged' })
    seedRecording('rec-live')
    const live = seedCapture({ source: 'rec-live' })
    // Hard-purge the recording row, leaving the capture with a dangling source id.
    run('PRAGMA foreign_keys = OFF')
    run('DELETE FROM recordings WHERE id = ?', ['rec-purged'])
    run('PRAGMA foreign_keys = ON')

    const res = await invoke('knowledge:getAllOwner', { limit: 100 })
    expect(res.map((c: any) => c.id)).toEqual([live])
    expect(res.map((c: any) => c.id)).not.toContain(orphan)
  })

  it('excludes a value-excluded STANDALONE capture (matches the gated tier so Today cannot leak)', async () => {
    const bad = seedCapture({ source: null, quality: 'garbage' })
    const good = seedCapture({ source: null, quality: 'valuable' })

    const res = await invoke('knowledge:getAllOwner', { limit: 100 })
    expect(res.map((c: any) => c.id)).toEqual([good])
    expect(res.map((c: any) => c.id)).not.toContain(bad)
  })

  it('fails closed (empty array) when the existence lookup throws', async () => {
    seedRecording('rec-del', { deleted: true })
    seedCapture({ source: 'rec-del' })
    run('PRAGMA foreign_keys = OFF')
    run('DROP TABLE recordings')
    expect(await invoke('knowledge:getAllOwner', { limit: 100 })).toEqual([])
  })
})
