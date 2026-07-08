// @vitest-environment node

/**
 * Round 1a — contact identity backend.
 *
 * Exercises the real sql.js engine (temp-file backed) so the merge/assign/
 * attendee logic is tested against actual SQL semantics (UNIQUE collisions,
 * OR IGNORE repointing, field folding), not mocks.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'

const dbPath = join(tmpdir(), `hidock-r1a-identity-${process.pid}.sqlite`)

vi.mock('../file-storage', () => ({
  getDatabasePath: () => dbPath
}))

import {
  initializeDatabase,
  closeDatabase,
  run,
  queryOne,
  queryAll,
  mergeContacts,
  assignSpeaker,
  getSpeakerMap,
  unassignSpeaker,
  addMeetingAttendee,
  removeMeetingAttendee,
  getContactsForMeeting,
  Contact
} from '../database'
import { pickKeeperContact, mergeDuplicateContacts } from '../org-reconciler'

// --- seed helpers -----------------------------------------------------------

function seedContact(c: Partial<Contact> & { id: string; name: string }): void {
  const now = c.first_seen_at || '2026-01-01T00:00:00.000Z'
  run(
    `INSERT INTO contacts (id, name, email, type, role, company, notes, tags, first_seen_at, last_seen_at, meeting_count, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      c.id,
      c.name,
      c.email ?? null,
      c.type ?? 'unknown',
      c.role ?? null,
      c.company ?? null,
      c.notes ?? null,
      c.tags ?? null,
      now,
      c.last_seen_at || now,
      c.meeting_count ?? 0,
      c.created_at || now
    ]
  )
}

function seedMeeting(id: string, subject = 'Sync'): void {
  run(
    `INSERT INTO meetings (id, subject, start_time, end_time) VALUES (?, ?, ?, ?)`,
    [id, subject, '2026-01-01T10:00:00.000Z', '2026-01-01T11:00:00.000Z']
  )
}

function seedRecording(id: string, meetingId: string | null): void {
  run(
    `INSERT INTO recordings (id, filename, date_recorded, meeting_id) VALUES (?, ?, ?, ?)`,
    [id, `${id}.wav`, '2026-01-01T10:00:00.000Z', meetingId]
  )
}

function link(meetingId: string, contactId: string, role = 'attendee'): void {
  run('INSERT OR IGNORE INTO meeting_contacts (meeting_id, contact_id, role) VALUES (?, ?, ?)', [
    meetingId,
    contactId,
    role
  ])
}

function getContact(id: string): Contact | undefined {
  return queryOne<Contact>('SELECT * FROM contacts WHERE id = ?', [id])
}

beforeEach(async () => {
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
  await initializeDatabase()
})

afterEach(() => {
  closeDatabase()
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
})

// ---------------------------------------------------------------------------

describe('pickKeeperContact (pure ranking)', () => {
  it('prefers the contact with an email', () => {
    const keeper = pickKeeperContact([
      { id: 'a', name: 'A', email: null },
      { id: 'b', name: 'B', email: 'b@x.com' }
    ])
    expect(keeper.id).toBe('b')
  })

  it('prefers role/company when email ties', () => {
    const keeper = pickKeeperContact([
      { id: 'a', name: 'A', email: null, role: null, company: null },
      { id: 'b', name: 'B', email: null, role: 'Dev', company: null }
    ])
    expect(keeper.id).toBe('b')
  })

  it('prefers more meetings when email and enrichment tie', () => {
    const keeper = pickKeeperContact([
      { id: 'a', name: 'A', email: 'x@x.com', meeting_count: 1 },
      { id: 'b', name: 'B', email: 'x@x.com', meeting_count: 9 }
    ])
    expect(keeper.id).toBe('b')
  })

  it('falls back to the oldest created_at', () => {
    const keeper = pickKeeperContact([
      { id: 'new', name: 'A', email: null, created_at: '2026-06-01T00:00:00Z' },
      { id: 'old', name: 'B', email: null, created_at: '2026-01-01T00:00:00Z' }
    ])
    expect(keeper.id).toBe('old')
  })

  it('does not mutate input order', () => {
    const rows = [
      { id: 'a', name: 'A', email: null },
      { id: 'b', name: 'B', email: 'b@x.com' }
    ]
    pickKeeperContact(rows)
    expect(rows.map((r) => r.id)).toEqual(['a', 'b'])
  })
})

describe('mergeContacts', () => {
  it('folds fields onto the keeper (keeper wins; null-fill from loser; tags union; type from loser when unknown)', () => {
    seedContact({ id: 'k', name: 'Keeper', email: 'keep@x.com', type: 'unknown', role: null, company: null, tags: '["a"]' })
    seedContact({
      id: 'l',
      name: 'Loser',
      email: 'lose@x.com',
      type: 'team',
      role: 'Engineer',
      company: 'Acme',
      notes: 'from loser',
      tags: '["b","a"]'
    })

    const merged = mergeContacts('k', 'l')

    expect(merged.email).toBe('keep@x.com') // keeper wins where present
    expect(merged.role).toBe('Engineer') // null-filled from loser
    expect(merged.company).toBe('Acme') // null-filled from loser
    expect(merged.notes).toBe('from loser') // null-filled from loser
    expect(merged.type).toBe('team') // keeper was 'unknown' → loser's type
    expect(JSON.parse(merged.tags!)).toEqual(['a', 'b']) // union
    expect(getContact('l')).toBeUndefined() // loser removed
  })

  it('keeps the keeper type when it is not unknown', () => {
    seedContact({ id: 'k', name: 'K', type: 'customer' })
    seedContact({ id: 'l', name: 'L', type: 'team' })
    const merged = mergeContacts('k', 'l')
    expect(merged.type).toBe('customer')
  })

  it('repoints meeting_contacts (OR IGNORE collisions) and transcript_speakers, recomputing meeting_count', () => {
    seedContact({ id: 'k', name: 'K' })
    seedContact({ id: 'l', name: 'L' })
    seedMeeting('m1')
    seedMeeting('m2')
    seedRecording('r1', null)

    link('m1', 'k') // keeper already in m1
    link('m1', 'l') // collision on repoint → dropped
    link('m2', 'l') // repoints cleanly to keeper
    run('INSERT INTO transcript_speakers (id, recording_id, speaker_label, contact_id) VALUES (?, ?, ?, ?)', [
      'ts1',
      'r1',
      'Speaker 1',
      'l'
    ])

    const merged = mergeContacts('k', 'l')

    const links = queryAll<{ meeting_id: string }>(
      'SELECT meeting_id FROM meeting_contacts WHERE contact_id = ? ORDER BY meeting_id',
      ['k']
    )
    expect(links.map((r) => r.meeting_id)).toEqual(['m1', 'm2'])
    expect(queryAll('SELECT 1 FROM meeting_contacts WHERE contact_id = ?', ['l'])).toHaveLength(0)

    const speaker = queryOne<{ contact_id: string }>('SELECT contact_id FROM transcript_speakers WHERE id = ?', ['ts1'])
    expect(speaker?.contact_id).toBe('k')

    expect(merged.meeting_count).toBe(2)
  })

  it('throws when ids are equal or a contact is missing', () => {
    seedContact({ id: 'k', name: 'K' })
    expect(() => mergeContacts('k', 'k')).toThrow()
    expect(() => mergeContacts('k', 'missing')).toThrow()
    expect(() => mergeContacts('missing', 'k')).toThrow()
  })
})

describe('mergeDuplicateContacts', () => {
  it('merges on identical lower-cased email', () => {
    seedContact({ id: 'a', name: 'Alice', email: 'Alice@X.com', created_at: '2026-01-01T00:00:00Z' })
    seedContact({ id: 'b', name: 'Alicia', email: 'alice@x.com', role: 'Dev', created_at: '2026-02-01T00:00:00Z' })

    const removed = mergeDuplicateContacts()

    expect(removed).toBe(1)
    const remaining = queryAll<Contact>('SELECT * FROM contacts')
    expect(remaining).toHaveLength(1)
    // keeper has role folded in
    expect(remaining[0].role).toBe('Dev')
  })

  it('merges on exact lower-cased name', () => {
    seedContact({ id: 'a', name: 'Bob Smith', created_at: '2026-01-01T00:00:00Z' })
    seedContact({ id: 'b', name: 'bob smith', email: 'bob@x.com', created_at: '2026-02-01T00:00:00Z' })

    const removed = mergeDuplicateContacts()

    expect(removed).toBe(1)
    expect(queryAll('SELECT * FROM contacts')).toHaveLength(1)
  })

  it('does NOT merge fuzzy / partial name matches', () => {
    seedContact({ id: 'a', name: 'Jon Snow' })
    seedContact({ id: 'b', name: 'Jonathan Snow' })
    seedContact({ id: 'c', name: 'Jon Snowden' })

    const removed = mergeDuplicateContacts()

    expect(removed).toBe(0)
    expect(queryAll('SELECT * FROM contacts')).toHaveLength(3)
  })
})

describe('assignSpeaker / getSpeakerMap / unassignSpeaker', () => {
  it('creates a contact from newName, writes the map row, and links it to the recording meeting', () => {
    seedMeeting('m1')
    seedRecording('r1', 'm1')

    const contact = assignSpeaker('r1', 'Speaker 1', { newName: 'Alice' })
    expect(contact.name).toBe('Alice')

    const map = getSpeakerMap('r1')
    expect(map).toEqual([{ speaker_label: 'Speaker 1', contact_id: contact.id, name: 'Alice' }])

    // linked to the recording's meeting
    const attendees = getContactsForMeeting('m1')
    expect(attendees.map((c) => c.id)).toContain(contact.id)
  })

  it('reuses an existing contact when assigning by contactId, and is idempotent per label', () => {
    seedRecording('r1', null)
    seedContact({ id: 'c1', name: 'Existing' })

    assignSpeaker('r1', 'Speaker 1', { contactId: 'c1' })
    assignSpeaker('r1', 'Speaker 1', { contactId: 'c1' }) // re-assign same label

    const map = getSpeakerMap('r1')
    expect(map).toHaveLength(1)
    expect(map[0].contact_id).toBe('c1')

    unassignSpeaker('r1', 'Speaker 1')
    expect(getSpeakerMap('r1')).toHaveLength(0)
  })

  it('throws without a contactId or newName', () => {
    seedRecording('r1', null)
    expect(() => assignSpeaker('r1', 'Speaker 1', {})).toThrow()
  })
})

describe('addMeetingAttendee / removeMeetingAttendee', () => {
  it('propagates a new email onto a name-matched contact that lacked one', () => {
    seedMeeting('m1')
    seedContact({ id: 'bob', name: 'Bob' }) // no email

    const contact = addMeetingAttendee('m1', { name: 'Bob', email: 'bob@x.com' })

    expect(contact.id).toBe('bob') // matched existing by name
    expect(getContact('bob')!.email).toBe('bob@x.com') // email propagated

    const attendees = getContactsForMeeting('m1')
    expect(attendees.map((c) => c.id)).toContain('bob')

    // attendees JSON regenerated as a projection
    const meeting = queryOne<{ attendees: string }>('SELECT attendees FROM meetings WHERE id = ?', ['m1'])
    expect(JSON.parse(meeting!.attendees)).toEqual([{ name: 'Bob', email: 'bob@x.com' }])
  })

  it('upgrades an email-matched placeholder name from the payload name', () => {
    seedMeeting('m1')
    seedContact({ id: 'carol', name: 'carol', email: 'carol@x.com' }) // placeholder name = email local-part

    const contact = addMeetingAttendee('m1', { name: 'Carol Smith', email: 'carol@x.com' })

    expect(contact.id).toBe('carol')
    expect(getContact('carol')!.name).toBe('Carol Smith')
  })

  it('creates a new contact when nothing matches, and removeMeetingAttendee unlinks + regenerates JSON', () => {
    seedMeeting('m1')

    const contact = addMeetingAttendee('m1', { name: 'Dave', email: 'dave@x.com' })
    expect(getContactsForMeeting('m1').map((c) => c.id)).toContain(contact.id)

    removeMeetingAttendee('m1', contact.id)
    expect(getContactsForMeeting('m1')).toHaveLength(0)
    const meeting = queryOne<{ attendees: string }>('SELECT attendees FROM meetings WHERE id = ?', ['m1'])
    expect(JSON.parse(meeting!.attendees)).toEqual([])
  })
})
