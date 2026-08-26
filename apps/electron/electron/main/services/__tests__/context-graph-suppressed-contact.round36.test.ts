// @vitest-environment node

/**
 * MERGE-GATE round 36 — ADV34-1 + ADV34-3. REAL temp DB, real database.ts end to end.
 *
 * ADV34-1 — queryMeetingGraph returned RAW GraphNode objects (norm_key `contact:<id>`
 *   + props.contactId) after only an edge-visibility filter, so a node visible via an
 *   eligible meeting edge but keyed to a SUPPRESSED backing contact leaked that
 *   contact's id on the graph:meetingGraph IPC surface. FIX: map every surviving node
 *   (and the meeting node) through the shared contact-visibility-aware nodeToDTO.
 *
 * ADV34-3 — the round-35 execution-time mutation guard validated only the EXPLICIT
 *   target. renameNode (same-key collision) and bindNodeToContact (existing
 *   contact-keyed node) SILENTLY MERGE the target into an IMPLICIT keeper, folding the
 *   visible source's edges into it and deleting the source. If that keeper is
 *   excluded-only, the op laundered excluded state / repointed edges into a hidden
 *   node. FIX: resolve the implicit keeper BEFORE any write and require it to pass
 *   merge-eligibility under ONE exclusion snapshot; refuse fail-closed otherwise.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'

const dbPath = join(tmpdir(), `hidock-ctxsupp-r36-${process.pid}.sqlite`)
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
import {
  getKnowledgeGraphStore,
  queryMeetingGraph,
  renameGraphEntity,
  linkNodeToContact,
} from '../knowledge-graph-service'

const NOW = '2026-01-26T00:00:00.000Z'

// --- seed helpers -----------------------------------------------------------

function recording(id: string, opts: { personal?: boolean; deleted?: boolean } = {}): void {
  run(
    'INSERT OR IGNORE INTO recordings (id, filename, date_recorded, personal, deleted_at) VALUES (?, ?, ?, ?, ?)',
    [id, `${id}.hda`, '2026-01-02T10:00:00Z', opts.personal ? 1 : 0, opts.deleted ? '2026-03-01T00:00:00Z' : null]
  )
}

/** A transcript-origin contact whose ONLY provenance is `recId`. When that recording
 *  is excluded (and the contact has no eligible membership), filterVisibleEntityIds
 *  suppresses it — the ADV34-1/ADV34-3 "suppressed backing contact" case. */
function transcriptContact(id: string, name: string, recId: string): void {
  run(
    `INSERT INTO contacts (id, name, email, type, role, company, first_seen_at, last_seen_at, meeting_count, created_at, source, source_recording_id)
     VALUES (?, ?, NULL, 'external', NULL, NULL, '2026-01-01', '2026-01-01', 0, '2026-01-01T00:00:00Z', 'transcript', ?)`,
    [id, name, recId]
  )
}

