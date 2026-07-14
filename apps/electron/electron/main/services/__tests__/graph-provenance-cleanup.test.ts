/**
 * F18 (spec-004): graph-provenance cleanup + race tests.
 *
 * Mirrors value-gates.test.ts / knowledge-graph-service.test.ts: mock
 * Electron/config/ai-providers/file-storage, use the REAL better-sqlite3
 * engine with a fresh temp DB per test, mock only complete() (the LLM call).
 */

// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'

// ---------------------------------------------------------------------------
// Top-level mocks (hoisted before imports)
// ---------------------------------------------------------------------------

vi.mock('electron', () => ({ app: { getPath: () => tmpdir(), getVersion: () => '0.0.0' } }))

vi.mock('../config', () => ({
  getConfig: vi.fn(() => ({
    chat: { provider: 'gemini', geminiModel: 'gemini-2.0-flash', ollamaModel: '', maxContextChunks: 10 },
    transcription: { geminiApiKey: 'test-api-key', geminiModel: '' }, // pragma: allowlist secret
    storage: { dataPath: tmpdir(), maxRecordingsGB: 50 },
    calendar: { icsUrl: '', syncEnabled: false, syncIntervalMinutes: 15, lastSyncAt: null },
    embeddings: { provider: 'ollama', ollamaBaseUrl: '', ollamaModel: '', chunkSize: 500, chunkOverlap: 50 },
    device: { autoConnect: false, autoDownload: false },
    ui: {
      theme: 'system',
      defaultView: 'week',
      startOfWeek: 1,
      calendarView: 'week',
      hideEmptyMeetings: false,
      showListView: false,
    },
    version: '1.0.0',
  })),
}))

vi.mock('@hidock/ai-providers', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@hidock/ai-providers')>()
  return { ...mod, complete: vi.fn() }
})

