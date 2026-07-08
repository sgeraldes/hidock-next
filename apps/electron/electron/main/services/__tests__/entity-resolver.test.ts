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
  getProjectById: (id: string) => (dbInstance ? rowsFrom(dbInstance.exec('SELECT * FROM projects WHERE id = ?', [id]))[0] : undefined)
}))

import { resolveContact, resolveProject } from '../entity-resolver'

describe('entity-resolver', () => {
  beforeEach(async () => {
    const SQL = await initSqlJs()
    dbInstance = new SQL.Database()
    dbInstance.run(`
      CREATE TABLE contacts (id TEXT PRIMARY KEY, name TEXT, email TEXT);
      CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT);
      CREATE TABLE contact_aliases (id TEXT PRIMARY KEY, alias_norm TEXT UNIQUE, contact_id TEXT, source TEXT, confidence REAL);
      CREATE TABLE project_aliases (id TEXT PRIMARY KEY, alias_norm TEXT UNIQUE, project_id TEXT, source TEXT, confidence REAL);
      CREATE TABLE meeting_contacts (meeting_id TEXT, contact_id TEXT, role TEXT);
      CREATE TABLE meeting_projects (meeting_id TEXT, project_id TEXT);

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
    dbInstance.run("INSERT INTO meeting_contacts (meeting_id, contact_id, role) VALUES ('m1', 'c-seb', 'attendee')")
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
})
