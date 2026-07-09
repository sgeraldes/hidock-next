// @vitest-environment node

import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'
import initSqlJs from 'sql.js'
import { DatabaseEngine } from '@hidock/database'
import { KnowledgeGraphStore } from '../src/graph-store.js'
import { ingestExtraction, type PersonResolver } from '../src/ingest.js'
import { fullGraph, neighborhood } from '../src/queries.js'
import type { ExtractionResult, ExtractionMeta } from '../src/extract.js'

function tempPath(name: string) {
  return join(tmpdir(), `hidock-kg-ctx-${name}-${Date.now()}.sqlite`)
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

const meta: ExtractionMeta = { meetingId: 'mtg-001', title: 'Kickoff', date: '2026-06-01' }
const meta2: ExtractionMeta = { meetingId: 'mtg-002', title: 'Review', date: '2026-06-02' }

describe('Context Graph: contact-keyed ingest', () => {
  const paths: string[] = []
  afterEach(() => {
    for (const p of paths) if (existsSync(p)) rmSync(p, { force: true })
    paths.length = 0
  })

  it('folds two name variants of the same contact into ONE contact-keyed node', async () => {
    const { store, dbPath } = await makeStore('rekey')
    paths.push(dbPath)

    // Both variants resolve to the same contact id.
    const resolvePerson: PersonResolver = (name) => {
      if (/alice/i.test(name)) return { id: 'c-alice', label: 'Alice Smith' }
      return null
    }

    const m1: ExtractionResult = {
      people: [{ name: 'Alice', skills: [] }],
      topics: [], projects: [], decisions: [], action_items: [], risks: [], next_steps: [],
    }
    const m2: ExtractionResult = {
      people: [{ name: 'Alice Smith', skills: [] }],
      topics: [], projects: [], decisions: [], action_items: [], risks: [], next_steps: [],
    }
    ingestExtraction(store, m1, meta, { resolvePerson })
    ingestExtraction(store, m2, meta2, { resolvePerson })

    const people = store.findNodes({ type: 'person' })
    expect(people).toHaveLength(1)
    const node = people[0]
    expect(node.norm_key).toBe('contact:c-alice')
    expect(node.id.startsWith('person:contact_')).toBe(true)
    const props = JSON.parse(node.props ?? '{}')
    expect(props.contactId).toBe('c-alice')
    // Attended both meetings.
    expect(node.label).toBe('Alice Smith')
  })

  it('falls back to name-keyed when the resolver returns null (legacy behaviour)', async () => {
    const { store, dbPath } = await makeStore('fallback')
    paths.push(dbPath)
    const resolvePerson: PersonResolver = () => null
    const m: ExtractionResult = {
      people: [{ name: 'Zoltan', skills: [] }],
      topics: [], projects: [], decisions: [], action_items: [], risks: [], next_steps: [],
    }
    ingestExtraction(store, m, meta, { resolvePerson })
    const [node] = store.findNodes({ type: 'person' })
    expect(node.norm_key).toBe('zoltan')
    expect(node.id).toBe('person:zoltan')
  })

  it('legacy string 4th argument (now) still works', async () => {
    const { store, dbPath } = await makeStore('legacy-now')
    paths.push(dbPath)
    const m: ExtractionResult = {
      people: [{ name: 'Bob', skills: [] }],
      topics: [], projects: [], decisions: [], action_items: [], risks: [], next_steps: [],
    }
    ingestExtraction(store, m, meta, '2026-06-01T00:00:00Z')
    const [node] = store.findNodes({ type: 'person' })
    expect(node.label).toBe('Bob')
    expect(node.created_at).toBe('2026-06-01T00:00:00Z')
  })
})

describe('Context Graph: upsert id-collision fix', () => {
  const paths: string[] = []
  afterEach(() => {
    for (const p of paths) if (existsSync(p)) rmSync(p, { force: true })
    paths.length = 0
  })

  it('two distinct norm_keys that slugify to the same id both insert without throwing', async () => {
    const { store, dbPath } = await makeStore('collision')
    paths.push(dbPath)

    // 'A/B' and 'A.B' have different norm_keys ('a/b' vs 'a.b') but both slugify
    // to id 'topic:a_b'. Before the fix this threw UNIQUE constraint failed.
    const id1 = store.upsertNode({ type: 'topic', label: 'A/B' })
    const id2 = store.upsertNode({ type: 'topic', label: 'A.B' })

    expect(id1).not.toBe(id2)
    const topics = store.findNodes({ type: 'topic' })
    expect(topics).toHaveLength(2)

    // Re-upserting the same labels is idempotent (dedups on norm_key).
    const id1again = store.upsertNode({ type: 'topic', label: 'A/B' })
    expect(id1again).toBe(id1)
    expect(store.findNodes({ type: 'topic' })).toHaveLength(2)
  })
})

describe('Context Graph: neighborhood + fullGraph traversal', () => {
  const paths: string[] = []
  afterEach(() => {
    for (const p of paths) if (existsSync(p)) rmSync(p, { force: true })
    paths.length = 0
  })

  async function seed(name: string) {
    const { store, dbPath } = await makeStore(name)
    paths.push(dbPath)
    const m: ExtractionResult = {
      people: [{ name: 'Alice', skills: ['SQL'] }, { name: 'Bob', skills: [] }],
      topics: ['Roadmap'],
      projects: ['Phoenix'],
      decisions: [],
      action_items: [],
      risks: [],
      next_steps: [],
    }
    ingestExtraction(store, m, meta)
    return store
  }

  it('neighborhood(person, 1) reaches the meeting but not the meeting topics', async () => {
    const store = await seed('nbr-1')
    const alice = store.findNodes({ type: 'person' }).find((n) => n.label === 'Alice')!
    const sub = neighborhood(store, alice.id, 1)
    expect(sub.center?.id).toBe(alice.id)
    const types = new Set(sub.nodes.map((n) => n.type))
    expect(types.has('meeting')).toBe(true)
    // 1 hop from Alice: the meeting + Alice's skill; NOT the meeting's topic.
    expect(sub.nodes.some((n) => n.type === 'topic')).toBe(false)
  })

  it('neighborhood(person, 2) reaches topics/projects through the meeting', async () => {
    const store = await seed('nbr-2')
    const alice = store.findNodes({ type: 'person' }).find((n) => n.label === 'Alice')!
    const sub = neighborhood(store, alice.id, 2)
    const types = new Set(sub.nodes.map((n) => n.type))
    expect(types.has('topic')).toBe(true)
    expect(types.has('project')).toBe(true)
    // Nodes carry a degree annotation.
    expect(sub.nodes.every((n) => typeof n.degree === 'number')).toBe(true)
  })

  it('neighborhood returns empty for an unknown node id', async () => {
    const store = await seed('nbr-missing')
    const sub = neighborhood(store, 'person:nobody', 2)
    expect(sub.center).toBeUndefined()
    expect(sub.nodes).toHaveLength(0)
    expect(sub.edges).toHaveLength(0)
  })

  it('fullGraph annotates degree and caps by limit keeping hubs', async () => {
    const store = await seed('full')
    const all = fullGraph(store)
    expect(all.nodes.length).toBeGreaterThan(3)
    const meetingNode = all.nodes.find((n) => n.type === 'meeting')!
    // The meeting connects to everything — it is the highest-degree hub.
    expect(meetingNode.degree).toBeGreaterThanOrEqual(4)

    const capped = fullGraph(store, 2)
    expect(capped.nodes).toHaveLength(2)
    // Every retained edge connects two retained nodes.
    const kept = new Set(capped.nodes.map((n) => n.id))
    expect(capped.edges.every((e) => kept.has(e.source_id) && kept.has(e.target_id))).toBe(true)
  })
})
