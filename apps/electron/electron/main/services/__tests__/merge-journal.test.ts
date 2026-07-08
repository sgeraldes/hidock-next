// @vitest-environment node

/**
 * v30 — Merge journal & unmerge (reversibility).
 *
 * Exercises the real sql.js engine (temp-file backed) so the journaling and
 * unmerge repointing are tested against actual SQL semantics: a merge records a
 * precise manifest, unmerge restores the loser and moves exactly those rows back,
 * links added after the merge stay with the keeper and are reported as orphans,
 * folded-field restore never clobbers a newer edit, and a second unmerge is rejected.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'

const dbPath = join(tmpdir(), `hidock-v30-merge-journal-${process.pid}.sqlite`)

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
  unmergeContacts,
  mergeProjects,
  unmergeProjects,
  getMergeJournal,
  getMergeImpact,
  Contact
} from '../database'

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
  run('INSERT INTO meetings (id, subject, start_time, end_time) VALUES (?, ?, ?, ?)', [
    id,
    subject,
    '2026-01-01T10:00:00.000Z',
    '2026-01-01T11:00:00.000Z'
  ])
}

function seedRecording(id: string, meetingId: string | null): void {
  run('INSERT INTO recordings (id, filename, date_recorded, meeting_id) VALUES (?, ?, ?, ?)', [
    id,
    `${id}.wav`,
    '2026-01-01T10:00:00.000Z',
    meetingId
  ])
}

function linkContact(meetingId: string, contactId: string, role = 'attendee'): void {
  run('INSERT OR IGNORE INTO meeting_contacts (meeting_id, contact_id, role) VALUES (?, ?, ?)', [
    meetingId,
    contactId,
    role
  ])
}

function seedProject(id: string, name: string, description: string | null = null, status = 'active'): void {
  run('INSERT INTO projects (id, name, description, status, created_at) VALUES (?, ?, ?, ?, ?)', [
    id,
    name,
    description,
    status,
    '2026-01-01T00:00:00.000Z'
  ])
}

function seedKnowledge(id: string): void {
  run('INSERT INTO knowledge_captures (id, title, captured_at) VALUES (?, ?, ?)', [id, `${id} title`, '2026-01-01T00:00:00.000Z'])
}

function contactMeetingIds(contactId: string): string[] {
  return queryAll<{ meeting_id: string }>(
    'SELECT meeting_id FROM meeting_contacts WHERE contact_id = ? ORDER BY meeting_id',
    [contactId]
  ).map((r) => r.meeting_id)
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

describe('contact merge journaling', () => {
  it('writes a journal row with the exact repointed manifest', () => {
    seedContact({ id: 'k', name: 'Keeper' })
    seedContact({ id: 'l', name: 'Loser' })
    seedMeeting('m1')
    seedMeeting('m2')
    seedRecording('r1', null)
    linkContact('m1', 'k') // keeper already in m1
    linkContact('m1', 'l') // collision on repoint → dropped
    linkContact('m2', 'l') // repoints cleanly
    run('INSERT INTO transcript_speakers (id, recording_id, speaker_label, contact_id) VALUES (?, ?, ?, ?)', [
      'ts1',
      'r1',
      'Speaker 1',
      'l'
    ])

    mergeContacts('k', 'l')

    const journal = getMergeJournal('contact', 'k')
    expect(journal).toHaveLength(1)
    expect(journal[0].loserName).toBe('Loser')
    expect(journal[0].loserId).toBe('l')
    expect(journal[0].undoneAt).toBeNull()

    const row = queryOne<{ repointed_manifest: string }>('SELECT repointed_manifest FROM merge_journal WHERE id = ?', [
      journal[0].id
    ])!
    const manifest = JSON.parse(row.repointed_manifest)
    expect(manifest.meetingContacts.repointed.map((r: any) => r.key)).toEqual(['m2'])
    expect(manifest.meetingContacts.collided.map((r: any) => r.key)).toEqual(['m1'])
    expect(manifest.transcriptSpeakers.repointed).toEqual(['ts1'])
    expect(manifest.keeperBefore.meetingIds).toEqual(['m1'])
  })
})

describe('unmergeContacts', () => {
  it('recreates the loser and moves the manifest rows back exactly', () => {
    seedContact({ id: 'k', name: 'Keeper', email: 'keep@x.com' })
    seedContact({ id: 'l', name: 'Loser', role: 'Engineer' })
    seedMeeting('m1')
    seedMeeting('m2')
    seedRecording('r1', null)
    linkContact('m1', 'k')
    linkContact('m1', 'l') // collision
    linkContact('m2', 'l') // repointed
    run('INSERT INTO transcript_speakers (id, recording_id, speaker_label, contact_id) VALUES (?, ?, ?, ?)', [
      'ts1',
      'r1',
      'Speaker 1',
      'l'
    ])

    mergeContacts('k', 'l')
    expect(queryOne('SELECT 1 FROM contacts WHERE id = ?', ['l'])).toBeUndefined()

    const journal = getMergeJournal('contact', 'k')
    const result = unmergeContacts(journal[0].id)

    // Loser recreated.
    const loser = queryOne<Contact>('SELECT * FROM contacts WHERE id = ?', ['l'])
    expect(loser?.name).toBe('Loser')

    // Loser has its meeting links back: m2 (repointed) + m1 (collision re-inserted).
    expect(contactMeetingIds('l')).toEqual(['m1', 'm2'])
    // Keeper keeps only its own original m1 link.
    expect(contactMeetingIds('k')).toEqual(['m1'])
    // Speaker moved back.
    expect(queryOne<{ contact_id: string }>('SELECT contact_id FROM transcript_speakers WHERE id = ?', ['ts1'])?.contact_id).toBe(
      'l'
    )
    // Merge-created alias for the loser name removed from the keeper.
    expect(queryOne('SELECT 1 FROM contact_aliases WHERE alias_norm = ? AND contact_id = ?', ['loser', 'k'])).toBeUndefined()

    expect(result.restored.meetingLinks).toBe(2)
    expect(result.restored.speakerLinks).toBe(1)
    expect(result.orphanedSinceMerge).toHaveLength(0)

    // Journal marked undone.
    expect(getMergeJournal('contact', 'k')).toHaveLength(0)
  })

  it('reports links added to the keeper after the merge as orphans (not moved back)', () => {
    seedContact({ id: 'k', name: 'Keeper' })
    seedContact({ id: 'l', name: 'Loser' })
    seedMeeting('m2')
    seedMeeting('m3', 'Post-merge sync')
    linkContact('m2', 'l') // repointed to keeper on merge

    mergeContacts('k', 'l')

    // A meeting attached to the keeper AFTER the merge — genuinely new.
    linkContact('m3', 'k')

    const journal = getMergeJournal('contact', 'k')
    const result = unmergeContacts(journal[0].id)

    // m2 went back to the loser; m3 stays on keeper and is flagged for review.
    expect(contactMeetingIds('l')).toEqual(['m2'])
    expect(contactMeetingIds('k')).toEqual(['m3'])
    expect(result.orphanedSinceMerge).toHaveLength(1)
    expect(result.orphanedSinceMerge[0]).toMatchObject({ table: 'meeting_contacts', key: 'm3', label: 'Post-merge sync' })
  })

  it('restores a folded field only when the keeper still holds the folded value', () => {
    // role null-filled from loser on both merges.
    seedContact({ id: 'k', name: 'Keeper', role: null })
    seedContact({ id: 'l', name: 'Loser', role: 'Engineer' })
    mergeContacts('k', 'l')
    expect(queryOne<Contact>('SELECT * FROM contacts WHERE id = ?', ['k'])?.role).toBe('Engineer')

    const j1 = getMergeJournal('contact', 'k')[0]
    // Keeper still holds the folded 'Engineer' → unmerge reverts role back to null.
    const r1 = unmergeContacts(j1.id)
    expect(r1.restored.fieldsRestored).toBe(1)
    expect(queryOne<Contact>('SELECT * FROM contacts WHERE id = ?', ['k'])?.role).toBeNull()

    // The first unmerge recreated 'l' from its snapshot (role 'Engineer' intact).
    // Merge again, then edit the keeper's role — unmerge must NOT clobber it.
    expect(queryOne<Contact>('SELECT * FROM contacts WHERE id = ?', ['l'])?.role).toBe('Engineer')
    mergeContacts('k', 'l')
    run('UPDATE contacts SET role = ? WHERE id = ?', ['Manager', 'k'])
    const j2 = getMergeJournal('contact', 'k')[0]
    const r2 = unmergeContacts(j2.id)
    expect(r2.restored.fieldsRestored).toBe(0)
    expect(queryOne<Contact>('SELECT * FROM contacts WHERE id = ?', ['k'])?.role).toBe('Manager')
  })

  it('rejects a second unmerge of the same journal entry', () => {
    seedContact({ id: 'k', name: 'Keeper' })
    seedContact({ id: 'l', name: 'Loser' })
    mergeContacts('k', 'l')
    const j = getMergeJournal('contact', 'k')[0]
    unmergeContacts(j.id)
    expect(() => unmergeContacts(j.id)).toThrow(/already been unmerged/)
  })

  it('fails clearly if the loser id has been reused since the merge', () => {
    seedContact({ id: 'k', name: 'Keeper' })
    seedContact({ id: 'l', name: 'Loser' })
    mergeContacts('k', 'l')
    // Someone recreated a contact with the loser's id.
    seedContact({ id: 'l', name: 'Different Loser' })
    const j = getMergeJournal('contact', 'k')[0]
    expect(() => unmergeContacts(j.id)).toThrow(/already exists/)
  })

  it('skips manifest rows that no longer exist and counts them', () => {
    seedContact({ id: 'k', name: 'Keeper' })
    seedContact({ id: 'l', name: 'Loser' })
    seedMeeting('m2')
    linkContact('m2', 'l') // repointed to keeper
    mergeContacts('k', 'l')
    // The keeper's link is removed before unmerge.
    run('DELETE FROM meeting_contacts WHERE meeting_id = ? AND contact_id = ?', ['m2', 'k'])
    const j = getMergeJournal('contact', 'k')[0]
    const result = unmergeContacts(j.id)
    expect(result.restored.meetingLinks).toBe(0)
    expect(result.restored.skipped).toBe(1)
    expect(contactMeetingIds('l')).toEqual([])
  })
})

describe('getMergeImpact', () => {
  it('counts meeting + speaker links on both sides', () => {
    seedContact({ id: 'k', name: 'Keeper' })
    seedContact({ id: 'l', name: 'Loser' })
    seedMeeting('m1')
    seedMeeting('m2')
    seedRecording('r1', null)
    linkContact('m1', 'k')
    linkContact('m2', 'k')
    linkContact('m1', 'l')
    run('INSERT INTO transcript_speakers (id, recording_id, speaker_label, contact_id) VALUES (?, ?, ?, ?)', [
      'ts1',
      'r1',
      'Speaker 1',
      'l'
    ])
    const impact = getMergeImpact('contact', 'k', 'l')
    expect(impact).toEqual({ keeper: 2, loser: 2 })
  })
})

describe('project merge journaling & unmerge', () => {
  it('journals a project merge and reverses it, restoring links and reporting orphans', () => {
    seedProject('pk', 'Keeper Project')
    seedProject('pl', 'Loser Project', 'Loser desc')
    seedMeeting('m1')
    seedMeeting('m2')
    seedMeeting('m3', 'Post-merge')
    seedKnowledge('kc1')
    run('INSERT INTO meeting_projects (meeting_id, project_id) VALUES (?, ?)', ['m1', 'pk'])
    run('INSERT INTO meeting_projects (meeting_id, project_id) VALUES (?, ?)', ['m1', 'pl']) // collision
    run('INSERT INTO meeting_projects (meeting_id, project_id) VALUES (?, ?)', ['m2', 'pl']) // repointed
    run('INSERT INTO knowledge_projects (knowledge_capture_id, project_id) VALUES (?, ?)', ['kc1', 'pl']) // repointed

    mergeProjects('pk', 'pl')
    expect(queryOne('SELECT 1 FROM projects WHERE id = ?', ['pl'])).toBeUndefined()

    // A meeting attached to the keeper project after the merge.
    run('INSERT INTO meeting_projects (meeting_id, project_id) VALUES (?, ?)', ['m3', 'pk'])

    const journal = getMergeJournal('project', 'pk')
    expect(journal).toHaveLength(1)
    const result = unmergeProjects(journal[0].id)

    expect(queryOne('SELECT 1 FROM projects WHERE id = ?', ['pl'])).toBeTruthy()
    const loserMeetings = queryAll<{ meeting_id: string }>(
      'SELECT meeting_id FROM meeting_projects WHERE project_id = ? ORDER BY meeting_id',
      ['pl']
    ).map((r) => r.meeting_id)
    expect(loserMeetings).toEqual(['m1', 'm2']) // m2 back + m1 collision re-inserted
    expect(
      queryOne<{ project_id: string }>('SELECT project_id FROM knowledge_projects WHERE knowledge_capture_id = ?', ['kc1'])
        ?.project_id
    ).toBe('pl')
    expect(result.restored.knowledgeLinks).toBe(1)
    expect(result.orphanedSinceMerge.map((o) => o.key)).toEqual(['m3'])
  })
})
