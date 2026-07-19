// @vitest-environment node

/**
 * MERGE-GATE round 32 — resolver visible-preference (ADV30-1) + forKeying
 * prefers-visible-never-suppressed + getNodeDetail / contact-backed graph mutation
 * gating (ADV30-2). REAL temp DB, real database.ts (better-sqlite3) end to end.
 *
 * ADV30-1 — the exact-name/email resolution tiers resolve from the VISIBILITY-
 *   filtered candidate set and PREFER a visible match, so re-analysis of an eligible
 *   recording links the visible replacement (idempotent) instead of creating a new
 *   entity every pass beside an older SUPPRESSED same-name row.
 * ADV30-2 — ingest keying (rekeyExistingPersonNodes / makePersonResolver) keys a
 *   node to a VISIBLE same-name contact, and NEVER to a suppressed one (falls back to
 *   NAME keying); getNodeDetail exposes NONE of a suppressed backing contact's fields
 *   (contactId/company/email/aliases); and contact-backed graph mutations
 *   (rename/link/convert) refuse a suppressed target.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'

const dbPath = join(tmpdir(), `hidock-ctxsup-r32-${process.pid}.sqlite`)
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
import { applyTranscriptEntities } from '../org-reconciler'
import {
  getKnowledgeGraphStore,
  getNodeDetail,
  renameGraphEntity,
  linkNodeToContact,
  convertNodeToContact,
  rekeyExistingPersonNodes,
} from '../knowledge-graph-service'

// --- seed helpers -----------------------------------------------------------

function meeting(id: string): void {
  run(`INSERT INTO meetings (id, subject, start_time, end_time) VALUES (?, ?, '2026-01-02T10:00:00Z', '2026-01-02T11:00:00Z')`, [id, id])
}
function recording(id: string, meetingId: string | null, opts: { personal?: boolean } = {}): void {
  run(
    `INSERT INTO recordings (id, filename, date_recorded, personal, meeting_id) VALUES (?, ?, '2026-01-02T10:00:00Z', ?, ?)`,
    [id, `${id}.hda`, opts.personal ? 1 : 0, meetingId]
  )
}
function contact(
  id: string,
  name: string,
  source: string | null,
  opts: { recId?: string | null; role?: string | null; company?: string | null; email?: string | null; createdAt?: string } = {}
): void {
  run(
    `INSERT INTO contacts (id, name, email, type, role, company, first_seen_at, last_seen_at, meeting_count, created_at, source, source_recording_id)
     VALUES (?, ?, ?, 'unknown', ?, ?, '2026-01-01', '2026-01-01', 0, ?, ?, ?)`,
    [id, name, opts.email ?? null, opts.role ?? null, opts.company ?? null, opts.createdAt ?? '2026-01-01T00:00:00Z', source, opts.recId ?? null]
  )
}
function mc(meetingId: string, contactId: string, source: string | null, recId: string | null = null): void {
  run(`INSERT INTO meeting_contacts (meeting_id, contact_id, role, source, source_recording_id) VALUES (?, ?, 'attendee', ?, ?)`, [meetingId, contactId, source, recId])
}

/** A person GRAPH node with ATTENDED edges attributed to `recId` (visible under exclusion). */
function seedPersonNode(label: string, recId: string, contactId?: string): string {
  const store = getKnowledgeGraphStore()
  const now = '2026-01-26T00:00:00.000Z'
  run('INSERT OR IGNORE INTO recordings (id, filename, date_recorded) VALUES (?, ?, ?)', [recId, `${recId}.hda`, '2026-01-01'])
  const person = store.upsertNode(
    contactId
      ? { type: 'person', label, key: `contact:${contactId}`, props: { contactId }, now }
      : { type: 'person', label, now }
  )
  const m = store.upsertNode({ type: 'meeting', label: `M-${label}`, props: { meetingId: `mtg-${label}`, date: '2026-01-10' }, now })
  const e = store.upsertEdge({ sourceId: person, targetId: m, type: 'ATTENDED', now })
  run(
    'INSERT OR IGNORE INTO graph_edge_sources (edge_id, recording_id, transcript_id, assertion_count, created_at) VALUES (?, ?, ?, 1, ?)',
    [e, recId, `tx-${label}`, '2026-01-01']
  )
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
// ADV30-1 — repeated re-analysis is idempotent (no duplicate proliferation)
// ---------------------------------------------------------------------------

describe('ADV30-1 — exact-name resolution prefers the visible replacement', () => {
  beforeEach(() => {
    meeting('m-old')
    recording('r-old', 'm-old', { personal: true }) // EXCLUDED
    contact('c-dana', 'Dana Prince', 'transcript', { recId: 'r-old', role: 'Engineer', createdAt: '2026-01-01T00:00:00Z' })
    mc('m-old', 'c-dana', 'transcript', 'r-old')
    meeting('m-new')
    recording('r-new', 'm-new', {}) // ELIGIBLE
  })

  it('the old contact is suppressed', () => {
    expect(filterVisibleEntityIds('contact', ['c-dana']).visible.has('c-dana')).toBe(false)
  })

  it('applyTranscriptEntities twice ⇒ exactly ONE replacement contact + ONE membership', () => {
    const runOnce = () =>
      applyTranscriptEntities({
        meetingId: 'm-new',
        recordingId: 'r-new',
        participants: [{ name: 'Dana Prince', role: 'Manager' }],
      })
    runOnce()
    runOnce()

    // Exactly one NEW contact beside the suppressed c-dana.
    const replacements = queryAll<{ id: string; source: string | null; source_recording_id: string | null }>(
      "SELECT id, source, source_recording_id FROM contacts WHERE LOWER(name) = 'dana prince' AND id <> 'c-dana'"
    )
    expect(replacements).toHaveLength(1)
    expect(replacements[0].source).toBe('transcript')
    expect(replacements[0].source_recording_id).toBe('r-new')
    // The replacement is visible; the old one stays suppressed with no m-new membership.
    expect(filterVisibleEntityIds('contact', [replacements[0].id]).visible.has(replacements[0].id)).toBe(true)
    expect(queryOne('SELECT 1 FROM meeting_contacts WHERE meeting_id = ? AND contact_id = ?', ['m-new', 'c-dana'])).toBeUndefined()

    // Exactly ONE membership on m-new (the replacement), not one per run.
    const memberships = queryAll<{ contact_id: string }>('SELECT contact_id FROM meeting_contacts WHERE meeting_id = ?', ['m-new'])
    expect(memberships).toHaveLength(1)
    expect(memberships[0].contact_id).toBe(replacements[0].id)
  })
})

// ---------------------------------------------------------------------------
// ADV30-2(a) — ingest keying prefers a VISIBLE contact, never a suppressed one
// ---------------------------------------------------------------------------

describe('ADV30-2 — rekeyExistingPersonNodes prefers-visible-never-suppressed', () => {
  it('keys the node to the VISIBLE same-name contact (not the suppressed one)', () => {
    meeting('m-old')
    recording('r-old', 'm-old', { personal: true })
    // Older SUPPRESSED same-name contact + newer VISIBLE (structural) replacement.
    contact('c-sup', 'Dana Prince', 'transcript', { recId: 'r-old', createdAt: '2026-01-01T00:00:00Z' })
    contact('c-live', 'Dana Prince', 'user', { createdAt: '2026-02-01T00:00:00Z' })

    const person = seedPersonNode('Dana Prince', 'rec-elig')
    const res = rekeyExistingPersonNodes()
    expect(res.rekeyed + res.merged).toBeGreaterThanOrEqual(1)

    const node = getKnowledgeGraphStore().getNode(person)!
    expect(node.norm_key).toBe('contact:c-live')
    expect(node.norm_key).not.toBe('contact:c-sup')
  })

  it('a suppressed-ONLY same-name contact ⇒ node stays NAME-keyed (never keyed to the suppressed id)', () => {
    meeting('m-old')
    recording('r-old', 'm-old', { personal: true })
    contact('c-sup', 'Zed Kappa', 'transcript', { recId: 'r-old' })

    const person = seedPersonNode('Zed Kappa', 'rec-elig')
    rekeyExistingPersonNodes()

    const node = getKnowledgeGraphStore().getNode(person)!
    expect(node.norm_key).not.toContain('contact:')
    expect(node.norm_key).toBe('zed kappa')
  })
})

// ---------------------------------------------------------------------------
// ADV30-2(b) — getNodeDetail gates ALL contact fields via filterVisibleEntityIds
// ---------------------------------------------------------------------------

describe('ADV30-2 — getNodeDetail hides a suppressed backing contact', () => {
  it('exposes NONE of a suppressed contact’s fields even when the node is visible', () => {
    meeting('m-old')
    recording('r-old', 'm-old', { personal: true })
    contact('c-sup', 'Dana Prince', 'transcript', { recId: 'r-old', company: 'GhostCorp', email: 'dana@ghost.com', role: 'Spy' })
    run(
      "INSERT OR REPLACE INTO contact_aliases (id, alias_norm, contact_id, source, confidence, created_at) VALUES ('a-sup','dana p','c-sup','manual',1.0,'2026-01-01')"
    )
    // Node is keyed to the suppressed contact but stays visible via an ELIGIBLE recording's edges.
    const person = seedPersonNode('Dana Prince', 'rec-elig', 'c-sup')

    const d = getNodeDetail(person)
    expect(d.node).not.toBeNull() // node itself visible (eligible edges)
    expect(d.contactId).toBeNull()
    expect(d.linked).toBe(false)
    expect(d.company).toBeNull()
    expect(d.email).toBeNull()
    expect(d.aliases).toEqual([])
  })

  it('a VISIBLE backing contact still exposes its fields', () => {
    contact('c-live', 'Yaraví', 'user', { company: 'Acme', email: 'y@acme.com', role: 'Engineer' })
    run(
      "INSERT OR REPLACE INTO contact_aliases (id, alias_norm, contact_id, source, confidence, created_at) VALUES ('a-live','jiarabi','c-live','manual',1.0,'2026-01-01')"
    )
    const person = seedPersonNode('Yaraví', 'rec-elig', 'c-live')

    const d = getNodeDetail(person)
    expect(d.contactId).toBe('c-live')
    expect(d.linked).toBe(true)
    expect(d.company).toBe('Acme')
    expect(d.email).toBe('y@acme.com')
    expect(d.aliases).toContain('jiarabi')
  })
})

// ---------------------------------------------------------------------------
// ADV30-2(c) — contact-backed graph mutations refuse a suppressed target
// ---------------------------------------------------------------------------

describe('ADV30-2 — graph mutations refuse a suppressed contact', () => {
  beforeEach(() => {
    meeting('m-old')
    recording('r-old', 'm-old', { personal: true })
    contact('c-sup', 'Dana Prince', 'transcript', { recId: 'r-old', company: 'GhostCorp' })
  })

  it('renameGraphEntity is a no-op for a node backed by a suppressed contact', () => {
    const person = seedPersonNode('Dana Prince', 'rec-elig', 'c-sup')
    const res = renameGraphEntity(person, 'Renamed Person')
    expect(res.outcome).toBe('noop')
    // The suppressed contact was NOT renamed/re-exposed.
    expect(getContactById('c-sup')!.name).toBe('Dana Prince')
  })

  it('linkNodeToContact throws when the target contact is suppressed', () => {
    const other = seedPersonNode('Someone Else', 'rec-elig')
    expect(() => linkNodeToContact(other, 'c-sup')).toThrow()
    // No manual alias was written binding the spelling to the suppressed contact.
    expect(queryOne("SELECT 1 FROM contact_aliases WHERE contact_id = 'c-sup' AND source = 'manual'")).toBeUndefined()
  })

  it('convertNodeToContact does NOT reuse a suppressed same-name contact (creates a fresh visible one)', () => {
    const person = seedPersonNode('Dana Prince', 'rec-elig')
    const res = convertNodeToContact(person)
    expect(res.reusedExisting).toBe(false)
    expect(res.contactId).not.toBe('c-sup')
    // A brand-new, visible contact now backs the node.
    const fresh = getContactById(res.contactId)!
    expect(fresh.id).not.toBe('c-sup')
    // Two 'Dana Prince' contacts now exist: the suppressed original + the fresh one.
    expect(queryAll("SELECT id FROM contacts WHERE LOWER(name) = 'dana prince'")).toHaveLength(2)
  })
})
