/**
 * ARF-2 (Codex adversarial FINAL review) — graph grounding must not leak facts
 * from excluded recordings into the assistant.
 *
 * Real better-sqlite3 engine + real KnowledgeGraphStore (same app DB via the
 * graphDbAdapter). Manually seeds graph nodes/edges/graph_edge_sources +
 * recordings, then asserts neighborhoodFacts() SUPPRESSES a fact whose EVERY
 * provenance row belongs to an excluded (soft-deleted / personal /
 * value-excluded) recording, while keeping legacy (no-provenance) facts and
 * shared facts with ≥1 eligible source. Mirrors the graph-provenance-cleanup
 * harness (mock Electron/config/ai-providers/file-storage; real DB).
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir(), getVersion: () => '0.0.0' } }))

vi.mock('../config', () => ({
  getConfig: vi.fn(() => ({
    chat: { provider: 'gemini', geminiModel: 'gemini-2.0-flash', ollamaModel: '', maxContextChunks: 10 },
    transcription: { geminiApiKey: 'test-api-key', geminiModel: '' }, // pragma: allowlist secret
    storage: { dataPath: tmpdir(), maxRecordingsGB: 50 },
    embeddings: { provider: 'ollama', ollamaBaseUrl: '', ollamaModel: '', chunkSize: 500, chunkOverlap: 50 },
    version: '1.0.0',
  })),
}))

vi.mock('@hidock/ai-providers', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@hidock/ai-providers')>()
  return { ...mod, complete: vi.fn() }
})

let _dbCounter = 0
vi.mock('../file-storage', () => ({
  getDatabasePath: vi.fn(() => join(tmpdir(), `hidock-grounding-excl-${Date.now()}-${++_dbCounter}.sqlite`)),
}))

import {
  initializeDatabase,
  run as dbRun,
  runInTransaction,
  setRecordingPersonal,
  deleteRecordingCascade,
  restoreRecording,
  getExcludedRecordingIds,
  setGraphProvenanceCleanup,
} from '../database'
import {
  neighborhoodFacts,
  getGroundingExclusionSet,
  getKnowledgeGraphStore,
  queryNeighborhood,
  queryContextGraph,
  queryLens,
  searchGraphNodes,
  queryProvenance,
  getNodeDetail,
  queryTopAttendees,
  queryTopSkill,
  queryPersonProfile,
  queryMeetingGraph,
  queryStats,
  queryListNodes,
  removeRecordingProvenanceCore,
} from '../knowledge-graph-service'

function seedRecording(id: string): void {
  dbRun('INSERT OR IGNORE INTO recordings (id, filename, date_recorded) VALUES (?, ?, ?)', [
    id,
    `${id}.hda`,
    '2026-06-01',
  ])
}

function seedNode(id: string, type: string, label: string): void {
  dbRun(
    'INSERT OR IGNORE INTO graph_nodes (id, type, label, norm_key, props, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?)',
    [id, type, label, `${type}:${label.toLowerCase()}`, '2026-06-01', '2026-06-01']
  )
}

function seedEdge(id: string, sourceId: string, targetId: string, type: string): void {
  dbRun(
    'INSERT OR IGNORE INTO graph_edges (id, source_id, target_id, type, props, weight, created_at) VALUES (?, ?, ?, ?, NULL, 1, ?)',
    [id, sourceId, targetId, type, '2026-06-01']
  )
}

function seedEdgeSource(edgeId: string, recordingId: string, transcriptId: string): void {
  dbRun(
    'INSERT OR IGNORE INTO graph_edge_sources (edge_id, recording_id, transcript_id, assertion_count, created_at) VALUES (?, ?, ?, 1, ?)',
    [edgeId, recordingId, transcriptId, '2026-06-01']
  )
}

/**
 * Graph centered on Alice:
 *  - eA:      Alice -MENTIONED-> Roadmap   — sourced ONLY by recA
 *  - eShared: Alice -MENTIONED-> Backlog   — sourced by recA AND recB
 *  - eLegacy: Alice -RELATES_TO-> Bob      — NO provenance rows (pre-F18)
 */
function seedGraph(): void {
  getKnowledgeGraphStore() // ensure graph schema exists
  seedRecording('recA')
  seedRecording('recB')
  seedNode('nAlice', 'person', 'Alice')
  seedNode('nBob', 'person', 'Bob')
  seedNode('nRoadmap', 'topic', 'Roadmap')
  seedNode('nBacklog', 'topic', 'Backlog')

  seedEdge('eA', 'nAlice', 'nRoadmap', 'MENTIONED')
  seedEdgeSource('eA', 'recA', 'txA')

  seedEdge('eShared', 'nAlice', 'nBacklog', 'MENTIONED')
  seedEdgeSource('eShared', 'recA', 'txA')
  seedEdgeSource('eShared', 'recB', 'txB')

  seedEdge('eLegacy', 'nAlice', 'nBob', 'RELATES_TO')
  // no graph_edge_sources for eLegacy — legacy/unattributed
}

beforeEach(async () => {
  vi.clearAllMocks()
  await initializeDatabase()
  seedGraph()
})

