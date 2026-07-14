/**
 * Sync-time occurrence-id reconciliation (duplicate-meeting fix).
 *
 * remapOccurrenceIdsToExisting pins an incoming recurring occurrence to the row
 * that already describes the same real slot (same base uid + start_time) under a
 * different id, so a re-sync UPDATES that row in place — preserving its id and
 * therefore its recordings.meeting_id / meeting_contacts / meeting_projects FKs —
 * instead of inserting an id-scheme twin.
 *
 * The DB engine's module-level construction reaches for sql.js + fs; the mocks
 * below keep the import graph offline. The function under test is pure.
 */

import { describe, it, expect, vi } from 'vitest'

const mockStmt = { bind: vi.fn(), step: vi.fn(() => false), getAsObject: vi.fn(() => ({})), free: vi.fn(), reset: vi.fn() }
const mockDatabase = {
  run: vi.fn(),
  exec: vi.fn(() => [] as unknown[]),
  prepare: vi.fn(() => mockStmt),
  getRowsModified: vi.fn(() => 0),
  export: vi.fn(() => new Uint8Array([1, 2, 3])),
  close: vi.fn()
}
const RealMockSQLDatabase = vi.fn()
RealMockSQLDatabase.prototype = mockDatabase

vi.mock('sql.js', () => ({ default: vi.fn(async () => ({ Database: RealMockSQLDatabase })) }))
vi.mock('fs', () => {
  const fsMock = { existsSync: vi.fn(() => false), readFileSync: vi.fn(() => Buffer.from('x')), writeFileSync: vi.fn(), renameSync: vi.fn() }
  return { ...fsMock, default: fsMock }
})
vi.mock('fs/promises', () => {
  const p = { writeFile: vi.fn(async () => {}), rename: vi.fn(async () => {}), unlink: vi.fn(async () => {}) }
  return { ...p, default: p }
})
vi.mock('../file-storage', () => ({ getDatabasePath: vi.fn(() => '/tmp/test-hidock.db') }))

import { remapOccurrenceIdsToExisting, meetingBaseUid } from '../database'

const START = '2026-07-08T16:00:00.000Z'
const UID = 'UID1'
const SLOT_ID = `${UID}::${START}`

describe('meetingBaseUid', () => {
  it('strips the ::slot suffix', () => {
    expect(meetingBaseUid(SLOT_ID)).toBe(UID)
  })
  it('returns a bare uid unchanged', () => {
    expect(meetingBaseUid(UID)).toBe(UID)
  })
})

describe('remapOccurrenceIdsToExisting', () => {
  it('remaps an expanded occurrence onto an existing bare-uid row at the same slot', () => {
    const incoming = [{ id: SLOT_ID, start_time: START }]
    const existing = [{ id: UID, start_time: START }] // stale pre-expansion bare-uid row
    const out = remapOccurrenceIdsToExisting(incoming, existing)
    expect(out[0].id).toBe(UID) // pinned to the FK-carrying row, not a twin
  })

  it('leaves an incoming id that already exists unchanged (updates in place)', () => {
    const incoming = [{ id: SLOT_ID, start_time: START }]
    const existing = [{ id: SLOT_ID, start_time: START }]
    const out = remapOccurrenceIdsToExisting(incoming, existing)
    expect(out[0].id).toBe(SLOT_ID)
  })

  it('does not remap when no row shares the base uid + start_time', () => {
    const incoming = [{ id: SLOT_ID, start_time: START }]
    const existing = [{ id: 'OTHER', start_time: START }]
    const out = remapOccurrenceIdsToExisting(incoming, existing)
    expect(out[0].id).toBe(SLOT_ID) // inserted fresh
  })

  it('prefers the bare-uid row as canonical when both a bare and a ::slot row exist', () => {
    // Transient tonight-state: both twins present. A different incoming occurrence
    // id must resolve to the bare-uid row (matches the cleanup keeper preference).
    const otherSlotId = `${UID}::stale`
    const incoming = [{ id: otherSlotId, start_time: START }]
    const existing = [
      { id: SLOT_ID, start_time: START },
      { id: UID, start_time: START }
    ]
    const out = remapOccurrenceIdsToExisting(incoming, existing)
    expect(out[0].id).toBe(UID)
  })

  it('matches occurrences by start_time, not by the slot embedded in the id', () => {
    // A RECURRENCE-ID override moved the meeting: its id keeps the original slot
    // but start_time is the new time. The existing row is at the new time.
    const movedId = `${UID}::2026-07-08T15:30:00.000Z` // id slot != start_time
    const incoming = [{ id: movedId, start_time: START }]
    const existing = [{ id: UID, start_time: START }]
    const out = remapOccurrenceIdsToExisting(incoming, existing)
    expect(out[0].id).toBe(UID)
  })

  it('does not touch distinct occurrences of the same series at other slots', () => {
    const nextWeek = '2026-07-15T16:00:00.000Z'
    const incoming = [{ id: `${UID}::${nextWeek}`, start_time: nextWeek }]
    const existing = [{ id: UID, start_time: START }] // only the Jul-08 slot exists
    const out = remapOccurrenceIdsToExisting(incoming, existing)
    expect(out[0].id).toBe(`${UID}::${nextWeek}`)
  })
})
