/**
 * Tests for the Context Graph node-editing service (rename-as-correction,
 * convert/link to a contact, merge, remove, pronouns, node detail).
 *
 * Mirrors context-graph-service.test.ts: mock Electron/config/ai-providers and
 * use the real DB engine with a fresh temp DB per test. Graphs are built directly
 * via the store for deterministic control (no LLM round-trip).
 */

// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'

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

let _dbCounter = 0
vi.mock('../file-storage', () => ({
  getDatabasePath: vi.fn(() => join(tmpdir(), `hidock-ctxmut-test-${Date.now()}-${++_dbCounter}.sqlite`)),
}))

import {
  initializeDatabase,
  run as dbRun,
  getContactById,
  getContactByName,
  getContactAliases,
} from '../database'
import {
  getKnowledgeGraphStore,
  getNodeDetail,
  renameGraphEntity,
  convertNodeToContact,
  linkNodeToContact,
  setNodePronouns,
  mergeGraphPreview,
  mergeGraphNodes,
  deleteGraphNode,
} from '../knowledge-graph-service'

function seedContact(id: string, name: string, extra: { role?: string; company?: string; email?: string } = {}) {
  // ADV30-2 (round-32) — getNodeDetail + the graph contact mutations now gate the
  // backing contact through filterVisibleEntityIds. Stamp a STRUCTURAL source ('user')
  // so these functional-test contacts are genuinely VISIBLE (a NULL-source contact with
  // no membership is legitimately suppressed on non-owner surfaces). The suppressed-
  // contact behavior is covered in context-graph-suppressed-contact.round32.test.ts.
  dbRun(
    "INSERT OR IGNORE INTO contacts (id, name, role, company, email, first_seen_at, last_seen_at, source) VALUES (?, ?, ?, ?, ?, ?, ?, 'user')",
    [id, name, extra.role ?? null, extra.company ?? null, extra.email ?? null, '2026-01-01', '2026-01-01']
  )
}

/** Build a small graph: person (name-only unless a contactId is given) + 2 meetings + project. */
function seedGraph(opts: { personLabel: string; contactId?: string } = { personLabel: 'Jiarabi' }) {
  const store = getKnowledgeGraphStore()
  const now = '2026-01-26T00:00:00.000Z'
  // ADV23-2 (round-24) — attribute the seeded edges to an eligible recording so
  // the nodes stay VISIBLE on the (non-owner) getNodeDetail surface, which now
  // suppresses legacy zero-provenance edges. Real graph content always carries
  // provenance; these functionality tests just need the node retrievable.
  dbRun('INSERT OR IGNORE INTO recordings (id, filename, date_recorded) VALUES (?, ?, ?)', [
    'rec-seed',
    'rec-seed.hda',
    '2026-01-01',
  ])
  const person = store.upsertNode(
    opts.contactId
      ? { type: 'person', label: opts.personLabel, key: `contact:${opts.contactId}`, props: { contactId: opts.contactId }, now }
      : { type: 'person', label: opts.personLabel, now }
  )
  const m1 = store.upsertNode({ type: 'meeting', label: 'Kickoff', props: { meetingId: 'mtg-1', date: '2026-01-10' }, now })
  const m2 = store.upsertNode({ type: 'meeting', label: 'Review', props: { meetingId: 'mtg-2', date: '2026-01-26' }, now })
  const proj = store.upsertNode({ type: 'project', label: 'Phoenix', now })
  const e1 = store.upsertEdge({ sourceId: person, targetId: m1, type: 'ATTENDED', now })
  const e2 = store.upsertEdge({ sourceId: person, targetId: m2, type: 'ATTENDED', now })
  const e3 = store.upsertEdge({ sourceId: m1, targetId: proj, type: 'ABOUT', now })
  for (const edgeId of [e1, e2, e3]) {
    dbRun(
      'INSERT OR IGNORE INTO graph_edge_sources (edge_id, recording_id, transcript_id, assertion_count, created_at) VALUES (?, ?, ?, 1, ?)',
      [edgeId, 'rec-seed', 'tx-seed', '2026-01-01']
    )
  }
  return { person, m1, m2, proj }
}

beforeEach(async () => {
  vi.clearAllMocks()
  await initializeDatabase()
})

