// @vitest-environment node

/**
 * ADV45-1 (round-47) — speaker-identity mutations must gate the RECORDING axis
 * IN-TRANSACTION, before resolving/creating contacts and before any write.
 *
 * Round 39 gated the CONTACT axis (never reanimate a SUPPRESSED contact). This
 * gates the RECORDING axis: a mutation on an EXCLUDED recording (soft-deleted /
 * personal / value-excluded / hard-purged) or one whose eligibility lookup can't
 * complete must REFUSE — no contact minted, no transcript_speakers binding, no
 * always-eligible source='calendar' meeting_contacts membership — so an excluded
 * recording's interaction can never launder itself into visible identity.
 *
 * Covers every guarded mutation: assignSpeaker, unassignSpeaker, setTurnOverride,
 * clearTurnOverride, splitSpeakerFrom, mergeSpeakerSplit, assignSpeakerFromHere.
 *
 * REAL temp DB (better-sqlite3), real database.ts end to end.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'

const dbPath = join(tmpdir(), `hidock-r47-speaker-rec-gate-${process.pid}.sqlite`)
vi.mock('../file-storage', () => ({ getDatabasePath: () => dbPath }))

import {
  initializeDatabase,
  closeDatabase,
  run,
  queryAll,
  assignSpeaker,
  unassignSpeaker,
  setTurnOverride,
  clearTurnOverride,
  splitSpeakerFrom,
  mergeSpeakerSplit,
  assignSpeakerFromHere
} from '../database'

function seedRecording(id: string, opts: { personal?: boolean; deleted?: boolean; meetingId?: string } = {}): void {
  run(
    `INSERT INTO recordings (id, filename, date_recorded, personal, deleted_at, meeting_id) VALUES (?, ?, '2026-01-02T10:00:00Z', ?, ?, ?)`,
    [id, `${id}.hda`, opts.personal ? 1 : 0, opts.deleted ? '2026-07-01T00:00:00Z' : null, opts.meetingId ?? null]
  )
}
function seedValueExcludedRecording(id: string, meetingId?: string): void {
  seedRecording(id, { meetingId })
  run(
    `INSERT INTO knowledge_captures (id, title, captured_at, source_recording_id, quality_rating) VALUES (?, 'C', '2026-06-01', ?, 'garbage')`,
    [`cap-${id}`, id]
  )
}
function seedMeeting(id: string): void {
  run(`INSERT INTO meetings (id, subject, start_time, end_time) VALUES (?, ?, '2026-01-02T10:00:00Z', '2026-01-02T11:00:00Z')`, [id, id])
}
function seedContact(id: string, name: string): void {
  run(
    `INSERT INTO contacts (id, name, type, first_seen_at, last_seen_at, meeting_count, source)
     VALUES (?, ?, 'unknown', '2026-01-01', '2026-01-01', 0, 'user')`,
    [id, name]
  )
}

/** No new contact was minted, no binding/override/split written, no membership linked. */
function assertNoIdentityState(recordingId: string, contactCountBefore: number): void {
  expect(queryAll('SELECT 1 FROM contacts', []).length).toBe(contactCountBefore)
  expect(queryAll('SELECT 1 FROM transcript_speakers WHERE recording_id = ?', [recordingId]).length).toBe(0)
  expect(queryAll('SELECT 1 FROM turn_speaker_overrides WHERE recording_id = ?', [recordingId]).length).toBe(0)
  expect(queryAll('SELECT 1 FROM speaker_splits WHERE recording_id = ?', [recordingId]).length).toBe(0)
  expect(queryAll('SELECT 1 FROM meeting_contacts', []).length).toBe(0)
}

beforeEach(async () => {
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
  await initializeDatabase()
  seedContact('c-user', 'Alice') // a visible contact the picker could offer
})
afterEach(() => {
  closeDatabase()
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
})

// The four ineligibility flavours, each of which must refuse every mutation.
const cases: Array<{ name: string; make: (recId: string, meetingId: string) => void }> = [
  { name: 'soft-deleted', make: (r, m) => seedRecording(r, { deleted: true, meetingId: m }) },
  { name: 'personal', make: (r, m) => seedRecording(r, { personal: true, meetingId: m }) },
  { name: 'value-excluded', make: (r, m) => seedValueExcludedRecording(r, m) },
  { name: 'hard-purged (no recordings row)', make: (_r, _m) => {} } // deliberately unseeded
]

