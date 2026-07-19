// @vitest-environment node

import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'
import { createRequire } from 'node:module'
import { DatabaseEngine } from '@hidock/database'
import { KnowledgeGraphStore, type GraphDb } from '../src/graph-store.js'

// The engine requires the app-owned better-sqlite3 native module. Resolve the
// database package's OWN copy (the one CI's "npm rebuild better-sqlite3"
// Node-ABI restore step targets) so resolution never depends on hoisting.
const requireFromDatabase = createRequire(new URL('../../database/package.json', import.meta.url))
const BetterSqlite3 = requireFromDatabase('better-sqlite3')

/** Engines opened by makeStore — closed in afterEach so temp DBs can be deleted. */
const openEngines: DatabaseEngine[] = []

function tempPath(name: string) {
  return join(tmpdir(), `hidock-kg-store-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`)
}

async function makeStore(name: string) {
  const dbPath = tempPath(name)
  const engine = new DatabaseEngine({
    betterSqlite3: BetterSqlite3,
    dbPathProvider: () => dbPath,
    schemaVersion: 1,
    schema: 'CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)',
    migrations: {},
  })
  await engine.initialize()
  openEngines.push(engine)
  const store = new KnowledgeGraphStore(engine)
  store.initSchema()
  return { store, engine, dbPath }
}

