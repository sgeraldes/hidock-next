// @vitest-environment node

/**
 * MERGE-GATE round 33 — the graph-inspector corner the round-32 gating missed.
 * REAL temp DB, real database.ts (better-sqlite3) end to end.
 *
 * ADV31-1 — convertNodeToContact: a VISIBLE node already KEYED to a legacy
 *   SUPPRESSED contact must NOT hit the reuse-existing-binding branch and return the
 *   suppressed id — it detaches the suppressed binding and creates/binds a FRESH
 *   VISIBLE contact.
 * ADV31-2 — mergeGraphNodes: when EITHER contact-backed node has a suppressed
 *   backing contact the ENTIRE merge is REFUSED fail-closed (no node/edge change) —
 *   round-32 only skipped mergeContacts but still folded the graph nodes.
 * ADV31-3 — getNodeDetail statistics (meeting/person/project counts, degree,
 *   first/last-seen) and the provenance narrative derive from an EXCLUSION-FILTERED
 *   one-hop subgraph, never the raw store.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'

const dbPath = join(tmpdir(), `hidock-ctxsup-r33-${process.pid}.sqlite`)
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

import {
  initializeDatabase,
  closeDatabase,
  run,
  queryOne,
  queryAll,
  getContactById,
  filterVisibleEntityIds,
} from '../database'
import {
  getKnowledgeGraphStore,
  getNodeDetail,
  convertNodeToContact,
  mergeGraphNodes,
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
function contact(id: string, name: string, source: string | null, opts: { recId?: string | null; company?: string | null } = {}): void {
  run(
    `INSERT INTO contacts (id, name, email, type, role, company, first_seen_at, last_seen_at, meeting_count, created_at, source, source_recording_id)
     VALUES (?, ?, NULL, 'unknown', NULL, ?, '2026-01-01', '2026-01-01', 0, '2026-01-01T00:00:00Z', ?, ?)`,
    [id, name, opts.company ?? null, source, opts.recId ?? null]
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
// ADV31-1 — convert must not return a suppressed backing contact
// ---------------------------------------------------------------------------

describe('ADV31-1 — convertNodeToContact detaches a suppressed backing contact', () => {
  beforeEach(() => {
    recording('r-old', { personal: true }) // EXCLUDED
    recording('r-elig') // ELIGIBLE
    // Legacy SUPPRESSED contact (transcript-sourced from the excluded recording).
    contact('c-sup', 'Dana Prince', 'transcript', { recId: 'r-old', company: 'GhostCorp' })
  })

  it('the backing contact is genuinely suppressed', () => {
    expect(filterVisibleEntityIds('contact', ['c-sup']).visible.has('c-sup')).toBe(false)
  })

  it('a VISIBLE node KEYED to a suppressed contact ⇒ fresh visible contact, suppressed id never returned', () => {
    // Node keyed to c-sup (contact:<id>) but visible via an ELIGIBLE recording's edge.
    const person = seedPersonNode('Dana Prince', 'r-elig', 'c-sup')

    const res = convertNodeToContact(person)

    // The suppressed id is NEVER returned or reused.
    expect(res.reusedExisting).toBe(false)
    expect(res.contactId).not.toBe('c-sup')
    // A brand-new, VISIBLE contact now backs the node.
    const fresh = getContactById(res.contactId)!
    expect(fresh.id).not.toBe('c-sup')
    expect(filterVisibleEntityIds('contact', [fresh.id]).visible.has(fresh.id)).toBe(true)
    // The node is re-keyed OFF the suppressed identity.
    const node = getKnowledgeGraphStore().getNode(res.nodeId)!
    expect(node.norm_key).toBe(`contact:${fresh.id}`)
    expect(node.norm_key).not.toBe('contact:c-sup')
    // getNodeDetail now exposes the fresh (visible) contact, not the suppressed one.
    expect(getNodeDetail(res.nodeId).contactId).toBe(fresh.id)
  })

  it('a VISIBLE node keyed to a VISIBLE contact still reuses it (no regression)', () => {
    contact('c-live', 'Yaraví', 'user')
    const person = seedPersonNode('Yaraví', 'r-elig', 'c-live')
    const res = convertNodeToContact(person)
    expect(res.reusedExisting).toBe(true)
    expect(res.contactId).toBe('c-live')
  })
})

// ---------------------------------------------------------------------------
// ADV31-2 — merge refuses when EITHER backing contact is suppressed
// ---------------------------------------------------------------------------

describe('ADV31-2 — mergeGraphNodes refuses a suppressed-contact-backed merge', () => {
  /** Snapshot the graph node ids + edge ids + edge-source rows (to assert no change). */
  function snapshot(): { nodes: string[]; edges: string[]; sources: number } {
    return {
      nodes: queryAll<{ id: string }>('SELECT id FROM graph_nodes ORDER BY id').map((r) => r.id),
      edges: queryAll<{ id: string }>('SELECT id FROM graph_edges ORDER BY id').map((r) => r.id),
      sources: (queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM graph_edge_sources')?.n) ?? 0,
    }
  }

  function seedPair(keeperContact: 'sup' | 'live', loserContact: 'sup' | 'live'): { keeper: string; loser: string } {
    recording('r-old', { personal: true })
    recording('r-elig')
    contact('c-ksup', 'Keeper Person', 'transcript', { recId: 'r-old' })
    contact('c-klive', 'Keeper Person', 'user')
    contact('c-lsup', 'Loser Person', 'transcript', { recId: 'r-old' })
    contact('c-llive', 'Loser Person', 'user')
    const keeper = seedPersonNode('Keeper Person', 'r-elig', keeperContact === 'sup' ? 'c-ksup' : 'c-klive')
    const loser = seedPersonNode('Loser Person', 'r-elig', loserContact === 'sup' ? 'c-lsup' : 'c-llive')
    return { keeper, loser }
  }

  it('visible keeper + SUPPRESSED loser ⇒ refused, no node/edge change', () => {
    const { keeper, loser } = seedPair('live', 'sup')
    const before = snapshot()
    expect(() => mergeGraphNodes(keeper, loser)).toThrow()
    expect(snapshot()).toEqual(before)
  })

  it('SUPPRESSED keeper + visible loser ⇒ refused, no node/edge change', () => {
    const { keeper, loser } = seedPair('sup', 'live')
    const before = snapshot()
    expect(() => mergeGraphNodes(keeper, loser)).toThrow()
    expect(snapshot()).toEqual(before)
  })

  it('BOTH suppressed ⇒ refused, no node/edge change', () => {
    const { keeper, loser } = seedPair('sup', 'sup')
    const before = snapshot()
    expect(() => mergeGraphNodes(keeper, loser)).toThrow()
    expect(snapshot()).toEqual(before)
  })

  it('visibility-lookup FAILURE ⇒ fail-closed refused, no node/edge change', () => {
    const { keeper, loser } = seedPair('live', 'live')
    const before = snapshot()
    // Force isContactVisible → filterVisibleEntityIds to throw (fail closed).
    run('DROP TABLE contacts')
    expect(() => mergeGraphNodes(keeper, loser)).toThrow()
    expect(snapshot()).toEqual(before)
  })

  it('BOTH visible ⇒ still merges (path=contact, loser folded)', () => {
    const { keeper, loser } = seedPair('live', 'live')
    const store = getKnowledgeGraphStore()
    // Preview agrees it is a contact merge.
    expect(mergeGraphPreview(keeper, loser).contactMerge).toBe(true)
    const res = mergeGraphNodes(keeper, loser)
    expect(res.path).toBe('contact')
    expect(store.getNode(loser)).toBeUndefined()
  })

  it('preview does NOT surface a contact merge when a backing contact is suppressed', () => {
    const { keeper, loser } = seedPair('live', 'sup')
    const preview = mergeGraphPreview(keeper, loser)
    expect(preview.contactMerge).toBe(false)
    expect(preview.contactImpact).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// ADV31-3 — inspector statistics from an EXCLUSION-FILTERED subgraph
// ---------------------------------------------------------------------------

describe('ADV31-3 — getNodeDetail stats exclude excluded neighbors', () => {
  /**
   * Center person with FOUR neighbors: an eligible meeting, an EXCLUDED meeting, an
   * eligible person, and an EXCLUDED person. Only the eligible neighbors may count.
   */
  function seedMixed(): string {
    const store = getKnowledgeGraphStore()
    const now = '2026-01-26T00:00:00.000Z'
    recording('r-elig')
    recording('r-excl', { personal: true })
    const person = store.upsertNode({ type: 'person', label: 'Center', now })

    const mE = store.upsertNode({ type: 'meeting', label: 'Elig Meeting', props: { meetingId: 'mtg-e', date: '2026-01-10' }, now })
    attribute(store.upsertEdge({ sourceId: person, targetId: mE, type: 'ATTENDED', now }), 'r-elig')
    const mX = store.upsertNode({ type: 'meeting', label: 'Excl Meeting', props: { meetingId: 'mtg-x', date: '2026-02-20' }, now })
    attribute(store.upsertEdge({ sourceId: person, targetId: mX, type: 'ATTENDED', now }), 'r-excl')

    const pE = store.upsertNode({ type: 'person', label: 'Elig Peer', now })
    attribute(store.upsertEdge({ sourceId: person, targetId: pE, type: 'MENTIONED', now }), 'r-elig')
    const pX = store.upsertNode({ type: 'person', label: 'Excl Peer', now })
    attribute(store.upsertEdge({ sourceId: person, targetId: pX, type: 'MENTIONED', now }), 'r-excl')
    return person
  }

  it('excluded neighbors change NO statistic (count / degree / firstSeen / lastSeen)', () => {
    const person = seedMixed()
    const d = getNodeDetail(person)
    // Only the ELIGIBLE meeting + ELIGIBLE peer survive.
    expect(d.meetingCount).toBe(1)
    expect(d.peopleCount).toBe(1)
    expect(d.degree).toBe(2) // two surviving incident edges (mE + pE)
    // Dates derive ONLY from the surviving eligible meeting (never the Feb excluded one).
    expect(d.firstSeenMs).toBe(Date.parse('2026-01-10'))
    expect(d.lastSeenMs).toBe(Date.parse('2026-01-10'))
    // The excluded neighbor's LABEL never leaks into the narrative.
    expect(d.narrative).not.toContain('Excl')
  })

  it('an all-eligible node reports FULL stats', () => {
    const store = getKnowledgeGraphStore()
    const now = '2026-01-26T00:00:00.000Z'
    recording('r-elig')
    const person = store.upsertNode({ type: 'person', label: 'AllElig', now })
    const m1 = store.upsertNode({ type: 'meeting', label: 'M1', props: { meetingId: 'm1', date: '2026-01-10' }, now })
    attribute(store.upsertEdge({ sourceId: person, targetId: m1, type: 'ATTENDED', now }), 'r-elig')
    const m2 = store.upsertNode({ type: 'meeting', label: 'M2', props: { meetingId: 'm2', date: '2026-01-26' }, now })
    attribute(store.upsertEdge({ sourceId: person, targetId: m2, type: 'ATTENDED', now }), 'r-elig')

    const d = getNodeDetail(person)
    expect(d.meetingCount).toBe(2)
    expect(d.degree).toBe(2)
    expect(d.firstSeenMs).toBe(Date.parse('2026-01-10'))
    expect(d.lastSeenMs).toBe(Date.parse('2026-01-26'))
  })
})
