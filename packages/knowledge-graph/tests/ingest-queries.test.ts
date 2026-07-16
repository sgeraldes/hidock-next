// @vitest-environment node

import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'
import Database from 'better-sqlite3'
import { DatabaseEngine } from '@hidock/database'
import { KnowledgeGraphStore } from '../src/graph-store.js'
import { ingestExtraction } from '../src/ingest.js'
import {
  topAttendeesForProjectOrTopic,
  topSkillDemonstrators,
  personProfile,
  meetingSummaryGraph,
} from '../src/queries.js'
import type { ExtractionResult, ExtractionMeta } from '../src/extract.js'

function tempPath(name: string) {
  return join(tmpdir(), `hidock-kg-ingest-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`)
}

// better-sqlite3 (unlike the old sql.js engine) holds a native OS file handle
// open until closeDatabase() runs — on Windows, rmSync() on a still-open file
// fails with EPERM. Track every engine created by makeStore() and close them
// all before removing files.
const engines: DatabaseEngine[] = []

async function makeStore(name: string) {
  const dbPath = tempPath(name)
  const engine = new DatabaseEngine({
    betterSqlite3: Database,
    dbPathProvider: () => dbPath,
    schemaVersion: 1,
    schema: 'CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)',
    migrations: {},
  })
  await engine.initialize()
  engines.push(engine)
  const store = new KnowledgeGraphStore(engine)
  store.initSchema()
  return { store, dbPath }
}

function closeEngines(): void {
  for (const e of engines) {
    try {
      e.closeDatabase()
    } catch {
      /* already closed */
    }
  }
  engines.length = 0
}

// --- Seed data ---

const meeting1: ExtractionResult = {
  people: [
    { name: 'Alice', skills: ['GenAI', 'TypeScript'] },
    { name: 'Bob', skills: ['GenAI'] },
    { name: 'Carol', skills: [] },
  ],
  topics: ['AI Strategy'],
  projects: ['Project Phoenix'],
  decisions: ['Adopt LLMs for summarization'],
  action_items: [{ text: 'Write GenAI policy', owner: 'Alice' }],
  risks: [{ text: 'Data privacy', raised_by: 'Carol' }],
  next_steps: ['Schedule AI workshop'],
}

const meeting2: ExtractionResult = {
  people: [
    { name: 'Alice', skills: ['TypeScript', 'Architecture'] },
    { name: 'Dave', skills: ['Architecture'] },
  ],
  topics: ['System Architecture'],
  projects: ['Project Phoenix'],
  decisions: ['Use microservices'],
  action_items: [{ text: 'Document ADR', owner: 'Dave' }],
  risks: [],
  next_steps: ['Create ADR template'],
}

const meeting3: ExtractionResult = {
  people: [
    { name: 'Bob', skills: ['GenAI', 'Python'] },
    { name: 'Eve', skills: ['Python'] },
  ],
  topics: ['ML Pipeline'],
  projects: ['Project Phoenix'],
  decisions: [],
  action_items: [],
  risks: [{ text: 'Model drift', raised_by: 'Bob' }],
  next_steps: ['Set up monitoring'],
}

const meta1: ExtractionMeta = { meetingId: 'mtg-001', title: 'AI Strategy Meeting', date: '2026-06-01' }
const meta2: ExtractionMeta = { meetingId: 'mtg-002', title: 'Architecture Review', date: '2026-06-02' }
const meta3: ExtractionMeta = { meetingId: 'mtg-003', title: 'ML Pipeline Planning', date: '2026-06-03' }

