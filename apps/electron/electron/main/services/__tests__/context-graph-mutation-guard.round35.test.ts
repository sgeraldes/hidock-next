// @vitest-environment node

/**
 * MERGE-GATE round 35 — ADV33-2: shared execution-time NODE-visibility guard on ALL
 * point graph mutations. REAL temp DB, real database.ts (better-sqlite3) end to end.
 *
 * The graph inspector resolves a node while it is VISIBLE, then the user acts. Between
 * load and the mutation the node's source recording can become personal / deleted /
 * value-excluded / hard-purged, so the node is now HIDDEN (all incident edges
 * suppressed). Every point mutation must RE-CHECK node visibility at EXECUTION time
 * and REFUSE fail-closed — otherwise a stale mutation launders excluded-derived
 * identity. convertNodeToContact is worst: it mints an always-visible source='user'
 * contact.
 *
 * Covered mutations: convertNodeToContact, renameGraphEntity, linkNodeToContact,
 * setNodePronouns, mergeGraphNodes. deleteGraphNode / prune are owner cleanup (remove
 * data, never expose) and intentionally NOT guarded.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'

const dbPath = join(tmpdir(), `hidock-ctxguard-r35-${process.pid}.sqlite`)
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
  convertNodeToContact,
  renameGraphEntity,
  linkNodeToContact,
  setNodePronouns,
  mergeGraphNodes,
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
function contact(id: string, name: string, source: string | null): void {
  run(
    `INSERT INTO contacts (id, name, email, type, role, company, first_seen_at, last_seen_at, meeting_count, created_at, source, source_recording_id)
     VALUES (?, ?, NULL, 'unknown', NULL, NULL, '2026-01-01', '2026-01-01', 0, '2026-01-01T00:00:00Z', ?, NULL)`,
    [id, name, source]
  )
}
function attribute(edgeId: string, recId: string): void {
  run(
    'INSERT OR IGNORE INTO graph_edge_sources (edge_id, recording_id, transcript_id, assertion_count, created_at) VALUES (?, ?, ?, 1, ?)',
    [edgeId, recId, `tx-${recId}`, '2026-01-01']
  )
}

/** A person node (optionally keyed to a contact) visible via an ATTENDED edge to a
 *  meeting attributed to `recId`. Returns the node id. */
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

/** Flip recording `recId` into an EXCLUDED state AFTER the node was "loaded". */
function exclude(recId: string, how: 'personal' | 'deleted' | 'value' | 'purge'): void {
  switch (how) {
    case 'personal':
      run('UPDATE recordings SET personal = 1 WHERE id = ?', [recId])
      break
    case 'deleted':
      run('UPDATE recordings SET deleted_at = ? WHERE id = ?', ['2026-03-01T00:00:00Z', recId])
      break
    case 'value':
      // A value-excluded capture (garbage) sourced from the recording.
      run(
        `INSERT INTO knowledge_captures (id, title, quality_rating, source_recording_id, captured_at)
         VALUES (?, ?, 'garbage', ?, '2026-01-05T00:00:00Z')`,
        [`kc-${recId}`, `cap-${recId}`, recId]
      )
      break
    case 'purge':
      // Hard-purge: the recording row is gone. getGroundingExclusionSet derives the
      // suppression set from a POSITIVE allowlist (ADV9), so a purged id is not
      // eligible ⇒ its edges are suppressed ⇒ the node is excluded-only.
      run('DELETE FROM recordings WHERE id = ?', [recId])
      break
  }
}

interface Snap { nodes: string[]; keys: string[]; edges: string[]; contacts: number; userContacts: number }
function snapshot(): Snap {
  return {
    nodes: queryAll<{ id: string }>('SELECT id FROM graph_nodes ORDER BY id').map((r) => r.id),
    keys: queryAll<{ norm_key: string }>('SELECT norm_key FROM graph_nodes ORDER BY id').map((r) => r.norm_key),
    edges: queryAll<{ id: string }>('SELECT id FROM graph_edges ORDER BY id').map((r) => r.id),
    contacts: queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM contacts')?.n ?? 0,
    userContacts: queryOne<{ n: number }>("SELECT COUNT(*) AS n FROM contacts WHERE source = 'user'")?.n ?? 0,
  }
}

const AFTER_LOAD: Array<'personal' | 'deleted' | 'value' | 'purge'> = ['personal', 'deleted', 'value', 'purge']

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
// convertNodeToContact — the worst case (mints an always-visible user contact)
// ---------------------------------------------------------------------------

describe('ADV33-2 — convertNodeToContact refuses a node excluded AFTER inspector load', () => {
  for (const how of AFTER_LOAD) {
    it(`node becomes ${how} after load ⇒ convert refused, NO source='user' contact created, no state change`, () => {
      recording('r1')
      const person = seedPersonNode('Ghost Name', 'r1')
      exclude('r1', how)
      const before = snapshot()
      expect(() => convertNodeToContact(person)).toThrow()
      const after = snapshot()
      expect(after).toEqual(before)
      // The always-visible structural contact was NEVER minted.
      expect(after.userContacts).toBe(0)
      expect(queryOne<{ n: number }>("SELECT COUNT(*) AS n FROM contacts WHERE name = 'Ghost Name'")?.n ?? 0).toBe(0)
    })
  }

  it('an ELIGIBLE node still converts (no regression) — creates a visible user contact', () => {
    recording('r1')
    const person = seedPersonNode('Live Name', 'r1')
    const res = convertNodeToContact(person)
    expect(res.contactId).toBeTruthy()
    expect(res.reusedExisting).toBe(false)
    expect(queryOne<{ source: string }>('SELECT source FROM contacts WHERE id = ?', [res.contactId])?.source).toBe('user')
  })
})

