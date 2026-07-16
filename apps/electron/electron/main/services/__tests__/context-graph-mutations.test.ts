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
  deleteGraphNode,
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
