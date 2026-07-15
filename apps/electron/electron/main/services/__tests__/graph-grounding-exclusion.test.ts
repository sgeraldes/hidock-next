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
    expect(getExcludedRecordingIds().has('recA')).toBe(true)

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
    expect(getExcludedRecordingIds().has('recA')).toBe(false)
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
    expect(getExcludedRecordingIds().has('recA')).toBe(true)
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

  it('queryNeighborhood(Alice): baseline shows all neighbors', () => {
    const data = queryNeighborhood('Alice')
    expect(labelsOf(data)).toEqual(expect.arrayContaining(['Alice', 'Roadmap', 'Backlog', 'Bob']))
  })

  it('soft-delete recA drops the sole-sourced edge AND prunes its orphaned node', () => {
    deleteRecordingCascade('recA', { hard: false })
    const data = queryNeighborhood('Alice')
    // Roadmap was reachable ONLY via eA (recA) → edge suppressed, node pruned.
    expect(labelsOf(data)).not.toContain('Roadmap')
    // Backlog (shared, recB eligible) and Bob (legacy) stay.
    expect(labelsOf(data)).toEqual(expect.arrayContaining(['Alice', 'Backlog', 'Bob']))
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
    // Legacy Bob still there.
    expect(labelsOf(queryNeighborhood('Alice'))).toContain('Bob')
  })

  it('queryContextGraph (full view) suppresses excluded attributed edges', () => {
    deleteRecordingCascade('recA', { hard: false })
    const data = queryContextGraph(100)
    // The Alice→Roadmap edge is gone from the whole-graph view.
    const byId = new Map(data.nodes.map((n) => [n.id, n.label]))
    const edgeLabels = data.edges.map((e) => `${byId.get(e.source)}→${byId.get(e.target)}`)
    expect(edgeLabels).not.toContain('Alice→Roadmap')
    // Legacy edge survives.
    expect(edgeLabels).toContain('Alice→Bob')
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

  it('the Context Graph view also fails closed (attributed edges hidden, legacy kept)', () => {
    dbRun('DROP TABLE recordings')
    const data = queryNeighborhood('Alice')
    const byId = new Map(data.nodes.map((n) => [n.id, n.label]))
    const edgeLabels = data.edges.map((e) => `${byId.get(e.source)}→${byId.get(e.target)}`)
    expect(edgeLabels).not.toContain('Alice→Roadmap')
    expect(edgeLabels).not.toContain('Alice→Backlog')
    expect(edgeLabels).toContain('Alice→Bob')
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
    // Bob (legacy) and Backlog (shared, recB eligible) remain findable.
    expect(searchGraphNodes('Bob').map((n) => n.label)).toContain('Bob')
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
    // Build an EXCLUDED hub H (degree 5, all edges sourced by recX) plus three
    // eligible legacy nodes E1..E3 connected to a shared anchor.
    seedRecording('recX')
    seedNode('nHub', 'topic', 'Hub')
    seedNode('nAnchor', 'topic', 'Anchor')
    for (const [i, leaf] of ['L1', 'L2', 'L3', 'L4', 'L5'].entries()) {
      seedNode(`n${leaf}`, 'topic', leaf)
      seedEdge(`eHub${i}`, 'nHub', `n${leaf}`, 'RELATES_TO')
      seedEdgeSource(`eHub${i}`, 'recX', 'txX') // all Hub edges attributed to recX
    }
    seedNode('nE1', 'topic', 'E1')
    seedNode('nE2', 'topic', 'E2')
    seedEdge('eE1', 'nAnchor', 'nE1', 'RELATES_TO') // legacy (no provenance)
    seedEdge('eE2', 'nAnchor', 'nE2', 'RELATES_TO') // legacy

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
