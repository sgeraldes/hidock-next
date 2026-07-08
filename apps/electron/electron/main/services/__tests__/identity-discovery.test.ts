/**
 * Discovery sweep (Round 4b) — batch identity-merge discovery for People and Projects.
 *
 * Runs against a real in-memory sql.js DB. The '../database' module is mocked to
 * delegate queryAll/queryOne to it and to write identity_suggestions via a real
 * INSERT (so the UNIQUE(kind, candidate_name, target_id) idempotency is exercised).
 * The graph tables are created so the topic-overlap signal has something to read.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import initSqlJs from 'sql.js'
import { randomUUID } from 'crypto'

let dbInstance: any = null

function rowsFrom(result: any[]): any[] {
  if (!result || result.length === 0) return []
  const { columns, values } = result[0]
  return values.map((v: any[]) => {
    const row: any = {}
    columns.forEach((c: string, i: number) => (row[c] = v[i]))
    return row
  })
}

vi.mock('../database', () => ({
  queryAll: (sql: string, params: any[] = []) => (dbInstance ? rowsFrom(dbInstance.exec(sql, params)) : []),
  queryOne: (sql: string, params: any[] = []) => {
    if (!dbInstance) return undefined
    return rowsFrom(dbInstance.exec(sql, params))[0]
  },
  insertIdentitySuggestion: (
    kind: string,
    candidateName: string,
    targetId: string,
    confidence: number,
    evidence: Record<string, unknown>
  ) => {
    dbInstance.run(
      `INSERT OR IGNORE INTO identity_suggestions
         (id, kind, candidate_name, target_id, confidence, evidence, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [randomUUID(), kind, candidateName, targetId, confidence, JSON.stringify(evidence ?? {}), new Date().toISOString()]
    )
  },
}))

import { discoverContactMerges, discoverProjectMerges } from '../identity-discovery'

function seedSchema(): void {
  dbInstance.run(`
    CREATE TABLE contacts (
      id TEXT PRIMARY KEY, name TEXT, email TEXT, type TEXT, role TEXT, company TEXT,
      notes TEXT, tags TEXT, first_seen_at TEXT, last_seen_at TEXT, meeting_count INTEGER DEFAULT 0,
      created_at TEXT
    );
    CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, description TEXT, status TEXT, created_at TEXT);
    CREATE TABLE contact_aliases (id TEXT PRIMARY KEY, alias_norm TEXT UNIQUE, contact_id TEXT, source TEXT, confidence REAL);
    CREATE TABLE project_aliases (id TEXT PRIMARY KEY, alias_norm TEXT UNIQUE, project_id TEXT, source TEXT, confidence REAL);
    CREATE TABLE meeting_contacts (meeting_id TEXT, contact_id TEXT, role TEXT);
    CREATE TABLE meeting_projects (meeting_id TEXT, project_id TEXT);
    CREATE TABLE identity_suggestions (
      id TEXT PRIMARY KEY, kind TEXT, candidate_name TEXT, target_id TEXT, confidence REAL,
      evidence TEXT, status TEXT DEFAULT 'pending', created_at TEXT,
      UNIQUE(kind, candidate_name, target_id)
    );
    CREATE TABLE graph_nodes (id TEXT PRIMARY KEY, type TEXT, label TEXT, norm_key TEXT, props TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE graph_edges (id TEXT PRIMARY KEY, source_id TEXT, target_id TEXT, type TEXT, props TEXT, weight REAL, created_at TEXT);
  `)
}

function addContact(id: string, name: string, opts: { email?: string; role?: string; meetings?: number } = {}): void {
  dbInstance.run(
    `INSERT INTO contacts (id, name, email, type, role, first_seen_at, last_seen_at, meeting_count, created_at)
     VALUES (?, ?, ?, 'team', ?, '2026-01-01', '2026-01-01', ?, '2026-01-01T00:00:00Z')`,
    [id, name, opts.email ?? null, opts.role ?? null, opts.meetings ?? 0]
  )
}

function link(meetingId: string, contactId: string): void {
  dbInstance.run('INSERT INTO meeting_contacts (meeting_id, contact_id, role) VALUES (?, ?, ?)', [
    meetingId,
    contactId,
    'attendee',
  ])
}

function suggestions(): any[] {
  return rowsFrom(dbInstance.exec('SELECT * FROM identity_suggestions'))
}

describe('identity-discovery — contacts', () => {
  beforeEach(async () => {
    const SQL = await initSqlJs()
    dbInstance = new SQL.Database()
    seedSchema()
  })

  afterEach(() => {
    if (dbInstance) dbInstance.close()
    dbInstance = null
  })

  it('suggests Edu/Eduardo (shared role + shared meetings) with the right evidence signals', () => {
    addContact('c-edu', 'Edu', { role: 'Project Manager', meetings: 2 })
    addContact('c-eduardo', 'Eduardo', { role: 'PM', meetings: 3 })
    link('m1', 'c-edu')
    link('m1', 'c-eduardo')
    link('m2', 'c-edu')
    link('m2', 'c-eduardo')

    const res = discoverContactMerges()
    expect(res.candidatePairs).toBeGreaterThanOrEqual(1)
    expect(res.suggestionsCreated).toBe(1)

    const rows = suggestions()
    expect(rows).toHaveLength(1)
    const s = rows[0]
    expect(s.kind).toBe('person')
    // Keeper = richer contact (Eduardo, 3 meetings); candidate_name = loser (Edu).
    expect(s.target_id).toBe('c-eduardo')
    expect(s.candidate_name).toBe('Edu')

    const ev = JSON.parse(s.evidence)
    expect(ev.signals.name).toBeGreaterThan(0)
    expect(ev.signals.role).toBeGreaterThan(0) // PM ≈ Project Manager
    expect(ev.signals.graph).toBeGreaterThan(0) // shared meetings
    expect(ev.sharedMeetings).toBe(2)
    expect(ev.roleOverlap).toEqual(expect.arrayContaining(['project', 'manager']))
    expect(ev.autoMergeable).toBe(false)
    expect(Number(s.confidence)).toBeGreaterThanOrEqual(0.5)
  })

  it('never suggests a pair blocked by a rejected alias', () => {
    addContact('c-edu', 'Edu', { role: 'Project Manager', meetings: 2 })
    addContact('c-eduardo', 'Eduardo', { role: 'PM', meetings: 3 })
    link('m1', 'c-edu')
    link('m1', 'c-eduardo')
    // User previously rejected "Edu" ↦ Eduardo.
    dbInstance.run(
      `INSERT INTO contact_aliases (id, alias_norm, contact_id, source, confidence) VALUES (?, 'edu', 'c-eduardo', 'rejected', 0)`,
      [randomUUID()]
    )

    const res = discoverContactMerges()
    expect(res.suggestionsCreated).toBe(0)
    expect(suggestions()).toHaveLength(0)
  })

  it('marks same-email stragglers autoMergeable even with divergent display names', () => {
    addContact('c-a', 'Eduardo Ruiz', { email: 'e.ruiz@dfx5.com', meetings: 5 })
    addContact('c-b', 'E. Ruiz', { email: 'e.ruiz@dfx5.com', meetings: 1 })

    const res = discoverContactMerges()
    expect(res.suggestionsCreated).toBe(1)
    expect(res.autoMergeable).toBe(1)

    const ev = JSON.parse(suggestions()[0].evidence)
    expect(ev.autoMergeable).toBe(true)
    expect(ev.emailMatch).toBe('exact')
    expect(Number(suggestions()[0].confidence)).toBeGreaterThanOrEqual(0.95)
  })

  it('does not suggest an opposite-gender Spanish pair on name alone', () => {
    // Fernando/Fernanda share a name bucket and are an edit-distance-1 match, but the
    // gender penalty keeps the name-only composite under the suggestion threshold.
    addContact('c-fo', 'Fernando', { meetings: 2 })
    addContact('c-fa', 'Fernanda', { meetings: 2 })

    const res = discoverContactMerges()
    expect(res.candidatePairs).toBeGreaterThanOrEqual(1)
    expect(res.suggestionsCreated).toBe(0)
  })

  it('still suggests an opposite-gender pair when a shared email corroborates it', () => {
    addContact('c-fo', 'Fernando', { email: 'f.pair@dfx5.com', meetings: 2 })
    addContact('c-fa', 'Fernanda', { email: 'f.pair@dfx5.com', meetings: 1 })

    const res = discoverContactMerges()
    expect(res.suggestionsCreated).toBe(1)
    expect(JSON.parse(suggestions()[0].evidence).emailMatch).toBe('exact')
  })

  it('does not pair clearly-unrelated names (no shared bucket)', () => {
    addContact('c-alice', 'Alice Johnson', { role: 'Designer', meetings: 3 })
    addContact('c-bob', 'Bob Smith', { role: 'Engineer', meetings: 3 })

    const res = discoverContactMerges()
    expect(res.candidatePairs).toBe(0)
    expect(res.suggestionsCreated).toBe(0)
  })

  it('is idempotent — a second sweep creates no duplicate suggestion', () => {
    addContact('c-edu', 'Edu', { role: 'Project Manager', meetings: 2 })
    addContact('c-eduardo', 'Eduardo', { role: 'PM', meetings: 3 })
    link('m1', 'c-edu')
    link('m1', 'c-eduardo')

    discoverContactMerges()
    const second = discoverContactMerges()
    expect(second.suggestionsCreated).toBe(0)
    expect(suggestions()).toHaveLength(1)
  })
})

describe('identity-discovery — projects', () => {
  beforeEach(async () => {
    const SQL = await initSqlJs()
    dbInstance = new SQL.Database()
    seedSchema()
  })

  afterEach(() => {
    if (dbInstance) dbInstance.close()
    dbInstance = null
  })

  function addProject(id: string, name: string): void {
    dbInstance.run(
      `INSERT INTO projects (id, name, status, created_at) VALUES (?, ?, 'active', '2026-01-01T00:00:00Z')`,
      [id, name]
    )
  }

  function linkProject(meetingId: string, projectId: string): void {
    dbInstance.run('INSERT INTO meeting_projects (meeting_id, project_id) VALUES (?, ?)', [meetingId, projectId])
  }

  it('suggests a project pair with name similarity + shared-meeting overlap', () => {
    addProject('p-a', 'WebRTC Gateway')
    addProject('p-b', 'WebRTC Gateways')
    linkProject('m1', 'p-a')
    linkProject('m1', 'p-b')
    linkProject('m2', 'p-a')
    linkProject('m2', 'p-b')

    const res = discoverProjectMerges()
    expect(res.suggestionsCreated).toBe(1)
    const rows = suggestions()
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('project')
    const ev = JSON.parse(rows[0].evidence)
    expect(ev.signals.name).toBeGreaterThan(0)
    expect(ev.signals.graph).toBeGreaterThan(0)
    expect(ev.autoMergeable).toBe(false) // projects never auto-merge (no email corroboration)
    expect(ev.sharedMeetings).toBe(2)
  })

  it('does not pair unrelated projects', () => {
    addProject('p-a', 'Atlas Migration')
    addProject('p-b', 'Quarterly Budget')
    const res = discoverProjectMerges()
    expect(res.candidatePairs).toBe(0)
    expect(res.suggestionsCreated).toBe(0)
  })
})
