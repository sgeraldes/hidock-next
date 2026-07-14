// @vitest-environment node

import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'
import Database from 'better-sqlite3'
import { DatabaseEngine } from '@hidock/database'
import { KnowledgeGraphStore } from '../src/graph-store.js'
import { ingestExtraction, type PersonResolver } from '../src/ingest.js'
import {
  fullGraph,
  neighborhood,
  pruneGenericNodes,
  DEFAULT_OVERVIEW_NODE_LIMIT,
} from '../src/queries.js'
import type { ExtractionResult, ExtractionMeta } from '../src/extract.js'

function tempPath(name: string) {
  return join(tmpdir(), `hidock-kg-ctx-${name}-${Date.now()}.sqlite`)
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
  return { store, dbPath }
}

function closeEngines(): void {
  for (const e of engines) {
    try {
      e.closeDatabase()
    } catch {
      /* already closed */
    }
  }
  engines.length = 0
}

const meta: ExtractionMeta = { meetingId: 'mtg-001', title: 'Kickoff', date: '2026-06-01' }
const meta2: ExtractionMeta = { meetingId: 'mtg-002', title: 'Review', date: '2026-06-02' }

describe('Context Graph: contact-keyed ingest', () => {
  const paths: string[] = []
  afterEach(() => {
    closeEngines()
    for (const p of paths) if (existsSync(p)) rmSync(p, { force: true })
    paths.length = 0
  })

  it('folds two name variants of the same contact into ONE contact-keyed node', async () => {
    const { store, dbPath } = await makeStore('rekey')
    paths.push(dbPath)

    // Both variants resolve to the same contact id.
    const resolvePerson: PersonResolver = (name) => {
      if (/alice/i.test(name)) return { id: 'c-alice', label: 'Alice Smith' }
      return null
    }

    const m1: ExtractionResult = {
      people: [{ name: 'Alice', skills: [] }],
      topics: [], projects: [], decisions: [], action_items: [], risks: [], next_steps: [],
    }
    const m2: ExtractionResult = {
      people: [{ name: 'Alice Smith', skills: [] }],
      topics: [], projects: [], decisions: [], action_items: [], risks: [], next_steps: [],
    }
    ingestExtraction(store, m1, meta, { resolvePerson })
    ingestExtraction(store, m2, meta2, { resolvePerson })

    const people = store.findNodes({ type: 'person' })
    expect(people).toHaveLength(1)
    const node = people[0]
    expect(node.norm_key).toBe('contact:c-alice')
    expect(node.id.startsWith('person:contact_')).toBe(true)
    const props = JSON.parse(node.props ?? '{}')
    expect(props.contactId).toBe('c-alice')
    // Attended both meetings.
    expect(node.label).toBe('Alice Smith')
  })

  it('falls back to name-keyed when the resolver returns null (legacy behaviour)', async () => {
    const { store, dbPath } = await makeStore('fallback')
    paths.push(dbPath)
    const resolvePerson: PersonResolver = () => null
    const m: ExtractionResult = {
      people: [{ name: 'Zoltan', skills: [] }],
      topics: [], projects: [], decisions: [], action_items: [], risks: [], next_steps: [],
    }
    ingestExtraction(store, m, meta, { resolvePerson })
    const [node] = store.findNodes({ type: 'person' })
    expect(node.norm_key).toBe('zoltan')
    expect(node.id).toBe('person:zoltan')
  })

  it('legacy string 4th argument (now) still works', async () => {
    const { store, dbPath } = await makeStore('legacy-now')
    paths.push(dbPath)
    const m: ExtractionResult = {
      people: [{ name: 'Bob', skills: [] }],
      topics: [], projects: [], decisions: [], action_items: [], risks: [], next_steps: [],
    }
    ingestExtraction(store, m, meta, '2026-06-01T00:00:00Z')
    const [node] = store.findNodes({ type: 'person' })
    expect(node.label).toBe('Bob')
    expect(node.created_at).toBe('2026-06-01T00:00:00Z')
  })
})

describe('Context Graph: upsert id-collision fix', () => {
  const paths: string[] = []
  afterEach(() => {
    closeEngines()
    for (const p of paths) if (existsSync(p)) rmSync(p, { force: true })
    paths.length = 0
  })

  it('two distinct norm_keys that slugify to the same id both insert without throwing', async () => {
    const { store, dbPath } = await makeStore('collision')
    paths.push(dbPath)

    // 'A/B' and 'A.B' have different norm_keys ('a/b' vs 'a.b') but both slugify
    // to id 'topic:a_b'. Before the fix this threw UNIQUE constraint failed.
    const id1 = store.upsertNode({ type: 'topic', label: 'A/B' })
    const id2 = store.upsertNode({ type: 'topic', label: 'A.B' })

    expect(id1).not.toBe(id2)
    const topics = store.findNodes({ type: 'topic' })
    expect(topics).toHaveLength(2)

    // Re-upserting the same labels is idempotent (dedups on norm_key).
    const id1again = store.upsertNode({ type: 'topic', label: 'A/B' })
    expect(id1again).toBe(id1)
    expect(store.findNodes({ type: 'topic' })).toHaveLength(2)
  })
})