describe('ingestExtraction + queries', () => {
  const paths: string[] = []

  afterEach(() => {
    closeEngines()
    for (const p of paths) {
      if (existsSync(p)) rmSync(p, { force: true })
    }
    paths.length = 0
  })

  async function seedStore(name: string) {
    const { store, dbPath } = await makeStore(name)
    paths.push(dbPath)
    ingestExtraction(store, meeting1, meta1)
    ingestExtraction(store, meeting2, meta2)
    ingestExtraction(store, meeting3, meta3)
    return store
  }

  it('topAttendeesForProjectOrTopic: ranks by meeting count for Project Phoenix', async () => {
    const store = await seedStore('top-attendees')
    const results = topAttendeesForProjectOrTopic(store, 'Project Phoenix')

    expect(results.length).toBeGreaterThan(0)

    // Alice attended meetings 1 and 2 (both ABOUT Project Phoenix)
    const alice = results.find((r) => r.person === 'Alice')
    expect(alice).toBeDefined()
    expect(alice!.meetings).toBeGreaterThanOrEqual(2)

    // Bob attended meetings 1 and 3 (both ABOUT Project Phoenix)
    const bob = results.find((r) => r.person === 'Bob')
    expect(bob).toBeDefined()
    expect(bob!.meetings).toBeGreaterThanOrEqual(2)

    // Dave attended meeting 2 only
    const dave = results.find((r) => r.person === 'Dave')
    expect(dave).toBeDefined()
    expect(dave!.meetings).toBe(1)

    // Results are ordered by meeting count descending
    expect(results[0].meetings).toBeGreaterThanOrEqual(results[1]?.meetings ?? 0)
  })

  it('topSkillDemonstrators: ranks GenAI demonstrators by weight', async () => {
    const store = await seedStore('top-skill')
    const results = topSkillDemonstrators(store, 'GenAI')

    expect(results.length).toBeGreaterThan(0)

    // Bob demonstrated GenAI in meetings 1 and 3 (weight 2)
    const bob = results.find((r) => r.person === 'Bob')
    expect(bob).toBeDefined()
    expect(bob!.weight).toBeGreaterThanOrEqual(2)

    // Alice demonstrated GenAI in meeting 1 (weight 1)
    const alice = results.find((r) => r.person === 'Alice')
    expect(alice).toBeDefined()
    expect(alice!.weight).toBeGreaterThanOrEqual(1)

    // Bob should rank higher than Alice for GenAI
    const bobIdx = results.findIndex((r) => r.person === 'Bob')
    const aliceIdx = results.findIndex((r) => r.person === 'Alice')
    expect(bobIdx).toBeLessThan(aliceIdx)
  })

  it('personProfile returns correct meetings, skills, and action items', async () => {
    const store = await seedStore('person-profile')
    const profile = personProfile(store, 'Alice')

    expect(profile).toBeDefined()
    expect(profile!.personLabel).toBe('Alice')
    expect(profile!.meetings.length).toBeGreaterThanOrEqual(2)
    expect(profile!.skills.length).toBeGreaterThanOrEqual(1)
    expect(profile!.actionItems.length).toBeGreaterThanOrEqual(1)
  })

  it('meetingSummaryGraph returns all nodes for a meeting', async () => {
    const store = await seedStore('meeting-graph')
    const graph = meetingSummaryGraph(store, 'mtg-001')

    expect(graph.meeting).toBeDefined()
    expect(graph.nodes.length).toBeGreaterThan(1)
    expect(graph.edges.length).toBeGreaterThan(0)

    // Should include the people from meeting1
    const labels = graph.nodes.map((n) => n.label)
    expect(labels).toContain('Alice')
    expect(labels).toContain('Bob')
  })

  it('person nodes are deduped across meetings (Alice = one node)', async () => {
    const store = await seedStore('cross-meeting-dedup')
    const people = store.findNodes({ type: 'person' })
    const aliceNodes = people.filter((n) => n.label === 'Alice')
    expect(aliceNodes).toHaveLength(1) // Entity resolution works across meetings
  })

  it('ATTENDED edge weight bumps for repeat ingestion of same meeting', async () => {
    const { store, dbPath } = await makeStore('edge-bump')
    paths.push(dbPath)

    // Ingest same meeting twice — ATTENDED edge should bump to weight 2
    ingestExtraction(store, meeting1, meta1)
    ingestExtraction(store, meeting1, meta1)

    const attendedEdges = store.db.queryAll<{ weight: number }>(
      `SELECT e.weight FROM graph_edges e WHERE e.type = 'ATTENDED'`
    )
    expect(attendedEdges.every((e) => e.weight === 2)).toBe(true)
  })

  it('topAttendeesForProjectOrTopic fuzzy matches partial topic name', async () => {
    const store = await seedStore('fuzzy-topic')
    // 'Phoenix' should match 'Project Phoenix'
    const results = topAttendeesForProjectOrTopic(store, 'Phoenix')
    expect(results.length).toBeGreaterThan(0)
  })

  it('topSkillDemonstrators fuzzy matches partial skill name', async () => {
    const store = await seedStore('fuzzy-skill')
    // 'Script' should match 'TypeScript'
    const results = topSkillDemonstrators(store, 'Script')
    expect(results.length).toBeGreaterThan(0)
  })
})

// =============================================================================
// F18 (spec-004): meeting-node id-keying + per-edge provenance writes
// =============================================================================

