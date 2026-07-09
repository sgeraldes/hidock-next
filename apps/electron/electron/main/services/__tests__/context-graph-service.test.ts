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
  dbRun(
    'INSERT OR IGNORE INTO contacts (id, name, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)',
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
