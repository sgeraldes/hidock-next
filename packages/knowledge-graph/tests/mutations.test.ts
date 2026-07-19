// @vitest-environment node

import { describe, it, expect } from 'vitest'
import initSqlJs, { type Database as SqlJsDatabase, type SqlValue } from 'sql.js'
import { KnowledgeGraphStore, type GraphDb } from '../src/graph-store.js'
import {
  renameNode,
  mergeNodes,
  mergeBlastRadius,
  deleteNode,
  setNodeProps,
  nodeGraphStats,
} from '../src/mutations.js'

/**
 * A minimal GraphDb over a raw sql.js (pure-wasm) database — no DatabaseEngine,
 * no native better-sqlite3. Keeps the mutation unit tests self-contained and
 * runnable under plain node (the mutations only depend on the GraphDb contract).
 * GraphDb binds `unknown[]`; sql.js declares the narrower `SqlValue[]` — the
 * casts are safe because every value these tests bind is a string or number.
 */
function makeGraphDb(db: SqlJsDatabase): GraphDb {
  const queryAll = <T>(sql: string, params: unknown[] = []): T[] => {
    const stmt = db.prepare(sql)
    stmt.bind(params as SqlValue[])
    const rows: T[] = []
    while (stmt.step()) rows.push(stmt.getAsObject() as T)
    stmt.free()
    return rows
  }
  return {
    run(sql, params = []) {
      db.run(sql, params as SqlValue[])
    },
    queryAll,
    queryOne<T>(sql: string, params: unknown[] = []): T | undefined {
      return queryAll<T>(sql, params)[0]
    },
  }
}

async function makeStore(_name: string) {
  const SQL = await initSqlJs()
  const raw = new SQL.Database()
  const store = new KnowledgeGraphStore(makeGraphDb(raw))
  store.initSchema()
  return { store, dbPath: '' }
}

/** Seed a tiny graph: a person "Jiarabi" attended two meetings, owns an action. */
function seedGraph(store: KnowledgeGraphStore) {
  const now = '2026-01-26T00:00:00.000Z'
  const person = store.upsertNode({ type: 'person', label: 'Jiarabi', now })
  const m1 = store.upsertNode({
    type: 'meeting',
    label: 'Kickoff',
    props: { meetingId: 'mtg-1', date: '2026-01-10' },
    now,
  })
  const m2 = store.upsertNode({
    type: 'meeting',
    label: 'Review',
    props: { meetingId: 'mtg-2', date: '2026-01-26' },
    now,
  })
  const proj = store.upsertNode({ type: 'project', label: 'Phoenix', now })
  const ai = store.upsertNode({ type: 'action_item', label: 'Ship v1', now })
  store.upsertEdge({ sourceId: person, targetId: m1, type: 'ATTENDED', now })
  store.upsertEdge({ sourceId: person, targetId: m2, type: 'ATTENDED', now })
  store.upsertEdge({ sourceId: m1, targetId: proj, type: 'ABOUT', now })
  store.upsertEdge({ sourceId: person, targetId: ai, type: 'OWNS', now })
  return { person, m1, m2, proj, ai }
}

