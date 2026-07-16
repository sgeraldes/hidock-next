// @vitest-environment node

/**
 * MERGE-GATE round 34 — the SHARED choke-points the per-reader round-33 fixes missed.
 * REAL temp DB, real database.ts (better-sqlite3) end to end.
 *
 * ADV32-1 — nodeToDTO is the SHARED mapper feeding overview / neighborhood / lens /
 *   provenance / default-center DTOs. A node visible via an ELIGIBLE recording's edge
 *   but keyed to a SUPPRESSED legacy contact must NOT expose that contactId in ANY of
 *   those DTO paths (round 33 only cleared it in getNodeDetail). A VISIBLE backing
 *   contact is still exposed (no regression).
 * ADV32-2 — mergeGraphPreview must MATCH mergeGraphNodes: refuse fail-closed when a
 *   node is excluded-only / zero-provenance / has a suppressed backing contact / the
 *   visibility lookup fails (exposing NO raw labels or counts), and when both are
 *   visible compute the blast radius from SURVIVING edges only (excluded edges don't
 *   inflate the counts).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'

const dbPath = join(tmpdir(), `hidock-ctxsup-r34-${process.pid}.sqlite`)
vi.mock('../file-storage', () => ({ getDatabasePath: () => dbPath }))
vi.mock('../../services/file-storage', () => ({ getDatabasePath: () => dbPath }))
vi.mock('electron', () => ({ app: { getPath: () => tmpdir(), getVersion: () => '0.0.0' } }))
vi.mock('../config', () => ({
  getConfig: vi.fn(() => ({
    chat: { provider: 'gemini', geminiModel: 'gemini-2.0-flash', ollamaModel: '', maxContextChunks: 10 },
    transcription: { geminiApiKey: 'test-api-key', geminiModel: '' }, // pragma: allowlist secret
  })),
}))
vi.mock('@hidock/ai-providers', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@hidock/ai-providers')>()
  return { ...mod, complete: vi.fn() }
})

import { initializeDatabase, closeDatabase, run, filterVisibleEntityIds } from '../database'
import {
  getKnowledgeGraphStore,
  queryContextGraph,
  queryNeighborhood,
  queryLens,
  queryProvenance,
  pickLensCenter,
  getNodeDetail,
  mergeGraphPreview,
} from '../knowledge-graph-service'

// --- seed helpers -----------------------------------------------------------

function recording(id: string, opts: { personal?: boolean } = {}): void {
  run('INSERT OR IGNORE INTO recordings (id, filename, date_recorded, personal) VALUES (?, ?, ?, ?)', [
    id,
    `${id}.hda`,
    '2026-01-02T10:00:00Z',
    opts.personal ? 1 : 0,
  ])
}
function contact(id: string, name: string, source: string | null, opts: { recId?: string | null } = {}): void {
  run(
    `INSERT INTO contacts (id, name, email, type, role, company, first_seen_at, last_seen_at, meeting_count, created_at, source, source_recording_id)
     VALUES (?, ?, NULL, 'unknown', NULL, NULL, '2026-01-01', '2026-01-01', 0, '2026-01-01T00:00:00Z', ?, ?)`,
    [id, name, source, opts.recId ?? null]
  )
}
function attribute(edgeId: string, recId: string): void {
  run(
    'INSERT OR IGNORE INTO graph_edge_sources (edge_id, recording_id, transcript_id, assertion_count, created_at) VALUES (?, ?, ?, 1, ?)',
    [edgeId, recId, `tx-${recId}`, '2026-01-01']
  )
}

/** A person node keyed to `contactId` (optional), visible via an ATTENDED edge to a
 *  meeting attributed to the ELIGIBLE recording `recId`. Returns the node id. */
function seedPersonNode(label: string, recId: string, contactId?: string): string {
  const store = getKnowledgeGraphStore()
  const now = '2026-01-26T00:00:00.000Z'
  const person = store.upsertNode(
    contactId
      ? { type: 'person', label, key: `contact:${contactId}`, props: { contactId }, now }
      : { type: 'person', label, now }
  )
  const m = store.upsertNode({ type: 'meeting', label: `M-${label}`, props: { meetingId: `mtg-${label}`, date: '2026-01-10' }, now })
  const e = store.upsertEdge({ sourceId: person, targetId: m, type: 'ATTENDED', now })
  attribute(e, recId)
  return person
}