/** A structural (source='user') contact — always visible. */
function userContact(id: string, name: string): void {
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

/** A person node visible via an ATTENDED edge to a meeting attributed to `recId`. */
function personVia(label: string, recId: string, opts: { contactId?: string; meetingId?: string } = {}): string {
  const store = getKnowledgeGraphStore()
  const person = store.upsertNode(
    opts.contactId
      ? { type: 'person', label, key: `contact:${opts.contactId}`, props: { contactId: opts.contactId }, now: NOW }
      : { type: 'person', label, now: NOW }
  )
  const m = store.upsertNode({
    type: 'meeting',
    label: `M-${label}`,
    props: { meetingId: opts.meetingId ?? `mtg-${label}`, date: '2026-01-10' },
    now: NOW,
  })
  const e = store.upsertEdge({ sourceId: person, targetId: m, type: 'ATTENDED', now: NOW })
  attribute(e, recId)
  return person
}

interface Snap { nodes: string[]; keys: string[]; edges: string[]; contacts: number; aliases: number }
function snapshot(): Snap {
  return {
    nodes: queryAll<{ id: string }>('SELECT id FROM graph_nodes ORDER BY id').map((r) => r.id),
    keys: queryAll<{ norm_key: string }>('SELECT norm_key FROM graph_nodes ORDER BY norm_key').map((r) => r.norm_key),
    edges: queryAll<{ id: string }>('SELECT id FROM graph_edges ORDER BY id').map((r) => r.id),
    contacts: queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM contacts')?.n ?? 0,
    aliases: queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM contact_aliases')?.n ?? 0,
  }
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
// ADV34-1 — queryMeetingGraph never leaks a suppressed backing contactId/norm_key
// ---------------------------------------------------------------------------

describe('ADV34-1 — queryMeetingGraph routes nodes through the sanitizing DTO boundary', () => {
  it('a meeting-visible node keyed to a SUPPRESSED contact exposes no contactId / norm_key / props', () => {
    recording('r-good')
    recording('r-bad', { deleted: true })
    // Contact backed ONLY by the excluded recording ⇒ suppressed on non-owner surfaces.
    transcriptContact('c-supp', 'Suppressed Person', 'r-bad')
    // Person node keyed to that suppressed contact, but VISIBLE via an eligible meeting edge.
    personVia('Suppressed Person', 'r-good', { contactId: 'c-supp', meetingId: 'mtg-1' })

    const dto = queryMeetingGraph('mtg-1')
    // Meeting survived (its ATTENDED edge is eligible).
    expect(dto.meeting).not.toBeNull()
    // The person node is present but sanitized: no contactId, and the DTO shape carries
    // NO norm_key / props at all (a raw GraphNode would).
    const person = dto.nodes.find((n) => n.type === 'person')
    expect(person).toBeDefined()
    expect(person!.contactId).toBeUndefined()
    for (const n of [dto.meeting!, ...dto.nodes]) {
      expect(n).not.toHaveProperty('norm_key')
      expect(n).not.toHaveProperty('props')
    }
    // Belt-and-braces: the suppressed id must not appear anywhere in the serialized DTO.
    expect(JSON.stringify(dto)).not.toContain('c-supp')
  })

  it('a node keyed to a VISIBLE contact still exposes its contactId (no regression)', () => {
    recording('r-good')
    userContact('c-live', 'Live Person') // structural ⇒ visible
    personVia('Live Person', 'r-good', { contactId: 'c-live', meetingId: 'mtg-2' })

    const dto = queryMeetingGraph('mtg-2')
    const person = dto.nodes.find((n) => n.type === 'person')
    expect(person).toBeDefined()
    expect(person!.contactId).toBe('c-live')
  })
})

// ---------------------------------------------------------------------------
// ADV34-3 — rename collision keeper guard
// ---------------------------------------------------------------------------

describe('ADV34-3 — renameGraphEntity refuses an implicit same-key collision keeper that is excluded-only', () => {
  it('rename a VISIBLE source into an EXCLUDED-ONLY keeper ⇒ refused, byte-identical state', () => {
    recording('r-good')
    recording('r-bad', { deleted: true })
    const source = personVia('Alpha', 'r-good', { meetingId: 'mtg-a' })
    // Collision keeper: a name-only person keyed 'beta', visible ONLY via an excluded edge.
    const keeper = personVia('Beta', 'r-bad', { meetingId: 'mtg-b' })

    const before = snapshot()
    const res = renameGraphEntity(source, 'Beta') // newKey 'beta' collides with the hidden keeper
    expect(res.outcome).toBe('noop')
    expect(snapshot()).toEqual(before)
    // Source untouched (not merged/deleted); keeper untouched.
    expect(getKnowledgeGraphStore().getNode(source)).toBeDefined()
    expect(getKnowledgeGraphStore().getNode(keeper)).toBeDefined()
    expect(queryOne<{ label: string }>('SELECT label FROM graph_nodes WHERE id = ?', [source])?.label).toBe('Alpha')
  })

  it('rename a VISIBLE source into a VISIBLE keeper ⇒ merge proceeds (no regression)', () => {
    recording('r-good')
    const source = personVia('Alpha', 'r-good', { meetingId: 'mtg-a' })
    const keeper = personVia('Beta', 'r-good', { meetingId: 'mtg-b' })

    const res = renameGraphEntity(source, 'Beta')
    expect(res.outcome).toBe('merged')
    expect(res.nodeId).toBe(keeper)
    // Source folded away.
    expect(getKnowledgeGraphStore().getNode(source)).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// ADV34-3 — bind collision keeper guard
// ---------------------------------------------------------------------------

describe('ADV34-3 — linkNodeToContact refuses an implicit contact-keyed keeper that is excluded-only', () => {
  it('bind a VISIBLE source to a contact whose existing keeper node is EXCLUDED-ONLY ⇒ refused, byte-identical state', () => {
    recording('r-good')
    recording('r-bad', { deleted: true })
    userContact('c-target', 'Target Person') // the target contact itself is visible (structural)
    const source = personVia('Loose', 'r-good', { meetingId: 'mtg-s' })
    // An existing contact-keyed keeper node for c-target — visible ONLY via an excluded edge.
    const keeper = personVia('Target Person', 'r-bad', { contactId: 'c-target', meetingId: 'mtg-k' })

    const before = snapshot()
    expect(() => linkNodeToContact(source, 'c-target')).toThrow()
    const after = snapshot()
    expect(after).toEqual(before)
    // No manual alias written; source + keeper both intact (no merge/delete).
    expect(after.aliases).toBe(before.aliases)
    expect(getKnowledgeGraphStore().getNode(source)).toBeDefined()
    expect(getKnowledgeGraphStore().getNode(keeper)).toBeDefined()
  })

  it('bind a VISIBLE source to a contact whose existing keeper node is VISIBLE ⇒ merge proceeds (no regression)', () => {
    recording('r-good')
    userContact('c-target', 'Target Person')
    const source = personVia('Loose', 'r-good', { meetingId: 'mtg-s' })
    const keeper = personVia('Target Person', 'r-good', { contactId: 'c-target', meetingId: 'mtg-k' })

    const res = linkNodeToContact(source, 'c-target')
    expect(res.outcome).toBe('merged')
    expect(res.nodeId).toBe(keeper)
    expect(getKnowledgeGraphStore().getNode(source)).toBeUndefined()
  })
})