describe('Context Graph: neighborhood + fullGraph traversal', () => {
  const paths: string[] = []
  afterEach(() => {
    closeEngines()
    for (const p of paths) if (existsSync(p)) rmSync(p, { force: true })
    paths.length = 0
  })

  async function seed(name: string) {
    const { store, dbPath } = await makeStore(name)
    paths.push(dbPath)
    const m: ExtractionResult = {
      people: [{ name: 'Alice', skills: ['SQL'] }, { name: 'Bob', skills: [] }],
      topics: ['Roadmap'],
      projects: ['Phoenix'],
      decisions: [],
      action_items: [],
      risks: [],
      next_steps: [],
    }
    ingestExtraction(store, m, meta)
    return store
  }

  it('neighborhood(person, 1) reaches the meeting but not the meeting topics', async () => {
    const store = await seed('nbr-1')
    const alice = store.findNodes({ type: 'person' }).find((n) => n.label === 'Alice')!
    const sub = neighborhood(store, alice.id, 1)
    expect(sub.center?.id).toBe(alice.id)
    const types = new Set(sub.nodes.map((n) => n.type))
    expect(types.has('meeting')).toBe(true)
    // 1 hop from Alice: the meeting + Alice's skill; NOT the meeting's topic.
    expect(sub.nodes.some((n) => n.type === 'topic')).toBe(false)
  })

  it('neighborhood(person, 2) reaches topics/projects through the meeting', async () => {
    const store = await seed('nbr-2')
    const alice = store.findNodes({ type: 'person' }).find((n) => n.label === 'Alice')!
    const sub = neighborhood(store, alice.id, 2)
    const types = new Set(sub.nodes.map((n) => n.type))
    expect(types.has('topic')).toBe(true)
    expect(types.has('project')).toBe(true)
    // Nodes carry a degree annotation.
    expect(sub.nodes.every((n) => typeof n.degree === 'number')).toBe(true)
  })

  it('neighborhood returns empty for an unknown node id', async () => {
    const store = await seed('nbr-missing')
    const sub = neighborhood(store, 'person:nobody', 2)
    expect(sub.center).toBeUndefined()
    expect(sub.nodes).toHaveLength(0)
    expect(sub.edges).toHaveLength(0)
  })

  it('fullGraph annotates degree and caps by limit keeping hubs', async () => {
    const store = await seed('full')
    const all = fullGraph(store)
    expect(all.nodes.length).toBeGreaterThan(3)
    const meetingNode = all.nodes.find((n) => n.type === 'meeting')!
    // The meeting connects to everything — it is the highest-degree hub.
    expect(meetingNode.degree).toBeGreaterThanOrEqual(4)

    const capped = fullGraph(store, 2)
    expect(capped.nodes).toHaveLength(2)
    // Every retained edge connects two retained nodes.
    const kept = new Set(capped.nodes.map((n) => n.id))
    expect(capped.edges.every((e) => kept.has(e.source_id) && kept.has(e.target_id))).toBe(true)
  })
})

describe('Context Graph: top-N overview default selection', () => {
  const paths: string[] = []
  afterEach(() => {
    closeEngines()
    for (const p of paths) if (existsSync(p)) rmSync(p, { force: true })
    paths.length = 0
  })

  it('DEFAULT_OVERVIEW_NODE_LIMIT is a small, digestible cap', () => {
    expect(DEFAULT_OVERVIEW_NODE_LIMIT).toBeGreaterThan(0)
    expect(DEFAULT_OVERVIEW_NODE_LIMIT).toBeLessThanOrEqual(300)
  })

  it('overview keeps exactly the top-N HIGHEST-degree nodes (hubs)', async () => {
    const { store, dbPath } = await makeStore('topn')
    paths.push(dbPath)

    // A hub node connected to many leaves has the highest degree; each leaf has
    // degree 1. With N=3 the overview must retain the hub + 2 leaves = 3 nodes,
    // and the hub must be among them.
    const hub = store.upsertNode({ type: 'topic', label: 'Hub' })
    const leafIds: string[] = []
    for (let i = 0; i < 8; i++) {
      const leaf = store.upsertNode({ type: 'person', label: `Leaf ${i}` })
      leafIds.push(leaf)
      store.upsertEdge({ sourceId: hub, targetId: leaf, type: 'ABOUT' })
    }

    const sub = fullGraph(store, 3)
    expect(sub.nodes).toHaveLength(3)
    const ids = sub.nodes.map((n) => n.id)
    expect(ids).toContain(hub)
    // The hub is the single highest-degree node.
    const top = [...sub.nodes].sort((a, b) => b.degree - a.degree)[0]
    expect(top.id).toBe(hub)
    expect(top.degree).toBe(8)
  })
})

