/**
 * getPersonContext (Round 4c) — graph-neighborhood context for the merge card.
 *
 * Exercises the real database.ts (real sql.js engine) end to end: co-attendees are
 * ranked by shared-meeting count; topics come from the knowledge graph when the
 * person has a node, and fall back to meeting_projects transitively otherwise; a
 * bare name resolves the same as an id.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, unlinkSync } from 'fs'

const dbPath = join(tmpdir(), `hidock-person-context-test-${Date.now()}.db`)
vi.mock('../file-storage', () => ({ getDatabasePath: () => dbPath }))

import { initializeDatabase, closeDatabase, run, getPersonContext } from '../database'

function contact(id: string, name: string): void {
  run(
    `INSERT INTO contacts (id, name, type, first_seen_at, last_seen_at, meeting_count)
     VALUES (?, ?, 'unknown', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 0)`,
    [id, name]
  )
}
function meeting(id: string): void {
  run(`INSERT INTO meetings (id, subject, start_time, end_time) VALUES (?, ?, '2026-01-02T10:00:00Z', '2026-01-02T11:00:00Z')`, [id, id])
}
function attend(meetingId: string, contactId: string): void {
  run(`INSERT INTO meeting_contacts (meeting_id, contact_id, role) VALUES (?, ?, 'attendee')`, [meetingId, contactId])
}
function project(id: string, name: string): void {
  run(`INSERT INTO projects (id, name, status) VALUES (?, ?, 'active')`, [id, name])
}
function tagProject(meetingId: string, projectId: string): void {
  run(`INSERT INTO meeting_projects (meeting_id, project_id) VALUES (?, ?)`, [meetingId, projectId])
}
function node(id: string, type: string, label: string, normKey: string): void {
  run(
    `INSERT INTO graph_nodes (id, type, label, norm_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
    [id, type, label, normKey]
  )
}
function edge(id: string, source: string, target: string, type: string): void {
  run(
    `INSERT INTO graph_edges (id, source_id, target_id, type, created_at) VALUES (?, ?, ?, ?, '2026-01-01T00:00:00Z')`,
    [id, source, target, type]
  )
}

describe('getPersonContext', () => {
  beforeAll(async () => {
    await initializeDatabase()

    // The knowledge graph tables are created by the graph service after the first
    // ingest, not by the base schema — create them so the graph path can be tested.
    run(`CREATE TABLE IF NOT EXISTS graph_nodes (
      id TEXT PRIMARY KEY, type TEXT, label TEXT, norm_key TEXT, props TEXT, created_at TEXT, updated_at TEXT
    )`)
    run(`CREATE TABLE IF NOT EXISTS graph_edges (
      id TEXT PRIMARY KEY, source_id TEXT, target_id TEXT, type TEXT, props TEXT, weight REAL, created_at TEXT
    )`)

    // Meetings + attendees. Alice co-attends with Bob twice and Carol once.
    contact('c-alice', 'Alice')
    contact('c-bob', 'Bob')
    contact('c-carol', 'Carol')
    contact('c-dave', 'Dave') // never co-attends — must not appear
    for (const m of ['m1', 'm2', 'm3']) meeting(m)
    attend('m1', 'c-alice'); attend('m1', 'c-bob'); attend('m1', 'c-carol')
    attend('m2', 'c-alice'); attend('m2', 'c-bob')
    attend('m3', 'c-dave')

    // meeting_projects fallback for topics.
    project('p-atlas', 'Atlas')
    tagProject('m1', 'p-atlas')

    // Graph path for a person WITH a node (Bob → ATTENDED → meeting → ABOUT → topic).
    node('n-bob', 'person', 'Bob', 'bob')
    node('n-mtg', 'meeting', 'Kickoff', 'kickoff')
    node('n-topic', 'topic', 'Latency', 'latency')
    edge('e1', 'n-bob', 'n-mtg', 'ATTENDED')
    edge('e2', 'n-mtg', 'n-topic', 'ABOUT')
  })

  afterAll(() => {
    closeDatabase()
    if (existsSync(dbPath)) {
      try { unlinkSync(dbPath) } catch { /* ignore */ }
    }
  })

  it('ranks co-attendees by shared-meeting count and excludes non-co-attendees', () => {
    const ctx = getPersonContext('c-alice')
    // Bob (2 shared) before Carol (1 shared); Dave never shares a meeting.
    expect(ctx.people).toEqual(['Bob', 'Carol'])
    expect(ctx.people).not.toContain('Dave')
    expect(ctx.people).not.toContain('Alice') // never lists self
  })

  it('resolves a bare name the same as an id', () => {
    expect(getPersonContext('alice').people).toEqual(['Bob', 'Carol'])
  })

  it('falls back to meeting_projects for topics when the person has no graph node', () => {
    // Alice has no graph node → topics come transitively from her meetings' projects.
    expect(getPersonContext('c-alice').topics).toContain('Atlas')
  })

  it('uses the knowledge graph for topics when the person has a node', () => {
    // Bob has a person node with an ABOUT-topic path.
    expect(getPersonContext('c-bob').topics).toContain('Latency')
  })

  it('returns empty context for an unknown name', () => {
    expect(getPersonContext('Nobody At All')).toEqual({ people: [], topics: [] })
  })
})
