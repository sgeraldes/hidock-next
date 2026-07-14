// @vitest-environment node

import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'
import Database from 'better-sqlite3'
import { DatabaseEngine } from '@hidock/database'
import { KnowledgeGraphStore } from '../src/graph-store.js'

function tempPath(name: string) {
  return join(tmpdir(), `hidock-kg-store-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`)
}

// better-sqlite3 (unlike the old sql.js engine) holds a native OS file handle
// open until closeDatabase() runs — on Windows, rmSync() on a still-open file
// fails with EPERM. Track every engine created by makeStore() and close them
// all before removing files.
const engines: DatabaseEngine[] = []

async function makeStore(name: string) {
  const dbPath = tempPath(name)
  const engine = new DatabaseEngine({
    betterSqlite3: Database,
    dbPathProvider: () => dbPath,
    schemaVersion: 1,
    schema: 'CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)',
    migrations: {},
  })
  await engine.initialize()
  engines.push(engine)
  const store = new KnowledgeGraphStore(engine)
  store.initSchema()
  return { store, engine, dbPath }
}

describe('KnowledgeGraphStore', () => {
  const paths: string[] = []

  afterEach(() => {
    for (const e of engines) {
      try {
        e.closeDatabase()
      } catch {
        /* already closed */
      }
    }
    engines.length = 0
    for (const p of paths) {
      if (existsSync(p)) rmSync(p, { force: true })
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
})