describe('Context Graph: generic-node pruning', () => {
  const paths: string[] = []
  afterEach(() => {
    closeEngines()
    for (const p of paths) if (existsSync(p)) rmSync(p, { force: true })
    paths.length = 0
  })

  it('prunes generic person nodes + their edges, and is idempotent', async () => {
    const { store, dbPath } = await makeStore('prune')
    paths.push(dbPath)

    const extraction: ExtractionResult = {
      // "All attendees" / "Team" are generic — but seed them directly to simulate
      // pre-existing garbage from before the ingest-time stop-list existed.
      people: [{ name: 'Alice', skills: [] }],
      topics: [], projects: [], decisions: [], action_items: [], risks: [], next_steps: [],
    }
    ingestExtraction(store, extraction, meta)

    // Inject legacy garbage person nodes with edges to the meeting.
    const meetingId = store.findNodes({ type: 'meeting' })[0].id
    for (const label of ['All attendees', 'Team', 'el equipo']) {
      const gid = store.upsertNode({ type: 'person', label })
      store.upsertEdge({ sourceId: gid, targetId: meetingId, type: 'ATTENDED' })
    }

    expect(store.findNodes({ type: 'person' })).toHaveLength(4) // Alice + 3 garbage

    const res = pruneGenericNodes(store)
    expect(res.removedNodes).toBe(3)
    expect(res.removedEdges).toBe(3)

    const remaining = store.findNodes({ type: 'person' })
    expect(remaining).toHaveLength(1)
    expect(remaining[0].label).toBe('Alice')
    // No dangling edges reference a removed node.
    const edges = store.db.queryAll<{ source_id: string; target_id: string }>(
      'SELECT source_id, target_id FROM graph_edges'
    )
    const nodeIds = new Set(store.db.queryAll<{ id: string }>('SELECT id FROM graph_nodes').map((r) => r.id))
    expect(edges.every((e) => nodeIds.has(e.source_id) && nodeIds.has(e.target_id))).toBe(true)

    // Idempotent: a second pass removes nothing.
    const res2 = pruneGenericNodes(store)
    expect(res2.removedNodes).toBe(0)
    expect(res2.removedEdges).toBe(0)
  })

  it("pruneGenericNodes (CX-T4-3) cascades the pruned edges' graph_edge_sources rows", async () => {
    const { store, dbPath } = await makeStore('prune-sources')
    paths.push(dbPath)

    ingestExtraction(
      store,
      {
        people: [{ name: 'Alice', skills: [] }],
        topics: [], projects: [], decisions: [], action_items: [], risks: [], next_steps: [],
      },
      meta,
      { recordingId: 'rec-1', transcriptId: 'tx-1' }
    )

    // Inject a generic person with a provenance-bearing edge to the meeting.
    const meetingId = store.findNodes({ type: 'meeting' })[0].id
    const garbage = store.upsertNode({ type: 'person', label: 'All attendees' })
    const garbageEdge = store.upsertEdge({ sourceId: garbage, targetId: meetingId, type: 'ATTENDED' })
    store.recordEdgeSource(garbageEdge, 'rec-1', 'tx-1')

    const before = store.db.queryAll('SELECT * FROM graph_edge_sources').length
    const res = pruneGenericNodes(store)
    expect(res.removedNodes).toBe(1)

    // Exactly the pruned edge's row is gone; Alice's edges keep theirs.
    const after = store.db.queryAll('SELECT * FROM graph_edge_sources').length
    expect(after).toBe(before - 1)
    expect(
      store.db.queryAll('SELECT * FROM graph_edge_sources WHERE edge_id = ?', [garbageEdge])
    ).toHaveLength(0)
  })
})

describe('Context Graph: ingest-time stop-list', () => {
  const paths: string[] = []
  afterEach(() => {
    closeEngines()
    for (const p of paths) if (existsSync(p)) rmSync(p, { force: true })
    paths.length = 0
  })

  it('skips generic collective/role people (EN + ES) at ingest', async () => {
    const { store, dbPath } = await makeStore('ingest-skip')
    paths.push(dbPath)

    const extraction: ExtractionResult = {
      people: [
        { name: 'Mario', skills: [] },
        { name: 'All attendees', skills: [] },
        { name: 'Team', skills: [] },
        { name: 'todos', skills: [] },
        { name: 'Gerente de proyecto', skills: [] },
      ],
      topics: [],
      projects: [],
      decisions: [],
      action_items: [{ text: 'Ship it', owner: 'All team members' }],
      risks: [],
      next_steps: [],
    }
    ingestExtraction(store, extraction, meta)

    const people = store.findNodes({ type: 'person' })
    expect(people).toHaveLength(1)
    expect(people[0].label).toBe('Mario')

    // The action item still exists, but has no OWNS edge (generic owner dropped).
    expect(store.findNodes({ type: 'action_item' })).toHaveLength(1)
    const ownsEdges = store.db.queryAll<{ id: string }>(
      "SELECT id FROM graph_edges WHERE type = 'OWNS'"
    )
    expect(ownsEdges).toHaveLength(0)
  })
})
