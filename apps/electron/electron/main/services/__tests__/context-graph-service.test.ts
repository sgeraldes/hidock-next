/**
 * Tests for the Context Graph backend (R4c re-key + neighborhood retrieval).
 *
 * Mirrors knowledge-graph-service.test.ts: mock Electron/config/ai-providers,
 * use the real sql.js engine with a fresh temp DB per test. A contact is seeded
 * so the entity resolver can key person nodes by contact id at ingest time.
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
  getDatabasePath: vi.fn(() => join(tmpdir(), `hidock-ctxgraph-test-${Date.now()}-${++_dbCounter}.sqlite`)),
}))

import { complete } from '@hidock/ai-providers'
import { getConfig } from '../config'
import { initializeDatabase, run as dbRun } from '../database'
import {
  ingestFromDbTranscripts,
  getKnowledgeGraphStore,
  queryContextGraph,
  queryNeighborhood,
  searchGraphNodes,
  rekeyExistingPersonNodes,
  resolveEntityToNodeId,
  findMentionedEntity,
  neighborhoodFacts,
  queryLens,
  pickLensCenter,
  queryProvenance,
} from '../knowledge-graph-service'

const FAKE_JSON = JSON.stringify({
  people: [{ name: 'Mario', skills: ['SQL'] }],
  topics: ['Roadmap'],
  projects: ['Phoenix'],
  decisions: [],
  action_items: [{ text: 'Ship v1', owner: 'Mario' }],
  risks: [],
  next_steps: [],
})

async function seedContactAndIngest() {
  // ADV30-2 (round-32): person-node ingest keying now prefers a VISIBLE same-name
  // contact and never keys to a suppressed one. A NULL-source contact with no
  // membership is legitimately suppressed on non-owner surfaces, so stamp a
  // STRUCTURAL source ('user') to make c-mario genuinely visible/keyable.
  dbRun(
    "INSERT OR IGNORE INTO contacts (id, name, first_seen_at, last_seen_at, source) VALUES (?, ?, ?, ?, 'user')",
    ['c-mario', 'Mario', '2026-06-01', '2026-06-01']
  )
  dbRun('INSERT OR IGNORE INTO recordings (id, filename, date_recorded, meeting_id) VALUES (?, ?, ?, ?)', [
    'rec-ctx',
    'ctx.hda',
    '2026-06-01',
    null,
  ])
  dbRun('INSERT OR IGNORE INTO transcripts (id, recording_id, full_text, language) VALUES (?, ?, ?, ?)', [
    'tx-ctx',
    'rec-ctx',
    'Mario discussed the Phoenix roadmap.',
    'en',
  ])
  await ingestFromDbTranscripts()
}

beforeEach(async () => {
  vi.clearAllMocks()
  ;(getConfig as any).mockReturnValue({
    chat: { provider: 'gemini', geminiModel: 'gemini-2.0-flash', ollamaModel: '', maxContextChunks: 10 },
    transcription: { geminiApiKey: 'test-api-key', geminiModel: '' }, // pragma: allowlist secret
  })
  ;(complete as any).mockResolvedValue(FAKE_JSON)
  await initializeDatabase()
})

describe('Context Graph service', () => {
  it('keys the person node by contact id at ingest (R4c)', async () => {
    await seedContactAndIngest()
    const store = getKnowledgeGraphStore()
    const people = store.findNodes({ type: 'person' })
    const mario = people.find((n) => n.label === 'Mario')
    expect(mario).toBeDefined()
    expect(mario!.norm_key).toBe('contact:c-mario')
    const props = JSON.parse(mario!.props ?? '{}')
    expect(props.contactId).toBe('c-mario')
  })

  it('queryContextGraph returns nodes annotated with degree + click-through ids', async () => {
    await seedContactAndIngest()
    const data = queryContextGraph()
    expect(data.nodes.length).toBeGreaterThan(2)
    const mario = data.nodes.find((n) => n.type === 'person' && n.label === 'Mario')!
    expect(mario.degree).toBeGreaterThan(0)
    expect(mario.contactId).toBe('c-mario')
    // Every edge references retained nodes.
    const ids = new Set(data.nodes.map((n) => n.id))
    expect(data.edges.every((e) => ids.has(e.source) && ids.has(e.target))).toBe(true)
  })

  it('resolves an arbitrary contact id to a graph node and returns its neighborhood', async () => {
    await seedContactAndIngest()
    const nodeId = resolveEntityToNodeId('c-mario')
    expect(nodeId).toBeTruthy()

    const nbr = queryNeighborhood('c-mario', 2)
    expect(nbr.center).toBe(nodeId)
    const types = new Set(nbr.nodes.map((n) => n.type))
    expect(types.has('meeting')).toBe(true)
    expect(types.has('project')).toBe(true)
  })

  it('searchGraphNodes finds nodes by label', async () => {
    await seedContactAndIngest()
    const hits = searchGraphNodes('mar')
    expect(hits.some((n) => n.label === 'Mario')).toBe(true)
  })

  it('rekeyExistingPersonNodes folds a legacy name-keyed node into the contact-keyed one', async () => {
    await seedContactAndIngest()
    const store = getKnowledgeGraphStore()

    // Simulate a pre-R4c, name-keyed 'Mario' node with an edge.
    store.db.run(
      "INSERT INTO graph_nodes (id, type, label, norm_key, props, created_at, updated_at) VALUES ('person:legacy_mario', 'person', 'Mario', 'mario', NULL, '', '')"
    )
    store.db.run(
      "INSERT INTO graph_edges (id, source_id, target_id, type, weight, created_at) VALUES ('edge:legacy', 'person:legacy_mario', 'meeting:rec-ctx', 'ATTENDED', 1, '')"
    )
    // ADV47-1 (round-49): rekey now passes each node through the execution-time
    // node-visibility boundary, so the legacy node must be VISIBLE (backed by an
    // eligible recording) to still rekey. Attribute its edge to the live, eligible
    // rec-ctx so the happy path is preserved.
    store.db.run(
      "INSERT INTO graph_edge_sources (edge_id, recording_id, transcript_id, assertion_count, created_at) VALUES ('edge:legacy', 'rec-ctx', 'tx-ctx', 1, '')"
    )

    const before = store.findNodes({ type: 'person' }).length
    const r = rekeyExistingPersonNodes()
    expect(r.merged).toBeGreaterThanOrEqual(1)
    const after = store.findNodes({ type: 'person' })
    expect(after.length).toBe(before - 1)
    expect(after.find((n) => n.id === 'person:legacy_mario')).toBeUndefined()

    // Idempotent: a second pass changes nothing.
    const r2 = rekeyExistingPersonNodes()
    expect(r2.rekeyed).toBe(0)
    expect(r2.merged).toBe(0)
  })

  it('findMentionedEntity + neighborhoodFacts ground a question with graph context', async () => {
    await seedContactAndIngest()
    const entity = findMentionedEntity('What is Mario working on this week?')
    expect(entity).toBeTruthy()
    expect(entity!.type).toBe('person')

    const facts = neighborhoodFacts(entity!.id, 1)
    expect(facts).toContain('Mario')
    expect(facts.length).toBeGreaterThan(0)
  })
})

describe('Context Lens service', () => {
  const RICH_JSON = JSON.stringify({
    people: [{ name: 'Mario', skills: ['SQL'] }],
    topics: ['Roadmap'],
    projects: ['Phoenix'],
    decisions: ['Adopt weekly releases'],
    action_items: [{ text: 'Ship v1', owner: 'Mario' }],
    risks: [{ text: 'Timeline tight', raised_by: 'Mario' }],
    next_steps: ['Book the retro'],
  })

  async function seedRich() {
    // ADV30-2 (round-32): structural source so c-mario is visible/keyable (see above).
    dbRun("INSERT OR IGNORE INTO contacts (id, name, first_seen_at, last_seen_at, source) VALUES (?, ?, ?, ?, 'user')", [
      'c-mario',
      'Mario',
      '2026-06-01',
      '2026-06-01',
    ])
    dbRun('INSERT OR IGNORE INTO recordings (id, filename, date_recorded, meeting_id) VALUES (?, ?, ?, ?)', [
      'rec-rich',
      'rich.hda',
      '2026-06-15',
      null,
    ])
    dbRun('INSERT OR IGNORE INTO transcripts (id, recording_id, full_text, language) VALUES (?, ?, ?, ?)', [
      'tx-rich',
      'rec-rich',
      'Mario decided weekly releases for Phoenix and flagged the timeline risk.',
      'en',
    ])
    ;(complete as any).mockResolvedValue(RICH_JSON)
    await ingestFromDbTranscripts()
  }

  it('queryLens annotates nodes with stratum + dateMs and covers all bands', async () => {
    await seedRich()
    const lens = queryLens('c-mario', { hops: 2, windowDays: null })
    expect(lens.center).toBeTruthy()
    // Every node carries a stratum + a dateMs field.
    expect(lens.nodes.every((n) => typeof n.stratum === 'string')).toBe(true)
    const strata = new Set(lens.nodes.map((n) => n.stratum))
    expect(strata.has('people')).toBe(true)
    expect(strata.has('evidence')).toBe(true)
    expect(strata.has('operational')).toBe(true)
    expect(strata.has('strategic')).toBe(true)
    // The meeting node carries the recording date.
    const meeting = lens.nodes.find((n) => n.type === 'meeting')!
    expect(meeting.dateMs).not.toBeNull()
    // referenceMs reflects the newest activity.
    expect(lens.referenceMs).not.toBeNull()
    // Person node keeps its contact click-through id.
    const mario = lens.nodes.find((n) => n.type === 'person')!
    expect(mario.contactId).toBe('c-mario')
  })

  it('queryLens (whole-graph, center null) returns a stratified capped lens', async () => {
    await seedRich()
    const lens = queryLens(null, { cap: 50, windowDays: null })
    expect(lens.center).toBeNull()
    expect(lens.nodes.length).toBeGreaterThan(2)
    expect(lens.nodes.every((n) => typeof n.stratum === 'string')).toBe(true)
  })

  it('pickLensCenter returns the highest-degree person by default', async () => {
    await seedRich()
    const center = pickLensCenter()
    expect(center).toBeTruthy()
    expect(center!.type).toBe('person')
    expect(center!.label).toBe('Mario')
  })

  it('queryProvenance derives the decision evidence path + narrative', async () => {
    await seedRich()
    const store = getKnowledgeGraphStore()
    const decision = store.findNodes({ type: 'decision' })[0]
    const prov = queryProvenance(decision.id)
    expect(prov.node?.type).toBe('decision')
    expect(prov.meetings.length).toBeGreaterThan(0)
    expect(prov.narrative).toContain('Decided')
    expect(prov.pathIds).toContain(decision.id)
    // The evidence meeting carries a click-through date.
    expect(prov.dateMs).not.toBeNull()
  })

  it('queryProvenance returns empty for an unknown entity', async () => {
    await seedRich()
    const prov = queryProvenance('decision:not-a-real-node')
    expect(prov.node).toBeNull()
    expect(prov.pathIds).toHaveLength(0)
  })
})
