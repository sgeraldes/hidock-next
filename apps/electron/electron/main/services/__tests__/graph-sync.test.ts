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
// pure surgery function can be tested in isolation. The event-bus mock records
// subscriptions and emissions so the debounced-ingest emission can be verified.
vi.mock('../knowledge-graph-service', () => ({
  getKnowledgeGraphStore: vi.fn(),
  ingestFromDbTranscripts: vi.fn()
}))
const busHandlers = new Map<string, Array<(event: unknown) => void>>()
const mockEmitDomainEvent = vi.fn()
vi.mock('../event-bus', () => ({
  getEventBus: () => ({
    onDomainEvent: (type: string, handler: (event: unknown) => void) => {
      const arr = busHandlers.get(type) ?? []
      arr.push(handler)
      busHandlers.set(type, arr)
      return () => {}
    },
    emitDomainEvent: mockEmitDomainEvent
  })
}))

import { renameOrMergePersonNode, startGraphSync } from '../graph-sync'
import { ingestFromDbTranscripts } from '../knowledge-graph-service'

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

describe('startGraphSync — graph:ingested emission (post-commit invalidation signal)', () => {
  const fireTranscriptReady = (): void => {
    for (const h of busHandlers.get('entity:transcript-ready') ?? []) {
      h({ type: 'entity:transcript-ready', timestamp: new Date().toISOString(), payload: {} })
    }
  }

  beforeEach(() => {
    vi.useFakeTimers()
    mockEmitDomainEvent.mockClear()
    vi.mocked(ingestFromDbTranscripts).mockReset()
    startGraphSync() // idempotent; handlers persist across tests
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('emits graph:ingested AFTER the debounced ingest commits — never on transcript-ready itself', async () => {
    vi.mocked(ingestFromDbTranscripts).mockResolvedValue({ ingested: 2, skipped: 0, errors: [] })

    fireTranscriptReady()
    // Before the debounce elapses the graph has NOT changed — no emission.
    expect(mockEmitDomainEvent).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(60_000)

    expect(ingestFromDbTranscripts).toHaveBeenCalledTimes(1)
    expect(mockEmitDomainEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'graph:ingested', payload: { ingested: 2 } })
    )
  })

  it('does NOT emit when the ingest found nothing new', async () => {
    vi.mocked(ingestFromDbTranscripts).mockResolvedValue({ ingested: 0, skipped: 3, errors: [] })

    fireTranscriptReady()
    await vi.advanceTimersByTimeAsync(60_000)

    expect(ingestFromDbTranscripts).toHaveBeenCalledTimes(1)
    expect(mockEmitDomainEvent).not.toHaveBeenCalled()
  })

  it('does NOT emit when the ingest fails (missing provider)', async () => {
    vi.mocked(ingestFromDbTranscripts).mockRejectedValue(new Error('No AI provider configured'))

    fireTranscriptReady()
    await vi.advanceTimersByTimeAsync(60_000)

    expect(mockEmitDomainEvent).not.toHaveBeenCalled()
  })
})