describe('Context Graph node detail (discoverability)', () => {
  it('reports an extracted name-only person as NOT linked, with graph stats', async () => {
    const { person } = seedGraph({ personLabel: 'Jiarabi' })
    const d = getNodeDetail(person)
    expect(d.node?.label).toBe('Jiarabi')
    expect(d.linked).toBe(false)
    expect(d.contactId).toBeNull()
    expect(d.meetingCount).toBe(2)
    expect(d.firstSeenMs).toBe(Date.parse('2026-01-10'))
    expect(d.lastSeenMs).toBe(Date.parse('2026-01-26'))
  })

  it('enriches a linked person with contact role/org/email + aliases', async () => {
    seedContact('c-yar', 'Yaraví', { role: 'Engineer', company: 'Acme', email: 'y@acme.com' })
    const { person } = seedGraph({ personLabel: 'Yaraví', contactId: 'c-yar' })
    dbRun(
      "INSERT OR REPLACE INTO contact_aliases (id, alias_norm, contact_id, source, confidence, created_at) VALUES ('a1','jiarabi','c-yar','manual',1.0,'2026-01-01')"
    )
    const d = getNodeDetail(person)
    expect(d.linked).toBe(true)
    expect(d.contactId).toBe('c-yar')
    expect(d.role).toBe('Engineer')
    expect(d.company).toBe('Acme')
    expect(d.email).toBe('y@acme.com')
    expect(d.aliases).toContain('jiarabi')
  })
})

describe('Context Graph rename (correction)', () => {
  it('renames a name-only node in place (graph scope)', async () => {
    const { person } = seedGraph({ personLabel: 'Jiarabi' })
    const res = renameGraphEntity(person, 'Yaraví')
    expect(res.scope).toBe('graph')
    expect(res.outcome).toBe('renamed')
    const node = getKnowledgeGraphStore().getNode(res.nodeId!)!
    expect(node.label).toBe('Yaraví')
    expect(node.norm_key).toBe('yaraví')
  })

  it('renames a LINKED person through its contact record (contact scope, propagates)', async () => {
    seedContact('c-yar', 'Jiarabi')
    const { person } = seedGraph({ personLabel: 'Jiarabi', contactId: 'c-yar' })
    const res = renameGraphEntity(person, 'Yaraví')
    expect(res.scope).toBe('contact')
    // The contact itself is corrected (propagates app-wide).
    expect(getContactById('c-yar')!.name).toBe('Yaraví')
    // The graph node's display label reflects the correction; its key stays contact-bound.
    const node = getKnowledgeGraphStore().getNode(person)!
    expect(node.label).toBe('Yaraví')
    expect(node.norm_key).toBe('contact:c-yar')
  })
})

describe('Context Graph convert / link to a contact', () => {
  it('converts a name-only node into a new contact bound at the manual tier', async () => {
    const { person } = seedGraph({ personLabel: 'Jiarabi' })
    const res = convertNodeToContact(person)
    expect(res.reusedExisting).toBe(false)
    const contact = getContactByName('Jiarabi')
    expect(contact).toBeTruthy()
    expect(res.contactId).toBe(contact!.id)
    // The graph node is re-keyed onto the contact identity.
    const node = getKnowledgeGraphStore().getNode(res.nodeId)!
    expect(node.norm_key).toBe(`contact:${contact!.id}`)
    // A sovereign manual alias binds the spelling to the contact.
    expect(getContactAliases(contact!.id).some((a) => a.alias === 'jiarabi')).toBe(true)
  })

  it('reuses an existing exact-name contact instead of minting a twin', async () => {
    seedContact('c-existing', 'Jiarabi')
    const { person } = seedGraph({ personLabel: 'Jiarabi' })
    const res = convertNodeToContact(person)
    expect(res.reusedExisting).toBe(true)
    expect(res.contactId).toBe('c-existing')
  })

  it('links an extracted node to an existing contact (set identity)', async () => {
    seedContact('c-yar', 'Yaraví')
    const { person } = seedGraph({ personLabel: 'Jiarabi' })
    const res = linkNodeToContact(person, 'c-yar')
    expect(res.contactId).toBe('c-yar')
    const node = getKnowledgeGraphStore().getNode(res.nodeId)!
    expect(node.norm_key).toBe('contact:c-yar')
    expect(getContactAliases('c-yar').some((a) => a.alias === 'jiarabi')).toBe(true)
  })
})