describe('KnowledgeGraphStore', () => {
  const paths: string[] = []

  afterEach(() => {
    // better-sqlite3 holds the DB file open — close engines first, or rmSync
    // EPERMs on Windows and stale state leaks into the next run.
    for (const e of openEngines) {
      try { e.closeDatabase() } catch { /* already closed */ }
    }
    openEngines.length = 0
    for (const p of paths) {
      for (const f of [p, `${p}-wal`, `${p}-shm`]) {
        if (existsSync(f)) rmSync(f, { force: true })
      }
    }
    paths.length = 0
  })

  it('upserts a node and returns deterministic id', async () => {
    const { store, dbPath } = await makeStore('upsert-node')
    paths.push(dbPath)

    const id1 = store.upsertNode({ type: 'person', label: 'Alice Smith' })
    const id2 = store.upsertNode({ type: 'person', label: 'Alice Smith' })
    expect(id1).toBe(id2)
    expect(id1).toMatch(/^person:/)
  })

  it('dedupes nodes: same person twice → one node', async () => {
    const { store, engine, dbPath } = await makeStore('dedup-node')
    paths.push(dbPath)

    store.upsertNode({ type: 'person', label: 'Bob Jones' })
    store.upsertNode({ type: 'person', label: 'Bob Jones' })

    const nodes = engine.queryAll('SELECT * FROM graph_nodes WHERE type = ?', ['person'])
    expect(nodes).toHaveLength(1)
  })

  it('entity resolution by norm_key: case/whitespace variants → same node', async () => {
    const { store, engine, dbPath } = await makeStore('norm-key')
    paths.push(dbPath)

    const id1 = store.upsertNode({ type: 'person', label: 'Carol White' })
    const id2 = store.upsertNode({ type: 'person', label: '  carol  white  ' })
    const id3 = store.upsertNode({ type: 'person', label: 'CAROL WHITE' })
    expect(id1).toBe(id2)
    expect(id2).toBe(id3)

    const nodes = engine.queryAll('SELECT * FROM graph_nodes WHERE type = ?', ['person'])
    expect(nodes).toHaveLength(1)
  })

  it('bumps edge weight on repeated upsertEdge', async () => {
    const { store, engine, dbPath } = await makeStore('edge-weight')
    paths.push(dbPath)

    const personId = store.upsertNode({ type: 'person', label: 'Dave' })
    const meetingId = store.upsertNode({ type: 'meeting', label: 'Weekly Sync' })

    const eid1 = store.upsertEdge({ sourceId: personId, targetId: meetingId, type: 'ATTENDED' })
    const eid2 = store.upsertEdge({ sourceId: personId, targetId: meetingId, type: 'ATTENDED' })
    expect(eid1).toBe(eid2)

    const edge = engine.queryOne<{ weight: number }>('SELECT weight FROM graph_edges WHERE id = ?', [eid1])
    expect(edge?.weight).toBe(2)
  })

  it('neighbors returns connected nodes', async () => {
    const { store, dbPath } = await makeStore('neighbors')
    paths.push(dbPath)

    const personId = store.upsertNode({ type: 'person', label: 'Eve' })
    const meetingId = store.upsertNode({ type: 'meeting', label: 'Planning' })
    store.upsertEdge({ sourceId: personId, targetId: meetingId, type: 'ATTENDED' })

    const neighborsOfPerson = store.neighbors(personId)
    expect(neighborsOfPerson.map((n) => n.id)).toContain(meetingId)
  })

  it('neighbors filtered by edgeType', async () => {
    const { store, dbPath } = await makeStore('neighbors-type')
    paths.push(dbPath)

    const personId = store.upsertNode({ type: 'person', label: 'Frank' })
    const meetingId = store.upsertNode({ type: 'meeting', label: 'Sprint Review' })
    const skillId = store.upsertNode({ type: 'skill', label: 'TypeScript' })
    store.upsertEdge({ sourceId: personId, targetId: meetingId, type: 'ATTENDED' })
    store.upsertEdge({ sourceId: personId, targetId: skillId, type: 'DEMONSTRATED' })

    const meetings = store.neighbors(personId, 'ATTENDED')
    expect(meetings.map((n) => n.id)).toContain(meetingId)
    expect(meetings.map((n) => n.id)).not.toContain(skillId)
  })

  it('clear removes all nodes and edges', async () => {
    const { store, engine, dbPath } = await makeStore('clear')
    paths.push(dbPath)

    store.upsertNode({ type: 'person', label: 'Grace' })
    store.clear()

    const nodes = engine.queryAll('SELECT * FROM graph_nodes')
    const edges = engine.queryAll('SELECT * FROM graph_edges')
    expect(nodes).toHaveLength(0)
    expect(edges).toHaveLength(0)
  })

  it('clear (CX-T4-3) also removes graph_edge_sources — a rebuilt graph inherits no stale provenance', async () => {
    const { store, engine, dbPath } = await makeStore('clear-sources')
    paths.push(dbPath)

    const person = store.upsertNode({ type: 'person', label: 'Grace' })
    const meeting = store.upsertNode({ type: 'meeting', label: 'Sync' })
    const edgeId = store.upsertEdge({ sourceId: person, targetId: meeting, type: 'ATTENDED' })
    store.recordEdgeSource(edgeId, 'R-old', 'T-old')

    store.clear()
    expect(engine.queryAll('SELECT * FROM graph_edge_sources')).toHaveLength(0)

    // Re-ingesting the identical pair mints the SAME deterministic edge id —
    // it must start with no provenance.
    const p2 = store.upsertNode({ type: 'person', label: 'Grace' })
    const m2 = store.upsertNode({ type: 'meeting', label: 'Sync' })
    const edgeId2 = store.upsertEdge({ sourceId: p2, targetId: m2, type: 'ATTENDED' })
    expect(edgeId2).toBe(edgeId)
    expect(engine.queryAll('SELECT * FROM graph_edge_sources WHERE edge_id = ?', [edgeId2])).toHaveLength(0)
  })

  it('id is deterministic (no Date.now/random): topic:machine_learning', async () => {
    const { store, dbPath } = await makeStore('deterministic')
    paths.push(dbPath)

    const id1 = store.upsertNode({ type: 'topic', label: 'Machine Learning' })
    const id2 = store.upsertNode({ type: 'topic', label: 'Machine Learning' })
    expect(id1).toBe(id2)
    expect(id1).toBe('topic:machine_learning')
  })

  it('getNode returns the node', async () => {
    const { store, dbPath } = await makeStore('get-node')
    paths.push(dbPath)

    const id = store.upsertNode({ type: 'person', label: 'Helen' })
    const node = store.getNode(id)
    expect(node?.label).toBe('Helen')
    expect(node?.type).toBe('person')
  })

  it('findNodes by type returns matching nodes', async () => {
    const { store, dbPath } = await makeStore('find-nodes')
    paths.push(dbPath)

    store.upsertNode({ type: 'person', label: 'Ivan' })
    store.upsertNode({ type: 'person', label: 'Julia' })
    store.upsertNode({ type: 'topic', label: 'AI' })

    const people = store.findNodes({ type: 'person' })
    expect(people).toHaveLength(2)
    expect(people.every((n) => n.type === 'person')).toBe(true)
  })

  // --- Edge id collisions --------------------------------------------------
  // makeEdgeId() slugs the (source, target, type) triple. Historically the
  // slug dropped uppercase edge types entirely (every type collapsed to '_'),
  // and it still truncates at 120 chars, so two DISTINCT triples can slug
  // identically. Without clash handling this threw "UNIQUE constraint failed:
  // graph_edges.id" and permanently aborted transcript ingest (14 transcripts
  // stuck in production, each retried with a fresh LLM extraction every
  // cycle). The type is now folded to lowercase and kept in the slug; the
  // hashed-variant fallback still covers truncation collisions.

  it('same (source,target) pair with different UPPERCASE types → two distinct edges', async () => {
    const { store, engine, dbPath } = await makeStore('edge-type-collide')
    paths.push(dbPath)

    // 'ABOUT' and 'OWNS' used to slugify to the same '_' and collide; the type
    // now survives in the slug, so the ids differ without the hash fallback.
    const meetingId = store.upsertNode({ type: 'meeting', label: 'Sync' })
    const topicId = store.upsertNode({ type: 'topic', label: 'Roadmap' })
    const e1 = store.upsertEdge({ sourceId: meetingId, targetId: topicId, type: 'ABOUT' })
    const e2 = store.upsertEdge({ sourceId: meetingId, targetId: topicId, type: 'OWNS' })

    expect(e1).not.toBe(e2)
    expect(engine.queryAll('SELECT id FROM graph_edges')).toHaveLength(2)
  })

  it('edge id encodes its type and does not depend on insertion order', async () => {
    const { store, engine, dbPath } = await makeStore('edge-id-type-slug')
    paths.push(dbPath)

    const personId = store.upsertNode({ type: 'person', label: 'Hana' })
    const meetingId = store.upsertNode({ type: 'meeting', label: 'Kickoff' })
    const attended = store.upsertEdge({ sourceId: personId, targetId: meetingId, type: 'ATTENDED' })
    const mentioned = store.upsertEdge({ sourceId: personId, targetId: meetingId, type: 'MENTIONED' })

    // Both edges persist under ids that spell out their own type — not a bare
    // '_' plus a hash suffix for whichever type happened to arrive second.
    expect(attended).not.toBe(mentioned)
    expect(attended).toContain('attended')
    expect(mentioned).toContain('mentioned')
    expect(engine.queryAll('SELECT id FROM graph_edges')).toHaveLength(2)

    // Same triples ingested in the opposite order → the very same ids. Anything
    // that keys on edge id (e.g. provenance rows) must not depend on which
    // extraction happened to run first.
    const reversed = await makeStore('edge-id-type-slug-reversed')
    paths.push(reversed.dbPath)
    const p2 = reversed.store.upsertNode({ type: 'person', label: 'Hana' })
    const m2 = reversed.store.upsertNode({ type: 'meeting', label: 'Kickoff' })
    const mentioned2 = reversed.store.upsertEdge({ sourceId: p2, targetId: m2, type: 'MENTIONED' })
    const attended2 = reversed.store.upsertEdge({ sourceId: p2, targetId: m2, type: 'ATTENDED' })
    expect(attended2).toBe(attended)
    expect(mentioned2).toBe(mentioned)
  })

  it('triples differing only beyond the 120-char id truncation → two distinct edges', async () => {
    const { store, engine, dbPath } = await makeStore('edge-truncate-collide')
    paths.push(dbPath)

    // source(109) + '|||' fills the slug to char 112; the targets' distinguishing
    // suffix falls past the 120-char cut, so both triples slug identically.
    const longSource = `decision:${'x'.repeat(100)}`
    const e1 = store.upsertEdge({ sourceId: longSource, targetId: 'meeting:aaa1', type: 'MADE_IN' })
    const e2 = store.upsertEdge({ sourceId: longSource, targetId: 'meeting:aaa2', type: 'MADE_IN' })

    expect(e1).not.toBe(e2)
    // Both rows kept their true triple — nothing was folded into the other edge.
    const rows = engine.queryAll<{ target_id: string }>(
      'SELECT target_id FROM graph_edges ORDER BY target_id'
    )
    expect(rows.map((r) => r.target_id)).toEqual(['meeting:aaa1', 'meeting:aaa2'])
  })

  it('two long same-prefix decisions in one meeting both keep their MADE_IN edge', async () => {
    const { store, engine, dbPath } = await makeStore('edge-prod-repro')
    paths.push(dbPath)

    // Distinct decision texts sharing a 64+ char prefix: upsertNode already
    // disambiguates the node ids; the edges built from them must both survive.
    const prefix = 'a compromise will be made to update and validate the current process '
    const d1 = store.upsertNode({ type: 'decision', label: `${prefix}for humano` })
    const d2 = store.upsertNode({ type: 'decision', label: `${prefix}for mibanco` })
    expect(d1).not.toBe(d2)

    const meetingId = store.upsertNode({ type: 'meeting', label: '38a08773-39d2-43ee-a94e-b45946eb9999' })
    const e1 = store.upsertEdge({ sourceId: d1, targetId: meetingId, type: 'MADE_IN' })
    const e2 = store.upsertEdge({ sourceId: d2, targetId: meetingId, type: 'MADE_IN' })

    expect(e1).not.toBe(e2)
    expect(engine.queryAll('SELECT id FROM graph_edges')).toHaveLength(2)
  })

  it('a derived suffix id that is ALREADY taken is skipped for the next candidate', async () => {
    const { store, engine, dbPath } = await makeStore('edge-suffix-collide')
    paths.push(dbPath)

    // Base collision pair: the edge type now survives in the slug, so same-pair
    // different-type edges no longer collide — force the remaining lossy case
    // instead: two triples identical up to the 120-char truncation cut.
    const longSource = `decision:${'x'.repeat(100)}`
    const e1 = store.upsertEdge({ sourceId: longSource, targetId: 'meeting:aaa1', type: 'MADE_IN' })

    // Preoccupy the FIRST candidate upsertEdge would derive for the second
    // triple (base + '__' + fnv1a(combined)) with an unrelated row — the
    // derivation must be collision-checked too, not inserted blindly.
    const combined = `${longSource}|||meeting:aaa2|||MADE_IN`
    const firstCandidate = `${e1}__${fnv1a36(combined)}`
    engine.run(
      'INSERT INTO graph_edges (id, source_id, target_id, type, props, weight, created_at) VALUES (?, ?, ?, ?, NULL, 1, ?)',
      [firstCandidate, 'person:zzz', 'risk:zzz', 'RAISED', 't']
    )

    const e2 = store.upsertEdge({ sourceId: longSource, targetId: 'meeting:aaa2', type: 'MADE_IN' })

    expect(e2).not.toBe(e1)
    expect(e2).not.toBe(firstCandidate)
    // The loop advanced to the '#1' candidate rather than crashing or reusing a
    // taken id.
    expect(e2).toBe(`${e1}__${fnv1a36(`${combined}#1`)}`)
    expect(engine.queryAll('SELECT id FROM graph_edges')).toHaveLength(3)
  })
})

// spec-006/F17 T6 AR3-3(b): initSchema() previously swallowed EVERY error from
// EVERY DDL statement (a blanket try/catch with an empty catch block), on the
// theory that IF NOT EXISTS makes them idempotent. That masks a genuine
// failure (corrupt DB, disk full, permission denied, a future schema-edit
// typo) as silent success. It must now tolerate ONLY an "already exists"
// message and re-throw everything else. Uses a hand-written GraphDb stub
// (not a real engine) so a specific statement can be made to fail on demand.
describe('KnowledgeGraphStore.initSchema — DDL error surfacing (AR3-3b)', () => {
  function makeFailingDb(shouldFail: (sql: string) => Error | null): GraphDb {
    return {
      run(sql: string) {
        const err = shouldFail(sql)
        if (err) throw err
      },
      queryAll: () => [],
      queryOne: () => undefined,
    }
  }

  it('tolerates an "already exists" error and keeps running the remaining statements', () => {
    let ranCount = 0
    const db = makeFailingDb((sql) => {
      ranCount++
      return sql.includes('graph_nodes') ? new Error('table graph_nodes already exists') : null
    })
    const store = new KnowledgeGraphStore(db)
    expect(() => store.initSchema()).not.toThrow()
    // More than one statement ran — the loop didn't stop at the tolerated error.
    expect(ranCount).toBeGreaterThan(1)
  })

  it('is case-insensitive when matching "already exists"', () => {
    const db = makeFailingDb((sql) => (sql.includes('graph_nodes') ? new Error('Table Graph_Nodes ALREADY EXISTS') : null))
    const store = new KnowledgeGraphStore(db)
    expect(() => store.initSchema()).not.toThrow()
  })

  it('surfaces (does not swallow) a non-"already exists" DDL failure', () => {
    const db = makeFailingDb((sql) => (sql.includes('graph_edges') ? new Error('disk I/O error') : null))
    const store = new KnowledgeGraphStore(db)
    expect(() => store.initSchema()).toThrow('disk I/O error')
  })

  it('surfaces a non-Error throw (stringified) as well', () => {
    const db: GraphDb = {
      run(sql: string) {
        if (sql.includes('graph_nodes')) throw 'weird string throw'
      },
      queryAll: () => [],
      queryOne: () => undefined,
    }
    const store = new KnowledgeGraphStore(db)
    expect(() => store.initSchema()).toThrow()
  })
})

/**
 * Mirror of graph-store's private shortHash (FNV-1a → base36), duplicated on
 * purpose so the suffix-collision test can preoccupy the exact id the store
 * derives. If the store's hash changes, this test fails loudly — update both.
 */
function fnv1a36(input: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}