describe('knowledge-graph mutations', () => {
  it('renameNode relabels a name-only node in place (correction), edges intact', async () => {
    const { store } = await makeStore('rename')
    const { person } = seedGraph(store)

    const res = renameNode(store, person, 'Yaraví')
    expect(res.outcome).toBe('renamed')
    expect(res.nodeId).toBe(person) // id is stable on an in-place rename

    const node = store.getNode(person)!
    expect(node.label).toBe('Yaraví')
    expect(node.norm_key).toBe('yaraví')
    // Edges still reference the (unchanged) node id.
    const stats = nodeGraphStats(store, person)
    expect(stats.meetingCount).toBe(2)
  })

  it('renameNode folds into an existing same-type node under the new spelling', async () => {
    const { store } = await makeStore('rename-merge')
    const { person, m1 } = seedGraph(store)
    // A canonical "Yaraví" node already exists with its own meeting.
    const canonical = store.upsertNode({ type: 'person', label: 'Yaraví', now: '2026-01-01' })
    const m3 = store.upsertNode({
      type: 'meeting',
      label: 'Sync',
      props: { meetingId: 'mtg-3', date: '2026-02-01' },
      now: '2026-01-01',
    })
    store.upsertEdge({ sourceId: canonical, targetId: m3, type: 'ATTENDED', now: '2026-01-01' })

    const res = renameNode(store, person, 'Yaraví')
    expect(res.outcome).toBe('merged')
    expect(res.nodeId).toBe(canonical)
    expect(store.getNode(person)).toBeUndefined() // loser gone
    // Keeper now has all three meetings (m1, m2 from Jiarabi + m3 from canonical).
    const stats = nodeGraphStats(store, canonical)
    expect(stats.meetingCount).toBe(3)
    expect(m1).toBeTruthy()
  })

  it('renameNode is a no-op when the label is unchanged', async () => {
    const { store } = await makeStore('rename-noop')
    const { person } = seedGraph(store)
    const res = renameNode(store, person, 'Jiarabi')
    expect(res.outcome).toBe('noop')
    expect(store.getNode(person)!.label).toBe('Jiarabi')
  })

  it('mergeNodes folds a loser into a keeper and repoints edges', async () => {
    const { store } = await makeStore('merge')
    const now = '2026-01-01'
    const a = store.upsertNode({ type: 'person', label: 'Bob', now })
    const b = store.upsertNode({ type: 'person', label: 'Robert', now })
    const m = store.upsertNode({ type: 'meeting', label: 'M', props: { meetingId: 'm', date: '2026-01-05' }, now })
    const m2 = store.upsertNode({ type: 'meeting', label: 'M2', props: { meetingId: 'm2', date: '2026-01-06' }, now })
    store.upsertEdge({ sourceId: a, targetId: m, type: 'ATTENDED', now })
    store.upsertEdge({ sourceId: b, targetId: m2, type: 'ATTENDED', now })

    const res = mergeNodes(store, a, b)
    expect(res.merged).toBe(true)
    expect(res.movedEdges).toBe(1)
    expect(store.getNode(b)).toBeUndefined()
    expect(nodeGraphStats(store, a).meetingCount).toBe(2)
  })

  it('mergeNodes (AR2-1): a colliding repoint transfers the dropped edge\'s graph_edge_sources rows + weight onto the surviving keeper edge', async () => {
    const { store } = await makeStore('merge-collision-provenance')
    const now = '2026-01-01'
    const meeting = store.upsertNode({ type: 'meeting', label: 'M', props: { meetingId: 'm', date: '2026-01-05' }, now })
    const keeper = store.upsertNode({ type: 'topic', label: 'Roadmap', now })
    const loser = store.upsertNode({ type: 'topic', label: 'Road-map', now })

    const keeperEdge = store.upsertEdge({ sourceId: meeting, targetId: keeper, type: 'ABOUT', now }) // weight 1
    store.recordEdgeSource(keeperEdge, 'R1', 'T1', now)

    const loserEdge = store.upsertEdge({ sourceId: meeting, targetId: loser, type: 'ABOUT', now }) // weight 1
    store.recordEdgeSource(loserEdge, 'R2', 'T2', now)

    const res = mergeNodes(store, keeper, loser)
    expect(res.merged).toBe(true)

    // The loser edge collided (meeting->loser repoints to meeting->keeper,
    // which already existed) and was dropped — but its provenance moved.
    const keeperSources = store.db.queryAll<{ recording_id: string; transcript_id: string }>(
      'SELECT recording_id, transcript_id FROM graph_edge_sources WHERE edge_id = ?',
      [keeperEdge]
    )
    expect(keeperSources.map((r) => r.recording_id).sort()).toEqual(['R1', 'R2'])

    // No dangling source rows under the now-deleted loser edge id.
    expect(
      store.db.queryAll('SELECT * FROM graph_edge_sources WHERE edge_id = ?', [loserEdge])
    ).toHaveLength(0)

    // The dropped edge's weight was folded into the survivor.
    const edge = store.db.queryOne<{ weight: number }>('SELECT weight FROM graph_edges WHERE id = ?', [
      keeperEdge,
    ])
    expect(edge?.weight).toBe(2)
  })

  it('mergeBlastRadius reports each side, overlap, and resulting edges', async () => {
    const { store } = await makeStore('blast')
    const now = '2026-01-01'
    const a = store.upsertNode({ type: 'person', label: 'Bob', now })
    const b = store.upsertNode({ type: 'person', label: 'Robert', now })
    const shared = store.upsertNode({ type: 'meeting', label: 'Shared', props: { meetingId: 's', date: '2026-01-05' }, now })
    const onlyA = store.upsertNode({ type: 'meeting', label: 'OnlyA', props: { meetingId: 'a', date: '2026-01-06' }, now })
    store.upsertEdge({ sourceId: a, targetId: shared, type: 'ATTENDED', now })
    store.upsertEdge({ sourceId: b, targetId: shared, type: 'ATTENDED', now })
    store.upsertEdge({ sourceId: a, targetId: onlyA, type: 'ATTENDED', now })

    const blast = mergeBlastRadius(store, a, b)
    expect(blast.a?.edges).toBe(2)
    expect(blast.b?.edges).toBe(1)
    expect(blast.shared).toBe(1) // both attended "Shared"
    expect(blast.resulting).toBe(2) // Shared + OnlyA
  })

  it('deleteNode removes a node and its edges', async () => {
    const { store } = await makeStore('delete')
    const { person } = seedGraph(store)
    const res = deleteNode(store, person)
    expect(res.removed).toBe(true)
    expect(res.removedEdges).toBe(3) // 2 ATTENDED + 1 OWNS
    expect(store.getNode(person)).toBeUndefined()
    // A second delete is a no-op.
    expect(deleteNode(store, person).removed).toBe(false)
  })

  it('deleteNode (CX-T4-3) cascades graph_edge_sources; a re-created edge under the same deterministic id does NOT inherit stale provenance', async () => {
    const { store } = await makeStore('delete-cascade')
    const now = '2026-01-01'
    const person = store.upsertNode({ type: 'person', label: 'Alice', now })
    const meeting = store.upsertNode({
      type: 'meeting',
      label: 'Kickoff',
      props: { meetingId: 'm1', date: '2026-01-10' },
      now,
    })
    const edgeId = store.upsertEdge({ sourceId: person, targetId: meeting, type: 'ATTENDED', now })
    store.recordEdgeSource(edgeId, 'R-old', 'T-old', now)

    deleteNode(store, person)
    // The deleted edge's source rows died with it — nothing left to inherit.
    expect(store.db.queryAll('SELECT * FROM graph_edge_sources')).toHaveLength(0)

    // Re-create the SAME node pair: node + edge ids are deterministic, so the
    // recreated edge lands on the exact same edge id.
    const personAgain = store.upsertNode({ type: 'person', label: 'Alice', now })
    const edgeIdAgain = store.upsertEdge({ sourceId: personAgain, targetId: meeting, type: 'ATTENDED', now })
    expect(edgeIdAgain).toBe(edgeId) // the resurrection precondition this fix exists for
    store.recordEdgeSource(edgeIdAgain, 'R-new', 'T-new', now)

    const rows = store.db.queryAll<{ recording_id: string }>(
      'SELECT recording_id FROM graph_edge_sources WHERE edge_id = ?',
      [edgeIdAgain]
    )
    expect(rows.map((r) => r.recording_id)).toEqual(['R-new']) // ONLY the new provenance
    // The recreated edge starts fresh (weight 1, no ghost of the old assertion).
    const edge = store.db.queryOne<{ weight: number }>('SELECT weight FROM graph_edges WHERE id = ?', [
      edgeIdAgain,
    ])
    expect(edge?.weight).toBe(1)
  })

  it('mergeNodes (CX-T4-3) cascades source rows of an edge destroyed by the self-loop cleanup', async () => {
    const { store } = await makeStore('merge-selfloop-cascade')
    const now = '2026-01-01'
    const keeper = store.upsertNode({ type: 'person', label: 'Bob', now })
    const loser = store.upsertNode({ type: 'person', label: 'Robert', now })
    // A loser→keeper edge: the repoint turns it into keeper→keeper (id
    // preserved), and the merge's self-loop cleanup then destroys it.
    const loopEdge = store.upsertEdge({ sourceId: loser, targetId: keeper, type: 'MENTIONED', now })
    store.recordEdgeSource(loopEdge, 'R1', 'T1', now)

    const res = mergeNodes(store, keeper, loser)
    expect(res.merged).toBe(true)

    // The self-loop edge is gone AND its source rows went with it — no
    // orphaned rows waiting to be inherited by a future edge with this id.
    expect(store.db.queryOne('SELECT id FROM graph_edges WHERE id = ?', [loopEdge])).toBeUndefined()
    expect(store.db.queryAll('SELECT * FROM graph_edge_sources')).toHaveLength(0)
  })

  it('setNodeProps shallow-merges and can delete keys', async () => {
    const { store } = await makeStore('props')
    const { person } = seedGraph(store)
    setNodeProps(store, person, { pronouns: 'He/Him' })
    expect(JSON.parse(store.getNode(person)!.props!).pronouns).toBe('He/Him')
    setNodeProps(store, person, { pronouns: null })
    expect(JSON.parse(store.getNode(person)!.props!).pronouns).toBeUndefined()
  })

  it('nodeGraphStats derives meeting count and first/last seen', async () => {
    const { store } = await makeStore('stats')
    const { person } = seedGraph(store)
    const stats = nodeGraphStats(store, person)
    expect(stats.meetingCount).toBe(2)
    expect(stats.projectCount).toBe(0) // project is 2 hops away (via meeting)
    expect(stats.firstSeenMs).toBe(Date.parse('2026-01-10'))
    expect(stats.lastSeenMs).toBe(Date.parse('2026-01-26'))
    expect(stats.degree).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// ADV52-1 (round-54): mergeNodes is failure-ATOMIC. A partial failure that moved
// provenance rows but left the loser edge (or vice-versa) corrupts the honest-
// deletion topology, so the ENTIRE mergeNodes sequence must roll back on ANY
// error. These tests inject a throw AFTER transferCollidingEdgeProvenance and at
// each subsequent statement and assert the graph, weights, and graph_edge_sources
// are byte-identical to the pre-merge snapshot (before == after) and the error
// propagates. The GraphDb here has NO runInTransaction, so runInGraphTransaction's
// SAVEPOINT fallback is what performs the rollback.
// ---------------------------------------------------------------------------

/**
 * A GraphDb over raw sql.js whose `run` can be armed to throw ONCE when a
 * predicate matches the executed SQL — letting a test force a fault at a chosen
 * statement inside mergeNodes. It intentionally omits `runInTransaction`, so the
 * fallback SAVEPOINT rollback path is exercised. The fault disarms after firing,
 * so the ROLLBACK/RELEASE statements the helper issues afterwards still execute.
 */
function makeControllableStore(raw: SqlJsDatabase) {
  const base = makeGraphDb(raw)
  let predicate: ((sql: string) => boolean) | null = null
  const db: GraphDb = {
    queryAll: base.queryAll.bind(base),
    queryOne: base.queryOne.bind(base),
    run(sql: string, params: unknown[] = []) {
      if (predicate && predicate(sql)) {
        predicate = null
        throw new Error(`injected fault at: ${sql.trim().slice(0, 48)}`)
      }
      base.run(sql, params)
    },
  }
  const store = new KnowledgeGraphStore(db)
  store.initSchema()
  return { store, arm: (p: (sql: string) => boolean) => { predicate = p } }
}

function graphSnapshot(store: KnowledgeGraphStore) {
  return {
    nodes: store.db.queryAll('SELECT * FROM graph_nodes ORDER BY id'),
    edges: store.db.queryAll('SELECT * FROM graph_edges ORDER BY id'),
    sources: store.db.queryAll(
      'SELECT * FROM graph_edge_sources ORDER BY edge_id, recording_id, transcript_id'
    ),
  }
}

/**
 * A mergeable graph that exercises EVERY branch of mergeNodes: a colliding edge
 * (meeting→loser collides with meeting→keeper ⇒ provenance transfer + weight
 * fold), a non-colliding edge (loser→other ⇒ repoint), and the loser node
 * delete. Returns the store, its fault-arming hook, and the node/edge ids.
 */
async function seedMergeable() {
  const SQL = await initSqlJs()
  const raw = new SQL.Database()
  const { store, arm } = makeControllableStore(raw)
  const now = '2026-01-01'
  const meeting = store.upsertNode({ type: 'meeting', label: 'M', props: { meetingId: 'm', date: '2026-01-05' }, now })
  const keeper = store.upsertNode({ type: 'topic', label: 'Roadmap', now })
  const loser = store.upsertNode({ type: 'topic', label: 'Road-map', now })
  const other = store.upsertNode({ type: 'person', label: 'Alice', now })

  const keeperEdge = store.upsertEdge({ sourceId: meeting, targetId: keeper, type: 'ABOUT', now })
  store.recordEdgeSource(keeperEdge, 'R1', 'T1', now)
  const loserEdge = store.upsertEdge({ sourceId: meeting, targetId: loser, type: 'ABOUT', now }) // collides on repoint
  store.recordEdgeSource(loserEdge, 'R2', 'T2', now)
  const loserRel = store.upsertEdge({ sourceId: other, targetId: loser, type: 'MENTIONED', now }) // repoints (target side)
  store.recordEdgeSource(loserRel, 'R3', 'T3', now)

  return { store, arm, ids: { meeting, keeper, loser, other, keeperEdge, loserEdge, loserRel } }
}

describe('knowledge-graph mergeNodes atomicity (ADV52-1 / round-54)', () => {
  // Every statement mergeNodes runs AFTER transferCollidingEdgeProvenance (which
  // has already moved graph_edge_sources rows + weight onto the keeper by the
  // time these fire). A throw at any one must roll the whole sequence back.
  const injectionPoints: { name: string; match: (sql: string) => boolean }[] = [
    { name: 'first source-side repoint (immediately after provenance transfer)', match: (s) => s.includes('UPDATE OR IGNORE graph_edges SET source_id') },
    { name: 'source-side edge cleanup delete', match: (s) => s.includes('DELETE FROM graph_edges WHERE source_id = ?') },
    { name: 'target-side repoint', match: (s) => s.includes('UPDATE OR IGNORE graph_edges SET target_id') },
    { name: 'self-loop cleanup delete', match: (s) => s.includes('source_id = target_id') },
    { name: 'loser node delete (final statement)', match: (s) => s.includes('DELETE FROM graph_nodes') },
  ]

  for (const point of injectionPoints) {
    it(`rolls back the ENTIRE merge when it fails at the ${point.name}`, async () => {
      const { store, arm, ids } = await seedMergeable()
      const before = graphSnapshot(store)

      arm(point.match)
      expect(() => mergeNodes(store, ids.keeper, ids.loser)).toThrow(/injected fault/)

      const after = graphSnapshot(store)
      // Nodes, edges, weights, AND graph_edge_sources are ALL restored: the
      // provenance transfer that ran before the fault is undone too.
      expect(after).toEqual(before)
    })
  }

  it('commits exactly as before on the happy path (no regression under the transaction wrapper)', async () => {
    const { store, ids } = await seedMergeable()
    const res = mergeNodes(store, ids.keeper, ids.loser)
    expect(res.merged).toBe(true)

    // Loser node gone; keeper survives.
    expect(store.getNode(ids.loser)).toBeUndefined()
    expect(store.getNode(ids.keeper)).toBeDefined()

    // The colliding edge's provenance folded onto the keeper edge (R1 + R2),
    // its weight summed to 2, and no rows dangle under the dropped loser edge.
    const keeperSources = store.db.queryAll<{ recording_id: string }>(
      'SELECT recording_id FROM graph_edge_sources WHERE edge_id = ?',
      [ids.keeperEdge]
    )
    expect(keeperSources.map((r) => r.recording_id).sort()).toEqual(['R1', 'R2'])
    expect(
      store.db.queryOne<{ weight: number }>('SELECT weight FROM graph_edges WHERE id = ?', [ids.keeperEdge])?.weight
    ).toBe(2)
    expect(store.db.queryAll('SELECT * FROM graph_edge_sources WHERE edge_id = ?', [ids.loserEdge])).toHaveLength(0)

    // The non-colliding edge repointed onto the keeper (target side) and kept R3.
    const repointed = store.db.queryOne<{ id: string }>(
      "SELECT id FROM graph_edges WHERE source_id = ? AND target_id = ? AND type = 'MENTIONED'",
      [ids.other, ids.keeper]
    )
    expect(repointed).toBeDefined()
    expect(
      store.db.queryAll<{ recording_id: string }>(
        'SELECT recording_id FROM graph_edge_sources WHERE edge_id = ?',
        [repointed!.id]
      ).map((r) => r.recording_id)
    ).toEqual(['R3'])
  })
})