// ---------------------------------------------------------------------------
// renameGraphEntity
// ---------------------------------------------------------------------------

describe('ADV33-2 — renameGraphEntity refuses a node excluded AFTER inspector load', () => {
  for (const how of AFTER_LOAD) {
    it(`node becomes ${how} after load ⇒ rename is a fail-closed noop, no label change`, () => {
      recording('r1')
      const person = seedPersonNode('Old Label', 'r1')
      exclude('r1', how)
      const before = snapshot()
      const res = renameGraphEntity(person, 'New Label')
      expect(res.outcome).toBe('noop')
      expect(snapshot()).toEqual(before)
      // Label untouched.
      expect(queryOne<{ label: string }>('SELECT label FROM graph_nodes WHERE id = ?', [person])?.label).toBe('Old Label')
    })
  }

  it('an ELIGIBLE node still renames (no regression)', () => {
    recording('r1')
    const person = seedPersonNode('Old Label', 'r1')
    const res = renameGraphEntity(person, 'New Label')
    expect(res.outcome).toBe('renamed')
    expect(queryOne<{ label: string }>('SELECT label FROM graph_nodes WHERE id = ?', [person])?.label).toBe('New Label')
  })
})

// ---------------------------------------------------------------------------
// linkNodeToContact
// ---------------------------------------------------------------------------

describe('ADV33-2 — linkNodeToContact refuses a node excluded AFTER inspector load', () => {
  for (const how of AFTER_LOAD) {
    it(`node becomes ${how} after load ⇒ link refused, no alias/re-key`, () => {
      recording('r1')
      contact('c-live', 'Target Person', 'user') // a visible target contact
      const person = seedPersonNode('Loose Node', 'r1')
      exclude('r1', how)
      const before = snapshot()
      expect(() => linkNodeToContact(person, 'c-live')).toThrow()
      const after = snapshot()
      expect(after).toEqual(before)
      // No manual alias was written binding the hidden node's spelling.
      expect(queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM contact_aliases WHERE contact_id = ?', ['c-live'])?.n ?? 0).toBe(0)
    })
  }

  it('an ELIGIBLE node still links (no regression)', () => {
    recording('r1')
    contact('c-live', 'Target Person', 'user')
    const person = seedPersonNode('Loose Node', 'r1')
    const res = linkNodeToContact(person, 'c-live')
    expect(res.contactId).toBe('c-live')
    expect(queryOne<{ norm_key: string }>('SELECT norm_key FROM graph_nodes WHERE id = ?', [res.nodeId])?.norm_key).toBe('contact:c-live')
  })
})

// ---------------------------------------------------------------------------
// setNodePronouns
// ---------------------------------------------------------------------------

describe('ADV33-2 — setNodePronouns refuses a node excluded AFTER inspector load', () => {
  for (const how of AFTER_LOAD) {
    it(`node becomes ${how} after load ⇒ setPronouns returns false, props untouched`, () => {
      recording('r1')
      const person = seedPersonNode('Some Person', 'r1')
      exclude('r1', how)
      const before = snapshot()
      expect(setNodePronouns(person, 'they/them')).toBe(false)
      expect(snapshot()).toEqual(before)
      const props = queryOne<{ props: string | null }>('SELECT props FROM graph_nodes WHERE id = ?', [person])?.props ?? ''
      expect(props ?? '').not.toContain('they/them')
    })
  }

  it('an ELIGIBLE node still sets pronouns (no regression)', () => {
    recording('r1')
    const person = seedPersonNode('Some Person', 'r1')
    expect(setNodePronouns(person, 'they/them')).toBe(true)
    expect(queryOne<{ props: string | null }>('SELECT props FROM graph_nodes WHERE id = ?', [person])?.props ?? '').toContain('they/them')
  })
})

// ---------------------------------------------------------------------------
// mergeGraphNodes — node (not just contact) excluded after load
// ---------------------------------------------------------------------------

describe('ADV33-2 — mergeGraphNodes refuses when a node is excluded AFTER inspector load', () => {
  for (const how of AFTER_LOAD) {
    it(`loser node becomes ${how} after load ⇒ merge refused, no node/edge change`, () => {
      recording('r-keep')
      recording('r-lose')
      const keeper = seedPersonNode('Keeper', 'r-keep')
      const loser = seedPersonNode('Loser', 'r-lose')
      exclude('r-lose', how) // loser becomes excluded-only after load
      const before = snapshot()
      expect(() => mergeGraphNodes(keeper, loser)).toThrow()
      expect(snapshot()).toEqual(before)
      // Loser node survives (was NOT folded/deleted).
      expect(getKnowledgeGraphStore().getNode(loser)).toBeDefined()
    })
  }

  it('both nodes eligible ⇒ merge still works (no regression)', () => {
    recording('r-keep')
    recording('r-lose')
    const keeper = seedPersonNode('Keeper', 'r-keep')
    const loser = seedPersonNode('Loser', 'r-lose')
    const res = mergeGraphNodes(keeper, loser)
    expect(res.keeperId).toBeTruthy()
    expect(getKnowledgeGraphStore().getNode(loser)).toBeUndefined()
  })
})