describe('ingestExtraction: meeting-node id-keying (F18)', () => {
  const paths: string[] = []
  afterEach(() => {
    closeEngines()
    for (const p of paths) if (existsSync(p)) rmSync(p, { force: true })
    paths.length = 0
  })

  it('same title, different meetingId → TWO meeting nodes (recurring occurrences no longer fold by title)', async () => {
    const { store, dbPath } = await makeStore('id-keying-distinct')
    paths.push(dbPath)
    const occurrence1: ExtractionMeta = { meetingId: 'series-1::2026-06-01T10:00:00.000Z', title: 'Weekly Sync', date: '2026-06-01' }
    const occurrence2: ExtractionMeta = { meetingId: 'series-1::2026-06-08T10:00:00.000Z', title: 'Weekly Sync', date: '2026-06-08' }

    ingestExtraction(store, meeting1, occurrence1)
    ingestExtraction(store, meeting1, occurrence2)

    const meetings = store.findNodes({ type: 'meeting' })
    expect(meetings).toHaveLength(2)
    expect(new Set(meetings.map((m) => m.norm_key)).size).toBe(2)
    // Both keep the SAME display title...
    expect(meetings.every((m) => m.label === 'Weekly Sync')).toBe(true)
    // ...but are keyed by their distinct meetingId (id-keying, not title).
    expect(meetings.map((m) => m.norm_key).sort()).toEqual(
      ['meeting:series-1::2026-06-01t10:00:00.000z', 'meeting:series-1::2026-06-08t10:00:00.000z']
    )
  })

  it('same meetingId ingested twice still folds into ONE node (regression: id-keying does not break re-ingest dedup)', async () => {
    const { store, dbPath } = await makeStore('id-keying-fold')
    paths.push(dbPath)
    ingestExtraction(store, meeting1, meta1)
    ingestExtraction(store, meeting1, meta1)

    const meetings = store.findNodes({ type: 'meeting' })
    expect(meetings).toHaveLength(1)
    expect(meetings[0].norm_key).toBe(`meeting:${meta1.meetingId.toLowerCase()}`)
  })
})

describe('ingestExtraction: per-edge provenance writes (F18)', () => {
  const paths: string[] = []
  afterEach(() => {
    closeEngines()
    for (const p of paths) if (existsSync(p)) rmSync(p, { force: true })
    paths.length = 0
  })

  it('recordingId + transcriptId writes one graph_edge_sources row per upserted edge', async () => {
    const { store, dbPath } = await makeStore('provenance-write')
    paths.push(dbPath)
    ingestExtraction(store, meeting1, meta1, { recordingId: 'rec-1', transcriptId: 'tx-1' })

    const edges = store.db.queryAll<{ id: string }>('SELECT id FROM graph_edges')
    expect(edges.length).toBeGreaterThan(0)

    const sources = store.db.queryAll<{ edge_id: string; recording_id: string; transcript_id: string }>(
      'SELECT edge_id, recording_id, transcript_id FROM graph_edge_sources'
    )
    // Every edge from this ingest has exactly one source row, all attributed
    // to the same (recording, transcript).
    expect(sources).toHaveLength(edges.length)
    expect(sources.every((s) => s.recording_id === 'rec-1' && s.transcript_id === 'tx-1')).toBe(true)
    expect(new Set(sources.map((s) => s.edge_id))).toEqual(new Set(edges.map((e) => e.id)))
  })

  it('a folder-style call (no recordingId/transcriptId) writes NO graph_edge_sources rows', async () => {
    const { store, dbPath } = await makeStore('provenance-none')
    paths.push(dbPath)
    ingestExtraction(store, meeting1, meta1) // no options → folder-ingest shape

    const edges = store.db.queryAll<{ id: string }>('SELECT id FROM graph_edges')
    expect(edges.length).toBeGreaterThan(0)
    const sources = store.db.queryAll('SELECT * FROM graph_edge_sources')
    expect(sources).toHaveLength(0)
  })

  it('a duplicate entity within one extraction bumps assertion_count rather than erroring or duplicating the row', async () => {
    const { store, dbPath } = await makeStore('provenance-duplicate-entity')
    paths.push(dbPath)
    const duplicated: ExtractionResult = {
      people: [
        { name: 'Alice', skills: [] },
        { name: 'Alice', skills: [] }, // duplicate entity from the extractor
      ],
      topics: [],
      projects: [],
      decisions: [],
      action_items: [],
      risks: [],
      next_steps: [],
    }
    ingestExtraction(store, duplicated, meta1, { recordingId: 'rec-dup', transcriptId: 'tx-dup' })

    const attended = store.db.queryOne<{ id: string; weight: number }>(
      "SELECT id, weight FROM graph_edges WHERE type = 'ATTENDED'"
    )
    expect(attended?.weight).toBe(2) // upsertEdge bumped weight for the repeat

    const row = store.db.queryOne<{ assertion_count: number }>(
      'SELECT assertion_count FROM graph_edge_sources WHERE edge_id = ? AND recording_id = ? AND transcript_id = ?',
      [attended!.id, 'rec-dup', 'tx-dup']
    )
    expect(row?.assertion_count).toBe(2)

    const allSourceRows = store.db.queryAll('SELECT * FROM graph_edge_sources WHERE edge_id = ?', [attended!.id])
    expect(allSourceRows).toHaveLength(1) // one row, not two
  })
})

