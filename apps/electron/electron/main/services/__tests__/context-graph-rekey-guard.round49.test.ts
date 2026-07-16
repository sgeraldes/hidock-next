// @vitest-environment node

/**
 * MERGE-GATE round 49 — ADV47-1: the AUTOMATIC maintenance rekey
 * (rekeyExistingPersonNodes, runs after every transcript ingestion) is a MUTATION
 * — it merges a name-keyed person node into a contact-keyed keeper (repointing /
 * deleting edges) or rewrites its identity. Round 35 mis-classified it
 * owner-cleanup-safe, so it ran WITHOUT the execution-time node-visibility guard
 * the interactive mutations use. A name-keyed node whose only provenance is now
 * personal / deleted / value-excluded / hard-purged would therefore be folded /
 * rewritten, laundering excluded-derived identity: restoring the recording later
 * would resurface its facts under a CHANGED / accent-mismatched identity.
 *
 * This suite (REAL temp DB, real database.ts end-to-end) proves the round-49 fix:
 *   • an excluded-only name-keyed node colliding with a visible exact-name keeper
 *     AND an accent-matched contact ⇒ rekey SKIPS it (no node/edge/props/
 *     provenance mutation);
 *   • a visibility-lookup failure ⇒ fail-closed skip (no mutation);
 *   • a genuinely visible/eligible node still rekeys / merges normally.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'

const dbPath = join(tmpdir(), `hidock-ctxrekey-r49-${process.pid}.sqlite`)
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

import { initializeDatabase, closeDatabase, run, queryOne, queryAll } from '../database'
import { getKnowledgeGraphStore, rekeyExistingPersonNodes } from '../knowledge-graph-service'

// --- seed helpers -----------------------------------------------------------

function recording(id: string): void {
  run('INSERT OR IGNORE INTO recordings (id, filename, date_recorded, personal) VALUES (?, ?, ?, 0)', [
    id,
    `${id}.hda`,
    '2026-01-02T10:00:00Z',
  ])
}

/** A visible (source='user') contact. */
function contactUser(id: string, name: string): void {
  run(
    `INSERT INTO contacts (id, name, email, type, role, company, first_seen_at, last_seen_at, meeting_count, created_at, source, source_recording_id)
     VALUES (?, ?, NULL, 'unknown', NULL, NULL, '2026-01-01', '2026-01-01', 0, '2026-01-01T00:00:00Z', 'user', NULL)`,
    [id, name]
  )
}

function attribute(edgeId: string, recId: string): void {
  run(
    'INSERT OR IGNORE INTO graph_edge_sources (edge_id, recording_id, transcript_id, assertion_count, created_at) VALUES (?, ?, ?, 1, ?)',
    [edgeId, recId, `tx-${recId}`, '2026-01-01']
  )
}

/**
 * A person node visible via an ATTENDED edge to a per-recording meeting attributed
 * to `recId`. Name-keyed when `contactId` is omitted (norm_key = normalized label),
 * contact-keyed (`contact:<id>`) otherwise. Returns the node id.
 */
function seedPersonNode(label: string, recId: string, contactId?: string): string {
  const store = getKnowledgeGraphStore()
  const now = '2026-01-26T00:00:00.000Z'
  const person = store.upsertNode(
    contactId
      ? { type: 'person', label, key: `contact:${contactId}`, props: { contactId }, now }
      : { type: 'person', label, now }
  )
  const m = store.upsertNode({
    type: 'meeting',
    label: `M-${recId}`,
    props: { meetingId: `mtg-${recId}`, date: '2026-01-10' },
    now,
  })
  const e = store.upsertEdge({ sourceId: person, targetId: m, type: 'ATTENDED', now })
  attribute(e, recId)
  return person
}

/** Flip recording `recId` into an EXCLUDED state AFTER the node was ingested. */
function exclude(recId: string, how: 'personal' | 'deleted' | 'value' | 'purge'): void {
  switch (how) {
    case 'personal':
      run('UPDATE recordings SET personal = 1 WHERE id = ?', [recId])
      break
    case 'deleted':
      run('UPDATE recordings SET deleted_at = ? WHERE id = ?', ['2026-03-01T00:00:00Z', recId])
      break
    case 'value':
      run(
        `INSERT INTO knowledge_captures (id, title, quality_rating, source_recording_id, captured_at)
         VALUES (?, ?, 'garbage', ?, '2026-01-05T00:00:00Z')`,
        [`kc-${recId}`, `cap-${recId}`, recId]
      )
      break
    case 'purge':
      run('DELETE FROM recordings WHERE id = ?', [recId])
      break
  }
}

interface Snap {
  nodes: Array<{ id: string; type: string; label: string; norm_key: string; props: string | null }>
  edges: Array<{ id: string; source_id: string; target_id: string; type: string }>
  sources: Array<{ edge_id: string; recording_id: string }>
}
function snapshot(): Snap {
  return {
    nodes: queryAll('SELECT id, type, label, norm_key, props FROM graph_nodes ORDER BY id'),
    edges: queryAll('SELECT id, source_id, target_id, type FROM graph_edges ORDER BY id'),
    sources: queryAll('SELECT edge_id, recording_id FROM graph_edge_sources ORDER BY edge_id, recording_id'),
  }
}

