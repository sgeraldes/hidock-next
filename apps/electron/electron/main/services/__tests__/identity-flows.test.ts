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
  rejectIdentitySuggestion
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
})