// =============================================================================
// ADV35-1 (round-37): NODE-LEVEL provenance writes (isolated-node visibility)
// =============================================================================

describe('ingestExtraction: node-level provenance (ADV35-1)', () => {
  const paths: string[] = []
  afterEach(() => {
    closeEngines()
    for (const p of paths) if (existsSync(p)) rmSync(p, { force: true })
    paths.length = 0
  })

  it('a recording-backed ingest stamps every node origin=derived + source_recording_id', async () => {
    const { store, dbPath } = await makeStore('node-prov-derived')
    paths.push(dbPath)
    ingestExtraction(store, meeting1, meta1, { recordingId: 'rec-1', transcriptId: 'tx-1' })

    const nodes = store.db.queryAll<{ origin: string | null; source_recording_id: string | null }>(
      'SELECT origin, source_recording_id FROM graph_nodes'
    )
    expect(nodes.length).toBeGreaterThan(0)
    expect(nodes.every((n) => n.origin === 'derived' && n.source_recording_id === 'rec-1')).toBe(true)
  })

  it('an ISOLATED risk (no raiser) carries derived provenance so it can later be suppressed', async () => {
    const { store, dbPath } = await makeStore('node-prov-isolated-risk')
    paths.push(dbPath)
    const withOrphanRisk: ExtractionResult = {
      people: [],
      topics: [],
      projects: [],
      decisions: [],
      action_items: [],
      risks: [{ text: 'Unowned risk', raised_by: '' }], // no raiser ⇒ edgeless node
      next_steps: [],
    }
    ingestExtraction(store, withOrphanRisk, meta1, { recordingId: 'rec-iso', transcriptId: 'tx-iso' })

    const risk = store.db.queryOne<{ id: string; origin: string | null; source_recording_id: string | null }>(
      "SELECT id, origin, source_recording_id FROM graph_nodes WHERE type = 'risk'"
    )
    expect(risk).toBeDefined()
    expect(risk!.origin).toBe('derived')
    expect(risk!.source_recording_id).toBe('rec-iso')
    // Confirm it truly has NO incident edge (the case the round-35 finding is about).
    const edges = store.db.queryAll('SELECT id FROM graph_edges WHERE source_id = ? OR target_id = ?', [risk!.id, risk!.id])
    expect(edges).toHaveLength(0)
  })

  it('a folder-style ingest (no recordingId) stamps nodes origin=manual + NULL source', async () => {
    const { store, dbPath } = await makeStore('node-prov-manual')
    paths.push(dbPath)
    ingestExtraction(store, meeting1, meta1) // no options → folder-ingest shape

    const nodes = store.db.queryAll<{ origin: string | null; source_recording_id: string | null }>(
      'SELECT origin, source_recording_id FROM graph_nodes'
    )
    expect(nodes.length).toBeGreaterThan(0)
    expect(nodes.every((n) => n.origin === 'manual' && n.source_recording_id === null)).toBe(true)
  })

  it('an existing node keeps its FIRST origin when a later ingest re-touches it', async () => {
    const { store, dbPath } = await makeStore('node-prov-first-wins')
    paths.push(dbPath)
    // First: derived from rec-A.
    ingestExtraction(store, meeting1, meta1, { recordingId: 'rec-A', transcriptId: 'tx-A' })
    // Second: the SAME meeting/people re-ingested from rec-B — nodes already exist.
    ingestExtraction(store, meeting1, meta1, { recordingId: 'rec-B', transcriptId: 'tx-B' })

    const nodes = store.db.queryAll<{ source_recording_id: string | null }>(
      'SELECT source_recording_id FROM graph_nodes'
    )
    // Best-effort provenance for the isolated case: the FIRST source is retained
    // (edge-provenance governs when a node is connected, so this only matters for
    // an isolated node).
    expect(nodes.every((n) => n.source_recording_id === 'rec-A')).toBe(true)
  })
})
