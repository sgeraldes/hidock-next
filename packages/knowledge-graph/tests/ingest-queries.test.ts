// @vitest-environment node

import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'
import initSqlJs from 'sql.js'
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
  return join(tmpdir(), `hidock-kg-ingest-${name}.sqlite`)
}

async function makeStore(name: string) {
  const dbPath = tempPath(name)
  const engine = new DatabaseEngine({
    initSqlJs,
    dbPathProvider: () => dbPath,
    schemaVersion: 1,
    schema: 'CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)',
    migrations: {},
  })
  await engine.initialize()
  const store = new KnowledgeGraphStore(engine)
  store.initSchema()
  return { store, dbPath }
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