const AFTER_INGEST: Array<'personal' | 'deleted' | 'value' | 'purge'> = ['personal', 'deleted', 'value', 'purge']

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
// Excluded-only source ⇒ SKIP (no merge, no rewrite, no edge/provenance change)
// ---------------------------------------------------------------------------

describe('ADV47-1 — automatic rekey SKIPS a name-keyed node whose only provenance is excluded', () => {
  for (const how of AFTER_INGEST) {
    it(`source ${how} + colliding visible exact-name keeper AND accent-matched contact ⇒ NO mutation`, () => {
      recording('r-keep')
      recording('r-src')
      contactUser('c-mario', 'Mario') // visible exact-name contact (the keeper's identity)
      contactUser('c-mario-accent', 'Marío') // an accent-matched colliding identity
      // Visible contact-keyed keeper the excluded source would otherwise fold into.
      const keeper = seedPersonNode('Mario', 'r-keep', 'c-mario')
      // The name-keyed ('mario') source whose only provenance is r-src.
      const src = seedPersonNode('Mario', 'r-src')

      exclude('r-src', how) // source becomes excluded-only AFTER ingest

      const before = snapshot()
      const r = rekeyExistingPersonNodes()

      // The excluded source was neither merged nor rewritten.
      expect(r.merged).toBe(0)
      expect(r.rekeyed).toBe(0)
      expect(r.skipped).toBeGreaterThanOrEqual(1)

      // No node deleted, no edge repointed, no props/provenance mutation anywhere.
      expect(snapshot()).toEqual(before)
      // The source survives, still name-keyed (identity NOT laundered onto the contact).
      const srcNode = queryOne<{ norm_key: string }>('SELECT norm_key FROM graph_nodes WHERE id = ?', [src])
      expect(srcNode?.norm_key).toBe('mario')
      expect(getKnowledgeGraphStore().getNode(keeper)).toBeDefined()
    })
  }
})

// ---------------------------------------------------------------------------
// Visibility-lookup failure ⇒ fail-closed SKIP
// ---------------------------------------------------------------------------

describe('ADV47-1 — a visibility-lookup failure fails CLOSED (no mutation)', () => {
  it('exclusion snapshot cannot be built (required table dropped) ⇒ every node skipped', () => {
    recording('r-live')
    contactUser('c-zoe', 'Zoe')
    const src = seedPersonNode('Zoe', 'r-live') // eligible — WOULD rekey if not fail-closed

    const nodesBefore = queryAll('SELECT id, norm_key, label, props FROM graph_nodes ORDER BY id')
    const edgesBefore = queryAll('SELECT id, source_id, target_id, type FROM graph_edges ORDER BY id')

    // Break the table getGroundingExclusionSet needs ⇒ it fails closed.
    run('DROP TABLE graph_edge_sources')

    const r = rekeyExistingPersonNodes()
    expect(r.rekeyed).toBe(0)
    expect(r.merged).toBe(0)

    // Nothing rewritten — the source is still name-keyed.
    const srcNode = queryOne<{ norm_key: string }>('SELECT norm_key FROM graph_nodes WHERE id = ?', [src])
    expect(srcNode?.norm_key).toBe('zoe')
    expect(queryAll('SELECT id, norm_key, label, props FROM graph_nodes ORDER BY id')).toEqual(nodesBefore)
    expect(queryAll('SELECT id, source_id, target_id, type FROM graph_edges ORDER BY id')).toEqual(edgesBefore)
  })
})

// ---------------------------------------------------------------------------
// Happy path — genuinely visible/eligible nodes still rekey / merge
// ---------------------------------------------------------------------------

describe('ADV47-1 — a visible/eligible node still rekeys normally (no regression)', () => {
  it('name-keyed node with an eligible backing recording + NO keeper ⇒ rewritten in place to its contact', () => {
    recording('r-live')
    contactUser('c-zoe', 'Zoe')
    const src = seedPersonNode('Zoe', 'r-live')

    const r = rekeyExistingPersonNodes()
    expect(r.rekeyed).toBe(1)
    expect(r.merged).toBe(0)

    const node = queryOne<{ norm_key: string; props: string | null }>(
      'SELECT norm_key, props FROM graph_nodes WHERE id = ?',
      [src]
    )
    expect(node?.norm_key).toBe('contact:c-zoe')
    expect(JSON.parse(node?.props ?? '{}').contactId).toBe('c-zoe')
  })

  it('name-keyed eligible node + a VISIBLE contact-keyed keeper ⇒ folded into the keeper', () => {
    recording('r-keep')
    recording('r-src')
    contactUser('c-ana', 'Ana')
    const keeper = seedPersonNode('Ana', 'r-keep', 'c-ana') // visible keeper
    const src = seedPersonNode('Ana', 'r-src') // name-keyed, eligible

    const r = rekeyExistingPersonNodes()
    expect(r.merged).toBe(1)

    const store = getKnowledgeGraphStore()
    expect(store.getNode(src)).toBeUndefined() // folded away
    expect(store.getNode(keeper)).toBeDefined()
  })
})