describe('Context Graph merge', () => {
  it('folds two name-only nodes graph-side (path=graph)', async () => {
    const store = getKnowledgeGraphStore()
    const { person: keeper } = seedGraph({ personLabel: 'Bob' })
    const loser = store.upsertNode({ type: 'person', label: 'Robert', now: '2026-01-01' })
    const m = store.upsertNode({ type: 'meeting', label: 'Extra', props: { meetingId: 'mx', date: '2026-01-05' }, now: '2026-01-01' })
    const eLoser = store.upsertEdge({ sourceId: loser, targetId: m, type: 'ATTENDED', now: '2026-01-01' })
    // ADV31-3 (round-33): getNodeDetail stats now derive from an EXCLUSION-FILTERED
    // subgraph, which suppresses zero-provenance edges on the non-owner inspector
    // surface. Real graph edges always carry provenance — attribute the loser's edge
    // to the eligible seed recording so the post-merge meetingCount reflects it.
    dbRun(
      'INSERT OR IGNORE INTO graph_edge_sources (edge_id, recording_id, transcript_id, assertion_count, created_at) VALUES (?, ?, ?, 1, ?)',
      [eLoser, 'rec-seed', 'tx-seed', '2026-01-01']
    )

    const preview = mergeGraphPreview(keeper, loser)
    expect(preview.contactMerge).toBe(false)
    expect(preview.b?.edges).toBe(1)

    const res = mergeGraphNodes(keeper, loser)
    expect(res.path).toBe('graph')
    expect(store.getNode(loser)).toBeUndefined()
    expect(getNodeDetail(keeper).meetingCount).toBe(3)
  })

  it('merges two linked contacts through the journaled contacts flow (path=contact)', async () => {
    seedContact('c-a', 'Bob')
    seedContact('c-b', 'Robert')
    const { person: keeper } = seedGraph({ personLabel: 'Bob', contactId: 'c-a' })
    const store = getKnowledgeGraphStore()
    const loser = store.upsertNode({ type: 'person', label: 'Robert', key: 'contact:c-b', props: { contactId: 'c-b' }, now: '2026-01-01' })
    const m = store.upsertNode({ type: 'meeting', label: 'Extra', props: { meetingId: 'mx', date: '2026-01-05' }, now: '2026-01-01' })
    const eLoser = store.upsertEdge({ sourceId: loser, targetId: m, type: 'ATTENDED', now: '2026-01-01' })
    // ADV32-2 (round-34): mergeGraphPreview + mergeGraphNodes now share a fail-closed
    // eligibility gate that also requires the node be VISIBLE under exclusion (not just
    // its contact). Real graph edges always carry provenance — attribute the loser's
    // edge to the eligible seed recording so it stays node-visible on this non-owner path.
    dbRun(
      'INSERT OR IGNORE INTO graph_edge_sources (edge_id, recording_id, transcript_id, assertion_count, created_at) VALUES (?, ?, ?, 1, ?)',
      [eLoser, 'rec-seed', 'tx-seed', '2026-01-01']
    )

    const preview = mergeGraphPreview(keeper, loser)
    expect(preview.contactMerge).toBe(true)

    const res = mergeGraphNodes(keeper, loser)
    expect(res.path).toBe('contact')
    // The loser contact was folded (journaled) and its graph node removed.
    expect(getContactById('c-b')).toBeUndefined()
    expect(store.getNode(loser)).toBeUndefined()
  })
})

describe('Context Graph remove + pronouns', () => {
  it('removes a node and its edges', async () => {
    const { person } = seedGraph({ personLabel: 'Junk' })
    const res = deleteGraphNode(person)
    expect(res.removed).toBe(true)
    expect(res.removedEdges).toBe(2)
    expect(getKnowledgeGraphStore().getNode(person)).toBeUndefined()
  })

  it('sets and clears pronouns on a person node', async () => {
    const { person } = seedGraph({ personLabel: 'Yaraví' })
    expect(setNodePronouns(person, 'He/Him')).toBe(true)
    expect(getNodeDetail(person).pronouns).toBe('He/Him')
    setNodePronouns(person, '')
    expect(getNodeDetail(person).pronouns).toBeNull()
  })
})