describe('ARF-2 — provenance-aware assistant grounding', () => {
  it('baseline: with no exclusions, all three facts ground', () => {
    const facts = neighborhoodFacts('Alice')
    expect(facts).toContain('Alice mentioned Roadmap') // eA
    expect(facts).toContain('Alice mentioned Backlog') // eShared
    expect(facts).toContain('Alice relates to Bob') // eLegacy
  })

  it('soft-delete recA suppresses ONLY the fact solely sourced by recA', () => {
    deleteRecordingCascade('recA', { hard: false })
    expect(getExcludedRecordingIds().ids.has('recA')).toBe(true)

    const facts = neighborhoodFacts('Alice')
    // eA — every source (recA) excluded → suppressed.
    expect(facts).not.toContain('Alice mentioned Roadmap')
    // eShared — recB still eligible → kept.
    expect(facts).toContain('Alice mentioned Backlog')
    // eLegacy — no provenance rows → kept.
    expect(facts).toContain('Alice relates to Bob')
  })

  it('restore recA brings the suppressed fact back', () => {
    deleteRecordingCascade('recA', { hard: false })
    expect(neighborhoodFacts('Alice')).not.toContain('Alice mentioned Roadmap')

    restoreRecording('recA')
    expect(getExcludedRecordingIds().ids.has('recA')).toBe(false)
    expect(neighborhoodFacts('Alice')).toContain('Alice mentioned Roadmap')
  })

  it('marking recA personal suppresses its sole-sourced fact; unmarking restores it', () => {
    setRecordingPersonal('recA', true)
    expect(neighborhoodFacts('Alice')).not.toContain('Alice mentioned Roadmap')

    setRecordingPersonal('recA', false)
    expect(neighborhoodFacts('Alice')).toContain('Alice mentioned Roadmap')
  })

  it('value-excluding recA (garbage capture, no keep) suppresses its sole-sourced fact', () => {
    dbRun(
      'INSERT INTO knowledge_captures (id, title, captured_at, source_recording_id, quality_rating) VALUES (?, ?, ?, ?, ?)',
      ['capA', 'Cap', '2026-06-01', 'recA', 'garbage']
    )
    expect(getExcludedRecordingIds().ids.has('recA')).toBe(true)
    expect(neighborhoodFacts('Alice')).not.toContain('Alice mentioned Roadmap')
    // Legacy + shared still present.
    expect(neighborhoodFacts('Alice')).toContain('Alice relates to Bob')
    expect(neighborhoodFacts('Alice')).toContain('Alice mentioned Backlog')
  })

  it('excluding BOTH sources of a shared fact suppresses it; legacy fact still survives', () => {
    deleteRecordingCascade('recA', { hard: false })
    deleteRecordingCascade('recB', { hard: false })
    const facts = neighborhoodFacts('Alice')
    expect(facts).not.toContain('Alice mentioned Roadmap') // eA
    expect(facts).not.toContain('Alice mentioned Backlog') // eShared — both sources excluded now
    expect(facts).toContain('Alice relates to Bob') // eLegacy — unattributed, untouched
  })

  it('when every incident fact is suppressed and only the legacy one remains, grounding still returns it', () => {
    // Sanity that suppression never over-reaches into empty output when a
    // legacy fact remains.
    deleteRecordingCascade('recA', { hard: false })
    deleteRecordingCascade('recB', { hard: false })
    const facts = neighborhoodFacts('Alice')
    expect(facts).not.toBe('')
    expect(facts).toContain('Alice relates to Bob')
  })

  it('getGroundingExclusionSet mirrors getExcludedRecordingIds (healthy = not fail-closed)', () => {
    deleteRecordingCascade('recA', { hard: false })
    setRecordingPersonal('recB', true)
    const exclusion = getGroundingExclusionSet()
    expect(exclusion.failClosed).toBe(false)
    expect(exclusion.ids.has('recA')).toBe(true)
    expect(exclusion.ids.has('recB')).toBe(true)
  })

  // ADV9 (round-9) — regression (a)/(b): a HARD-PURGED recording whose graph edge
  // survived a deferred/failed cleanup (skipGraphCleanup / pending cleanup) is
  // gone from `recordings`, so the OLD blocklist (getExcludedRecordingIds, LIVE
  // rows only) never listed it and its residual edge kept grounding. The POSITIVE
  // allowlist marks the now-missing id ineligible, so the residual edge is
  // suppressed EVERYWHERE until the sweep removes it.
  it('ADV9 — a purged recording with a residual graph edge is suppressed (positive allowlist)', () => {
    // Simulate the partial cleanup: the row is gone (purge committed) but
    // graph_edge_sources for recA remain (graph cleanup deferred/failed).
    dbRun('DELETE FROM recordings WHERE id = ?', ['recA'])

    const exclusion = getGroundingExclusionSet()
    expect(exclusion.failClosed).toBe(false)
    expect(exclusion.ids.has('recA')).toBe(true) // NEW: caught despite the missing row

    const facts = neighborhoodFacts('Alice')
    expect(facts).not.toContain('Alice mentioned Roadmap') // eA (sole source recA) suppressed
    expect(facts).toContain('Alice mentioned Backlog') // eShared — recB still eligible
    expect(facts).toContain('Alice relates to Bob') // legacy — unattributed
    // The visual view suppresses it too.
    const view = queryNeighborhood('Alice')
    expect(view.nodes.map((n) => n.label)).not.toContain('Roadmap')
  })

  it('ADV9 — once the graph-cleanup sweep removes the residual edge, nothing remains to suppress', () => {
    dbRun('DELETE FROM recordings WHERE id = ?', ['recA'])
    // The deferred sweep finally removes recA's provenance/edges.
    removeRecordingProvenanceCore('recA', {})
    // eA is now GONE (not merely suppressed); Backlog + Bob remain.
    const facts = neighborhoodFacts('Alice')
    expect(facts).not.toContain('Alice mentioned Roadmap')
    expect(facts).toContain('Alice mentioned Backlog')
    // With recA no longer referenced by any edge, it drops out of the exclusion set.
    expect(getGroundingExclusionSet().ids.has('recA')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// ADV18-2 (round-19) — neighborhoodFacts collects the authoritative recording
// ids behind the EMITTED facts into the optional provOut sink, so the RAG
// service can fold graph provenance into the persisted answer's union.
// ---------------------------------------------------------------------------

describe('ADV18-2 — neighborhoodFacts fact-edge provenance capture', () => {
  const noExclusion = { ids: new Set<string>(), failClosed: false }

  it('captures ALL co-sources of the emitted facts (legacy zero-provenance contributes no recording id)', () => {
    const provOut = { recordingIds: new Set<string>(), unresolved: false }
    const facts = neighborhoodFacts('Alice', 1, 20, noExclusion, provOut)
    // eA→recA, eShared→recA+recB emit; eLegacy has NO provenance rows.
    expect(facts).toContain('Alice mentioned Roadmap')
    expect([...provOut.recordingIds].sort()).toEqual(['recA', 'recB'])
    // ADV19-3 (round-20) — eLegacy (zero-provenance) is EMITTED here, so the chat
    // union is marked unresolved (unverifiable): we cannot prove it isn't from a
    // now-excluded recording, so an answer grounded on it fails closed on re-read.
    expect(provOut.unresolved).toBe(true)
  })

  it('ADV19-3 — a suppressed attributed fact contributes no id, but an emitted legacy fact marks the union unresolved', () => {
    // Exclude recA AND recB → eA + eShared both suppressed; only the zero-provenance
    // eLegacy emits — which is itself unverifiable for chat.
    deleteRecordingCascade('recA', { hard: false })
    deleteRecordingCascade('recB', { hard: false })
    const provOut = { recordingIds: new Set<string>(), unresolved: false }
    const facts = neighborhoodFacts('Alice', 1, 20, getGroundingExclusionSet(), provOut)
    expect(facts).toContain('Alice relates to Bob') // legacy only
    expect(provOut.recordingIds.size).toBe(0) // no attributed fact emitted
    expect(provOut.unresolved).toBe(true) // zero-provenance legacy fact emitted ⇒ unverifiable for chat
  })

  it('ADV19-3 — an answer grounded ONLY on fully-attributed (non-legacy) facts stays verifiable', () => {
    // Neighborhood of Bob touches ONLY the legacy edge, so use a center whose
    // emitted facts are all attributed: exclude nothing, but restrict maxFacts so
    // only attributed facts emit is not deterministic — instead assert the inverse
    // via a graph with no legacy incident edge. Roadmap is reached solely via eA
    // (attributed to recA); its neighborhood emits only the attributed eA.
    const provOut = { recordingIds: new Set<string>(), unresolved: false }
    const facts = neighborhoodFacts('Roadmap', 1, 20, noExclusion, provOut)
    expect(facts).toContain('Alice mentioned Roadmap')
    expect([...provOut.recordingIds]).toEqual(['recA'])
    // No zero-provenance fact was emitted for Roadmap ⇒ union stays verifiable.
    expect(provOut.unresolved).toBe(false)
  })

  it('marks the union unverifiable when the fact-provenance read throws', () => {
    // Throw ONLY for the graph_edge_sources read (the fact-provenance collection),
    // leaving the node/edge reads that build the neighborhood intact. No-op
    // exclusion means suppression never queries provenance, so facts still emit
    // and only the provOut collection hits the failure.
    const store = getKnowledgeGraphStore()
    const orig = store.db.queryAll.bind(store.db)
    const spy = vi.spyOn(store.db, 'queryAll').mockImplementation((sql: string, ...rest: unknown[]) => {
      if (typeof sql === 'string' && sql.includes('graph_edge_sources')) throw new Error('boom')
      return (orig as (s: string, ...r: unknown[]) => unknown[])(sql, ...rest)
    })
    try {
      const provOut = { recordingIds: new Set<string>(), unresolved: false }
      const facts = neighborhoodFacts('Alice', 1, 20, noExclusion, provOut)
      expect(facts).not.toBe('') // facts still emit
      expect(provOut.unresolved).toBe(true)
    } finally {
      spy.mockRestore()
    }
  })
})

// ---------------------------------------------------------------------------
// RE-4 — provenance suppression on the VISUAL view paths (queryNeighborhood,
// queryContextGraph, queryLens): an excluded post-F18 recording's attributed
// edges (and nodes they orphan) must not show; legacy + shared-source stay.
// ---------------------------------------------------------------------------

describe('RE-4 — Context Graph views suppress excluded provenance', () => {
  const labelsOf = (data: { nodes: Array<{ label: string }> }) => data.nodes.map((n) => n.label)
  const edgeTargets = (data: { edges: Array<{ target: string }>; nodes: Array<{ id: string; label: string }> }) => {
    const byId = new Map(data.nodes.map((n) => [n.id, n.label]))
    return data.edges.map((e) => byId.get(e.target) ?? e.target)
  }

  it('ADV23-2 — baseline shows attributed neighbors; the legacy zero-provenance neighbor is SUPPRESSED', () => {
    // Round-24 flip: Bob is reachable only via eLegacy (zero-provenance). On a
    // NON-OWNER view surface a pre-F18 zero-provenance edge is now suppressed
    // (fail-closed interim until the F21 rebuild), so Bob is pruned even with NO
    // recording excluded. Attributed neighbors (Roadmap/Backlog) stay.
    const data = queryNeighborhood('Alice')
    expect(labelsOf(data)).toEqual(expect.arrayContaining(['Alice', 'Roadmap', 'Backlog']))
    expect(labelsOf(data)).not.toContain('Bob') // legacy zero-provenance → suppressed
  })

  it('soft-delete recA drops the sole-sourced edge AND prunes its orphaned node', () => {
    deleteRecordingCascade('recA', { hard: false })
    const data = queryNeighborhood('Alice')
    // Roadmap was reachable ONLY via eA (recA) → edge suppressed, node pruned.
    expect(labelsOf(data)).not.toContain('Roadmap')
    // Backlog (shared, recB eligible) stays. Bob (legacy zero-provenance) is now
    // suppressed on the view surface too (ADV23-2).
    expect(labelsOf(data)).toEqual(expect.arrayContaining(['Alice', 'Backlog']))
    expect(labelsOf(data)).not.toContain('Bob')
    expect(edgeTargets(data)).not.toContain('Roadmap')
  })

  it('restore recA returns the pruned node + edge to the view', () => {
    deleteRecordingCascade('recA', { hard: false })
    expect(labelsOf(queryNeighborhood('Alice'))).not.toContain('Roadmap')
    restoreRecording('recA')
    expect(labelsOf(queryNeighborhood('Alice'))).toContain('Roadmap')
  })

  it('personal + value-excluded transitions suppress the view too', () => {
    setRecordingPersonal('recA', true)
    expect(labelsOf(queryNeighborhood('Alice'))).not.toContain('Roadmap')
    setRecordingPersonal('recA', false)
    expect(labelsOf(queryNeighborhood('Alice'))).toContain('Roadmap')

    dbRun(
      'INSERT INTO knowledge_captures (id, title, captured_at, source_recording_id, quality_rating) VALUES (?, ?, ?, ?, ?)',
      ['capA', 'Cap', '2026-06-01', 'recA', 'garbage']
    )
    expect(labelsOf(queryNeighborhood('Alice'))).not.toContain('Roadmap')
  })

  it('a shared-source edge is KEPT while any source stays eligible, suppressed only when all excluded', () => {
    deleteRecordingCascade('recA', { hard: false })
    // eShared (recA + recB) — recB eligible → Backlog stays.
    expect(labelsOf(queryNeighborhood('Alice'))).toContain('Backlog')
    deleteRecordingCascade('recB', { hard: false })
    // Now both sources excluded → Backlog's only edge suppressed → pruned.
    expect(labelsOf(queryNeighborhood('Alice'))).not.toContain('Backlog')
    // ADV23-2 — legacy Bob is now suppressed on the view surface too.
    expect(labelsOf(queryNeighborhood('Alice'))).not.toContain('Bob')
  })

  it('queryContextGraph (full view) suppresses excluded attributed AND legacy zero-provenance edges', () => {
    deleteRecordingCascade('recA', { hard: false })
    const data = queryContextGraph(100)
    // The Alice→Roadmap edge is gone from the whole-graph view.
    const byId = new Map(data.nodes.map((n) => [n.id, n.label]))
    const edgeLabels = data.edges.map((e) => `${byId.get(e.source)}→${byId.get(e.target)}`)
    expect(edgeLabels).not.toContain('Alice→Roadmap')
    // ADV23-2 — the legacy zero-provenance edge is now suppressed too (was kept).
    expect(edgeLabels).not.toContain('Alice→Bob')
    // A shared edge with an eligible source (recB) still shows.
    expect(edgeLabels).toContain('Alice→Backlog')
  })

  it('queryLens suppresses excluded attributed edges (lens fields still present)', () => {
    deleteRecordingCascade('recA', { hard: false })
    const lens = queryLens('Alice', { hops: 1 })
    expect(lens).toHaveProperty('strata')
    const byId = new Map(lens.nodes.map((n) => [n.id, n.label]))
    const edgeLabels = lens.edges.map((e) => `${byId.get(e.source)}→${byId.get(e.target)}`)
    expect(edgeLabels).not.toContain('Alice→Roadmap')
  })
})

// ---------------------------------------------------------------------------
// P1 (round-3) — the exclusion lookup FAILS CLOSED: if it throws, grounding
// suppresses ALL recording-attributed facts (only legacy zero-provenance
// survives) rather than leaking them on a transient DB error.
// ---------------------------------------------------------------------------

describe('P1 — grounding fails closed on exclusion-lookup error', () => {
  it('getGroundingExclusionSet reports failClosed=true when the lookup throws', () => {
    dbRun('DROP TABLE recordings') // forces getExcludedRecordingIds to throw
    const exclusion = getGroundingExclusionSet()
    expect(exclusion.failClosed).toBe(true)
    expect(exclusion.ids.size).toBe(0)
  })

  it('neighborhoodFacts suppresses ALL attributed facts but keeps legacy on lookup failure', () => {
    dbRun('DROP TABLE recordings')
    const facts = neighborhoodFacts('Alice')
    // eA (recA) and eShared (recA+recB) are attributed → suppressed.
    expect(facts).not.toContain('Alice mentioned Roadmap')
    expect(facts).not.toContain('Alice mentioned Backlog')
    // eLegacy has no provenance rows → kept (grounding not gutted).
    expect(facts).toContain('Alice relates to Bob')
  })

  it('the non-centered overview fails closed (attributed AND legacy edges hidden)', () => {
    // ADV23-2 flip: under fail-closed the overview suppresses attributed edges
    // AND (now) legacy zero-provenance edges. With every Alice edge suppressed,
    // Alice is orphaned and pruned — the whole-graph view is emptied.
    dbRun('DROP TABLE recordings')
    const data = queryContextGraph(100)
    const byId = new Map(data.nodes.map((n) => [n.id, n.label]))
    const edgeLabels = data.edges.map((e) => `${byId.get(e.source)}→${byId.get(e.target)}`)
    expect(edgeLabels).not.toContain('Alice→Roadmap')
    expect(edgeLabels).not.toContain('Alice→Backlog')
    expect(edgeLabels).not.toContain('Alice→Bob') // legacy no longer survives fail-closed
  })
})

// ---------------------------------------------------------------------------
// P3 (round-3) — provenance suppression on the inspector/search read IPCs.
// ---------------------------------------------------------------------------

describe('P3 — search / provenance / inspector hide excluded-only nodes', () => {
  it('searchGraphNodes hides a node whose ONLY provenance is excluded', () => {
    // Roadmap is reachable only via eA (recA). Exclude recA → excluded-only.
    expect(searchGraphNodes('Roadmap').map((n) => n.label)).toContain('Roadmap')
    deleteRecordingCascade('recA', { hard: false })
    expect(searchGraphNodes('Roadmap').map((n) => n.label)).not.toContain('Roadmap')
    // ADV23-2 — Bob is reachable only via a legacy zero-provenance edge → now an
    // excluded-only node on the search surface → NOT findable.
    expect(searchGraphNodes('Bob').map((n) => n.label)).not.toContain('Bob')
    // Backlog (shared, recB eligible via an ATTRIBUTED edge) remains findable.
    expect(searchGraphNodes('Backlog').map((n) => n.label)).toContain('Backlog')
  })

  it('an isolated node (no edges) stays findable even under exclusion', () => {
    seedNode('nSolo', 'topic', 'Solo')
    deleteRecordingCascade('recA', { hard: false })
    expect(searchGraphNodes('Solo').map((n) => n.label)).toContain('Solo')
  })

  it('queryProvenance of a shared-source center omits the excluded edge contribution', () => {
    // Alice is a shared-source center (eShared kept via recB). Roadmap reaches
    // Alice only via eA (recA). Excluding recA removes Roadmap from Alice's
    // provenance while Backlog (shared) stays.
    deleteRecordingCascade('recA', { hard: false })
    const prov = queryProvenance('Alice')
    const allLabels = [...prov.meetings, ...prov.people, ...prov.projects, ...prov.actions].map((e) => e.label)
    expect(allLabels).not.toContain('Roadmap')
  })

  it('getNodeDetail returns empty for an excluded-only node', () => {
    deleteRecordingCascade('recA', { hard: false })
    const detail = getNodeDetail('Roadmap')
    expect(detail.node).toBeNull()
  })

  it('restore returns the node to search + inspector', () => {
    deleteRecordingCascade('recA', { hard: false })
    expect(searchGraphNodes('Roadmap').map((n) => n.label)).not.toContain('Roadmap')
    restoreRecording('recA')
    expect(searchGraphNodes('Roadmap').map((n) => n.label)).toContain('Roadmap')
    expect(getNodeDetail('Roadmap').node).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// INC-4 (round-3) — the overview cap must fill with ELIGIBLE content: an
// excluded high-degree hub must not consume the slice and leave it sparse.
// ---------------------------------------------------------------------------

describe('INC-4 — overview built from eligible edges/nodes', () => {
  it('an excluded hub does not consume the limited overview slice', () => {
    // Build an EXCLUDED hub H (degree 5, all edges sourced by recX) plus two
    // eligible nodes E1/E2 connected to a shared anchor via ATTRIBUTED edges to an
    // eligible recording (recLiveA). ADV23-2 (round-24) — the eligible nodes must
    // be attributed to a live recording, NOT connected by legacy zero-provenance
    // edges, since those are now suppressed on the view surface.
    seedRecording('recX')
    seedRecording('recLiveA')
    seedNode('nHub', 'topic', 'Hub')
    seedNode('nAnchor', 'topic', 'Anchor')
    for (const [i, leaf] of ['L1', 'L2', 'L3', 'L4', 'L5'].entries()) {
      seedNode(`n${leaf}`, 'topic', leaf)
      seedEdge(`eHub${i}`, 'nHub', `n${leaf}`, 'RELATES_TO')
      seedEdgeSource(`eHub${i}`, 'recX', 'txX') // all Hub edges attributed to recX
    }
    seedNode('nE1', 'topic', 'E1')
    seedNode('nE2', 'topic', 'E2')
    seedEdge('eE1', 'nAnchor', 'nE1', 'RELATES_TO')
    seedEdgeSource('eE1', 'recLiveA', 'txLiveA') // eligible attributed edge
    seedEdge('eE2', 'nAnchor', 'nE2', 'RELATES_TO')
    seedEdgeSource('eE2', 'recLiveA', 'txLiveA') // eligible attributed edge

    // Exclude recX → Hub's every edge is suppressed → eligible degree 0.
    deleteRecordingCascade('recX', { hard: false })

    // A tight overview cap must fill with visible content (Anchor/E1/E2 + the
    // original Alice cluster), NOT be eaten by the now-invisible Hub.
    const overview = queryContextGraph(4)
    const labels = overview.nodes.map((n) => n.label)
    expect(labels).not.toContain('Hub')
    // The slice is filled with eligible nodes (not left sparse/empty).
    expect(overview.nodes.length).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// ADV10-MED (round-11) — searchGraphNodes must page ordered matches until the
// requested number of VISIBLE nodes is collected, with NO fixed limit*4 ceiling.
// Under partial cleanup a long run of excluded-only matches must not truncate an
// eligible match that ranks after them.
// ---------------------------------------------------------------------------

describe('ADV10-MED — graph-node search pages past excluded-only matches', () => {
  it('returns an eligible match that ranks after >limit*4 excluded-only matches', () => {
    // A dead recording whose provenance makes every "zzq##" node excluded-only.
    seedRecording('recDead')
    seedRecording('recLive') // eligible — keeps the "eligible" match visible
    // 50 excluded-only nodes (> default limit 12 * 4 = 48) all matching "zzq",
    // each length-5 label so they sort (LENGTH ASC, id ASC) AHEAD of the longer
    // eligible label. Each is attributed SOLELY to recDead → invisible once excluded.
    for (let i = 0; i < 50; i++) {
      const pad = String(i).padStart(2, '0')
      seedNode(`nDead${pad}`, 'topic', `zzq${pad}`) // label length 5
      seedEdge(`eDead${pad}`, `nDead${pad}`, 'nAlice', 'MENTIONED')
      seedEdgeSource(`eDead${pad}`, 'recDead', 'txDead')
    }
    // One eligible node matching "zzq" via an ATTRIBUTED edge to an eligible
    // recording → visible (ADV23-2: a legacy zero-provenance edge would now be
    // suppressed). Its longer label sorts it AFTER all 50 dead nodes, so the old
    // fixed limit*4 fetch (48 rows) would never have examined it.
    seedNode('nEligZzq', 'topic', 'zzqEligibleLongLabel') // length > 5 → sorts last
    seedEdge('eEligZzq', 'nEligZzq', 'nAlice', 'RELATES_TO')
    seedEdgeSource('eEligZzq', 'recLive', 'txLive') // eligible attributed → survives

    // (No baseline "no-exclusion" assertion: with 51 matches and the default
    // limit of 12, the long-label eligible node legitimately ranks 51st by the
    // LENGTH-ASC ordering and is not in the top slice — that is correct ranking,
    // not the bug. The bug is that AFTER exclusion it must still surface.)

    // Exclude recDead → all 50 zzq## nodes become excluded-only, ranked ahead of
    // the eligible match. Paging must still surface the eligible node.
    deleteRecordingCascade('recDead', { hard: false })
    const results = searchGraphNodes('zzq')
    const labels = results.map((n) => n.label)

    // The eligible node is returned despite ranking after 50 excluded matches.
    expect(labels).toContain('zzqEligibleLongLabel')
    // No excluded-only node leaks into the results.
    expect(labels.some((l) => /^zzq\d\d$/.test(l))).toBe(false)
    // Never exceeds the requested visible limit.
    expect(results.length).toBeLessThanOrEqual(12)
  })

  it('respects the visible limit while paging past excluded-only matches', () => {
    seedRecording('recDead2')
    seedRecording('recLive2') // eligible — keeps the eligible matches visible
    // 48 excluded-only "wqz##" nodes (length 5) ahead of many eligible ones.
    for (let i = 0; i < 48; i++) {
      const pad = String(i).padStart(2, '0')
      seedNode(`nDx${pad}`, 'topic', `wqz${pad}`)
      seedEdge(`eDx${pad}`, `nDx${pad}`, 'nAlice', 'MENTIONED')
      seedEdgeSource(`eDx${pad}`, 'recDead2', 'txD2')
    }
    // 20 eligible "wqz##" nodes via ATTRIBUTED edges to an eligible recording
    // (longer labels sort after the dead ones). ADV23-2: legacy edges would be
    // suppressed, so attribute them to keep them visible.
    for (let i = 0; i < 20; i++) {
      const pad = String(i).padStart(2, '0')
      seedNode(`nEx${pad}`, 'topic', `wqzEligible${pad}`)
      seedEdge(`eEx${pad}`, `nEx${pad}`, 'nAlice', 'RELATES_TO')
      seedEdgeSource(`eEx${pad}`, 'recLive2', 'txL2') // eligible attributed → survives
    }
    deleteRecordingCascade('recDead2', { hard: false })

    const results = searchGraphNodes('wqz', 5)
    // Exactly the requested visible limit, all eligible, none excluded.
    expect(results.length).toBe(5)
    expect(results.every((n) => n.label.startsWith('wqzEligible'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// ADV11-MED (round-12) — the exclusion is pushed into SQL via a materialized
// excluded-only node set (a FIXED, bounded number of queries), NOT a per-node
// isNodeVisibleUnderExclusion N+1 that scaled with the number of matches. A
// large excluded-only block must not translate into table-sized synchronous
// work on the main thread.
// ---------------------------------------------------------------------------

describe('ADV11-MED — graph-node search does bounded work (no per-node N+1)', () => {
  it('finds an eligible match past a >200-node excluded block with a bounded query count', () => {
    seedRecording('recBig')
    seedRecording('recLiveBig') // eligible — keeps the eligible match visible
    // 250 excluded-only "qxb###" nodes (length 6) ranked ahead of the eligible one.
    for (let i = 0; i < 250; i++) {
      const pad = String(i).padStart(3, '0')
      seedNode(`nBig${pad}`, 'topic', `qxb${pad}`) // length 6
      seedEdge(`eBig${pad}`, `nBig${pad}`, 'nAlice', 'MENTIONED')
      seedEdgeSource(`eBig${pad}`, 'recBig', 'txBig')
    }
    // One eligible node via an ATTRIBUTED edge to an eligible recording, longer
    // label → sorts last (ADV23-2: a legacy edge would now be suppressed).
    seedNode('nBigElig', 'topic', 'qxbEligibleLongLabel')
    seedEdge('eBigElig', 'nBigElig', 'nAlice', 'RELATES_TO')
    seedEdgeSource('eBigElig', 'recLiveBig', 'txLiveBig') // eligible attributed → survives

    deleteRecordingCascade('recBig', { hard: false })

    // Count DB reads issued on the graph store during the search. The old per-node
    // path fired ≥1 store query PER excluded match examined (250+). The SQL-level
    // path issues only a fixed handful (provenance scan + edges scan + one search).
    const store = getKnowledgeGraphStore()
    const spy = vi.spyOn(store.db, 'queryAll')
    try {
      const labels = searchGraphNodes('qxb').map((n) => n.label)
      expect(labels).toContain('qxbEligibleLongLabel')
      expect(labels.some((l) => /^qxb\d\d\d$/.test(l))).toBe(false)
      // Bounded: far below the 250-node block — proves work is NOT per-node.
      expect(spy.mock.calls.length).toBeLessThan(20)
    } finally {
      spy.mockRestore()
    }
  })
})

// ---------------------------------------------------------------------------
// ADV12-MED (round-13) — the excluded-only set is pushed into SQL via a TEMP
// TABLE + anti-join, so the search statement's BOUND-VARIABLE count is O(1) in
// the exclusion size. The old `id NOT IN (?, ?, …)` build bound one parameter
// per hidden id, so once the excluded-only set approached better-sqlite3's
// MAX_VARIABLE_NUMBER (32766) the statement exceeded the limit and graph search
// THREW. These cases run on the REAL better-sqlite3 engine at 0 / 1000 (>999) /
// 32764 / >32766 excluded-only nodes: search must NOT throw and must still
// surface an eligible node ranked behind the excluded block.
// ---------------------------------------------------------------------------

/**
 * Seed `count` excluded-only nodes (each sourced solely by `dead`) plus ONE
 * eligible node reachable via an ATTRIBUTED edge to an eligible recording
 * (`${dead}_live`) whose longer label sorts LAST under the LENGTH(label),id
 * ordering. All share `prefix` so a single search query matches the whole block.
 * ADV23-2 (round-24) — the eligible node is attributed (NOT a legacy
 * zero-provenance edge, which the view/search surface now suppresses). Wrapped in
 * a transaction so tens of thousands of rows insert quickly on the real engine.
 */
function seedExcludedOnlyBlock(prefix: string, dead: string, count: number): void {
  runInTransaction(() => {
    seedRecording(dead)
    const live = `${dead}_live`
    seedRecording(live)
    for (let i = 0; i < count; i++) {
      const label = `${prefix}${i}`
      seedNode(`n_${label}`, 'topic', label)
      seedEdge(`e_${label}`, `n_${label}`, 'nAlice', 'MENTIONED')
      seedEdgeSource(`e_${label}`, dead, `tx_${dead}`)
    }
    // Longer label → sorts after the entire excluded block; attributed to an
    // eligible recording → survives suppression.
    seedNode(`n_${prefix}Elig`, 'topic', `${prefix}EligibleLongLabel`)
    seedEdge(`e_${prefix}Elig`, `n_${prefix}Elig`, 'nAlice', 'RELATES_TO')
    seedEdgeSource(`e_${prefix}Elig`, live, `tx_${live}`)
  })
}

describe('ADV12-MED — graph-node search bounds SQLite variables via a temp-table anti-join', () => {
  it('no excluded block: search returns eligible matches without throwing', () => {
    // ADV23-2 (round-24) — attribute the eligible nodes to a live recording; a
    // legacy zero-provenance edge would now be suppressed on the search surface.
    seedRecording('recParam0Live')
    seedNode('nParam0', 'topic', 'pzz0')
    seedNode('nParam0b', 'topic', 'pzz0EligibleLongLabel')
    seedEdge('eParam0', 'nParam0', 'nAlice', 'RELATES_TO')
    seedEdgeSource('eParam0', 'recParam0Live', 'txParam0Live')
    seedEdge('eParam0b', 'nParam0b', 'nAlice', 'RELATES_TO')
    seedEdgeSource('eParam0b', 'recParam0Live', 'txParam0Live')
    let labels: string[] = []
    expect(() => {
      labels = searchGraphNodes('pzz', 20).map((n) => n.label)
    }).not.toThrow()
    expect(labels).toContain('pzz0')
    expect(labels).toContain('pzz0EligibleLongLabel')
  })

  it('1000 excluded-only nodes (>999): does not throw and surfaces the eligible match', () => {
    seedExcludedOnlyBlock('pxa', 'recParam1k', 1000)
    deleteRecordingCascade('recParam1k', { hard: false })
    let labels: string[] = []
    expect(() => {
      labels = searchGraphNodes('pxa').map((n) => n.label)
    }).not.toThrow()
    expect(labels).toContain('pxaEligibleLongLabel')
    expect(labels.some((l) => /^pxa\d+$/.test(l))).toBe(false)
    expect(labels.length).toBeLessThanOrEqual(12)
  }, 60000)

  it('32764 excluded-only nodes (just under MAX_VARIABLE_NUMBER): does not throw', () => {
    seedExcludedOnlyBlock('pxb', 'recParam32764', 32764)
    deleteRecordingCascade('recParam32764', { hard: false })
    let labels: string[] = []
    expect(() => {
      labels = searchGraphNodes('pxb').map((n) => n.label)
    }).not.toThrow()
    expect(labels).toContain('pxbEligibleLongLabel')
    expect(labels.some((l) => /^pxb\d+$/.test(l))).toBe(false)
  }, 120000)

  it('32770 excluded-only nodes (>MAX_VARIABLE_NUMBER 32766): does not throw and still surfaces the eligible match', () => {
    // With the old `id NOT IN (?, …)` build this exceeded the 32766 bound-variable
    // ceiling and threw "too many SQL variables". The temp-table anti-join binds
    // only the LIKE pattern + LIMIT, so it succeeds.
    seedExcludedOnlyBlock('pxc', 'recParam32770', 32770)
    deleteRecordingCascade('recParam32770', { hard: false })
    let labels: string[] = []
    expect(() => {
      labels = searchGraphNodes('pxc').map((n) => n.label)
    }).not.toThrow()
    expect(labels).toContain('pxcEligibleLongLabel')
    expect(labels.some((l) => /^pxc\d+$/.test(l))).toBe(false)
    expect(labels.length).toBeLessThanOrEqual(12)
  }, 120000)

  it('leaves no _sgn_excluded_nodes temp table behind after a search', () => {
    seedExcludedOnlyBlock('pxd', 'recParamLeak', 1000)
    deleteRecordingCascade('recParamLeak', { hard: false })
    searchGraphNodes('pxd')
    const store = getKnowledgeGraphStore()
    const leaked = store.db.queryOne<{ name: string }>(
      "SELECT name FROM sqlite_temp_master WHERE type = 'table' AND name = '_sgn_excluded_nodes'"
    )
    expect(leaked).toBeUndefined()
  }, 60000)
})

// ---------------------------------------------------------------------------
// RE-3 — legacy ZERO-provenance edges CANNOT be attributed, so a permanent
// delete never removes them and grounding keeps them (documented behavior).
// ---------------------------------------------------------------------------

describe('RE-3 — legacy zero-provenance edges persist through permanent delete', () => {
  it('permanent-deleting recA leaves the unattributed legacy edge intact + still grounding', () => {
    // Wire the real provenance cleanup so a hard purge is allowed (fail-closed).
    setGraphProvenanceCleanup((id, opts) => removeRecordingProvenanceCore(id, opts))
    try {
      const store = getKnowledgeGraphStore()
      const legacyBefore = store.db.queryOne('SELECT id FROM graph_edges WHERE id = ?', ['eLegacy'])
      expect(legacyBefore).toBeTruthy()

      // Permanent delete of recA: removes eA (sole-source recA), decrements
      // eShared (shared w/ recB). eLegacy has NO provenance → untouchable.
      deleteRecordingCascade('recA', { hard: true })

      const eLegacy = store.db.queryOne('SELECT id FROM graph_edges WHERE id = ?', ['eLegacy'])
      const eA = store.db.queryOne('SELECT id FROM graph_edges WHERE id = ?', ['eA'])
      expect(eLegacy).toBeTruthy() // legacy edge PERSISTS (can't be attributed/removed)
      expect(eA).toBeFalsy() // this-version attributed edge WAS removed

      // Grounding still surfaces the legacy fact (recA is gone from exclusion set).
      const facts = neighborhoodFacts('Alice')
      expect(facts).toContain('Alice relates to Bob')
      expect(facts).not.toContain('Alice mentioned Roadmap')
    } finally {
      setGraphProvenanceCleanup(null)
    }
  })
})

// ---------------------------------------------------------------------------
// RE4-3 (round-4) — the whole family of raw graph reads (rankings, profile,
// meeting subgraph, list, stats) must not expose excluded-only nodes.
// ---------------------------------------------------------------------------

describe('RE4-3 — ranking / profile / meeting / list / stats hide excluded-only nodes', () => {
  // Zoe attends a meeting about a topic and demonstrates a skill, ALL sourced by
  // recP → excluding recP makes Zoe (+ the meeting/topic/skill) excluded-only.
  function seedAttendanceChain(): void {
    seedRecording('recP')
    seedNode('nZoe', 'person', 'Zoe')
    seedNode('nStandup', 'meeting', 'Standup')
    seedNode('nPlanning', 'topic', 'Planning')
    seedNode('nK8s', 'skill', 'Kubernetes')
    seedEdge('eAtt', 'nZoe', 'nStandup', 'ATTENDED')
    seedEdgeSource('eAtt', 'recP', 'txP')
    seedEdge('eAbout', 'nStandup', 'nPlanning', 'ABOUT')
    seedEdgeSource('eAbout', 'recP', 'txP')
    seedEdge('eDem', 'nZoe', 'nK8s', 'DEMONSTRATED')
    seedEdgeSource('eDem', 'recP', 'txP')
  }

  it('control (no exclusion): Zoe is retrievable everywhere', () => {
    seedAttendanceChain()
    expect(queryTopAttendees('Planning').map((a) => a.person)).toContain('Zoe')
    expect(queryTopSkill('Kubernetes').map((s) => s.person)).toContain('Zoe')
    expect(queryPersonProfile('Zoe')).toBeTruthy()
    expect(queryMeetingGraph('nStandup').meeting).toBeTruthy()
    expect(queryListNodes('person').map((n) => n.label)).toContain('Zoe')
  })

  it('excluding recP removes Zoe + her attributed nodes from every read', () => {
    seedAttendanceChain()
    deleteRecordingCascade('recP', { hard: false })

    expect(queryTopAttendees('Planning').map((a) => a.person)).not.toContain('Zoe')
    expect(queryTopSkill('Kubernetes').map((s) => s.person)).not.toContain('Zoe')
    expect(queryPersonProfile('Zoe')).toBeUndefined()
    // ADV34-1 (round-36): meetingGraph now returns a sanitized DTO (meeting: null when empty).
    expect(queryMeetingGraph('nStandup')).toEqual({ meeting: null, nodes: [], edges: [] })
    const labels = queryListNodes().map((n) => n.label)
    expect(labels).not.toContain('Zoe')
    expect(labels).not.toContain('Standup')
    expect(labels).not.toContain('Kubernetes')
    // The eligible Alice cluster is untouched.
    expect(queryListNodes('person').map((n) => n.label)).toContain('Alice')
  })

  it('queryStats counts only visible (eligible) nodes under exclusion', () => {
    seedAttendanceChain()
    const before = queryStats().nodes
    deleteRecordingCascade('recP', { hard: false })
    const after = queryStats()
    // Zoe/Standup/Planning/Kubernetes (4 excluded-only nodes) drop out.
    expect(after.nodes).toBeLessThan(before)
    expect(after.nodesByType.person ?? 0).toBeGreaterThan(0) // Alice/Bob remain
  })

  it('a shared-provenance person (one excluded + one eligible edge) STAYS retrievable', () => {
    seedRecording('recP')
    seedRecording('recQ')
    seedNode('nShared', 'person', 'Sam')
    seedNode('nM1', 'meeting', 'M1')
    seedNode('nM2', 'meeting', 'M2')
    seedEdge('eS1', 'nShared', 'nM1', 'ATTENDED')
    seedEdgeSource('eS1', 'recP', 'txP') // excluded when recP goes
    seedEdge('eS2', 'nShared', 'nM2', 'ATTENDED')
    seedEdgeSource('eS2', 'recQ', 'txQ') // stays eligible

    deleteRecordingCascade('recP', { hard: false })
    expect(queryListNodes('person').map((n) => n.label)).toContain('Sam')
    expect(queryPersonProfile('Sam')).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// RE4-1 (round-4) — queryProvenance derives EVERYTHING from center-reachable
// survivors: no excluded label / label-derived id in pathIds/narrative/arrays,
// and a node reachable only via an excluded edge is dropped.
// ---------------------------------------------------------------------------

describe('RE4-1 — queryProvenance suppresses the subgraph first', () => {
  function seedProvenanceGraph(): void {
    // Alice ATTENDED SecretMeeting via recA (excluded when recA goes).
    seedNode('nSecret', 'meeting', 'SecretMeeting')
    seedEdge('eAx', 'nAlice', 'nSecret', 'ATTENDED')
    seedEdgeSource('eAx', 'recA', 'txA')
    // SecretMeeting ALSO has a legacy edge elsewhere → globally "visible", but
    // from Alice it is reachable ONLY via the excluded eAx.
    seedNode('nFaraway', 'person', 'Faraway')
    seedEdge('eFar', 'nSecret', 'nFaraway', 'MENTIONED') // legacy, no provenance
  }

  it('control: SecretMeeting appears in Alice provenance with no exclusion', () => {
    seedProvenanceGraph()
    const prov = queryProvenance('Alice')
    const labels = [...prov.meetings, ...prov.people].map((e) => e.label)
    expect(labels).toContain('SecretMeeting')
  })

  it('excluding recA drops SecretMeeting from arrays, pathIds, and narrative (no excluded label/id anywhere)', () => {
    seedProvenanceGraph()
    deleteRecordingCascade('recA', { hard: false })

    const prov = queryProvenance('Alice')
    const dtoStr = JSON.stringify(prov).toLowerCase()
    // No excluded label OR label-derived node id (meeting:secretmeeting) anywhere.
    expect(dtoStr).not.toContain('secretmeeting')
    // The center is still present (Alice is eligible via legacy/shared edges).
    expect(prov.node?.label).toBe('Alice')
    // Reachable-only-via-excluded node is absent even though it is globally
    // visible (it has a legacy edge to Faraway).
    expect(prov.meetings.map((m) => m.label)).not.toContain('SecretMeeting')
  })

  it('an excluded-only center yields empty provenance', () => {
    deleteRecordingCascade('recA', { hard: false }) // Roadmap reachable only via eA
    const prov = queryProvenance('Roadmap')
    expect(prov.node).toBeNull()
    expect(prov.pathIds).toEqual([])
    expect(prov.narrative).toBe('')
  })
})

// ---------------------------------------------------------------------------
// RE4-2 (round-4) — centered views prune/empty an excluded-only or fail-closed
// center (never expose its label/metadata).
// ---------------------------------------------------------------------------

describe('RE4-2 — centered views empty an excluded-only / fail-closed center', () => {
  it('queryNeighborhood on an excluded-only center returns an EMPTY DTO', () => {
    deleteRecordingCascade('recA', { hard: false }) // Roadmap becomes excluded-only
    expect(queryNeighborhood('Roadmap')).toEqual({ center: null, nodes: [], edges: [] })
  })

  it('queryLens on an excluded-only center returns an EMPTY DTO', () => {
    deleteRecordingCascade('recA', { hard: false })
    expect(queryLens('Roadmap', { hops: 1 })).toEqual({
      center: null,
      nodes: [],
      edges: [],
      referenceMs: null,
      strata: []
    })
  })

  it('a still-eligible center is NOT emptied', () => {
    deleteRecordingCascade('recA', { hard: false })
    const data = queryNeighborhood('Alice')
    expect(data.center).not.toBeNull()
    expect(data.nodes.map((n) => n.label)).toContain('Alice')
  })

  it('fail-closed lookup failure empties a centered view (queryNeighborhood + queryLens)', () => {
    dbRun('DROP TABLE recordings') // forces getExcludedRecordingIds to throw
    expect(queryNeighborhood('Alice')).toEqual({ center: null, nodes: [], edges: [] })
    expect(queryLens('Alice', { hops: 1 })).toEqual({
      center: null,
      nodes: [],
      edges: [],
      referenceMs: null,
      strata: []
    })
  })
})

// ---------------------------------------------------------------------------
// INC1/INC2 (round-5) — eligibility decided at the CONTRIBUTING EDGE, not the
// resulting node's global visibility.
// ---------------------------------------------------------------------------

describe('INC1/INC2 — edge-provenance for rankings + profile relationships', () => {
  // Pat attends MeetingT (about TopicT) via recX, AND MeetingU (about TopicU)
  // via recQ. Excluding recX must remove Pat from the TopicT ranking (their
  // whole path to TopicT is excluded) even though Pat is globally visible via
  // the TopicU path.
  function seedPat(): void {
    seedRecording('recX')
    seedRecording('recQ')
    seedNode('nPat', 'person', 'Pat')
    seedNode('nMT', 'meeting', 'MeetingT')
    seedNode('nTopicT', 'topic', 'TopicT')
    seedNode('nMU', 'meeting', 'MeetingU')
    seedNode('nTopicU', 'topic', 'TopicU')
    seedEdge('ePT', 'nPat', 'nMT', 'ATTENDED')
    seedEdgeSource('ePT', 'recX', 'txX')
    seedEdge('eTA', 'nMT', 'nTopicT', 'ABOUT')
    seedEdgeSource('eTA', 'recX', 'txX')
    seedEdge('ePU', 'nPat', 'nMU', 'ATTENDED')
    seedEdgeSource('ePU', 'recQ', 'txQ')
    seedEdge('eUA', 'nMU', 'nTopicU', 'ABOUT')
    seedEdgeSource('eUA', 'recQ', 'txQ')
  }

  it('INC1 — queryTopAttendees drops a person whose path to the topic is entirely excluded (kept for others)', () => {
    seedPat()
    // Control: Pat ranks for both topics.
    expect(queryTopAttendees('TopicT').map((a) => a.person)).toContain('Pat')
    expect(queryTopAttendees('TopicU').map((a) => a.person)).toContain('Pat')

    deleteRecordingCascade('recX', { hard: false })
    // Pat's TopicT path (ePT + eTA) is entirely excluded → gone from TopicT…
    expect(queryTopAttendees('TopicT')).toEqual([])
    // …but still ranked for TopicU (recQ eligible) even though Pat is the SAME
    // globally-visible node.
    expect(queryTopAttendees('TopicU').map((a) => a.person)).toContain('Pat')
  })

  it('INC1 — queryTopSkill sums only surviving demonstration edges', () => {
    seedRecording('recX')
    seedRecording('recQ')
    seedNode('nDev', 'person', 'Dev')
    seedNode('nGo', 'skill', 'Golang')
    // A DISTINCT, non-substring skill so the '%golang%' LIKE match can't pick it
    // up; it keeps Dev globally visible via an eligible demonstration edge.
    seedNode('nRust', 'skill', 'Rust')
    seedEdge('eDG', 'nDev', 'nGo', 'DEMONSTRATED')
    seedEdgeSource('eDG', 'recX', 'txX')
    seedEdge('eDR', 'nDev', 'nRust', 'DEMONSTRATED')
    seedEdgeSource('eDR', 'recQ', 'txQ')

    deleteRecordingCascade('recX', { hard: false })
    // The Golang demonstration (recX) is suppressed → Dev absent for 'Golang'…
    expect(queryTopSkill('Golang')).toEqual([])
    // …but still ranked for the eligible Rust demonstration.
    expect(queryTopSkill('Rust').map((s) => s.person)).toContain('Dev')
  })

  it('INC2 — queryPersonProfile filters a relationship by its CONNECTING edge, not the node global visibility', () => {
    seedPat()
    // A SharedMtg connected to Pat ONLY via an excluded ATTENDED edge, but
    // globally visible through a bystander's legacy edge.
    seedNode('nSharedMtg', 'meeting', 'SharedMtg')
    seedEdge('ePShared', 'nPat', 'nSharedMtg', 'ATTENDED')
    seedEdgeSource('ePShared', 'recX', 'txX')
    seedNode('nBystander', 'person', 'Bystander')
    seedEdge('eBystand', 'nBystander', 'nSharedMtg', 'ATTENDED') // legacy, no provenance

    deleteRecordingCascade('recX', { hard: false })
    const profile = queryPersonProfile('Pat')
    expect(profile).toBeTruthy()
    const meetingLabels = profile!.meetings.map((m) => m.label)
    // MeetingU (recQ) survives; MeetingT (recX) and SharedMtg (connecting edge
    // recX, though globally visible) are gone.
    expect(meetingLabels).toContain('MeetingU')
    expect(meetingLabels).not.toContain('MeetingT')
    expect(meetingLabels).not.toContain('SharedMtg')
  })
})

// ---------------------------------------------------------------------------
// INC5 (round-5) — a centered lens whose ONLY eligible edge is dropped by the
// windowDays budget while an excluded edge remains must EMPTY (the center is
// pruned post-filter; the DTO must not point center at a missing node).
// ---------------------------------------------------------------------------

describe('INC5 — lens center decided from the post-filter survivor graph', () => {
  function seedDatedNode(id: string, type: string, label: string, dateIso: string): void {
    dbRun(
      'INSERT OR IGNORE INTO graph_nodes (id, type, label, norm_key, props, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, type, label, `${type}:${label.toLowerCase()}`, JSON.stringify({ date: dateIso }), dateIso, dateIso]
    )
  }

  it('empties when the eligible edge is windowed out and only an excluded edge remains', () => {
    seedRecording('recX')
    seedRecording('recQ')
    seedNode('nCara', 'person', 'Cara')
    seedDatedNode('nMold', 'meeting', 'OldMtg', '2020-01-01T00:00:00Z') // dropped by windowDays
    seedDatedNode('nMrecent', 'meeting', 'RecentMtg', '2026-07-01T00:00:00Z') // kept
    // Cara's ELIGIBLE edge → the OLD meeting (windowed out); EXCLUDED edge → the
    // RECENT meeting (kept). Pre-check passes (Cara has an eligible edge), but
    // post-filter the eligible neighbor is gone and the excluded edge is pruned.
    seedEdge('eCold', 'nCara', 'nMold', 'ATTENDED')
    seedEdgeSource('eCold', 'recQ', 'txQ')
    seedEdge('eCrecent', 'nCara', 'nMrecent', 'ATTENDED')
    seedEdgeSource('eCrecent', 'recX', 'txX')

    deleteRecordingCascade('recX', { hard: false })
    const lens = queryLens('Cara', { hops: 1, windowDays: 30 })
    // Center pruned by suppression after windowing → EMPTY, not a blank lens
    // pointing at the missing center id.
    expect(lens.center).toBeNull()
    expect(lens.nodes).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// ADV23-2 (round-24) — pre-F18 ZERO-PROVENANCE legacy edges are suppressed from
// EVERY non-owner graph read surface (views / search / topic + attendee + skill
// + profile + meeting + list + stats), while CHAT grounding still keeps them
// (handled via the answer's `unresolved` provenance flag, not edge suppression).
// This is the fail-closed interim until the F21 provenance rebuild.
// ---------------------------------------------------------------------------

describe('ADV23-2 — zero-provenance legacy edges suppressed from non-owner surfaces', () => {
  // Zed's WHOLE neighborhood is pre-F18 zero-provenance (no graph_edge_sources).
  function seedLegacyZed(): void {
    seedNode('nZed', 'person', 'Zed')
    seedNode('nLegacyMtg', 'meeting', 'LegacyMtg')
    seedNode('nLegacyTopic', 'topic', 'LegacyTopic')
    seedNode('nLegacySkill', 'skill', 'LegacySkill')
    seedEdge('eZa', 'nZed', 'nLegacyMtg', 'ATTENDED') // no provenance rows
    seedEdge('eZb', 'nLegacyMtg', 'nLegacyTopic', 'ABOUT') // no provenance rows
    seedEdge('eZc', 'nZed', 'nLegacySkill', 'DEMONSTRATED') // no provenance rows
  }

  it('a zero-provenance-only person/meeting/skill is absent from views + search + inspector', () => {
    seedLegacyZed()
    expect(queryNeighborhood('Zed')).toEqual({ center: null, nodes: [], edges: [] })
    expect(searchGraphNodes('Zed').map((n) => n.label)).not.toContain('Zed')
    expect(searchGraphNodes('LegacyMtg').map((n) => n.label)).not.toContain('LegacyMtg')
    expect(getNodeDetail('Zed').node).toBeNull()
    // ADV34-1 (round-36): meetingGraph now returns a sanitized DTO (meeting: null when empty).
    expect(queryMeetingGraph('nLegacyMtg')).toEqual({ meeting: null, nodes: [], edges: [] })
    const listed = queryListNodes().map((n) => n.label)
    expect(listed).not.toContain('Zed')
    expect(listed).not.toContain('LegacyMtg')
    expect(listed).not.toContain('LegacySkill')
  })

  it('a zero-provenance edge is absent from topic / attendee / skill / profile aggregates', () => {
    seedLegacyZed()
    expect(queryTopAttendees('LegacyTopic').map((a) => a.person)).not.toContain('Zed')
    expect(queryTopSkill('LegacySkill').map((s) => s.person)).not.toContain('Zed')
    expect(queryPersonProfile('Zed')).toBeUndefined()
  })

  it('an edge with provenance to an ELIGIBLE recording is PRESENT; to an EXCLUDED recording is ABSENT', () => {
    // eA is attributed to recA (eligible) → Roadmap present on the view.
    expect(queryNeighborhood('Alice').nodes.map((n) => n.label)).toContain('Roadmap')
    deleteRecordingCascade('recA', { hard: false })
    // recA now excluded → its sole-sourced Roadmap edge suppressed → absent.
    expect(queryNeighborhood('Alice').nodes.map((n) => n.label)).not.toContain('Roadmap')
  })

  it('CHAT grounding STILL keeps the zero-provenance legacy fact (contrast — not edge-suppressed)', () => {
    // The chat path (neighborhoodFacts, default exclusion) does NOT suppress
    // zero-provenance edges — it grounds on them and marks the answer unresolved
    // instead (rounds 19-20). So the legacy Alice→Bob fact still grounds chat…
    expect(neighborhoodFacts('Alice')).toContain('Alice relates to Bob')
    // …while the SAME legacy edge is suppressed on the non-owner view surface.
    expect(queryNeighborhood('Alice').nodes.map((n) => n.label)).not.toContain('Bob')
  })
})
