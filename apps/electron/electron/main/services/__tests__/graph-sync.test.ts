/**
 * Living knowledge graph — node surgery (Round 4a).
 *
 * renameOrMergePersonNode does LLM-free graph surgery: an in-place relabel when
 * the new name is free, or a fold (repoint edges + delete loser) when a node
 * already exists at the new name. Tested against a real in-memory graph store.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import initSqlJs from 'sql.js'
import { KnowledgeGraphStore } from '@hidock/knowledge-graph'

// graph-sync pulls the graph service + event bus at import; stub them so the
// pure surgery function can be tested in isolation.
vi.mock('../knowledge-graph-service', () => ({
  getKnowledgeGraphStore: vi.fn(),
  ingestFromDbTranscripts: vi.fn()
}))
vi.mock('../event-bus', () => ({ getEventBus: vi.fn(() => ({ onDomainEvent: vi.fn() })) }))

import { renameOrMergePersonNode } from '../graph-sync'

function rowsFrom(result: any[]): any[] {
  if (!result || result.length === 0) return []
  const { columns, values } = result[0]
  return values.map((v: any[]) => {
    const row: any = {}
    columns.forEach((c: string, i: number) => (row[c] = v[i]))
    return row
  })
}

describe('renameOrMergePersonNode', () => {
  let db: any
  let store: KnowledgeGraphStore

  beforeEach(async () => {
    const SQL = await initSqlJs()
    db = new SQL.Database()
    const adapter = {
      run: (sql: string, params: any[] = []) => db.run(sql, params),
      queryAll: (sql: string, params: any[] = []) => rowsFrom(db.exec(sql, params)),
      queryOne: (sql: string, params: any[] = []) => rowsFrom(db.exec(sql, params))[0]
    }
    store = new KnowledgeGraphStore(adapter)
    store.initSchema()
  })

  afterEach(() => {
    if (db) db.close()
  })

  it('renames a person node in place when the new name is free', () => {
    const personId = store.upsertNode({ type: 'person', label: 'Sebas' })
    const meetingId = store.upsertNode({ type: 'meeting', label: 'Kickoff' })
    store.upsertEdge({ sourceId: personId, targetId: meetingId, type: 'ATTENDED' })

    const outcome = renameOrMergePersonNode(store, 'Sebas', 'Sebastián')
    expect(outcome).toBe('renamed')

    const node = store.getNode(personId)
    expect(node?.label).toBe('Sebastián')
    expect(node?.norm_key).toBe('sebastián')

    // Edge still resolves (id unchanged).
    const edges = rowsFrom(db.exec('SELECT * FROM graph_edges WHERE source_id = ?', [personId]))
    expect(edges).toHaveLength(1)
  })

  it('folds a person node into an existing one and repoints its edges', () => {
    const loserId = store.upsertNode({ type: 'person', label: 'Sebas' })
    const keeperId = store.upsertNode({ type: 'person', label: 'Sebastián' })
    const m1 = store.upsertNode({ type: 'meeting', label: 'Meeting One' })
    const m2 = store.upsertNode({ type: 'meeting', label: 'Meeting Two' })
    store.upsertEdge({ sourceId: loserId, targetId: m1, type: 'ATTENDED' })
    store.upsertEdge({ sourceId: keeperId, targetId: m2, type: 'ATTENDED' })

    const outcome = renameOrMergePersonNode(store, 'Sebas', 'Sebastián')
    expect(outcome).toBe('merged')

    // Loser gone, exactly one person node remains.
    expect(store.getNode(loserId)).toBeUndefined()
    const persons = store.findNodes({ type: 'person' })
    expect(persons).toHaveLength(1)
    expect(persons[0].id).toBe(keeperId)

    // No edge references the loser; the keeper now owns both meeting edges.
    const danglers = rowsFrom(
      db.exec('SELECT * FROM graph_edges WHERE source_id = ? OR target_id = ?', [loserId, loserId])
    )
    expect(danglers).toHaveLength(0)
    const keeperEdges = rowsFrom(db.exec('SELECT * FROM graph_edges WHERE source_id = ?', [keeperId]))
    expect(keeperEdges).toHaveLength(2)
  })

  it('is a noop when there is no loser node or the keys are equal', () => {
    expect(renameOrMergePersonNode(store, 'Ghost', 'Phantom')).toBe('noop')
    store.upsertNode({ type: 'person', label: 'Alice' })
    expect(renameOrMergePersonNode(store, 'Alice', 'ALICE')).toBe('noop') // same norm key
  })
})
