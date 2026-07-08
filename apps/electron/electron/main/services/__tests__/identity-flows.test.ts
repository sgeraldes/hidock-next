/**
 * Alias memory + suggestion accept/reject (Round 4a) — integration.
 *
 * Exercises the real database.ts (real sql.js engine, schema v27) end to end:
 * merging/speaker-assigning writes aliases, and accepting/rejecting a suggestion
 * writes the alias + link (or the rejected block) and flips the status.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, unlinkSync } from 'fs'

const dbPath = join(tmpdir(), `hidock-identity-test-${Date.now()}.db`)
vi.mock('../file-storage', () => ({ getDatabasePath: () => dbPath }))

import {
  initializeDatabase,
  closeDatabase,
  run,
  queryOne,
  mergeContacts,
  assignSpeaker,
  insertIdentitySuggestion,
  getIdentitySuggestions,
  acceptIdentitySuggestion,
  rejectIdentitySuggestion,
  getMergeJournal,
  unmergeContacts,
  getMentionSnippets
} from '../database'

interface AliasRow {
  alias_norm: string
  contact_id: string
  source: string
  confidence: number
}

function contact(id: string, name: string): void {
  run(
    `INSERT INTO contacts (id, name, type, first_seen_at, last_seen_at, meeting_count)
     VALUES (?, ?, 'unknown', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 0)`,
    [id, name]
  )
}

describe('alias memory + identity suggestion flows', () => {
  beforeAll(async () => {
    await initializeDatabase()
    run(
      `INSERT INTO meetings (id, subject, start_time, end_time) VALUES ('m1', 'Sync', '2026-01-02T10:00:00Z', '2026-01-02T11:00:00Z')`
    )
    run(
      `INSERT INTO recordings (id, filename, date_recorded, status) VALUES ('rec1', 'Rec1.wav', '2026-01-02T10:00:00Z', 'complete')`
    )
  })

  afterAll(() => {
    closeDatabase()
    if (existsSync(dbPath)) {
      try { unlinkSync(dbPath) } catch { /* ignore */ }
    }
  })

  it('mergeContacts records the loser name as a merge alias of the keeper', () => {
    contact('k1', 'Sebastián Geraldes')
    contact('l1', 'Seba')
    mergeContacts('k1', 'l1')

    const alias = queryOne<AliasRow>('SELECT * FROM contact_aliases WHERE alias_norm = ?', ['seba'])
    expect(alias).toBeDefined()
    expect(alias!.contact_id).toBe('k1')
    expect(alias!.source).toBe('merge')
    expect(alias!.confidence).toBe(1.0)
  })

  it('assignSpeaker aliases a non-generic label but not a generic one', () => {
    contact('k2', 'Javier Díaz')
    assignSpeaker('rec1', 'Javier', { contactId: 'k2' })
    const named = queryOne<AliasRow>('SELECT * FROM contact_aliases WHERE alias_norm = ?', ['javier'])
    expect(named).toBeDefined()
    expect(named!.contact_id).toBe('k2')
    expect(named!.source).toBe('speaker_assign')
    expect(named!.confidence).toBe(0.95)

    assignSpeaker('rec1', 'Speaker 2', { contactId: 'k2' })
    const generic = queryOne<AliasRow>('SELECT * FROM contact_aliases WHERE alias_norm = ?', ['speaker 2'])
    expect(generic).toBeUndefined()
  })

  it('accepting a person suggestion writes a manual alias, links the meeting, and marks accepted', () => {
    contact('k3', 'Mónica Rossi')
    insertIdentitySuggestion('person', 'Moni', 'k3', 0.65, { method: 'fuzzy', meetingId: 'm1' })
    const pending = getIdentitySuggestions('pending').find((s) => s.candidate_name === 'Moni')
    expect(pending).toBeDefined()

    const accepted = acceptIdentitySuggestion(pending!.id)
    expect(accepted.status).toBe('accepted')

    const alias = queryOne<AliasRow>('SELECT * FROM contact_aliases WHERE alias_norm = ?', ['moni'])
    expect(alias?.contact_id).toBe('k3')
    expect(alias?.source).toBe('manual')
    expect(alias?.confidence).toBe(1.0)

    const link = queryOne<{ contact_id: string }>(
      'SELECT contact_id FROM meeting_contacts WHERE meeting_id = ? AND contact_id = ?',
      ['m1', 'k3']
    )
    expect(link).toBeDefined()
  })

  it('rejecting a person suggestion writes a rejected-alias block and marks rejected', () => {
    contact('k4', 'Roberto Sá')
    insertIdentitySuggestion('person', 'Beto', 'k4', 0.6, { method: 'fuzzy' })
    const pending = getIdentitySuggestions('pending').find((s) => s.candidate_name === 'Beto')
    expect(pending).toBeDefined()

    const rejected = rejectIdentitySuggestion(pending!.id)
    expect(rejected.status).toBe('rejected')

    const alias = queryOne<AliasRow>('SELECT * FROM contact_aliases WHERE alias_norm = ?', ['beto'])
    expect(alias?.contact_id).toBe('k4')
    expect(alias?.source).toBe('rejected')
  })

  it('accepting a discovery suggestion merges the loser, returns the journal id, and is undoable', () => {
    contact('k5', 'Yaraví Garcia')
    contact('l5', 'Yeraví Garcia')
    insertIdentitySuggestion('person', 'Yeraví Garcia', 'k5', 0.82, {
      keeperId: 'k5',
      loserId: 'l5',
      keeperName: 'Yaraví Garcia',
      loserName: 'Yeraví Garcia'
    })
    const pending = getIdentitySuggestions('pending').find((s) => s.candidate_name === 'Yeraví Garcia')!

    const accepted = acceptIdentitySuggestion(pending.id)
    expect(accepted.status).toBe('accepted')
    expect(accepted.mergeJournalId).toBeTruthy()

    // Loser merged away; the journal row is real and reverses the merge.
    expect(queryOne('SELECT id FROM contacts WHERE id = ?', ['l5'])).toBeUndefined()
    const journal = getMergeJournal('contact', 'k5')
    expect(journal.some((j) => j.id === accepted.mergeJournalId)).toBe(true)

    unmergeContacts(accepted.mergeJournalId!)
    expect(queryOne('SELECT id FROM contacts WHERE id = ?', ['l5'])).toBeDefined()
  })

  it('supersedes sibling pending suggestions that reference the merged-away loser', () => {
    contact('k6', 'Marina Duarte')
    contact('l6', 'Marín Duarte')
    contact('k7', 'Other Keeper')

    // The accepted pairing: fold l6 into k6.
    insertIdentitySuggestion('person', 'Marín Duarte', 'k6', 0.83, { keeperId: 'k6', loserId: 'l6' })
    // Sibling A: l6 is itself a keeper in another suggestion (its keeper vanishes on merge).
    insertIdentitySuggestion('person', 'Marina D', 'l6', 0.7, {})
    // Sibling B: another suggestion proposes merging the same loser elsewhere.
    insertIdentitySuggestion('person', 'Marín Duarte', 'k7', 0.6, { keeperId: 'k7', loserId: 'l6' })

    const target = getIdentitySuggestions('pending').find((s) => s.target_id === 'k6' && s.candidate_name === 'Marín Duarte')!
    const result = acceptIdentitySuggestion(target.id)
    expect(result.supersededCount).toBe(2)

    // Both siblings are now rejected + flagged superseded, and no longer pending.
    const stillPending = getIdentitySuggestions('pending')
    expect(stillPending.some((s) => s.target_id === 'l6')).toBe(false)
    expect(stillPending.some((s) => s.target_id === 'k7' && s.candidate_name === 'Marín Duarte')).toBe(false)

    const siblingB = getIdentitySuggestions('rejected').find(
      (s) => s.target_id === 'k7' && s.candidate_name === 'Marín Duarte'
    )!
    expect(JSON.parse(siblingB.evidence!).superseded).toBe(true)
  })

  it('getMentionSnippets returns a windowed excerpt and every matching recording', () => {
    run(`INSERT INTO recordings (id, filename, date_recorded, status) VALUES ('rec-y1','Y1.wav','2026-02-01T10:00:00Z','complete')`)
    run(`INSERT INTO recordings (id, filename, date_recorded, status) VALUES ('rec-y2','Y2.wav','2026-02-02T10:00:00Z','complete')`)
    const long = 'x'.repeat(300) + ' Yaravi said hello ' + 'y'.repeat(300)
    run(`INSERT INTO transcripts (id, recording_id, full_text) VALUES ('t-y1','rec-y1',?)`, [long])
    run(`INSERT INTO transcripts (id, recording_id, full_text) VALUES ('t-y2','rec-y2','Only Yaravi here')`)

    const res = getMentionSnippets('Yaravi', 2)
    expect([...res.recordingIds].sort()).toEqual(['rec-y1', 'rec-y2'])
    expect(res.snippets.length).toBe(2)
    const s = res.snippets.find((x) => x.recordingId === 'rec-y1')!
    expect(s.snippet).toContain('Yaravi')
    expect(s.snippet.length).toBeLessThan(200) // windowed, not the 600+ char source
    expect(s.snippet.startsWith('…')).toBe(true)
    expect(s.snippet.endsWith('…')).toBe(true)
  })

  it('getMentionSnippets treats LIKE wildcards in the name as literal', () => {
    run(`INSERT INTO recordings (id, filename, date_recorded, status) VALUES ('rec-pct','P.wav','2026-02-03T10:00:00Z','complete')`)
    run(`INSERT INTO transcripts (id, recording_id, full_text) VALUES ('t-pct','rec-pct','we hit literal 50% today')`)
    run(`INSERT INTO recordings (id, filename, date_recorded, status) VALUES ('rec-no','N.wav','2026-02-03T11:00:00Z','complete')`)
    run(`INSERT INTO transcripts (id, recording_id, full_text) VALUES ('t-no','rec-no','meet in room 5000 downstairs')`)

    const res = getMentionSnippets('50%', 5)
    // '%' escaped → only the literal '50%' matches; the unescaped pattern would also hit '5000'.
    expect(res.recordingIds).toContain('rec-pct')
    expect(res.recordingIds).not.toContain('rec-no')
  })

  it('co-presence: two names in one transcript share a recording id', () => {
    run(`INSERT INTO recordings (id, filename, date_recorded, status) VALUES ('rec-both','B.wav','2026-02-04T10:00:00Z','complete')`)
    run(`INSERT INTO transcripts (id, recording_id, full_text) VALUES ('t-both','rec-both','Yeru and Saru both spoke today')`)

    const a = getMentionSnippets('Yeru', 5)
    const b = getMentionSnippets('Saru', 5)
    const shared = a.recordingIds.filter((id) => b.recordingIds.includes(id))
    expect(shared).toContain('rec-both')
  })
})