beforeEach(async () => {
  vi.clearAllMocks()
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
  await initializeDatabase()
})
afterEach(() => {
  closeDatabase()
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
})

// ---------------------------------------------------------------------------
// ADV32-1 — the SHARED nodeToDTO sanitizes contactId across ALL DTO readers
// ---------------------------------------------------------------------------

describe('ADV32-1 — nodeToDTO omits a suppressed backing contactId in every DTO path', () => {
  beforeEach(() => {
    recording('r-old', { personal: true }) // EXCLUDED (source of the suppressed contact)
    recording('r-elig') // ELIGIBLE
    contact('c-sup', 'Dana Prince', 'transcript', { recId: 'r-old' }) // legacy SUPPRESSED
  })

  it('the backing contact is genuinely suppressed', () => {
    expect(filterVisibleEntityIds('contact', ['c-sup']).visible.has('c-sup')).toBe(false)
  })

  it('a VISIBLE node keyed to a SUPPRESSED contact ⇒ contactId omitted in overview / neighborhood / lens / provenance / default-center', () => {
    const person = seedPersonNode('Dana Prince', 'r-elig', 'c-sup')

    // overview
    const overview = queryContextGraph()
    const oNode = overview.nodes.find((n) => n.id === person)
    expect(oNode).toBeDefined()
    expect(oNode!.contactId).toBeUndefined()

    // neighborhood
    const neigh = queryNeighborhood(person)
    expect(neigh.nodes.find((n) => n.id === person)?.contactId).toBeUndefined()

    // lens
    const lens = queryLens(person)
    expect(lens.nodes.find((n) => n.id === person)?.contactId).toBeUndefined()

    // provenance (center node)
    const prov = queryProvenance(person)
    expect(prov.node?.id).toBe(person)
    expect(prov.node?.contactId).toBeUndefined()

    // default-center (only person in the graph ⇒ picked as the ego)
    const center = pickLensCenter()
    expect(center?.id).toBe(person)
    expect(center?.contactId).toBeUndefined()

    // getNodeDetail (round-33 path) still clears it — no conflict.
    expect(getNodeDetail(person).contactId).toBeNull()
  })

  it('a VISIBLE node keyed to a VISIBLE contact still exposes contactId (no regression)', () => {
    contact('c-live', 'Yaraví', 'user') // structural source ⇒ visible
    const person = seedPersonNode('Yaraví', 'r-elig', 'c-live')

    expect(queryContextGraph().nodes.find((n) => n.id === person)?.contactId).toBe('c-live')
    expect(queryNeighborhood(person).nodes.find((n) => n.id === person)?.contactId).toBe('c-live')
    expect(queryLens(person).nodes.find((n) => n.id === person)?.contactId).toBe('c-live')
    expect(queryProvenance(person).node?.contactId).toBe('c-live')
    expect(pickLensCenter()?.contactId).toBe('c-live')
    expect(getNodeDetail(person).contactId).toBe('c-live')
  })
})

// ---------------------------------------------------------------------------
// ADV32-2 — mergeGraphPreview refuses + filters (matches the commit)
// ---------------------------------------------------------------------------

