// @vitest-environment node

/**
 * ADV15 (round-16) — THE shared, central capture-eligibility boundary.
 *
 * Exactly as recordings got filterEligibleRecordingIds at round 6, every
 * capture-derived read surface routes through filterEligibleCaptureIds. A capture
 * is eligible iff its own deleted_at IS NULL AND (recording-derived → its source
 * recording passes the recording allowlist  OR  standalone → its own quality is
 * not value-excluded). Runs the REAL boundary against a REAL temp DB so the SQL
 * (getCaptureEligibilityRows + the recording allowlist delegation) is exercised
 * end-to-end. Temp DB only — never opens F:\HiDock-Next-Data.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'

const dbPath = join(tmpdir(), `hidock-adv15-capture-eligibility-${process.pid}.sqlite`)
vi.mock('../file-storage', () => ({ getDatabasePath: () => dbPath }))

import { initializeDatabase, closeDatabase, run } from '../database'
import { filterEligibleCaptureIds, isCaptureEligible } from '../recording-eligibility'

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
function seedCapture(opts: { id?: string; source?: string | null; quality?: string | null; deletedAt?: string | null } = {}): string {
  const id = opts.id ?? `cap-${++capSeq}`
  run(
    'INSERT INTO knowledge_captures (id, title, captured_at, source_recording_id, quality_rating, deleted_at) VALUES (?, ?, ?, ?, ?, ?)',
    [id, `Title ${id}`, '2026-06-01', opts.source ?? null, opts.quality ?? null, opts.deletedAt ?? null]
  )
  return id
}

beforeEach(async () => {
  capSeq = 0
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
  await initializeDatabase()
})

afterEach(() => {
  closeDatabase()
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
})

describe('filterEligibleCaptureIds — recording-derived captures', () => {
  it('keeps a capture whose source recording is eligible', () => {
    seedRecording('rec-ok')
    const id = seedCapture({ source: 'rec-ok' })
    const { eligible, failClosed } = filterEligibleCaptureIds([id])
    expect(failClosed).toBe(false)
    expect(eligible.has(id)).toBe(true)
  })

  it.each([
    ['soft-deleted', () => seedRecording('rec-x', { deleted: true })],
    ['personal', () => seedRecording('rec-x', { personal: true })]
  ])('drops a capture from a %s recording', (_label, setup) => {
    setup()
    const id = seedCapture({ source: 'rec-x' })
    expect(filterEligibleCaptureIds([id]).eligible.has(id)).toBe(false)
  })

  it('drops a capture whose garbage rating value-excludes its recording', () => {
    seedRecording('rec-g')
    // The capture's own garbage rating (no keep sibling) value-excludes rec-g.
    const id = seedCapture({ source: 'rec-g', quality: 'garbage' })
    expect(filterEligibleCaptureIds([id]).eligible.has(id)).toBe(false)
  })

  it('drops a capture whose source recording no longer exists (hard-purge orphan)', () => {
    seedRecording('rec-gone')
    const id = seedCapture({ source: 'rec-gone' })
    run('PRAGMA foreign_keys = OFF')
    run('DELETE FROM recordings WHERE id = ?', ['rec-gone'])
    run('PRAGMA foreign_keys = ON')
    expect(filterEligibleCaptureIds([id]).eligible.has(id)).toBe(false)
  })
})

describe('filterEligibleCaptureIds — standalone captures', () => {
  it('keeps a standalone capture with no/keep rating', () => {
    const unrated = seedCapture({ source: null, quality: null })
    const valuable = seedCapture({ source: null, quality: 'valuable' })
    const archived = seedCapture({ source: null, quality: 'archived' })
    const { eligible } = filterEligibleCaptureIds([unrated, valuable, archived])
    expect([...eligible].sort()).toEqual([unrated, valuable, archived].sort())
  })

  it.each(['garbage', 'low-value'])('drops a value-excluded standalone capture (%s)', (rating) => {
    const id = seedCapture({ source: null, quality: rating })
    expect(filterEligibleCaptureIds([id]).eligible.has(id)).toBe(false)
  })
})

describe('filterEligibleCaptureIds — soft-deleted captures (ADV15-2)', () => {
  it('drops a soft-deleted capture even from an eligible recording', () => {
    seedRecording('rec-ok')
    const id = seedCapture({ source: 'rec-ok', deletedAt: '2026-07-10T00:00:00.000Z' })
    expect(filterEligibleCaptureIds([id]).eligible.has(id)).toBe(false)
  })

  it('drops a soft-deleted standalone capture with an otherwise-keep rating', () => {
    const id = seedCapture({ source: null, quality: 'valuable', deletedAt: '2026-07-10T00:00:00.000Z' })
    expect(filterEligibleCaptureIds([id]).eligible.has(id)).toBe(false)
  })
})

describe('filterEligibleCaptureIds — missing ids + mixed batches', () => {
  it('omits an id that resolves to no capture row (positive allowlist)', () => {
    const { eligible, failClosed } = filterEligibleCaptureIds(['ghost-never-existed'])
    expect(failClosed).toBe(false)
    expect(eligible.size).toBe(0)
  })

  it('returns the eligible subset from a mixed batch', () => {
    seedRecording('rec-ok')
    const keep = seedCapture({ source: 'rec-ok' })
    const manual = seedCapture({ source: null, quality: 'valuable' })
    seedRecording('rec-del', { deleted: true })
    const del = seedCapture({ source: 'rec-del' })
    const garbage = seedCapture({ source: null, quality: 'garbage' })
    const softDel = seedCapture({ source: 'rec-ok', deletedAt: '2026-07-10T00:00:00.000Z' })

    const { eligible } = filterEligibleCaptureIds([keep, manual, del, garbage, softDel, 'ghost'])
    expect([...eligible].sort()).toEqual([keep, manual].sort())
  })
})

describe('filterEligibleCaptureIds — fail-closed semantics', () => {
  it('fails closed (empty + failClosed) when the capture-row lookup throws', () => {
    const id = seedCapture({ source: null, quality: 'valuable' })
    run('PRAGMA foreign_keys = OFF')
    run('DROP TABLE knowledge_captures')
    const { eligible, failClosed } = filterEligibleCaptureIds([id])
    expect(failClosed).toBe(true)
    expect(eligible.size).toBe(0)
  })

  it('drops recording-derived captures but KEEPS eligible standalone ones when the recording lookup fails', () => {
    seedRecording('rec-ok')
    const recDerived = seedCapture({ source: 'rec-ok' })
    const standalone = seedCapture({ source: null, quality: 'valuable' })
    // Drop only the recordings table → the recording sub-lookup fails, but the
    // capture-row lookup still succeeds and standalone captures are independent.
    run('PRAGMA foreign_keys = OFF')
    run('DROP TABLE recordings')
    const { eligible, failClosed } = filterEligibleCaptureIds([recDerived, standalone])
    expect(failClosed).toBe(false)
    expect(eligible.has(recDerived)).toBe(false) // recording-derived conservatively dropped
    expect(eligible.has(standalone)).toBe(true) // standalone unaffected
  })
})

describe('isCaptureEligible', () => {
  it('true for an eligible capture, false for an excluded one', () => {
    seedRecording('rec-ok')
    const ok = seedCapture({ source: 'rec-ok' })
    const bad = seedCapture({ source: null, quality: 'garbage' })
    expect(isCaptureEligible(ok)).toBe(true)
    expect(isCaptureEligible(bad)).toBe(false)
  })
})
