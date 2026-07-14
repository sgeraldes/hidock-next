// @vitest-environment node

import { describe, it, expect } from 'vitest'
import initSqlJs from 'sql.js'
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
 */
function makeGraphDb(db: {
  run: (sql: string, params?: unknown[]) => void
  prepare: (sql: string) => {
    bind: (p: unknown[]) => void
    step: () => boolean
    getAsObject: () => Record<string, unknown>
    free: () => void
  }
}): GraphDb {
  const queryAll = <T>(sql: string, params: unknown[] = []): T[] => {
    const stmt = db.prepare(sql)
    stmt.bind(params)
    const rows: T[] = []
    while (stmt.step()) rows.push(stmt.getAsObject() as T)
    stmt.free()
    return rows
  }
  return {
    run(sql, params = []) {
      db.run(sql, params)
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
