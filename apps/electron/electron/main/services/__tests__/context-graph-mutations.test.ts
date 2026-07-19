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
  queryAll,
  queryOne,
  getContactById,
  getContactByName,
  getContactAliases,
} from '../database'
// Namespace import so a graph-phase fault can be injected into the app-level run()
// the service imports (renameGraphEntity's graph_nodes UPDATE and bindNodeToContact's
// re-key both go through this run, as does the graphDbAdapter that setNodeProps/
// mergeNodes use). database.ts's OWN internal self-calls (createContact / updateContact /
// upsertContactAlias) use its module-local run and are NOT intercepted — so the spy lands
// strictly in the GRAPH phase while the relational writes execute-then-roll-back.
import * as database from '../database'
import {
  getKnowledgeGraphStore,
  getNodeDetail,
  renameGraphEntity,
  convertNodeToContact,
  linkNodeToContact,
  setNodePronouns,
  mergeGraphPreview,
  mergeGraphNodes,
  mergeContactsWithGraph,
  mergeProjectsWithGraph,
  acceptIdentitySuggestionWithGraph,
  deleteGraphNode,
  removeRecordingProvenanceCore,
} from '../knowledge-graph-service'
import { mergeDuplicateContacts } from '../org-reconciler'

function seedContact(id: string, name: string, extra: { role?: string; company?: string; email?: string } = {}) {
  // ADV30-2 (round-32) — getNodeDetail + the graph contact mutations now gate the
  // backing contact through filterVisibleEntityIds. Stamp a STRUCTURAL source ('user')
  // so these functional-test contacts are genuinely VISIBLE (a NULL-source contact with
  // no membership is legitimately suppressed on non-owner surfaces). The suppressed-
  // contact behavior is covered in context-graph-suppressed-contact.round32.test.ts.
  // ADV50-1 (round-52) — a NULL role_origin is now blanked on non-owner surfaces
  // (calendar/user CLASSIFICATION ≠ authorship). A structural 'user' create WITH a role
  // is genuinely owner-authored, so stamp role_origin='user' (mirrors createContact) so
  // the manually-set role stays visible.
  dbRun(
    "INSERT OR IGNORE INTO contacts (id, name, role, company, email, first_seen_at, last_seen_at, source, role_origin) VALUES (?, ?, ?, ?, ?, ?, ?, 'user', ?)",
    [id, name, extra.role ?? null, extra.company ?? null, extra.email ?? null, '2026-01-01', '2026-01-01', extra.role != null ? 'user' : null]
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

// ---------------------------------------------------------------------------
// ADV53-1 (round-55): the composite contact+graph merge (path='contact') is
// CROSS-LAYER failure-atomic. mergeContacts (relational rows + undo-journal) and
// mergeNodes (graph surgery) share ONE outer runInTransaction, so a throw in the
// GRAPH phase — AFTER the contact merge already ran within the transaction —
// rolls BOTH layers back. Without the wrap, the contact merge + journal committed
// first and only the graph fold failed, leaving relational and graph identity
// inconsistent and stranding provenance under a now-deleted contact.
// ---------------------------------------------------------------------------
describe('Context Graph merge cross-layer atomicity (ADV53-1 / round-55)', () => {
  /** Snapshot every table the composite merge touches, ordered for byte-identity. */
  function snapshot() {
    return {
      graphNodes: JSON.stringify(queryAll('SELECT * FROM graph_nodes ORDER BY id')),
      graphEdges: JSON.stringify(queryAll('SELECT * FROM graph_edges ORDER BY id')),
      graphEdgeSources: JSON.stringify(
        queryAll('SELECT * FROM graph_edge_sources ORDER BY edge_id, recording_id, transcript_id')
      ),
      meetingContacts: JSON.stringify(queryAll('SELECT * FROM meeting_contacts ORDER BY meeting_id, contact_id')),
      journalCount: (queryAll<{ c: number }>('SELECT COUNT(*) AS c FROM merge_journal')[0]?.c ?? 0),
    }
  }

  /** Seed two linked, visible person nodes (keeper c-a, loser c-b) + loser graph edges. */
  function seedComposite() {
    seedContact('c-a', 'Bob')
    seedContact('c-b', 'Robert')
    const { person: keeper } = seedGraph({ personLabel: 'Bob', contactId: 'c-a' })
    const store = getKnowledgeGraphStore()
    const loser = store.upsertNode({
      type: 'person',
      label: 'Robert',
      key: 'contact:c-b',
      props: { contactId: 'c-b' },
      now: '2026-01-01',
    })
    const m = store.upsertNode({ type: 'meeting', label: 'Extra', props: { meetingId: 'mx', date: '2026-01-05' }, now: '2026-01-01' })
    const eLoser = store.upsertEdge({ sourceId: loser, targetId: m, type: 'ATTENDED', now: '2026-01-01' })
    dbRun(
      'INSERT OR IGNORE INTO graph_edge_sources (edge_id, recording_id, transcript_id, assertion_count, created_at) VALUES (?, ?, ?, 1, ?)',
      [eLoser, 'rec-seed', 'tx-seed', '2026-01-01']
    )
    // Give the loser contact a distinct membership so a leaked contact-merge would
    // be visible as a repointed/collided meeting_contacts row.
    dbRun('INSERT OR IGNORE INTO meetings (id, subject, start_time, end_time) VALUES (?, ?, ?, ?)', [
      'mtg-loser',
      'Loser Sync',
      '2026-01-05T00:00:00.000Z',
      '2026-01-05T01:00:00.000Z',
    ])
    dbRun('INSERT OR IGNORE INTO meeting_contacts (meeting_id, contact_id, role) VALUES (?, ?, ?)', [
      'mtg-loser',
      'c-b',
      'attendee',
    ])
    return { keeper, loser, store }
  }

  it('rolls BOTH the contact merge AND the graph fold back when the graph phase throws', async () => {
    const { keeper, loser, store } = seedComposite()

    const before = snapshot()
    // Sanity: the composite path IS the one under test (both contacts visible).
    expect(mergeGraphPreview(keeper, loser).contactMerge).toBe(true)

    // Inject a fault into the GRAPH phase only: throw once on the loser-node delete,
    // which mergeNodes runs LAST — after mergeContacts has already deleted/repointed
    // the loser contact + written its journal row within the shared transaction.
    // mergeContacts uses the app-level run() (not store.db.run), so this spy lands
    // strictly in the graph surgery, after the contact phase began.
    const origRun = store.db.run.bind(store.db)
    let fired = false
    const spy = vi.spyOn(store.db, 'run').mockImplementation((sql: string, params?: unknown[]) => {
      if (!fired && /DELETE\s+FROM\s+graph_nodes/i.test(sql)) {
        fired = true
        throw new Error('injected fault: graph_nodes delete')
      }
      return origRun(sql, params)
    })

    try {
      expect(() => mergeGraphNodes(keeper, loser)).toThrow(/injected fault/)
    } finally {
      spy.mockRestore()
    }
    expect(fired).toBe(true)

    const after = snapshot()

    // The whole composite rolled back: loser contact survives, journal untouched,
    // memberships unchanged, and graph tables byte-identical to the pre-merge snapshot.
    expect(getContactById('c-b')).toBeTruthy()
    expect(getContactById('c-a')).toBeTruthy()
    expect(store.getNode(loser)).toBeTruthy()
    expect(after.journalCount).toBe(before.journalCount)
    expect(after.meetingContacts).toBe(before.meetingContacts)
    expect(after.graphNodes).toBe(before.graphNodes)
    expect(after.graphEdges).toBe(before.graphEdges)
    expect(after.graphEdgeSources).toBe(before.graphEdgeSources)
  })

  it('happy path: a successful composite merge commits BOTH the contact fold and the graph fold', async () => {
    const { keeper, loser, store } = seedComposite()
    const before = snapshot()

    const res = mergeGraphNodes(keeper, loser)
    expect(res.path).toBe('contact')

    // Contact layer folded (journaled): loser gone, keeper survives, journal grew.
    expect(getContactById('c-b')).toBeUndefined()
    expect(getContactById('c-a')).toBeTruthy()
    expect(snapshot().journalCount).toBe(before.journalCount + 1)
    // Graph layer folded: loser node removed, its membership repointed to keeper.
    expect(store.getNode(loser)).toBeUndefined()
    const repointed = queryAll<{ contact_id: string }>('SELECT contact_id FROM meeting_contacts WHERE meeting_id = ?', ['mtg-loser'])
    expect(repointed).toEqual([{ contact_id: 'c-a' }])
  })
})

// ---------------------------------------------------------------------------
// ADV54-1 (round-56): the remaining contact+graph composite mutations are
// CROSS-LAYER failure-atomic, mirroring the round-55 merge fix. Each writes the
// RELATIONAL layer (contacts / contact_aliases) AND the GRAPH layer (graph_nodes
// re-key/label/props) — running them as separate auto-commits left the relational
// write persisted when the graph phase failed, so the app reported failure while a
// half-applied identity survived (an always-visible source='user' contact, a
// sovereign manual alias, or a renamed contact with a stale graph label). Each is
// now wrapped in ONE re-entrant runInTransaction so both layers roll back together:
//   - convertNodeToContact (fresh-create): createContact + bindNodeToContact
//   - bindNodeToContact (via linkNodeToContact): manual alias + graph re-key
//   - renameGraphEntity (contact scope): updateContact + graph_nodes label refresh
// ---------------------------------------------------------------------------
describe('Context Graph contact/graph composite atomicity (ADV54-1 / round-56)', () => {
  /** Snapshot every table these composites touch, ordered for byte-identity. */
  function snap() {
    return {
      contacts: JSON.stringify(queryAll('SELECT * FROM contacts ORDER BY id')),
      contactAliases: JSON.stringify(queryAll('SELECT * FROM contact_aliases ORDER BY id')),
      graphNodes: JSON.stringify(queryAll('SELECT * FROM graph_nodes ORDER BY id')),
      graphEdges: JSON.stringify(queryAll('SELECT * FROM graph_edges ORDER BY id')),
      graphEdgeSources: JSON.stringify(
        queryAll('SELECT * FROM graph_edge_sources ORDER BY edge_id, recording_id, transcript_id')
      ),
      journalCount: queryAll<{ c: number }>('SELECT COUNT(*) AS c FROM merge_journal')[0]?.c ?? 0,
    }
  }

  /**
   * Install a one-shot graph-phase fault: the FIRST app-level run() whose SQL matches
   * `pattern` throws. The relational writes (createContact/updateContact/upsertContactAlias)
   * go through database.ts's module-local run and are NOT matched here, so they run first
   * and must be undone by the transaction rollback the throw triggers.
   */
  function injectGraphFault(pattern: RegExp) {
    const origRun = database.run
    let fired = false
    const spy = vi.spyOn(database, 'run').mockImplementation((sql: string, params?: unknown[]) => {
      if (!fired && pattern.test(sql)) {
        fired = true
        throw new Error('injected fault: graph phase')
      }
      return origRun(sql, (params ?? []) as unknown[])
    })
    return { spy, fired: () => fired }
  }

  it('convertNodeToContact (fresh-create): rolls back the created contact AND the manual alias when the graph re-key throws', async () => {
    const { person } = seedGraph({ personLabel: 'Jiarabi' })
    const before = snap()
    // Precondition: no contact exists yet — the create is what must roll back.
    expect(getContactByName('Jiarabi')).toBeFalsy()

    const { spy, fired } = injectGraphFault(/UPDATE\s+graph_nodes\s+SET\s+norm_key/i)
    try {
      expect(() => convertNodeToContact(person)).toThrow(/injected fault/)
    } finally {
      spy.mockRestore()
    }
    expect(fired()).toBe(true)

    const after = snap()
    // No half-applied identity: no new source='user' contact, no manual alias, graph intact.
    expect(getContactByName('Jiarabi')).toBeFalsy()
    expect(after.contacts).toBe(before.contacts)
    expect(after.contactAliases).toBe(before.contactAliases)
    expect(after.graphNodes).toBe(before.graphNodes)
    expect(after.graphEdges).toBe(before.graphEdges)
    expect(after.graphEdgeSources).toBe(before.graphEdgeSources)
    expect(after.journalCount).toBe(before.journalCount)
    // The graph node stays name-keyed (never re-keyed onto a contact identity).
    expect(getKnowledgeGraphStore().getNode(person)!.norm_key).toBe('jiarabi')
  })

  it('bindNodeToContact (via linkNodeToContact): rolls back the manual alias when the graph re-key throws', async () => {
    seedContact('c-yar', 'Yaraví')
    const { person } = seedGraph({ personLabel: 'Jiarabi' })
    const before = snap()

    const { spy, fired } = injectGraphFault(/UPDATE\s+graph_nodes\s+SET\s+norm_key/i)
    try {
      expect(() => linkNodeToContact(person, 'c-yar')).toThrow(/injected fault/)
    } finally {
      spy.mockRestore()
    }
    expect(fired()).toBe(true)

    const after = snap()
    // The sovereign manual alias did NOT persist (it was written before the throw,
    // within the same transaction, and rolled back).
    expect(getContactAliases('c-yar').some((a) => a.alias === 'jiarabi')).toBe(false)
    expect(after.contactAliases).toBe(before.contactAliases)
    expect(after.contacts).toBe(before.contacts)
    expect(after.graphNodes).toBe(before.graphNodes)
    expect(after.graphEdges).toBe(before.graphEdges)
    expect(after.graphEdgeSources).toBe(before.graphEdgeSources)
    expect(after.journalCount).toBe(before.journalCount)
    // The node is NOT re-keyed onto the contact — the bind fully rolled back.
    expect(getKnowledgeGraphStore().getNode(person)!.norm_key).toBe('jiarabi')
  })

  it('renameGraphEntity (contact scope): rolls back the contact rename AND the graph label refresh when the graph phase throws', async () => {
    seedContact('c-yar', 'Jiarabi')
    const { person } = seedGraph({ personLabel: 'Jiarabi', contactId: 'c-yar' })
    const before = snap()

    const { spy, fired } = injectGraphFault(/UPDATE\s+graph_nodes\s+SET\s+label/i)
    try {
      expect(() => renameGraphEntity(person, 'Yaraví')).toThrow(/injected fault/)
    } finally {
      spy.mockRestore()
    }
    expect(fired()).toBe(true)

    const after = snap()
    // The contact name did NOT change (updateContact ran first, then rolled back with the graph).
    expect(getContactById('c-yar')!.name).toBe('Jiarabi')
    expect(after.contacts).toBe(before.contacts)
    expect(after.graphNodes).toBe(before.graphNodes)
    expect(after.contactAliases).toBe(before.contactAliases)
    expect(after.graphEdges).toBe(before.graphEdges)
    expect(after.graphEdgeSources).toBe(before.graphEdgeSources)
    expect(after.journalCount).toBe(before.journalCount)
    // The graph node label is unchanged (the display refresh rolled back too).
    expect(getKnowledgeGraphStore().getNode(person)!.label).toBe('Jiarabi')
  })

  it('happy path: convertNodeToContact commits BOTH the contact create AND the graph re-key + alias', async () => {
    const { person } = seedGraph({ personLabel: 'Jiarabi' })
    const before = snap()

    const res = convertNodeToContact(person)
    expect(res.reusedExisting).toBe(false)

    // Relational layer committed: a new contact + its sovereign manual alias.
    const contact = getContactByName('Jiarabi')
    expect(contact).toBeTruthy()
    expect(res.contactId).toBe(contact!.id)
    expect(getContactAliases(contact!.id).some((a) => a.alias === 'jiarabi')).toBe(true)
    // Graph layer committed: the node is re-keyed onto the contact identity.
    expect(getKnowledgeGraphStore().getNode(res.nodeId)!.norm_key).toBe(`contact:${contact!.id}`)
    // The commit actually changed state (guards against a no-op false positive).
    expect(snap().contacts).not.toBe(before.contacts)
  })
})

// ---------------------------------------------------------------------------
// ADV55-1 (round-57): the People-UI + org-reconciler contact-merge paths fold the
// graph identity ATOMICALLY. Before, they called bare mergeContacts and depended on
// the post-commit `entity:contact-changed` name event to fold the graph — but F18
// person nodes are keyed `contact:<id>`, so graph-sync's NAME resolver no-oped and
// the loser's node/edges/graph_edge_sources stayed stranded under the DELETED loser
// contact id. mergeContactsWithGraph resolves both nodes by CONTACT ID and folds them
// inside the same transaction as the relational merge (shared core with the inspector
// path). The org-reconciler dedup path is routed through the SAME composite.
// ---------------------------------------------------------------------------
describe('Context Graph contact-merge graph fold (ADV55-1 / round-57)', () => {
  /** Snapshot every table the composite touches, ordered for byte-identity. */
  function snapshot() {
    return {
      contacts: JSON.stringify(queryAll('SELECT * FROM contacts ORDER BY id')),
      contactAliases: JSON.stringify(queryAll('SELECT * FROM contact_aliases ORDER BY id')),
      graphNodes: JSON.stringify(queryAll('SELECT * FROM graph_nodes ORDER BY id')),
      graphEdges: JSON.stringify(queryAll('SELECT * FROM graph_edges ORDER BY id')),
      graphEdgeSources: JSON.stringify(
        queryAll('SELECT * FROM graph_edge_sources ORDER BY edge_id, recording_id, transcript_id')
      ),
      meetingContacts: JSON.stringify(queryAll('SELECT * FROM meeting_contacts ORDER BY meeting_id, contact_id')),
      journalCount: queryAll<{ c: number }>('SELECT COUNT(*) AS c FROM merge_journal')[0]?.c ?? 0,
    }
  }

  /**
   * Seed keeper c-a + loser c-b as VISIBLE linked contacts, each with a `contact:<id>`
   * person node, plus a loser-only graph edge (with provenance) and a loser-only
   * meeting membership — so a stranded fold is observable as an orphan node/edge/row.
   */
  function seedContactKeyed() {
    seedContact('c-a', 'Bob')
    seedContact('c-b', 'Robert')
    const { person: keeper } = seedGraph({ personLabel: 'Bob', contactId: 'c-a' })
    const store = getKnowledgeGraphStore()
    const loser = store.upsertNode({
      type: 'person',
      label: 'Robert',
      key: 'contact:c-b',
      props: { contactId: 'c-b' },
      now: '2026-01-01',
    })
    const m = store.upsertNode({ type: 'meeting', label: 'Extra', props: { meetingId: 'mx', date: '2026-01-05' }, now: '2026-01-01' })
    const eLoser = store.upsertEdge({ sourceId: loser, targetId: m, type: 'ATTENDED', now: '2026-01-01' })
    dbRun(
      'INSERT OR IGNORE INTO graph_edge_sources (edge_id, recording_id, transcript_id, assertion_count, created_at) VALUES (?, ?, ?, 1, ?)',
      [eLoser, 'rec-seed', 'tx-seed', '2026-01-01']
    )
    dbRun('INSERT OR IGNORE INTO meetings (id, subject, start_time, end_time) VALUES (?, ?, ?, ?)', [
      'mtg-loser',
      'Loser Sync',
      '2026-01-05T00:00:00.000Z',
      '2026-01-05T01:00:00.000Z',
    ])
    dbRun('INSERT OR IGNORE INTO meeting_contacts (meeting_id, contact_id, role) VALUES (?, ?, ?)', [
      'mtg-loser',
      'c-b',
      'attendee',
    ])
    return { keeper, loser, m, eLoser, store }
  }

  it('contact-keyed SUCCESS: the People-merge path folds the loser NODE + provenance onto the keeper (no strand)', async () => {
    const { keeper, loser, m, eLoser, store } = seedContactKeyed()
    const before = snapshot()

    // The People-UI entry point (what contacts:merge now calls).
    const merged = mergeContactsWithGraph('c-a', 'c-b')
    expect(merged.id).toBe('c-a')

    // Relational layer: loser contact gone, keeper survives, journal grew by one.
    expect(getContactById('c-b')).toBeUndefined()
    expect(getContactById('c-a')).toBeTruthy()
    expect(snapshot().journalCount).toBe(before.journalCount + 1)
    // Loser membership repointed to the keeper (relational fold).
    expect(queryAll<{ contact_id: string }>('SELECT contact_id FROM meeting_contacts WHERE meeting_id = ?', ['mtg-loser'])).toEqual([
      { contact_id: 'c-a' },
    ])

    // Graph layer — the fix: the loser NODE is folded into the keeper, NOT stranded.
    expect(store.getNode(loser)).toBeUndefined()
    expect(store.getNode(keeper)).toBeTruthy()
    // The loser's edge was repointed onto the keeper node (id preserved by the UPDATE).
    const edge = queryAll<{ source_id: string; target_id: string }>('SELECT source_id, target_id FROM graph_edges WHERE id = ?', [eLoser])
    expect(edge).toEqual([{ source_id: keeper, target_id: m }])
    // Its per-recording provenance rode along (nothing stranded under the loser).
    expect(queryAll('SELECT edge_id FROM graph_edge_sources WHERE edge_id = ?', [eLoser])).toHaveLength(1)
    // No graph node still keyed to the deleted loser contact id.
    expect(queryAll("SELECT id FROM graph_nodes WHERE norm_key = 'contact:c-b'")).toHaveLength(0)
  })

  it('graph-phase FAILURE: a throw in the graph fold rolls BOTH layers back (byte-identical)', async () => {
    const { keeper, loser, store } = seedContactKeyed()
    const before = snapshot()

    // Inject a one-shot fault into the GRAPH phase only: throw on the loser-node
    // delete, which mergeNodes runs LAST — AFTER mergeContacts already ran within the
    // shared transaction. mergeContacts uses the app-level run() (not store.db.run),
    // so this spy lands strictly in the graph surgery.
    const origRun = store.db.run.bind(store.db)
    let fired = false
    const spy = vi.spyOn(store.db, 'run').mockImplementation((sql: string, params?: unknown[]) => {
      if (!fired && /DELETE\s+FROM\s+graph_nodes/i.test(sql)) {
        fired = true
        throw new Error('injected fault: graph_nodes delete')
      }
      return origRun(sql, params)
    })

    try {
      expect(() => mergeContactsWithGraph('c-a', 'c-b')).toThrow(/injected fault/)
    } finally {
      spy.mockRestore()
    }
    expect(fired).toBe(true)

    const after = snapshot()
    // Whole composite rolled back: loser contact + node SURVIVE, journal untouched,
    // and every touched table is byte-identical to the pre-merge snapshot.
    expect(getContactById('c-b')).toBeTruthy()
    expect(getContactById('c-a')).toBeTruthy()
    expect(store.getNode(loser)).toBeTruthy()
    expect(store.getNode(keeper)).toBeTruthy()
    expect(after.contacts).toBe(before.contacts)
    expect(after.contactAliases).toBe(before.contactAliases)
    expect(after.meetingContacts).toBe(before.meetingContacts)
    expect(after.journalCount).toBe(before.journalCount)
    expect(after.graphNodes).toBe(before.graphNodes)
    expect(after.graphEdges).toBe(before.graphEdges)
    expect(after.graphEdgeSources).toBe(before.graphEdgeSources)
  })

  it('no-node graceful case: a loser with NO person node still merges (fold is a no-op)', async () => {
    seedContact('c-a', 'Bob')
    seedContact('c-b', 'Robert')
    // Keeper has a contact-keyed node; the loser has NO backing person node at all.
    const { person: keeper } = seedGraph({ personLabel: 'Bob', contactId: 'c-a' })
    const store = getKnowledgeGraphStore()

    expect(() => mergeContactsWithGraph('c-a', 'c-b')).not.toThrow()

    // Contact merge still happened; the keeper node is untouched (nothing to fold).
    expect(getContactById('c-b')).toBeUndefined()
    expect(getContactById('c-a')).toBeTruthy()
    expect(store.getNode(keeper)).toBeTruthy()
  })

  it('org-reconciler dedup path folds the graph node through the SAME composite', async () => {
    // Two same-name, structurally-visible contacts (source='user') → the name-group
    // collapse in mergeDuplicateContacts folds them via mergeContactsWithGraph.
    seedContact('c-a', 'Sam')
    seedContact('c-b', 'Sam')
    const store = getKnowledgeGraphStore()
    const nodeA = store.upsertNode({ type: 'person', label: 'Sam', key: 'contact:c-a', props: { contactId: 'c-a' }, now: '2026-01-01' })
    const nodeB = store.upsertNode({ type: 'person', label: 'Sam', key: 'contact:c-b', props: { contactId: 'c-b' }, now: '2026-01-01' })
    const m = store.upsertNode({ type: 'meeting', label: 'Sync', props: { meetingId: 'ms', date: '2026-01-05' }, now: '2026-01-01' })
    const eA = store.upsertEdge({ sourceId: nodeA, targetId: m, type: 'ATTENDED', now: '2026-01-01' })
    const eB = store.upsertEdge({ sourceId: nodeB, targetId: m, type: 'ATTENDED', now: '2026-01-01' })
    for (const e of [eA, eB]) {
      dbRun('INSERT OR IGNORE INTO graph_edge_sources (edge_id, recording_id, transcript_id, assertion_count, created_at) VALUES (?, ?, ?, 1, ?)', [e, 'rec-seed', 'tx-seed', '2026-01-01'])
    }

    const removed = mergeDuplicateContacts()
    expect(removed).toBe(1)

    // Exactly one 'Sam' contact remains, and exactly one contact-keyed person node —
    // the loser node was folded (not left stranded under a deleted contact).
    const survivors = queryAll<{ id: string }>("SELECT id FROM contacts WHERE name = 'Sam'")
    expect(survivors).toHaveLength(1)
    const survivorId = survivors[0].id
    const personNodes = queryAll<{ norm_key: string }>("SELECT norm_key FROM graph_nodes WHERE type = 'person'")
    expect(personNodes).toEqual([{ norm_key: `contact:${survivorId}` }])
    // No node keyed to the folded-away contact id survives.
    const goneId = survivorId === 'c-a' ? 'c-b' : 'c-a'
    expect(queryAll(`SELECT id FROM graph_nodes WHERE norm_key = 'contact:${goneId}'`)).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// ADV56-3 (round-58): the project-merge paths fold the NAME-KEYED project graph
// node ATOMICALLY. Before, projects:merge (and the suggestion project branch) called
// relational-only mergeProjects, which deletes the loser project WITHOUT folding its
// name-keyed graph node — so the loser's project node + edges + graph_edge_sources
// stayed reachable under a project that no longer existed relationally.
// mergeProjectsWithGraph resolves BOTH project nodes by NAME and folds them inside the
// same transaction as the relational merge.
// ---------------------------------------------------------------------------
describe('Context Graph project-merge graph fold (ADV56-3 / round-58)', () => {
  function snapshot() {
    return {
      projects: JSON.stringify(queryAll('SELECT * FROM projects ORDER BY id')),
      projectAliases: JSON.stringify(queryAll('SELECT * FROM project_aliases ORDER BY id')),
      graphNodes: JSON.stringify(queryAll('SELECT * FROM graph_nodes ORDER BY id')),
      graphEdges: JSON.stringify(queryAll('SELECT * FROM graph_edges ORDER BY id')),
      graphEdgeSources: JSON.stringify(
        queryAll('SELECT * FROM graph_edge_sources ORDER BY edge_id, recording_id, transcript_id')
      ),
      meetingProjects: JSON.stringify(queryAll('SELECT * FROM meeting_projects ORDER BY meeting_id, project_id')),
      journalCount: queryAll<{ c: number }>('SELECT COUNT(*) AS c FROM merge_journal')[0]?.c ?? 0,
    }
  }

  function seedProject(id: string, name: string) {
    dbRun(
      "INSERT OR IGNORE INTO projects (id, name, status, created_at) VALUES (?, ?, 'active', ?)",
      [id, name, '2026-01-01']
    )
  }

  /**
   * Seed keeper p-a (name 'Apollo') + loser p-b (name 'Artemis') as projects, each with
   * a NAME-KEYED project graph node, plus a loser-only graph edge (with provenance) and a
   * loser-only meeting membership — so a stranded fold is observable as an orphan.
   */
  function seedProjectKeyed() {
    seedProject('p-a', 'Apollo')
    seedProject('p-b', 'Artemis')
    dbRun('INSERT OR IGNORE INTO recordings (id, filename, date_recorded) VALUES (?, ?, ?)', [
      'rec-seed', 'rec-seed.hda', '2026-01-01',
    ])
    const store = getKnowledgeGraphStore()
    const keeper = store.upsertNode({ type: 'project', label: 'Apollo', now: '2026-01-01' })
    const loser = store.upsertNode({ type: 'project', label: 'Artemis', now: '2026-01-01' })
    const m = store.upsertNode({ type: 'meeting', label: 'Extra', props: { meetingId: 'mx', date: '2026-01-05' }, now: '2026-01-01' })
    const eLoser = store.upsertEdge({ sourceId: m, targetId: loser, type: 'ABOUT', now: '2026-01-01' })
    dbRun(
      'INSERT OR IGNORE INTO graph_edge_sources (edge_id, recording_id, transcript_id, assertion_count, created_at) VALUES (?, ?, ?, 1, ?)',
      [eLoser, 'rec-seed', 'tx-seed', '2026-01-01']
    )
    dbRun('INSERT OR IGNORE INTO meetings (id, subject, start_time, end_time) VALUES (?, ?, ?, ?)', [
      'mtg-loser', 'Loser Sync', '2026-01-05T00:00:00.000Z', '2026-01-05T01:00:00.000Z',
    ])
    dbRun('INSERT OR IGNORE INTO meeting_projects (meeting_id, project_id) VALUES (?, ?)', ['mtg-loser', 'p-b'])
    return { keeper, loser, m, eLoser, store }
  }

  it('name-keyed SUCCESS: the project-merge path folds the loser NODE + provenance onto the keeper (no strand)', async () => {
    const { keeper, loser, m, eLoser, store } = seedProjectKeyed()
    const before = snapshot()

    const merged = mergeProjectsWithGraph('p-a', 'p-b')
    expect(merged.id).toBe('p-a')

    // Relational layer: loser project gone, keeper survives, journal grew by one.
    expect(queryAll("SELECT id FROM projects WHERE id = 'p-b'")).toHaveLength(0)
    expect(queryAll("SELECT id FROM projects WHERE id = 'p-a'")).toHaveLength(1)
    expect(snapshot().journalCount).toBe(before.journalCount + 1)
    // Loser membership repointed to the keeper (relational fold).
    expect(queryAll<{ project_id: string }>('SELECT project_id FROM meeting_projects WHERE meeting_id = ?', ['mtg-loser'])).toEqual([
      { project_id: 'p-a' },
    ])

    // Graph layer — the fix: the loser NODE is folded into the keeper, NOT stranded.
    expect(store.getNode(loser)).toBeUndefined()
    expect(store.getNode(keeper)).toBeTruthy()
    // The loser's edge was repointed onto the keeper node (id preserved by the UPDATE).
    const edge = queryAll<{ source_id: string; target_id: string }>('SELECT source_id, target_id FROM graph_edges WHERE id = ?', [eLoser])
    expect(edge).toEqual([{ source_id: m, target_id: keeper }])
    // Its per-recording provenance rode along (nothing stranded under the loser).
    expect(queryAll('SELECT edge_id FROM graph_edge_sources WHERE edge_id = ?', [eLoser])).toHaveLength(1)
    // Exactly one project node remains — the keeper. No node stranded under the loser name.
    expect(queryAll("SELECT id FROM graph_nodes WHERE type = 'project'")).toEqual([{ id: keeper }])
  })

  it('graph-phase FAILURE: a throw in the graph fold rolls BOTH layers back (byte-identical)', async () => {
    const { keeper, loser, store } = seedProjectKeyed()
    const before = snapshot()

    // Inject a one-shot fault into the GRAPH phase only: throw on the loser-node delete,
    // which mergeNodes runs LAST — AFTER mergeProjects already ran in the shared tx.
    const origRun = store.db.run.bind(store.db)
    let fired = false
    const spy = vi.spyOn(store.db, 'run').mockImplementation((sql: string, params?: unknown[]) => {
      if (!fired && /DELETE\s+FROM\s+graph_nodes/i.test(sql)) {
        fired = true
        throw new Error('injected fault: graph_nodes delete')
      }
      return origRun(sql, params)
    })

    try {
      expect(() => mergeProjectsWithGraph('p-a', 'p-b')).toThrow(/injected fault/)
    } finally {
      spy.mockRestore()
    }
    expect(fired).toBe(true)

    const after = snapshot()
    // Whole composite rolled back: loser project + node SURVIVE, journal untouched,
    // and every touched table is byte-identical to the pre-merge snapshot.
    expect(queryAll("SELECT id FROM projects WHERE id = 'p-b'")).toHaveLength(1)
    expect(queryAll("SELECT id FROM projects WHERE id = 'p-a'")).toHaveLength(1)
    expect(store.getNode(loser)).toBeTruthy()
    expect(store.getNode(keeper)).toBeTruthy()
    expect(after.projects).toBe(before.projects)
    expect(after.projectAliases).toBe(before.projectAliases)
    expect(after.meetingProjects).toBe(before.meetingProjects)
    expect(after.journalCount).toBe(before.journalCount)
    expect(after.graphNodes).toBe(before.graphNodes)
    expect(after.graphEdges).toBe(before.graphEdges)
    expect(after.graphEdgeSources).toBe(before.graphEdgeSources)
  })

  it('no-node graceful case: a loser project with NO graph node still merges (fold is a no-op)', async () => {
    seedProject('p-a', 'Apollo')
    seedProject('p-b', 'Artemis')
    const store = getKnowledgeGraphStore()
    // Only the keeper has a project node; the loser has NO backing project node at all.
    const keeper = store.upsertNode({ type: 'project', label: 'Apollo', now: '2026-01-01' })

    expect(() => mergeProjectsWithGraph('p-a', 'p-b')).not.toThrow()

    expect(queryAll("SELECT id FROM projects WHERE id = 'p-b'")).toHaveLength(0)
    expect(queryAll("SELECT id FROM projects WHERE id = 'p-a'")).toHaveLength(1)
    expect(store.getNode(keeper)).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// ADV56-1 (round-58): identity:acceptSuggestion, for a RESOLVABLE loser, now routes
// through the graph-aware, atomic composite (acceptIdentitySuggestionWithGraph). Before,
// it called bare mergeContacts/mergeProjects (stranding the graph) AND committed the
// merge in one transaction with the supersede + status='accepted' in a SEPARATE one —
// a failure in the second left the identity merged but the suggestion pending. Now the
// merge (graph-aware) + journal capture + supersede + status write are ONE transaction.
// ---------------------------------------------------------------------------
describe('Context Graph accept-suggestion graph fold + atomicity (ADV56-1 / round-58)', () => {
  function seedSuggestion(
    id: string,
    kind: 'person' | 'project',
    candidateName: string,
    targetId: string,
    evidence: Record<string, unknown>
  ) {
    dbRun(
      `INSERT INTO identity_suggestions (id, kind, candidate_name, target_id, confidence, evidence, status, created_at)
       VALUES (?, ?, ?, ?, 0.82, ?, 'pending', '2026-01-01T00:00:00Z')`,
      [id, kind, candidateName, targetId, JSON.stringify(evidence)]
    )
  }

  function seedContactPair() {
    seedContact('c-a', 'Bob')
    seedContact('c-b', 'Robert')
    const { person: keeper } = seedGraph({ personLabel: 'Bob', contactId: 'c-a' })
    const store = getKnowledgeGraphStore()
    const loser = store.upsertNode({ type: 'person', label: 'Robert', key: 'contact:c-b', props: { contactId: 'c-b' }, now: '2026-01-01' })
    const m = store.upsertNode({ type: 'meeting', label: 'Extra', props: { meetingId: 'mx', date: '2026-01-05' }, now: '2026-01-01' })
    const eLoser = store.upsertEdge({ sourceId: loser, targetId: m, type: 'ATTENDED', now: '2026-01-01' })
    dbRun('INSERT OR IGNORE INTO graph_edge_sources (edge_id, recording_id, transcript_id, assertion_count, created_at) VALUES (?, ?, ?, 1, ?)', [eLoser, 'rec-seed', 'tx-seed', '2026-01-01'])
    return { keeper, loser, eLoser, store }
  }

  function seedProjectPair() {
    dbRun("INSERT OR IGNORE INTO projects (id, name, status, created_at) VALUES ('p-a', 'Apollo', 'active', '2026-01-01')", [])
    dbRun("INSERT OR IGNORE INTO projects (id, name, status, created_at) VALUES ('p-b', 'Artemis', 'active', '2026-01-01')", [])
    dbRun('INSERT OR IGNORE INTO recordings (id, filename, date_recorded) VALUES (?, ?, ?)', ['rec-seed', 'rec-seed.hda', '2026-01-01'])
    const store = getKnowledgeGraphStore()
    const keeper = store.upsertNode({ type: 'project', label: 'Apollo', now: '2026-01-01' })
    const loser = store.upsertNode({ type: 'project', label: 'Artemis', now: '2026-01-01' })
    const m = store.upsertNode({ type: 'meeting', label: 'Extra', props: { meetingId: 'mx', date: '2026-01-05' }, now: '2026-01-01' })
    const eLoser = store.upsertEdge({ sourceId: m, targetId: loser, type: 'ABOUT', now: '2026-01-01' })
    dbRun('INSERT OR IGNORE INTO graph_edge_sources (edge_id, recording_id, transcript_id, assertion_count, created_at) VALUES (?, ?, ?, 1, ?)', [eLoser, 'rec-seed', 'tx-seed', '2026-01-01'])
    return { keeper, loser, eLoser, store }
  }

  it('person SUCCESS: folds the loser NODE, marks accepted, supersedes the sibling', async () => {
    const { keeper, loser, eLoser, store } = seedContactPair()
    // Accepted pairing: fold c-b into c-a.
    seedSuggestion('sug-1', 'person', 'Robert', 'c-a', { loserId: 'c-b' })
    // Sibling: another pending suggestion targeting the soon-deleted loser c-b.
    seedSuggestion('sug-2', 'person', 'Rob', 'c-b', {})

    const res = acceptIdentitySuggestionWithGraph('sug-1')
    expect(res.status).toBe('accepted')
    expect(res.mergeJournalId).toBeTruthy()
    expect(res.supersededCount).toBe(1)

    // Relational: loser gone, suggestion accepted, sibling superseded (rejected).
    expect(getContactById('c-b')).toBeUndefined()
    expect(queryAll<{ status: string }>("SELECT status FROM identity_suggestions WHERE id = 'sug-1'")).toEqual([{ status: 'accepted' }])
    expect(queryAll<{ status: string }>("SELECT status FROM identity_suggestions WHERE id = 'sug-2'")).toEqual([{ status: 'rejected' }])

    // Graph: loser node folded (not stranded), its edge repointed onto the keeper.
    expect(store.getNode(loser)).toBeUndefined()
    expect(store.getNode(keeper)).toBeTruthy()
    expect(queryAll<{ source_id: string }>('SELECT source_id FROM graph_edges WHERE id = ?', [eLoser])).toEqual([{ source_id: keeper }])
    expect(queryAll("SELECT id FROM graph_nodes WHERE norm_key = 'contact:c-b'")).toHaveLength(0)
  })

  it('person ATOMICITY: a fault in the status/supersede phase rolls the WHOLE accept back', async () => {
    const { keeper, loser } = seedContactPair()
    seedSuggestion('sug-1', 'person', 'Robert', 'c-a', { loserId: 'c-b' })
    seedSuggestion('sug-2', 'person', 'Rob', 'c-b', {})
    const store = getKnowledgeGraphStore()

    // Inject a fault into the finalize (status/supersede) phase, which runs AFTER the
    // graph-aware merge inside the wrapper's single transaction.
    const spy = vi.spyOn(database, 'finalizeAcceptedMerge').mockImplementation(() => {
      throw new Error('injected fault: finalize phase')
    })
    try {
      expect(() => acceptIdentitySuggestionWithGraph('sug-1')).toThrow(/injected fault/)
    } finally {
      spy.mockRestore()
    }

    // Whole accept rolled back: contact NOT merged, loser node intact, suggestion pending,
    // no journal row written.
    expect(getContactById('c-b')).toBeTruthy()
    expect(getContactById('c-a')).toBeTruthy()
    expect(store.getNode(loser)).toBeTruthy()
    expect(store.getNode(keeper)).toBeTruthy()
    expect(queryAll<{ status: string }>("SELECT status FROM identity_suggestions WHERE id = 'sug-1'")).toEqual([{ status: 'pending' }])
    expect(queryAll<{ status: string }>("SELECT status FROM identity_suggestions WHERE id = 'sug-2'")).toEqual([{ status: 'pending' }])
    expect(queryAll<{ c: number }>('SELECT COUNT(*) AS c FROM merge_journal')[0]?.c ?? 0).toBe(0)
  })

  it('project SUCCESS: folds the loser project NODE, marks accepted', async () => {
    const { keeper, loser, eLoser, store } = seedProjectPair()
    seedSuggestion('sug-p', 'project', 'Artemis', 'p-a', { loserId: 'p-b' })

    const res = acceptIdentitySuggestionWithGraph('sug-p')
    expect(res.status).toBe('accepted')
    expect(res.mergeJournalId).toBeTruthy()

    expect(queryAll("SELECT id FROM projects WHERE id = 'p-b'")).toHaveLength(0)
    expect(store.getNode(loser)).toBeUndefined()
    expect(store.getNode(keeper)).toBeTruthy()
    expect(queryAll<{ target_id: string }>('SELECT target_id FROM graph_edges WHERE id = ?', [eLoser])).toEqual([{ target_id: keeper }])
    expect(queryAll("SELECT id FROM graph_nodes WHERE type = 'project'")).toEqual([{ id: keeper }])
  })

  it('project ATOMICITY: a fault in the status/supersede phase rolls the WHOLE accept back', async () => {
    const { keeper, loser } = seedProjectPair()
    seedSuggestion('sug-p', 'project', 'Artemis', 'p-a', { loserId: 'p-b' })
    const store = getKnowledgeGraphStore()

    const spy = vi.spyOn(database, 'finalizeAcceptedMerge').mockImplementation(() => {
      throw new Error('injected fault: finalize phase')
    })
    try {
      expect(() => acceptIdentitySuggestionWithGraph('sug-p')).toThrow(/injected fault/)
    } finally {
      spy.mockRestore()
    }

    expect(queryAll("SELECT id FROM projects WHERE id = 'p-b'")).toHaveLength(1)
    expect(store.getNode(loser)).toBeTruthy()
    expect(store.getNode(keeper)).toBeTruthy()
    expect(queryAll<{ status: string }>("SELECT status FROM identity_suggestions WHERE id = 'sug-p'")).toEqual([{ status: 'pending' }])
    expect(queryAll<{ c: number }>('SELECT COUNT(*) AS c FROM merge_journal')[0]?.c ?? 0).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// ADV56-2 (round-58): a merge folds the loser's graph node into the keeper (mergeNodes
// deletes the loser node and transfers its edges/provenance). unmerge restored ONLY the
// relational state, so the recreated loser had NO graph node and its history stayed
// attributed to the keeper — while undo reported SUCCESS. The merge now SNAPSHOTS the
// loser's pre-fold subgraph into the journal manifest, and unmerge reconstructs it
// EXACTLY (recreate loser node, restore its edges + provenance, and subtract from the
// keeper exactly what the fold transferred in). Proven with merge→unmerge byte-identity.
// ---------------------------------------------------------------------------
describe('Context Graph merge→unmerge graph round-trip (ADV56-2 / round-58)', () => {
  /** Full snapshot of the graph + entity tables (merge_journal excluded — it legitimately
   *  keeps an undone bookkeeping row after unmerge). Ordered for byte-identity. */
  function graphSnap() {
    return {
      graphNodes: JSON.stringify(queryAll('SELECT * FROM graph_nodes ORDER BY id')),
      graphEdges: JSON.stringify(queryAll('SELECT * FROM graph_edges ORDER BY id')),
      graphEdgeSources: JSON.stringify(
        queryAll('SELECT * FROM graph_edge_sources ORDER BY edge_id, recording_id, transcript_id')
      ),
      contacts: JSON.stringify(queryAll('SELECT * FROM contacts ORDER BY id')),
      contactAliases: JSON.stringify(queryAll('SELECT * FROM contact_aliases ORDER BY id')),
      meetingContacts: JSON.stringify(queryAll('SELECT * FROM meeting_contacts ORDER BY meeting_id, contact_id')),
      projects: JSON.stringify(queryAll('SELECT * FROM projects ORDER BY id')),
      meetingProjects: JSON.stringify(queryAll('SELECT * FROM meeting_projects ORDER BY meeting_id, project_id')),
    }
  }

  function addEdgeSource(edgeId: string, rec: string, tx: string, count: number) {
    dbRun(
      'INSERT OR IGNORE INTO graph_edge_sources (edge_id, recording_id, transcript_id, assertion_count, created_at) VALUES (?, ?, ?, ?, ?)',
      [edgeId, rec, tx, count, '2026-01-01']
    )
  }

  it('contacts: merge→unmerge restores the graph BYTE-IDENTICALLY (collision + non-colliding + loser-only source)', async () => {
    seedContact('c-a', 'Bob')
    seedContact('c-b', 'Robert')
    dbRun('INSERT OR IGNORE INTO recordings (id, filename, date_recorded) VALUES (?, ?, ?)', ['rec-seed', 'rec-seed.hda', '2026-01-01'])
    // ADV57-1 (round-59): reverseGraphFold now refuses snapshot sources whose recording
    // no longer exists (belt-and-suspenders against post-purge resurrection). Every
    // sourcing recording this fixture references must therefore be a real recordings row
    // (they always are in reality) — otherwise the harden path would treat 'rec-loser'
    // like a purged recording and skip it. Byte-identity is unaffected (graphSnap ignores recordings).
    dbRun('INSERT OR IGNORE INTO recordings (id, filename, date_recorded) VALUES (?, ?, ?)', ['rec-loser', 'rec-loser.hda', '2026-01-01'])
    const store = getKnowledgeGraphStore()
    const K = store.upsertNode({ type: 'person', label: 'Bob', key: 'contact:c-a', props: { contactId: 'c-a' }, now: '2026-01-01' })
    const L = store.upsertNode({ type: 'person', label: 'Robert', key: 'contact:c-b', props: { contactId: 'c-b' }, now: '2026-01-01' })
    const M = store.upsertNode({ type: 'meeting', label: 'Shared', props: { meetingId: 'ms', date: '2026-01-05' }, now: '2026-01-01' })
    const M2 = store.upsertNode({ type: 'meeting', label: 'LoserOnly', props: { meetingId: 'ml', date: '2026-01-06' }, now: '2026-01-01' })
    // Colliding pair: both K and L attend M. Keeper edge ek, loser edge el.
    const ek = store.upsertEdge({ sourceId: K, targetId: M, type: 'ATTENDED', now: '2026-01-01' })
    const el = store.upsertEdge({ sourceId: L, targetId: M, type: 'ATTENDED', now: '2026-01-01' })
    // Non-colliding loser edge (repointed on fold, id preserved): L attends M2.
    const el2 = store.upsertEdge({ sourceId: L, targetId: M2, type: 'ATTENDED', now: '2026-01-01' })
    // ek: one shared source. el: same shared source (sums on transfer) + a loser-only source
    // (a brand-new keeper row that must be DELETED on unmerge). el2: its own source.
    addEdgeSource(ek, 'rec-seed', 'tx-shared', 1)
    addEdgeSource(el, 'rec-seed', 'tx-shared', 1)
    addEdgeSource(el, 'rec-loser', 'tx-loser', 2)
    addEdgeSource(el2, 'rec-seed', 'tx-m2', 1)
    // A loser-only relational membership (repoints on merge, comes back on unmerge).
    dbRun('INSERT OR IGNORE INTO meetings (id, subject, start_time, end_time) VALUES (?, ?, ?, ?)', ['mtg-loser', 'LoserSync', '2026-01-05', '2026-01-05'])
    dbRun('INSERT OR IGNORE INTO meeting_contacts (meeting_id, contact_id, role) VALUES (?, ?, ?)', ['mtg-loser', 'c-b', 'attendee'])

    const before = graphSnap()

    mergeContactsWithGraph('c-a', 'c-b')
    // Sanity: the fold really happened (loser node gone, journal has a graph snapshot).
    expect(store.getNode(L)).toBeUndefined()
    const journal = database.getMergeJournal('contact', 'c-a')
    expect(journal).toHaveLength(1)

    const undo = database.unmergeContacts(journal[0].id)
    expect(undo.loserId).toBe('c-b')

    const after = graphSnap()
    // The ADV56-2 deliverable: the GRAPH is restored byte-identically — loser node back,
    // its colliding edge's shared source restored to count 1, the loser-only transferred
    // source deleted off the keeper, the non-colliding edge repointed back, weights exact.
    expect(after.graphNodes).toBe(before.graphNodes)
    expect(after.graphEdges).toBe(before.graphEdges)
    expect(after.graphEdgeSources).toBe(before.graphEdgeSources)
    // Loser node + its backing contact are back; the fold left nothing under the keeper.
    expect(store.getNode(L)).toBeTruthy()
    expect(getContactById('c-b')).toBeTruthy()
    // Relational aliases + memberships round-trip (contacts.source/meeting_count are a
    // separate pre-existing relational-unmerge gap, out of scope for the graph fix).
    expect(after.contactAliases).toBe(before.contactAliases)
    expect(after.meetingContacts).toBe(before.meetingContacts)
  })

  it('projects: merge→unmerge restores the graph BYTE-IDENTICALLY (collision + non-colliding)', async () => {
    dbRun("INSERT OR IGNORE INTO projects (id, name, status, created_at) VALUES ('p-a', 'Apollo', 'active', '2026-01-01')", [])
    dbRun("INSERT OR IGNORE INTO projects (id, name, status, created_at) VALUES ('p-b', 'Artemis', 'active', '2026-01-01')", [])
    dbRun('INSERT OR IGNORE INTO recordings (id, filename, date_recorded) VALUES (?, ?, ?)', ['rec-seed', 'rec-seed.hda', '2026-01-01'])
    // ADV57-1 (round-59): reverseGraphFold refuses snapshot sources whose recording no
    // longer exists — 'rec-loser' must be a real recordings row (see the contacts test).
    dbRun('INSERT OR IGNORE INTO recordings (id, filename, date_recorded) VALUES (?, ?, ?)', ['rec-loser', 'rec-loser.hda', '2026-01-01'])
    const store = getKnowledgeGraphStore()
    const K = store.upsertNode({ type: 'project', label: 'Apollo', now: '2026-01-01' })
    const L = store.upsertNode({ type: 'project', label: 'Artemis', now: '2026-01-01' })
    const M = store.upsertNode({ type: 'meeting', label: 'Shared', props: { meetingId: 'ms', date: '2026-01-05' }, now: '2026-01-01' })
    const M2 = store.upsertNode({ type: 'meeting', label: 'LoserOnly', props: { meetingId: 'ml', date: '2026-01-06' }, now: '2026-01-01' })
    // Colliding: M ABOUT K and M ABOUT L. Non-colliding: M2 ABOUT L.
    const ek = store.upsertEdge({ sourceId: M, targetId: K, type: 'ABOUT', now: '2026-01-01' })
    const el = store.upsertEdge({ sourceId: M, targetId: L, type: 'ABOUT', now: '2026-01-01' })
    const el2 = store.upsertEdge({ sourceId: M2, targetId: L, type: 'ABOUT', now: '2026-01-01' })
    addEdgeSource(ek, 'rec-seed', 'tx-shared', 1)
    addEdgeSource(el, 'rec-seed', 'tx-shared', 1)
    addEdgeSource(el, 'rec-loser', 'tx-loser', 2)
    addEdgeSource(el2, 'rec-seed', 'tx-m2', 1)

    const before = graphSnap()

    mergeProjectsWithGraph('p-a', 'p-b')
    expect(store.getNode(L)).toBeUndefined()
    const journal = database.getMergeJournal('project', 'p-a')
    expect(journal).toHaveLength(1)

    const undo = database.unmergeProjects(journal[0].id)
    expect(undo.loserId).toBe('p-b')

    const after = graphSnap()
    expect(after.graphNodes).toBe(before.graphNodes)
    expect(after.graphEdges).toBe(before.graphEdges)
    expect(after.graphEdgeSources).toBe(before.graphEdgeSources)
    expect(after.projects).toBe(before.projects)
    expect(after.meetingProjects).toBe(before.meetingProjects)
  })
})

// ---------------------------------------------------------------------------
// ADV57-1 (round-59): round-58 journaled a full loser-subgraph snapshot so unmerge
// could reverse the graph fold. But a HARD PURGE (F17 permanent delete) of a
// recording R that occurs BETWEEN merge and unmerge scrubbed only the LIVE graph —
// the journal snapshot kept recoverable full-row copies of R's edges + edge_sources,
// so a later unmerge RE-INSERTED them, resurrecting traces of a permanently-deleted
// recording (and the retained manifest itself preserved recoverable data after a
// purge). The fix: the purge now scrubs R's contribution from every open journal
// snapshot IN THE SAME TRANSACTION (Part A), mirroring the live purge exactly, and
// reverseGraphFold refuses any snapshot source whose recording is gone (Part B).
// ---------------------------------------------------------------------------
describe('Context Graph merge → hard-purge → unmerge (ADV57-1 / round-59)', () => {
  function addEdgeSource(edgeId: string, rec: string, tx: string, count: number) {
    dbRun(
      'INSERT OR IGNORE INTO graph_edge_sources (edge_id, recording_id, transcript_id, assertion_count, created_at) VALUES (?, ?, ?, ?, ?)',
      [edgeId, rec, tx, count, '2026-01-01']
    )
  }
  function setWeight(edgeId: string, weight: number) {
    dbRun('UPDATE graph_edges SET weight = ? WHERE id = ?', [weight, edgeId])
  }
  function edgeSourcesFor(edgeId: string) {
    return queryAll<{ recording_id: string; transcript_id: string; assertion_count: number }>(
      'SELECT recording_id, transcript_id, assertion_count FROM graph_edge_sources WHERE edge_id = ? ORDER BY recording_id, transcript_id',
      [edgeId]
    )
  }
  function edgeRow(edgeId: string) {
    return queryOne<{ id: string; source_id: string; target_id: string; weight: number }>(
      'SELECT id, source_id, target_id, weight FROM graph_edges WHERE id = ?',
      [edgeId]
    )
  }
  // Purge a recording through the REAL deletion path: wire the same seam
  // registerRecordingDeletionHandlers wires at startup, then run the hard cascade
  // (which deletes the recordings row AND runs the graph + journal scrub in ONE tx).
  function hardPurge(recordingId: string) {
    database.setGraphProvenanceCleanup((rid, opts) => removeRecordingProvenanceCore(rid, opts))
    return database.deleteRecordingCascade(recordingId, { hard: true })
  }

  it('contacts: scrubs the purged recording from the journal snapshot; unmerge never resurrects it (selective, byte-consistent)', async () => {
    seedContact('c-a', 'Bob')
    seedContact('c-b', 'Robert')
    // rec-S survives; rec-R is hard-purged between merge and unmerge.
    dbRun('INSERT OR IGNORE INTO recordings (id, filename, date_recorded) VALUES (?, ?, ?)', ['rec-S', 'rec-S.hda', '2026-01-01'])
    dbRun('INSERT OR IGNORE INTO recordings (id, filename, date_recorded) VALUES (?, ?, ?)', ['rec-R', 'rec-R.hda', '2026-01-01'])
    const store = getKnowledgeGraphStore()
    const K = store.upsertNode({ type: 'person', label: 'Bob', key: 'contact:c-a', props: { contactId: 'c-a' }, now: '2026-01-01' })
    const L = store.upsertNode({ type: 'person', label: 'Robert', key: 'contact:c-b', props: { contactId: 'c-b' }, now: '2026-01-01' })
    const M1 = store.upsertNode({ type: 'meeting', label: 'Shared', props: { meetingId: 'm1', date: '2026-01-05' }, now: '2026-01-01' })
    const M2 = store.upsertNode({ type: 'meeting', label: 'LoserOnly', props: { meetingId: 'm2', date: '2026-01-06' }, now: '2026-01-01' })
    const Mc = store.upsertNode({ type: 'meeting', label: 'Collide', props: { meetingId: 'mc', date: '2026-01-07' }, now: '2026-01-01' })

    // el1: SHARED (S+R), non-colliding (no keeper edge to M1) → repoints on fold, keeps id.
    const el1 = store.upsertEdge({ sourceId: L, targetId: M1, type: 'ATTENDED', now: '2026-01-01' })
    addEdgeSource(el1, 'rec-S', 'tx-s', 1)
    addEdgeSource(el1, 'rec-R', 'tx-r', 1)
    setWeight(el1, 2)
    // el2: SOLE-SOURCE R → deleted by the purge; must NOT be resurrected by unmerge.
    const el2 = store.upsertEdge({ sourceId: L, targetId: M2, type: 'ATTENDED', now: '2026-01-01' })
    addEdgeSource(el2, 'rec-R', 'tx-r', 1)
    setWeight(el2, 1)
    // Collision pair: keeper ekc (S) + loser elc (S+R) both ATTEND Mc → elc folds into ekc.
    const ekc = store.upsertEdge({ sourceId: K, targetId: Mc, type: 'ATTENDED', now: '2026-01-01' })
    addEdgeSource(ekc, 'rec-S', 'tx-s', 1)
    setWeight(ekc, 1)
    const elc = store.upsertEdge({ sourceId: L, targetId: Mc, type: 'ATTENDED', now: '2026-01-01' })
    addEdgeSource(elc, 'rec-S', 'tx-s', 1)
    addEdgeSource(elc, 'rec-R', 'tx-r', 1)
    setWeight(elc, 2)

    mergeContactsWithGraph('c-a', 'c-b')
    expect(store.getNode(L)).toBeUndefined() // fold happened
    const journal = database.getMergeJournal('contact', 'c-a')
    expect(journal).toHaveLength(1)
    const journalId = journal[0].id

    // Hard-purge rec-R (scrubs live graph + journal snapshot in one transaction).
    const purge = hardPurge('rec-R')
    expect(purge?.mode).toBe('hard')

    // --- MANIFEST-AT-REST proof: the retained snapshot itself no longer contains any
    // edge_source referencing rec-R, and the sole-R edge is gone from it (not merely
    // filtered at unmerge time). This is Part A doing its job. ---
    const manifestRow = queryOne<{ repointed_manifest: string }>(
      'SELECT repointed_manifest FROM merge_journal WHERE id = ?',
      [journalId]
    )!
    const snap = JSON.parse(manifestRow.repointed_manifest).graph as {
      loserNode: { id: string } | null
      edges: Array<{ id: string; weight: number }>
      edgeSources: Array<{ edge_id: string; recording_id: string }>
    }
    expect(snap.edgeSources.some((s) => s.recording_id === 'rec-R')).toBe(false)
    expect(snap.edges.some((e) => e.id === el2)).toBe(false) // sole-R edge dropped from snapshot
    expect(snap.edgeSources.every((s) => s.recording_id === 'rec-S')).toBe(true)
    // Surviving shared edges kept with weight decremented by R's assertion sum (2-1=1).
    expect(snap.edges.find((e) => e.id === el1)?.weight).toBe(1)
    expect(snap.edges.find((e) => e.id === elc)?.weight).toBe(1)
    expect(snap.loserNode?.id).toBe(L) // loser node kept (retains surviving edges)

    // --- Unmerge and prove NO rec-R trace is resurrected anywhere. ---
    const undo = database.unmergeContacts(journalId)
    expect(undo.loserId).toBe('c-b')

    // (1) No graph_edge_sources referencing the purged recording exist anywhere.
    const rRows = queryAll('SELECT * FROM graph_edge_sources WHERE recording_id = ?', ['rec-R'])
    expect(rRows).toHaveLength(0)
    // (2) The sole-R edge stays deleted.
    expect(edgeRow(el2)).toBeUndefined()
    // (3) Loser node + backing contact restored (it retained surviving S provenance).
    expect(store.getNode(L)).toBeTruthy()
    expect(getContactById('c-b')).toBeTruthy()
    // (4) el1 split back to the loser with ONLY the surviving S source, weight 1.
    expect(edgeRow(el1)).toMatchObject({ source_id: L, target_id: M1, weight: 1 })
    expect(edgeSourcesFor(el1)).toEqual([{ recording_id: 'rec-S', transcript_id: 'tx-s', assertion_count: 1 }])
    // (5) The collided loser edge is reconstructed on the loser with only S, weight 1…
    expect(edgeRow(elc)).toMatchObject({ source_id: L, target_id: Mc, weight: 1 })
    expect(edgeSourcesFor(elc)).toEqual([{ recording_id: 'rec-S', transcript_id: 'tx-s', assertion_count: 1 }])
    // …and the keeper edge ekc is restored to its exact pre-merge state (S only, weight 1) —
    // the fold's transferred R contribution is gone, matching purge-then-split.
    expect(edgeRow(ekc)).toMatchObject({ source_id: K, target_id: Mc, weight: 1 })
    expect(edgeSourcesFor(ekc)).toEqual([{ recording_id: 'rec-S', transcript_id: 'tx-s', assertion_count: 1 }])
  })

  it('projects: scrubs the purged recording from the name-keyed project snapshot; unmerge never resurrects it', async () => {
    dbRun("INSERT OR IGNORE INTO projects (id, name, status, created_at) VALUES ('p-a', 'Apollo', 'active', '2026-01-01')", [])
    dbRun("INSERT OR IGNORE INTO projects (id, name, status, created_at) VALUES ('p-b', 'Artemis', 'active', '2026-01-01')", [])
    dbRun('INSERT OR IGNORE INTO recordings (id, filename, date_recorded) VALUES (?, ?, ?)', ['rec-S', 'rec-S.hda', '2026-01-01'])
    dbRun('INSERT OR IGNORE INTO recordings (id, filename, date_recorded) VALUES (?, ?, ?)', ['rec-R', 'rec-R.hda', '2026-01-01'])
    const store = getKnowledgeGraphStore()
    const K = store.upsertNode({ type: 'project', label: 'Apollo', now: '2026-01-01' })
    const L = store.upsertNode({ type: 'project', label: 'Artemis', now: '2026-01-01' })
    const M1 = store.upsertNode({ type: 'meeting', label: 'Shared', props: { meetingId: 'm1', date: '2026-01-05' }, now: '2026-01-01' })
    const M2 = store.upsertNode({ type: 'meeting', label: 'LoserOnly', props: { meetingId: 'm2', date: '2026-01-06' }, now: '2026-01-01' })
    const Mc = store.upsertNode({ type: 'meeting', label: 'Collide', props: { meetingId: 'mc', date: '2026-01-07' }, now: '2026-01-01' })

    // el1: SHARED (S+R), non-colliding. el2: SOLE-R (dropped). collision ekc(S)+elc(S+R).
    const el1 = store.upsertEdge({ sourceId: M1, targetId: L, type: 'ABOUT', now: '2026-01-01' })
    addEdgeSource(el1, 'rec-S', 'tx-s', 1)
    addEdgeSource(el1, 'rec-R', 'tx-r', 1)
    setWeight(el1, 2)
    const el2 = store.upsertEdge({ sourceId: M2, targetId: L, type: 'ABOUT', now: '2026-01-01' })
    addEdgeSource(el2, 'rec-R', 'tx-r', 1)
    setWeight(el2, 1)
    const ekc = store.upsertEdge({ sourceId: Mc, targetId: K, type: 'ABOUT', now: '2026-01-01' })
    addEdgeSource(ekc, 'rec-S', 'tx-s', 1)
    setWeight(ekc, 1)
    const elc = store.upsertEdge({ sourceId: Mc, targetId: L, type: 'ABOUT', now: '2026-01-01' })
    addEdgeSource(elc, 'rec-S', 'tx-s', 1)
    addEdgeSource(elc, 'rec-R', 'tx-r', 1)
    setWeight(elc, 2)

    mergeProjectsWithGraph('p-a', 'p-b')
    expect(store.getNode(L)).toBeUndefined()
    const journal = database.getMergeJournal('project', 'p-a')
    expect(journal).toHaveLength(1)
    const journalId = journal[0].id

    const purge = hardPurge('rec-R')
    expect(purge?.mode).toBe('hard')

    const manifestRow = queryOne<{ repointed_manifest: string }>(
      'SELECT repointed_manifest FROM merge_journal WHERE id = ?',
      [journalId]
    )!
    const snap = JSON.parse(manifestRow.repointed_manifest).graph as {
      loserNode: { id: string } | null
      edges: Array<{ id: string; weight: number }>
      edgeSources: Array<{ edge_id: string; recording_id: string }>
    }
    expect(snap.edgeSources.some((s) => s.recording_id === 'rec-R')).toBe(false)
    expect(snap.edges.some((e) => e.id === el2)).toBe(false)
    expect(snap.edges.find((e) => e.id === el1)?.weight).toBe(1)
    expect(snap.edges.find((e) => e.id === elc)?.weight).toBe(1)
    expect(snap.loserNode?.id).toBe(L)

    const undo = database.unmergeProjects(journalId)
    expect(undo.loserId).toBe('p-b')

    expect(queryAll('SELECT * FROM graph_edge_sources WHERE recording_id = ?', ['rec-R'])).toHaveLength(0)
    expect(edgeRow(el2)).toBeUndefined()
    expect(store.getNode(L)).toBeTruthy()
    expect(edgeRow(el1)).toMatchObject({ source_id: M1, target_id: L, weight: 1 })
    expect(edgeSourcesFor(el1)).toEqual([{ recording_id: 'rec-S', transcript_id: 'tx-s', assertion_count: 1 }])
    expect(edgeRow(elc)).toMatchObject({ source_id: Mc, target_id: L, weight: 1 })
    expect(edgeSourcesFor(elc)).toEqual([{ recording_id: 'rec-S', transcript_id: 'tx-s', assertion_count: 1 }])
    expect(edgeRow(ekc)).toMatchObject({ source_id: Mc, target_id: K, weight: 1 })
    expect(edgeSourcesFor(ekc)).toEqual([{ recording_id: 'rec-S', transcript_id: 'tx-s', assertion_count: 1 }])
  })

  // ADV58-2 (round-60): a loser edge whose WEIGHT EXCEEDS R's attributed assertion_count
  // carries UNATTRIBUTED RESIDUE (a legacy/co-asserted edge R later re-asserted). The
  // live purge KEEPS such an edge at max(1, weight − removed) (it is not sole-sourced by
  // R). Round-59's snapshot scrub wrongly DROPPED it whenever R's sources were removed —
  // so unmerge could not split the residue back, leaving it laundered on the keeper under
  // the WRONG entity. The fix mirrors removeRecordingProvenance's residue predicate: drop
  // the snapshot edge only when removed ≥ weight; otherwise keep it at the residual weight.
  it('contacts: retains unattributed-residue edges (weight > R assertion) in the snapshot; unmerge splits residue back, never launders it onto the keeper', async () => {
    seedContact('c-a', 'Bob')
    seedContact('c-b', 'Robert')
    dbRun('INSERT OR IGNORE INTO recordings (id, filename, date_recorded) VALUES (?, ?, ?)', ['rec-S', 'rec-S.hda', '2026-01-01'])
    dbRun('INSERT OR IGNORE INTO recordings (id, filename, date_recorded) VALUES (?, ?, ?)', ['rec-R', 'rec-R.hda', '2026-01-01'])
    const store = getKnowledgeGraphStore()
    const K = store.upsertNode({ type: 'person', label: 'Bob', key: 'contact:c-a', props: { contactId: 'c-a' }, now: '2026-01-01' })
    const L = store.upsertNode({ type: 'person', label: 'Robert', key: 'contact:c-b', props: { contactId: 'c-b' }, now: '2026-01-01' })
    const Mr = store.upsertNode({ type: 'meeting', label: 'ResidueNC', props: { meetingId: 'mr', date: '2026-01-05' }, now: '2026-01-01' })
    const Mc = store.upsertNode({ type: 'meeting', label: 'ResidueCollide', props: { meetingId: 'mc', date: '2026-01-07' }, now: '2026-01-01' })

    // elr: NON-COLLIDING residue — L→Mr, weight 2 but only ONE R assertion (1 unit is
    // unattributed residue, no other recording). Live purge keeps it at weight 1.
    const elr = store.upsertEdge({ sourceId: L, targetId: Mr, type: 'ATTENDED', now: '2026-01-01' })
    addEdgeSource(elr, 'rec-R', 'tx-r', 1)
    setWeight(elr, 2)
    // Collision pair with a RESIDUE loser edge: keeper ekc (S, weight 1) + loser elc-r
    // (R only, weight 2 → 1 unit residue). elc-r folds into ekc (ekc → weight 3, {S,R}).
    const ekc = store.upsertEdge({ sourceId: K, targetId: Mc, type: 'ATTENDED', now: '2026-01-01' })
    addEdgeSource(ekc, 'rec-S', 'tx-s', 1)
    setWeight(ekc, 1)
    const elcr = store.upsertEdge({ sourceId: L, targetId: Mc, type: 'ATTENDED', now: '2026-01-01' })
    addEdgeSource(elcr, 'rec-R', 'tx-r', 1)
    setWeight(elcr, 2)

    mergeContactsWithGraph('c-a', 'c-b')
    expect(store.getNode(L)).toBeUndefined()
    const journalId = database.getMergeJournal('contact', 'c-a')[0].id

    const purge = hardPurge('rec-R')
    expect(purge?.mode).toBe('hard')

    // --- MANIFEST-AT-REST: both residue edges are RETAINED at the residual weight (1),
    // NOT dropped. Revert-proof: the old drop-on-no-source rule removes them here. ---
    const snap = JSON.parse(
      queryOne<{ repointed_manifest: string }>('SELECT repointed_manifest FROM merge_journal WHERE id = ?', [journalId])!
        .repointed_manifest
    ).graph as { edges: Array<{ id: string; weight: number }>; edgeSources: Array<{ recording_id: string }> }
    expect(snap.edgeSources.some((s) => s.recording_id === 'rec-R')).toBe(false)
    expect(snap.edges.find((e) => e.id === elr)?.weight).toBe(1) // residue kept, not dropped
    expect(snap.edges.find((e) => e.id === elcr)?.weight).toBe(1) // residue kept, not dropped

    // --- Unmerge: residue is split back onto the LOSER, keeper returns to its true
    // pre-merge state (weight 1, S only) — the residue is NOT laundered onto the keeper. ---
    database.unmergeContacts(journalId)
    expect(queryAll('SELECT * FROM graph_edge_sources WHERE recording_id = ?', ['rec-R'])).toHaveLength(0)
    // Non-colliding residue edge is back on the loser at weight 1 with NO sources.
    expect(edgeRow(elr)).toMatchObject({ source_id: L, target_id: Mr, weight: 1 })
    expect(edgeSourcesFor(elr)).toEqual([])
    // Colliding residue edge reconstructed on the loser at weight 1 with NO sources.
    expect(edgeRow(elcr)).toMatchObject({ source_id: L, target_id: Mc, weight: 1 })
    expect(edgeSourcesFor(elcr)).toEqual([])
    // Keeper edge restored to weight 1 {S:1} — residue NOT laundered (old rule left it at 2).
    expect(edgeRow(ekc)).toMatchObject({ source_id: K, target_id: Mc, weight: 1 })
    expect(edgeSourcesFor(ekc)).toEqual([{ recording_id: 'rec-S', transcript_id: 'tx-s', assertion_count: 1 }])
    expect(store.getNode(L)).toBeTruthy()
    expect(getContactById('c-b')).toBeTruthy()
  })
})

// ADV58-1 (round-60): the graph scrub trims only manifest.graph. The RELATIONAL scrub
// strips a hard-purged recording from every open journal's loser_snapshot: when the loser
// entity's IDENTITY provenance IS the purged recording it redacts the PII + invalidates the
// undo (unmerge refuses, surface hides it); otherwise it redacts only R-sourced FIELD
// values (contacts' role) and unmerge still restores the entity WITH its positive provenance.
describe('merge_journal relational scrub on hard purge (ADV58-1 / round-60)', () => {
  function hardPurge(recordingId: string) {
    database.setGraphProvenanceCleanup((rid, opts) => removeRecordingProvenanceCore(rid, opts))
    return database.deleteRecordingCascade(recordingId, { hard: true })
  }
  function rawJournal(journalId: string) {
    return queryOne<{ loser_snapshot: string; repointed_manifest: string; undone_at: string | null }>(
      'SELECT loser_snapshot, repointed_manifest, undone_at FROM merge_journal WHERE id = ?',
      [journalId]
    )!
  }
  function insertRecording(id: string) {
    dbRun('INSERT OR IGNORE INTO recordings (id, filename, date_recorded) VALUES (?, ?, ?)', [id, `${id}.hda`, '2026-01-01'])
  }

  it('contacts: loser whose IDENTITY provenance is the purged recording → PII redacted, journal invalidated, unmerge refuses', () => {
    dbRun(
      `INSERT INTO contacts (id, name, email, type, role, company, notes, tags, first_seen_at, last_seen_at, meeting_count, created_at, source, source_recording_id)
       VALUES ('c-keep','Alice Keeper',NULL,'unknown',NULL,NULL,NULL,NULL,'2026-01-01','2026-01-01',0,'2026-01-01','user',NULL)`,
      []
    )
    dbRun(
      `INSERT INTO contacts (id, name, email, type, role, company, notes, tags, first_seen_at, last_seen_at, meeting_count, created_at, source, source_recording_id)
       VALUES ('c-lose','Bob Secret','bob@secret.example','external','CFO','SecretCorp','private notes',NULL,'2026-01-01','2026-01-01',0,'2026-01-01','transcript','rec-R')`,
      []
    )
    insertRecording('rec-R')

    database.mergeContacts('c-keep', 'c-lose')
    const journalId = database.getMergeJournal('contact', 'c-keep')[0].id

    expect(hardPurge('rec-R')?.mode).toBe('hard')

    // (a) manifest-at-rest: the loser's PII is gone from the stored snapshot.
    const raw = rawJournal(journalId)
    for (const pii of ['Bob Secret', 'bob@secret.example', 'SecretCorp', 'private notes', 'CFO']) {
      expect(raw.loser_snapshot).not.toContain(pii)
    }
    const snap = JSON.parse(raw.loser_snapshot)
    expect(snap.name).toBeNull()
    expect(snap.email).toBeNull()
    expect(snap.company).toBeNull()
    // (b) journal invalidated by the purge.
    expect(JSON.parse(raw.repointed_manifest).invalidatedByPurge?.recordingId).toBe('rec-R')
    expect(raw.undone_at).toBeNull()
    // (c) unmerge refuses; no entity row is recreated.
    expect(() => database.unmergeContacts(journalId)).toThrow(/permanently deleted|no longer/i)
    expect(queryOne('SELECT 1 FROM contacts WHERE id = ?', ['c-lose'])).toBeFalsy()
    // Surface hides the invalidated merge from the undoable list.
    expect(database.getMergeJournal('contact', 'c-keep')).toHaveLength(0)
  })

  it('contacts: independently-sourced loser with an R-sourced role → role field redacted only; unmerge restores WITH provenance and WITHOUT the purged role', () => {
    dbRun(
      `INSERT INTO contacts (id, name, email, type, role, company, notes, tags, first_seen_at, last_seen_at, meeting_count, created_at, source, source_recording_id)
       VALUES ('c-keep','Alice Keeper',NULL,'unknown','Owner',NULL,NULL,NULL,'2026-01-01','2026-01-01',0,'2026-01-01','user',NULL)`,
      []
    )
    dbRun(
      `INSERT INTO contacts (id, name, email, type, role, company, notes, tags, first_seen_at, last_seen_at, meeting_count, created_at, source, source_recording_id, role_source_recording_id, role_origin)
       VALUES ('c-lose','Carol Public','carol@x.example','external','Director',NULL,NULL,NULL,'2026-01-01','2026-01-01',0,'2026-01-01','transcript','rec-S','rec-R','transcript')`,
      []
    )
    insertRecording('rec-S')
    insertRecording('rec-R')

    database.mergeContacts('c-keep', 'c-lose')
    const journalId = database.getMergeJournal('contact', 'c-keep')[0].id

    expect(hardPurge('rec-R')?.mode).toBe('hard')

    const raw = rawJournal(journalId)
    const snap = JSON.parse(raw.loser_snapshot)
    expect(snap.role).toBeNull() // R-sourced field value redacted
    expect(snap.role_source_recording_id).toBeNull()
    expect(snap.name).toBe('Carol Public') // identity PII NOT redacted (independently sourced)
    expect(JSON.parse(raw.repointed_manifest).invalidatedByPurge).toBeUndefined() // NOT invalidated

    // Unmerge still restores the entity, WITH its positive provenance and WITHOUT the purged role.
    const undo = database.unmergeContacts(journalId)
    expect(undo.loserId).toBe('c-lose')
    const restored = queryOne<{ source: string | null; source_recording_id: string | null; role: string | null; role_source_recording_id: string | null }>(
      'SELECT source, source_recording_id, role, role_source_recording_id FROM contacts WHERE id = ?',
      ['c-lose']
    )!
    expect(restored.source).toBe('transcript')
    expect(restored.source_recording_id).toBe('rec-S') // surviving positive provenance preserved
    expect(restored.role).toBeNull() // purged role value not restored
    expect(restored.role_source_recording_id).toBeNull()
  })

  it('projects: loser whose IDENTITY provenance is the purged recording → PII redacted, journal invalidated, unmerge refuses', () => {
    dbRun(
      `INSERT INTO projects (id, name, description, status, created_at, source, source_recording_id)
       VALUES ('p-keep','Apollo',NULL,'active','2026-01-01','user',NULL)`,
      []
    )
    dbRun(
      `INSERT INTO projects (id, name, description, status, folder_path, url, created_at, source, source_recording_id)
       VALUES ('p-lose','Secret Project','confidential brief','active','C:/secret','https://secret.example','2026-01-01','transcript','rec-R')`,
      []
    )
    insertRecording('rec-R')

    database.mergeProjects('p-keep', 'p-lose')
    const journalId = database.getMergeJournal('project', 'p-keep')[0].id

    expect(hardPurge('rec-R')?.mode).toBe('hard')

    const raw = rawJournal(journalId)
    for (const pii of ['Secret Project', 'confidential brief', 'C:/secret', 'secret.example']) {
      expect(raw.loser_snapshot).not.toContain(pii)
    }
    const snap = JSON.parse(raw.loser_snapshot)
    expect(snap.name).toBeNull()
    expect(snap.description).toBeNull()
    expect(snap.folder_path).toBeNull()
    expect(snap.url).toBeNull()
    expect(JSON.parse(raw.repointed_manifest).invalidatedByPurge?.recordingId).toBe('rec-R')
    expect(() => database.unmergeProjects(journalId)).toThrow(/permanently deleted|no longer/i)
    expect(queryOne('SELECT 1 FROM projects WHERE id = ?', ['p-lose'])).toBeFalsy()
    expect(database.getMergeJournal('project', 'p-keep')).toHaveLength(0)
  })

  it('non-purge round-trip: unmerge restores the loser WITH its source/source_recording_id (provenance preserved, snapshot untouched)', () => {
    dbRun(
      `INSERT INTO contacts (id, name, email, type, role, company, notes, tags, first_seen_at, last_seen_at, meeting_count, created_at, source, source_recording_id)
       VALUES ('c-keep','Alice Keeper',NULL,'unknown',NULL,NULL,NULL,NULL,'2026-01-01','2026-01-01',0,'2026-01-01','user',NULL)`,
      []
    )
    dbRun(
      `INSERT INTO contacts (id, name, email, type, role, company, notes, tags, first_seen_at, last_seen_at, meeting_count, created_at, source, source_recording_id)
       VALUES ('c-lose','Dave Live','dave@x.example','external',NULL,NULL,NULL,NULL,'2026-01-01','2026-01-01',0,'2026-01-01','transcript','rec-S')`,
      []
    )
    insertRecording('rec-S')

    database.mergeContacts('c-keep', 'c-lose')
    const journalId = database.getMergeJournal('contact', 'c-keep')[0].id
    // No purge — the snapshot is untouched and the merge stays undoable.
    const before = rawJournal(journalId)
    expect(JSON.parse(before.repointed_manifest).invalidatedByPurge).toBeUndefined()

    const undo = database.unmergeContacts(journalId)
    expect(undo.loserId).toBe('c-lose')
    const restored = queryOne<{ name: string; source: string | null; source_recording_id: string | null }>(
      'SELECT name, source, source_recording_id FROM contacts WHERE id = ?',
      ['c-lose']
    )!
    expect(restored.name).toBe('Dave Live')
    expect(restored.source).toBe('transcript')
    expect(restored.source_recording_id).toBe('rec-S')
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