describe('ADV32-2 — mergeGraphPreview exposes no raw labels/counts for a blocked merge', () => {
  function expectBlocked(preview: ReturnType<typeof mergeGraphPreview>): void {
    expect(preview.blocked).toBe(true)
    expect(preview.a).toBeNull()
    expect(preview.b).toBeNull()
    expect(preview.shared).toBe(0)
    expect(preview.resulting).toBe(0)
    expect(preview.contactMerge).toBe(false)
    expect(preview.contactImpact).toBeUndefined()
  }

  it('SUPPRESSED backing contact ⇒ blocked', () => {
    recording('r-old', { personal: true })
    recording('r-elig')
    contact('c-klive', 'Keeper', 'user')
    contact('c-lsup', 'Loser', 'transcript', { recId: 'r-old' })
    const keeper = seedPersonNode('Keeper', 'r-elig', 'c-klive')
    const loser = seedPersonNode('Loser', 'r-elig', 'c-lsup')
    expectBlocked(mergeGraphPreview(keeper, loser))
  })

  it('EXCLUDED-only node (all edges attributed to an excluded recording) ⇒ blocked', () => {
    recording('r-elig')
    recording('r-excl', { personal: true })
    const keeper = seedPersonNode('Keeper', 'r-elig')
    const loser = seedPersonNode('Loser', 'r-excl') // only edge is excluded ⇒ not node-visible
    expectBlocked(mergeGraphPreview(keeper, loser))
  })

  it('ZERO-provenance node (unattributed edge) ⇒ blocked', () => {
    const store = getKnowledgeGraphStore()
    const now = '2026-01-26T00:00:00.000Z'
    recording('r-elig')
    const keeper = seedPersonNode('Keeper', 'r-elig')
    // Loser with an UNATTRIBUTED edge only ⇒ legacy zero-provenance ⇒ excluded-only.
    const loser = store.upsertNode({ type: 'person', label: 'Loser', now })
    const m = store.upsertNode({ type: 'meeting', label: 'M-Loser', props: { meetingId: 'mL', date: '2026-01-10' }, now })
    store.upsertEdge({ sourceId: loser, targetId: m, type: 'ATTENDED', now })
    expectBlocked(mergeGraphPreview(keeper, loser))
  })

  it('visibility-lookup FAILURE ⇒ fail-closed blocked', () => {
    recording('r-elig')
    contact('c-klive', 'Keeper', 'user')
    contact('c-llive', 'Loser', 'user')
    const keeper = seedPersonNode('Keeper', 'r-elig', 'c-klive')
    const loser = seedPersonNode('Loser', 'r-elig', 'c-llive')
    run('DROP TABLE contacts') // force filterVisibleEntityIds to fail closed
    expectBlocked(mergeGraphPreview(keeper, loser))
  })

  it('MIXED-provenance node ⇒ visible, but the blast radius counts SURVIVING edges only', () => {
    const store = getKnowledgeGraphStore()
    const now = '2026-01-26T00:00:00.000Z'
    recording('r-elig')
    recording('r-excl', { personal: true })
    const keeper = seedPersonNode('Keeper', 'r-elig')
    // Loser: one ELIGIBLE ATTENDED edge + one EXCLUDED ATTENDED edge.
    const loser = store.upsertNode({ type: 'person', label: 'Loser', now })
    const mE = store.upsertNode({ type: 'meeting', label: 'Elig M', props: { meetingId: 'mE', date: '2026-01-10' }, now })
    attribute(store.upsertEdge({ sourceId: loser, targetId: mE, type: 'ATTENDED', now }), 'r-elig')
    const mX = store.upsertNode({ type: 'meeting', label: 'Excl M', props: { meetingId: 'mX', date: '2026-02-20' }, now })
    attribute(store.upsertEdge({ sourceId: loser, targetId: mX, type: 'ATTENDED', now }), 'r-excl')

    const preview = mergeGraphPreview(keeper, loser)
    expect(preview.blocked).toBeFalsy()
    // Only the ELIGIBLE edge survives ⇒ 1, not 2.
    expect(preview.b?.edges).toBe(1)
    expect(preview.contactMerge).toBe(false)
  })

  it('BOTH visible + eligible ⇒ a real (unblocked) preview', () => {
    recording('r-elig')
    const keeper = seedPersonNode('Keeper', 'r-elig')
    const loser = seedPersonNode('Loser', 'r-elig')
    const preview = mergeGraphPreview(keeper, loser)
    expect(preview.blocked).toBeFalsy()
    expect(preview.a?.id).toBe(keeper)
    expect(preview.b?.id).toBe(loser)
    expect(preview.b?.edges).toBe(1)
  })
})