for (const c of cases) {
  describe(`speaker mutations refuse an excluded recording — ${c.name}`, () => {
    beforeEach(() => {
      seedMeeting('m1')
      c.make('rec-x', 'm1')
    })

    it('assignSpeaker (newName) refused, no state', () => {
      const before = queryAll('SELECT 1 FROM contacts', []).length
      expect(() => assignSpeaker('rec-x', 'Speaker 1', { newName: 'Nora' })).toThrow(/not eligible/)
      assertNoIdentityState('rec-x', before)
    })

    it('assignSpeaker (contactId) refused, no state', () => {
      const before = queryAll('SELECT 1 FROM contacts', []).length
      expect(() => assignSpeaker('rec-x', 'Speaker 1', { contactId: 'c-user' })).toThrow(/not eligible/)
      assertNoIdentityState('rec-x', before)
    })

    it('unassignSpeaker refused', () => {
      const before = queryAll('SELECT 1 FROM contacts', []).length
      expect(() => unassignSpeaker('rec-x', 'Speaker 1')).toThrow(/not eligible/)
      assertNoIdentityState('rec-x', before)
    })

    it('setTurnOverride refused, no state', () => {
      const before = queryAll('SELECT 1 FROM contacts', []).length
      expect(() => setTurnOverride('rec-x', 2, { contactId: 'c-user' })).toThrow(/not eligible/)
      assertNoIdentityState('rec-x', before)
    })

    it('clearTurnOverride refused', () => {
      const before = queryAll('SELECT 1 FROM contacts', []).length
      expect(() => clearTurnOverride('rec-x', 2)).toThrow(/not eligible/)
      assertNoIdentityState('rec-x', before)
    })

    it('splitSpeakerFrom refused, no split', () => {
      const before = queryAll('SELECT 1 FROM contacts', []).length
      expect(() => splitSpeakerFrom('rec-x', 'Speaker 1', 4)).toThrow(/not eligible/)
      assertNoIdentityState('rec-x', before)
    })

    it('mergeSpeakerSplit refused', () => {
      const before = queryAll('SELECT 1 FROM contacts', []).length
      expect(() => mergeSpeakerSplit('rec-x', 'Speaker 1', 4)).toThrow(/not eligible/)
      assertNoIdentityState('rec-x', before)
    })

    it('assignSpeakerFromHere refused, no split + no binding', () => {
      const before = queryAll('SELECT 1 FROM contacts', []).length
      expect(() => assignSpeakerFromHere('rec-x', 'Speaker 1', 6, { contactId: 'c-user' })).toThrow(/not eligible/)
      assertNoIdentityState('rec-x', before)
    })
  })
}

describe('speaker mutations still work on an ELIGIBLE recording (no regression)', () => {
  beforeEach(() => {
    seedMeeting('m1')
    seedRecording('rec-ok', { meetingId: 'm1' })
  })

  it('assignSpeaker binds + links the meeting membership', () => {
    const contact = assignSpeaker('rec-ok', 'Speaker 1', { contactId: 'c-user' })
    expect(contact.id).toBe('c-user')
    expect(queryAll('SELECT 1 FROM transcript_speakers WHERE recording_id = ?', ['rec-ok']).length).toBe(1)
    expect(queryAll('SELECT 1 FROM meeting_contacts WHERE meeting_id = ? AND contact_id = ?', ['m1', 'c-user']).length).toBe(1)
  })

  it('assignSpeakerFromHere splits + binds', () => {
    const { derivedLabel, contact } = assignSpeakerFromHere('rec-ok', 'Speaker 1', 6, { contactId: 'c-user' })
    expect(derivedLabel).toBe('Speaker 1 · B')
    expect(contact.id).toBe('c-user')
    expect(queryAll('SELECT 1 FROM speaker_splits WHERE recording_id = ?', ['rec-ok']).length).toBe(1)
  })
})