let _dbCounter = 0
vi.mock('../file-storage', () => ({
  getDatabasePath: vi.fn(() => join(tmpdir(), `hidock-graph-prov-test-${Date.now()}-${++_dbCounter}.sqlite`)),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks so they pick up the mocked versions)
// ---------------------------------------------------------------------------

import { complete } from '@hidock/ai-providers'
import {
  initializeDatabase,
  run as dbRun,
  queryOne as dbQueryOne,
  queryAll as dbQueryAll,
  runInTransaction,
} from '../database'
import {
  ingestFromDbTranscripts,
  getKnowledgeGraphStore,
  removeRecordingFromGraph,
  removeRecordingProvenanceCore,
} from '../knowledge-graph-service'

const FAKE_JSON = JSON.stringify({
  people: [{ name: 'Alice', skills: [] }],
  topics: ['Roadmap'],
  projects: [],
  decisions: [],
  action_items: [],
  risks: [],
  next_steps: [],
})

function seedRecording(id: string, opts: { meeting_id?: string | null } = {}): void {
  dbRun(
    `INSERT OR IGNORE INTO recordings (id, filename, date_recorded, meeting_id) VALUES (?, ?, ?, ?)`,
    [id, `${id}.hda`, '2026-06-01', opts.meeting_id ?? null]
  )
}

function seedTranscript(id: string, recordingId: string, text = 'hello world'): void {
  dbRun(`INSERT OR IGNORE INTO transcripts (id, recording_id, full_text) VALUES (?, ?, ?)`, [
    id,
    recordingId,
    text,
  ])
}

function ingestMarker(transcriptId: string): { transcript_id: string } | undefined {
  return dbQueryOne<{ transcript_id: string }>(
    'SELECT transcript_id FROM graph_ingested_transcripts WHERE transcript_id = ?',
    [transcriptId]
  )
}

beforeEach(async () => {
  vi.clearAllMocks()
  ;(complete as any).mockResolvedValue(FAKE_JSON)
  await initializeDatabase()
})

// =============================================================================
// End-to-end: ingest -> provenance rows + id-keyed meeting node -> cleanup
// =============================================================================

describe('ingest -> removeRecordingFromGraph (end-to-end)', () => {
  it('ingest writes graph_edge_sources rows + an id-keyed meeting node; removeRecordingFromGraph removes them precisely', async () => {
    seedRecording('rec-e2e')
    seedTranscript('tx-e2e', 'rec-e2e', 'Alice discussed the roadmap.')

    const ingestResult = await ingestFromDbTranscripts()
    expect(ingestResult.ingested).toBe(1)

    const store = getKnowledgeGraphStore()
    const meetingNode = store.findNodes({ type: 'meeting' }).find((n) => n.norm_key.startsWith('meeting:'))
    expect(meetingNode).toBeDefined()
    expect(meetingNode!.norm_key).toBe('meeting:rec-e2e')

    const sourceRowsBefore = dbQueryAll('SELECT * FROM graph_edge_sources WHERE recording_id = ?', ['rec-e2e'])
    expect(sourceRowsBefore.length).toBeGreaterThan(0)
    expect(ingestMarker('tx-e2e')).toBeDefined()

    const res = removeRecordingFromGraph('rec-e2e')
    expect(res.ok).toBe(true)
    expect(res.dryRun).toBe(false)
    expect(res.markersRemoved).toBe(1)
    expect(res.edgesRemoved).toBeGreaterThan(0)
    expect(res.meetingNodesRemoved).toBe(1)
    expect(res.error).toBeUndefined()

    expect(ingestMarker('tx-e2e')).toBeUndefined()
    expect(dbQueryAll('SELECT * FROM graph_edge_sources WHERE recording_id = ?', ['rec-e2e'])).toHaveLength(0)
    expect(store.getNode(meetingNode!.id)).toBeUndefined()
  })

  it('dryRun reports the same counts as a subsequent real run, without mutating anything', async () => {
    seedRecording('rec-dry')
    seedTranscript('tx-dry', 'rec-dry', 'Alice discussed the roadmap.')
    await ingestFromDbTranscripts()

    const dry = removeRecordingFromGraph('rec-dry', { dryRun: true })
    expect(dry.ok).toBe(true)
    expect(dry.dryRun).toBe(true)
    expect(ingestMarker('tx-dry')).toBeDefined() // nothing removed yet

    const real = removeRecordingFromGraph('rec-dry')
    expect(real.dryRun).toBe(false)
    expect(real.markersRemoved).toBe(dry.markersRemoved)
    expect(real.edgesRemoved).toBe(dry.edgesRemoved)
    expect(real.meetingNodesRemoved).toBe(dry.meetingNodesRemoved)
    expect(real.orphanNodesRemoved).toBe(dry.orphanNodesRemoved)
    expect(real.sharedEdgesKept).toBe(dry.sharedEdgesKept)
    expect(ingestMarker('tx-dry')).toBeUndefined()
  })
})

// =============================================================================
// markersRemoved: union of live transcripts, edge-sources, and passed ids
// =============================================================================

describe('removeRecordingFromGraph: markersRemoved self-heals via the union set', () => {
  it('covers a live transcript, a stale (re-transcribed-away) transcript found via edge-sources, and an explicitly passed zero-edge transcript', async () => {
    seedRecording('rec-markers')
    // getKnowledgeGraphStore() lazily creates graph_ingested_transcripts (an
    // app-side table, not part of GRAPH_SCHEMA) — call it before inserting
    // markers directly.
    const store = getKnowledgeGraphStore()

    // T-live: still in `transcripts`, has a marker.
    seedTranscript('tx-live', 'rec-markers', 'hi')
    dbRun('INSERT OR IGNORE INTO graph_ingested_transcripts (transcript_id, ingested_at) VALUES (?, ?)', [
      'tx-live',
      '2026-01-01',
    ])

    // T-stale: NOT in `transcripts` anymore (simulates re-transcription
    // dropping the old row), but still referenced by graph_edge_sources +
    // carries a stale marker.
    dbRun('INSERT OR IGNORE INTO graph_ingested_transcripts (transcript_id, ingested_at) VALUES (?, ?)', [
      'tx-stale',
      '2026-01-01',
    ])
    const person = store.upsertNode({ type: 'person', label: 'Someone' })
    const meeting = store.upsertNode({
      type: 'meeting',
      label: 'M',
      key: 'meeting:rec-markers',
      props: { meetingId: 'rec-markers' },
    })
    const edgeId = store.upsertEdge({ sourceId: person, targetId: meeting, type: 'ATTENDED' })
    store.recordEdgeSource(edgeId, 'rec-markers', 'tx-stale')

    // T-explicit: a zero-edge transcript passed explicitly (e.g. F17 captured
    // it before the cascade deleted its `transcripts` row) — no live row, no
    // edge-sources row, just a marker.
    dbRun('INSERT OR IGNORE INTO graph_ingested_transcripts (transcript_id, ingested_at) VALUES (?, ?)', [
      'tx-explicit',
      '2026-01-01',
    ])

    const res = removeRecordingFromGraph('rec-markers', { transcriptIds: ['tx-explicit'] })
    expect(res.ok).toBe(true)
    expect(res.markersRemoved).toBe(3)
    expect(ingestMarker('tx-live')).toBeUndefined()
    expect(ingestMarker('tx-stale')).toBeUndefined()
    expect(ingestMarker('tx-explicit')).toBeUndefined()
  })
})

// =============================================================================
// Race (pause-after-extraction) — mirrors the F16/spec-002 AR-1 harness
// =============================================================================

describe('ingestFromDbTranscripts(): F18 purge/ingest race', () => {
  it('a recording hard-deleted while its extraction is in flight is never ingested (no graph rows, no marker)', async () => {
    seedRecording('rec-race')
    seedTranscript('tx-race', 'rec-race', 'Some real meeting content.')

    ;(complete as any).mockImplementationOnce(async () => {
      // Simulates deleteRecordingCascade's hard purge landing WHILE this row's
      // extraction call is in flight (after the pre-filter snapshot, before
      // the persist transaction's fresh point-read). Children before parent,
      // matching the real cascade's own order (transcripts.recording_id has a
      // FOREIGN KEY REFERENCES recordings(id)).
      dbRun('DELETE FROM transcripts WHERE recording_id = ?', ['rec-race'])
      dbRun('DELETE FROM recordings WHERE id = ?', ['rec-race'])
      return FAKE_JSON
    })

    const result = await ingestFromDbTranscripts()

    expect(complete).toHaveBeenCalledTimes(1) // it was eligible at the pre-filter
    expect(result.ingested).toBe(0)
    expect(result.skipped).toBe(1)
    expect(result.errors).toHaveLength(0)

    const store = getKnowledgeGraphStore()
    expect(store.findNodes({ type: 'meeting' })).toHaveLength(0)
    expect(ingestMarker('tx-race')).toBeUndefined()
    expect(dbQueryAll('SELECT * FROM graph_edge_sources')).toHaveLength(0)
  })

  it('a recording soft-deleted while its extraction is in flight is never ingested (soft-delete coverage of the same guard)', async () => {
    seedRecording('rec-soft-race')
    seedTranscript('tx-soft-race', 'rec-soft-race', 'Some real meeting content.')

    ;(complete as any).mockImplementationOnce(async () => {
      dbRun('UPDATE recordings SET deleted_at = ? WHERE id = ?', ['2026-06-02T00:00:00.000Z', 'rec-soft-race'])
      return FAKE_JSON
    })

    const result = await ingestFromDbTranscripts()

    expect(result.ingested).toBe(0)
    expect(result.skipped).toBe(1)
    expect(ingestMarker('tx-soft-race')).toBeUndefined()
  })

  // AR2-4: the in-txn marker recheck — closes the "two concurrent ingest
  // passes" gap that the outside-the-transaction pre-check alone cannot.
  it('AR2-4: a marker committed mid-extraction (simulating a concurrent ingest pass) is honored by the fresh in-txn recheck', async () => {
    seedRecording('rec-concurrent')
    seedTranscript('tx-concurrent', 'rec-concurrent', 'Some real meeting content.')

    ;(complete as any).mockImplementationOnce(async () => {
      // Simulates a second, overlapping ingestFromDbTranscripts() pass
      // committing this transcript's marker (+ implicitly its graph writes)
      // while THIS pass's extraction call is still in flight.
      dbRun('INSERT OR IGNORE INTO graph_ingested_transcripts (transcript_id, ingested_at) VALUES (?, ?)', [
        'tx-concurrent',
        new Date().toISOString(),
      ])
      return FAKE_JSON
    })

    const result = await ingestFromDbTranscripts()

    expect(complete).toHaveBeenCalledTimes(1)
    expect(result.ingested).toBe(0) // the in-txn recheck caught the marker and skipped
    expect(result.skipped).toBe(1)
    expect(result.errors).toHaveLength(0)

    const store = getKnowledgeGraphStore()
    expect(store.findNodes({ type: 'meeting' })).toHaveLength(0) // no double-ingest
  })

  // F16 regression: value-gates.test.ts already exercises the full
  // garbage/low-value matrix + the value-flip-mid-run case; this just
  // confirms isRecordingGraphIngestable's superset predicate does not
  // regress the "still eligible" control path.
  it('F16 regression: a normal, non-excluded recording still ingests via the new isRecordingGraphIngestable gate', async () => {
    seedRecording('rec-control')
    seedTranscript('tx-control', 'rec-control', 'Carol discussed the roadmap.')

    const result = await ingestFromDbTranscripts()
    expect(result.ingested).toBe(1)
    expect(result.skipped).toBe(0)
    expect(ingestMarker('tx-control')).toBeDefined()
  })
})

// =============================================================================
// Failure handling: { ok: false, error } + crash-mid-cleanup rollback
// =============================================================================

describe('removeRecordingFromGraph: failure handling', () => {
  it('returns { ok:false, error } (never throws) when the graph write fails', async () => {
    seedRecording('rec-fail')
    const store = getKnowledgeGraphStore()
    const meeting = store.upsertNode({
      type: 'meeting',
      label: 'K',
      key: 'meeting:rec-fail',
      props: { meetingId: 'rec-fail' },
    })
    const person = store.upsertNode({ type: 'person', label: 'Alice' })
    const edgeId = store.upsertEdge({ sourceId: person, targetId: meeting, type: 'ATTENDED' })
    store.recordEdgeSource(edgeId, 'rec-fail', 'tx-fail')

    const originalRun = store.db.run.bind(store.db)
    store.db.run = () => {
      throw new Error('injected failure')
    }
    try {
      const res = removeRecordingFromGraph('rec-fail')
      expect(res.ok).toBe(false)
      expect(res.error).toContain('injected failure')
    } finally {
      store.db.run = originalRun
    }
  })

  it('crash-mid-cleanup: a failure injected AFTER at least one edge delete has executed rolls back the WHOLE transaction — graph left unchanged', async () => {
    seedRecording('rec-crash')
    const store = getKnowledgeGraphStore()
    const meeting = store.upsertNode({
      type: 'meeting',
      label: 'K',
      key: 'meeting:rec-crash',
      props: { meetingId: 'rec-crash' },
    })
    const p1 = store.upsertNode({ type: 'person', label: 'Alice' })
    const p2 = store.upsertNode({ type: 'person', label: 'Bob' })
    const e1 = store.upsertEdge({ sourceId: p1, targetId: meeting, type: 'ATTENDED' })
    const e2 = store.upsertEdge({ sourceId: p2, targetId: meeting, type: 'ATTENDED' })
    store.recordEdgeSource(e1, 'rec-crash', 'tx-crash')
    store.recordEdgeSource(e2, 'rec-crash', 'tx-crash')
    dbRun('INSERT OR IGNORE INTO graph_ingested_transcripts (transcript_id, ingested_at) VALUES (?, ?)', [
      'tx-crash',
      '2026-01-01',
    ])

    const snapshot = () => ({
      edges: dbQueryAll('SELECT * FROM graph_edges ORDER BY id'),
      nodes: dbQueryAll('SELECT * FROM graph_nodes ORDER BY id'),
      sources: dbQueryAll('SELECT * FROM graph_edge_sources ORDER BY edge_id, recording_id, transcript_id'),
      markers: dbQueryAll('SELECT * FROM graph_ingested_transcripts ORDER BY transcript_id'),
    })
    const before = snapshot()

    // Fail on the SECOND mutating statement (DELETE/UPDATE) issued by the
    // removal engine — the first edge delete has already executed by then.
    // Filtering by statement kind (rather than a raw call index) keeps this
    // robust to any incidental CREATE TABLE/INDEX calls from a re-triggered
    // initSchema() elsewhere in the call chain.
    const originalRun = store.db.run.bind(store.db)
    let mutationCount = 0
    store.db.run = (sql: string, params?: unknown[]) => {
      const kind = sql.trim().slice(0, 6).toUpperCase()
      if (kind === 'DELETE' || kind === 'UPDATE') {
        mutationCount++
        if (mutationCount === 2) throw new Error('injected mid-cleanup failure')
      }
      return originalRun(sql, params)
    }

    try {
      const res = removeRecordingFromGraph('rec-crash')
      expect(res.ok).toBe(false)
      expect(res.error).toContain('injected mid-cleanup failure')
    } finally {
      store.db.run = originalRun
    }

    expect(mutationCount).toBeGreaterThanOrEqual(2) // proves the injection point was reached

    const after = snapshot()
    expect(after).toEqual(before) // ROLLBACK reverted the first successful delete too
  })
})

// =============================================================================
// Project protection uses the real `projects` table
// =============================================================================

describe('removeRecordingFromGraph: project protection', () => {
  it('a project node linked to a real `projects` row survives orphan GC', async () => {
    seedRecording('rec-proj')
    dbRun('INSERT OR IGNORE INTO projects (id, name) VALUES (?, ?)', ['proj-1', 'Phoenix'])

    const store = getKnowledgeGraphStore()
    const meeting = store.upsertNode({
      type: 'meeting',
      label: 'Kickoff',
      key: 'meeting:rec-proj',
      props: { meetingId: 'rec-proj' },
    })
    const project = store.upsertNode({ type: 'project', label: 'Phoenix' })
    const edgeId = store.upsertEdge({ sourceId: meeting, targetId: project, type: 'ABOUT' })
    store.recordEdgeSource(edgeId, 'rec-proj', 'tx-proj')

    const res = removeRecordingFromGraph('rec-proj')
    expect(res.ok).toBe(true)
    expect(res.orphanNodesRemoved).toBe(0)
    expect(store.getNode(project)).toBeDefined()
  })

  it('a project node with no matching `projects` row is GC\'d once orphaned', async () => {
    seedRecording('rec-noproj')

    const store = getKnowledgeGraphStore()
    const meeting = store.upsertNode({
      type: 'meeting',
      label: 'Kickoff',
      key: 'meeting:rec-noproj',
      props: { meetingId: 'rec-noproj' },
    })
    const project = store.upsertNode({ type: 'project', label: 'GhostProject' })
    const edgeId = store.upsertEdge({ sourceId: meeting, targetId: project, type: 'ABOUT' })
    store.recordEdgeSource(edgeId, 'rec-noproj', 'tx-noproj')

    const res = removeRecordingFromGraph('rec-noproj')
    expect(res.ok).toBe(true)
    expect(res.orphanNodesRemoved).toBe(1)
    expect(res.orphanNodesByType).toEqual({ project: 1 })
    expect(store.getNode(project)).toBeUndefined()
  })
})

// =============================================================================
// AR2-2: the transaction-neutral core composes inside a caller-owned transaction
// =============================================================================

describe('removeRecordingProvenanceCore: transaction-neutral contract (AR2-2)', () => {
  it('runs correctly when invoked from inside an existing runInTransaction (the F17 hard-purge call pattern)', async () => {
    seedRecording('rec-compose')
    const store = getKnowledgeGraphStore()
    const meeting = store.upsertNode({
      type: 'meeting',
      label: 'Kickoff',
      key: 'meeting:rec-compose',
      props: { meetingId: 'rec-compose' },
    })
    const person = store.upsertNode({ type: 'person', label: 'Alice' })
    const edgeId = store.upsertEdge({ sourceId: person, targetId: meeting, type: 'ATTENDED' })
    store.recordEdgeSource(edgeId, 'rec-compose', 'tx-compose')

    const res = runInTransaction(() =>
      removeRecordingProvenanceCore('rec-compose', { meetingId: 'rec-compose' })
    )
    expect(res.ok).toBe(true)
    expect(res.edgesRemoved).toBe(1)
    expect(res.meetingNodesRemoved).toBe(1)
    expect(store.getNode(meeting)).toBeUndefined()
  })
})
