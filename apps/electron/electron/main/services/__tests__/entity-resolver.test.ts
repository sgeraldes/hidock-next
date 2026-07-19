/**
 * Confidence-scored entity resolver (Round 4a).
 *
 * Runs the resolver against a real in-memory sql.js DB (the '../database' module
 * is mocked to delegate queryAll/queryOne/getById to it), exercising every tier:
 * email → exact name → alias → accent-fold → fuzzy(+context) → rejected-block.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import initSqlJs from 'sql.js'

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
  getContactById: (id: string) => (dbInstance ? rowsFrom(dbInstance.exec('SELECT * FROM contacts WHERE id = ?', [id]))[0] : undefined),
  getProjectById: (id: string) => (dbInstance ? rowsFrom(dbInstance.exec('SELECT * FROM projects WHERE id = ?', [id]))[0] : undefined),
  // ADV27-3 (round-28): the resolver now gates co-occurrence context through this
  // per-row membership boundary. Mirror the structural rule (calendar/user-authored
  // eligible; transcript rows would need a recording lookup, not modeled here; NULL
  // legacy ineligible). These tests insert 'calendar' memberships so they contribute.
  filterEligibleMembershipRows: (rows: Array<{ source?: string | null }>) => ({
    eligible: rows.filter((r) => r.source != null && r.source !== 'transcript'),
    failClosed: false
  }),
  // ADV29-1 (round-31): the resolver now bars SUPPRESSED entities as link targets.
  // These tier-logic fixtures are all genuine resolvable people/projects, so treat
  // every candidate as visible. The no-reanimation behavior is exercised against a
  // real DB in entity-resolver-reanimation.round31.test.ts.
  filterVisibleEntityIds: (_kind: string, ids: Iterable<string>) => ({
    visible: new Set([...ids]),
    failClosed: false
  })
}))

import { resolveContact, resolveProject } from '../entity-resolver'

describe('entity-resolver', () => {
  beforeEach(async () => {
    const SQL = await initSqlJs()
    dbInstance = new SQL.Database()
    dbInstance.run(`
      CREATE TABLE contacts (id TEXT PRIMARY KEY, name TEXT, email TEXT, created_at TEXT);
      CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, created_at TEXT);
      CREATE TABLE contact_aliases (id TEXT PRIMARY KEY, alias_norm TEXT UNIQUE, contact_id TEXT, source TEXT, confidence REAL);
      CREATE TABLE project_aliases (id TEXT PRIMARY KEY, alias_norm TEXT UNIQUE, project_id TEXT, source TEXT, confidence REAL);
      CREATE TABLE meeting_contacts (meeting_id TEXT, contact_id TEXT, role TEXT, source TEXT, source_recording_id TEXT);
      CREATE TABLE meeting_projects (meeting_id TEXT, project_id TEXT, source TEXT, source_recording_id TEXT);

      INSERT INTO contacts (id, name, email) VALUES
        ('c-seb', 'Sebastián Geraldes', 'sebastian.geraldes@dfx5.com'),
        ('c-oscar', 'Oscar Ruiz', NULL),
        ('c-edu', 'Eduardo Vera', NULL);
      INSERT INTO projects (id, name) VALUES
        ('p-atlas', 'Project Atlas'),
        ('p-webrtc', 'WebRTC Gateway');
    `)
  })

  afterEach(() => {
    if (dbInstance) dbInstance.close()
    dbInstance = null
  })

  it('resolves an exact email at 1.0', () => {
    const r = resolveContact('sebastian.geraldes@dfx5.com')
    expect(r).toEqual({ id: 'c-seb', confidence: 1.0, method: 'email' })
  })

  it('resolves an exact case-insensitive name at 0.95', () => {
    const r = resolveContact('sebastián geraldes')
    expect(r.id).toBe('c-seb')
    expect(r.confidence).toBe(0.95)
    expect(r.method).toBe('exact-name')
  })

  it('resolves via the alias table using the stored confidence', () => {
    dbInstance.run("INSERT INTO contact_aliases (id, alias_norm, contact_id, source, confidence) VALUES ('a1', 'sebas', 'c-seb', 'merge', 1.0)")
    const r = resolveContact('Sebas')
    expect(r.id).toBe('c-seb')
    expect(r.confidence).toBe(1.0)
    expect(r.method).toBe('alias')
  })

  it('resolves an accent/diacritic variant at 0.85', () => {
    const r = resolveContact('Óscar Ruiz')
    expect(r.id).toBe('c-oscar')
    expect(r.confidence).toBe(0.85)
    expect(r.method).toBe('accent')
  })

  it('fuzzy match without context stays in the suggestion band', () => {
    const r = resolveContact('Sebastan Geraldes') // lev 1 vs "Sebastián Geraldes"
    expect(r.id).toBe('c-seb')
    expect(r.method).toBe('fuzzy')
    expect(r.confidence).toBeGreaterThanOrEqual(0.6)
    expect(r.confidence).toBeLessThan(0.8)
  })

  it('context co-occurrence boosts a fuzzy match into auto-link range', () => {
    dbInstance.run("INSERT INTO meeting_contacts (meeting_id, contact_id, role, source) VALUES ('m1', 'c-seb', 'attendee', 'calendar')")
    const r = resolveContact('Sebastan Geraldes', { meetingId: 'm1' })
    expect(r.id).toBe('c-seb')
    expect(r.method).toBe('fuzzy-context')
    expect(r.confidence).toBeGreaterThanOrEqual(0.8)
  })

  it('a rejected alias blocks resolving that name to the paired contact', () => {
    dbInstance.run("INSERT INTO contact_aliases (id, alias_norm, contact_id, source, confidence) VALUES ('r1', 'sebas', 'c-seb', 'rejected', 0)")
    const r = resolveContact('Sebas') // would otherwise prefix-fuzzy to c-seb
    expect(r.id).toBeNull()
    expect(r.method).toBe('none')
  })

  it('returns no-match for an unknown name', () => {
    const r = resolveContact('Totally Unknown Person')
    expect(r.id).toBeNull()
    expect(r.confidence).toBe(0)
  })

  it('resolves projects by exact name and alias, no email tier', () => {
    expect(resolveProject('project atlas')).toMatchObject({ id: 'p-atlas', method: 'exact-name' })
    dbInstance.run("INSERT INTO project_aliases (id, alias_norm, project_id, source, confidence) VALUES ('pa1', 'atlas', 'p-atlas', 'merge', 0.9)")
    const r = resolveProject('Atlas')
    expect(r.id).toBe('p-atlas')
    expect(r.method).toBe('alias')
  })

  /**
   * Short-acronym cross-linking. The length-gated edit-distance rule alone was
   * not enough: the separate PREFIX rule still scored "crm" vs "crmx" at 0.68,
   * and the co-occurrence boost (+0.15) carried it to 0.83 — over the 0.8
   * auto-link line — silently attaching a distinct acronym project to another in
   * the same meeting. Both projects are linked to the meeting here so the
   * context boost is genuinely in play.
   */
  it('does not auto-link a short acronym project onto a prefix sibling, even with co-occurrence context', () => {
    dbInstance.run(`
      INSERT INTO projects (id, name) VALUES ('p-crm', 'CRM');
      INSERT INTO meeting_projects (meeting_id, project_id) VALUES ('m-ctx', 'p-crm');
    `)
    const r = resolveProject('CRMX', { meetingId: 'm-ctx' })
    expect(r.confidence).toBeLessThan(0.8) // never auto-links
    expect(r.id).toBeNull() // and is not even a fuzzy candidate
  })

  it('still resolves a genuine prefix expansion of a long-enough name', () => {
    dbInstance.run("INSERT INTO projects (id, name) VALUES ('p-plat', 'Plataforma')")
    // "plataforma" -> "plataformadepagos": a real expansion, not a 1-char variant.
    const r = resolveProject('Plataformadepagos')
    expect(r.id).toBe('p-plat')
    expect(r.confidence).toBeGreaterThan(0.6)
  })

  it('resolves a project whose stored name differs only by Unicode form (NFKC-exact, tier 1b)', () => {
    // Stored decomposed (e + U+0301), queried composed (U+00E9): SQLite's
    // ASCII-only LOWER can't equate them and tier 3 skips pNorm === norm, so
    // without the NFKC-exact scan this mention would resolve to nothing and the
    // reconciler would auto-create a byte-twin project.
    const decomposed = 'Café Project'
    const composed = 'Café Project'
    expect(decomposed).not.toBe(composed)
    dbInstance.run("INSERT INTO projects (id, name) VALUES ('p-cafe', ?)", [decomposed])
    const r = resolveProject(composed)
    expect(r.id).toBe('p-cafe')
    expect(r.confidence).toBe(0.95)
    expect(r.method).toBe('exact-name')
  })

  it('NFKC-exact project name beats a competing positive alias with the same key (tier 1b before tier 2)', () => {
    // A project stored under the decomposed form of the name...
    const decomposed = 'Café Project'
    const composed = 'Café Project'
    expect(decomposed).not.toBe(composed)
    dbInstance.run("INSERT INTO projects (id, name) VALUES ('p-cafe', ?)", [decomposed])
    // ...and a positive alias for the SAME NFKC key pointing at a DIFFERENT project.
    dbInstance.run(
      "INSERT INTO project_aliases (id, alias_norm, project_id, source, confidence) VALUES ('pa-hijack', ?, 'p-atlas', 'merge', 1.0)",
      [composed.normalize('NFKC').toLowerCase()]
    )
    // The project's own exact name must win — the same precedence the SQL
    // exact tier gives ASCII names over aliases. Resolving to p-atlas here
    // would be wrong-project linkage under an exact-name confidence contract.
    const r = resolveProject(composed)
    expect(r.id).toBe('p-cafe')
    expect(r.method).toBe('exact-name')
    expect(r.confidence).toBe(0.95)
  })

  describe('ambiguous bare first names', () => {
    beforeEach(() => {
      dbInstance.run(`
        INSERT INTO contacts (id, name, email) VALUES
          ('c-sh', 'Sergio Hurtado', NULL),
          ('c-sr', 'Sergio Reyes', NULL);
      `)
    })

    it('never auto-links a bare first name matching two surname-bearers (no context)', () => {
      const r = resolveContact('Sergio')
      expect(r.ambiguous).toBe(true)
      expect(r.method).toBe('ambiguous-bucket')
      expect(r.confidence).toBeLessThan(0.5)
      expect(r.id).toBeNull() // no literal "Sergio" contact exists to return
    })

    it('splits by attendee context when exactly one candidate attended', () => {
      dbInstance.run("INSERT INTO meeting_contacts (meeting_id, contact_id, role, source) VALUES ('m1', 'c-sh', 'attendee', 'calendar')")
      const r = resolveContact('Sergio', { meetingId: 'm1' })
      expect(r).toEqual({ id: 'c-sh', confidence: 0.85, method: 'attendee-context' })
    })

    it('stays ambiguous when two candidates both attended (cannot decide)', () => {
      dbInstance.run(`
        INSERT INTO meeting_contacts (meeting_id, contact_id, role, source) VALUES
          ('m1', 'c-sh', 'attendee', 'calendar'), ('m1', 'c-sr', 'attendee', 'calendar');
      `)
      const r = resolveContact('Sergio', { meetingId: 'm1' })
      expect(r.ambiguous).toBe(true)
      expect(r.method).toBe('ambiguous-bucket')
    })

    it('treats a nickname (Sergi) as the same ambiguous bucket', () => {
      const r = resolveContact('Sergi')
      expect(r.ambiguous).toBe(true)
    })

    it('returns the existing bucket contact (flagged) when a literal bare-name row exists', () => {
      dbInstance.run("INSERT INTO contacts (id, name, email) VALUES ('c-bucket', 'Sergio', NULL)")
      const r = resolveContact('Sergio')
      expect(r.ambiguous).toBe(true)
      expect(r.id).toBe('c-bucket')
      expect(r.confidence).toBeLessThan(0.5)
    })

    it('does NOT flag a bare name that matches only one surname-bearer', () => {
      // Only "Oscar Ruiz" bears the Oscar first name → not a bucket.
      const r = resolveContact('Oscar')
      expect(r.ambiguous).toBeUndefined()
    })

    it('a user-settled positive alias wins over the ambiguity guard', () => {
      dbInstance.run("INSERT INTO contact_aliases (id, alias_norm, contact_id, source, confidence) VALUES ('a1', 'sergio', 'c-sh', 'manual', 1.0)")
      const r = resolveContact('Sergio')
      expect(r.id).toBe('c-sh')
      expect(r.method).toBe('alias')
      expect(r.ambiguous).toBeUndefined()
    })
  })
})
